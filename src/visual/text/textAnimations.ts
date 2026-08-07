/**
 * Bibliothèque d'animations de texte (docs/17_PHASE2_VISUELS.md §7.6, chantier
 * 8).
 *
 * §7.6 : « chaque animation calée sur la grille musicale, pas sur une durée en
 * secondes. C'est ce que CapCut ne sait pas faire. » Ce module ne connaît donc
 * QUE `progress`, une fraction 0..1 que la couche calcule depuis la position en
 * mesures. Aucune seconde n'entre ici, et aucune horloge non plus : ce sont des
 * fonctions pures d'un scalaire, ce qui les rend testables sans rendu et
 * conformes à la Loi 1 par construction.
 *
 * L'INVARIANT QUI COMPTE : À `progress === 1`, TOUT REVIENT À L'IDENTITÉ
 * ---------------------------------------------------------------------
 * Une animation qui laisserait un décalage résiduel donnerait un texte
 * légèrement de travers, en permanence, sans que rien ne bouge à l'écran pour
 * l'expliquer. Le symptôme serait attribué à la mise en page, pas à l'animation.
 * Un test le vérifie sur les sept entrées.
 *
 * CE QUE L'INTERFACE `Renderer` A IMPOSÉ
 * --------------------------------------
 * Il n'y a pas de `clip()`, donc pas de masque animé (§4). Les deux animations
 * qui en demandent un - « révélation par masque » et « découpe en tranches » -
 * sont obtenues en rastérisant chaque glyphe en TRANCHES horizontales, chacune
 * un sprite à part, découpée dans le `createSprite` où `clip()` est licite. Les
 * tranches se déplacent alors indépendamment. Voir `TextLayer`.
 *
 * Aucune de ces fonctions n'alloue et aucune ne tire de nombre aléatoire : le
 * sens de départ des tranches vient de la PARITÉ de leur index, ce qui évite de
 * toucher `step.rng` - partagé entre couches, donc impossible à consommer sans
 * décaler toutes les autres.
 */

import { MAX_OVERSHOOT, easeOutCubic, easeOutQuint, overshootLobe } from '../../core/math/easing';
import type { TextAnimationId } from './textConfig';

/** Transformation d'UN glyphe. Champs mutables : l'objet est réutilisé chaque image. */
export interface GlyphMotion {
  /** Décalage horizontal, en multiples de la taille de police. */
  dx: number;
  dy: number;
  scale: number;
  alpha: number;
}

/** Transformation d'UNE tranche horizontale. Même convention. */
export interface StripMotion {
  dx: number;
  dy: number;
  alpha: number;
}

export function createGlyphMotion(): GlyphMotion {
  return { dx: 0, dy: 0, scale: 1, alpha: 1 };
}

export function createStripMotion(): StripMotion {
  return { dx: 0, dy: 0, alpha: 1 };
}

/** Fraction de `progress` consommée par l'étalement mot à mot. */
const WORD_SPREAD = 0.55;
/** Idem pour les tranches. */
const STRIP_SPREAD = 0.4;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** `true` si l'animation a besoin de la décomposition en tranches. */
export function usesStrips(id: TextAnimationId): boolean {
  return id === 'reveal' || id === 'slice';
}

/** `true` si l'animation a besoin des deux copies colorées du décalage RVB. */
export function usesChroma(id: TextAnimationId): boolean {
  return id === 'rgb';
}

/**
 * Écart des copies chromatiques, en multiples de la taille de police.
 *
 * Séparé de `evaluateGlyph` : il ne dépend ni du glyphe ni de la tranche, et le
 * recalculer par glyphe serait du travail pur perte.
 */
export function chromaSplit(id: TextAnimationId, progress: number): number {
  if (id !== 'rgb') return 0;
  return (1 - easeOutCubic(clamp01(progress))) * 0.2;
}

/**
 * Index du dernier glyphe déjà « tapé » par la machine à écrire, ou -1.
 * Sert à placer le curseur, dessiné en `fillPath` par la couche.
 */
export function typewriterCursor(id: TextAnimationId, progress: number, count: number): number {
  if (id !== 'typewriter' || count === 0 || progress >= 1) return -1;
  return Math.min(count - 1, Math.floor(clamp01(progress) * count));
}

