# JOURNAL

## Étape 1 — P0 : prototype d'export vidéo

Risque testé : produire un MP4 depuis le navigateur (docs/09_EXPORT.md, ADR-005).
Résultat : **validé**. `spike-export/` (jetable) encode 300 images 1920×1080 en H.264 via
`CanvasSource` de Mediabunny 1.52.3 (MPL-2.0), synthétise 5 s d'audio AAC mono via
`AudioBufferSource`, mux en MP4 via `Output`/`Mp4OutputFormat`/`BufferTarget`. Rendu piloté
uniquement par `t = f/60`, aucune horloge réelle. Exécuté dans le navigateur du pane Claude :
blob 872,8 Ko, `video.duration` 5,013 s, 1920×1080 confirmés par lecture du `<video>`,
contenu non vide vérifié par échantillonnage de pixels à t=2,5 s. Encodage : 4,87 s pour 5 s
de contenu. Repli `MediaRecorder` (A) non testé dans ce spike — hors périmètre P0.
Prochaine étape (00a) : Étape 2, spike de détection de beats.

## Étape 2 — P1 : outil d'annotation + prototype de détection

Fait et vérifié : `spike-analysis/stft.mjs` (FFT radix-2 validée vs DFT naïve), test de Dirac
vert (5/5, `node spike-analysis/dirac-test.mjs`) — a révélé et corrigé un vrai bug (le pic du
flux spectral est en avance sur le pic d'énergie ; ancrage sur l'énergie avant affinage ±6ms).
`dsp.mjs` : détection multi-onsets + tempo par autocorrélation, 4/4 vert sur clic 120 BPM
(erreur 0,000 ms, confiance 0,929) et cas d'ambiguïté d'octave 70 BPM+hats. `tools/annotate/`
opérationnel, testé en simulant un fichier audio (comptes, downbeat⊂beat, undo, BPM auto,
correction de latence, garde anti-frappe-dans-un-champ — tout conforme).
Fait mais non vérifié : rien sur audio réel — tout le DSP est validé sur signaux synthétiques.
Limites connues : pleine bande uniquement (pas les 6 sous-bandes de docs/04 §Étape 2, prévues
P4) ; pas de test navigateur réel de `tools/annotate/` par un humain.
Bloque la suite : **3 morceaux réels annotés à la main**, à fournir par Aaron — je ne peux ni
générer ni télécharger de musique. Sans eux, la vérité terrain (docs/11 §Annotation) n'existe pas.

## Étape 3 — P2 : fondations

Fait et vérifié : TypeScript strict (`noUncheckedIndexedAccess`) + Vite + Vitest configurés.
`core/` : `mulberry32`/`hash` (RNG seedé, Loi 1), `FixedStep` (pas fixe 1/120s, reliquat
reporté), `TypedEmitter`, `clamp`/`lerp`. `render/` : `Renderer` (interface minimale),
`Viewport` (espace normalisé, aucun pixel exposé), `Canvas2DRenderer`.
`tests/unit/architecture.test.ts` parse les imports de `src/` via l'API TypeScript et encode les
9 couches de docs/02 — testé positif et négatif : un import `render→audio` temporaire le fait
échouer (preuve collée dans la session), retiré ensuite. `npx tsc --noEmit` : 0 erreur.
`npx vitest run` : 14/14. Cercle normalisé vérifié en 16:9/9:16/1:1 par échantillonnage de
pixels réel dans le navigateur (`npm run dev`), pas seulement par le calcul.
Fait mais non vérifié : `Canvas2DRenderer` non couvert par un test automatisé (nécessiterait un
canvas mocké), seulement vérifié manuellement au navigateur. Restrictions fines
`analysis→music/pmdi` et `visual→music` (types uniquement) pas encore encodées dans le test
d'architecture — ces dossiers n'existent pas encore.
Limites connues : `rgba()` recalculée à chaque appel dans `Canvas2DRenderer` (interdit en
boucle particules, à revoir P7/P9). 2 vulnérabilités npm transitives (vite/vitest), non
traitées. `typescript` fixé en 5.7 (la 7.0.2 tout juste sortie casse sa propre résolution de
module en `moduleResolution: "Bundler"`). Pas de CI (pas de remote git).
Bloque la suite : rien. Prochaine étape (00a) : Étape 4, moteur audio et Transport (P3).

