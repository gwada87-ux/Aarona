# 12 — PMDI : PULSAR MUSIC DATA INTERFACE v1.0

> Le contrat de données entre PULSAR et PULSAR VISUALIZER.
> Ce document est la **spécification normative**. Le visualizer l'implémente déjà intégralement en
> Mode A ; PULSAR n'a rien à modifier tant qu'il ne veut pas s'y brancher.

---

## Renversement par rapport au brief initial

Le brief plaçait le Mode B en dernière phase, comme une intégration future. C'est l'inverse qu'il
faut faire, pour une raison simple :

> Aucun concurrent partant d'un MP3 ne peut dépasser environ 90 % de précision sur les beats et
> 0 % sur les notes. PULSAR, lui, **compose** la musique : il connaît tout, exactement, avant même
> que le son n'existe.

Le Mode B n'est pas une fonctionnalité future. C'est **l'avantage concurrentiel structurel** du
produit. L'architecture est donc dimensionnée pour lui dès maintenant, et le moteur d'analyse du
Mode A n'est qu'un **estimateur remplaçable** qui remplit le même contrat avec des confiances
inférieures à 1.

```
Mode A   MP3 → analyse   → PMDI (confiances 0,4–0,97)  ─┐
Mode B   PULSAR          → PMDI (confiances = 1,0)     ─┼→ MusicTimeline → moteur visuel
Mode C   PULSAR en direct → PMDI par flux planifié      ─┘        (identique dans les trois cas)
```

**Aucune ligne du moteur visuel ne change entre les trois modes.**

---

## Principes du contrat

1. **Une seule base de temps** : les secondes, en flottant, relatives au début de l'audio.
   Jamais de frames, jamais de ticks, jamais de mesures comme unité primaire.
2. **JSON pur, sérialisable.** Aucune fonction, aucune référence, aucun objet natif.
3. **Tolérance à l'inconnu.** Un type d'événement, un champ ou une piste de features non reconnus
   sont **ignorés silencieusement**. PULSAR doit pouvoir évoluer sans casser le visualizer.
4. **Confiance obligatoire.** Aucun événement sans `confidence`. PULSAR met 1,0 pour ce qu'il a
   composé, et **jamais 1,0 pour ce qu'il ne sait pas** (par exemple le rôle d'une section si
   l'utilisateur ne l'a pas nommée).
5. **Dépendance unidirectionnelle.** Le visualizer n'importe jamais de code PULSAR. PULSAR produit
   un document ; le visualizer le lit. Aucune dépendance de build entre les deux projets.
6. **Compatible avec un hôte sans bundler.** PULSAR est une application HTML monofichier sans build.
   Le contrat est donc un objet JSON simple, et le pont est distribué comme un module ESM autonome
   utilisable directement par `<script type="module">`.

---

## Document PMDI

```ts
interface PmdiDocument {
  pmdi: "1.0";

  source: {
    kind: "analysis" | "pulsar" | "hybrid";
    generator: string;          // "pulsar-visualizer/analysis@1.0" | "pulsar@2.3"
    createdAt: string;          // ISO 8601
  };

  audio: {
    duration: number;           // secondes
    sampleRate: number;
    channels: number;
    ref?: AudioRef;             // comment retrouver l'audio (voir plus bas)
  };

  tempo: {
    global: number;             // BPM de référence
    confidence: number;
    map: TempoPoint[];          // au moins un point à t = 0
    alternate?: number;         // candidat ×2 ou ÷2 quand l'algorithme hésite
  };

  meter: { map: MeterPoint[] }; // au moins { t: 0, num: 4, den: 4 }

  grid?: {                      // faisant autorité en Mode B, indicatif en Mode A
    beats: number[];
    downbeats: number[];
    bars?: number[];
    phrases?: number[];
  };

  events: MusicEvent[];         // TRIÉS par t croissant — contrainte du format
  features?: FeatureTrack[];
  sections?: Section[];
  notes?: NoteEvent[];          // Mode B (ou contour de basse approximatif en Mode A)
  chords?: ChordEvent[];        // Mode B uniquement
  tracks?: TrackDescriptor[];   // Mode B : provenance des événements

  confidence: {                 // synthèse globale, utilisée pour le choix de régime
    tempo: number;
    grid: number;
    classification: number;
    structure: number;
  };

  ext?: Record<string, unknown>; // extensions propriétaires — ignorées par le noyau
}
```

### Types associés

