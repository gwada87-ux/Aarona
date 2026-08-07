/**
 * `monolith` — trap, drill, phonk (docs/17_PHASE2_VISUELS.md §8, chantier 5).
 *
 * LE PRINCIPE : LA MASSE ET LE SILENCE
 * ------------------------------------
 * Le trap a d'énormes vides entre les frappes, et les frappes sont lourdes. Ce
 * style est donc presque immobile, puis violent. C'est l'exact inverse d'un
 * champ de particules : ce qui rend la fissure impressionnante, c'est
 * l'immobilité qui la précède. Toute tentation de « faire vivre » l'image entre
 * les kicks détruirait l'effet.
 *
 * ACCENT PRINCIPAL (§8) : la FISSURE, portée par le kick. Identifiable sur une
 * capture figée — c'est la seule chose lumineuse d'un cadre par ailleurs sombre.
 * Toutes les autres réactions restent sous 40 % de son amplitude.
 *
 * UN INSTRUMENT, UN CANAL
 * -----------------------
 * kick → largeur de la fissure · sub (continu) → travelling latéral de la masse
 * · caisse claire → bascule de l'éclairage d'une face à l'autre · charley →
 * étincelles le long des arêtes · anticipation → lueur qui monte dans la faille
 * avant qu'elle ne s'ouvre · LFO → frémissement très lent des facettes.
 *
 * CE QUE L'API DE RENDU IMPOSE
 * ----------------------------
 * `fillPath` ne prend qu'une couleur PLATE : aucun dégradé par forme. Le volume
 * vient donc du découpage en facettes de valeurs différentes, pas d'un ombrage.
 * Et la lueur intérieure de la faille est un SPRITE radial pré-rendu, placé
 * plusieurs fois le long de la fissure — la seule façon d'obtenir un bord doux
 * avec cette interface.
 *
 * DÉTERMINISME (Loi 1)
 * --------------------
 * La forme de la fissure dépend de l'index de temps par HACHAGE, jamais de
 * `step.rng`. Deux raisons : `step.rng` est partagé par toutes les couches d'une
 * scène, donc y puiser décale les tirages des autres ; et un hachage se
 * recalcule à l'identique après un seek, sans avoir à rejouer quoi que ce soit.
 */

import type { Color, Renderer, SpriteHandle, SpriteTransform } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import { NO_SAFE_AREA, safeRect } from '../../../render/safeArea';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import { hash } from '../../../core/rng/hash';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import { lerpColor, type Palette } from '../../palette/Palette';

/** Facettes verticales de la face avant. Assez pour lire un volume, pas assez pour coûter. */
const FACETS = 7;
/** Sommets de la ligne de fissure. Impair : le point d'impact tombe sur un sommet. */
const FISSURE_POINTS = 11;
/** Étincelles d'arête au maximum. */
const MAX_SPARKS = 18;
const SPARK_SPRITE_SIZE = 32;
const GLOW_SPRITE_SIZE = 64;
/** Lueurs posées le long de la faille. */
const GLOW_STAMPS = 7;

/** Hauteur de la masse, en fraction du petit côté. Deux tiers du cadre (§8). */
const MASS_HEIGHT = 0.66;
/** Demi-largeur de la masse au pied. */
const MASS_HALF_WIDTH = 0.3;
/** Rétrécissement au sommet — c'est lui qui donne la fausse perspective. */
const TOP_NARROW = 0.72;
/** Décentrage horizontal, en fraction du petit côté. Jamais centré (§8, §3.6). */
const MASS_OFFSET_X = -0.12;
/** Amplitude du travelling piloté par le sub. */
const SUB_TRAVEL = 0.05;
/** Largeur maximale de la fissure. */
const FISSURE_MAX_WIDTH = 0.055;
/** Amplitude du frémissement de facette piloté par LFO. Volontairement minuscule. */
const FACET_SHIMMER = 0.06;

export class MonolithMass implements Layer {
  readonly id = 'monolithMass';
  readonly kind: LayerKind = 'geometry';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private palette!: Palette;
  private glowSprite!: SpriteHandle;
  private sparkSprite!: SpriteHandle;

  // Tampons pré-alloués : aucune allocation dans `update`/`draw` (CLAUDE.md).
  private readonly quadX = new Float32Array(4);
  private readonly quadY = new Float32Array(4);
  private readonly fissureX = new Float32Array(FISSURE_POINTS);
  private readonly fissureY = new Float32Array(FISSURE_POINTS);
  private readonly lipX = new Float32Array(FISSURE_POINTS * 2);
  private readonly lipY = new Float32Array(FISSURE_POINTS * 2);
  private readonly glowTransforms: SpriteTransform[] = Array.from({ length: GLOW_STAMPS }, () => ({
    x: 0,
    y: 0,
    scale: 0,
    alpha: 0,
  }));
  private readonly sparkTransforms: SpriteTransform[] = Array.from({ length: MAX_SPARKS }, () => ({
    x: 0,
    y: 0,
    scale: 0,
    alpha: 0,
  }));

