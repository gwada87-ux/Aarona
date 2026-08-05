# 03 — FLUX DE DONNÉES

## Vue d'ensemble : trois flux, un seul point de convergence

```
FLUX 1 — INGESTION (une fois, à l'import)          asynchrone, quelques secondes
FLUX 2 — LECTURE   (60 fois par seconde)           temps réel, budget 16,6 ms
FLUX 3 — EXPORT    (une fois, à la demande)        hors temps réel, déterministe
```

Les flux 2 et 3 partagent **le même code** en aval du `Transport`. C'est la garantie que ce qu'on
voit est ce qu'on exporte.

---

## FLUX 1 — Ingestion

```
Fichier (File)
   │
   ├─ [main] validation : type MIME, taille, durée estimée
   │         refus si durée > 12 min ou taille > 150 Mo
   │
   ├─ [main] AudioContext.decodeAudioData()        ← 1 à 3 s pour 4 min
   │         → AudioBuffer (stéréo Float32)
   │
   ├─ [main] transfert du canal mono ((L+R)/2) vers le Worker
   │         via ArrayBuffer transférable — zéro copie
   │
   └─ [worker] AnalysisPipeline
         │
         ├─ 0. extraction des pics de waveform (2048 buckets)   ← pour la timeline UI
         │
         ├─ 1. rééchantillonnage vers 22 050 Hz     ← divise le coût par 2, suffisant
         │       (le contenu utile pour la détection est < 11 kHz)
         │
         ├─ 2. STFT   fenêtre Hann 1024, hop 128   → 172 trames/s, résolution 5,8 ms
         │
         ├─ 3. features par trame
         │       6 bandes d'énergie · RMS · centroïde · platitude · flux spectral par bande
         │       → FeatureTracks (Float32Array)
         │
         ├─ 4. onsets : flux spectral demi-redressé → seuil médian adaptatif → pics
         │       par bande : sub · bass · lowmid · mid · himid · high
         │
         ├─ 5. tempo : autocorrélation de l'ODF global + peigne harmonique
         │       → BPM + confiance + résolution de l'ambiguïté ×2 / ÷2
         │
         ├─ 6. beats : programmation dynamique sur l'ODF contrainte par le tempo
         │       → temps de beats + confiance
         │
         ├─ 7. downbeats : phase à 4 maximisant l'énergie de la bande grave
         │
         ├─ 8. DESCRIPTEURS d'onsets (et NON classification)
         │       9 flottants par onset : 6 bandes de Δm + centroïde + platitude
         │       + decay30 (avec drapeau de saturation)
         │       ≈ 2 500 onsets × 9 × 4 o = 90 ko, conservés dans le PMDI
         │       → la CLASSIFICATION a lieu hors du Worker (voir encadré ci-dessous)
         │
         ├─ 9. contour de basse : passe-bas 200 Hz → f0 par autocorrélation → segments
         │
         ├─ 10. structure : matrice d'auto-similarité synchrone aux beats
         │        → noyau de nouveauté → frontières de sections
         │
         └─ 11. macro-événements : DROP · BUILDUP · BREAK · ENERGY_UP · ENERGY_DOWN
                 depuis l'enveloppe d'énergie lissée sur 1 mesure

         Progression rapportée au thread principal à chaque étape (0..1 + libellé)

   ⚠️ Pourquoi la classification n'est PAS dans le Worker

   Les seuils de classification (kick/snare/hat) sont surchargés par le preset genre.
   Or le preset est SUGGÉRÉ à partir du résultat de l'analyse : il est donc inconnu au
   moment où le Worker tourne. La dépendance serait circulaire. Pire, le spectrogramme
   est libéré au fil de l'eau : un changement de preset en cours de lecture — cas de
   charge explicitement testé — imposerait une réanalyse complète.
   S'y ajoute une violation des règles de dépendance : analysis/ n'a pas le droit
   d'importer presets/.

   → Le Worker produit et CONSERVE les descripteurs. La classification devient une
     fonction pure  descripteurs × seuils → événements typés,  exécutée sur le thread
     principal, rejouable en moins d'une milliseconde à chaque changement de preset.
         │
         ▼
   Document PMDI  (transféré au thread principal)
         │
         ▼
   MusicTimeline.fromPmdi(doc)      ← construction des index, une seule fois
         │
         ▼
   Prêt à lire
```

**Budget d'ingestion visé pour un morceau de 4 minutes**