## Étape 4 — P3 : moteur audio et Transport

Fait et vérifié : `core/time/Transport.ts` (interface), `core/time/driftCorrection.ts` (lissage
±2ms/appel, resync dur >120ms — 9 tests unitaires verts). `audio/decode.ts` (copie de
l'ArrayBuffer avant `decodeAudioData`, piège #3 ; validation durée/taille). `audio/AudioEngine.ts`
(load/play/pause/seek/volume/loop, `AudioBufferSourceNode` one-shot par play/seek, piège #10 ;
horloge avec compensation `outputLatency` + lissage). `audio/RealtimeProbe.ts` (AnalyserNode
décoratif, pas encore branché). Harnais `index.html`/`main.ts` remplacé (P2→P3). Deux bugs réels
trouvés et corrigés pendant la vérification manuelle avec Aaron : (1) `AudioContext` jamais résumé
après le geste utilisateur → son muet, `t` figé ; (2) `predictedT` non compensé d'`outputLatency`
au démarrage → dérive figée d'environ 50 ms à chaque `play()`/`seek()`. Confirmé par Aaron, casque
branché : dérive 0-10 ms sur 3 min de lecture continue (critère ≤20ms tenu), 50 seeks sans
problème audible.
Fait mais non vérifié : `AudioEngine` non couvert par un test automatisé (nécessiterait un
`AudioContext` mocké) — seule `driftCorrection`, la partie pure, l'est.
Limites connues : `ctx.outputLatency` ne capture pas la vraie latence Bluetooth (mesuré : 48 ms
rapportés au casque BT d'Aaron, contre 100-200 ms réels attendus) — limitation documentée du
navigateur (docs/03_DATA_FLOW.md), pas un bug du moteur. `setCalibrationOffset()` existe et est
câblé mais aucun outil de calibration (métronome visuel) n'existe pour le régler précisément —
hors périmètre P3. `waveform.ts` non créé (rattaché à P4, pas à P3). Pas de persistance du
calibrationOffset (P13).
Dette introduite : aucune connue.
Bloque la suite : rien. Prochaine étape (00a) : Étape 5, types et validateur PMDI (P3bis).

## Étape 5 — P3bis : types et validateur PMDI

Fait et vérifié : `src/music/pmdi.ts` (types `PmdiDocument`, `TempoPoint`, `MeterPoint`,
`MusicEvent`, `FeatureTrack`, `OnsetDescriptor`, `Section`, `NoteEvent`, `ChordEvent`,
`TrackDescriptor`, `AudioRef` — copie fidèle de docs/12_INTEGRATION_PULSAR.md, aucune
dépendance hors `core/`). `src/music/validatePmdi.ts` (`validatePmdi(doc: unknown):
ValidationResult`, jamais de throw) : les 5 erreurs et 4 avertissements du tableau
§"Validation" de la spec, plus la règle de version `MAJEUR.MINEUR` (MAJEUR≠1 → rejet,
MINEUR>0 → avertissement). `tests/unit/pmdi.test.ts` : 14 tests (document minimal valide,
chaque erreur, chaque avertissement, et un test chargeant un `.pmdi.json` RÉEL exporté par
Beat Studio CDJ v18 MELVELBASE — `tests/fixtures/beat-studio-cdj-v18-melvelbase.pmdi.json`,
squelette rythmique Mode B, 43 événements). `tests/unit/architecture.test.ts` couvrait déjà
`music: ['core']` (anticipé à l'Étape 3) — aucune modification nécessaire, testé positif tel
quel. `npx tsc --noEmit` : 0 erreur. `npx vitest run` : 38/38 (6 fichiers). `npm run
test:arch` : 1/1.
Fait mais non vérifié : intégration réelle dans le pipeline (`PmdiSource`, chargement dans
`MusicTimeline`, rendu visuel à partir d'un PMDI) — hors périmètre P3bis, prévue à l'Étape
qui couvrira P5 (MusicTimeline/StepContext).
Limites connues : le vocabulaire `KNOWN_EVENT_TYPES`/`KNOWN_FEATURE_ID_PATTERN` du
validateur (utilisé uniquement pour décider avertissement vs silence, jamais pour rejeter)
est déduit des exemples cités dans la spec, pas d'une liste normative complète — un type ou
une piste de features légitime mais absente de cette liste ne produira qu'un avertissement
informatif, jamais une erreur (conforme au principe #3 de tolérance à l'inconnu).
Dette introduite : aucune connue.
Bloque la suite : rien. Prochaine étape (00a) : intégration Mode B réelle (PmdiSource,
MusicTimeline) — pas encore planifiée dans ce journal.

## Étape 6 — P4 : pipeline d'analyse audio

Fait et vérifié : `src/analysis/` complet — `fft.ts` (FFT réelle par paquetage dans une FFT
complexe N/2, docs/04 §Étape 1), `resample.ts` (interpolation par sinc fenêtrée Blackman
CENTRÉE sur la position cible : non causale, donc retard de groupe nul par construction —
pas besoin de le mesurer puis le soustraire), `stft.ts` (Hann 1024/hop 128, `frameTimestamp`
au centre de fenêtre), `bands.ts` (6 bandes), `features.ts` (rms/peak/energy/centroid/
flatness/rolloff85), `normalize.ts` (p05/p95), `onsets.ts` (seuil médian adaptatif par bande,
période réfractaire, ancrage sur le pic d'énergie avant affinage ±6ms — le correctif trouvé
par exécution en Étape 2, reporté ici car absent de la description abstraite de docs/04),
`tempo.ts` (ODF pondéré, autocorrélation + peigne harmonique + pondération perceptuelle,
résolution ×2/÷2 à trois tests, confiance), `beats.ts` (DP façon Ellis), `downbeats.ts`
(score sur 4 phases), `onsetDescriptors.ts` (spectre de différence, decay30/saturation),
`bassContour.ts` (Butterworth ordre 4 + autocorrélation + segmentation en notes),
`waveformPeaks.ts`, `gridConfidence.ts` (docs/05 §8), `AnalysisPipeline.ts` (orchestration
complète en document PMDI), `worker.ts` (enveloppe Worker).
`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **89/89** verts (19 fichiers). `npm run
test:arch` : 1/1. `npm run build` : succès. Le test de Dirac (docs/04 l.94-97, "aucun autre
travail DSP ne commence avant qu'il ne passe") a été PORTÉ sur le code de production avant
tout le reste — vert en premier, comme l'exige la règle. Tempo : clic à 120 BPM exact →
120,19 BPM, confiance 0,92 (>0,9 requis, docs/11). Piège ×2/÷2 (motif Trap synthétique à
70 BPM + hats en doubles-croches) → retourne bien 70, pas 140 ; a nécessité deux itérations
sur `resolveOctaveAmbiguity` (voir Limites) après qu'un premier test (clic pur 120 BPM,
tests/unit/tempo.test.ts) a révélé que l'arbitrage à trois tests peut, en cas d'égalité
véritable entre candidats, faire basculer à tort vers l'octave concurrente — corrigé en
gardant le candidat principal quand la COURBE PRIMAIRE (déjà favorisée par la pondération
perceptuelle) sépare déjà nettement les deux candidats, l'arbitrage à trois tests ne
tranchant que si elle hésite elle-même. Test d'intégration (`tests/unit/pipeline.test.ts`) :
un morceau synthétique complet (kick + hats, 10s) produit un document PMDI qui passe
`validatePmdi` sans erreur, avec progression croissante sur les 10 étapes jusqu'à 1,0.
Fait mais non vérifié : `worker.ts` n'est pas testable en environnement Node (`self`/
`postMessage` absents) — même limite qu'`AudioEngine.ts` en Étape 4 ; vérification manuelle
au navigateur prévue à l'Étape 14 quand l'UI le branchera. Tout le DSP reste validé sur
signaux synthétiques uniquement : le corpus de 3 morceaux annotés à la main, demandé à
Aaron depuis l'Étape 2, n'a toujours pas été fourni — sans lui, aucune F-mesure réelle
(docs/11 niveau 2) n'est mesurable. Le budget de performance (≤8s pour 4min, docs/03) n'a
pas été mesuré sur un morceau de cette durée. `AnalysisPipeline` n'est pas encore branché
dans `main.ts`/l'UI : module autonome, appelé uniquement par ses tests.
Limites connues : classification d'onsets (KICK/SNARE/HAT/CLAP/PERC), structure par
auto-similarité et macro-événements (DROP/BUILDUP/BREAK) sont hors périmètre de cette étape
(docs/00a — Étape 12/P10 les couvre) ; `confidence.classification` et `confidence.structure`
valent 0 dans le PMDI produit ici. `events[]` ne contient donc que des `SUB_HIT` (contour de
basse) — aucun événement rythmique typé pour l'instant, les descripteurs bruts par bande
attendent en `ext.onsetDescriptors`. Test 3 (plage de genre) de la résolution d'ambiguïté
×2/÷2 (docs/05 l.58-61) est omis : aucun preset n'existe encore. `gridConfidence.ts`
implémente la formule de confiance de docs/05 §8 mais pas le lissage de transition sur 2
secondes (comportement d'exécution, Étapes 7-8, hors périmètre d'un module d'analyse
hors-ligne). Le rééchantillonneur non causal n'a jamais été comparé numériquement à un
filtre polyphase causal de référence — décision documentée en tête de fichier, pas mesurée.
Dette introduite : aucune connue.
Anomalie relevée (pas introduite par cette session) : le dernier commit du dépôt est
« Etape 4 (P3) » — le travail de l'Étape 5 (P3bis : `src/music/`, `tests/unit/pmdi.test.ts`,
fixtures) est présent sur le disque mais n'a jamais été committé. Signalé à Aaron plutôt que
committé silencieusement ; les fichiers de l'Étape 5 ET de l'Étape 6 sont actuellement tous
non indexés (`git status`).
Bloque la suite : rien côté code. Le corpus de 3 morceaux annotés reste en attente d'Aaron
(bloquant pour toute F-mesure réelle depuis l'Étape 2). Prochaine étape (00a) : Étape 7,
`MusicTimeline` et `StepContext` (P5).

## Étape 7 — P5 : MusicTimeline + StepContext

Fait et vérifié : `src/music/MusicTimeline.ts` (`buildMusicTimeline(doc)` — index `events[]`
trié + `Map<EventType, MusicEvent[]>` par type, toutes les requêtes de docs/06 en recherche
binaire `O(log n)` : `eventsBetween`/`eventsOfTypeBetween`, `nextEventOfType`/`prevEventOfType`/
`timeToNext`, `featureAt`/`featureSlope` par interpolation linéaire avec clamp hors piste,
`tempoAt` en fonction en escalier sur `tempo.map`, `beatPhaseAt`/`beatIndexAt`/`barPhaseAt`/
`barIndexAt` par intégration du tempo et de la mesure piecewise-constante, `sectionAt`/
`sections()`). `src/music/EventDispatcher.ts` (`collect(t)` conforme à docs/06, sans `reset()`
séparé — voir écart documenté dans le doc lui-même). `src/music/StepContext.ts` (interface
`StepContext` + `StepContextBuilder` : une seule instance de `Rng` reseedée à chaque pas via
`hash(projectSeed, stepIndex)`, jamais recréée). `src/music/index.ts` (ré-export public).
`tests/unit/musicTimeline.test.ts`, `eventDispatcher.test.ts`, `stepContext.test.ts` : 29 tests,
couvrant explicitement les bornes exigées par 00a (document écrit à la main → timeline correcte ;
`eventsBetween`/`nextEventOfType` aux bornes, y compris un événement pile à `t=0` capturé dès le
premier sous-pas ; un type d'événement hors du vocabulaire connu de docs/06 traversé sans erreur).
Déterminisme du PRNG vérifié explicitement : même `(projectSeed, t)` → mêmes tirages, qu'il y ait
eu 0 ou 2 appels à `build()` avant, conformément à Loi 1. `npx tsc --noEmit` : 0 erreur.
`npx vitest run` : **118/118** verts (22 fichiers, 89 précédents + 29 nouveaux). `npm run
test:arch` : 1/1 — aucun import interdit, notamment aucun `music → analysis` malgré la
tentation de réutiliser `BandId`/`regimeFor`.
Décisions de conception (tranchées et documentées, non soumises à Aaron — coût d'erreur <1 jour) :
(1) `eventsBetween` est demi-ouvert `(t0, t1]` — seule convention qui évite à `EventDispatcher`
de compter un événement deux fois sur une frontière de sous-pas ; `tPrev` initialisé à `-1` (et
non `0` comme le pseudocode de docs/06) pour qu'un événement à `t=0` exact déclenche bien au
premier sous-pas — docs/06 mis à jour en conséquence. (2) `BandId` (6 valeurs fixes) dupliqué
dans `music/StepContext.ts` depuis `analysis/bands.ts` : `music/` n'a pas le droit d'importer
`analysis/` (docs/02, tableau de dépendances) ; lu via `featureAt(t, 'band.<id>')`. (3)
`barIndexAt` ajouté à `MusicTimeline` (absent de docs/06 avant ce lot) : `StepContext.bar.index`
en a besoin et ne peut pas être reconstruit correctement en dehors de la timeline en présence de
changements de mesure — docs/06 mis à jour.
Fait mais non vérifié : `StepContextBuilder` non branché dans un orchestrateur réel
(`main.ts`/boucle de simulation) — module autonome, appelé uniquement par ses tests. Le
rattrapage de seek complet (`scene.reset(t)` + N sous-pas à résolution réduite, docs/02 §Seek)
n'est pas implémenté : cette étape livre les briques (`MusicTimeline`, `EventDispatcher`,
`StepContextBuilder`) dont `EventDispatcher.collect()` s'auto-corrige déjà sur seek, mais
l'orchestration du rattrapage complet appartient à qui pilotera la boucle de simulation
(P6/P7, pas encore écrit).
Limites connues : `regime` (`event`/`continuous`) est figé une seule fois à la construction du
`StepContextBuilder`, jamais recalculé pas à pas. Raison : `PmdiDocument.confidence.grid` est un
scalaire agrégé sur tout le morceau (`analysis/gridConfidence.ts`, Étape 6), pas un signal qui
varie dans le temps — implémenter le lissage « sur 2 secondes » évoqué en commentaire de ce
module aurait été du code d'hystérésis mort, dont l'entrée ne change jamais pendant une lecture.
Si une confiance de grille par section ou glissante apparaît plus tard (candidat naturel :
Étape 10/P10, structure et macro-événements), `regime` devra être recalculé par pas plutôt que
figé — signalé ici pour ne pas le redécouvrir. `beat.confidence` dans `StepContext` réutilise de
la même façon `timeline.confidence.grid` (scalaire global), faute de confiance de battement par
instant exposée par le contrat PMDI actuel. `featureSlope` utilise une différence centrée simple
(pas de lissage), suffisant pour l'usage d'anticipation de docs/06 mais pas vérifié sur un signal
bruité réel. `Section.confidence` n'est lu par rien dans cette étape (seul `t`/`dur`/`letter` sont
utilisés par `sectionAt`) — laissé disponible pour le futur `BehaviourEngine`.
Dette introduite : aucune connue.
Bloque la suite : rien. Prochaine étape (00a) : Étape 8, `BehaviourEngine` (P6).

## Étape 8 — P6 : BehaviourEngine

Fait et vérifié : `src/behaviour/signals/` — `Impulse.ts` (code de docs/07 + `reset()`),
`Continuous.ts` (code de docs/07 + `reset(target)`), `Envelope.ts` (ADSR simplifiée
attaque/maintien/relâchement linéaires — docs/07 ne donne pas de code de référence pour cette
classe), `Trend.ts` (délègue à `MusicTimeline.featureSlope`, sans état), `Anticipation.ts`
(courbes `linear`/`easeInQuad`, seules attestées dans les docs). `src/behaviour/mapping/` —
`MappingSchema.ts` (types fidèles au JSON de docs/07, aucun discriminant `kind` ajouté : la
famille se déduit de la forme de `from`), `resolve.ts`, `defaults.ts` (table de câblage par
défaut = exemple JSON docs/07 + `sectionShift`). `src/behaviour/BehaviourEngine.ts`
(`VisualSignals` à 11 champs, `update(step)`, `reset(t)`). `src/behaviour/index.ts`.
7 fichiers de tests, 27 tests : décroissance analytique exacte d'`Impulse` (deux demi-vies =
un quart, exact) et son indépendance au découpage en `dt` (30/60/144 fps, même total) ;
lissage asymétrique et `reset` de `Continuous` ; les trois phases d'`Envelope` simulées
sous-pas par sous-pas (voir limite ci-dessous) ; `Trend` et `Anticipation` (`linear` reproduit
exactement la référence de docs/06, `easeInQuad` vérifié analytiquement) ; `resolve()` classe
correctement chaque entrée sans discriminant et un preset peut recâbler `impact` sans toucher
au code ; `BehaviourEngine` bout en bout (KICK→`impact` avec gain puis décroissance réaliste,
`accent` ignore KICK, `drive`/`weight`/`brightness` convergent vers leurs `FeatureTracks`,
`tension` monte vers un DROP, `pulse`/`barPulse` corrects à phase 0, `reset(t)` ramène les
Impulses à 0 et saute les Continuous à leur équilibre, câblage recâblable sans recompilation).
`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **145/145** verts (29 fichiers : 118
précédents + 27 nouveaux). `npm run test:arch` : 1/1. `npm run build` : succès.
Décisions de conception (tranchées et documentées, non soumises à Aaron — coût d'erreur <1 jour) :
(1) Périmètre de `VisualSignals` limité à 11 champs sur les ~20 esquissés par docs/03 : 8 de
l'exemple de table docs/07, + `sectionShift` (decay déjà donné), + `pulse`/`barPulse` (fonction
directe de `beat.phase`/`bar.phase`, déjà livrés en P5). `density`, `release`, `chaos` exclus —
aucune formule ni durée nulle part dans les docs, et `chaos` est explicitement « piloté par le
preset » (P11, inexistant). Les inventer maintenant risquait de figer un mauvais réglage avant
qu'un style visuel (P7) existe pour le juger à l'œil. (2) `Envelope`/`Trend` livrées et testées
comme primitives autonomes (roadmap P6 les nomme explicitement, docs/16 les structure) bien
qu'aucune entrée de la table par défaut ne les utilise encore — contrairement à la décision
« regime figé » de l'Étape 7, ce ne sont pas des branches mortes dans un consommateur : ce sont
des unités indépendantes, testées sur leurs propres mérites, en attente d'un consommateur futur
(candidat pour `release` : `Envelope` sur `BREAK`, une fois sa durée d'attaque/relâchement
choisie — décision volontairement pas prise ici). (3) `BehaviourEngine.reset(t)` distingue
`Impulse`/`Envelope` (équilibre = 0, `reset()` sans paramètre) de `Continuous` (équilibre =
`featureAt(t, id)`, `reset(target)`) — voir docs/07, écarts documentés sur les deux classes.
Fait mais non vérifié : `BehaviourEngine` non branché dans un orchestrateur réel — module
autonome, appelé uniquement par ses tests, comme `StepContextBuilder` en P7. Aucune vérification
à l'oreille ni à l'œil possible : ce lot ne produit ni son ni pixel, uniquement des nombres.
Limites connues : `Envelope.update(dt)` ne traverse jamais plus d'une transition de phase par
appel — un `dt` qui dépasse la phase courante clampe à sa frontière et le surplus n'est consommé
qu'au prochain appel (documenté dans Envelope.ts). Sans conséquence avec `FIXED_DT = 1/120 s`,
mais à garder en tête si `Envelope` est un jour piloté par un `dt` variable. `MappingSchema` n'a
pas de validateur runtime (pendant de `validatePmdi`) : une table de câblage vient aujourd'hui
uniquement d'un littéral TypeScript (`defaults.ts`), pas d'un JSON chargé au runtime — un
validateur est nécessaire avant que des presets utilisateur (P11) puissent charger un JSON
non fiable. `density`/`release`/`chaos` absents de `VisualSignals` (voir décision 1).
Dette introduite : aucune connue.
Bloque la suite : rien. Prochaine étape (00a) : Étape 9, `Scene`/`Layer`/style `Pulse` (P7) —
premier lot qui produira une image à l'écran.