  /** Lecture d'un `layer.params` avec repli — même contrat que les autres couches. */
  private param(key: string, fallback: number): number {
    const v = this.params[key];
    return typeof v === 'number' ? v : fallback;
  }

  private impact = 0;
  private weight = 0;
  private accent = 0;
  private tick = 0;
  private tension = 0;
  private shimmer = 0.5;
  private beatIndex = 0;

  init(ctx: LayerInitContext): void {
    this.palette = ctx.palette;
    const glow = ctx.palette.glow;
    this.glowSprite = ctx.renderer.createSprite((c) => radial(c, GLOW_SPRITE_SIZE, glow), GLOW_SPRITE_SIZE);
    const spark = ctx.palette.accent;
    this.sparkSprite = ctx.renderer.createSprite((c) => radial(c, SPARK_SPRITE_SIZE, spark), SPARK_SPRITE_SIZE);
  }

  update(step: StepContext, signals: VisualSignals): void {
    this.impact = signals.impact;
    this.weight = signals.weight;
    this.accent = signals.accent;
    this.tick = signals.tick;
    this.tension = signals.tension;
    this.shimmer = signals.lfoC;
    this.beatIndex = step.beat.index;
  }

  draw(renderer: Renderer, viewport: Viewport): void {
    // Bornes du cadre sans embranchement par ratio (Loi 4) : `safeRect` porte
    // l'unique conversion, et elle est testée.
    const frame = safeRect(viewport.aspect, NO_SAFE_AREA);
    // TRAVELLING latéral, continu, piloté par le sub. Borné au cadre pour que
    // la masse ne sorte jamais en 9:16, où la largeur disponible est minimale.
    const travel = (this.weight - 0.5) * 2 * this.param('travel', SUB_TRAVEL);
    const cx = clampToFrame(MASS_OFFSET_X + travel, frame.left + MASS_HALF_WIDTH, frame.right - MASS_HALF_WIDTH);
    const bottom = frame.bottom + (frame.top - frame.bottom) * 0.12;
    const top = bottom + MASS_HEIGHT;

    this.drawFacets(renderer, cx, bottom, top);
    this.drawFissure(renderer, cx, bottom, top);
    this.drawSparks(renderer, cx, bottom, top);
  }

  /**
   * Face avant en facettes verticales. Le volume vient de l'ÉCART DE VALEUR
   * entre facettes voisines, pas d'un dégradé — `fillPath` n'en accepte pas.
   *
   * La CAISSE CLAIRE fait basculer l'éclairage : la rampe de valeurs s'inverse
   * de gauche à droite, comme si la source lumineuse changeait de côté. Un
   * changement de forme aurait concurrencé la fissure ; un changement
   * d'éclairage se lit sans lui voler la vedette.
   */
  private drawFacets(renderer: Renderer, cx: number, bottom: number, top: number): void {
    const flip = this.accent;
    for (let i = 0; i < FACETS; i++) {
      const t0 = i / FACETS;
      const t1 = (i + 1) / FACETS;
      // Position latérale des facettes, resserrées vers le sommet.
      const x0b = cx + (t0 * 2 - 1) * MASS_HALF_WIDTH;
      const x1b = cx + (t1 * 2 - 1) * MASS_HALF_WIDTH;
      const narrow = this.param('topNarrow', TOP_NARROW);
      const x0t = cx + (t0 * 2 - 1) * MASS_HALF_WIDTH * narrow;
      const x1t = cx + (t1 * 2 - 1) * MASS_HALF_WIDTH * narrow;

      this.quadX[0] = x0b;
      this.quadY[0] = bottom;
      this.quadX[1] = x1b;
      this.quadY[1] = bottom;
      this.quadX[2] = x1t;
      this.quadY[2] = top;
      this.quadX[3] = x0t;
      this.quadY[3] = top;

      // Rampe de valeurs, inversée par la caisse claire.
      const ramp = (t0 + t1) / 2;
      const lit = flip > 0.02 ? ramp * (1 - flip) + (1 - ramp) * flip : ramp;
      // Frémissement de facette : microscopique, il empêche seulement la masse
      // de paraître peinte. Au-delà de quelques pour cent, elle se met à
      // scintiller et perd tout son poids.
      const shim = (this.shimmer - 0.5) * FACET_SHIMMER * (i % 2 === 0 ? 1 : -1);
      const value = clamp01(0.18 + lit * 0.5 + shim);
      renderer.fillPath(this.quadX, this.quadY, 4, lerpColor(this.palette.bg[1], this.palette.secondary, value));
    }
  }

