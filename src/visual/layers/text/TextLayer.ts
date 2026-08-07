/**
 * Couche de texte (docs/17_PHASE2_VISUELS.md §9.3, chantier 8).
 *
 * UN SPRITE PAR GLYPHE — ET C'EST L'INTERFACE QUI L'A DÉCIDÉ
 * ----------------------------------------------------------
 * §9.3 laissait le choix entre ajouter `drawText` à l'interface `Renderer` et
 * rastériser dans `createSprite`, en recommandant la seconde voie. Elle est
 * suivie, et le grain retenu est LE GLYPHE, pas la ligne. Ce n'est pas un détail
 * de découpage : c'est ce qui rend possibles quatre des six animations de §7.6.
 * Un sprite par ligne ne permettrait ni la machine à écrire, ni l'entrée mot par
 * mot, puisqu'un sprite ne se dessine qu'entier.
 *
 * En prime, un sprite par glyphe est PLUS FIN qu'un sprite par ligne à mémoire
 * égale : une ligne de vingt caractères dans un carré de 512 donne vingt-cinq
 * pixels par caractère, alors que vingt carrés de 160 en donnent cent soixante.
 *
 * Les sprites sont mis en cache PAR CARACTÈRE : « MELVELBASE » a dix glyphes
 * mais sept caractères distincts, donc sept sprites.
 *
 * LES DEUX PIÈGES DE §9.3
 * -----------------------
 * 1. **`measureText` jamais dans la boucle.** Il est appelé exactement une fois
 *    par caractère distinct, DANS le rappel de `createSprite` — c'est-à-dire au
 *    seul endroit du projet où une couche tient un contexte 2D, et une seule
 *    fois par construction de scène. La mesure est rangée dans `advanceByChar`,
 *    et la mise en page ne relit plus que ce tableau.
 *
 * 2. **`document.fonts.ready`.** `TypeSlamScene` doit l'attendre parce qu'il
 *    demande « IBM Plex Mono ». Ici, AUCUNE police n'est téléchargée : les trois
 *    familles de `TEXT_FAMILIES` sont des piles système, disponibles sans
 *    chargement. Le piège n'existe donc pas — mais il reviendrait à la première
 *    police web ajoutée, et il faudrait alors rebâtir les sprites à la
 *    résolution de `document.fonts.ready`, exactement comme le fait le mode live.
 *    Écrit ici pour que ce ne soit pas redécouvert par l'écran noir.
 *
 * FUSION NORMALE, PAS ADDITIVE
 * ----------------------------
 * `drawSprite` compose en `'lighter'` par défaut : un sprite est additif par
 * nature dans ce moteur. Du texte additif posé sur un fond clair devient
 * illisible — il s'éclaircit jusqu'au blanc. La couche déclare donc
 * `blend = 'normal'` (§7.2, chantier 4), et c'est le premier usage réel de ce
 * mécanisme : le texte est de l'information, sa lisibilité prime sur son éclat.
 */

import type { BlendMode, Color, Renderer, SpriteHandle, SpriteTransform } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import { ensureContrast } from '../../palette/contrast';
import type { Palette } from '../../palette/Palette';
import {
  TEXT_FAMILIES,
  type TextConfig,
  type TextColorRole,
  DEFAULT_TEXT_CONFIG,
} from '../../text/textConfig';
import { FALLBACK_SPACE_ADVANCE, layoutInto, planText, type TextPlan } from '../../text/textLayout';
import {
  chromaSplit,
  createGlyphMotion,
  createStripMotion,
  evaluateGlyph,
  evaluateStrip,
  typewriterCursor,
  usesChroma,
  usesStrips,
} from '../../text/textAnimations';

/** Nombre de tranches horizontales, pour `reveal` et `slice`. */
const STRIP_COUNT = 3;
/**
 * Fraction de la hauteur du sprite occupée par les tranches. Les glyphes sont
 * centrés et leur encre ne remplit pas le carré : tailler les tranches sur la
 * hauteur entière en donnerait deux vides sur trois.
 */
