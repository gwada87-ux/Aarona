# 16 — ARBORESCENCE ET REGISTRE DES RISQUES

## Arborescence du projet

Chaque dossier a une responsabilité unique. Aucun dossier créé « au cas où ».

```
pulsar-visualizer/
├── CLAUDE.md                      règles permanentes chargées à chaque session
├── .claude/
│   ├── settings.json              permissions allow / deny / ask + hook
│   └── hooks/garde-fou.mjs        blocage mécanique des commandes destructrices
├── _corbeille/                    (gitignoré) destination des "suppressions"
├── index.html
├── package.json · tsconfig.json · vite.config.ts · vitest.config.ts
├── docs/                          00 → 16, ce dossier
│
├── public/
│   ├── demo/                      morceau de démonstration embarqué (libre de droits)
│   └── fonts/                     polices auto-hébergées (aucune requête externe)
│
├── src/
│   ├── core/                      ← ne dépend de rien
│   │   ├── time/                  Transport · Clock · FixedStep · latency
│   │   ├── rng/                   Rng (mulberry32 seedé) · hash
│   │   ├── math/                  easing · lerp · smoothing · envelopes · clamp
│   │   ├── bus/                   TypedEmitter (événements APPLICATIFS uniquement)
│   │   └── util/                  binarySearch · pool · assert · result
│   │
│   ├── audio/                     ← lecture uniquement
│   │   ├── AudioEngine.ts         load · play · pause · seek · volume · loop
│   │   ├── decode.ts              decodeAudioData + validation
│   │   ├── waveform.ts            extraction des pics pour la timeline
│   │   └── RealtimeProbe.ts       AnalyserNode — décoratif, désactivé en export
│   │
│   ├── analysis/                  ← Mode A. Remplaçable. N'importe jamais visual/
│   │   ├── AnalysisService.ts     façade · progression · cache
│   │   ├── worker/analysis.worker.ts
│   │   ├── dsp/                   fft · windows · stft · resample · filters
│   │   ├── features.ts            bandes · rms · centroïde · platitude · flux
│   │   ├── onset.ts               ODF · seuil médian adaptatif · pics · affinage
│   │   ├── tempo.ts               autocorrélation · peigne · arbitrage ×2/÷2
│   │   ├── beattrack.ts           programmation dynamique
│   │   ├── downbeat.ts
│   │   ├── classify.ts            kick · snare · clap · hat · perc
│   │   ├── bassline.ts            contour de f0
│   │   ├── structure.ts           auto-similarité · nouveauté · sections
│   │   └── macro.ts               drop · buildup · break · énergie
│   │
│   ├── music/                     ← SOURCE DE VÉRITÉ. Ne dépend que de core/
│   │   ├── pmdi/                  types · validate · version · serialize
│   │   ├── MusicTimeline.ts       immuable · indexée · requêtable
│   │   ├── EventDispatcher.ts     sans état, consommateur
│   │   ├── StepContext.ts
│   │   └── sources/               AnalysisSource · PmdiSource · PmdiLiveSource (V3)
│   │
│   ├── behaviour/                 ← musique → signaux abstraits
│   │   ├── BehaviourEngine.ts
│   │   ├── signals/               Impulse · Envelope · Continuous · Trend · Anticipation
│   │   └── mapping/               MappingSchema · resolve · defaults
│   │
│   ├── visual/                    ← ne connaît PAS l'audio
│   │   ├── scene/                 Scene · Layer · LayerRegistry · Composer
│   │   ├── layers/                background · field · waveform · spectrum
│   │   │                          particles · geometry · glow · text · overlay · postfx
│   │   ├── styles/                pulse/ · field/ · spectrum-pro/
│   │   ├── palette/               Palette · themes · drift
│   │   └── safety/                FlashLimiter
│   │
│   ├── render/                    ← abstraction de dessin
│   │   ├── Renderer.ts            interface (~15 opérations)
│   │   ├── Viewport.ts            espace normalisé · safe area · modes de recadrage
│   │   ├── canvas2d/              Canvas2DRenderer · SpriteCache · Bloom · Blend
│   │   └── webgl2/                (V2, derrière la même interface)
│   │
│   ├── presets/
│   │   ├── Preset.ts · schema.ts · resolve.ts · macros.ts · suggest.ts
│   │   └── genres/                trap-dark · drill · house · lofi · rnb  (.json)
│   │
│   ├── project/
│   │   ├── ProjectFile.ts · migrate.ts · pvproj.ts (zip)
│   │   └── storage/               indexeddb · caches (LRU)
│   │
│   ├── export/
│   │   ├── ExportPipeline.ts      rendu image par image, déterministe
│   │   ├── encoders/              WebCodecsEncoder · MediaRecorderEncoder
│   │   ├── mux/                   adaptateur mediabunny
│   │   ├── formats.ts             16:9 · 9:16 · 1:1
│   │   └── watermark.ts
│   │
│   ├── ui/
│   │   ├── App.ts
│   │   ├── layout/                shell · panneaux · plein écran
│   │   ├── panels/                import · preset · macros · avancé · export
│   │   ├── controls/              slider · knob · colorpicker · select
│   │   ├── timeline/              piste · beats · sections · scrub
│   │   └── dialogs/               export · projets · préférences
│   │
│   ├── perf/                      FrameBudget · QualityGovernor · Stats
│   ├── debug/                     DebugOverlay · EventInspector · SpectrumView
│   └── integration/
│       └── pulsar/                PulsarBridge.ts · README.md · exemples
│
├── tests/
│   ├── unit/                      dont architecture.test.ts
│   ├── golden/                    images de référence + comparaison
│   ├── bench/                     render · analysis · export · memory · leak
│   └── fixtures/                  corpus audio + .truth.json
│
└── tools/
    ├── annotate/                  outil de tap-tempo pour la vérité terrain
    └── licenses/                  contrôle des licences en CI
```

