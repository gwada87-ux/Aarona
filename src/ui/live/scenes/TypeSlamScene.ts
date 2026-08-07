/**
 * `type-slam` (§4.2, scene 6) - typographie massive entrant sur le snare,
 * revelee par masque, avec separation RVB.
 *
 * ACCENT PRINCIPAL (§2.7.6) : le BLOC DE FOND, qui porte le kick. La
 * typographie, elle, porte le SNARE - c'est la description meme de §4.2
 * (« typographie massive entrant sur le snare »). Un instrument, un canal
 * (§2.7.7) : kick -> bloc et impulsion de cadre ; snare -> entree du texte et
 * revelation par masque ; charley -> separation RVB et grain de bord.
 *
 * ---------------------------------------------------------------------------
 * TYPOGRAPHIE : deux pieges, tous deux traites
 * ---------------------------------------------------------------------------
 * 1. **`measureText` JAMAIS dans la boucle** (§3.7). Il alloue un `TextMetrics`
 *    ET re-rasterise un glyphe de 400 px a chaque appel. Le texte est donc
 *    rasterise UNE FOIS dans un buffer dedie, au changement de texte ou de
 *    taille, jamais par trame.
 * 2. **Attendre `document.fonts.ready`** et precharger les graisses via
 *    `document.fonts.load()`. Sans ca, le premier rendu utilise la police de
 *    repli, le buffer est mis en cache avec, et la vraie police n'apparait
 *    jamais - le cache masque le probleme au lieu de le resoudre.
 *
 * Pile de repli imposee : `"IBM Plex Mono", ui-monospace, monospace`.
 */

import { resetCompositing } from '../render/LayerStack';
import { DECAY_HAT, DECAY_KICK, DECAY_SNARE, withGridFloor } from '../util/accent';
import { MAX_OVERSHOOT, easeInOutSine, easeOutCubic, overshootLobe } from '../util/easing';
import type { LiveFrame, LiveScene, SceneContext, SceneLayers, SceneTag, Viewport } from './types';

interface Variant {
  /** Position du texte, en fraction du cadre depuis le centre. */
  readonly anchorX: number;
  readonly anchorY: number;
  /** Sens d'entree du slam. */
  readonly slideFrom: number;
  /** `true` = gros plan : le texte deborde du cadre. */
  readonly closeUp: boolean;
}

/** Deux variantes decentrees, une centree (§3.6). */
const VARIANTS: readonly Variant[] = [
  { anchorX: -0.14, anchorY: 0.04, slideFrom: -1, closeUp: false },
  { anchorX: 0.15, anchorY: -0.06, slideFrom: 1, closeUp: true },
  { anchorX: 0, anchorY: 0, slideFrom: -1, closeUp: false },
];

const FONT_STACK = '"IBM Plex Mono", ui-monospace, monospace';
/** Marge du buffer de texte, en fraction de la taille de police : les glyphes debordent de leur boite. */
const GLYPH_MARGIN = 0.35;

export class TypeSlamScene implements LiveScene {
  readonly id = 'type-slam';
  readonly tags: readonly SceneTag[] = ['glitch', 'intense', 'strobe'];
  readonly intensityRange: readonly [number, number] = [0.55, 1];
  readonly primaryAccent = 'bloc de fond (kick)';

  private variant: Variant = VARIANTS[0]!;
  private reducedDivider = 2;
  private layers: SceneLayers | null = null;
  private slamTexts: readonly string[] = ['LIVE'];
  /** `true` une fois `document.fonts.ready` resolu : avant, on ne met rien en cache. */
  private fontsReady = false;
  /** Cle du buffer courant : texte + taille. Un changement de l'un des deux le reconstruit. */
  private cacheKey = '';
  private cacheW = 0;
  private cacheH = 0;
  private textIndex = 0;
  private lastBarIndex = Number.NEGATIVE_INFINITY;
  private lastSnareTime = Number.NEGATIVE_INFINITY;
  private slamAge = 99;

  init(sc: SceneContext): void {
    this.reducedDivider = sc.config.safety.reducedAmplitudeDivider;
    this.layers = sc.layers;
    this.slamTexts = sc.config.content.slamText;
    this.prepareFonts();
  }