| Étape | Cible |
|---|---|
| Décodage | ≤ 2,5 s |
| STFT + features | ≤ 2,5 s |
| Onsets + tempo + beats | ≤ 1,5 s |
| Descripteurs + basse | ≤ 0,8 s |
| Structure | ≤ 0,7 s |
| **Total** | **≤ 8 s** |

Le Worker signale sa progression pour que l'UI reste vivante. L'utilisateur peut choisir son preset
pendant l'analyse.

**Implémenté à l'Étape 14/P12** (`src/ui/App.ts`, `src/ui/pipeline.ts`, `src/analysis/
analyzeInWorker.ts`) : premier branchement bout en bout de ce flux — le Worker (`analysis/
worker.ts`) existait depuis P4 mais rien ne l'INSTANCIAIT avant cette étape. `analyzeInWorker.ts`
porte le `new Worker(...)` + le protocole de message ; `ui/pipeline.ts` (`importTrack`) enchaîne
démixage → Worker → `finalizePmdi` → `suggestPreset` → `MusicTimeline`. Vérifié au navigateur (voir
docs/JOURNAL.md, Étape 14/P12) — la progression s'affiche, le preset suggéré est présélectionné.

---

## FLUX 2 — Lecture (boucle de preview)

Une frame, budget **16,6 ms** à 60 fps. Répartition cible :

```
requestAnimationFrame
   │
   ├─ [0,2 ms] Transport.tick()
   │             t = audioTime() − outputLatency + calibrationOffset
   │             lissage de la dérive : correction proportionnelle bornée à 2 ms/frame
   │             (jamais de saut visible ; on rattrape doucement)
   │
   ├─ [0,3 ms] RealtimeProbe.sample()          ← AnalyserNode, décoratif uniquement
   │             fournit un micro-mouvement continu entre deux trames d'analyse
   │
   ├─ [4,5 ms] BOUCLE DE SIMULATION À PAS FIXE  (accumulateur, 1/120 s)
   │             généralement 2 sous-pas par image à 60 fps, 4 à 30 fps
   │
   │             pour chaque sous-pas (tSub, dt = 1/120) :
   │               stepIndex = round(tSub * 120)
   │               rng.reseed(hash(projectSeed, stepIndex))
   │               fired  = dispatcher.collect(tSub)      ← PAR SOUS-PAS, pas par image
   │               bands  = timeline.featureAt(tSub, …)
   │                        + sonde temps réel (pondérée à 25 % max)
   │               BehaviourEngine.update(stepContext)    → VisualSignals
   │               Scene.update(stepContext, signals)     → physique, états des couches
   │
   │             le reliquat de l'accumulateur (< 1/120 s) n'est PAS simulé :
   │             il est reporté sur l'image suivante. Aucune interpolation partielle,
   │             sous peine de réintroduire une dépendance au fps.
   │
   ├─ [9,0 ms] Scene.draw(renderer, viewport)
   │             couche par couche, dans l'ordre, composition additive
   │
   ├─ [1,0 ms] FlashLimiter.apply()
   │             mesure de la luminance moyenne, bornage du delta
   │
   └─ [1,0 ms] présentation + collecte des statistiques
   ────────────
   ≈ 16,0 ms                                          marge : 0,6 ms
```

Si le budget est dépassé de façon soutenue, le `QualityGovernor` intervient (voir `10_PERFORMANCE.md`).

### Détail : la source d'horloge — tranchée

Trois mécanismes incompatibles se présentent ; il faut en choisir un et s'y tenir.

| Option | Seek au sample | Remux audio possible | Verdict |
|---|---|---|---|
| `<audio>` + `MediaElementSource` | non | non (octets perdus) | ❌ |
| `AudioBufferSourceNode` | **oui** | **oui** | ✅ **retenu** |
| `AudioWorklet` de lecture | oui | oui | inutilement complexe pour le MVP |

```ts
// AudioBufferSourceNode est ONE-SHOT : chaque play et chaque seek crée un nouveau nœud,
// et l'offset doit être tenu à la main. C'est le prix à payer pour le seek exact.
t = ctx.currentTime − tStart + offsetSeek
    − (ctx.outputLatency ?? ctx.baseLatency ?? 0)
    + calibrationUtilisateur