```ts
interface TempoPoint { t: number; bpm: number; }
interface MeterPoint { t: number; num: number; den: number; }

interface MusicEvent {
  t: number;
  type: EventType;              // chaîne libre : un type inconnu est ignoré
  intensity: number;            // 0..1
  confidence: number;           // 0..1
  dur?: number;
  band?: BandId;
  source?: string;              // Mode B : id de la piste PULSAR
  meta?: Record<string, number | string | boolean>;
}

interface FeatureTrack {
  id: string;                   // "energy" | "band.sub" | "centroid" | …
  hz: number;                   // FLOTTANT, jamais arrondi (ex. 172.265625) — voir doc 03
  t0: number;
  data: number[];               // en JSON ; Float32Array en mémoire
  range?: [number, number];     // par défaut [0, 1]
}

/** Mode A uniquement : descripteurs bruts permettant de RECLASSER sans réanalyser. */
interface OnsetDescriptor {
  t: number;
  band: BandId;                 // bande de détection
  strength: number;             // 0..1
  e: [number, number, number, number, number, number];  // 6 bandes de Δm, normalisées
  centroid: number;             // Hz
  flatness: number;             // 0..1
  decay30: number;              // secondes, plafonné à 0,5
  decaySaturated: boolean;
}
// transportés dans  ext.onsetDescriptors: OnsetDescriptor[]
// ≈ 90 ko pour un morceau de 4 min. Absents en Mode B (PULSAR connaît ses pistes).

interface Section {
  t: number; dur: number;
  energy: number;               // 0..1
  letter?: string;              // "A" | "B" | "C" — répétition détectée
  label?: string;               // Mode B uniquement : "intro" | "verse" | "drop" | …
  confidence: number;
}

interface NoteEvent {
  t: number; dur: number;
  midi: number;                 // hauteur MIDI, décimale autorisée (glissandos)
  velocity: number;             // 0..1
  track?: string;
  confidence: number;
}

interface ChordEvent {
  t: number; dur: number;
  root: number;                 // 0..11, do = 0
  quality: string;              // "maj" | "min" | "min7" | "sus4" | …
  confidence: number;
}

interface TrackDescriptor {
  id: string;
  role: "kick" | "snare" | "clap" | "hat" | "perc" | "808" | "bass"
      | "melody" | "chord" | "fx" | "vocal" | "other";
  name?: string;
}

type AudioRef =
  | { kind: "file"; name: string; size: number; hash?: string }
  | { kind: "url";  url: string }
  | { kind: "embedded"; mime: string; base64: string }   // à éviter, gros
  | { kind: "none" };                                     // PULSAR génère l'audio lui-même
```

---

## Différences A / B, explicitement

| Champ | Mode A (analyse) | Mode B (PULSAR) |
|---|---|---|
| `tempo.global` | estimé, conf. 0,70–0,97 | **exact**, conf. 1,0 |
| `tempo.alternate` | souvent renseigné | absent |
| `grid.beats` | estimé | **exact** |
| `grid.downbeats` | conf. 0,70–0,85 | **exact** |
| `events[].t` | ± 2–15 ms | **exact au sample** |
| `events[].intensity` | dérivée de l'énergie | **vélocité réelle** |
| `events[].source` | absent | id de la piste |
| `notes` | contour de basse approximatif | **toutes les notes** |
| `chords` | absent | **exact** |
| `sections[].label` | absent (jamais inventé) | présent si l'utilisateur a nommé |
| `tracks` | absent | présent |
| `features` | mesurées | mesurées ou dérivées de la partition |

**Règle d'honnêteté** : ni l'un ni l'autre ne renseigne un champ qu'il ne connaît pas. Le Mode A
n'invente jamais de `label` de section ; le Mode B ne met pas `confidence: 1.0` sur une information
qu'il a lui-même estimée.

---

## API du pont

```ts
// Mode B — document statique
import { PmdiSource } from "@pulsar/visualizer";

const source = PmdiSource.fromDocument(pmdiDoc);
await visualizer.load({ audio: audioBufferOrUrl, music: source });
```

```ts
// Mode A — analyse locale (identique en aval)
const source = await AnalysisSource.fromFile(file, { profile: "balanced", onProgress });
await visualizer.load({ audio: file, music: source });
```

```ts
// Mode C — flux en direct depuis PULSAR (V3)
const live = new PmdiLiveSource({ audioContext: pulsarAudioContext });
await visualizer.load({ audio: "live", music: live });

// PULSAR pousse chaque événement AU MOMENT OÙ IL LE PLANIFIE, pas au moment où il sonne
live.schedule({ t: audioTime, type: "KICK", intensity: 0.9, confidence: 1.0 });
live.setTempo(bpm);
live.setSection({ t, energy, label });
```