  /**
   * Precharge la police AVANT tout rendu. `document.fonts` n'existe pas
   * partout (tests, environnements sans DOM complet) : l'absence est traitee
   * comme « prete », avec la pile de repli.
   */
  private prepareFonts(): void {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (!fonts) {
      this.fontsReady = true;
      return;
    }
    const load = fonts.load?.(`700 64px ${FONT_STACK}`);
    const ready = fonts.ready;
    Promise.all([load ?? Promise.resolve(), ready ?? Promise.resolve()])
      .then(() => {
        this.fontsReady = true;
        // Le buffer eventuellement construit avec la police de repli est
        // invalide : sans cette ligne, le cache figerait le mauvais rendu.
        this.cacheKey = '';
      })
      .catch(() => {
        this.fontsReady = true;
      });
  }

  enter(frame: LiveFrame, variantIndex: number): void {
    this.variant = VARIANTS[variantIndex % VARIANTS.length]!;
    this.lastBarIndex = frame.beat.barIndex;
    this.slamAge = 99;
  }

  resize(_view: Viewport): void {
    // Le buffer est reconstruit par la cle de cache, qui contient la taille.
  }

  // hot-path (§8.9) : corps de trame.
  render(ctx: CanvasRenderingContext2D, frame: LiveFrame): void {
    const view = frame.view;
    const amp = frame.reducedMotion ? 1 / Math.max(1, this.reducedDivider) : 1;
    const palette = frame.palette;
    const v = this.variant;
    const unit = view.min;

    // Le bloc de fond est l'accent principal et l'element le plus massif de
    // toutes les scenes : depassement de 8 % (§2.7.8) et plancher de grille.
    const kick = withGridFloor(frame.onsets.envelope('kick', DECAY_KICK, 0.08), frame.gridAccent(DECAY_KICK), 1);
    const hat = frame.onsets.envelope('hat', DECAY_HAT);

    // Le texte change sur frontiere de MESURE, jamais au milieu (§2.7.5).
    if (frame.beat.barIndex !== this.lastBarIndex) {
      this.lastBarIndex = frame.beat.barIndex;
      if (frame.beat.barIndex % 2 === 0) this.textIndex++;
    }

    // --- accent principal : le BLOC DE FOND, porte par le KICK --------------
    const blockH = unit * (0.13 + kick * 0.16 * amp);
    const blockY = v.anchorY * view.h;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.16 + kick * 0.4 * amp;
    ctx.fillStyle = palette.hexModulated('secondary', kick * 2 - 1);
    ctx.fillRect(-view.w / 2, blockY - blockH / 2, view.w, blockH);

    // --- le texte : porte par le SNARE --------------------------------------
    const snareTime = frame.onsets.lastTime('snare');
    if (frame.onsets.fired('snare') && snareTime !== this.lastSnareTime) {
      this.lastSnareTime = snareTime;
      this.slamAge = 0;
    }
    this.slamAge += frame.dt;

    const text = this.resolveText(frame);
    const fontPx = Math.round(unit * (v.closeUp ? 0.42 : 0.26));
    const layer = this.rasterise(text, fontPx);
    if (!layer) {
      resetCompositing(ctx);
      return;
    }

    // Entree : le texte arrive lateralement puis se cale. Retour au repos en
    // 0,3 a 0,6 temps avec un leger depassement (§2.7.8). Courbes partagees
    // depuis `util/easing` : la meme cloche de depassement que `impact()`.
    const period = frame.beat.periodSec > 0 ? frame.beat.periodSec : 0.5;
    const t = Math.min(1, this.slamAge / (period * DECAY_SNARE));
    const ease = easeOutCubic(t);
    const scale = 1 + overshootLobe(t, MAX_OVERSHOOT) * amp;
    const slide = (1 - ease) * v.slideFrom * unit * 0.35 * amp;

    const dw = layer.width * scale;
    const dh = layer.height * scale;
    // MICRO-VARIATION de phrase (§4.3) : l'ancre horizontale derive lentement.
    // Le texte change toutes les deux mesures, mais il retombait TOUJOURS au
    // meme pixel, ce qui rendait la scene mecanique au bout d'une phrase.
    const anchorX = v.anchorX + (easeInOutSine(frame.beat.phrasePhase) - 0.5) * 0.06;
    const dx = anchorX * view.w + slide - dw / 2;
    const dy = blockY - dh / 2;

    // REVELATION PAR MASQUE : une bande horizontale s'ouvre depuis le centre
    // du bloc. C'est le canal du snare (§2.7.7), pas un effet decoratif.
    const revealH = dh * (0.15 + ease * 0.95);
    ctx.save();
    ctx.beginPath();
    ctx.rect(-view.w / 2, blockY - revealH / 2, view.w, revealH);
    ctx.clip();

    // SEPARATION RVB : pilotee par le CHARLEY, plafonnee a 40 % de l'accent.
    const split = hat * unit * 0.006 * amp;
    if (split >= 1 && !frame.reducedMotion) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = palette.hex('accent');
      this.drawTinted(ctx, layer.image, dx + split, dy, dw, dh);
      ctx.fillStyle = palette.hex('primary');
      this.drawTinted(ctx, layer.image, dx - split, dy, dw, dh);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85 + hat * 0.15;
    ctx.drawImage(layer.image, dx, dy, dw, dh);
    ctx.restore();

    resetCompositing(ctx);
  }