```

⚠️ **`AudioContext.outputLatency` n'est pas implémenté par Safari** (seul `baseLatency` l'est) et vaut
0 sur Chrome tant que le contexte n'a pas encore rendu d'audio. Un **outil de calibration manuelle**
(clic sur un métronome visuel, décalage mémorisé) est donc obligatoire, pas optionnel : sans lui, le
critère de synchronisation est intenable sur environ 20 % du parc.

### Détail : conserver les octets compressés

```ts
const raw = await file.arrayBuffer();
const forDecode = raw.slice(0);              // NE PAS SUPPRIMER CE slice
const buffer = await ctx.decodeAudioData(forDecode);
```

`decodeAudioData` **neutralise** (détache) l'`ArrayBuffer` qu'on lui passe. Trois fonctionnalités ont
besoin des octets d'origine après décodage : le remux audio sans perte à l'export, le hachage pour
`cacheKey`, et le mode « complet » du fichier projet. Sans la copie, les trois sont impossibles — et
le `slice` a toutes les chances d'être « optimisé » par quelqu'un six mois plus tard s'il n'est pas
commenté.

### Détail : la correction de dérive

Lire `audioElement.currentTime` à chaque frame donne une valeur qui avance par paliers (elle n'est
mise à jour que quelques dizaines de fois par seconde). L'utiliser brut produit un tremblement
visible sur tout ce qui dépend de la phase du beat.

```
tPredit  = tPrecedent + dt                        ← avance lisse
tMesure  = audioTime() − outputLatency + offset   ← vérité, mais en escalier
erreur   = tMesure − tPredit
t        = tPredit + clamp(erreur, −2 ms, +2 ms)  ← convergence douce
si |erreur| > 120 ms → resynchronisation dure (seek externe détecté)
```

**Implémenté à l'Étape 14/P12** (`src/ui/App.ts`, boucle `loop()`) : `AudioEngine.tick(nowMs)` produit
`t` (corrigé) et `dt` (delta BRUT, non corrigé — les deux sont exposés séparément, voir
`AudioEngine.ts`). Piège rencontré et corrigé pendant la vérification au navigateur (dérive lente
perçue à l'oreille/à l'œil sur une lecture longue) : alimenter l'accumulateur à pas fixe avec `dt`
brut fait dériver l'horloge de simulation (`simT`) de la position audio réelle, puisque `dt` n'hérite
jamais de la correction ci-dessus — seul `t` le fait. Le correctif alimente l'accumulateur avec le
DELTA de `t` d'une image à l'autre (`audioEngine.t − dernierT`), qui embarque la correction. Voir
docs/JOURNAL.md, Étape 14/P12, « décisions de conception ».

**Écart connu :** `RealtimeProbe` (P3, `src/audio/RealtimeProbe.ts`) reste non instancié — le
« micro-mouvement continu » qu'il devait fournir (pondéré à 25 % max sur les bandes) n'est câblé nulle
part, ni avant cette étape ni par elle. Purement décoratif d'après ce document ; non bloquant.

---

## FLUX 3 — Export

```
Pour chaque frame f de 0 à totalFrames − 1 :          ← boucle ASYNCHRONE, jamais un for synchrone
   │
   ├─ t = f / fps                                ← déterministe, pas d'horloge réelle
   │
   ├─ simulation à pas fixe jusqu'à t, exactement comme en preview
   │     (mêmes sous-pas de 1/120 s, mêmes stepIndex, mêmes graines)
   │     ATTENTION : RealtimeProbe est désactivée en export.
   │     Sa contribution est remplacée par la lecture des FeatureTracks à t,
   │     avec la même pondération. Écart borné, vérifié par le test golden.
   │
   ├─ Scene.draw() · FlashLimiter.apply()
   │
   ├─ VideoEncoder.encode(new VideoFrame(canvas, { timestamp: f * 1e6 / fps }))
   │     frame.close() en finally — sinon fuite mémoire massive
   │
   ├─ CONTRE-PRESSION : si encodeQueueSize > 8, attendre l'événement `ondequeue`
   │
   ├─ YIELD OBLIGATOIRE à chaque image, via MessageChannel ou scheduler.yield()
   │     ⚠️ PAS setTimeout : bridé à 1 appel/seconde dans un onglet en arrière-plan
   │     ⚠️ PAS de boucle for synchrone : les callbacks `output` de VideoEncoder
   │        sont des tâches de la boucle d'événements. Sans yield, elles ne
   │        s'exécutent jamais, la file explose, la progression ne s'affiche pas
   │        et l'annulation n'est jamais traitée.
   │
   └─ progression → UI (annulable)