  /**
   * LA FISSURE — l'accent principal.
   *
   * Elle n'ouvre pas la géométrie : elle est dessinée PAR-DESSUS, en polygone,
   * ce qui donne exactement la même image qu'un découpage booléen pour une
   * fraction du coût. Sa forme est hachée sur l'index de temps, donc stable
   * pour un temps donné et différente d'un temps à l'autre.
   */
  private drawFissure(renderer: Renderer, cx: number, bottom: number, top: number): void {
    // La lueur MONTE avant que la fissure ne s'ouvre : l'anticipation du drop
    // précharge la faille, ce qui donne à voir la montée sans rien déclencher.
    const width = (this.impact * FISSURE_MAX_WIDTH + this.tension * FISSURE_MAX_WIDTH * 0.25) || 0;
    if (width < 1e-4) return;

    const seed = hash(0x4d4f4e, this.beatIndex);
    for (let i = 0; i < FISSURE_POINTS; i++) {
      const t = i / (FISSURE_POINTS - 1);
      // Lacet horizontal déterministe. `hash` par sommet : aucune consommation
      // de `step.rng`, donc aucun décalage des tirages des autres couches.
      const jitter = (hash(seed, i) / 0xffffffff - 0.5) * MASS_HALF_WIDTH * this.param('fissureChaos', 0.55);
      // Resserrement aux extrémités : une faille qui traverse tout le bloc de
      // bord à bord se lit comme un trait, pas comme une cassure.
      const pinch = Math.sin(t * Math.PI);
      this.fissureX[i] = cx + jitter * pinch;
      this.fissureY[i] = bottom + (top - bottom) * t;
    }

    // Polygone des deux lèvres : aller par la gauche, retour par la droite.
    for (let i = 0; i < FISSURE_POINTS; i++) {
      const t = i / (FISSURE_POINTS - 1);
      const half = width * Math.sin(t * Math.PI) * 0.5;
      this.lipX[i] = this.fissureX[i]! - half;
      this.lipY[i] = this.fissureY[i]!;
      const j = FISSURE_POINTS * 2 - 1 - i;
      this.lipX[j] = this.fissureX[i]! + half;
      this.lipY[j] = this.fissureY[i]!;
    }
    renderer.fillPath(this.lipX, this.lipY, FISSURE_POINTS * 2, this.palette.accent);

    // Lueur intérieure : sprites radiaux le long de la faille. C'est la seule
    // façon d'obtenir un bord doux — l'interface n'offre aucun dégradé de forme.
    const stampScale = width * 6;
    for (let s = 0; s < GLOW_STAMPS; s++) {
      const idx = Math.round((s / (GLOW_STAMPS - 1)) * (FISSURE_POINTS - 1));
      const t = idx / (FISSURE_POINTS - 1);
      const tr = this.glowTransforms[s]!;
      tr.x = this.fissureX[idx]!;
      tr.y = this.fissureY[idx]!;
      tr.scale = stampScale * (0.5 + Math.sin(t * Math.PI) * 0.5);
      tr.alpha = Math.min(1, (this.impact * 0.8 + this.tension * 0.2) * this.param('glowMul', 1));
    }
    renderer.drawSprite(this.glowSprite, this.glowTransforms, GLOW_STAMPS);
  }

  /**
   * Étincelles d'arête, portées par le CHARLEY. Plafonnées à 40 % de
   * l'amplitude de l'accent principal (§8) — un charley qui brillerait autant
   * que la fissure ferait perdre au kick son statut d'événement.
   */
  private drawSparks(renderer: Renderer, cx: number, bottom: number, top: number): void {
    if (this.tick < 0.02) return;
    const count = Math.min(MAX_SPARKS, 6 + Math.round(this.tick * 12));
    for (let i = 0; i < count; i++) {
      const h = hash(0x53504b, i + this.beatIndex * 31);
      const t = (h / 0xffffffff);
      // Réparties sur les deux arêtes verticales, alternativement.
      const side = i % 2 === 0 ? -1 : 1;
      const edgeT = t;
      const halfAt = MASS_HALF_WIDTH * (1 - edgeT * (1 - TOP_NARROW));
      const tr = this.sparkTransforms[i]!;
      tr.x = cx + side * halfAt;
      tr.y = bottom + (top - bottom) * edgeT;
      tr.scale = 0.012 + this.tick * 0.01;
      tr.alpha = this.tick * 0.4;
    }
    renderer.drawSprite(this.sparkSprite, this.sparkTransforms, count);
  }

  reset(_t: number): void {
    // Rien à restaurer : tout est recalculé depuis les signaux et l'index de
    // temps au prochain `update`.
  }

  dispose(): void {}
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampToFrame(x: number, lo: number, hi: number): number {
  // Cadre plus étroit que la masse (9:16 très serré) : on recentre plutôt que
  // d'inverser les bornes, ce qui produirait un placement absurde.
  if (lo > hi) return (lo + hi) / 2;
  return x < lo ? lo : x > hi ? hi : x;
}

function radial(ctx: OffscreenCanvasRenderingContext2D, size: number, color: Color): void {
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 1)`);
  g.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}
