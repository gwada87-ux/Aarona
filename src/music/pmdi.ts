/**
 * PMDI — PULSAR Music Data Interface v1.0. Types du contrat de données entre
 * PULSAR (ou tout compositeur externe) et ce visualizer (docs/12_INTEGRATION_PULSAR.md).
 * Copie fidèle des interfaces de la spec §"Document PMDI" et §"Types associés" —
 * ce fichier ne fait qu'énoncer la forme des données, `validatePmdi.ts` la vérifie.
 *
 * Principe #2 du contrat : JSON pur, sérialisable — aucune fonction, aucune
 * référence, aucun objet natif dans ces formes (Float32Array excepté, en
 * mémoire uniquement : `FeatureTrack.data` est `number[]` sur le fil).
 */

export type EventType = string; // chaîne libre — un type inconnu est ignoré silencieusement (principe #3)
export type BandId = string; // chaîne libre, même tolérance que EventType

export interface TempoPoint {
  t: number;
  bpm: number;
}

export interface MeterPoint {
  t: number;
  num: number;
  den: number;
}

export interface MusicEvent {
  t: number;
  type: EventType;
  intensity: number; // 0..1
  confidence: number; // 0..1
  dur?: number;
  band?: BandId;
  source?: string; // Mode B : id de la piste PULSAR
  meta?: Record<string, number | string | boolean>;
}

export interface FeatureTrack {
  id: string; // "energy" | "band.sub" | "centroid" | …
  hz: number; // FLOTTANT, jamais arrondi (ex. 172.265625)
  t0: number;
  data: number[]; // Float32Array en mémoire, number[] en JSON
  range?: [number, number]; // par défaut [0, 1]
}

/** Mode A uniquement : descripteurs bruts permettant de reclasser sans réanalyser. */
export interface OnsetDescriptor {
  t: number;
  band: BandId;
  strength: number; // 0..1
  e: [number, number, number, number, number, number]; // 6 bandes de Δm, normalisées
  centroid: number; // Hz
  flatness: number; // 0..1
  decay30: number; // secondes, plafonné à 0,5
  decaySaturated: boolean;
}

export interface Section {
  t: number;
  dur: number;
  energy: number; // 0..1
  letter?: string; // "A" | "B" | "C" — répétition détectée
  label?: string; // Mode B uniquement : "intro" | "verse" | "drop" | …
  confidence: number;
}

export interface NoteEvent {
  t: number;
  dur: number;
  midi: number; // hauteur MIDI, décimale autorisée (glissandos)
  velocity: number; // 0..1
  track?: string;
  confidence: number;
}

export interface ChordEvent {
  t: number;
  dur: number;
  root: number; // 0..11, do = 0
  quality: string; // "maj" | "min" | "min7" | "sus4" | …
  confidence: number;
}

export interface TrackDescriptor {
  id: string;
  role:
    | 'kick'
    | 'snare'
    | 'clap'
    | 'hat'
    | 'perc'
    | '808'
    | 'bass'
    | 'melody'
    | 'chord'
    | 'fx'
    | 'vocal'
    | 'other';
  name?: string;
}

export type AudioRef =
  | { kind: 'file'; name: string; size: number; hash?: string }
  | { kind: 'url'; url: string }
  | { kind: 'embedded'; mime: string; base64: string } // à éviter, gros
  | { kind: 'none' }; // le producteur génère l'audio lui-même

export interface PmdiDocument {
  pmdi: string; // "MAJEUR.MINEUR", ex. "1.0"

  source: {
    kind: 'analysis' | 'pulsar' | 'hybrid';
    generator: string; // "pulsar-visualizer/analysis@1.0" | "pulsar@2.3"
    createdAt: string; // ISO 8601
  };

  audio: {
    duration: number; // secondes
    sampleRate: number;
    channels: number;
    ref?: AudioRef;
  };

  tempo: {
    global: number; // BPM de référence
    confidence: number;
    map: TempoPoint[]; // au moins un point à t = 0
    alternate?: number; // candidat ×2 ou ÷2 quand l'algorithme hésite
  };

  meter: { map: MeterPoint[] }; // au moins { t: 0, num: 4, den: 4 }

  grid?: {
    // faisant autorité en Mode B, indicatif en Mode A
    beats: number[];
    downbeats: number[];
    bars?: number[];
    phrases?: number[];
  };

  events: MusicEvent[]; // TRIÉS par t croissant — contrainte du format
  features?: FeatureTrack[];
  sections?: Section[];
  notes?: NoteEvent[]; // Mode B (ou contour de basse approximatif en Mode A)
  chords?: ChordEvent[]; // Mode B uniquement
  tracks?: TrackDescriptor[]; // Mode B : provenance des événements

  confidence: {
    // synthèse globale, utilisée pour le choix de régime
    tempo: number;
    grid: number;
    classification: number;
    structure: number;
  };

  ext?: Record<string, unknown>; // extensions propriétaires — ignorées par le noyau
}