### État réel — Étape 12/P10

`classify.ts`, `structure.ts` et `macro.ts` sont bien dans `analysis/` comme prévu ci-dessus, plus
deux fichiers non listés dans l'arborescence aspirationnelle d'origine :

```
├── analysis/
│   ├── finalize.ts         orchestrateur : classify() PUIS structure()/macro(), fonction pure
│   └── trackSampling.ts    SampledTrack · sampleAt · averageOverInterval (partagé structure/macro)
```

`finalize.ts` reste dans `analysis/` et non dans `music/sources/` : `tests/unit/architecture.test.ts`
interdit à `analysis/` d'importer `music/MusicTimeline`, donc l'orchestrateur qui *produit* le PMDI
final ne peut pas vivre dans la couche qui le *consomme*. `music/sources/AnalysisSource.ts` (Mode A,
adaptateur `finalizePmdi()` → `MusicTimeline`) **n'existe toujours pas** — `finalizePmdi()` n'est
pour l'instant appelé que par les tests unitaires, pas par un harnais ou une UI.

### État réel — Étape 13/P11

`presets/` existe désormais et diffère de l'arborescence aspirationnelle ci-dessus :

```
├── presets/
│   ├── schema.ts        types du preset + validatePreset() (fusion de "Preset.ts" et "schema.ts")
│   ├── palette.ts        buildPalette() : config JSON -> Palette runtime (visual/palette)
│   ├── macros.ts         courbes de macro-contrôles + applyMacroCurves()
│   ├── resolve.ts         resolvePreset() : pipeline complet, sortie gelée
│   ├── suggest.ts         suggestPreset() : suggestion automatique (docs/08)
│   ├── index.ts           barrel + PRESET_CATALOG (charge et valide les 5 JSON)
│   └── genres/             trap-dark · drill · house · lofi · rnb  (.json)
```