const STRIP_SPAN = 0.82;
/** Côté du sprite en multiples de la taille de police : place pour hampes, jambages et dépassement. */
const SPRITE_EM = 1.6;
/**
 * Budget de résolution : le côté d'un sprite est calculé pour que
 * `glyphes x côté²` reste voisin de cette valeur. Borne la mémoire quel que soit
 * le texte — 40 glyphes en tranches, cas le plus lourd, tiennent sous 12 Mo.
 */
const SPRITE_PIXEL_BUDGET = 1024 * 1024;
const MIN_SPRITE = 96;
const MAX_SPRITE = 384;

/** Avance de repli quand `measureText` n'est pas joignable (tests hors navigateur). */
const FALLBACK_ADVANCE = 0.62;

/** Écartement de base entre glyphes, en em. */
const TRACKING_BASE = 0.02;
/** Écartement ajouté par `tension` : le texte se dilate quand le morceau se tend. */
const TRACKING_TENSION = 0.11;
/** Échelle ajoutée par le kick. Volontairement minuscule : un titre qui pompe est illisible. */
const KICK_SCALE = 0.018;
/** Largeur du curseur de la machine à écrire, en em. */
const CURSOR_WIDTH = 0.09;

export class TextLayer implements Layer {
  readonly id = 'text';
  readonly kind: LayerKind = 'text';
  readonly needsDrawPriming = false;
  readonly blend: BlendMode = 'normal';
  params: LayerParams = {};

  private readonly config: TextConfig;
  private plan: TextPlan = planText('', 'none');

  /** Sprite de base par caractère, dans la couleur du texte. */
  private base: SpriteHandle[] = [];
  /** `strips[k][i]` : tranche `k` du glyphe `i`. Vide si l'animation n'en a pas besoin. */
  private strips: SpriteHandle[][] = [];
  /** Copies colorées du décalage RVB. Vides si l'animation n'est pas `rgb`. */
  private chromaA: SpriteHandle[] = [];
  private chromaB: SpriteHandle[] = [];

  private xs = new Float32Array(0);
  private ys = new Float32Array(0);
  private advances = new Float32Array(0);
  private spaceAdvance = FALLBACK_SPACE_ADVANCE;

  /** Tableau à UNE entrée, réutilisé : `drawSprite` en prend un, on n'en alloue pas par glyphe. */
  private readonly one: SpriteTransform[] = [{ x: 0, y: 0, scale: 0, alpha: 1 }];
  private readonly glyphMotion = createGlyphMotion();
  private readonly stripMotion = createStripMotion();
  private readonly cursorXs = new Float32Array(4);
  private readonly cursorYs = new Float32Array(4);

  private textColor: Color = { r: 255, g: 255, b: 255, a: 1 };
  private progress = 1;
  private impact = 0;
  private accent = 0;
  private tension = 0;
  private pulse = 0;
  private drift = 0;

  constructor(config: TextConfig = DEFAULT_TEXT_CONFIG) {
    this.config = config;
  }

  private param(key: string, fallback: number): number {
    const v = this.params[key];
    return typeof v === 'number' ? v : fallback;
  }

