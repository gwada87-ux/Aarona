/**
 * Assemblage du pipeline de rendu live (§3.1).
 *
 *   [ scene (buffer) ]
 *          v  injectee dans
 *   [ FEEDBACK (ping-pong prev/next) ] -- copie --> [ bright /4 ] -> [ flou ]
 *          |                                              |
 *          +-----------> [ compose 'lighter' ] <----------+
 *                                v
 *              [ post : aberration -> grain -> overlay ]
 *                                v
 *                     [ mesure 32x18 ] -> ecran -> [ HUD ]
 *
 * MUST : la boucle de feedback ne reinjecte JAMAIS le bloom ni le post. Bloom
 * et post sont des branches en LECTURE SEULE. Sinon emballement lumineux et
 * ecran blanc en quelques secondes.
 *
 * MUST §3.7 : la chaine de post tourne a un bitmap PLAFONNE a 1920x1080
 * physiques, quel que soit le DPR. Le DPR superieur a 1 ne sert qu'au calque
 * HUD, dessine en dernier directement sur le canvas visible.
 *
 * Comptage de la chaine naive, pour memoire : feedback (2) + lecture bright (1)
 * + composite bloom x2 (2) + aberration 3 canaux (9) + grain (1) + scanlines (1)
 * + vignette (1) + blit (1) = environ 18 passes plein ecran. En 1080p a DPR 2,
 * le bitmap fait 8,29 Mpx, soit environ 150 Mpx de remplissage melange par
 * trame. Un iGPU soutient 2 a 5 Gpx/s en Canvas 2D : 30 a 70 ms par trame.
 * « DPR plafonne a 2 » et « 60 fps en 1080p » etaient contradictoires - d'ou
 * le plafond de bitmap, l'aberration a 2 canaux et demi-resolution, et la
 * fusion vignette + scanlines en une seule texture.
 */

import type { LiveConfig } from '../LiveConfig';
import type { EffectBudget } from '../IntensityDirector';
import type { OverlayId } from '../Overlays';
import type { LiveFrame, LiveScene, SceneContext, Viewport } from '../scenes/types';
import { Assets } from './Assets';
import { Bloom } from './Bloom';
import { Camera } from './Camera';
import { Feedback } from './Feedback';
import { FrameBudget } from './FrameBudget';
import { LayerStack, resetCompositing } from './LayerStack';
import { PaletteBook } from './Palette';
import { PostFX } from './PostFX';

export interface PipelineStats {
  /** Passes plein ecran consommees a la derniere trame. */
  readonly passes: number;
  /** Budget autorise au niveau de qualite courant. */
  readonly budget: number;
  /** Luminance moyenne du cadre, 0-1 (§2.8). */
  readonly luminance: number;
  /** Memoire canvas reservee, en Mo. */
  readonly memoryMb: number;
  /** Le pipeline a-t-il du degrader faute de memoire ou de contexte ? */
  readonly degraded: boolean;
  /** Taille reelle du bitmap de post. */
  readonly postW: number;
  readonly postH: number;
}

/**
 * Autorisations produites par `IntensityDirector` et `OverlayDirector`.
 *
 * MUST §2.8 : aucun effet ne se regle directement sur l'audio. Le pipeline ne
 * lit donc jamais `features` ni `onsets` pour decider d'un effet - il lit ceci.
 */
export interface RenderDirectives {
  readonly budget: EffectBudget;
  /** Overlays expressifs actifs, dans l'ordre d'application de §4.4. */
  readonly overlays: readonly OverlayId[];
}

export class LivePipeline {
  readonly stack: LayerStack;
  readonly palette: PaletteBook;
  readonly camera: Camera;
  readonly budget: FrameBudget;
  readonly assets: Assets;

  private readonly bloom: Bloom;
  private readonly feedback: Feedback;
  private readonly post: PostFX;