  /**
   * Dessine le masque de texte teinte, sans buffer supplementaire : le texte
   * est deja blanc sur transparent, donc un `drawImage` en `'lighter'` suffit
   * a l'additionner - la teinte vient de l'alpha et du `globalAlpha`, pas d'un
   * `'multiply'` qui exigerait un buffer opaque (§3.4).
   */
  private drawTinted(
    ctx: CanvasRenderingContext2D,
    image: CanvasImageSource,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    ctx.drawImage(image, x, y, w, h);
  }

  /**
   * Texte a afficher (§4.2) : `slamText` avec substitution, vide => BPM seul,
   * BPM non verrouille => `LIVE`.
   */
  private resolveText(frame: LiveFrame): string {
    const locked = frame.state === 'LOCKED' && frame.beat.bpm > 0;
    const bpm = locked ? `${Math.round(frame.beat.bpm)}` : '';
    if (this.slamTexts.length === 0) return locked ? bpm : 'LIVE';
    const raw = this.slamTexts[this.textIndex % this.slamTexts.length] ?? 'LIVE';
    const resolved = raw.replace('{bpm}', bpm).replace('{palette}', frame.palette.current.id.toUpperCase());
    if (resolved.trim().length === 0) return locked ? bpm : 'LIVE';
    return resolved;
  }

  /**
   * Rasterise le texte dans un buffer dedie. Reconstruit UNIQUEMENT au
   * changement de texte ou de taille - jamais par trame, et `measureText` n'y
   * est appele qu'a ce moment-la.
   */
  private rasterise(text: string, fontPx: number): { image: CanvasImageSource; width: number; height: number } | null {
    const layers = this.layers;
    if (!layers || fontPx < 4) return null;
    const key = `${text}|${fontPx}|${this.fontsReady ? 'f' : 'r'}`;
    if (key === this.cacheKey && this.cacheW > 0) {
      // `acquire` avec la MEME taille retourne le calque tel quel, sans
      // reallocation ni effacement. Repasser 1x1 le detruirait.
      const existing = layers.acquire('type-slam', this.cacheW, this.cacheH, false);
      if (existing) return existing;
    }

    // Mesure UNE FOIS, ici, jamais dans `render`.
    const probe = layers.acquire('type-slam-probe', 8, 8, false);
    if (!probe) return null;
    probe.ctx.font = `700 ${fontPx}px ${FONT_STACK}`;
    const metrics = probe.ctx.measureText(text);
    const textW = Math.max(1, Math.ceil(metrics.width));
    layers.release('type-slam-probe');

    const margin = Math.ceil(fontPx * GLYPH_MARGIN);
    const w = textW + margin * 2;
    const h = Math.ceil(fontPx * 1.4) + margin * 2;
    const layer = layers.acquire('type-slam', w, h, false);
    if (!layer) return null;

    const c = layer.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, w, h);
    c.font = `700 ${fontPx}px ${FONT_STACK}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // Blanc sur transparent : le buffer est un MASQUE, la couleur vient de la
    // palette au moment de la composition.
    c.fillStyle = '#ffffff';
    c.fillText(text, w / 2, h / 2);
    this.cacheKey = key;
    this.cacheW = w;
    this.cacheH = h;
    return layer;
  }

  exit(): void {
    this.layers?.release('type-slam');
    this.layers?.release('type-slam-probe');
    this.cacheKey = '';
    this.cacheW = 0;
    this.cacheH = 0;
  }

  reset(): void {
    this.variant = VARIANTS[0]!;
    this.textIndex = 0;
    this.slamAge = 99;
    this.cacheKey = '';
    this.cacheW = 0;
    this.cacheH = 0;
    this.lastBarIndex = Number.NEGATIVE_INFINITY;
    this.lastSnareTime = Number.NEGATIVE_INFINITY;
  }

  dispose(): void {
    this.exit();
    this.reset();
    this.layers = null;
  }
}

export const TYPE_SLAM_VARIANTS = VARIANTS.length;
export const TYPE_SLAM_FONT_STACK = FONT_STACK;
