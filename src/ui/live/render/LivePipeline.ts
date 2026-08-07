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

  setScene(scene: LiveScene): void {
    this.scene?.exit();
    this.scene = scene;
    this.sceneInited = false;
    // Vidage SEC du feedback sur chaque coupe de scene (§3.3) : un fondu
    // laisserait un fantome de la scene precedente pendant des secondes.
    this.feedback.clear();
  }

  get currentScene(): LiveScene | null {
    return this.scene;
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
    if (this.scene) {
      if (!this.sceneInited) {
        const sc: SceneContext = {
          ctx: sctx,
          view,
          config: this.config,
          assets: this.assets,
          rng: this.rng,
        };
        this.scene.init(sc);
        this.scene.enter(full, 0);
        this.sceneInited = true;
      }
      this.scene.resize(view);
      // La camera est appliquee AVANT la scene : le shake est une modulation
      // de cadrage, pas un effet de post (§3.6).
      this.camera.apply(sctx, view, frame.reducedMotion ? this.config.safety.reducedAmplitudeDivider : 1);
      this.scene.render(sctx, full);
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      resetCompositing(sctx);
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
    const aberrationPx =
      quality.aberration && !frame.reducedMotion
        ? transient * this.config.render.aberrationMaxPx * frame.intensity
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
    this.passes += this.bloom.apply(source, target, targetW, targetH, quality.bloomScales, refArea);

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
        scanlines: quality.scanlines,
      });
      this.passes += this.post.lastPasses;
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
    this.assets.ensureOverlay(targetW, targetH, quality.scanlines);
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