  private scene: LiveScene | null = null;
  private sceneInited = false;
  private sceneVariant = 0;
  /**
   * Scene ENTRANTE pendant une transition. MUST §4.3 : les deux scenes
   * partagent un unique buffer de FEEDBACK - leurs trainees se melangent, ce
   * qui est souhaitable - et seule la couche SCENE est doublee, a 0,6x de
   * resolution. Un fondu qui doublerait aussi le feedback couterait x2 sur
   * 120 trames, et `FrameBudget` degraderait la qualite pile pendant la
   * transition.
   */
  private nextScene: LiveScene | null = null;
  private nextSceneInited = false;
  private nextVariant = 0;
  private fadeElapsed = 0;
  private fadeDuration = 0;

  private postW = 0;
  private postH = 0;
  private passes = 0;
  private rngState = 0x2545f491;

  constructor(private readonly config: LiveConfig) {
    this.stack = new LayerStack(config.render);
    this.palette = new PaletteBook(config.content.forcedPalette >= 0 ? config.content.forcedPalette : 0);
    this.camera = new Camera();
    this.budget = new FrameBudget(config.perf);
    this.assets = new Assets(config.render);
    this.bloom = new Bloom(config.render, this.stack);
    this.feedback = new Feedback(config.render, this.stack);
    this.post = new PostFX(config.render, this.stack, this.assets);
  }

  /** Coupe FRANCHE. C'est le mode par defaut (§4.3). */
  setScene(scene: LiveScene, variant = 0): void {
    this.scene?.exit();
    this.nextScene?.exit();
    this.nextScene = null;
    this.fadeDuration = 0;
    this.stack.release('sceneB');
    this.scene = scene;
    this.sceneVariant = variant;
    this.sceneInited = false;
    // Vidage SEC du feedback sur chaque coupe de scene (§3.3) : un fondu
    // laisserait un fantome de la scene precedente pendant des secondes.
    this.feedback.clear();
  }

  /**
   * Fondu ADDITIF vers une autre scene, plafonne par l'appelant a une demi-
   * mesure (§4.3). Le feedback n'est PAS vide : c'est justement ce qui fait
   * qu'un fondu se lit comme un fondu et non comme deux coupes.
   */
  crossfadeTo(scene: LiveScene, variant: number, durationSec: number): void {
    if (durationSec <= 0 || !this.scene) {
      this.setScene(scene, variant);
      return;
    }
    this.nextScene?.exit();
    this.nextScene = scene;
    this.nextVariant = variant;
    this.nextSceneInited = false;
    this.fadeElapsed = 0;
    this.fadeDuration = durationSec;
  }

  get currentScene(): LiveScene | null {
    return this.scene;
  }

  /** Une transition est-elle en cours ? `FrameBudget` doit alors etre gele (§3.7). */
  get transitioning(): boolean {
    return this.nextScene !== null;
  }

  get fadeProgress(): number {
    return this.fadeDuration > 0 ? Math.min(1, this.fadeElapsed / this.fadeDuration) : 0;
  }

  get stats(): PipelineStats {
    return {
      passes: this.passes,
      budget: this.budget.profile.fullscreenBudget,
      luminance: this.post.meanLuminance,
      memoryMb: this.stack.budget.megabytes,
      degraded: this.stack.degraded,
      postW: this.postW,
      postH: this.postH,
    };
  }

  /** A appeler sur `visibilitychange` et sur resize (§3.3, §3.7). */
  invalidate(nowMs: number): void {
    this.feedback.clear();
    this.budget.freeze(nowMs, this.config.perf.resizeFreezeMs);
  }