Pas de fichier `Preset.ts` séparé : types et validation vivent ensemble dans `schema.ts` (même
pragmatisme que `finalize.ts`/`trackSampling.ts` à l'Étape 12/P10, qui s'écartaient déjà de
l'arborescence pour les mêmes raisons). `tests/unit/architecture.test.ts` contraint désormais la
couche `presets` (`core`, `music`, `behaviour`, `analysis`, `visual` — voir le commentaire en tête
de ce fichier de test pour la justification de chaque autorisation).

### État réel — Étape 14/P12

`ui/` existe désormais, `main.ts` (harnais de dev P7/P9/P11) est **supprimé** — remplacé par l'app
réelle. Diffère de l'arborescence aspirationnelle du haut de ce document :

```
├── ui/
│   ├── App.ts               orchestrateur : import -> pipeline -> Transport réel -> boucle de rendu
│   ├── pipeline.ts           importTrack() : AudioBuffer -> démixage -> Worker -> finalizePmdi -> ...
│   ├── seekPriming.ts        rattrapage de seek (docs/02), pur, testé
│   ├── demoDoc.ts             document + WAV synthétiques pour le bouton "Charger une démo"
│   ├── timeline/
│   │   ├── timelineLayout.ts  maths pures temps<->pixel (testées)
│   │   └── Timeline.ts        canvas direct (waveform/sections/ticks/playhead), scrub souris/tactile
│   ├── panels/
│   │   ├── SimplePanel.ts     preset + palette + 3 macros + format d'export
│   │   └── AdvancedPanel.ts   8 macros + style + sécurité
│   └── dialogs/
│       ├── ExportDialog.ts        reprend la logique de main.ts, adaptée à l'AudioBuffer réel
│       └── PresetEditorDialog.ts  éditeur JSON (docs/08)
```

Pas de `layout/` ni `controls/` séparés : la mise en page est en HTML/CSS statique (`index.html`,
ADR-001 « sans framework UI »), pas construite dynamiquement — rien à mettre dans ces dossiers.
`perf/`/`debug/`/`integration/` restent inexistants (hors périmètre de cette étape). `audio/` reçoit
un fichier additif (`downmix.ts`) et `analysis/` un bootstrap de Worker (`analyzeInWorker.ts`) — tous
deux nécessaires à l'intégration mais absents de l'arborescence aspirationnelle d'origine, même
pragmatisme que les étapes précédentes.

### État réel — Étape 15/P13

`project/` existe désormais, assez proche de l'arborescence aspirationnelle (§ haut de ce document) :

```
├── project/
│   ├── Project.ts        types du modèle + validateProject()
│   ├── migrate.ts         migrate() — MIGRATIONS vide (v1 est la première version)
│   ├── zip.ts             lecteur/écrivain ZIP maison (méthode STORE, non listé dans l'arborescence d'origine)
│   ├── pvproj.ts           writePvproj()/readPvproj(), extraction/réinjection de music.pmdi.json
│   ├── cacheKey.ts         hash audio SHA-256 (Web Crypto) + clé de cache d'analyse
│   ├── diff.ts             computePresetDiff()/applyPresetDiff() (chemins pointés génériques)
│   ├── lru.ts              selectEvictions() — pur, testé (non listé dans l'arborescence d'origine)
│   └── storage/
│       └── db.ts            IndexedDB : 4 magasins, éviction LRU, navigator.storage.persist()
```

Deux fichiers en plus de l'arborescence d'origine (`zip.ts`, `lru.ts`) — même pragmatisme que les
étapes précédentes : `zip.ts` isole le format binaire générique de sa spécialisation `.pvproj`
(`pvproj.ts`), `lru.ts` isole la décision d'éviction (pure, testable) du magasin IndexedDB
lui-même (`storage/db.ts`, non testable en environnement Node — même limite que `AudioEngine`/le
Worker d'analyse). `ProjectFile.ts` de l'arborescence d'origine devient `Project.ts` (même
pragmatisme de nommage que `presets/schema.ts` à l'Étape 13/P11 : types + validation dans un seul
fichier plutôt que deux). `tests/unit/architecture.test.ts` contraint désormais la couche `project`
(uniquement `music`, pour les types `PmdiDocument`/`AudioRef` — volontairement PAS `presets/`, voir
le commentaire en tête de ce fichier de test).

### État réel — Étape 16/P14

`perf/` existe désormais, différent de l'arborescence aspirationnelle (§ haut de ce document, qui
prévoyait `FrameBudget · QualityGovernor · Stats`) :

```
├── perf/
│   ├── qualityLevels.ts    table des 4 niveaux (docs/10) + FIXED_SIMULATION_DT + EXPORT_QUALITY_LEVEL
│   ├── QualityGovernor.ts  algorithme d'ajustement automatique (fenêtre p95, horloge injectable)
│   └── PerfMonitor.ts      collecteur FPS/p50/p95/p99 + Update/Rendu, tampon circulaire sans allocation
```

