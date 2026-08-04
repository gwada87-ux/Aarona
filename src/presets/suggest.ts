/**
 * Suggestion automatique de preset (docs/08_PRESETS.md §"Adaptation
 * automatique au morceau") — « pas de la classification de genre [...] un
 * bon point de départ » : score les presets du catalogue sur 3 critères
 * pondérés à parts égales (docs/08 ne chiffre pas de pondération pour ces 4
 * étapes, contrairement à l'arbitrage ×2/÷2 du tempo en docs/05 §1 — poids
 * égaux retenus faute d'autre donnée), après un filtre dur sur la 4e étape.
 */
import type { PmdiDocument } from '../music/pmdi';
import type { Preset } from './schema';

/** Étape 4 (docs/08) : « propose d'office un preset à régime continu » sous ce seuil de confiance de grille. */
const GRID_CONFIDENCE_CONTINUOUS_THRESHOLD = 0.6;

const CRITERION_WEIGHT = 1 / 3;

/**
 * Référence de normalisation pour la densité d'onsets (étape 3), auto-choisie
 * faute de genre réellement "dense" dans le catalogue MVP (Jersey/Hyperpop
 * sont V2, docs/08) : ~8 onsets/s correspond à des doubles-croches à 240 BPM.
 */
const ONSET_DENSITY_REFERENCE_PER_SEC = 8;

export interface SuggestResult {
  readonly preset: Preset;
  readonly score: number; // 0..1
  readonly reason: string;
}

function inRange(bpm: number, [lo, hi]: readonly [number, number]): boolean {
  return bpm >= lo && bpm <= hi;
}

/** Étape 1 : le tempo détecté — ou son double/moitié si `doubleTimeHint`, ou l'alternative ×2/÷2 déjà conservée par l'analyse (docs/05 §1) — tombe dans la plage du genre. */
function tempoScore(doc: PmdiDocument, hint: Preset['genre']): number {
  const bpm = doc.tempo.global;
  const candidates = [bpm];
  if (hint.doubleTimeHint) candidates.push(bpm * 2, bpm / 2);
  if (doc.tempo.alternate !== undefined) candidates.push(doc.tempo.alternate);
  return candidates.some((c) => inRange(c, hint.tempoHint)) ? 1 : 0;
}

function averageFeature(doc: PmdiDocument, id: string): number {
  const track = doc.features?.find((f) => f.id === id);
  if (!track || track.data.length === 0) return 0;
  let sum = 0;
  for (const v of track.data) sum += v;
  return sum / track.data.length;
}

/** Étape 2 : grave (`sub`+`bass`) contre médium/aigu (`himid`+`high`) — même échelle 0..1 que `genre.subDominance`. */
function computeSubDominance(doc: PmdiDocument): number {
  const low = averageFeature(doc, 'band.sub') + averageFeature(doc, 'band.bass');
  const high = averageFeature(doc, 'band.himid') + averageFeature(doc, 'band.high');
  const total = low + high;
  return total > 0 ? low / total : 0.5;
}

/** Étape 3 : densité d'événements ponctuels (sans `dur` — exclut DROP/BUILDUP/BREAK/SILENCE), normalisée. */
function computeOnsetDensity(doc: PmdiDocument): number {
  const pointEvents = doc.events.filter((e) => e.dur === undefined);
  const perSec = doc.audio.duration > 0 ? pointEvents.length / doc.audio.duration : 0;
  return Math.max(0, Math.min(1, perSec / ONSET_DENSITY_REFERENCE_PER_SEC));
}

/**
 * Propose un preset du catalogue, jamais imposé (docs/08). `null` seulement
 * si le catalogue est vide. Fonction PURE, ne lit que `doc` — pas d'accès à
 * `MusicTimeline` (Mode A ou Mode B, indifféremment, comme `finalize.ts`).
 */
export function suggestPreset(doc: PmdiDocument, catalog: readonly Preset[]): SuggestResult | null {
  if (catalog.length === 0) return null;

  const gridLow = doc.confidence.grid < GRID_CONFIDENCE_CONTINUOUS_THRESHOLD;
  const continuousCandidates = catalog.filter((p) => p.genre.continuousRegimePreference);
  const candidates = gridLow && continuousCandidates.length > 0 ? continuousCandidates : catalog;

  const subDominance = computeSubDominance(doc);
  const onsetDensity = computeOnsetDensity(doc);

  let best: { preset: Preset; score: number } | null = null;
  for (const preset of candidates) {
    const tempo = tempoScore(doc, preset.genre);
    const spectral = 1 - Math.abs(subDominance - preset.genre.subDominance);
    const density = 1 - Math.abs(onsetDensity - preset.genre.onsetDensity);
    const score = CRITERION_WEIGHT * (tempo + spectral + density);
    if (!best || score > best.score) best = { preset, score };
  }
  if (!best) return null;

  const reasonParts = [`tempo ${doc.tempo.global.toFixed(0)} BPM`, `profil ${subDominance >= 0.5 ? 'grave' : 'médium'}`];
  if (gridLow) reasonParts.push('grille peu fiable → régime continu');
  return { preset: best.preset, score: best.score, reason: `suggéré d'après l'analyse (${reasonParts.join(', ')})` };
}