  /**
   * Une trame complete. `screenCtx` est le canvas VISIBLE ; le HUD sera
   * dessine par-dessus, apres, par l'appelant.
   */
  render(
    screenCtx: CanvasRenderingContext2D,
    screenW: number,
    screenH: number,
    dpr: number,
    frame: Omit<LiveFrame, 'view' | 'quality' | 'palette' | 'previousFrame'>,
    directives: RenderDirectives,
  ): void {
    this.passes = 0;
    const quality = this.budget.profile;

    // Plafond de bitmap, puis diviseur de qualite.
    const cap = Math.min(
      1,
      this.config.render.postMaxWidth / Math.max(1, screenW),
      this.config.render.postMaxHeight / Math.max(1, screenH),
    );
    const scale = cap / quality.postDivider;
    const w = Math.max(2, Math.round(screenW * scale));
    const h = Math.max(2, Math.round(screenH * scale));
    this.postW = w;
    this.postH = h;

    const view: Viewport = { w, h, dpr, min: Math.min(w, h) };
    const sceneLayer = this.stack.acquire('scene', w, h);
    if (!sceneLayer) {
      this.drawFallback(screenCtx, screenW, screenH);
      return;
    }

    this.palette.update(frame.dt);
    this.camera.update(frame.dt);
    this.assets.ensureStatic(sceneLayer.ctx);

    // La frame precedente est le buffer de FEEDBACK tel qu'il est AVANT
    // l'avance de cette trame : c'est bien l'image d'avant que voit la scene,
    // et c'est un canvas different de sa surface de dessin - jamais un
    // `drawImage` sur soi-meme (§3.1).
    // Garde de TAILLE : le feedback n'est redimensionne qu'apres le rendu de
    // la scene. Juste apres un resize, `readable` pointe encore sur un buffer
    // de l'ancienne taille, et une scene qui y decoupe des bandes aux nouvelles
    // coordonnees lirait hors du bitmap. Une trame sans image precedente vaut
    // mieux qu'une trame fausse.
    const feedbackUsable =
      quality.feedback && this.feedback.width === w && this.feedback.height === h ? this.feedback.readable : null;
    const previousFrame = feedbackUsable?.canvas as CanvasImageSource | undefined;
    const full: LiveFrame = {
      ...frame,
      view,
      quality: quality.level,
      palette: this.palette,
      previousFrame: previousFrame ?? null,
    };

    // 1. SCENE. Fond teinte de la palette - jamais `#000` pur (§3.5).
    const sctx = sceneLayer.ctx;
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    resetCompositing(sctx);
    sctx.fillStyle = this.palette.hex('background');
    sctx.fillRect(0, 0, w, h);

    // Le shake n'est applique que si l'overlay `shake` est actif (§4.4) ; sinon
    // la camera ne porte que ses repositionnements.
    const shakeDivider = directives.overlays.includes('shake')
      ? frame.reducedMotion
        ? this.config.safety.reducedAmplitudeDivider
        : 1
      : 1e6;

    if (this.scene) {
      if (!this.sceneInited) {
        this.scene.init(this.sceneContext(sctx, view));
        this.scene.enter(full, this.sceneVariant);
        this.sceneInited = true;
      }
      this.scene.resize(view);
      // La camera est appliquee AVANT la scene : le shake est une modulation
      // de cadrage, pas un effet de post (§3.6).
      this.camera.apply(sctx, view, shakeDivider);
      this.scene.render(sctx, full);
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      resetCompositing(sctx);
    }

    // 1bis. TRANSITION. Seule la couche scene est doublee, a `transitionScale`.
    if (this.nextScene) {
      this.fadeElapsed += frame.dt;
      const t = this.fadeProgress;
      const tw = Math.max(2, Math.round(w * this.config.director.transitionScale));
      const th = Math.max(2, Math.round(h * this.config.director.transitionScale));
      const layerB = this.stack.acquire('sceneB', tw, th);
      if (layerB) {
        const bctx = layerB.ctx;
        const viewB: Viewport = { w: tw, h: th, dpr, min: Math.min(tw, th) };
        bctx.setTransform(1, 0, 0, 1, 0, 0);
        resetCompositing(bctx);
        // TRANSPARENT, pas rempli du fond : le fondu est ADDITIF, un fond
        // opaque effacerait la scene sortante d'un coup.
        bctx.clearRect(0, 0, tw, th);
        if (!this.nextSceneInited) {
          this.nextScene.init(this.sceneContext(bctx, viewB));
          this.nextScene.enter({ ...full, view: viewB }, this.nextVariant);
          this.nextSceneInited = true;
        }
        this.nextScene.resize(viewB);
        this.camera.apply(bctx, viewB, shakeDivider);
        this.nextScene.render(bctx, { ...full, view: viewB });
        bctx.setTransform(1, 0, 0, 1, 0, 0);
        resetCompositing(bctx);

        sctx.globalCompositeOperation = 'lighter';
        sctx.globalAlpha = t;
        sctx.imageSmoothingEnabled = true;
        sctx.drawImage(layerB.canvas as CanvasImageSource, 0, 0, w, h);
        resetCompositing(sctx);
        this.passes += ((tw * th) / Math.max(1, screenW * screenH)) + (w * h) / Math.max(1, screenW * screenH);
      }
      if (t >= 1) {
        this.scene?.exit();
        this.scene = this.nextScene;
        this.sceneInited = false;
        this.sceneVariant = this.nextVariant;
        this.nextScene = null;
        this.fadeDuration = 0;
        this.stack.release('sceneB');
      }
    }
    // Le dessin de la scene n'est PAS compte dans le budget : §3.7 chiffre la
    // chaine de POST (feedback, bright pass, composites de bloom, aberration,
    // grain, scanlines, vignette, blit), et mesure le cout des scenes
    // separement, en temps de trame par scene. Melanger les deux rendrait le
    // budget incomparable a celui du prompt.

    // Reference du budget : une « passe plein ecran » est une passe couvrant
    // le canvas VISIBLE. Un buffer au quart de la resolution lineaire coute
    // donc 1/16 de passe.
    const refArea = Math.max(1, screenW * screenH);
    const postArea = (w * h) / refArea;

    // 2. FEEDBACK. Branche unique qui ECRIT ; tout le reste lit.
    let source = sceneLayer;
    if (quality.feedback && this.feedback.resize(w, h)) {
      const next = this.feedback.advance(
        sceneLayer,
        frame.dt,
        frame.beat.barPhase,
        frame.reducedMotion ? this.config.safety.reducedFeedbackKMax : null,
      );
      if (next) source = next;
      this.passes += postArea * 2;
    } else if (!quality.feedback) {
      this.feedback.dispose();
    }

    // 3. COMPOSE.
    const transient = Math.max(frame.onsets.envelope('kick', 0.12), frame.onsets.envelope('snare', 0.1));
    // L'aberration est desormais un OVERLAY EXPRESSIF (§4.4) : elle n'est
    // active que si le director l'a retenue dans le budget, en plus de la
    // condition de qualite. Sans cette porte, elle serait un effet permanent
    // regle sur l'audio, exactement ce que §2.8 interdit.
    const aberrationPx =
      quality.aberration && directives.overlays.includes('aberration') && !frame.reducedMotion
        ? transient * this.config.render.aberrationMaxPx * frame.intensity * directives.budget.amplitude
        : 0;
    const aberrationActive = aberrationPx >= this.config.render.aberrationGatePx;

    // CHOIX DE LA CIBLE DE COMPOSITION.
    //
    // Le buffer de post intermediaire n'est necessaire que dans deux cas :
    // l'aberration, seul etage qui exige une source STABLE et relisible ; et
    // un diviseur de resolution > 1, ou toute la chaine doit rester en
    // resolution reduite jusqu'a un unique blit final - c'est tout l'interet
    // du diviseur. Dans les autres cas, composer directement sur l'ecran
    // economise une copie ET un blit plein ecran par trame.
    const reduced = w !== screenW || h !== screenH;
    let target = screenCtx;
    let targetW = screenW;
    let targetH = screenH;
    let postLayer = null as ReturnType<LayerStack['acquire']>;
    if (aberrationActive || reduced) {
      postLayer = this.stack.acquire('post', w, h);
      if (postLayer) {
        target = postLayer.ctx;
        targetW = w;
        targetH = h;
        target.setTransform(1, 0, 0, 1, 0, 0);
        resetCompositing(target);
      }
    } else {
      this.stack.release('post');
    }

    target.setTransform(1, 0, 0, 1, 0, 0);
    target.imageSmoothingEnabled = true;
    target.globalCompositeOperation = 'copy';
    target.globalAlpha = 1;
    target.drawImage(source.canvas as CanvasImageSource, 0, 0, targetW, targetH);
    resetCompositing(target);
    this.passes += (targetW * targetH) / refArea;
    // Le BUDGET module le bloom : c'est par lui que passent la retenue avant
    // impact, la retombee d'apres drop, le breakdown et le garde-fou de
    // saturation. Sous 0,15 le bloom ne se voit plus, on le coupe.
    const bloomScales = directives.budget.bloom < 0.15 ? 0 : quality.bloomScales;
    this.passes += this.bloom.apply(source, target, targetW, targetH, bloomScales, refArea, directives.budget.bloom);

    // 4. POST.
    // EXCLUSION MUTUELLE aberration / grain (§4.4). Les deux jouent sur le
    // meme registre - la texture de l'image - et l'aberration masque largement
    // le banding que le grain sert a dithering.
    const grain = quality.grain && !aberrationActive ? 1 : 0;
    if (postLayer && aberrationActive) {
      this.post.composite(postLayer, screenCtx, screenW, screenH, {
        aberrationPx,
        grain,
        overlay: true,
        scanlines: quality.scanlines && directives.overlays.includes('scanlines'),
      });
      this.passes += this.post.lastPasses;
      this.drawLateOverlays(screenCtx, screenW, screenH, directives, frame);
      this.enforceLuminanceCap(screenCtx, screenW, screenH, directives.budget.luminanceCap);
      this.post.measure(postLayer.canvas as CanvasImageSource);
      return;
    }

    // Finition appliquee sur la CIBLE, donc en resolution reduite quand le
    // diviseur est > 1 : grain et overlay y coutent alors un quart de passe au
    // lieu d'une. Le seul cout plein ecran restant est le blit final.
    if (grain > 0) {
      this.assets.drawGrain(target, targetW, targetH, grain, this.rng);
      this.passes += (targetW * targetH) / refArea;
    }
    this.assets.ensureOverlay(targetW, targetH, quality.scanlines && directives.overlays.includes('scanlines'));
    this.assets.drawOverlay(target, targetW, targetH);
    this.passes += (targetW * targetH) / refArea;

    if (postLayer) {
      screenCtx.setTransform(1, 0, 0, 1, 0, 0);
      resetCompositing(screenCtx);
      screenCtx.imageSmoothingEnabled = true;
      screenCtx.globalCompositeOperation = 'copy';
      screenCtx.drawImage(postLayer.canvas as CanvasImageSource, 0, 0, screenW, screenH);
      resetCompositing(screenCtx);
      this.passes += 1;
      this.post.measure(postLayer.canvas as CanvasImageSource);
    } else {
      this.post.measure(source.canvas as CanvasImageSource);
    }

    this.drawLateOverlays(screenCtx, screenW, screenH, directives, frame);
    this.enforceLuminanceCap(screenCtx, screenW, screenH, directives.budget.luminanceCap);
  }