  init(ctx: LayerInitContext): void {
    this.base = [];
    this.strips = [];
    this.chromaA = [];
    this.chromaB = [];
    this.plan = planText(this.config.text, this.config.textCase);
    const count = this.plan.glyphs.length;
    if (count === 0) return;

    this.textColor = resolveTextColor(ctx.palette, this.config.color);
    this.xs = new Float32Array(count);
    this.ys = new Float32Array(count);
    this.advances = new Float32Array(count).fill(FALLBACK_ADVANCE);

    const size = spriteSideFor(count);
    const fontPx = size / SPRITE_EM;
    const font = `${this.config.weight} ${fontPx}px ${TEXT_FAMILIES[this.config.family]}`;
    // Mesures relevées PENDANT la construction des sprites, une fois par
    // caractère distinct. Le rappel de `createSprite` est le seul endroit où une
    // couche tient un contexte 2D : y mesurer évite d'ouvrir un canvas de plus
    // juste pour ça, et garantit que la mesure ne peut pas arriver par image.
    const advanceByChar = new Map<string, number>();

    const cache = new Map<string, SpriteHandle>();
    for (const glyph of this.plan.glyphs) {
      let sprite = cache.get(glyph.char);
      if (!sprite) {
        sprite = ctx.renderer.createSprite(
          (g) => paintGlyph(g, size, font, glyph.char, this.textColor, null, advanceByChar),
          size,
        );
        cache.set(glyph.char, sprite);
      }
      this.base.push(sprite);
    }

    if (usesStrips(this.config.animation)) {
      for (let k = 0; k < STRIP_COUNT; k++) {
        const stripCache = new Map<string, SpriteHandle>();
        const row: SpriteHandle[] = [];
        for (const glyph of this.plan.glyphs) {
          let sprite = stripCache.get(glyph.char);
          if (!sprite) {
            sprite = ctx.renderer.createSprite(
              (g) => paintGlyph(g, size, font, glyph.char, this.textColor, k, advanceByChar),
              size,
            );
            stripCache.set(glyph.char, sprite);
          }
          row.push(sprite);
        }
        this.strips.push(row);
      }
    }

    if (usesChroma(this.config.animation)) {
      this.chromaA = this.buildTinted(ctx.renderer, size, font, ctx.palette.accent, advanceByChar);
      this.chromaB = this.buildTinted(ctx.renderer, size, font, ctx.palette.primary, advanceByChar);
    }

    // Les mesures ne sont disponibles qu'APRÈS la construction : `createSprite`
    // exécute son rappel immédiatement dans le backend Canvas, mais pas dans le
    // double de test, où les valeurs de repli restent en place.
    for (let i = 0; i < count; i++) {
      const measured = advanceByChar.get(this.plan.glyphs[i]!.char);
      if (measured !== undefined && measured > 0) this.advances[i] = measured;
    }
    const space = advanceByChar.get(' ');
    this.spaceAdvance = space !== undefined && space > 0 ? space : FALLBACK_SPACE_ADVANCE;
  }

  private buildTinted(
    renderer: Renderer,
    size: number,
    font: string,
    color: Color,
    advanceByChar: Map<string, number>,
  ): SpriteHandle[] {
    const cache = new Map<string, SpriteHandle>();
    const out: SpriteHandle[] = [];
    for (const glyph of this.plan.glyphs) {
      let sprite = cache.get(glyph.char);
      if (!sprite) {
        sprite = renderer.createSprite((g) => paintGlyph(g, size, font, glyph.char, color, null, advanceByChar), size);
        cache.set(glyph.char, sprite);
      }
      out.push(sprite);
    }
    return out;
  }

  update(step: StepContext, signals: VisualSignals): void {
    this.impact = signals.impact;
    this.accent = signals.accent;
    this.tension = signals.tension;
    this.pulse = signals.pulse;
    // Dérive très lente, pour que le bloc ne soit pas rigoureusement figé.
    this.drift = (signals.lfoA - 0.5) * 0.012;

    // L'AVANCEMENT VIENT DE LA GRILLE MUSICALE, jamais d'un chronomètre (§7.6).
    // `bar.index + bar.phase` est une position en mesures, fonction pure du
    // temps : rejouer la même seconde redonne la même image (Loi 1).
    const bars = Math.max(0, step.bar.index + step.bar.phase);
    const every = this.config.everyBars;
    const local = every > 0 ? bars % every : bars;
    this.progress = Math.min(1, local / this.config.durationBars);
  }