Pas de `FrameBudget.ts` séparé : le budget par étape de docs/10 (§"Budget par image") est une donnée
de CONCEPTION (a servi à fixer les seuils de `QualityGovernor`, 20 ms/12 ms), pas un module vérifié à
l'exécution — aucune couche ne mesure aujourd'hui le budget `Transport`/`StepContext`/`BehaviourEngine`
individuellement, seulement le temps total `update`/`render`/image (`PerfMonitor`). `Stats` devient
`PerfMonitor.ts` (nommage aligné sur sa responsabilité réelle, même pragmatisme que `Project.ts`/
`schema.ts` aux étapes précédentes).

**Écart assumé avec docs/10 §"Le moniteur de performance" et §"Les quatre niveaux de qualité"** :
seul `maxParticles` a un consommateur réel (`ParticleField`, via `Layer.particleStats()` et le
plafonnement câblé dans `ui/App.ts`). `bloom`/`feedback`/`chromaticAberration`/
`internalResolutionScale`/`spectrumBands` sont déclarés dans `QUALITY_LEVEL_CONFIGS` (la table du
document existe intégralement, rien n'est omis côté données) mais SANS EFFET : aucun consommateur
dans `visual/`/`render/` (retoucher `FrameFeedback`, `Canvas2DRenderer` pour la résolution interne, et
`SpectrumBars` est hors budget de cette étape). Le panneau debug n'affiche que Qualité/Particules/
Sync — Rendu/Update (barres), p50/p95/p99, Couches et Mémoire, bien que `PerfMonitor.snapshot()` les
calcule déjà pour Rendu/Update/p50/p95/p99, restent à câbler dans l'affichage. Voir docs/JOURNAL.md,
Étape 16/P14, pour le détail des tests de charge de docs/10 §"Cas de charge à tester explicitement"
non exercés (aucun ne l'a été : morceau de 10 min, flot hyperpop, redimensionnement continu, etc.).

### Vérification automatique des règles de dépendance

`tests/unit/architecture.test.ts` parcourt les imports de `src/` et échoue si une règle du tableau de
`02_ARCHITECTURE.md` est violée. C'est le test le moins spectaculaire et le plus rentable du projet :
il empêche la dérive silencieuse qui transforme une architecture propre en plat de nouilles.

---

## Registre des risques

Cotation : **P** probabilité (1–5) × **I** impact (1–5) = **score**.

### Risques techniques

| # | Risque | P | I | Score | Mitigation | Signal d'alerte |
|---|---|---|---|---|---|---|
| T1 | **Non-déterminisme du rendu** — l'export ne correspond pas à la preview | 4 | 5 | **20** | Loi 1 imposée dès le premier jour ; test golden en CI ; PRNG seedé ; pas fixe | Le test golden échoue de façon intermittente |
| T2 | **Qualité de détection insuffisante** sur certains genres | 4 | 4 | **16** | Spike P1 · corpus annoté · calibration par preset · régime continu de repli | F-mesure < 0,75 sur 2 genres ou plus |
| T3 | **WebCodecs indisponible ou capricieux** chez une part des utilisateurs | 3 | 4 | **12** | Spike P0 · `isConfigSupported` · repli `MediaRecorder` annoncé honnêtement | Erreurs d'encodage en test navigateurs |
| T4 | **Performance Canvas 2D insuffisante** pour les scènes denses | 3 | 4 | **12** | Sprites additifs · bloom à 1/4 · `Float32Array` · `QualityGovernor` · critère de bascule WebGL2 défini à l'avance | p95 > 20 ms en MEDIUM |
| T5 | **Dérive de synchronisation** (Bluetooth, onglet en arrière-plan) | 3 | 5 | **15** | Compensation `outputLatency` · lissage borné · resynchronisation dure au-delà de 120 ms · test casque obligatoire | Sync > 20 ms en test manuel |
| T6 | **Fuite mémoire** sur `VideoFrame` ou les pools | 3 | 4 | **12** | `close()` en `finally` · banc de fuite en CI · test 30 cycles | Dérive > 5 Mo par cycle |
| T7 | **Erreur ×2 / ÷2 sur le tempo** | 4 | 3 | **12** | Arbitrage explicite en 3 tests · `tempo.alternate` conservé · confiance plafonnée en cas d'hésitation | Erreurs sur le corpus Trap/House |
| T8 | Dérive d'architecture au fil des mois | 3 | 4 | **12** | Test d'architecture en CI · ADR obligatoires · revue de couche | Un import interdit passe en revue |
| T9 | Gonflement du bundle | 2 | 2 | 4 | Budget 400 ko en CI · aucune dépendance sans ADR | — |

### Risques juridiques et produit

| # | Risque | P | I | Score | Mitigation |
|---|---|---|---|---|---|
| J1 | **Contamination par une dépendance copyleft** (Essentia AGPL, x264 GPL) | 3 | 5 | **15** | ADR-007 · contrôle de licences en CI · DSP maison |
| J2 | **Contenu photosensible** dans un produit vendu | 3 | 4 | **12** | `FlashLimiter` non contournable · mode réduit par défaut sur les presets énergiques · mention dans les CGU |
| J3 | Utilisateur exportant une vidéo avec de la musique sous droits | 4 | 2 | 8 | Mention claire dans les CGU : la responsabilité des droits incombe à l'utilisateur |
| P1 | **Périmètre qui gonfle** — 12 styles, 11 presets, 3 niveaux d'UI | 4 | 4 | **16** | Périmètre MVP verrouillé · liste explicite de ce qu'il faut refuser (`14_ROADMAP`) |
| P2 | **Jalon M2 trop tardif** — 4 mois avant le premier test de marché | 3 | 5 | **15** | Ordonnancement risque-d'abord : M2 au jour 38 au lieu du jour 120 |
| P3 | Marché plus petit qu'espéré | 3 | 4 | 12 | Test de marché à M2, avant les 47 jours restants |
| P4 | Concurrent sortant une fonctionnalité équivalente | 2 | 3 | 6 | Le Mode B PULSAR n'est pas reproductible par un concurrent sans générateur de beats |
| **O1** | **Perte de fichiers par une commande destructrice de l'agent de codage** | 3 | 5 | **15** | 3 couches : `permissions.deny` · hook `PreToolUse` (exit 2) · `CLAUDE.md`. Jamais `--dangerously-skip-permissions`. `git init` dès le jour 1. Procédure `_corbeille/` au lieu de `rm` |
| O2 | Dérive de périmètre de l'agent (refactor non demandé, fichiers hors plan) | 4 | 3 | 12 | Plan validé avant écriture · `git diff --stat` en fin de session · signaux d'arrêt listés en `00c` |

### Les cinq risques à surveiller en priorité

```
T1  Non-déterminisme        20   → Loi 1 + test golden dès la phase 2
P1  Périmètre qui gonfle    16   → refuser explicitement, la liste est écrite
T2  Qualité de détection    16   → spike P1 au jour 2, corpus annoté
T5  Dérive de sync          15   → compensation de latence dès la phase 3
J1  Licence copyleft        15   → contrôle en CI dès la phase 2
```

Quatre des cinq sont traités dans les quatre premières phases. Ce n'est pas un hasard : c'est
l'application du principe d'ordonnancement par le risque.

---

## Points de contrôle

Trois moments où l'on s'arrête pour décider de continuer ou de corriger.

**Fin de P1 (jour 4)** — Les deux risques maximaux sont-ils levés ?
Si l'export ne fonctionne pas, ou si la détection est très en dessous, le plan est revu maintenant.
Coût de l'erreur à ce stade : 4 jours.

**Fin de P8 (jour 38, jalon M2)** — Le tour complet est fonctionnel.
Premier test de marché réel : montrer 5 vidéos exportées à 20 beatmakers. Si l'accueil est tiède, il
reste 47 jours à réallouer. Coût de l'erreur si ce point de contrôle est sauté : 85 jours.

**Fin de P12 (jour 65, jalon M3)** — Le produit est utilisable.
Test d'utilisabilité avec 5 personnes n'ayant jamais vu l'outil. Le critère est unique et binaire :
**produire une vidéo publiable en moins de 3 minutes, sans aide.** Si ce critère n'est pas atteint, le
problème est dans l'interface, et il vaut mieux le corriger avant la finition.