  /**
   * Overlays de fin de chaine, dans l'ordre de §4.4 : cadre puis inversion.
   * Ils sont poses sur le canvas VISIBLE, apres le post, et passeront donc par
   * le `FlashLimiter` que l'appelant applique ensuite - l'inversion est
   * exactement le genre d'effet que §6.9 refuse de laisser sortir non filtre.
   */
  private drawLateOverlays(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    directives: RenderDirectives,
    frame: Omit<LiveFrame, 'view' | 'quality' | 'palette' | 'previousFrame'>,
  ): void {
    if (directives.overlays.includes('frame')) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      resetCompositing(ctx);
      const inset = Math.round(Math.min(w, h) * 0.035);
      const thin = Math.max(1, Math.round(Math.min(w, h) * 0.0016));
      ctx.strokeStyle = this.palette.hex('accent');
      ctx.globalAlpha = 0.35 + frame.intensity * 0.25;
      ctx.lineWidth = thin;
      // Demi-pixel : un cadre d'epaisseur 1 sur coordonnee entiere scintille.
      ctx.strokeRect(inset + 0.5, inset + 0.5, w - inset * 2, h - inset * 2);
      // Marques d'angle : ce qui distingue un cadre d'un simple rectangle.
      const tick = Math.round(Math.min(w, h) * 0.02);
      ctx.lineWidth = thin * 2;
      ctx.beginPath();
      for (const [cx, cy, sx, sy] of [
        [inset, inset, 1, 1],
        [w - inset, inset, -1, 1],
        [inset, h - inset, 1, -1],
        [w - inset, h - inset, -1, -1],
      ] as const) {
        ctx.moveTo(cx + 0.5, cy + sy * tick + 0.5);
        ctx.lineTo(cx + 0.5, cy + 0.5);
        ctx.lineTo(cx + sx * tick + 0.5, cy + 0.5);
      }
      ctx.stroke();
      resetCompositing(ctx);
      this.passes += 0.05;
    }