  draw(renderer: Renderer, viewport: Viewport): void {
    const total = this.plan.glyphs.length;
    if (total === 0) return;
    const opacity = this.param('opacity', 1);
    if (opacity <= 0.002) return;

    const { fontNorm, count } = layoutInto(
      this.plan,
      this.advances,
      this.spaceAdvance,
      {
        layout: this.config.layout,
        aspect: viewport.aspect,
        safe: viewport.safe,
        sizeScale: this.param('size', 1),
        // `tension` DILATE le texte. C'est le signal le plus difficile à rendre
        // visible ailleurs (il n'a ni attaque ni retombée) et l'interlettrage lui
        // va bien : on le lit sans savoir qu'on le lit.
        tracking: TRACKING_BASE + this.tension * TRACKING_TENSION,
      },
      this.xs,
      this.ys,
    );
    if (count === 0 || fontNorm <= 0) return;

    const anim = this.config.animation;
    const spriteScale = fontNorm * SPRITE_EM * (1 + this.impact * KICK_SCALE);
    const split = chromaSplit(anim, this.progress) + this.accent * 0.05;
    const withStrips = usesStrips(anim) && this.strips.length > 0 && this.progress < 1;
    const tr = this.one[0]!;

    for (let i = 0; i < count; i++) {
      const glyph = this.plan.glyphs[i]!;
      evaluateGlyph(anim, this.progress, glyph.order, total, glyph.wordIndex, this.plan.wordCount, this.glyphMotion);
      const alpha = this.glyphMotion.alpha * opacity;
      if (alpha <= 0.002) continue;

      const x = this.xs[i]! + this.glyphMotion.dx * fontNorm + this.drift;
      const y = this.ys[i]! + this.glyphMotion.dy * fontNorm;
      const scale = spriteScale * this.glyphMotion.scale;

      if (withStrips) {
        for (let k = 0; k < STRIP_COUNT; k++) {
          evaluateStrip(anim, this.progress, k, STRIP_COUNT, this.stripMotion);
          if (this.stripMotion.alpha <= 0.002) continue;
          tr.x = x + this.stripMotion.dx * fontNorm;
          tr.y = y + this.stripMotion.dy * fontNorm;
          tr.scale = scale;
          tr.alpha = alpha * this.stripMotion.alpha;
          renderer.drawSprite(this.strips[k]![i]!, this.one, 1);
        }
        continue;
      }

      if (split > 0.001 && this.chromaA.length > 0) {
        tr.y = y;
        tr.scale = scale;
        tr.alpha = alpha * 0.7;
        tr.x = x + split * fontNorm;
        renderer.drawSprite(this.chromaA[i]!, this.one, 1);
        tr.x = x - split * fontNorm;
        renderer.drawSprite(this.chromaB[i]!, this.one, 1);
      }

      tr.x = x;
      tr.y = y;
      tr.scale = scale;
      tr.alpha = alpha;
      renderer.drawSprite(this.base[i]!, this.one, 1);
    }

    this.drawCursor(renderer, fontNorm, count, total, opacity);
  }

  /**
   * Curseur de la machine à écrire, en `fillPath` — un rectangle plein de
   * couleur unie, exactement ce que cette primitive sait faire.
   *
   * Il CLIGNOTE SUR LE BEAT, pas sur une horloge : `pulse` est une sinusoïde
   * calée sur le tempo. Un curseur au rythme du morceau plutôt qu'à 500 ms fixes
   * est la version musicale de l'effet, et elle ne coûte rien de plus.
   */
  private drawCursor(renderer: Renderer, fontNorm: number, count: number, total: number, opacity: number): void {
    const at = typewriterCursor(this.config.animation, this.progress, total);
    if (at < 0 || at >= count) return;
    if (this.pulse < 0.45) return;

    const w = CURSOR_WIDTH * fontNorm;
    const h = fontNorm * 0.72;
    const x = this.xs[at]! + this.advances[at]! * fontNorm * 0.5 + w;
    const y = this.ys[at]!;
    this.cursorXs[0] = x - w / 2;
    this.cursorYs[0] = y - h / 2;
    this.cursorXs[1] = x + w / 2;
    this.cursorYs[1] = y - h / 2;
    this.cursorXs[2] = x + w / 2;
    this.cursorYs[2] = y + h / 2;
    this.cursorXs[3] = x - w / 2;
    this.cursorYs[3] = y + h / 2;
    renderer.fillPath(this.cursorXs, this.cursorYs, 4, { ...this.textColor, a: opacity });
  }