### Pourquoi le Mode C sera visuellement parfait

PULSAR utilise un **scheduler à anticipation** : à chaque réveil du scheduler, il planifie les
événements des 100 prochaines millisecondes sur l'horloge audio (`audioContext.currentTime`).

Cela signifie que PULSAR **connaît déjà chaque hit environ 100 ms avant qu'il ne sonne**. Ces 100 ms
sont exactement ce dont un moteur visuel a besoin pour préparer une réaction — anticiper une
attaque, amorcer une transition, précalculer une gerbe de particules.

```
t = 10,000 s   PULSAR planifie un KICK pour t = 10,100 s
               → le visualizer le sait immédiatement
               → il peut préparer l'impact, ou même l'anticiper visuellement de 2 images
t = 10,100 s   le kick sonne, l'impact visuel est déjà en place
```

Le résultat est une synchronisation **exacte par construction**, impossible à obtenir par analyse.
Condition technique unique : les deux moteurs doivent partager le **même `AudioContext`**, donc la
même horloge. C'est la seule contrainte d'intégration réelle, et elle doit être respectée dès la
conception du pont.

---

## Compatibilité et versionnement

```
Champ `pmdi` : "MAJEUR.MINEUR"

Le lecteur accepte  MAJEUR == 1  et  MINEUR ≤ le sien.
MINEUR supérieur    → accepté, les champs inconnus sont ignorés, avertissement en console.
MAJEUR supérieur    → rejet explicite avec un message actionnable.
```

Règles d'évolution :

- ✅ ajouter un champ optionnel → MINEUR
- ✅ ajouter un type d'événement → MINEUR (les lecteurs anciens l'ignorent)
- ✅ ajouter une piste de features → MINEUR
- ❌ renommer ou retirer un champ → MAJEUR
- ❌ changer une unité ou une plage → MAJEUR

La contrainte « `events` trié par `t` » fait partie du format. Un producteur qui ne trie pas produit
un document invalide. Le validateur le vérifie ; l'importateur trie par sécurité et émet un
avertissement.

---

## Validation

```ts
const result = validatePmdi(doc);
// { ok: true,  warnings: string[] }
// { ok: false, errors: string[], warnings: string[] }
```

| Sévérité | Cas |
|---|---|
| **Erreur** | `pmdi` absent ou majeur incompatible · `audio.duration` manquant · `t` négatif ou > durée · `confidence` hors [0,1] · `events` non trié |
| **Avertissement** | type d'événement inconnu · piste de features inconnue · `confidence: 1.0` en `kind: "analysis"` (suspect) · champ `ext` volumineux |

Le validateur est livré comme un module autonome, utilisable côté PULSAR pour valider sa propre
production avant émission.

---

## Feuille de route d'intégration

| Étape | Contenu | Quand |
|---|---|---|
| **I0** | PMDI v1.0 spécifié, typé, validé, testé. Le Mode A l'implémente intégralement. | **MVP** |
| **I1** | Import/export de fichiers `.pmdi.json` dans le visualizer. Un beat PULSAR exporté avec son PMDI produit un visuel parfait. | MVP + |
| **I2** | PULSAR gagne un bouton « Exporter les données musicales (PMDI) ». Aucun code partagé. | V2 |
| **I3** | PULSAR embarque le visualizer en iframe ou en module ESM. `AudioContext` partagé. Mode C en direct. | V3 |
| **I4** | Produit unifié PULSAR STUDIO : un seul projet, deux moteurs. | V3+ |

L'étape I1 est un **excellent test de réalité du contrat**, et elle n'a besoin de rien du côté de
PULSAR : il suffit d'écrire à la main un document PMDI correspondant à un beat connu et de vérifier
que le visuel tombe exactement juste. Si ce test passe, l'intégration future est déjà validée.

---

## Non-objectifs

- Le PMDI ne transporte **pas** d'audio (sauf `embedded`, à éviter).
- Il ne décrit **pas** de visuel — c'est le rôle du preset et du fichier projet.
- Il n'est **pas** un format d'échange générique type MIDI ou MusicXML. Il décrit ce dont un moteur
  visuel a besoin, et rien de plus. Cette étroitesse est une qualité : un format qui essaie de tout
  décrire finit par n'être implémenté correctement nulle part.