    if (directives.overlays.includes('invert')) {
      // `'difference'` avec du blanc EST l'inversion : `|1 - c|`. Une seule
      // passe, et elle passe par le limiteur de flash juste apres.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'difference';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      resetCompositing(ctx);
      this.passes += 1;
    }
  }

  /**
   * Applique le plafond de luminance du director (§2.8 : breakdown a 15 %,
   * plancher de vide a 35 %). Sans cette passe, ces deux regles resteraient
   * des intentions : le director peut baisser le bloom et la densite, il ne
   * peut pas garantir que la scene elle-meme s'assombrisse.
   *
   * Un voile noir uniforme deplace la luminance MOYENNE de facon previsible
   * sans preserver le contraste local - meme approximation assumee que
   * `FlashLimiter.dimTowards`, et pour la meme raison : cette passe ne
   * s'engage que sur des situations deja extremes.
   */
  private enforceLuminanceCap(ctx: CanvasRenderingContext2D, w: number, h: number, cap: number): void {
    if (cap >= 1) return;
    const measured = this.post.meanLuminance;
    if (measured <= cap || measured <= 1e-4) return;
    const alpha = Math.min(0.92, 1 - cap / measured);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    resetCompositing(ctx);
    this.passes += 1;
  }

  private sceneContext(ctx: CanvasRenderingContext2D, view: Viewport): SceneContext {
    return { ctx, view, config: this.config, assets: this.assets, rng: this.rng };
  }

  /** Chemin degrade : plus de memoire canvas, on dessine au moins le fond. */
  private drawFallback(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    resetCompositing(ctx);
    ctx.fillStyle = this.palette.hex('background');
    ctx.fillRect(0, 0, w, h);
    this.passes = 1;
  }

  private readonly rng = (): number => {
    this.rngState ^= this.rngState << 13;
    this.rngState ^= this.rngState >>> 17;
    this.rngState ^= this.rngState << 5;
    return ((this.rngState >>> 0) % 1000000) / 1000000;
  };

  dispose(): void {
    this.scene?.dispose();
    this.scene = null;
    this.sceneInited = false;
    this.feedback.dispose();
    this.post.dispose();
    this.assets.dispose();
    this.stack.disposeAll();
    this.budget.reset();
    this.camera.reset();
  }
}