  reset(_t: number): void {
    this.progress = 1;
  }

  dispose(): void {
    this.base = [];
    this.strips = [];
    this.chromaA = [];
    this.chromaB = [];
  }
}

/**
 * Côté du sprite, en pixels. Décroît avec le nombre de glyphes pour que la
 * mémoire totale reste bornée quel que soit le texte, et reste toujours dans
 * `[MIN_SPRITE, MAX_SPRITE]` : sous 96 les hampes deviennent baveuses, au-dessus
 * de 384 on paie une définition qu'aucun format d'export n'utilise.
 */
function spriteSideFor(glyphCount: number): number {
  const ideal = Math.sqrt(SPRITE_PIXEL_BUDGET / Math.max(1, glyphCount));
  return Math.round(Math.min(MAX_SPRITE, Math.max(MIN_SPRITE, ideal)));
}

/**
 * Couleur du texte : le rôle de palette choisi, PUIS le filet de contraste du
 * chantier 7 contre le fond.
 *
 * Le filet n'est pas une précaution de principe. Un texte en `secondary` sur une
 * palette sombre peut tomber sous 2:1 — techniquement dessiné, illisible en
 * pratique. C'est le même raisonnement que pour la palette extraite d'une
 * pochette : ce qui porte de l'information doit rester lisible, quelle que soit
 * la palette choisie par ailleurs.
 */
function resolveTextColor(palette: Palette, role: TextColorRole): Color {
  if (role === 'white') return { r: 245, g: 245, b: 250, a: 1 };
  const raw =
    role === 'accent'
      ? palette.accent
      : role === 'primary'
        ? palette.primary
        : role === 'secondary'
          ? palette.secondary
          : palette.glow;
  return ensureContrast(raw, palette.bg[1]);
}

/**
 * Peint un glyphe dans son sprite et relève son avance.
 *
 * `strip` non nul découpe une tranche horizontale : `clip()` est interdit aux
 * COUCHES, qui n'ont pas de contexte, mais `createSprite` en fournit un, hors
 * écran et hors boucle. Les tranches extrêmes sont étendues jusqu'aux bords du
 * carré pour ne perdre ni les hampes ni les jambages.
 */
function paintGlyph(
  ctx: OffscreenCanvasRenderingContext2D,
  size: number,
  font: string,
  char: string,
  color: Color,
  strip: number | null,
  advanceByChar: Map<string, number>,
): void {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (!advanceByChar.has(char)) {
    const fontPx = size / SPRITE_EM;
    advanceByChar.set(char, ctx.measureText(char).width / fontPx);
    if (!advanceByChar.has(' ')) advanceByChar.set(' ', ctx.measureText(' ').width / fontPx);
  }

  if (strip !== null) {
    const band = (size * STRIP_SPAN) / STRIP_COUNT;
    const top = strip === 0 ? 0 : size * ((1 - STRIP_SPAN) / 2) + strip * band;
    const bottom = strip === STRIP_COUNT - 1 ? size : size * ((1 - STRIP_SPAN) / 2) + (strip + 1) * band;
    ctx.beginPath();
    ctx.rect(0, top, size, bottom - top);
    ctx.clip();
  }

  ctx.fillStyle = `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
  ctx.fillText(char, size / 2, size / 2);
}