Piste audio :
   ├─ si le conteneur et le codec source sont compatibles → remux direct (sans perte)
   └─ sinon → AudioEncoder (AAC) depuis l'AudioBuffer décodé

Multiplexage : Mediabunny → fichier MP4 → téléchargement local
```

Le pipeline d'export **n'utilise jamais `requestAnimationFrame`** et ne dépend d'aucune horloge
réelle. Il tourne aussi vite que la machine le permet, ou plus lentement, sans que cela change une
seule image.

---

## Structures de données majeures

### `FeatureTrack` — courbe continue échantillonnée

```ts
interface FeatureTrack {
  id: FeatureId;          // "rms" | "energy" | "band.sub" | "band.bass" | "centroid" | …
  hz: number;             // FLOTTANT, jamais arrondi : sr_analyse / hop = 22050/128 = 172,265625
  t0: number;             // décalage du premier échantillon (voir convention d'horodatage, doc 04)
  data: Float32Array;     // normalisée 0..1
}
```

⚠️ **`hz` ne doit jamais être arrondi.** `featureAt(t)` calcule `index = (t − t0) · hz`. Avec
`hz = 172` au lieu de `172,265625`, on lit à `t = 240 s` l'échantillon qui correspond en réalité à
239,63 s : **370 ms de décalage**, soit 18 fois le budget de synchronisation, sur toutes les courbes
continues. Et comme `hz` est un champ du format PMDI, l'erreur serait figée dans les fichiers.
Test associé : `featureAt(duration − ε)` doit tomber sur le dernier échantillon.

Choix : `Float32Array` plutôt qu'un tableau d'objets. Pour 4 minutes à 172 Hz et 10 pistes :
`240 × 172 × 10 × 4 = 1,65 Mo`. Négligeable, contigu en mémoire, interpolable en O(1).

### `MusicEvent` — événement ponctuel

```ts
interface MusicEvent {
  readonly t: number;              // secondes, référence absolue
  readonly type: EventType;
  readonly intensity: number;      // 0..1
  readonly confidence: number;     // 0..1
  readonly dur?: number;
  readonly band?: BandId;
  readonly source?: string;        // Mode B : piste PULSAR d'origine
  readonly meta?: Readonly<Record<string, number | string | boolean>>;
}
```

Stockés dans un tableau unique trié par `t`, plus un index par type (tableaux d'indices). La
recherche `eventsBetween` est une double recherche binaire.

Ordre de grandeur : un morceau de 4 min en Trap produit ≈ 2 500 événements. Trivial en mémoire.

### `VisualSignals` — la sortie du `BehaviourEngine`

Environ 20 valeurs normalisées, sans unité et sans sémantique musicale. C'est volontaire : une
couche visuelle ne doit pas savoir ce qu'est un kick, seulement qu'un signal `impact` vaut 0,84.

```ts
interface VisualSignals {
  impact: number;        // impulsion percussive principale, décroissance rapide
  subImpact: number;     // impulsion grave (808), décroissance lente
  tick: number;          // micro-événements (hats)
  accent: number;        // snare / clap
  drive: number;         // énergie globale lissée
  weight: number;        // poids des basses
  brightness: number;    // centroïde spectral normalisé
  density: number;       // densité d'événements récente
  tension: number;       // montée anticipée vers le prochain macro-événement
  release: number;       // relâchement après un drop
  pulse: number;         // sinusoïde synchronisée sur le beat, phase continue
  barPulse: number;      // idem, sur la mesure
  sectionShift: number;  // impulsion sur changement de section
  chaos: number;         // désordre autorisé, piloté par le preset
  // …
}
```

---

## Où passe la mémoire (morceau de 5 min)

| Poste | Taille |
|---|---|
| `AudioBuffer` décodé (stéréo 48 kHz) | ≈ 115 Mo |
| Copie mono rééchantillonnée 22,05 kHz (Worker) | ≈ 26 Mo |
| Spectrogramme intermédiaire (libéré après analyse) | ≈ 106 Mo pic |
| `FeatureTracks` conservées | ≈ 2 Mo |
| Événements | < 1 Mo |
| Pics de waveform UI | < 1 Mo |
| Canvas + sprites | ≈ 40 Mo |
| **Pic total** | **≈ 290 Mo** — cible ≤ 700 Mo à 10 min |

Le spectrogramme est traité par blocs et libéré au fur et à mesure. Le `AudioBuffer` stéréo est
conservé (nécessaire à la lecture et au réencodage audio de l'export).
