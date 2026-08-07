/**
 * Correction manuelle de l'analyse (docs/17_PHASE2_VISUELS.md §7.8, chantier 10
 * lot E).
 *
 * §7.8 : « L'analyse se trompera parfois : un downbeat décalé, un drop manqué,
 * une section mal découpée. Aujourd'hui l'utilisateur n'a aucun recours. [...]
 * Loi 3 le rend d'autant plus utile : les morceaux à faible confiance sont
 * exactement ceux qu'il faut pouvoir rattraper. »
 *
 * UNE TRANSFORMATION DU DOCUMENT, PAS UN ÉTAGE DE PLUS
 * ----------------------------------------------------
 * Les corrections produisent un `PmdiDocument` corrigé, que
 * `buildMusicTimeline` consomme comme n'importe quel autre. Rien en aval ne sait
 * qu'une correction existe : ni la timeline, ni les signaux, ni les couches, ni
 * l'export. C'était la seule façon d'éviter un « et si c'est corrigé ? » à
 * chaque lecture de la grille — et c'est aussi ce qui garantit que l'aperçu et
 * l'export voient exactement le même morceau.
 *
 * Fonction PURE : `doc` n'est jamais muté, un document corrigé deux fois de la
 * même façon est identique. La Loi 1 tient sans précaution supplémentaire.
 */

import type { MusicEvent, PmdiDocument, Section } from './pmdi';

/** Type d'événement posé par « marquer un drop ». */
export const MANUAL_DROP_TYPE = 'DROP';

export interface AnalysisCorrections {
  /**
   * Décalage de la GRILLE en secondes, positif ou négatif.
   *
   * Décale les cartes de tempo et de mesure, JAMAIS les événements : quand la
   * grille est fausse, ce sont les temps qui tombent à côté, pas les frappes.
   * Les onsets viennent du signal audio et sont, eux, à leur place.
   */
  readonly gridOffsetSec: number;
  /** Instants où l'utilisateur a marqué un drop, en secondes. */
  readonly drops: readonly number[];
  /**
   * Frontières de section déplacées : index de la section dans l'ordre
   * chronologique d'origine, vers son nouvel instant de début.
   *
   * Par INDEX et non par identifiant : une `Section` de PMDI n'en a pas, et en
   * inventer un obligerait à le faire voyager dans le document.
   */
  readonly sectionStarts: Readonly<Record<number, number>>;
}

export const NO_CORRECTIONS: AnalysisCorrections = Object.freeze({
  gridOffsetSec: 0,
  drops: Object.freeze([]),
  sectionStarts: Object.freeze({}),
});

/** `true` si les corrections ne changeraient rien — court-circuit de `applyCorrections`. */
export function isNeutral(c: AnalysisCorrections): boolean {
  return c.gridOffsetSec === 0 && c.drops.length === 0 && Object.keys(c.sectionStarts).length === 0;
}

/** Tolérance de « le drop le plus proche », en secondes. */
export const DROP_SNAP_SEC = 0.4;

export function addDrop(c: AnalysisCorrections, t: number): AnalysisCorrections {
  const kept = c.drops.filter((d) => Math.abs(d - t) > DROP_SNAP_SEC);
  return { ...c, drops: [...kept, t].sort((a, b) => a - b) };
}

export function removeDropNear(c: AnalysisCorrections, t: number): AnalysisCorrections {
  return { ...c, drops: c.drops.filter((d) => Math.abs(d - t) > DROP_SNAP_SEC) };
}

export function moveSectionStart(c: AnalysisCorrections, index: number, t: number): AnalysisCorrections {
  return { ...c, sectionStarts: { ...c.sectionStarts, [index]: t } };
}

/**
 * Applique les corrections et rend un nouveau document.
 *
 * Retourne `doc` TEL QUEL quand il n'y a rien à corriger : le cas courant ne
 * doit pas recopier un document de plusieurs mégaoctets à chaque chargement, et
 * l'identité d'objet permet aux appelants de comparer sans deviner.
 */
export function applyCorrections(doc: PmdiDocument, c: AnalysisCorrections): PmdiDocument {
  if (isNeutral(c)) return doc;

  const d = c.gridOffsetSec;
  const tempo =
    d === 0 ? doc.tempo : { ...doc.tempo, map: doc.tempo.map.map((p) => ({ ...p, t: Math.max(0, p.t + d) })) };
  const meter =
    d === 0 ? doc.meter : { ...doc.meter, map: doc.meter.map.map((p) => ({ ...p, t: Math.max(0, p.t + d) })) };

  // Les drops manuels sont des ÉVÉNEMENTS ordinaires : `anticipate:DROP` les
  // trouve sans rien savoir de leur origine, et `tension` monte donc devant eux
  // exactement comme devant un drop détecté. Aucun code de signal à toucher.
  let events: readonly MusicEvent[] = doc.events;
  if (c.drops.length > 0) {
    // `confidence: 1` — c'est un humain qui l'a posé, il n'y a rien de plus
    // certain dans tout le document.
    const manual: MusicEvent[] = c.drops.map((t) => ({ t, type: MANUAL_DROP_TYPE, intensity: 1, confidence: 1 }));
    events = [...doc.events, ...manual].sort((a, b) => a.t - b.t);
  }

  let sections: readonly Section[] | undefined = doc.sections;
  const moved = Object.keys(c.sectionStarts);
  if (sections && moved.length > 0) {
    const next = sections.map((s, i) => {
      const t = c.sectionStarts[i];
      return t === undefined ? s : { ...s, t };
    });
    // RETRIÉES : déplacer une frontière peut la faire passer devant la
    // précédente, et tout ce qui lit `sections()` suppose l'ordre chronologique.
    sections = next.slice().sort((a, b) => a.t - b.t);
  }

  // `events`/`sections` sont mutables dans `PmdiDocument` (forme JSON brute) :
  // on recopie plutôt que de leur imposer un `readonly` qui n'y est pas.
  return { ...doc, tempo, meter, events: [...events], ...(sections ? { sections: [...sections] } : {}) };
}

/**
 * Remet en forme des corrections venues d'un projet.
 *
 * Même règle qu'au lot B : une valeur illisible remet le réglage à zéro, elle ne
 * fait jamais échouer l'ouverture.
 */
export function normaliseCorrections(value: unknown): AnalysisCorrections {
  if (typeof value !== 'object' || value === null) return NO_CORRECTIONS;
  const raw = value as { gridOffsetSec?: unknown; drops?: unknown; sectionStarts?: unknown };
  const gridOffsetSec = Number.isFinite(raw.gridOffsetSec) ? (raw.gridOffsetSec as number) : 0;
  const drops = Array.isArray(raw.drops)
    ? raw.drops.filter((t): t is number => Number.isFinite(t)).sort((a, b) => a - b)
    : [];
  const sectionStarts: Record<number, number> = {};
  if (typeof raw.sectionStarts === 'object' && raw.sectionStarts !== null) {
    for (const [k, v] of Object.entries(raw.sectionStarts as Record<string, unknown>)) {
      const index = Number(k);
      if (Number.isInteger(index) && index >= 0 && Number.isFinite(v)) sectionStarts[index] = v as number;
    }
  }
  return { gridOffsetSec, drops, sectionStarts };
}
