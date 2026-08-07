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
 * Référence de normalisation pour la densité d'onsets (étape 3) : le nombre
 * d'onsets par seconde qui vaut 1 sur l'échelle 0..1 de `genre.onsetDensity`.
 *
 * RECALIBRÉE de 8 à 16 après mesure (post-phase 2). La valeur de 8 avait été
 * choisie « faute de genre réellement dense dans le catalogue MVP » — vrai à
 * cinq presets, faux à onze depuis le chantier 9, où `techno`, `drill` et
 * `afro` déclarent des densités de 0,70 à 0,80.
 *
 * Ce qui l'a tranchée : **le document de démonstration produit 7,55 onsets par
 * seconde**, soit une densité normalisée de **0,94** avec l'ancienne référence.
 * Un motif ordinaire — kick à la noire, caisse claire aux temps 2 et 4,
 * charley à la croche, 120 BPM — saturait donc le critère, qui cessait de
 * discriminer quoi que ce soit au-dessus. Il suggérait `house` sur la démo, à
 * 0,88, pour cette seule raison.
 *
 * 16 remet les onze profils dans des valeurs qui se lisent en musique :
 *
 * | preset    | densité | onsets/s visés |
 * |-----------|---------|----------------|
 * | `ambient` | 0,08    | 1,3 — quelques frappes par mesure |
 * | `lofi`    | 0,25    | 4,0 — kick, caisse, charley à 80 BPM |
 * | `trap-dark` | 0,55  | 8,8 — plus les roulements de charley |
 * | `techno`  | 0,80    | 12,8 — doubles-croches à 130 BPM plus percussions |
 *
 * Avec 8, `techno` visait 6,4 onsets/s et `lofi` 2 : deux valeurs qu'aucun
 * morceau du genre ne produit.
 */
const ONSET_DENSITY_REFERENCE_PER_SEC = 16;

/**
 * Écart de score en dessous duquel le second candidat est jugé AUSSI PLAUSIBLE
 * que le premier.
 *
 * Mesuré, post-phase 2 : sur 440 morceaux synthétiques tirés autour des profils
 * déclarés, le bon preset ressort 83 % du temps, et les échecs se concentrent
 * sur des genres réellement voisins — `drill` contre `phonk` contre
 * `trap-dark`, tous entre 130 et 160 BPM avec un grave dominant et une
 * percussion dense ; `edm` contre `house` contre `techno`, tous entre 118 et
 * 140. Trois scalaires ne les séparent pas, et aucun réglage de constante n'y
 * changera rien : ils décrivent la même musique.
 *
 * docs/08 dit que la suggestion est « un bon point de départ », pas de la
 * classification de genre. Plutôt que de trancher au hasard entre deux
 * candidats à 0,001 près — le vainqueur était jusqu'ici le premier du catalogue,
 * ce qui n'est pas une raison —, elle le DIT. Un utilisateur à qui l'on propose
 * « Drill, ou Phonk » choisit en une seconde ; à qui l'on impose « Drill » sans
 * rien dire, il ne saura jamais que l'autre existait.
 */
const RUNNER_UP_MARGIN = 0.04;

export interface SuggestResult {
  readonly preset: Preset;
  readonly score: number; // 0..1
  readonly reason: string;
  /**
   * Second candidat, quand son score est à moins de `RUNNER_UP_MARGIN` du
   * premier. `null` quand la suggestion est nette.
   */
  readonly runnerUp: Preset | null;
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
  let second: { preset: Preset; score: number } | null = null;
  for (const preset of candidates) {
    const tempo = tempoScore(doc, preset.genre);
    const spectral = 1 - Math.abs(subDominance - preset.genre.subDominance);
    const density = 1 - Math.abs(onsetDensity - preset.genre.onsetDensity);
    const score = CRITERION_WEIGHT * (tempo + spectral + density);
    if (!best || score > best.score) {
      second = best;
      best = { preset, score };
    } else if (!second || score > second.score) {
      second = { preset, score };
    }
  }
  if (!best) return null;

  // Second candidat retenu SEULEMENT s'il se tient à `RUNNER_UP_MARGIN` : au-delà,
  // le nommer ferait douter d'une suggestion qui, elle, est nette.
  const runnerUp = second && best.score - second.score <= RUNNER_UP_MARGIN ? second.preset : null;

  const reasonParts = [`tempo ${doc.tempo.global.toFixed(0)} BPM`, `profil ${subDominance >= 0.5 ? 'grave' : 'médium'}`];
  if (gridLow) reasonParts.push('grille peu fiable → régime continu');
  const base = `suggéré d'après l'analyse (${reasonParts.join(', ')})`;
  return {
    preset: best.preset,
    score: best.score,
    reason: runnerUp ? `${base} — ${runnerUp.name} conviendrait aussi` : base,
    runnerUp,
  };
}