/**
 * Transformation du glyphe `order` (sur `count`), appartenant au mot `wordIndex`
 * (sur `wordCount`). Écrit dans `out` — aucune allocation.
 */
export function evaluateGlyph(
  id: TextAnimationId,
  progress: number,
  order: number,
  count: number,
  wordIndex: number,
  wordCount: number,
  out: GlyphMotion,
): void {
  out.dx = 0;
  out.dy = 0;
  out.scale = 1;
  out.alpha = 1;
  const p = clamp01(progress);
  if (p >= 1 || id === 'none') return;

  switch (id) {
    case 'word': {
      // Chaque mot part à son tour, sur la première moitié de la fenêtre ; le
      // reste sert à laisser le DERNIER mot finir son mouvement. Sans cette
      // réserve, le dernier mot arriverait pile à `progress = 1`, c'est-à-dire
      // sans jamais être vu en mouvement.
      const start = wordCount > 1 ? (wordIndex / wordCount) * WORD_SPREAD : 0;
      const local = clamp01((p - start) / (1 - WORD_SPREAD));
      const e = easeOutQuint(local);
      out.alpha = e;
      out.dy = (e - 1) * 0.4;
      out.scale = 1 + overshootLobe(local, MAX_OVERSHOOT);
      return;
    }
    case 'typewriter': {
      // Apparition FRANCHE : un fondu long ferait lire « les lettres
      // s'estompent », pas « on tape ». Le fondu ne dure qu'un demi-caractère.
      const at = count > 0 ? order / count : 0;
      out.alpha = clamp01((p - at) * count * 2);
      return;
    }
    case 'reveal': {
      // Le mouvement est PORTÉ PAR LES TRANCHES (voir `evaluateStrip`) : le
      // glyphe lui-même ne bouge pas, sinon les deux se composeraient et la
      // bande cesserait de paraître fixe pendant qu'elle s'ouvre.
      return;
    }
    case 'scale': {
      const e = easeOutQuint(p);
      out.scale = 0.35 + 0.65 * e + overshootLobe(p, 0.12);
      out.alpha = easeOutCubic(clamp01(p * 3));
      return;
    }
    case 'rgb': {
      // La base reste en place : ce sont les copies colorées qui s'écartent,
      // et l'écart vient de `chromaSplit`.
      out.alpha = easeOutCubic(clamp01(p * 2));
      return;
    }
    case 'slice': {
      out.alpha = 1;
      return;
    }
  }
}

/**
 * Transformation de la tranche `strip` (sur `stripCount`). Sans objet pour les
 * animations dont `usesStrips` est faux — la couche ne l'appelle pas.
 */
export function evaluateStrip(
  id: TextAnimationId,
  progress: number,
  strip: number,
  stripCount: number,
  out: StripMotion,
): void {
  out.dx = 0;
  out.dy = 0;
  out.alpha = 1;
  const p = clamp01(progress);
  if (p >= 1 || stripCount <= 0) return;

  if (id === 'reveal') {
    // La bande s'ouvre DEPUIS LE CENTRE : la tranche centrale part la première,
    // les extrêmes en dernier. C'est ce qui donne le geste de rideau qui
    // s'écarte plutôt qu'un simple balayage de haut en bas.
    const centre = (stripCount - 1) / 2;
    const distance = stripCount > 1 ? Math.abs(strip - centre) / centre : 0;
    const local = clamp01((p - distance * STRIP_SPREAD) / (1 - STRIP_SPREAD));
    const e = easeOutCubic(local);
    out.alpha = e;
    // Chaque tranche vient de SON côté : la tranche du haut descend, celle du
    // bas monte. Une tranche centrale ne bouge pas, son `distance` étant nul.
    out.dy = (1 - e) * (strip < centre ? 0.12 : -0.12) * distance;
    return;
  }

  if (id === 'slice') {
    // Sens alterné par PARITÉ, jamais tiré au sort : `step.rng` est partagé
    // entre les couches, et en consommer décalerait toutes les autres.
    const direction = strip % 2 === 0 ? 1 : -1;
    const local = clamp01((p - (strip / stripCount) * STRIP_SPREAD) / (1 - STRIP_SPREAD));
    const e = easeOutQuint(local);
    out.dx = (1 - e) * direction * 0.85;
    out.alpha = easeOutCubic(clamp01(local * 1.8));
    return;
  }
}
