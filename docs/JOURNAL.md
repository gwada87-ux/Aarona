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

## Étape 9 — P7 : Scene, Layer, style Pulse

Fait et vérifié : `render/Renderer.ts`+`Canvas2DRenderer.ts` étendus (`strokeCircle`, `strokePath`
sur tableaux typés, `fillRadialGradient`, `createSprite`/`drawSprite` additif, `applyShake`).
`visual/palette/Palette.ts` (`lerpColor`, `defaultPalette` = valeurs Trap Dark de docs/08).
`visual/safety/FlashLimiter.ts` (`FlashRateGate`, cœur pur ; `FlashLimiter`, couplé au canvas).
`visual/scene/{Layer,Scene}.ts`. Cinq couches (`visual/layers/`) : `RadialBackground`,
`PulseRings` (anneau central + pool de 8 anneaux secondaires sur DOWNBEAT), `CircularWaveform`
(déformée par `step.bands`), `CentralGlow` (sprite additif, fondu enchaîné entre deux teintes),
`ScreenShake` (réutilise `Impulse`, direction seedée par `step.rng`). `styles/pulse/
createPulseStyle.ts` assemble les cinq dans l'ordre `[ScreenShake, Background, Geometry,
Waveform, Glow]`. Harnais (`index.html`+`main.ts`) réécrit : timeline PMDI SYNTHÉTIQUE (clic
120 BPM, KICK/SNARE/HAT/DOWNBEAT/DROP + 3 FeatureTracks sinusoïdales) pilotant le pipeline RÉEL
`StepContextBuilder → BehaviourEngine → Scene Pulse → Canvas2DRenderer → FlashLimiter`.
22 nouveaux tests : `FakeRenderer` (double de test implémentant `Renderer` en enregistrant les
appels — permet de tester le COMPORTEMENT des couches sans canvas ni navigateur) + `palette`,
`flashLimiter` (`FlashRateGate` : seuil, fenêtre de fréquence en temps musical, mode réduit),
`scene` (délégation dans l'ordre), `pulseRings` (rayon/épaisseur, pool DOWNBEAT borné, reset),
`screenShake` (seuil, amplitude bornée, décroissance, direction stable par choc). `npx tsc
--noEmit` : 0 erreur. `npx vitest run` : **167/167** verts (34 fichiers : 145 précédents + 22
nouveaux). `npm run test:arch` : 1/1 (aucun import interdit — `visual/` n'importe que
`core`/`behaviour`/`music`/`render`). `npm run build` : succès, 31 modules (contre 8 avant : tout
le pipeline est maintenant réellement importé par `main.ts`, pas seulement testé isolément).

Vérification navigateur (Browser pane) : bug d'outil rencontré et documenté — le premier
`preview_start` a résolu `.claude/launch.json` du MAUVAIS projet (répertoire de travail
principal, Beat Studio CDJ), pas celui de PULSAR_VISUALIZER_v2 (répertoire additionnel) ;
contourné en démarrant `npm run dev` manuellement puis en attachant `preview_start` à son URL.
Second obstacle : l'onglet du Browser pane n'était pas COMPOSITÉ côté client
(`document.hidden === true`), ce qui suspend totalement `requestAnimationFrame` — capture d'écran
impossible dans cette session. Contourné en exposant `window.__pulsarDebug` (`step(dt)`,
`play()`, `pause()`, `t`) en mode DEV, qui appelle directement la fonction de frame sans dépendre
de rAF. A permis de vérifier, par échantillonnage de pixels réel (`getImageData`) sur des frames
produites par le pipeline RÉEL après une lecture simulée : (1) l'anneau central est exactement
`palette.primary` (123,76,255) et son rayon suit dynamiquement la décroissance d'`impact` dans le
temps simulé (retrouvé à 0,28 exactement en creux de décroissance, comme attendu, à deux instants
t différents) ; (2) le dégradé de fond est présent et correct aux bords ; (3) le glow additif est
visible au centre ; (4) le test de stress du FlashLimiter (alternance noir/blanc ~20/s, largement
au-dessus du seuil de 3/s) produit bien des clampages (`clampedCount` : 0 → 9 sur ~1 s). Cette
même exploration a révélé et corrigé un vrai bug du harnais (pas du moteur) : la boucle avançait
la simulation d'une constante `1/60` par callback `rAF` au lieu du `frameDt` réellement mesuré —
sans effet visible à 60 fps stables, mais faux dès que `rAF` est irrégulier (throttlé,
justement, comme dans cette session). Corrigé, plafonné à 0,25 s (même garde-fou que
`MAX_WINDOW` d'`EventDispatcher`, docs/06).

Décisions de conception (tranchées et documentées, non soumises à Aaron — coût d'erreur <1 jour) :
(1) `pushLayer`/`popLayer` (compositing hors-écran groupé) et `drawText` différés — aucune couche
de `Pulse` n'en a besoin, premiers besoins réels en P9 (`Field`) et P12 (`Text`). (2)
`LayerRegistry`/`Composer` (nommés dans docs/16) différés — aucun consommateur avant que les
presets (P11) assemblent des couches par nom depuis du JSON ; `Pulse` est assemblé directement en
code. (3) `ScreenShake` doit être dessinée EN PREMIER (pas en dernier comme le suggère l'ordre
descriptif de docs/07) : un décalage global ne peut affecter que ce qui est dessiné après lui —
c'est `createPulseStyle` qui ordonne le tableau, `Scene` ne réordonne jamais rien. (4)
`FlashLimiter.apply` prend directement le `HTMLCanvasElement`, pas un `Renderer` : lire/écrire des
pixels bruts (`getImageData`, survoile correctif) est délibérément hors de l'abstraction
`Renderer`, réservé au seul backend Canvas 2D. (5) Constantes non spécifiées par docs/07, choisies
et documentées dans le code : épaisseur d'anneau `0,006+0,014·weight`, pool d'anneaux secondaires
à 8, expansion `+0,32` sur 1,2 s, glow à deux sprites pré-rendus fondus par poids
`(1-brightness)`/`brightness` plutôt que recolorés par image (interdit par la règle de perf), delta
de luminance du FlashLimiter clampé par un survoile approximant la moyenne (pas le contraste
local).

Fait mais non vérifié automatiquement : `Canvas2DRenderer` (comme en P2) et `CircularWaveform`/
`RadialBackground`/`CentralGlow` (comme couches, contrairement à `PulseRings`/`ScreenShake` qui
ont une vraie logique de branchement testée via `FakeRenderer`) — ces trois-là sont surtout de
l'arithmétique-vers-pixels avec peu de branchement, vérifiées seulement par lecture de pixels
manuelle ci-dessus, pas par un test automatisé dédié. `Envelope`/`Trend`/`density`/`release`/
`chaos` toujours sans câblage par défaut (hérité de l'Étape 8, inchangé). Aucune intégration
audio réelle → visuel : le harnais reste piloté par une timeline synthétique écrite à la main,
pas un fichier chargé et analysé (P4 et P7 sont chacun vérifiés séparément, leur assemblage UI
est un chantier futur, probablement P12).

Limites connues : `fillStyle` recalculé en chaîne à chaque appel dans `Canvas2DRenderer` (hérité
de P2, toujours vrai — sans conséquence pour Pulse, à revoir en P9 avec 2500 particules).
`fillRadialGradient` recrée le dégradé chaque image (docs/10 reporte explicitement sa mise en
cache à la phase 12). Aucune mesure de performance chiffrée (60 fps p95 1080p, critère docs/14)
n'a été prise dans cette session : le harnais tourne dans un onglet non composité, donc non
mesurable ici — à faire par Aaron en conditions réelles. `t` du harnais avance par `1/60 s` de
temps réel par défaut (pas d'horloge audio réelle branchée) — acceptable pour ce lot, l'horloge
compensée d'`AudioEngine` (P3) reste disponible mais non re-câblée à ce harnais.
Dette introduite : aucune connue.
Bloque la suite : rien côté code. **Recommandé avant de poursuivre : qu'Aaron ouvre
`npm run dev` et regarde le style Pulse tourner** — c'est le premier lot qui produit une image, et
un jugement esthétique/« ça sonne juste » n'est vérifiable qu'à l'œil, pas par un test automatisé.
Prochaine étape (00a) : Étape 10, export production (P8) — ou retour d'Aaron d'abord si des
ajustements de Pulse sont souhaités.

## Étape 10 — P8 : export production

Fait et vérifié : `src/export/` — `formats.ts` (5 formats de docs/09, fps 30|60, paliers de débit
8/12/20 Mb/s), `encoders/FrameEncoder.ts` (interface au niveau de l'export entier, pas par image —
voir décision 2), `encoders/MediabunnyEncoder.ts` (chemin principal, technique du spike jetable de
l'Étape 1 industrialisée), `encoders/detectSupport.ts` (`canEncodeVideo`/`canEncodeAudio`),
`encoders/MediaRecorderFallback.ts` (repli temps réel), `ExportPipeline.ts` (boucle déterministe
`t=f/fps`, sous-pas fixes jusqu'à la cible, annulation par `AbortSignal`, progression toutes les
15 images, yield par `MessageChannel`), `createOffscreenExportTarget.ts` (glue canvas hors écran,
browser-only), `watermark.ts`. `render/Renderer.ts`+`Canvas2DRenderer.ts` et
`visual/safety/FlashLimiter.ts` élargis à `OffscreenCanvas` (docs/09 : « canvas hors écran,
indépendant du canvas de preview »). Harnais (`index.html`/`main.ts`) : formulaire d'export
complet (format/fps/durée/watermark), bouton Annuler, téléchargement automatique du MP4.

19 nouveaux tests, dans 5 fichiers. Le plus important : **`exportDeterminism.test.ts`**, qui prouve — sans canvas
ni navigateur — que la boucle export (`t=f/fps`) et une boucle preview simulée avec un `dt` réel
volontairement irrégulier (jitter 58-62 fps + un décrochage à 30 fps) produisent EXACTEMENT la
même séquence de sous-pas (`stepIndex`, événements traversés, tirages du PRNG), et que 30fps et
60fps convergent sur la même grille de sous-pas. C'est la preuve automatisée de « preview ≡ export »
au niveau qui compte réellement (la simulation ; le rendu pixel n'en est qu'une fonction pure).
`exportPipeline.test.ts` (7 tests, `FakeRenderer` + un nouveau `FakeFrameEncoder`) : séquence
`start→N×addVideoFrame→addAudio→finish`, timestamps `f/fps` exacts, progression toutes les 15
images + un appel final, annulation immédiate ET en cours de route (aucun appel à `finish()`,
`cancel()` systématique), watermark. `exportFormats.test.ts`, `watermark.test.ts` (position dans
la safe area, aucun texte), `mediaRecorderFallback.test.ts` (sélection de type MIME).
`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **186/186** verts (39 fichiers : 34 précédents +
5 nouveaux, 167 tests précédents + 19 nouveaux). `npm run test:arch` : 1/1. `npm run build` :
succès, 108 modules (mediabunny inclus).

Vérification navigateur — export RÉEL exécuté plusieurs fois avec succès :
- Aperçu (854×480, 30fps, 3s) : chemin `webcodecs` détecté, 90 images, 1439,5 Ko, encodage 1739 ms.
- **1080p60, 3s** (180 images) : encodage 3362 ms → **≈1,12 s d'encodage par seconde de contenu**
  à la résolution/fps cible du critère d'acceptation.
- **1080p60, 10s** (600 images) : encodage 10391 ms — cohérent avec la mesure précédente.
  Extrapolation à 60 s : **≈67 s, contre une cible ≤120 s** (docs/14) — marge confortable, MÊME
  mesurée dans un onglet d'outil automatisé (pas une machine de développement dédiée, donc plutôt
  pessimiste que le contraire).
- Annulation en cours de route déclenchée manuellement sur un export de 20s : arrêt immédiat,
  statut « Export annulé », aucune erreur console, `cancel()` appelé (confirmé par les tests
  unitaires ET observé sans crash en conditions réelles).
- Aucune erreur console sur l'ensemble des essais.
Non vérifié au navigateur : le repli `MediaRecorder` lui-même (Chrome dans ce Browser pane
supporte WebCodecs, donc `detectExportPath` choisit toujours le chemin principal) — sa logique
pure (`pickSupportedMimeType`) est testée, son intégration (`captureStream`+`MediaRecorder`) suit
des patterns d'API standard mais n'a pas été exercée en conditions réelles faute de navigateur
sans WebCodecs disponible dans cette session.

Décisions de conception (tranchées et documentées, non soumises à Aaron — coût d'erreur <1 jour) :
(1) Découverte en lisant `spike-export/main.js` (Étape 1) : `CanvasSource.add()`/
`AudioBufferSource.add()` de Mediabunny respectent déjà la contre-pression en interne (leur
Promise n'est résolue que quand l'encodeur est prêt) — inutile de re-câbler
`encodeQueueSize`/`ondequeue` à la main comme le pseudocode bas niveau de docs/09 le suggère.
(2) `FrameEncoder` est une interface AU NIVEAU DE L'EXPORT ENTIER, pas par image :
`MediaRecorder` ne peut pas recevoir « encode cette image à cet instant », il capture à son
propre rythme (`captureStream`) — le forcer dans une interface par-image aurait été artificiel.
`MediabunnyEncoder` (déterministe) et `runRealtimeCapture` (temps réel) sont deux fonctions
distinctes, unifiées seulement par leur type de retour. (3) `ExportPipeline.runExport` reçoit un
`ExportTarget` (renderer/viewport/flashLimiter déjà construits) plutôt que de construire son
canvas en interne : découplage nécessaire pour rester testable avec `FakeRenderer` — la
construction réelle (`createOffscreenExportTarget.ts`, `OffscreenCanvas`) est isolée dans un
module séparé, browser-only, comme `Canvas2DRenderer`. (4) Remux audio sans réencodage (branche
« MP4+AAC » de docs/09) non implémenté : `AudioBufferSource` réencode toujours depuis
l'`AudioBuffer` décodé — fonctionne pour toute source, au prix de ne pas être optimal pour le cas
MP4/AAC pur. (5) Repli Firefox PARTIEL (vidéo WebCodecs + audio remuxé) non implémenté pour la
même raison — un Firefox sans `AudioEncoder` AAC bascule sur le repli `MediaRecorder` complet.
(6) Watermark = mécanisme de dessin uniquement (point + anneau géométriques, pas de texte) ; la
logique commerciale (licence, plafond 720p) est un chantier UI (P16) hors périmètre.

Fait mais non vérifié : le repli `MediaRecorder` en conditions réelles (voir ci-dessus). Le
critère « test golden : preview ≡ export à moins de 2% de différence pixel » (docs/14) n'est
vérifié qu'au niveau simulation (voir `exportDeterminism.test.ts`) — la comparaison PIXEL par
pixel nécessiterait un canvas en environnement Node (`node-canvas` ou équivalent), une dépendance
non listée dans docs/15_ADR.md ; non ajoutée sans mandat. AV1 non proposé (H.264 uniquement).
Blob >2 Go (segmentation ou File System Access API) non traité — hors de portée des durées
testées. `beforeunload` non câblé — aucune UI de fermeture d'onglet n'existe encore (P12).
Estimation avant export (banc de 30 images, docs/09) non implémentée — P12/UI.
Limites connues : `AudioBufferSource` réencode toujours l'audio (voir décision 4) — un export
MP4/AAC pur perd donc le remux sans perte que docs/09 prévoyait en cas optimal. Le harnais génère
un ton sinusoïdal déterministe en l'absence de tout fichier audio réel chargé (comme
`spike-export/main.js`) — aucune vérification round-trip d'un VRAI fichier audio utilisateur.
Dette introduite : aucune connue.
Bloque la suite : rien. **Le produit fait maintenant le tour complet : import (synthétique) →
analyse (P4) → visuel (P7) → vidéo (P8).** C'est le premier jalon démontrable de docs/14 (M2),
plus tôt que les ~38 jours du plan initial ne le laissaient supposer. Prochaine étape (00a) :
Étape 11, styles `Field` et `Spectrum Pro` (P9) — ou retour d'Aaron d'abord.

## Étape 11 — P9 : styles Field et Spectrum Pro

Fait et vérifié : `render/Renderer.ts`+`Canvas2DRenderer.ts` étendus — `fillPath` (polygone plein
sur tableaux typés), `strokePath`/`drawSprite` acceptent respectivement `closed`/`count` (zéro
allocation), `drawFeedback`/`captureFeedback` (buffer image-précédente scale+alpha persistant).
`visual/scene/Scene.ts` : option `usesFeedback` (capture après toutes les couches, coût payé
seulement par les styles qui en ont besoin). Style **Field** (`visual/layers/{background,field,
particles,postfx}/`) : `DeepVignette`, `PerspectiveGrid` (24 anneaux concentriques, perspective
hyperbolique, avancée = `beat.index+beat.phase`, PAS `signals.pulse`), `ParticleField` (pool de
2500, Float32Array parallèles, curseur circulaire pour le recyclage, spawn KICK/HAT/SNARE/DROP,
fenêtre de convergence sur BUILDUP), `FrameFeedback` (`needsDrawPriming=true`). Style **Spectrum
Pro** (`visual/layers/{background,spectrum,waveform}/`) : `AnimatedDuotone`, `SpectrumBars` (6
`Continuous` par bande, pics à chute gravitaire, réflexion, glow par barre), `FlatWaveform`.
`createFieldStyle`/`createSpectrumProStyle` assemblés. Harnais : sélecteur de style en direct
(Pulse/Field/Spectrum Pro), timeline synthétique enrichie (6 bandes réelles au lieu d'une seule,
événements BUILDUP avant chaque DROP).

24 nouveaux tests, dans 5 fichiers (`particleField`, `perspectiveGrid`, `spectrumBars`,
`frameFeedback` + `Scene.usesFeedback`) : spawn exact par type d'événement (120/20/60/400
particules), extinction après durée de vie, pool jamais débordé, `reset()` efface tout ; grille
déterministe et indépendante de `signals.pulse` (utilise directement `beat.phase`) ; lissage par
bande démontré par convergence chiffrée, chute gravitaire du pic démontrée par comparaison
quantitative barre-vs-pic après une chute nette du signal (barre à exp(-1)≈37 %, pic encore
>85 % — la physique de chute libre, pas juste "un pic existe") ; capture du feedback bien après
toutes les couches, jamais si `usesFeedback=false`. `npx tsc --noEmit` : 0 erreur. `npx vitest
run` : **206/206** verts (43 fichiers : 39 précédents + 4 nouveaux, 24 tests nouveaux). `npm run
test:arch` : 1/1. `npm run build` : succès, 117 modules.

Vérification navigateur — les trois styles testés en conditions réelles (rAF actif dans cette
session, contrairement à P7/P8 où il avait fallu contourner via `__pulsarDebug`) :
- **Field** : particules visibles (couleur `palette.accent` confirmée par échantillonnage de
  pixels), grille en anneaux visible, **60,1 FPS** mesuré en lecture avec particules + feedback +
  grille actifs simultanément — cohérent avec le critère « 2500 particules à 60 fps p95 ».
- **Spectrum Pro** : barres violettes avec glow visibles et animées, couleur proche de
  `palette.primary` confirmée par échantillonnage, **60,0 FPS**.
- Bascule en direct entre les trois styles (Pulse ↔ Field ↔ Spectrum Pro) : aucune erreur
  console, aucun plantage.
- **Export réel du style Field** (3 s, WebCodecs, canvas hors écran) : 90 images, 1,7 Mo, encodage
  2,7 s — confirme que `drawFeedback`/`captureFeedback`/`createSprite` fonctionnent aussi sur
  `OffscreenCanvas` (chemin distinct du canvas de preview), pas seulement en lecture.
- Aucune erreur console sur l'ensemble des essais (trois styles + export).

Décisions de conception (tranchées et documentées, non soumises à Aaron — coût d'erreur <1 jour,
corrigible dans une étape dédiée si besoin) :
(1) **Spectrum Pro réduit à 6 bandes réelles, pas 64.** Découverte en relisant docs/03 : le
spectrogramme est explicitement jeté après l'analyse hors-ligne — aucune donnée plus fine que les
6 `step.bands` n'atteint `visual/`. Fabriquer 64 bandes en interpolant les 6 réelles aurait simulé
une résolution inexistante (contraire à « ne jamais présenter comme certain ce qui est estimé »,
docs/07 Loi 3, étendu par analogie ici à la richesse des données). Un vrai spectre log-scale à 64
bandes est un chantier P4 séparé (conserver une résolution spectrale plus fine en sortie
d'analyse), pas une extension de `visual/`. (2) `drawFeedback`/`captureFeedback` remplacent le
`pushLayer`/`popLayer` générique envisagé en P7 : le seul besoin réel rencontré (un buffer
image-précédente scale+alpha) est plus spécifique qu'un groupe de compositing générique — API
plus étroite, plus simple à implémenter correctement, et suffisante. (3) `ParticleField`/
`SpectrumBars` n'ont pas de couche `Glow` séparée : chacune dessine déjà son propre halo additif
dans son `draw()` — une couche dédiée aurait dupliqué le même rendu pour un second passage sans
rien ajouter visuellement. (4) Largeurs de barres de `Spectrum Pro` non uniformes (proportionnelles
à `log(hauteHz/basseHz)`, dupliquées depuis `analysis/bands.ts` car `visual/` ne peut pas
l'importer) — garde l'esprit « plus d'espace pour le grave » d'une échelle log avec les données
disponibles.

Fait mais non vérifié : le repli `MediaRecorder` avec Field/Spectrum Pro (même limite qu'en P8 —
ce Chrome supporte WebCodecs). Mesure de performance p95 sur une fenêtre glissante de 90 images
(docs/10) non instrumentée : le harnais affiche un FPS lissé simple, pas un p95 — 60 fps
instantané observé, mais pas le percentile exact du critère.
Limites connues : `PerspectiveGrid`/`ParticleField` recréent leur état par `update()` seul après
un seek (pas de `needsDrawPriming`) sauf `FrameFeedback` — cohérent avec docs/02 (seules les
couches à état de FRAMEBUFFER en ont besoin), mais signifie que des particules ou anneaux
"manqués" pendant un rattrapage court ne réapparaissent pas rétroactivement (même principe déjà
documenté pour les anneaux secondaires de Pulse, Étape 9). Le drift de couleur observé au
navigateur (particules/barres légèrement différentes de la couleur palette exacte) vient du
compositing additif de plusieurs sprites superposés — attendu, pas un bug.
Dette introduite : aucune connue.
Bloque la suite : rien. Les trois styles du MVP sont livrés (Pulse, Field, Spectrum Pro).
Prochaine étape (00a) : Étape 12, classification complète et structure du morceau (P10).

## Étape 12 — P10 : classification complète, structure, macro-événements

Fait et vérifié : `analysis/classify.ts` (`classifyOnset`/`classifyOnsets`, ~180 lignes) —
fonction pure, ordre de règles KICK → CLAP → SNARE → HAT → PERC → rejet, marge de confiance par
condition sur des échelles déclarées (ratio 0,10 · centroïde 200 Hz · decay30 60 ms · flatness
0,10), `decaySaturated` neutralise `decay30` sans bloquer ni pénaliser, seuils surchargeables au
format preset genre (docs/05). `analysis/structure.ts` (`detectSections`, ~240 lignes) — vecteurs
9D par battement, matrice de similarité cosinus, noyau en damier, pics de nouveauté, alignement
downbeat, regroupement par lettre ; repli honnête (une section, confiance 0,3) si <17 battements.
`analysis/macro.ts` (`detectMacroEvents`, ~180 lignes) — DROP/BUILDUP/BREAK/ENERGY_UP/ENERGY_DOWN/
SILENCE depuis `E_bar` par mesure. `analysis/finalize.ts` (`finalizePmdi`, ~110 lignes) —
orchestrateur pur, thread principal, ordre imposé classify() PUIS structure()/macro() (BREAK a
besoin des KICK déjà typés). `analysis/trackSampling.ts` — `SampledTrack`/`sampleAt`/
`averageOverInterval`, extrait en commun pour structure.ts et macro.ts. `OnsetDescriptor` (both
`music/pmdi.ts` et la copie locale d'`onsetDescriptors.ts`) étendu avec `microOnsetCount`
(`countMicroOnsets`, pics locaux sur l'enveloppe brute espacés 8–25 ms, signature du CLAP).
`AnalysisPipeline.ts` expose désormais `ext.rawRmsDb` (dBFS brut, non normalisé) pour le seuil
absolu de SILENCE. 51 nouveaux tests (`onsetDescriptors` +2, `classify.test.ts` 15, `structure.
test.ts` 2, `macro.test.ts` 10, `finalize.test.ts` 5 — plus les fichiers déjà existants inchangés).
`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **240/240** verts (47 fichiers). `npm run
test:arch` : 1/1 — `analysis/` n'importe toujours ni `music/MusicTimeline` ni `visual`/`ui`/`audio`.
`npm run build` : succès, 117 modules, 246,62 ko (gzip 64,77 ko).

Décisions de conception (tranchées et documentées, non soumises à Aaron — coût d'erreur <1 jour) :
(1) `Section.label` n'est PAS utilisé pour les catégories low/mid/high de docs/05 §6 : ce champ est
documenté « Mode B uniquement » (noms sémantiques réels) dans `music/pmdi.ts` — `structure.ts`
exporte à la place `SECTION_ENERGY_LOW_MAX`/`SECTION_ENERGY_HIGH_MIN`, laissant tout consommateur
catégoriser lui-même `Section.energy`. (2) Fenêtre (60 ms) et proéminence minimale (15 % du pic)
des micro-onsets du CLAP sont auto-choisies (docs/05 ne donne que l'espacement 8–25 ms) — à
recalibrer avec le corpus. (3) `finalize.ts` reste dans `analysis/`, pas `music/sources/` comme le
laissait supposer l'arborescence aspirationnelle de docs/16 : `architecture.test.ts` interdit à
`analysis/` d'importer `music/MusicTimeline`, donc l'orchestrateur qui *produit* le PMDI final ne
peut pas vivre dans la couche qui le *consomme* — `music/sources/AnalysisSource.ts` (l'adaptateur
qui appellerait `finalizePmdi()` pour nourrir `MusicTimeline`) n'existe pas encore. (4) Aucune
calibration par genre implémentée : `classifyOnset()` accepte un second paramètre au format JSON de
docs/05 §"Calibration par genre", mais aucun système de preset n'existe (P11) — la porte est
ouverte, rien ne l'utilise. (5) Détection de SILENCE corrigée en cours de test : un premier
balayage à pas fixe de 0,4 s pouvait détecter un silence jusqu'à ~0,4 s en retard sur son vrai
début (le pas straddle la frontière) ; remplacé par un balayage échantillon par échantillon avant
tout commit, pour ne pas livrer une régression de synchronisation (priorité #1 du projet).
L'utilitaire `isBelowThresholdThroughout` devenu sans appelant a été retiré de `trackSampling.ts`.

Fait mais non vérifié : aucune vérification navigateur pour cette étape — comme en Étape 6/P4 (Étape
d'analyse pure), le harnais dev (`main.ts`) construit sa propre timeline PMDI synthétique à la main
et n'exerce ni `runAnalysisPipeline` ni `finalizePmdi`. Les critères F-mesure sur corpus annoté
(docs/05, docs/11) restent bloqués depuis l'Étape 2, faute des 3+ fichiers audio annotés promis par
Aaron — vérification faite uniquement sur données synthétiques/construites à la main (vitest).
Le paramètre de seuils personnalisés de `finalizePmdi()`/`classifyOnset()` n'est exercé par aucun
scénario de preset réel (aucun preset n'existe).
Limites connues : la confiance de `classification`/`structure` dans `finalizePmdi()` est une simple
moyenne des confiances par événement/section — agrégation choisie faute de formule spécifiée par
docs/05 pour ce niveau global. `detectSections`/`detectMacroEvents` sont des fonctions offline
(un seul appel par morceau), pas soumises à la règle zéro-allocation de docs/10 (contrairement à
`visual/`) — allocations de tableaux ordinaires acceptées.
Dette introduite : aucune connue.
Bloque la suite : le corpus annoté (Aaron) reste le seul bloqueur pour valider F-mesure ≥0,75 sur
la classification et la structure — inchangé depuis l'Étape 2. Prochaine étape (00a) : Étape 13
(P11, presets et calibration par genre), qui pourra enfin exercer le paramètre de seuils déjà en
place dans `classify.ts`.

## Étape 13 — P11 : presets par genre et macro-contrôles

Fait et vérifié : `presets/schema.ts` — types du format JSON de docs/08 (`Preset`, `PresetMapping`
restreint aux 9 signaux réellement lus par `BehaviourEngine`, `ClassificationOverrides`,
`PresetPaletteConfig`, 8 `MACRO_NAMES`, `PresetLayers` en passage brut) + `validatePreset()`
(structurel, jamais de throw, même idiome que `validatePmdi.ts`). `presets/palette.ts` —
`buildPalette()`, généralise la construction de `defaultPalette` (P7) à une config quelconque.
`presets/macros.ts` — `applyMacroCurves()`, interpolation `at0→at1` avec courbe (`linear`/
`easeInQuad`/`easeOut`). `presets/resolve.ts` — `resolvePreset()`, pipeline complet de docs/08
(base → macros → diff utilisateur → gel), fonction pure. `presets/suggest.ts` — `suggestPreset()`,
les 4 étapes de docs/08 §"Adaptation automatique" (filtre dur à l'étape 4, score à poids égaux aux
étapes 1-3). 5 presets JSON (`presets/genres/*.json` : trap-dark, drill, house, lofi, rnb) + barrel
`presets/index.ts` (`PRESET_CATALOG`, validé au chargement). `tests/unit/architecture.test.ts`
étendu : couche `presets` autorisée à importer `core`/`music`/`behaviour`/`analysis`(type)/`visual`.
Sélecteur de preset câblé dans le harnais dev (`main.ts`/`index.html`) : reconstruit mapping/
palette/style/`FlashLimiter.reducedFlashing` en direct via `resolvePreset()`. 39 nouveaux tests
(`presetMacros` 7, `presetResolve` 9, `presetSuggest` 9, `presetCatalog` 14, contre 47 fichiers/
240 tests avant — total **51 fichiers/279 tests**). `npx tsc --noEmit` : 0 erreur. `npx vitest run` :
**279/279** verts. `npm run test:arch` : 1/1. `npm run build` : succès, 129 modules, 257,21 ko
(gzip 67,98 ko).

Décisions de conception (tranchées et documentées, non soumises à Aaron — coût d'erreur <1 jour) :
(1) **Seules `energy` et `reactivity` ont un effet câblé parmi les 8 macros.** Les 6 autres
(densité, mouvement, profondeur, glow, chaos, douceur) ciblent, par leur propre description dans
docs/08, des paramètres de couches visuelles (`layers.*`, bloom, dispersion de bruit) qu'aucune
couche du MVP (P7/P9 : `ParticleField`, `PerspectiveGrid`, `FrameFeedback`, `ScreenShake`,
`SpectrumBars`) n'accepte en entrée — toutes fixent leurs constantes en interne. Les câbler sur des
chemins qu'aucun code ne lit aurait affiché une confiance que le système n'a pas ; leur valeur brute
reste néanmoins dans `ResolvedPreset.macros` pour un futur consommateur. Conséquence directe :
le critère d'acceptation de docs/14 « chaque macro a un effet perceptible sur toute sa course »
n'est honnêtement rempli que pour 2 des 8 macros à ce stade. (2) `layers` (particules, grille,
postfx) n'est renseigné QUE pour Trap Dark dans les 5 JSON — seul cas aux valeurs documentées ; les
4 autres presets omettent ce champ optionnel plutôt que d'inventer des nombres qu'aucun consommateur
ne lira de toute façon. (3) « Surcharges de style » (étape 2 du pipeline de résolution, docs/08)
est un no-op : un seul jeu de valeurs par défaut existe aujourd'hui (`defaultMapping`,
`DEFAULT_CLASSIFICATION_THRESHOLDS`), pas un jeu par style — même cause que (1)/`macroCurves`
partagées entre les 3 styles. (4) `suggestPreset()` pondère tempo/profil/densité à parts égales :
docs/08 ne chiffre pas ces poids (contrairement à l'arbitrage ×2/÷2 du tempo, docs/05 §1, poids
explicites 0,5/0,3/0,2) — poids égaux retenus faute d'autre donnée. (5) `genre.subDominance`/
`onsetDensity` sont des échelles CONTINUES (0..1) plutôt que des catégories binaires : docs/08 ne
classe explicitement que Trap/Drill (grave) contre Lofi/R&B (médium) pour le profil spectral,
laissant House dans un entre-deux non spécifié — une valeur intermédiaire (0,5) l'exprime
honnêtement plutôt que de trancher un cas que la documentation ne tranche pas. (6) Correction de
coquille : `classification.kick.maxDecay` de l'exemple JSON de docs/08 est en réalité `maxDecay30`
dans `analysis/classify.ts` — utilisé tel quel (le vrai nom) dans les 5 presets livrés.

Fait mais non vérifié : **vérification navigateur bloquée par l'environnement**, pas par le code —
le sélecteur de preset est câblé et compile, mais ni le panneau Claude_Browser (navigation `http://`
systématiquement refusée cette session, pane non composité — symptôme déjà rencontré et documenté
en mémoire, indépendant de ce projet) ni l'extension Chrome connectée (« This site is blocked by
your site permissions », réglage local d'Aaron) n'ont permis de charger le harnais. Tests à faire
par Aaron à l'œil dès que l'un des deux canaux est disponible : ouvrir le harnais dev, choisir
« Trap Dark » puis « R&B » dans le nouveau sélecteur de preset et confirmer (a) le style change
(Field → Pulse), (b) la palette change visiblement (violet/magenta → bordeaux/or), (c) au clic sur
un temps fort, l'impact visuel change de nature (R&B doit réagir aux caisses claires/claps, pas au
kick) — la preuve la plus directe que le recâblage `mapping` fonctionne réellement. Le critère
d'acceptation « la suggestion tombe juste sur 7/10 » (docs/14) reste bloqué par le corpus annoté,
inchangé depuis l'Étape 2.
Limites connues : voir décisions (1)-(3) ci-dessus (6 macros et `layers.*` sans consommateur réel,
"surcharges de style" no-op). `resolvePreset()`'s `userMappingOverrides` ne couvre que `mapping` —
pas de diff utilisateur sur palette/macros/classification, faute d'UI qui en produirait un (P12).
`R&B.genre.tempoHint` est entièrement auto-choisi (absent de la table de docs/05 §1).
Dette introduite : aucune connue.
Bloque la suite : le corpus annoté (Aaron) reste le seul bloqueur, inchangé depuis l'Étape 2 — pour
la F-mesure de classification/structure ET pour le critère de suggestion de preset. La vérification
navigateur de cette étape est à refaire dès qu'un canal de navigateur fonctionne. Prochaine étape
(00a) : Étape 14 (P12, interface utilisateur et timeline) — première étape où presets et macros
seront réellement exposés à un humain, et où le manque de configurabilité des couches visuelles
(décision 1) devra être tranché : soit les rendre configurables, soit assumer que 6 macros restent
sans effet pour la durée du MVP.

## Étape 14 — P12 : interface utilisateur et timeline

Fait et vérifié : premier branchement RÉEL de bout en bout — import de fichier → `AudioEngine` (P3)
→ démixage → Worker d'analyse (P4, jamais instancié avant cette étape) → `finalizePmdi` (P10) →
suggestion de preset (P11) → `MusicTimeline` (P5) → `BehaviourEngine` (P6) → `Scene` (P7/P9) →
`Canvas2DRenderer` → `FlashLimiter`, piloté par un `Transport` RÉEL au lieu de l'horloge synthétique
du harnais. Nouveaux : `audio/downmix.ts` (+`AudioEngine.decodedBuffer` getter additif),
`analysis/analyzeInWorker.ts` (bootstrap du Worker, jusqu'ici manquant), `ui/pipeline.ts`
(`importTrack`, orchestration testable par injection de la fonction d'analyse), `ui/seekPriming.ts`
(rattrapage de seek, docs/02, testé), `ui/timeline/{timelineLayout.ts,Timeline.ts}` (maths pures
testées + canvas direct : waveform, ticks de mesures, blocs de sections, tête de lecture, scrub
souris/tactile), `ui/demoDoc.ts` (document + WAV synthétiques pour un bouton démo sans fichier),
`ui/panels/{SimplePanel,AdvancedPanel}.ts`, `ui/dialogs/{ExportDialog,PresetEditorDialog}.ts`,
`ui/App.ts` (orchestrateur). `index.html` réécrit en app réelle (import glisser-déposer, preview,
transport, frise, panneaux Simple/Avancé, dialogues) ; `main.ts` (harnais P7/P9/P11) **supprimé** —
chaque brique qu'il exerçait est déjà testée isolément. 25 nouveaux tests (`downmix` 4,
`seekPriming` 7, `timelineLayout` 9, `uiPipeline` 5 — total **55 fichiers/304 tests**). `npx tsc
--noEmit` : 0 erreur. `npx vitest run` : **304/304** verts. `npm run test:arch` : 1/1 — `ui`
respecte les couches déjà autorisées, `audio`/`analysis` restent dans leurs bornes malgré les ajouts.
`npm run build` : succès, 150 modules, le Worker se scinde correctement en chunk séparé
(`worker-*.js`, 16,5 ko) — confirme que `new Worker(new URL(...))` est bien reconnu par Vite.

Vérification navigateur : **assistée par Aaron**, pas autonome — le panneau Browser intégré refusait
toute navigation cette session (« blocked by policy », y compris vers un site public), et le second
canal (extension Chrome/Edge connectée) était bloqué par liste de sites approuvés vide côté
extension ; aucun des deux n'a pu être débloqué malgré plusieurs tentatives et un redémarrage. Aaron
a testé directement dans Edge (`localhost:5174`) suivant une checklist de 9 points : import réel,
lecture synchronisée, scrub, changement de preset/macro, panneau Avancé (style + Énergie), plein
écran, éditeur de preset, export (téléchargement obtenu), bouton démo. Tout confirmé fonctionnel.

**Un vrai bug trouvé et corrigé grâce à ce test** : Aaron a signalé que le visuel ne bougeait
« pas parfaitement en rythme » en lecture réelle. Cause identifiée en relisant `AudioEngine.tick()` :
`audioEngine.dt` est le delta BRUT (non corrigé) entre deux images, alors que `audioEngine.t` seul
porte la correction de dérive de `correctDrift()` (convergence douce, ±2 ms/image, vers l'horloge
audio réelle — docs/02/03). La boucle de rendu alimentait l'accumulateur à pas fixe avec `dt` brut :
`simT` (l'horloge de simulation) n'héritait donc JAMAIS de cette correction et s'écartait lentement
de la position audio réelle au fil de la lecture — exactement le symptôme rapporté (pas cassé, juste
imparfait, et pire sur les lectures longues). Corrigé en alimentant l'accumulateur avec le DELTA de
`audioEngine.t` d'une image à l'autre plutôt que `dt` (voir `ui/App.ts`, `loop()`, et docs/02/03 mis
à jour). Aaron a retesté après correctif : amélioration confirmée (« un peu mieux qu'avant », sans
le motif d'un décalage constant ni d'une dérive croissante) — l'imprécision résiduelle relève de la
précision de détection des beats elle-même (limite connue, documentée, bloquée sur corpus annoté
depuis l'Étape 2), pas d'un bug de synchronisation.

Décisions de conception (tranchées et documentées, non soumises à Aaron avant implémentation — coût
d'erreur <1 jour ; deux ont ensuite été corrigées en cours de vérification suite au test réel) :
(1) `applyActiveConfiguration()` (`ui/App.ts`) ne reconstruit la `Scene` QUE si le style change
réellement (`sceneStyleId` comparé à la cible) — reconstruire à chaque glissement de macro aurait
vidé le pool de particules (`ParticleField`) et la traînée de feedback (`FrameFeedback`) à chaque
toucher de curseur. À style inchangé, seule la palette est réinjectée via `scene.init()`. **Limite
assumée, non corrigée** : `BehaviourEngine`, lui, EST reconstruit à chaque appel (pas de méthode pour
changer son `mapping` sans se reconstruire) — un glissement de macro pendant la décroissance d'un
impact produit un bref à-coup sur l'enveloppe en cours. Retoucher `BehaviourEngine` (livré et vérifié
en P6) est hors périmètre de cette étape. (2) L'éditeur de preset JSON ne produit pas un diff sur
`resolvePreset({userMappingOverrides})` (mécanisme prévu par l'Étape 13/P11) mais remplace la
configuration active EN ENTIER (`customPreset` dans `ui/App.ts`) — plus simple, et couvre en plus
palette/classification/safety que le diff mapping-only ne couvrait pas. (3) `style`/`macros`/`safety`
sont TOUJOURS pris depuis l'état local (`currentStyleId`/`currentMacros`/`reducedFlashing`) et
appliqués PAR-DESSUS le preset actif (catalogue ou édité) dans `activePresetObject()` — sinon changer
de style depuis le panneau Avancé n'aurait aucun effet tant qu'un preset reste sélectionné (bug
auto-détecté en relecture avant tout test navigateur, jamais montré à Aaron). (4) Le bouton « Charger
une démo » synthétise un vrai fichier WAV (ton 220 Hz, encodeur PCM 16 bits écrit à la main,
~40 lignes) et le fait passer par le VRAI `AudioEngine.load()`/`decodeAudioFile()` — un raccourci
sans fichier réel aurait laissé `audioEngine.play()` totalement inerte (`if (!this.decoded ||
this.playing) return`), un bug auto-détecté en relisant `AudioEngine.ts` avant tout test. (5)
Décision NON prise dans cette étape, contrairement à ce que l'entrée précédente envisageait : la
configurabilité des couches visuelles (6 des 8 macros, `layers.*`) reste non câblée — P12 porte
l'intégration UI, pas une refonte de `visual/` déjà livrée et vérifiée (P7/P9) ; le statu quo de P11
est reconduit tel quel, panneaux honnêtes (⚠) inclus. (6) Durée d'export = durée RÉELLE du morceau
(`timeline.duration`) — le champ « durée à exporter » du harnais (une commodité de test P8) a été
retiré, il n'a plus de sens en usage réel.

Fait mais non vérifié : l'effet exact de « Appliquer » dans l'éditeur de preset JSON n'a été confirmé
qu'à moitié par Aaron (« je pense que ça se répercute ») — pas de contre-preuve, mais pas une
confirmation ferme non plus. `RealtimeProbe` (P3) reste totalement non câblé — ni avant cette étape
ni par elle ; purement décoratif d'après docs/03, non bloquant. Le repli `MediaRecorder` n'applique
toujours pas le watermark (limite héritée de P8, inchangée). Aucun essai délibéré d'import d'un
fichier non audio (le chemin d'erreur existe — `AudioValidationError` catché, message affiché — mais
non exercé en conditions réelles). Aucune mesure chiffrée du fps de l'interface ni de la latence de
scrub (le critère docs/14 « ≤40 ms/saut, ≥55 fps » n'a été jugé qu'au ressenti par Aaron, pas
instrumenté).
Limites connues : la dérive de synchronisation résiduelle après correctif est attribuée à la
précision de détection des beats (documentée, docs/05, 70-85 % réel), pas reproduite/quantifiée
formellement — seul le ressenti d'Aaron avant/après le correctif de dérive d'horloge fait foi ici.
Pas de limitation de fréquence (throttle) sur les événements `pointermove` du scrub — chaque
mouvement déclenche un rattrapage complet ; non signalé comme un problème par Aaron, mais non
mesuré non plus.
Dette introduite : aucune connue — `main.ts` supprimé proprement (récupérable via l'historique git,
rien d'autre ne l'important).
Bloque la suite : le corpus annoté (Aaron) reste le seul bloqueur pour la F-mesure et le critère de
suggestion de preset, inchangé depuis l'Étape 2. La configurabilité des couches visuelles (6 macros
inertes) reste un choix à trancher un jour, reporté une seconde fois — candidate pour une étape
dédiée future plutôt que pour continuer à être repoussée en fin d'étape. Prochaine étape (00a) :
Étape 15 (P13, projet et persistance).

## Étape 15 — P13 : projet et persistance

Fait et vérifié : `project/Project.ts` (modèle + `validateProject()`, tolérant à l'inconnu — même
principe que `validatePmdi.ts`/`presets/schema.ts`), `project/migrate.ts` (`migrate()`, refus
explicite d'une version future, `MIGRATIONS` vide — v1 est la première), `project/zip.ts` (lecteur/
écrivain ZIP maison, méthode STORE, CRC-32 maison — table + calcul, vérifiés au format binaire réel
avec octets arbitraires 0..255), `project/pvproj.ts` (`writePvproj`/`readPvproj`, extrait/réinjecte
`music.pmdi.json` séparément de `project.json`), `project/cacheKey.ts` (SHA-256 via Web Crypto —
littéralement l'algorithme nommé par docs/13, pas un hash maison), `project/diff.ts`
(`computePresetDiff`/`applyPresetDiff`, chemins pointés génériques), `project/lru.ts`
(`selectEvictions`, pur), `project/storage/db.ts` (IndexedDB : 4 magasins, éviction LRU,
`navigator.storage.persist()`). UI : bouton « Projets » (liste avec vignettes, ouvrir/supprimer),
« Nouvelle variante » (régénère la graine), sauvegarde automatique par diff toutes les 5 s, export/
import `.pvproj`, dialogue de ré-association audio par empreinte. `tests/unit/architecture.test.ts`
étendu : couche `project` autorisée à importer `music` uniquement. 50 nouveaux tests répartis sur 7
fichiers (`project` 8, `migrate` 6, `zip` 9, `pvproj` 7, `cacheKey` 6, `diff` 10, `lru` 5 — total
**62 fichiers/354 tests**). `npx tsc --noEmit` : 0 erreur. `npx vitest run` : **354/354** verts.
`npm run test:arch` : 1/1. `npm run build` : succès, 158 modules, 299,45 ko (gzip 81,77 ko).

Trois bugs réels trouvés et corrigés en cours de route, avant toute vérification navigateur :
(1) `computePresetDiff` perdait silencieusement un sous-arbre entier quand la base n'avait pas
encore la clé correspondante (`base={}`, `modified={macros:{glow:0.85}}` → diff vide au lieu de
`{"macros.glow":0.85}`) — la récursion exigeait que les DEUX côtés soient déjà des objets, alors
qu'un champ absent doit être traité comme `{}` pour continuer la récursion et rapporter chaque
feuille comme nouvelle. Trouvé par un test unitaire, pas au navigateur. (2) `startNewProjectIdentity`
utilisait le même nom (débarrassé de son extension, pour le TITRE du projet) à la fois pour
`projectName` ET `audioFileName` — la référence audio stockée dans `AudioRef.name` aurait donc perdu
son extension, cassant la ré-association par nom+hash (docs/13) en silence. Trouvé en relisant le
code, pas testé automatiquement (dépend de l'UI). (3) `readPvproj` : la première version exigeait
`music.pmdi` présent quand `music.mode === "pmdi"` même en lisant `project.json` juste après l'avoir
extrait vers sa propre entrée à l'écriture — `validateProject` rejetait alors son propre format de
fichier. Corrigé en ré-injectant le PMDI lu dans `project.music.pmdi` avant validation.

Décisions de conception (tranchées et documentées, non soumises à Aaron — coût d'erreur <1 jour) :
(1) ZIP en méthode STORE uniquement, aucun DEFLATE — l'audio embarqué est déjà compressé par son
propre codec, `project.json`/`thumbnail.jpg` sont petits ; implémenter un compresseur à la main pour
ce gain marginal aurait été disproportionné (même logique qu'ADR-003/ADR-007). Reste un `.zip`
valide, ouvrable par n'importe quel outil standard — vérifié par aller-retour complet en test, pas
seulement par inspection du format. (2) `PresetDiff` (docs/13) ne type ses valeurs qu'en primitives
(number|string|boolean) — `computePresetDiff` IGNORE délibérément les différences de type tableau
(`palette.bg`, `layers.*.lifetime`) plutôt que de les encoder en JSON dans un champ censé être une
primitive : une fausse représentation qui ne se recharge pas correctement est pire qu'une absence.
(3) `visual.overrides` ne couvre que macros/style/`prefs.reducedFlashing`, pas les presets édités
via l'éditeur JSON (Étape 14/P12) — un tel preset personnalisé ne survit pas à une fermeture/
réouverture. Documenté en détail dans docs/13_PROJECT_FORMAT.md. (4) L'UI de sauvegarde ne propose
que le mode « Léger » (audio référencé par hash) — le mode « Complet » (audio embarqué) est
implémenté côté format/lecture (`writePvproj`/`readPvproj`/`restoreProject` le gèrent tous) mais
aucun bouton ne le déclenche à l'écriture. (5) Vignette = image actuellement affichée au moment de la
sauvegarde, pas « à 25 % de la durée » comme suggéré par docs/13 — chercher à 25 % pour la seule
capture aurait perturbé une écoute en cours ; simplification délibérée.

Fait mais non vérifié : **vérification navigateur en attente** — IndexedDB, sélection/téléchargement
de fichiers et `crypto.subtle` en conditions réelles n'ont pas encore été testés à l'œil par Aaron
(contrairement à `computeAudioHash`/`computePresetDiff`/le format ZIP lui-même, tous vérifiés par
test unitaire réel, pas seulement lus). Checklist fournie à Aaron : importer un morceau, attendre la
sauvegarde automatique (badge "Enregistré HH:MM:SS"), recharger la page, ouvrir "Projets", charger le
projet, confirmer que le rendu redémarre identique (même style/palette/macros) ; renommer le fichier
audio source sur le disque et reconstruire pour vérifier que la ré-association par empreinte
fonctionne ; "Nouvelle variante" puis vérifier que le rendu change perceptiblement sans que le son
saute ; exporter en `.pvproj` puis le réimporter dans un nouvel onglet.
Limites connues : aucune UI pour vider les caches ni afficher l'espace occupé (`getCacheUsage`/
`clearCaches` existent, non appelés). `cacheAudio` réécrit parfois un blob déjà en cache (après un
`getCachedAudio` qui l'a déjà "touché") — redondant, pas incorrect, non optimisé faute d'enjeu réel
(un seul appel par chargement de projet, pas un chemin chaud). Mode "pmdi" (Mode B, PULSAR) codé et
testé au niveau format (`pvproj.test.ts`) mais jamais exercé par l'UI — aucune intégration PULSAR
n'existe encore dans ce projet.
Dette introduite : aucune connue.
Bloque la suite : vérification navigateur de cette étape à faire par Aaron avant de la considérer
pleinement close. Le corpus annoté reste le seul bloqueur pour la F-mesure, inchangé depuis
l'Étape 2. Prochaine étape (00a) : Étape 16 (P14, performance).

## Étape 16 — P14 : performance

Fait et vérifié : `perf/qualityLevels.ts` (table des 4 niveaux de docs/10, `FIXED_SIMULATION_DT`
séparé — jamais par niveau — et `EXPORT_QUALITY_LEVEL`), `perf/QualityGovernor.ts` (fenêtre p95 de
90 images, seuils 20 ms/2 s et 12 ms/8 s, cooldown de remontée 1×/minute, horloge injectable,
`setManualLevel`/`resetAuto`), `perf/PerfMonitor.ts` (tampon circulaire `Float32Array` sans
allocation par image, FPS/p50/p95/p99 + Update/Rendu). `ParticleField` rendu configurable
(constructeur `maxParticles`, défaut 2500 = comportement byte-identique — les 8 tests existants
passent sans modification) ; `createFieldStyle(maxParticles?)` transmet le plafond. `ui/App.ts` :
`STYLE_FACTORIES` retypé pour accepter le plafond (`pulse`/`spectrum-pro` l'ignorent silencieusement,
seul `field` le consomme) ; `applyQualityLevel()` reconstruit la Scene du style `field` quand le
niveau change (auto ou manuel) ; boucle de rendu mesurant `updateMs`/`renderMs` par image et nourrissant
`perfMonitor`/`qualityGovernor` ; export TOUJOURS figé à `EXPORT_QUALITY_LEVEL` (HIGH) via
`getStyleFactory`, indépendamment du niveau de preview (règle non négociable #2) ; `exportInProgress`
(callbacks `onExportStart`/`onExportEnd` ajoutés à `ExportDialog`) coupe l'alimentation du gouverneur
pendant un export pour ne pas dégrader la preview à tort. `AdvancedPanel` : sélecteur de qualité
manuel (`#quality-select`, callback `onQualitySelect`, méthode `selectQuality()`). Persistance :
`project.prefs.quality` (type `Quality` déjà anticipé en P13, resté un stub `'auto'` jusqu'ici)
réellement câblé en écriture (`buildCurrentProject`) et en lecture (`restoreProject`,
`resetAuto`/`setManualLevel` selon le cas). `Layer.particleStats?()` (optionnel, implémenté par
`ParticleField`) et panneau debug (`#debug-state`) étendu avec Qualité/Particules/Sync
(`out-quality`/`out-particles`/`out-sync`). `tests/unit/architecture.test.ts` : couche `perf` ajoutée
(`['core']`). 17 nouveaux tests répartis sur 2 fichiers (`qualityGovernor` 11 dont `resetAuto`,
`perfMonitor` 6 — total **64 fichiers/371 tests**). `npx tsc --noEmit` : 0 erreur. `npx vitest run` :
**371/371** verts. `npm run test:arch` : 1/1. `npm run build` : succès, 161 modules, 304,76 ko (gzip
83,42 ko).

Trois bugs réels trouvés et corrigés en cours de route, avant toute vérification navigateur :
(1) `QualityGovernor` initialisait `manualCeiling = initialLevel` dans le constructeur — un
gouverneur fraîchement construit ne pouvait donc JAMAIS remonter automatiquement, sauf à démarrer
déjà à "ultra". Trouvé par inspection en écrivant le test de cooldown (pas par un test qui échoue),
avant tout run. Corrigé : le plafond par défaut est "ultra" (libre), seul `setManualLevel` le
restreint. (2) Premier jet du test de "reprise durable" conceptuellement faux : une seule image
rapide au milieu d'une série lente ne fait PAS repasser le p95 (statistique d'ordre, index ≈84,55 sur
90) sous le seuil — c'est exactement pourquoi docs/10 préfère p95 à la moyenne, propriété qui vaut
aussi dans l'autre sens. Réécrit en récupération soutenue (~90 images) + vérification différentielle
de continuité (une reprise de mauvaises performances de courte durée après la récupération ne
redéclenche pas immédiatement — preuve que le chrono interne a bien été remis à zéro). (3) Lors du
câblage de `restoreProject`, gap réel identifié : `setManualLevel` seul ne permet pas de revenir en
mode "auto" après qu'un plafond manuel a été posé PAR UN AUTRE PROJET dans la même session — le
plafond resterait verrouillé à tort. Ajout de `QualityGovernor.resetAuto()` (lève le plafond, purge
l'historique), avec son propre test.

Décisions de conception (tranchées et documentées, non soumises à Aaron — coût d'erreur faible) :
(1) `PerfMonitor.fps` = moyenne sur la fenêtre, délibérément DISTINCT de `p50Ms` (médiane) — reproduit
l'écart visible dans l'exemple chiffré de docs/10 (« FPS 58,2 (p50 16,1 ms …) », où 1000/58,2 ≠ 16,1)
et donne à voir la différence entre un chiffre "vécu" (sensible aux images lentes) et un chiffre
"typique" (robuste). (2) Fenêtre de `PerfMonitor` = 90 images, alignée sur celle de `QualityGovernor`
bien que non imposée par docs/10 pour ce module — les deux décrivent alors la même période d'environ
1,5 s à l'écran. (3) Seuil "Sync" ✅ = un sous-pas de simulation (`FIXED_DT`, 1/120 s ≈ 8,33 ms) — non
chiffré par docs/10 au-delà de l'exemple, choisi comme le plus petit écart que la boucle à pas fixe
ne peut pas rattraper en une seule image. (4) Un changement de niveau de qualité en style `field`
reconstruit la Scene (perte des particules vivantes) faute d'autre moyen de redimensionner un
`Float32Array` de taille fixe — accepté car rare par construction (2 à 8 s de tenue, 1×/minute en
remontée). (5) Sélecteur de qualité manuel placé dans le panneau Avancé (contrôle utilisateur
normal, à la façon d'un réglage graphique de jeu vidéo), pas dans le panneau debug — la ligne
"Qualité" du panneau debug reste un AFFICHAGE, pas un contrôle. (6) `pulse`/`spectrum-pro` acceptent
silencieusement un `maxParticles` ignoré (signature commune `(maxParticles?: number) => Scene` aux
trois usines de style) plutôt qu'un branchement par style à chaque appel — JS ignore les arguments
surnuméraires, sans risque.

Fait mais non vérifié : **vérification navigateur en attente**. Les deux outils de navigateur
disponibles cette session ont refusé de charger `http://localhost:3000` (pane interne : « denied or
failed » ; Chrome connecté : « blocked by your site permissions ») — problème déjà rencontré sur ce
projet, pas spécifique à cette étape. Checklist fournie à Aaron : charger la démo, ouvrir Avancé →
Qualité, passer manuellement par les 4 niveaux et confirmer à l'œil que la densité de particules
change en style Field (les autres styles ne doivent visuellement RIEN changer) ; ouvrir le panneau
debug et vérifier que "particules" affiche bien `n / plafond` cohérent avec le niveau choisi, que
"qualité" affiche `(manuel)` après un choix explicite ; laisser tourner plusieurs minutes avec
beaucoup d'onglets/fenêtres ouverts pour tenter de provoquer une vraie descente automatique (`p95 >
20 ms` pendant 2 s) et confirmer le passage à `(auto)` ; lancer un export et vérifier que le niveau de
preview affiché ne change pas de façon disruptive pendant que l'export tourne ; sauvegarder un projet
avec un niveau manuel, recharger la page, rouvrir "Projets" et confirmer que le niveau restauré est le
bon (pas "auto").
Limites connues : `bloom`/`feedback`/`chromaticAberration`/`internalResolutionScale`/`spectrumBands`
déclarés dans `QUALITY_LEVEL_CONFIGS`, sans consommateur réel — seul `maxParticles` a un effet.
L'étage « modulé par la macro `density` » du nombre de particules (docs/10) n'existe pas : `density`
reste une macro inerte depuis l'Étape 13/P11. Le panneau debug n'affiche que Qualité/Particules/Sync
— Rendu/Update (barres), p50/p95/p99 et Couches/Mémoire restent NON affichés bien que
`PerfMonitor.snapshot()` calcule déjà Rendu/Update/p50/p95/p99 (pas Couches/Mémoire, jamais
implémentés). Pas de bouton "revenir en auto" dans le sélecteur UI — `resetAuto()` n'est câblé qu'à
la restauration de projet, docs/10 ne demande pas explicitement un tel bouton. Les cas de charge de
docs/10 §"Cas de charge à tester explicitement" (morceau 10 min, flot hyperpop, redimensionnement
continu, scrub rapide, onglet en arrière-plan, export pendant lecture externe, 2 h continues) restent
tous non exercés — inchangé depuis les étapes précédentes, pas spécifique à celle-ci.
Dette introduite : aucune connue.
Bloque la suite : vérification navigateur de cette étape à faire par Aaron avant de la considérer
pleinement close (même situation qu'aux étapes 14/15). Le corpus annoté reste le seul bloqueur pour
la F-mesure, inchangé depuis l'Étape 2. Prochaine étape (00a) : Étape 17 (P15, tests et
durcissement).

## Étape 17 — P15 : tests et durcissement

Fait et vérifié : `tests/bench/scoring.ts` (`scoreEvents` — F-mesure MIREX à tolérance fixe,
appariement glouton par plus proche voisin non apparié ; `isTempoAccurate` — critère ± 2 %),
`tests/unit/scoring.test.ts` (13 tests : cas parfait, FP/FN, non-double-appariement, ensembles
vides, bornes de tolérance choisies pour être exactes en virgule flottante). `tests/bench/
analysis.bench.test.ts` (docs/11 Niveau 4, `npm run bench:analysis`) : signal synthétique
déterministe (PRNG seedé) de 4 min à 44100 Hz, `runAnalysisPipeline` + `finalizePmdi` appelés
directement (fonctions pures, pas besoin de Worker/navigateur), chronométrage total ET par étape via
`onProgress`. `vitest.bench.config.ts` : config séparée, `tests/bench/**/*.test.ts` exclu de
`vitest.config.ts` — les bancs sont lents par nature, hors de la boucle rapide de `npm test`.
15 nouveaux tests unitaires (`scoring` 13 ; `bench:analysis` a son propre test, hors du compte
`vitest run` puisqu'une config séparée l'exclut — total suite rapide **65 fichiers/384 tests**).
`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **384/384** verts. `npm run test:arch` : 1/1.
`npm run build` : succès, 161 modules, 304,76 ko (gzip 83,42 ko) — inchangé, aucun code de `src/`
livré à l'app cette étape (uniquement de l'outillage de test).

**Découverte réelle de cette étape** (pas un bug du banc — une mesure honnête d'un critère jamais
mesuré avant aujourd'hui) : `npm run bench:analysis` échoue. Pipeline complet sur un signal
synthétique de 4 min : **19,5 s** au lieu du seuil documenté de 8 s (docs/11, docs/00b §6) — environ
2,4× le budget. Répartition par étape : `resample` (6,6 s) et `bassContour` (9,4 s) représentent à
eux deux ~82 % du total ; `stft` (1,7 s) loin derrière ; le reste (waveform/features/onsets/tempo/
beats/downbeats/descriptors/finalize) est négligeable (< 1 s cumulé). Corriger ces deux fonctions est
un travail d'optimisation à part entière, hors périmètre de cette étape (qui construit le banc, pas
le correctif) — signalé pour une session dédiée (`spawn_task`, titre « Optimiser resample()/
bassContour() »). Le test reste volontairement ROUGE dans le dépôt : documenter honnêtement un écart
mesuré plutôt que masquer l'assertion (docs/00b §5, interdit formel : « passer à la phase suivante
avec une erreur connue non documentée »). N'affecte pas `npm test`/`npm run build`
(`vitest.bench.config.ts` isole `tests/bench/` de la suite rapide).

Décision de conception (tranchée et documentée, non soumise à Aaron) : appariement glouton plutôt
qu'optimal (hongrois) pour `scoreEvents` — les événements rythmiques visés sont peu denses (jamais
deux détections à quelques ms l'une de l'autre en pratique), l'écart avec l'optimal est nul dans ce
régime, et un algorithme glouton est bien plus simple à auditer à la main pour un projet de cette
taille.

Fait mais non tenté : les niveaux 2 (corpus annoté réel, 22 morceaux, F-mesure sur données réelles),
3 (rendu golden — hachage SHA-256 d'images, équivalence preview/export au pixel, non-régression
visuelle) et 4 restant (`bench:render`/`bench:export`/`bench:memory`/`bench:leak`) de docs/11 ne sont
PAS implémentés cette étape. Raison commune aux trois derniers : `vitest.config.ts` tourne en
`environment: 'node'`, sans Canvas ni `performance.memory` ni WebCodecs — les rendre testables sans
navigateur exigerait une dépendance native (`node-canvas` ou assimilé), une décision d'ADR non prise
ici plutôt qu'ajoutée en silence (docs/00b §5, interdit formel : « ajouter une dépendance sans
ADR »). Le niveau 2 reste bloqué par l'absence de corpus réel, inchangée depuis l'Étape 2 — seule la
MÉCANIQUE de notation (`scoring.ts`) a avancé cette étape, prête à consommer un corpus le jour où il
existera. Niveau 5 (matrice navigateurs, scénarios manuels) : intrinsèquement non automatisable,
liste déjà complète dans docs/11, à exécuter par Aaron.
Limites connues : `bench:analysis` échoue (voir « Découverte réelle » ci-dessus) — c'est un résultat
honnête, pas une régression de cette étape (le critère n'avait jamais été mesuré avant). `scoreEvents`
utilise un appariement glouton, pas optimal (voir décision de conception). Aucun corpus audio réel
dans `tests/fixtures/` — seulement deux fichiers `.pmdi.json` sans rapport (pont PMDI Beat Studio,
Étape hors roadmap de ce document). `tools/annotate/` existe mais n'a annoté aucun morceau.
Dette introduite : aucune connue (le test `bench:analysis` rouge est un signal, pas de la dette —
documenté explicitement, pas caché).
Bloque la suite : la correction de `resample()`/`bassContour()` (signalée en tâche séparée) et
l'acquisition d'un corpus annoté restent les deux prérequis pour clore réellement docs/11. Prochaine
étape (00a) : Étape 18 (P16, finition et mise en ligne).

## Étape 18 — P16 : finition et mise en ligne

**Dernière étape de la feuille de route (00a) — 18/18 étapes parcourues.** Périmètre RÉDUIT par
rapport à docs/14_ROADMAP.md §P16 (« écran d'accueil, morceau de démonstration embarqué, textes,
licence, page produit, analytique locale optionnelle, empaquetage ») : voir « Limites connues » pour
ce qui a été délibérément laissé de côté et pourquoi.

Fait et vérifié : `index.html` — tagline d'accueil dans `#dropzone` (reprend la promesse d'une phrase
de docs/01_VISION.md : « transforme un morceau en vidéo musicale synchronisée, en local, en moins de
deux minutes »), sous-titre « 100 % local... aucun upload, aucun compte », `<meta name="description">`,
`<meta name="viewport">` (absente jusqu'ici). Textes adoucis : les avertissements « ⚠ pas encore
câblée à un rendu visuel (voir docs/JOURNAL.md, Étape 13/P11) » (Simple, Avancé) et deux autres
références internes (« docs/10_PERFORMANCE.md » dans la note Qualité, « docs/08_PRESETS.md » dans le
dialogue d'édition de preset) reformulés sans référence à un fichier de conception interne —
`src/ui/panels/AdvancedPanel.ts` (tooltip des macros non câblées) mis à jour en cohérence.
Audit mise en ligne (`npm run build`) : `dist/` est un site statique pur, aucun backend requis (ADR-001) ;
le Worker d'analyse est instancié via `new Worker(new URL('./worker.ts', import.meta.url))` — motif
Vite portable, pas de chemin absolu codé en dur ; taille du bundle 304,73 ko (gzip 83,39 ko), très en
dessous du budget de docs/00b (≤ 400 ko gzip) ; `dist/` déjà dans `.gitignore` (jamais commité, se
reconstruit à la demande). `npx tsc --noEmit` : 0 erreur. `npx vitest run` : **384/384** verts
(inchangé — aucune nouvelle logique cette étape, uniquement du texte/HTML). `npm run test:arch` : 1/1.
`npm run build` : succès.

Décision de conception (tranchée et documentée, non soumise à Aaron — coût d'erreur faible,
réversible) : les avertissements sur les macros inertes restent VISIBLES (pas de suppression des
curseurs Densité/Glow du panneau Simple, qui aurait exigé de toucher `SimplePanel.ts` et le typage de
`PresetMacros` pour un gain cosmétique modeste) — seule leur FORMULATION change. Un curseur qui ne
fait rien SANS explication serait pire (perçu comme un bug) qu'un curseur honnêtement annoncé « sans
effet pour l'instant », qui ne l'est plus une fois retiré la référence à un fichier de conception
interne, incompréhensible pour un utilisateur final.

Fait mais non vérifié : vérification navigateur en attente — les deux outils de navigateur
disponibles cette session ont de nouveau refusé de charger `localhost:3000` (même limite qu'aux
Étapes 16/17). Aaron : recharger l'app et confirmer que le nouvel écran d'accueil s'affiche
correctement (tagline lisible, pas de débordement de texte dans la zone de dépôt à différentes
tailles de fenêtre), et que les info-bulles des macros non câblées (survol, panneau Avancé)
affichent le nouveau texte.

Limites connues — périmètre P16 du roadmap volontairement PAS traité en entier, chaque point pour une
raison différente, aucun résolu en silence :
- **Licence** : absente. Choix d'une licence logicielle (MIT/propriétaire/source-available) a un
  impact commercial direct (le produit est positionné comme vendable — voir ADR-006, le watermark
  existant) ; décision d'Aaron, pas à trancher seul comme une simple case à cocher.
- **Page produit** : absente. Un site marketing séparé de l'application elle-même est un livrable
  distinct, hors du périmètre "application" que ce dépôt construit depuis l'Étape 1.
- **Analytique locale optionnelle** : absente. N'est PAS dans la liste "Inclus" du périmètre MVP
  strict de docs/00b §4 — l'ajouter serait une fonctionnalité nouvelle, pas de la finition, et
  soulève des questions de conception (quoi mesurer, où, opt-in comment) qui dépassent une décision
  à faible coût d'erreur.
- **Morceau de démonstration RÉEL embarqué** : toujours synthétique (`ui/demoDoc.ts`, depuis
  l'Étape 14/P12) plutôt qu'un vrai morceau produit "libre de droits" comme le prévoyait docs/11 —
  sourcer et licencier un morceau réel n'est pas à ma portée (aucun accès à une bibliothèque audio,
  et le choix engage Aaron). La démo synthétique remplit déjà le rôle fonctionnel (essayer l'outil
  sans importer son propre fichier).
- **Mise en ligne réelle** : non faite. Aucun hébergeur choisi, aucune information de déploiement
  fournie — action externe, potentiellement difficile à annuler (achat de domaine, configuration
  DNS), hors de mon autorité sans décision explicite d'Aaron. Note technique laissée pour quand ce
  choix sera fait : `vite.config.ts` n'a pas de `base` configuré (chemins d'assets racine-absolus,
  `/assets/...`) — correct pour un déploiement à la racine d'un domaine, à ajuster (`base:
  '/sous-chemin/'`) si l'hébergeur choisi sert l'app depuis un sous-chemin (ex. GitHub Pages "project
  pages").
Dette introduite : aucune connue.
Bloque la suite : les cinq points ci-dessus (licence, page produit, analytique, démo réelle,
hébergeur) sont des décisions produit/business à prendre par Aaron, pas des tâches techniques
restantes. Séparément : le corpus annoté (bloqueur inchangé depuis l'Étape 2) et l'optimisation
`resample()`/`bassContour()` (Étape 17/P15) restent ouverts. **Fin de la feuille de route
docs/00a_ORDRE_DES_ETAPES.md — 18/18 étapes parcourues.**

## Étape 19 — hors roadmap : correctif de performance (resample/bassContour)

**Hors de docs/00a** (la roadmap est close depuis l'Étape 18) : reprise du chantier signalé à
l'Étape 17/P15 (`bench:analysis` échouait, 19,5 s au lieu de 8 s, `resample`/`bassContour`
responsables de ~82 % du temps). Objectif : faire passer le banc, sans changer le comportement
observable (Loi 1, docs/00b) — les deux correctifs sont des restructurations de calcul, pas des
changements d'algorithme au sens mathématique.

Fait et vérifié : `src/analysis/resample.ts` réécrit en filtre polyphase précalculé. Constat : les
taux d'échantillonnage étant des entiers, `sourceRate/targetRate` est une fraction EXACTE réduite
par pgcd — la position fractionnaire dans le signal source ne prend donc qu'un nombre fini de
valeurs (phases), qui reviennent périodiquement. L'ancien code recalculait le noyau sinc/Blackman
(`sin`/`cos`) à CHAQUE échantillon de sortie (~169 M appels trigonométriques sur 4 min de signal) ;
le nouveau code précalcule le noyau une fois par phase (au plus quelques centaines), puis parcourt
les échantillons de sortie par simples additions/multiplications, avec un compteur de phase entier
incrémental (aucune division flottante par échantillon). Les indices hors du support d'origine ont
un poids `blackman()` exactement nul par construction — les inclure dans la somme élargie ne change
donc pas le résultat (0 + x = x, aucune perte de précision).

`src/analysis/bassContour.ts::trackPitch` réécrit pour calculer l'autocorrélation par FFT plutôt que
par somme directe. Constat : la somme directe coûtait O(plage de délais [110..802] × fenêtre [2048])
par image, sur ~10 300 images pour 4 min — plus de 11 milliards d'opérations. Remplacée par le
théorème de Wiener-Khinchin (autocorrélation = partie réelle de `IFFT(|FFT(x)|²)`), avec un
zero-padding à `AUTOCORR_FFT_SIZE = 4096` (≥ 2×la fenêtre de 2048) : la corrélation CIRCULAIRE ainsi
calculée coïncide EXACTEMENT avec la corrélation LINÉAIRE d'origine sur toute la plage de délais
utile (aucun terme ne peut « boucler » avec un padding suffisant — démontré dans le commentaire du
code et vérifié par test). `src/analysis/fft.ts::ifft` ajoutée (FFT inverse par le tour classique
« conjuguer, FFT directe, conjuguer, diviser par N » — ne duplique pas les papillons de `fft()`).

Chaque correctif est prouvé identique à l'ancien calcul par un test de régression DÉDIÉ qui compare
au code naïf d'origine recopié tel quel (pas seulement aux tests existants, plus tolérants) :
`tests/unit/resample.test.ts` (2 nouveaux tests, ratio 2:1 et ratio non entier, écart < 1e-9),
`tests/unit/bassContour.test.ts` (1 nouveau test, signal composite sinusoïde+bruit, écart < 1e-6
sur f0 et confidence, image par image), `tests/unit/fft.test.ts` (2 nouveaux tests pour `ifft` :
aller-retour `ifft(fft(x))==x`, et autocorrélation par Wiener-Khinchin == somme directe).

**Résultat mesuré** (`npm run bench:analysis`, même signal synthétique de 4 min qu'à l'Étape 17/P15,
même machine) : **19 587 ms → 5 666 ms** (×3,5). Détail par étape : `resample` 6 558 ms → 425 ms
(×15,4) ; `bassContour` 9 447 ms → 1 805 ms (×5,2) ; `stft` (1 686 ms, inchangé) devient l'étape la
plus coûteuse mais reste largement dans le budget. Le banc passe désormais sous le seuil documenté
de 8 s, avec ~2,3 s de marge.

5 nouveaux tests répartis sur 3 fichiers — total **65 fichiers/389 tests**. `npx tsc --noEmit` :
0 erreur. `npx vitest run` : **389/389** verts. `npm run test:arch` : 1/1. `npm run build` : succès,
inchangé (304,73 ko gzip 83,40 ko — code interne à `analysis/`, pas de nouvel import côté bundle
applicatif). `npm run bench:analysis` : **passe** (5 666 ms ≤ 8 000 ms).

Décision de conception (tranchée et documentée, non soumise à Aaron — chaque correctif prouvé par
test dédié, coût d'erreur faible) : restructuration du CALCUL, pas changement de MÉTHODE — le filtre
reste un sinc fenêtré Blackman de même largeur, l'autocorrélation reste la même somme de produits ;
seule la manière d'atteindre le même résultat change (précalcul périodique / domaine fréquentiel).
Choix délibéré plutôt qu'une méthode plus rapide mais numériquement différente (ex. filtre IIR pour
le rééchantillonnage, YIN au lieu de l'autocorrélation pour la hauteur) : le risque de dérive sur la
qualité de détection (docs/11 Niveau 2, F-mesure) aurait été réel et non mesurable sans corpus —
alors qu'une restructuration pure, prouvée identique par test, ne peut pas la dégrader.

Limites connues : le gain n'a été mesuré qu'une fois, sur une seule machine (le nombre absolu peut
varier ailleurs, mais le facteur d'accélération, lié à la complexité algorithmique et non au
matériel, doit rester comparable). `stft` (1,7 s) et le reste du pipeline n'ont pas été touchés —
marge suffisante aujourd'hui, mais pourraient redevenir le facteur limitant si `bench:analysis`
était un jour exécuté sur un signal plus long ou une machine plus lente (aucun seuil CI n'existe
encore pour ce banc, voir docs/11 Niveau 4). `bench:render`/`bench:export`/`bench:memory`/
`bench:leak` restent hors de portée de l'environnement Node de test (inchangé depuis l'Étape 17).
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu pour ce chantier précis. Restent ouverts, sans lien
avec ce correctif : le corpus annoté (Étape 2), et les cinq décisions produit/business de l'Étape 18
(licence, page produit, analytique, démo réelle, hébergeur).

## Étape 20 — hors roadmap : câblage des 6 macros inertes (densité, mouvement, profondeur, glow, chaos, douceur)

**Hors de docs/00a** (roadmap close depuis l'Étape 18). Limite documentée depuis l'Étape 13/P11
(docs/08_PRESETS.md §"Les 8 macro-contrôles") : seules `energy`/`reactivity` avaient un effet câblé,
faute de couche acceptant des paramètres de construction. Proposition détaillée (table macro × style
× paramètre × plage) présentée et validée par Aaron AVANT tout code.

Fait et vérifié : `src/presets/layerMacros.ts` (nouveau) — `LAYER_MACRO_CURVES`, même mécanique
`MacroCurveTable`/`applyMacroCurves` que `WIRED_MACRO_CURVES`, chemins `<styleId>.<layerId>.
<paramKey>`. `ui/App.ts::applyLayerMacros()` — résout la table pour les macros courantes et assigne
`layer.params` de chaque couche de la Scene active, appelée depuis `applyActiveConfiguration()` (à
chaque changement de macro/preset/style) et `applyQualityLevel()` (après une reconstruction de Scene
déclenchée par un changement de niveau de qualité) — **sans jamais reconstruire la Scene pour un
simple changement de macro** : pool de particules et traînée de feedback intacts pendant qu'on
bouge un curseur. 6 couches câblées : `ParticleField` (spawnCountMul, driftSpeed, glowAlphaMul,
chaosMul, drag), `PerspectiveGrid` (rows, perspective), `PulseRings` (maxActiveRings, lifetimeSec,
chaosJitter), `CentralGlow` (intensityMul, diameter), `ScreenShake` (decaySec), `SpectrumBars` (gap,
riseTau, fallTau, reflectionAlpha, glowAlphaMul, peakChaosJitter). `AdvancedPanel.ts` :
`WIRED_MACROS` étend désormais les 8 macros (retrait de l'icône ⚠ et du tooltip « sans effet »).
`index.html` : retrait des avertissements devenus faux (Simple : Densité/Glow ; Avancé : note
générale, remplacée par la mention honnête que Profondeur n'a pas d'effet en Pulse). 25 nouveaux
tests unitaires (dont `tests/unit/centralGlow.test.ts`, nouveau — cette couche n'avait aucun test
dédié avant cette étape) répartis sur 6 fichiers — total **66 fichiers/414 tests**.
`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **414/414** verts. `npm run test:arch` : 1/1.
`npm run build` : succès, 162 modules, 307,40 ko (gzip 84,18 ko — toujours largement sous le budget
de 400 ko de docs/00b).

Deux bugs réels trouvés et corrigés avant/pendant l'implémentation, avant toute vérification
navigateur : (1) Conflit de conception détecté PENDANT l'écriture de la table (avant tout code) :
mon esquisse initiale proposait de faire piloter les MÊMES constantes (`riseTau`/`fallTau` de
`SpectrumBars`) par deux macros différentes (Mouvement ET Douceur, en sens opposés) — `applyMacroCurves`
écrase silencieusement une macro par l'autre selon l'ordre d'itération (`Object.entries`), ce qui
aurait rendu l'une des deux invisible sans qu'aucun test ne le révèle nécessairement. Corrigé en
séparant strictement : Mouvement → `riseTau` (attaque), Douceur → `fallTau` (retombée) — chemins
disjoints, aucune collision possible, vérifié explicitement dans le commentaire en tête de
`layerMacros.ts`. (2) Bug dans un test, pas dans le produit : le test de `driftSpeed` de
`ParticleField` réutilisait le même `StepContextBuilder` (état interne : dernier `t` vu) entre deux
exécutions indépendantes du champ de particules — la seconde exécution « reculait dans le temps »
et l'événement HAT ne se déclenchait plus. Trouvé par l'échec du test lui-même (`lastDrawSprite`
retournait `undefined`), corrigé en donnant un `stepper` frais à chaque exécution.

Décisions de conception (tranchées et documentées, non soumises à Aaron une fois le plan
d'ensemble validé — coût d'erreur faible, chaque choix commenté dans `layerMacros.ts`) : (1)
`Impulse`/`Continuous` (behaviour/signals) NE sont PLUS utilisées par `ScreenShake`/`SpectrumBars` —
leurs `decay`/`riseTau`/`fallTau` sont `private readonly`, fixés au constructeur ; un macro doit
pouvoir les faire varier à tout instant pendant la lecture, et recréer l'objet à chaque changement
réinitialiserait sa valeur courante (tremblement coupé net, barres qui sautent à 0). Les deux
couches recopient à la main les 2-3 lignes de calcul plutôt que de rendre `decay` mutable sur des
primitives partagées par tout `behaviour/` (`Impulse` alimente aussi `impact`/`subImpact`/`accent`/
`tick`/`sectionShift` via `BehaviourEngine`, hors périmètre de cette étape). (2) `chaos` ne consomme
JAMAIS de nouveau tirage `step.rng.next()` par image sur les pools larges (particules) : il multiplie
l'amplitude de tirages déjà existants aux points de déclenchement existants (spawn, apparition
d'anneau, réinitialisation de pic) — jamais un tirage supplémentaire par particule vivante par image
(qui aurait un coût réel sur un pool de plusieurs milliers et viderait le flux `rng` plus vite selon
le niveau de qualité, cassant la cohérence entre niveaux). (3) `depth` (Profondeur) n'a aucune entrée
pour `pulse` — style délibérément plat/2D (docs/07), inventer un effet aurait été malhonnête.

Fait mais non vérifié : **vérification navigateur en attente** — les deux outils de navigateur
disponibles cette session ont de nouveau refusé de charger `localhost:3000` (même limite qu'aux
étapes précédentes). Checklist pour Aaron : pour chaque style (Pulse/Field/Spectrum Pro), ouvrir
Avancé et faire varier chacun des 6 curseurs à fond (0 puis 1) pendant la lecture — confirmer un
changement visuel perceptible et cohérent avec sa description (Densité = plus/moins d'éléments,
Mouvement = plus/moins vite, Profondeur = plus/moins de relief SAUF en Pulse, Glow = halo plus/moins
fort, Chaos = plus/moins irrégulier, Douceur = transitions plus/moins rondes) ; confirmer qu'aucun
curseur ne fait planter ou geler l'app à ses extrêmes (0 et 1) ; confirmer que bouger un curseur
PENDANT la lecture ne fait pas sauter/disparaître les particules déjà à l'écran (pas de
reconstruction de Scene) ; changer de style puis revenir confirmer que les valeurs de macro restent
cohérentes.
Limites connues : une seule table de courbes par macro, partagée entre les styles qui l'utilisent
(pas de courbe distincte par style au-delà des chemins déjà différents) — même limite déjà assumée
pour `WIRED_MACRO_CURVES` depuis l'Étape 13/P11. Les plages numériques (at0/at1) sont auto-choisies,
non calibrées par un retour utilisateur réel — à ajuster après usage si un effet semble trop
faible/fort. `depth` sans effet en Pulse (assumé, voir décisions de conception).
Dette introduite : aucune connue.
Bloque la suite : vérification navigateur de cette étape à faire par Aaron avant de la considérer
pleinement close. Restent ouverts, sans lien avec ce chantier : le corpus annoté (Étape 2), le banc
`bench:render`/`bench:export`/`bench:memory`/`bench:leak` (nécessite `node-canvas`, décision de
dépendance non prise), et les cinq décisions produit/business de l'Étape 18.

## Vérification navigateur — Étape 20 (a posteriori, même session)

Le blocage des outils de navigateur (« blocked by policy » / « blocked by your site permissions »,
signalé à répétition depuis l'Étape 16) a été résolu avec Aaron : la cause réelle était le premier
écran de consentement de l'extension Claude in Chrome (« Before you start ») jamais validé, combiné
à un serveur de dev (`pulsar-dev`) arrêté entre-temps et à un port de proxy (3000) propre au panneau
interne, différent du port réel de Vite (5174). Une fois ces trois points réglés, la vraie
vérification a pu être faite (Chrome réel, `http://localhost:5174`), en pilotant la simulation via
le hook `window.__pulsarDebug` (déjà exposé en dev depuis P7) pour avancer `simT` de façon
déterministe sans dépendre du rendu temps réel ni du focus de l'onglet.

Résultats : l'app charge et fonctionne (démo, timeline, transport). Les 3 styles rendent
correctement — Pulse (anneau + halo), Field (particules + grille en perspective), Spectrum Pro
(barres + reflets + halos + onde) — visuellement conformes à docs/07. Le panneau debug affiche
exactement les champs attendus (fps/régime/clampées/confiance/qualité/particules/sync) ; le
`QualityGovernor` a RÉELLEMENT dégradé vers LOW en conditions de charge réelles pendant le test —
confirmation en direct que P14 fonctionne, pas seulement en test unitaire. Effet de la macro
Densité mesuré précisément par script (style Field, 300 pas de simulation à chaque extrême) :
**105/2500 particules à Densité=0, 367/2500 à Densité=1** — ratio ≈3,5, cohérent avec le
multiplicateur codé (0,4→1,4) dans `layerMacros.ts`. Balayage de robustesse : les 3 styles × 6
macros aux deux bornes (0 et 1), soit 36 combinaisons, sans **aucune erreur JavaScript** ni FPS en
chute. Les 8 macros de l'Advanced n'affichent plus d'icône ⚠, et la note "Profondeur n'a pas d'effet
visible en Pulse" (texte exact de l'Étape 20) s'affiche bien.

Item non concluant, sans rapport avec le produit : le transport (temps de lecture réel) se fige
après ~54 s dans l'onglet automatisé, très probablement un throttling de `requestAnimationFrame` en
arrière-plan propre à l'automatisation du navigateur (onglet non visible/focus), contourné en
pilotant `simT` directement via `__pulsarDebug.step()`. Non revérifié en usage normal (onglet au
premier plan) — à confirmer par Aaron s'il observe un figement similaire en usage réel.

**Étapes 16 à 20 sont donc maintenant vérifiées au navigateur réel**, levant le "fait mais non
vérifié" resté ouvert à chacune d'elles.

## Étape 21 — hors roadmap : le vrai bloom

**Hors de docs/00a.** Suite directe du choix d'Aaron entre les 5 dimensions de qualité restées
inertes depuis P14 (voir survol technique avant cette étape) : `bloom` était la seule à demander une
vraie nouvelle fonctionnalité de rendu plutôt qu'un branchement — construite ici, sur plan validé par
Aaron avant tout code.

Fait et vérifié : `render/Renderer.ts` — interface `BloomConfig` (déclarée séparément de celle de
`perf/qualityLevels.ts`, structurellement identique : `render/` n'a pas le droit d'importer `perf/`,
le typage structurel de TypeScript suffit) et méthode `setBloomConfig()`. `render/canvas2d/
bloomMath.ts` (nouveau) : fonctions PURES testables en Node — `computeSmallDimensions`,
`computeBlurRadiusPx`, `extractHighlights` (seuil doux sur `max(r,g,b)`, pas une luma perceptuelle).
`render/canvas2d/Canvas2DRenderer.ts::applyBloom()` : sous-échantillonnage (`drawImage` vers un petit
buffer réduit, redimensionné à la demande comme `feedbackBuffer`) → extraction des hautes lumières
(`getImageData`/`putImageData` UNIQUEMENT sur ce petit buffer, jamais l'image pleine résolution,
même principe que `FlashLimiter` à 32×18) → flou natif `ctx.filter = 'blur()'` (rayon fonction de
`passes`) → composition additive par-dessus l'image d'origine. Appelé dans `endFrame()`, après le
`ctx.restore()` qui annule `applyShake` (le bloom travaille en espace écran, pas transformé).
`tests/unit/testSupport/FakeRenderer.ts` : `setBloomConfig()` enregistre l'appel (comme les autres
méthodes). Câblage : `ui/App.ts` (`applyActiveConfiguration()` et `applyQualityLevel()`) pousse
`QUALITY_LEVEL_CONFIGS[niveau].bloom` dans le renderer de preview ; `ExportPipeline.ts::runExport()`
fige le bloom à `EXPORT_QUALITY_LEVEL` (HIGH) **dans le pipeline lui-même**, indépendamment de
l'appelant — même règle non négociable #2 que pour les particules (Étape 16), appliquée à un second
point pour ne pas dépendre qu'un futur appelant s'en souvienne. 12 nouveaux tests (`bloomMath.test.ts`)
— total **67 fichiers/426 tests**. `npx tsc --noEmit` : 0 erreur. `npx vitest run` : **426/426**
verts. `npm run test:arch` : 1/1 (l'import `export/` → `perf/` est déjà autorisé). `npm run build` :
succès, 163 modules, 309,18 ko (gzip 84,71 ko).

**Vérifié au navigateur réel** (accès débloqué depuis la fin de l'Étape 20) : style Field, LOW
(bloom désactivé) vs ULTRA (1/2 résolution, 2 passes) comparés côte à côte — halo net et visible
autour de chaque particule en ULTRA, absent en LOW, capture zoomée à l'appui. Style Pulse également
vérifié visuellement, halo cohérent autour de l'anneau, aucun artefact. Balayage de robustesse : 3
styles × 4 niveaux de qualité (12 combinaisons, donc `bloom.enabled` et `resolutionScale`/`passes`
tous exercés), **zéro erreur JavaScript**, FPS stable à 60.

Deux écarts documentés par rapport à la description littérale de docs/07 (dans le code et ici,
décision tranchée sans mandat — coût d'erreur faible, réversible) : (1) `ctx.filter = 'blur()'`
natif au lieu d'une convolution séparable écrite à la main en 2 passes — supporté par toute la
matrice navigateurs de docs/11 (Chrome 52+, Firefox 35+, Safari 9.1+), même résultat visuel
documenté (un halo qui s'étale), bien plus simple ; `passes` élargit le RAYON plutôt que de répéter
une vraie passe. (2) Seuil de hautes lumières sur `max(r,g,b)`, pas une luma perceptuelle pondérée —
une particule d'une seule couleur saturée (rouge pur, palettes de ce projet) doit être détectée
comme un point chaud même si sa luma serait faible.

Fait mais non chiffré : le coût réel en millisecondes du pipeline bloom n'est pas mesuré (pas de
`<canvas>` en environnement Node, même limite que tout `Canvas2DRenderer` depuis l'origine) — le
budget de docs/07 (« ≈2,5 ms en 1080p ») reste à confirmer par Aaron avec un vrai profileur
navigateur. Le seuil de luminosité (200/255), le rayon de flou par passe et l'alpha de composition
additive sont auto-choisis (aucune valeur donnée par docs/07 au-delà de la description de la chaîne)
— ajustables sans changer la forme de l'API si l'usage au navigateur révèle un besoin de calibrage.
Limites connues : `feedback`/`chromaticAberration`/`internalResolutionScale`/`spectrumBands`
restent inertes (voir docs/10_PERFORMANCE.md) — `feedback` est un branchement trivial (effet déjà
existant), les trois autres exigeraient une fonctionnalité nouvelle comme le bloom, chacune à son
propre chantier.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu. Restent ouverts, sans lien avec ce chantier : le
corpus annoté (Étape 2), les quatre dimensions de qualité encore inertes ci-dessus, et les cinq
décisions produit/business de l'Étape 18.

## Étape 22 — hors roadmap : câblage de feedback sur le niveau de qualité

**Hors de docs/00a.** Le seul des 4 derniers paramètres de qualité inertes qui était un vrai
branchement plutôt qu'une fonctionnalité neuve (voir Étape 21) : l'effet de traînée du style Field
existait déjà (`FrameFeedback`/`drawFeedback`/`captureFeedback`, depuis P9), seul son activation
selon le niveau de qualité manquait.

Fait et vérifié : `createFieldStyle(maxParticles?, feedbackEnabled = true)` — second paramètre
optionnel, transmis à `Scene` comme `usesFeedback` ; défaut `true` = comportement inchangé si omis.
Pas besoin de retirer `FrameFeedback` de la liste des couches quand `feedbackEnabled` est faux : sans
`captureFeedback()` appelé par `Scene.draw()`, `feedbackBuffer` (`Canvas2DRenderer`) reste `null`, et
`drawFeedback()` — appelé par `FrameFeedback.draw()` à chaque image malgré tout — reste un no-op
permanent, déjà vrai par construction depuis P9 (voir son commentaire). `ui/App.ts` : les 3 points
d'appel de `STYLE_FACTORIES` (`applyActiveConfiguration`, `applyQualityLevel`, `getStyleFactory` de
l'export) passent désormais `QUALITY_LEVEL_CONFIGS[niveau].feedback` en second argument — LOW/MEDIUM
= désactivé, HIGH/ULTRA = activé (table de docs/10), export toujours figé à HIGH comme pour le bloom
et les particules. `npx tsc --noEmit` : 0 erreur. `npx vitest run` : **426/426** verts (inchangé —
branchement pur, aucune nouvelle logique testable ajoutée). `npm run test:arch` : 1/1. `npm run
build` : succès, 163 modules, 309,23 ko (gzip 84,72 ko).

Vérifié au navigateur : LOW puis HIGH comparés (style Field, démo, ~7s de simulation pilotée par
`__pulsarDebug.step()`), captures à l'appui — particules nettes dans les deux cas, aucune corruption
visuelle. Balayage de robustesse déjà couvert par l'Étape 21 (3 styles × 4 niveaux, la bascule
`usesFeedback` y était déjà exercée à chaque changement de niveau, zéro erreur).
**Limite honnête** : la différence de traînée elle-même (LOW sans vs HIGH avec) n'est pas
concluante sur des captures statiques — l'effet s'accumule sur plusieurs images consécutives avec un
alpha de 0,88, une différence subtile à l'œil sur une image isolée plutôt qu'une vidéo. La
correction du branchement repose sur la relecture de code (mécanique déjà vérifiée en P9/P11, seule
la condition d'activation est neuve) et l'absence d'erreur, pas sur une confirmation visuelle directe
de la traînée elle-même — signalé explicitement plutôt que de prétendre une vérification plus forte
qu'elle ne l'est.
Limites connues : `chromaticAberration`/`internalResolutionScale`/`spectrumBands` restent inertes,
chacun exigeant une fonctionnalité de rendu ou d'analyse nouvelle (voir Étape 21).
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 23 — hors roadmap : le décalage chromatique

**Hors de docs/00a.** Choisi par Aaron parmi les 3 dimensions de qualité encore inertes après
l'Étape 22 (`chromaticAberration`/`internalResolutionScale`/`spectrumBands`), comme meilleur rapport
valeur/risque des trois : effet visuellement nouveau, purement additif (ne peut pas casser l'image
existante), reste entièrement dans `render/`, aucune dépendance en amont — contrairement à
`spectrumBands` (toucherait le pipeline d'analyse) ou `internalResolutionScale` (gain de perf
seulement, aucun signal actuel qu'il soit nécessaire).

Fait et vérifié : `src/render/canvas2d/chromaticMath.ts` (nouveau, fonctions pures — même séparation
que `bloomMath.ts`) : `computeAberrationOffsetPx()`, décalage en fraction du petit côté du canvas
(`ABERRATION_OFFSET_FRACTION`), plancher à 1px. `Renderer.ts::setChromaticAberration(enabled:
boolean)` — booléen simple, pas de type dupliqué comme `BloomConfig` (aucun autre paramètre à faire
voyager à travers la frontière `render/`/`perf/`).
`Canvas2DRenderer.ts::applyChromaticAberration()`/`compositeTintedChannel()` : capture de l'image
composite finale (après le bloom, dans `endFrame()`) dans un buffer persistant, puis pour le rouge et
pour le bleu — isolation du canal par `globalCompositeOperation = 'multiply'` avec un aplat de
couleur pure SUR LE BUFFER SCRATCH (pas `getImageData` : uniquement des opérations natives
accélérées, `drawImage`/`fillRect`), composée en `'lighter'` sur le canvas principal avec un léger
décalage horizontal opposé par canal. Purement additif par-dessus l'image d'origine — jamais de
`clear`/reconstruction, donc aucun risque de casser l'image existante même si l'effet s'avère mal
calibré. `false` par défaut : sortie inchangée tant que jamais appelé.
Câblage : `ui/App.ts` (`applyActiveConfiguration`, `applyQualityLevel`) et
`ExportPipeline.ts::runExport()`, mêmes points d'appel que `setBloomConfig` — LOW/MEDIUM désactivé,
HIGH/ULTRA activé (table de docs/10), export figé à HIGH. `FakeRenderer.ts` enregistre l'appel.
`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **430/430** verts (426 + 4 nouveaux tests
`chromaticMath.test.ts`). `npm run test:arch` : 1/1. `npm run build` : succès, 164 modules, 310,98 ko
(gzip 85,02 ko).

Vérifié au navigateur par un test ISOLÉ plutôt que via l'appli complète : `Canvas2DRenderer`
instancié directement (import dynamique du module compilé par Vite) sur un canvas de test 200×200,
un disque blanc dessiné, comparaison pixel par pixel entre `chromaticAberration` désactivé et activé.
Résultat : 620 pixels sur 40 000 diffèrent (≈1,5 %), tous concentrés dans une fine bande autour du
bord du disque (confirmé point par point : centre du disque identique dans les deux cas, zone
éloignée du bord identique, léger décalage de canal détecté exactement à la frontière) — confirme le
comportement additif localisé annoncé, et l'absence de régression ailleurs dans l'image. Aucune
erreur console. Test additionnel via l'appli complète (démo, style Field, MEDIUM vs HIGH,
`__pulsarDebug.step()`) : rendu sans erreur aux deux niveaux, mais non concluant pour isoler
spécifiquement l'effet du décalage chromatique — MEDIUM et HIGH diffèrent aussi par `maxParticles`
(1200 vs 2500) et les passes de bloom (1 vs 2), et aucune paire de niveaux de la table de docs/10 ne
fait varier `chromaticAberration` seul ; voir le test isolé ci-dessus pour la vérification propre.
Limites connues : `internalResolutionScale`/`spectrumBands` restent inertes, chacun exigeant une
fonctionnalité de rendu ou d'analyse nouvelle (voir Étape 21). Coût réel en millisecondes non mesuré
au navigateur (comme le bloom à l'Étape 21) — à confirmer par Aaron.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 24 — hors roadmap : la résolution interne

**Hors de docs/00a.** Dernier des trois post-traitements du `Renderer` restés inertes après
l'Étape 23 (`internalResolutionScale`/`spectrumBands`) — `spectrumBands` écarté car il exigerait de
toucher le pipeline d'analyse en amont, hors de `render/`, un chantier nettement plus gros et risqué.

**Plus invasif que le bloom et le décalage chromatique, annoncé avant de coder** : ceux-ci
ajoutaient un post-traitement APRÈS coup dans `endFrame()`, sans toucher aux méthodes de dessin.
Ici, `fillCircle`/`strokeCircle`/`strokePath`/`fillPath`/`fillRadialGradient`/`drawSprite`/
`applyShake`/`captureFeedback`/`drawFeedback` utilisent toutes la cible de dessin de la frame — la
rendre configurable a exigé de changer CETTE cible, pas d'ajouter une étape en périphérie.

Fait et vérifié : `Canvas2DRenderer` distingue désormais `canvas` (le `<canvas>`/`OffscreenCanvas`
RÉEL du constructeur, cible finale d'affichage/export, jamais dessiné dedans directement pendant la
frame) et `activeCanvas`/`ctx` (la cible ACTIVE de la frame en cours — `canvas` lui-même à
`internalResolutionScale === 1`, ou un buffer interne réduit sinon, choisi dans `beginFrame()`).
Toutes les méthodes de dessin ciblent déjà `this.ctx`/`this.activeCanvas` (aucune ne référençait
`this.canvas` directement en dehors de `beginFrame`/`clear`/`fillRadialGradient`/`captureFeedback`/
`drawFeedback`/`applyBloom`/`applyChromaticAberration`/`compositeTintedChannel` — ces méthodes-là
seules ont dû être retouchées pour lire `activeCanvas` au lieu de `canvas`). `endFrame()` : après le
bloom et le décalage chromatique (qui opèrent donc à la résolution INTERNE, moins cher), un unique
`drawImage` avec agrandissement bilinéaire natif recopie `activeCanvas` vers `canvas` — seulement si
`activeCanvas !== canvas` (donc jamais à `internalResolutionScale === 1`, HIGH/ULTRA : aucun buffer
créé, aucune copie de plus, chemin strictement identique à avant cette étape).
`computeSmallDimensions` (`bloomMath.ts`, Étape 21) réutilisée telle quelle pour dimensionner le
buffer interne — même calcul exact, pas de raison de le dupliquer dans un nouveau fichier.
Bug latent trouvé et corrigé AVANT toute vérification (relecture de code, pas d'exécution) :
`ExportPipeline.ts::runExport()` dessine le filigrane via `Renderer` APRÈS `endFrame()`, hors du
bracket `beginFrame`/`endFrame` (pas de nouvelle frame pour un simple filigrane) ; sans un reset de
`activeCanvas`/`ctx` vers la cible réelle à la fin de `endFrame()`, ces appels auraient visé le
buffer interne déjà recopié plus haut — jamais réaffiché — si `internalResolutionScale < 1` à
l'export. Sans effet aujourd'hui (l'export est figé à HIGH = échelle 1, la branche ne s'exécute même
pas), mais latent si ce figeage changeait un jour ; `endFrame()` restaure donc systématiquement
`activeCanvas`/`ctx` vers `canvas`/`displayCtx` juste après l'agrandissement, plutôt que de laisser
la cible active « traîner » jusqu'au prochain `beginFrame()`.
Câblage : `ui/App.ts` (`applyActiveConfiguration`, `applyQualityLevel`) et
`ExportPipeline.ts::runExport()`, mêmes points d'appel que `setBloomConfig`/`setChromaticAberration`.
`FakeRenderer.ts` enregistre l'appel. `npx tsc --noEmit` : 0 erreur. `npx vitest run` : **430/430**
verts (inchangé — refactor pur de la cible de dessin, aucune nouvelle logique testable en Node,
`Canvas2DRenderer` n'étant testable qu'au navigateur comme avant). `npm run test:arch` : 1/1.
`npm run build` : succès, 164 modules, 312,17 ko (gzip 85,27 ko).

Vérifié au navigateur, plus en profondeur que d'habitude vu l'invasivité du changement : (1) test
ISOLÉ (`Canvas2DRenderer` instancié directement) — disque dessiné à échelle 1 vs 0,5, centre
identique dans les deux cas, coins identiques, surface non noire proche (léger excédent à échelle
réduite, anticrénelage de l'agrandissement, attendu) ; (2) traînée (`captureFeedback`/`drawFeedback`)
testée sur deux frames successives à échelle 0,5 — la seconde frame montre bien la trace de la
première, confirmant que la capture/rejeu fonctionnent à la résolution interne ; (3) bloom +
décalage chromatique + résolution interne combinés (échelle 0,6) — aucune erreur, halo visiblement
présent (25 452/40 000 pixels non noirs pour un disque qui en couvrirait ~12 000 seul), confirme que
les post-traitements chaînés fonctionnent correctement sur le buffer réduit ; (4) balayage complet
par l'appli — 3 styles × 4 niveaux de qualité (démo, `__pulsarDebug.step()`) : les 12 combinaisons
rendent sans erreur, dimensions du canvas réel correctes dans tous les cas (agrandissement réussi à
LOW/MEDIUM, chemin direct à HIGH/ULTRA). Erreurs console rencontrées PENDANT le balayage (`Audio
BufferSourceNode.start()` avec un offset négatif) tracées à `AudioEngine.pause()`/`currentRawT()` —
un module non touché par cette étape, déclenché uniquement par mon propre harnais de test (cycles
play/pause artificiels très rapprochés, 12× de suite sans délai réaliste) ; reproduction sur un
onglet neuf avec un cycle play/pause réaliste (délai de 600 ms) : aucune erreur. Signalé pour
transparence, pas une régression de cette étape.
Limites connues : `spectrumBands` reste inerte, exigerait de toucher le pipeline d'analyse en amont.
Coût réel en millisecondes non mesuré au navigateur (comme le bloom et le décalage chromatique) — à
confirmer par Aaron ; le gain attendu devrait être plus perceptible que celui des deux précédents sur
LOW/MEDIUM, puisque TOUT le dessin de la frame en bénéficie, pas seulement un post-traitement.
Export non testé au navigateur spécifiquement : structurellement sans effet, `EXPORT_QUALITY_LEVEL`
étant figé à `'high'` (échelle 1) — la branche d'agrandissement de `endFrame()` ne s'exécute jamais à
l'export, comportement provablement identique à avant cette étape plutôt que vérifié empiriquement.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 25 — hors roadmap : le spectre visuel fin (spectrumBands)

**Hors de docs/00a.** Dernière des 4 dimensions de qualité inertes — choisie par Aaron après
confirmation explicite du plan (le plus gros chantier des quatre, seul à traverser `analysis/`/
`music/` en plus de `render/`/`visual/`, `spectrumBands` étant écarté d'abord au profit
d'`internalResolutionScale` pour rester dans `render/` à l'Étape 24). Chantier P4 mentionné depuis
P9 (docs/07 : « un vrai spectre log-scale à 64 bandes exigerait de conserver une résolution
spectrale plus fine en sortie d'analyse, un chantier séparé et plus gros »).

**Architecture en 3 couches, présentée à Aaron avant tout code** :
1. `analysis/spectrumBands.ts` (nouveau) : `computeLogSpacedBinRanges`/`computeSpectrumEnergyTracks`
   — 96 bandes log-espacées génériques, réutilisent `BinRange`/`bandEnergy` de `bands.ts` (déjà
   génériques sur n'importe quelle plage de bins). DIFFÉRENT de `bands.ts`, qui reste dédié aux 6
   bandes sémantiques (sub/bass/lowmid/mid/himid/high) utilisées par toute la détection d'onsets/
   comportement — inchangé, pas de conflit.
2. `AnalysisPipeline.ts` : les 96 bandes calculées AU MÊME ENDROIT que `bandEnergyTracks`/
   `bandFluxTracks` existants, sur le même `frames` (spectrogramme complet) déjà en mémoire à ce
   stade — AUCUN changement de la stratégie de rétention mémoire (« libéré au fur et à mesure »,
   docs/03, toujours vrai). 96 nouveaux `FeatureTrack` (`spectrum.0`..`spectrum.95`), même
   mécanisme que les `band.*` existants. `validatePmdi.ts::KNOWN_FEATURE_ID_PATTERN` étendu pour
   les reconnaître (sinon avertissement « id inconnu », pas une erreur, mais autant l'éviter).
3. `music/StepContext.ts` : nouveau champ `spectrum: Float32Array` (96 valeurs), construit comme
   `bands` (`SPECTRUM_BAND_COUNT` dupliqué depuis `analysis/`, `music/` ne peut pas l'importer,
   même raison que `BAND_IDS`). Toujours calculé, même si le style courant ne le consomme pas —
   même convention que `bands`/`energy` (`StepContext` générique, pas spécifique à un style).
4. `visual/layers/spectrum/spectrumGrouping.ts` (nouveau, pur, testable) : `groupBinsIntoBars`,
   regroupe par INDEX (le spectre étant déjà log-espacé uniformément, regrouper des tranches
   d'index égales = regrouper des tranches égales en log(Hz), pas besoin de refaire le calcul log).
5. `SpectrumBars.ts` : SECOND chemin complet, gated par `params.bandCount` — absent (défaut) :
   chemin D'ORIGINE intact (6 bandes, `step.bands`, `BAND_WIDTH_WEIGHTS`), byte-identique à avant
   cette étape. Présent (32/48/64/96, depuis `perf/qualityLevels.ts::spectrumBands`) :
   `step.spectrum` regroupé, largeurs ÉGALES (pas de raison sémantique de varier pour un spectre
   log-espacé uniforme, contrairement aux 6 bandes nommées). Les deux chemins partagent la même
   physique de lissage/pics (`updateBars`/`drawBars`, factorisées) — seules les données source et
   les tableaux d'état diffèrent.

Bug trouvé et corrigé à l'exécution (pas par relecture) : `Object.freeze()` sur `StepContext
.spectrum` (un `Float32Array` non vide) lève `TypeError: Cannot freeze array buffer views with
elements` — piège JS connu (les éléments indexés d'un TypedArray ne peuvent pas devenir
individuellement non-inscriptibles). Corrigé en ne freezant PAS `spectrum`, cohérent avec la
convention déjà en vigueur ailleurs dans ce backend (`Float32Array` de `strokePath`/`fillPath`,
jamais frozen non plus).

Câblage : `ui/App.ts::applyLayerMacros()` injecte `params.bandCount` pour la couche `spectrumBars`
spécifiquement (pas un macro-curseur — une source différente, `QUALITY_LEVEL_CONFIGS`) juste avant
`layer.params = params`. `ExportPipeline.ts::runExport()` fait de même indépendamment, sur sa propre
Scene. **Limite préexistante découverte en cours de route, pas introduite ici** : les 6 macros de
couche de l'Étape 20 (densité/mouvement/profondeur/glow/chaos/douceur) ne sont JAMAIS appliquées à
l'export — `applyLayerMacros()` n'est appelé que depuis `ui/App.ts`, jamais depuis
`ExportPipeline.ts`, un gap déjà là avant cette étape, hors périmètre ici (signalé, pas corrigé).

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **451/451** verts (430 + 21 nouveaux —
`spectrumBands.test.ts` 8, `spectrumGrouping.test.ts` 8, 5 cas `bandCount` ajoutés à
`spectrumBars.test.ts`). `npm run test:arch` : 1/1 (aucune nouvelle arête de dépendance hors du
tableau autorisé — `analysis` importait déjà `music`, `visual` importait déjà `music`, rien de
neuf). `npm run build` : succès, 165 modules, 313,61 ko (gzip 85,66 ko).

**`bench:analysis` — coût mesuré, pas supposé** : 5 666 ms (Étape 19) → **6 842 ms**, détail par
étage : `features` 929 ms (l'étage qui porte le nouveau calcul), le reste inchangé dans l'ordre de
grandeur. Toujours sous le budget de 8 s (docs/11) avec ≈1,16 s de marge — le risque annoncé avant
de coder (« retoucher le budget déjà difficilement optimisé à l'Étape 19 ») s'est concrétisé en
partie (+1,18 s) mais reste dans les clous.

Vérifié au navigateur : style Spectrum Pro, démo réelle (pas seulement les fixtures synthétiques des
tests unitaires), les 4 niveaux de qualité (32/48/64/96 barres) rendent sans erreur console.
**Limite honnête** : une différence visuelle directe entre 32 et 96 barres n'a pas été isolée de
façon concluante par échantillonnage de pixels automatisé (le halo/glow tend à fondre les barres
voisines à ce niveau d'intensité, une ligne de balayage horizontale ne détecte qu'une seule
transition allumé/éteint dans les deux cas). La preuve du bon nombre de barres et de leur
regroupement correct repose sur les tests unitaires (comptage EXACT des appels `fillPath`/
`drawSprite` par `bandCount`, via `FakeRenderer`), pas sur une confirmation visuelle directe — même
limite déjà rencontrée et signalée à l'Étape 22 (traînée de feedback), signalée ici pour la même
raison plutôt que de prétendre une vérification plus forte qu'elle ne l'est.

**Les 4 dimensions de qualité de docs/10 sont maintenant TOUTES câblées** (`maxParticles` P14,
`bloom` Étape 21, `feedback` Étape 22, `chromaticAberration` Étape 23, `internalResolutionScale`
Étape 24, `spectrumBands` ici) — plus aucune dimension de la table de docs/10 n'est déclarée sans
consommateur.
Limites connues : coût en ms du regroupement `groupBinsIntoBars` par image non mesuré séparément du
reste du rendu (négligeable en principe — une boucle O(96), pas de flou/getImageData — mais pas
chronométré isolément). Le gap macros-de-couche-absentes-à-l'export (voir plus haut) reste ouvert.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 26 — hors roadmap : corrige le gap « macros de couche absentes à l'export »

**Hors de docs/00a.** Demandé explicitement par Aaron après l'avoir signalé (pas corrigé) à
l'Étape 25 : les 6 macros de couche de l'Étape 20 (densité/mouvement/profondeur/glow/chaos/
douceur) n'étaient JAMAIS appliquées à la Scene d'export — `ui/App.ts::applyLayerMacros()`
n'était appelé que depuis la boucle de preview, jamais depuis `ExportPipeline.ts::runExport()`,
qui construit sa PROPRE Scene indépendante via `config.createScene()`. Une vidéo exportée avec
`density`/`chaos`/etc réglés loin du neutre rendait donc comme si tous les macros de couche
étaient à leur valeur neutre (0,5), quels que soient les curseurs affichés dans l'UI.

**Correctif : extraction plutôt que duplication.** La boucle qui résout `LAYER_MACRO_CURVES`
et assigne `layer.params` (jusque-là seulement dans `ui/App.ts::applyLayerMacros()`) est
extraite en `presets/layerMacros.ts::applyLayerMacrosToScene(scene, macros, styleId)` — une
fonction PURE de ses trois arguments, sans dépendance à l'état module-scope d'`App.ts`.
`presets: ['core', 'music', 'behaviour', 'analysis', 'visual']` (docs/02) autorise déjà
l'import de `visual/scene/Scene` ; `export`/`ui` importent déjà `presets` — aucune nouvelle
arête de dépendance. Appelée IDENTIQUEMENT par `ui/App.ts::applyLayerMacros()` (preview) et
`ExportPipeline.ts::runExport()` (export, juste après `scene.init(...)`, avant les réglages
`Renderer` figés à HIGH) : un seul point de vérité, plus de risque de divergence entre les deux
chemins. `ExportConfig` gagne deux champs (`macros: PresetMacros`, `styleId: StyleId`) ;
`ExportDialogOptions` gagne `getMacros`/`getStyleId` ; `ui/App.ts` les fournit avec
`currentMacros`/`currentStyleId` — mêmes valeurs que la preview au moment du clic sur Exporter.
`bandCount` (Étape 25, `spectrumBars`) reste injecté APRÈS cet appel (il ne fait pas partie des
macros — piloté par le niveau de qualité), dans les deux fichiers, en fusionnant avec les params
déjà posés par les macros (`{...layer.params, bandCount}`) plutôt qu'en écrasant tout.

Fait et vérifié : `npx tsc --noEmit` : 0 erreur (a révélé `tests/unit/exportPipeline.test.ts` :
`ExportConfig` gagnant 2 champs requis, fixture mise à jour avec une fonction `neutralMacros()`
locale au test, même valeur que celle d'`App.ts`). `npx vitest run` : **453/453** verts (451 + 2
nouveaux, `exportPipeline.test.ts` — un test qui PROUVE la correction : `density=1` sur la Scene
d'export produit bien `pulseRings.maxActiveRings > 6` en utilisant `runExport()`/
`applyLayerMacrosToScene` réels, pas des mocks ; ce test aurait échoué avant ce correctif
puisque `layer.params` serait resté `{}`). `npm run test:arch` : 1/1. `npm run build` : succès,
165 modules, 313,82 ko (gzip 85,75 ko).

Vérifié au navigateur (onglet neuf, pour éviter tout résidu HMR d'une précédente édition) :
`runExport()` appelé directement via import dynamique du module compilé par Vite (même
technique que les tests isolés des Étapes 23/24), deux Scenes `pulse` exportées côte à côte —
macros neutres (`density=0,5`) → `maxActiveRings=5` (le milieu exact de `{at0:2, at1:8}`) ;
macros denses (`density=1`) → `maxActiveRings=8` (`at1` exact). Aucune erreur console sur
l'onglet neuf (une erreur `applyLayerMacrosToScene is not defined` vue une fois était un résidu
HMR de l'onglet précédent pendant l'édition, pas reproduite après rechargement).
Limites connues : aucune nouvelle. Le correctif ne couvre QUE les 6 macros de couche —
`bandCount`, bloom, décalage chromatique, résolution interne avaient déjà chacun leur propre
point d'application à l'export depuis leurs étapes respectives, non affectés par ce gap.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 27 — hors roadmap : corrige l'offset négatif d'AudioEngine (cycles play/pause rapprochés)

**Hors de docs/00a.** Bug réellement rencontré à l'exécution (Étape 24, mon propre harnais de
test), signalé pour transparence sans être corrigé (« un module non touché par cette étape »).
Repris ici comme prochaine unité de travail autonome, après une revue ciblée des « limites
connues » ouvertes des Étapes 19-26 (bug déjà reproduit, isolé, petit — meilleur rapport risque/
valeur des candidats trouvés).

**Ordre de travail imposé : reproduire AVANT de corriger.** `tests/unit/testSupport/
FakeAudioContext.ts` (nouveau — aucun test `AudioEngine` n'existait avant cette étape, la classe
exige un `AudioContext` réel, absent de Node ; `AudioEngineOptions.context` injectable le permet).
`FakeAudioBufferSourceNode.start()` reproduit fidèlement le comportement natif : lève `RangeError`
sur un offset négatif, même message que celui observé au navigateur. `tests/unit/
audioEngine.test.ts` (nouveau) écrit et exécuté AVANT le correctif : 2 des 4 tests échouent bien,
avec le message EXACT observé à l'Étape 24 (« offset provided (-0.0267) is less than the minimum
bound (0) ») — confirme la reproduction avant de toucher au code source.

**Cause racine** : `AudioEngine.pause()` fixe `this.offsetSeek = this.currentRawT()`
(`ctx.currentTime − tStart + offsetSeek − outputLatency + calibrationOffset`). Sur un cycle play/
pause très rapproché (quasi aucun temps réel écoulé, `ctx.currentTime − tStart ≈ 0`), la
soustraction de `outputLatency` (quelques dizaines de ms) suffit à rendre le résultat négatif. Le
`play()` suivant appelle `startSource(this.offsetSeek)` → `node.start(0, offset négatif)` → lève.

**Correctif** : clamp défensif dans `startSource()` (`Math.max(0, Math.min(offset, duration))`),
même principe que le clamp déjà présent dans `seek()` — appliqué au SEUL point d'appel de
`node.start()`, protège tous les appelants (`play()` ET `seek()`) plutôt que de corriger
`pause()` isolément (`offsetSeek` négatif, transitoire, n'est lu nulle part ailleurs dans le
fichier — vérifié par grep — donc pas besoin d'un second clamp à la source).

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **457/457** verts (453 + 4 nouveaux —
`audioEngine.test.ts`, premiers tests de ce module). `npm run test:arch` : 1/1. `npm run build` :
succès, 165 modules, 313,88 ko (gzip 85,75 ko).

Vérifié au navigateur : reproduction EXACTE du scénario de l'Étape 24 (3 styles × 4 niveaux de
qualité, `play()`/`step()`×20/`pause()` en boucle serrée, 12 cycles sans délai réaliste) — 0 erreur
console (contre 11 `RangeError` à l'identique avant ce correctif).
Limites connues : `AudioEngine` reste autrement non couvert par des tests (`play()`/`pause()`/
`seek()`/`tick()` au-delà de ce scénario précis — `FakeAudioContext` ouvre la voie, pas un audit
complet du module). `currentRawT()`'s `if (!this.playing) return this.offsetSeek` (l.150) reste du
code mort par construction (tous les appelants actuels appellent cette méthode alors que `playing`
est encore vrai) — observé en marge, pas touché, hors périmètre de ce correctif.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 28 — hors roadmap : BehaviourEngine recâblable sans reconstruction

**Hors de docs/00a.** Reprend la « limite assumée, non corrigée » documentée depuis l'Étape 14/P12
(voir plus haut dans ce journal) : `applyActiveConfiguration()` (`ui/App.ts`) protège `Scene` d'une
reconstruction à chaque glissement de macro (`sceneStyleId` comparé à la cible), mais
`BehaviourEngine` n'avait pas ce garde — reconstruit à chaque appel, remettant à zéro toute
enveloppe `Impulse`/`Continuous` en cours. Choisi comme prochaine unité de travail autonome après
une revue ciblée des limites ouvertes des Étapes 14-27 (gap UX concret, documenté de longue date,
scope clair, ne touche aucune zone à risque non balisée).

**Correctif, en 3 temps** :
1. `Impulse.ts` : nouvelle méthode `seed(v)` — DISTINCTE de `reset()` (qui ramène à 0, utilisée par
   `seek()`, docs/02 §Seek) — impose une valeur arbitraire sans perturber la suite de la
   décroissance exponentielle.
2. `BehaviourEngine.ts` : `resolved` devient mutable (était `private readonly`) ; nouvelle méthode
   `setMapping(mapping)` — reconstruit `resolved` via `resolve(mapping)` (les primitives DOIVENT
   être reconstruites, `decay`/`rise`/`fall` sont `private readonly`, fixés au constructeur — même
   raison que `ScreenShake`/`SpectrumBars`, Étape 20), puis reporte la valeur EN COURS de chaque
   primitive existante sur la nouvelle, par nom de signal (`seed()` pour `Impulse`, `reset(v)` —
   déjà existant — pour `Continuous`). `Anticipation` n'a rien à préserver : sans état interne par
   construction (recalculée à chaque pas depuis `timeline.timeToNext`).
3. `ui/App.ts` : nouvelle variable `behaviourEngineTimeline`, même rôle que `sceneStyleId` pour
   `scene` — `applyActiveConfiguration()` appelle `behaviourEngine.setMapping(currentMapping)` si le
   timeline n'a pas changé depuis la dernière construction, sinon reconstruit `new
   BehaviourEngine(...)` (nouveau morceau chargé — le timeline est `private readonly` dans
   `BehaviourEngine`, une vraie reconstruction reste nécessaire dans ce cas).

Fait et vérifié : `npx tsc --noEmit` : 0 erreur. `npx vitest run` : **463/463** verts (457 + 6
nouveaux — 2 dans `impulse.test.ts` pour `seed()`, 4 dans `behaviourEngine.test.ts` pour
`setMapping()`, dont un qui prouve explicitement la non-régression : un `Impulse` en décroissance
partielle continue sa décroissance depuis sa valeur courante après `setMapping()`, jamais depuis 0 —
ce test aurait échoué avec l'ancien `new BehaviourEngine(...)` inconditionnel). `npm run test:arch` :
1/1. `npm run build` : succès, 165 modules, 314,22 ko (gzip 85,82 ko).

Vérifié au navigateur : démo réelle, lecture démarrée, glissement RÉEL du curseur `energy` (panneau
Simple, `#macro-energy-simple`) 21 fois de suite en cours de lecture (`input`/`change` dispatchés,
exactement le chemin DOM réel, pas un appel direct à `applyActiveConfiguration()`) — aucune erreur
console, aucun plantage. Vérification fonctionnelle de bout en bout (le câblage `ui/App.ts` n'est
pas couvert par les tests unitaires, qui portent sur `BehaviourEngine`/`Impulse` isolément) ;
l'absence d'à-coup visuel lui-même n'a pas été confirmée à l'œil (effet subtil sur une durée de
quelques dizaines de ms, même limite de rigueur que les vérifications visuelles des Étapes 22/25) —
la preuve de la préservation de valeur repose sur les tests unitaires, qui l'isolent précisément.
Limites connues : aucune nouvelle — cette étape referme la dernière limite UX documentée de
l'Étape 14/P12 encore ouverte (les deux autres, numérotées (2) et (3) plus haut dans ce journal,
concernent l'éditeur de preset JSON et la priorité style-local-sur-preset, non affectées ici).
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 29 — hors roadmap : sauvegarde fidèle d'un preset édité (mapping/palette/classification)

**Hors de docs/00a.** Reprend la limite connue depuis l'Étape 15/P13 : `buildCurrentProject()`
(`ui/App.ts`) ne capturait dans le diff `visual.overrides` que macros/style/sécurité — un preset
édité via l'éditeur JSON (`customPreset`, mapping/palette/classification) n'était jamais restauré
fidèlement après sauvegarde/rechargement. Choisi comme prochaine unité de travail autonome après
une revue des candidats restants (le seuil CI pour `bench:analysis` s'est avéré peu actionnable —
ce dépôt n'a AUCUNE CI configurée, rien à quoi accrocher un seuil ; celui-ci était concret et
bien scopé une fois investigué).

**Cause racine, confirmée avant de coder** : `project/diff.ts::computePresetDiff` ignore
DÉLIBÉRÉMENT les valeurs non primitives (« un tableau n'a pas de représentation dans ce format...
mieux vaut ne rien écrire de faux que d'écrire quelque chose qui ne se recharge pas correctement »)
— `mapping.impact.from` (`EventType[]`) et `palette.bg` (`[string,string]`) contiennent des
tableaux, donc ne peuvent structurellement pas survivre au mécanisme de diff existant, quelle que
soit la manière de le solliciter. Étendre le format de diff pour supporter les tableaux aurait été
un changement de FORMAT PERSISTÉ (`.pvproj`) avec des implications de compatibilité plus lourdes —
écarté au profit d'un correctif additif.

**Correctif : un champ complémentaire, pas une extension du diff.** `ProjectVisual.customPreset?:
Readonly<Record<string, unknown>>` (nouveau, optionnel — `project/Project.ts`) : copie ENTIÈRE du
preset actif quand il vient de l'éditeur JSON, en plus de `overrides` (toujours calculé, inchangé).
Typé en objet opaque : `project/` n'a pas le droit d'importer `presets/` (docs/02) pour connaître la
forme exacte de `Preset` — validé par `presets/schema.ts::validatePreset()` au point de
consommation (`ui/App.ts`, seule couche qui importe les deux), même principe de séparation que
`BAND_IDS`/`BloomConfig`/`SPECTRUM_BAND_COUNT` dupliqués ailleurs entre couches. `restoreProject()`
privilégie `customPreset` quand présent et VALIDE (`validatePreset().ok`), retombe sur le mécanisme
diff existant sinon (absent → cas courant, preset catalogue + macros, comportement inchangé ;
invalide → défense en profondeur, un fichier corrompu ou d'une version future ne doit jamais
planter la restauration).

Fait et vérifié : `npx tsc --noEmit` : 0 erreur. `npx vitest run` : **466/466** verts (463 + 3
nouveaux dans `project.test.ts` — accepte un projet sans `customPreset` (inchangé), accepte un objet
quelconque avec (la forme exacte est du ressort de `validatePreset`, hors de portée de
`validateProject`), rejette une valeur qui n'est pas un objet). `npm run test:arch` : 1/1 (aucune
nouvelle arête — `project/` n'importe toujours que `music`). `npm run build` : succès, 165 modules,
314,50 ko (gzip 85,92 ko).

Vérifié au navigateur avec les modules RÉELS compilés par Vite (import dynamique, même technique que
les Étapes 24/26/27) : (1) preuve que le bug était réel — `computePresetDiff` sur un preset édité
(palette.primary et mapping.impact modifiés, `from: ['KICK','CLAP']`) produit un diff VIDE (les
champs modifiés n'apparaissent nulle part, confirmant qu'ils étaient bien silencieusement perdus
avant cette étape) ; (2) le nouveau chemin : preset édité → `JSON.parse(JSON.stringify(...))`
(round-trip identique à ce que fait réellement `pvproj.ts`) → `validateProject` accepte →
`validatePreset(project.visual.customPreset)` reconstruit le `Preset` — `palette.primary`,
`mapping.impact.from` (le tableau) et `mapping.impact.decay` tous préservés exactement. Aucune
erreur console.
Limites connues : le câblage RÉEL dans `ui/App.ts` (`buildCurrentProject`/`restoreProject`,
orchestration couplée à l'IndexedDB/aux dialogues) n'a pas été exercé de bout en bout via l'UI
réelle (édition dans le dialogue, sauvegarde, rechargement de page, restauration depuis le panneau
Projets) — vérifié par relecture de code + tsc, et par un test isolé qui exerce exactement la même
séquence de fonctions réelles (`validatePreset`/`validateProject`) sur les mêmes données, mais pas
le chemin DOM/IndexedDB complet. Cohérent avec le reste de cette étape et des précédentes : `ui/
App.ts` reste la seule couche jamais couverte par des tests unitaires directs.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 30 — hors roadmap : câble PerfMonitor.snapshot() dans le panneau debug

**Hors de docs/00a.** Reprend une limite documentée depuis l'Étape 16/P14, jamais reprise depuis
(vérifié : aucune mention dans les Étapes 17-29 de ce journal, confirmé par le HTML actuel du
panneau) : `perf/PerfMonitor.ts` collecte déjà `p50Ms`/`p95Ms`/`p99Ms`/`updateMs`/`renderMs` à
chaque image (`perfMonitor.recordFrame(...)`, déjà appelé dans la boucle `loop()`), mais
`snapshot()` — qui calcule ces statistiques — n'était jamais invoqué nulle part : les données
existaient, rien ne les affichait. Choisi après une revue des candidats restants (tests pour
`project/storage/db.ts`/`MediabunnyEncoder.ts`/`Canvas2DRenderer.ts` écartés comme plus gros que ce
gap-ci, purement additif et à risque quasi nul).

**Correctif** : 3 nouvelles lignes dans `#debug-state` (`index.html`) — percentiles p50/p95/p99,
rendu médian, update médian — juste après la ligne fps existante, laissée INCHANGÉE. `ui/App.ts` :
`perfMonitor.snapshot()` appelé dans `loop()` juste après `recordFrame(...)`, mais GATÉ par
`debugStateEl.open` (`#debug-state` est un `<details>`) — respecte l'avertissement du commentaire
d'en-tête de `PerfMonitor.snapshot()` (« coût non négligeable (tri), à appeler seulement à
l'affichage ») plutôt que de l'appeler inconditionnellement à chaque image comme
`recordFrame(...)`.

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **466/466** verts (inchangé — câblage
d'affichage pur, `PerfMonitor.snapshot()` déjà testé depuis l'Étape 14/P14, aucune nouvelle
logique testable ajoutée). `npm run test:arch` : 1/1. `npm run build` : succès, 165 modules,
314,92 ko (gzip 86,02 ko).

Vérifié au navigateur : panneau FERMÉ, 60 sous-pas simulés (`__pulsarDebug.step()`) en lecture —
les 3 nouvelles lignes restent à `—` (confirme le gate, aucun calcul gaspillé) ; panneau OUVERT
(`details.open = true`), 60 sous-pas de plus — les 3 lignes se remplissent avec des valeurs
plausibles (`8.3 / 8.3 / 8.3 ms`, `3.2 ms`, `0.1 ms` — percentiles identiques attendus dans ce
scénario synthétique piloté par `step()`, sans la variance d'un vrai rAF). Aucune erreur console.
Limites connues : les lignes « Couches »/« Mémoire » mentionnées par docs/10 restent absentes —
`PerfMonitor.ts` ne les a jamais calculées (son propre commentaire d'en-tête les attribue à un
câblage direct dans `ui/App.ts`, jamais fait) ; hors périmètre ici, volontairement limité à ce que
`PerfSnapshot` fournit déjà.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 31 — hors roadmap : premiers tests de project/storage/db.ts

**Hors de docs/00a.** `project/storage/db.ts` (persistance IndexedDB — projets, caches audio/
analyse LRU, réglages) était le seul module encore « non couvert par un test automatisé »
explicitement documenté dans son propre commentaire d'en-tête depuis l'Étape 15/P13 (« `indexedDB`
n'existe pas en environnement Node »), même limite qu'`AudioEngine.ts` avant l'Étape 27 — mais
cette fois avec une surface d'API bien plus large et des règles de cycle de vie de transaction plus
subtiles à reproduire fidèlement à la main (contrairement au petit double `FakeAudioContext` de
l'Étape 27). Question posée explicitement à Aaron avant de coder : écrire un faux IndexedDB maison
(risque de modéliser incorrectement des subtilités réelles — timing de transaction, curseurs — et
donner une fausse confiance) ou ajouter `fake-indexeddb` (bibliothèque standard du secteur, une
nouvelle dépendance de dev). **Choix d'Aaron : `fake-indexeddb`.**

Fait et vérifié : `npm install -D fake-indexeddb` (`^6.2.5`) — aucune vulnérabilité introduite
(`npm audit` : les 2 seules alertes existantes concernent `esbuild`/`vite`, préexistantes, sans
rapport). `tests/unit/db.test.ts` (nouveau, **20 tests**, aucune modification de `db.ts` lui-même —
uniquement des tests ajoutés autour du code déjà en place) : schéma des 4 magasins à l'ouverture,
CRUD complet des projets (sauver/charger/lister/supprimer, `put` écrase sans doublon, id inconnu
renvoie `null` plutôt que lever), cache audio et cache d'analyse (aller-retour fidèle, écrasement
sur la même clé), `getCacheUsage` (somme correcte, indépendante par cache), `clearCaches` (vide
les deux caches, épargne les projets — pas un cache), réglages (`getSettings` sur base vide renvoie
`{}` et non `null`, `saveSettings` écrase entièrement plutôt que fusionner). `IDBFactory` fraîche
(`beforeEach`) : isolation complète entre tests, `openDatabase()` ouvrant toujours le même
`DB_NAME` fixe.

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **486/486** verts (466 + 20 nouveaux). `npm run
test:arch` : 1/1. `npm run build` : succès, 165 modules, 314,92 ko (gzip 86,02 ko) — identique
à l'Étape 30, `fake-indexeddb` étant une dépendance de DEV, jamais dans le bundle de production.
Aucune vérification navigateur : `db.ts` lui-même n'a pas été modifié, rien d'observable dans
l'appli n'a changé — uniquement de l'infrastructure de test ajoutée autour d'un module existant.

Limites assumées, annoncées avant de coder : `AUDIO_CACHE_LIMIT_BYTES`/`ANALYSIS_CACHE_LIMIT_BYTES`
(500 Mo / 200 Mo) ne sont pas des paramètres injectables — les dépasser réellement dans un test
allouerait des centaines de Mo, impraticable. Le déclenchement RÉEL de l'éviction à pleine échelle
n'est donc pas exercé ici ; l'algorithme de SÉLECTION (`selectEvictions`, `project/lru.ts`) est
déjà testé séparément, pur, depuis l'Étape 15/P13 — ce n'est donc pas un vrai trou de couverture,
juste une limite de ce fichier-ci. `evictFromStore` (privée) est implicitement exercée à chaque
appel de `cacheAudio`/`cacheAnalysis` dans les tests ci-dessus, mais ne déclenche jamais de
suppression réelle (tailles de test bien sous les limites).
Dette introduite : aucune connue — première dépendance de dev ajoutée depuis le début du projet
(hors `mediabunny`, dépendance de production), décidée explicitement par Aaron.
Bloque la suite : aucun blocage technique connu.

## Étape 32 — hors roadmap : premiers tests de MediabunnyEncoder.ts et detectSupport.ts

**Hors de docs/00a.** Derniers fichiers d'`export/encoders/` encore sans test (`FrameEncoder.ts`
est une pure interface, `MediaRecorderFallback.ts` déjà testé depuis P8). Contrairement à
`project/storage/db.ts` (Étape 31), AUCUNE décision d'infrastructure n'a été nécessaire ici : `mediabunny`
est une bibliothèque JS normale (pas une API navigateur globale comme `indexedDB`), donc `vi.mock
('mediabunny', ...)` — mécanisme déjà intégré à `vitest`, aucune dépendance supplémentaire —
suffit à intercepter ses exports sans avoir besoin de polyfill WebCodecs.

**`detectSupport.ts`** (`tests/unit/detectSupport.test.ts`, 6 tests) : les 4 combinaisons de la
table de vérité (vidéo/audio supportés ou non → `'webcodecs'`/`'media-recorder'`), les paramètres
exacts transmis à `canEncodeVideo('avc', {width,height,bitrate})`/`canEncodeAudio('aac')`, et
confirmation que les deux vérifications sont lancées en PARALLÈLE (`Promise.all`, pas
séquentiellement — observable via l'ordre d'entrelacement de deux implémentations mockées
asynchrones).

**`MediabunnyEncoder.ts`** (`tests/unit/mediabunnyEncoder.test.ts`, 8 tests) : `mediabunny` mocké
EN ENTIER (classes `Output`/`CanvasSource`/`AudioBufferSource`/`BufferTarget`/`Mp4OutputFormat`/
`Quality`, factices mais fonctionnellement fidèles — n'encodent rien, mais enregistrent leurs
appels) — vérifie que `MediabunnyEncoder` construit ses pistes avec les bons codecs
(`'avc'`/`'aac'`) et bitrates (celui demandé pour la vidéo, `AUDIO_BITRATE_BPS` fixe pour l'audio),
que chaque méthode (`start`/`addVideoFrame`/`addAudio`/`cancel`) délègue fidèlement à la classe
Mediabunny correspondante, que `finish()` ferme les DEUX sources AVANT `finalize()` (ordre vérifié
explicitement) et lève une erreur explicite si le buffer de sortie reste vide après `finalize()`
(un échec silencieux de Mediabunny ne doit jamais produire un `Blob` vide sans le signaler).
Esprit du test conforme à `FakeRenderer`/`FakeFrameEncoder` déjà en place dans ce dépôt : vérifier
que CE module appelle correctement sa dépendance, pas réimplémenter la dépendance elle-même.

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **500/500** verts (486 + 14 nouveaux). `npm run
test:arch` : 1/1. `npm run build` : succès, 165 modules, 314,92 ko (gzip 86,02 ko) — identique à
l'Étape 31, aucun fichier de production touché (uniquement 2 nouveaux fichiers de test). Pas de
vérification navigateur : même raison qu'à l'Étape 31.

Limites connues : aucune nouvelle. `export/encoders/` est maintenant intégralement couvert (les 3
fichiers avec logique propre : `MediaRecorderFallback.ts`, `MediabunnyEncoder.ts`, `detectSupport
.ts` — `FrameEncoder.ts` reste une interface pure, rien à tester).
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 33 — hors roadmap : premiers tests de RealtimeProbe.ts

**Hors de docs/00a.** `audio/RealtimeProbe.ts` (sonde décorative `AnalyserNode`, ADR-003) restait
sans test. Contrairement à `PresetEditorDialog.ts`/autres modules DOM (nécessitent `jsdom`, option
explicitement NON choisie par Aaron à l'Étape 31 face à `fake-indexeddb`) : `RealtimeProbe` ne
touche AUCUN DOM, seulement Web Audio (`AudioContext.createAnalyser()`/`AnalyserNode`) — même
famille qu'`AudioEngine.ts` (Étape 27), donc testable en étendant `FakeAudioContext` existant, sans
nouvelle dépendance ni décision d'infrastructure.

`tests/unit/testSupport/FakeAudioContext.ts` étendu : `FakeAnalyserNode` (nouveau) —
`frequencyBinCount` DÉRIVÉ de `fftSize` via un getter (pas un champ figé : `RealtimeProbe` lit
`frequencyBinCount` juste après avoir écrit `fftSize`, un double qui casserait ce lien donnerait un
résultat correct par accident plutôt que par construction) ; `getByteTimeDomainData` renvoie par
défaut le silence (128 partout, la valeur de repos réelle de l'API), `timeDomainPattern`
surchargeable par test pour simuler un signal. `createAnalyser()` ajouté à `FakeAudioContext`.

`tests/unit/realtimeProbe.test.ts` (nouveau, 11 tests) : construction (`fftSize`/
`smoothingTimeConstant` = 0,6 fixe transmis à l'analyser, valeur par défaut 1024 si omis, la source
est bien connectée À CET analyser précis — pas un autre nœud), `sample()` (désactivée → 0 SANS lire
l'analyser — vérifié par espionnage de `getByteTimeDomainData`, jamais appelée ; silence → 0 ;
signal saturé haut/bas → proche de 1 dans les deux sens ; un signal moitié-silence moitié-saturé
vérifie que le calcul est une vraie MOYENNE des écarts absolus, pas un échantillon isolé ; le
tableau interne est bien dimensionné sur `frequencyBinCount`, pas `fftSize`), `dispose()`
(déconnecte l'analyser).

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **511/511** verts (500 + 11 nouveaux). `npm run
test:arch` : 1/1. `npm run build` : succès, 165 modules, 314,92 ko (gzip 86,02 ko) — identique aux
Étapes 31/32, `RealtimeProbe.ts` lui-même non modifié, uniquement des tests ajoutés autour. Pas de
vérification navigateur : même raison qu'aux Étapes 31/32.

Limites connues : `RealtimeProbe` n'est câblée nulle part dans `ui/App.ts` aujourd'hui (recherché :
aucune référence) — une sonde décorative prévue par l'ADR-003 mais jamais branchée à la preview
réelle ; hors périmètre de cette étape (ajout de tests sur le code existant, pas nouveau câblage),
signalé pour transparence plutôt que découvert en silence.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 34 — hors roadmap : premiers tests de applyLayerMacrosToScene()

**Hors de docs/00a.** `presets/layerMacros.ts::applyLayerMacrosToScene()` — la fonction extraite à
l'Étape 26 pour devenir le POINT DE VÉRITÉ PARTAGÉ entre preview (`ui/App.ts`) et export
(`ExportPipeline.ts`) pour les 6 macros de couche — n'avait jamais de test direct : seule sa
CONSOMMATION en aval (`layer.params` lus par `SpectrumBars`/`PulseRings`/etc, déjà couverts) était
testée, jamais le ROUTAGE par préfixe `<styleId>.<layerId>.<paramKey>` lui-même. Repérée par une
revue ciblée des fichiers avec logique réelle et zéro couverture directe, ne nécessitant ni
`node-canvas` ni `jsdom` (les deux options déjà écartées plus tôt dans la session).

`tests/unit/layerMacros.test.ts` (nouveau, 11 tests) : `FakeLayer` minimal (implémente `Layer`,
méthodes `update`/`draw`/etc en no-op — `applyLayerMacrosToScene` ne lit que `.id` et écrit
`.params`) combiné à la VRAIE classe `Scene`. Tests contre des chemins RÉELS de
`LAYER_MACRO_CURVES` (pas une table synthétique) : chaque couche ne reçoit QUE les clés sous son
propre préfixe (`particleField` n'hérite jamais de `rows`, qui appartient à `perspectiveGrid`) ; le
préfixe est bien retiré de la clé assignée ; une couche sans aucune entrée reçoit `params = {}` —
et non `undefined` ni un résidu d'un appel précédent (testé explicitement : un état `{ancienneValeur:
42}` préexistant est bien écrasé, pas fusionné) ; une même couche peut recevoir des clés de
PLUSIEURS macros différentes (`spectrumBars` : `gap` de densité, `riseTau` de mouvement, `fallTau`
de douceur, simultanément) ; un `layerId` identique sous un AUTRE `styleId` n'est PAS contaminé
(`pulseRings` sous `'field'` — qui n'a aucune entrée réelle pour cet id — reste vide) ; les valeurs
aux extrêmes (`density=0`/`density=1`) correspondent exactement aux `at0`/`at1` déclarés pour deux
chemins réels distincts (`field.particleField.spawnCountMul`, `pulse.pulseRings.maxActiveRings`) ;
deux appels successifs avec des macros différentes REMPLACENT `params`, ne fusionnent jamais ;
`scene.layers` vide ne lève pas.

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **522/522** verts (511 + 11 nouveaux). `npm run
test:arch` : 1/1. `npm run build` : succès, 165 modules, 314,92 ko (gzip 86,02 ko) — identique aux
étapes précédentes, `layerMacros.ts` lui-même non modifié, uniquement des tests ajoutés autour.
Pas de vérification navigateur : même raison qu'aux Étapes 31-33.

Limites connues : aucune nouvelle. Le risque documenté dans l'en-tête du fichier source (« deux
macros écrivant le même chemin se marqueraient silencieusement l'une l'autre ») reste un risque de
MAINTENANCE FUTURE (ajouter une entrée dupliquée par erreur) plutôt qu'un bug actuel — la table
actuelle ne contient aucun doublon (vérifié par relecture à l'Étape 20), mais rien dans ce lot ne
détecte automatiquement une future violation ; envisageable comme test dédié dans une étape
ultérieure si jugé utile.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 35 — hors roadmap : premiers tests de decode.ts

**Hors de docs/00a.** `audio/decode.ts::decodeAudioFile()` restait sans test — testable en Node
via `FakeAudioContext` (déjà construit à l'Étape 27, son `decodeAudioData()` était déjà stubbé mais
jamais exercé). Choisi pour son risque réel documenté (« piège #3 » : `decodeAudioData` DÉTACHE
l'`ArrayBuffer` qu'on lui passe — donner `originalBytes` directement au lieu d'une copie le
rendrait inutilisable pour le remux/hash après coup).

`tests/unit/decode.test.ts` (nouveau, 9 tests) : rejet taille (> 150 Mo) AVANT tout décodage —
vérifié en espionnant `decodeAudioData` pour confirmer qu'il n'est JAMAIS appelé dans ce cas (pas
de décodage gaspillé sur un fichier déjà refusable) ; borne exclusive (`>` pas `>=`) vérifiée aux
deux limites (taille et durée) ; rejet durée (> 12 min) APRÈS un décodage qui a bien eu lieu ;
chemin nominal (buffer + octets d'origine renvoyés) ; et le test central — `decodeAudioData` reçoit
une COPIE dont la référence est DISTINCTE d'`originalBytes` (`.not.toBe`), et `originalBytes`
reste intégralement lisible après l'appel, contenu byte-à-byte vérifié contre l'original. Fichiers
de taille limite (150 Mo) construits avec un contenu à ZÉRO (rapide, l'allocation seule suffit à
tester la borne) — un contenu varié n'est utilisé que pour le test d'intégrité byte-à-byte, sur un
fichier de 256 octets seulement (pas la peine de remplir 150 Mo pour vérifier une copie fidèle).

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **531/531** verts (522 + 9 nouveaux, exécutés en
moins de 300 ms malgré les fichiers de 150 Mo). `npm run test:arch` : 1/1. `npm run build` :
succès, 165 modules, 314,92 ko (gzip 86,02 ko) — `decode.ts` lui-même non modifié. Pas de
vérification navigateur : même raison qu'aux étapes précédentes de cette série.
Limites connues : aucune nouvelle.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 36 — hors roadmap : premiers tests de buildPalette()

**Hors de docs/00a.** `presets/palette.ts::buildPalette()` restait sans test direct.
`tests/unit/presetResolve.test.ts` le couvre déjà INDIRECTEMENT via `resolvePreset()` de bout en
bout (`primary` et `temperature()` seulement), mais jamais `bg`/`secondary`/`accent`/`glow`/
`contrast`, jamais le gel (`Object.freeze`) du résultat, et jamais le `clamp01` interne à ce
fichier — distinct de celui, déjà testé, de `visual/palette/Palette.ts` (`defaultPalette` dans
`palette.test.ts`). `TypedEmitter.ts` (`core/bus/`) a été écarté après vérification : jamais
importé nulle part hors de son propre fichier (grep), code mort — priorité donnée à `buildPalette`,
activement utilisé par `presets/resolve.ts` et donc réellement exercé par l'app.

`tests/unit/buildPalette.test.ts` (nouveau, 11 tests) : champs directs (`id` repris tel quel,
`bg[0]`/`bg[1]` convertis en `Color` dans le même ordre, `primary`/`secondary`/`accent`/`glow`
convertis, `contrast` repris SANS clamp — vérifié avec une valeur hors `[0,1]`, résultat gelé) ;
`temperature()` (interpolation exacte aux bornes `energy=0`/`energy=1` contre `drift.lowEnergy`/
`drift.highEnergy`, point médian à `energy=0.5`, et le clamp interne — `energy<0` se comporte comme
`0`, `energy>1` comme `1`, même schéma de test que pour `defaultPalette`) ; indépendance entre deux
appels successifs avec des configs différentes (aucun état partagé).

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **542/542** verts (531 + 11 nouveaux). `npm run
test:arch` : 1/1. `npm run build` : succès, 165 modules, 314,92 ko (gzip 86,02 ko) — `palette.ts`
lui-même non modifié, uniquement des tests ajoutés autour. `git status --short` : un seul fichier
touché (`tests/unit/buildPalette.test.ts`), aucun fichier de production. Pas de vérification
navigateur : même raison qu'aux étapes précédentes de cette série (zéro code de production modifié).
Limites connues : aucune nouvelle.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 37 — hors roadmap : premiers tests des couches background/

**Hors de docs/00a.** Trois couches `background/` (`DeepVignette` — style Field, `RadialBackground`
— style Pulse, `AnimatedDuotone` — style Spectrum Pro) restaient sans aucun test, malgré une logique
réelle (interpolation de couleur pilotée par `brightness` ou par `step.t`) et un pattern de test déjà
éprouvé sur des couches structurellement proches (`CentralGlow`, `PulseRings`, `SpectrumBars`) :
`FakeRenderer` + `defaultPalette` + `stepContextFixture`, aucune dépendance nouvelle. Dernier lot
restant du 3e audit de couverture avec les couches `waveform/`, les fabriques de style
(`createFieldStyle`/`createSpectrumProStyle`) et `ui/demoDoc.ts` — ces trois derniers repoussés à
une étape ultérieure pour garder ce lot focalisé sur un thème cohérent (les fonds).

`tests/unit/deepVignette.test.ts` (nouveau, 4 tests) : couche la plus simple des trois — ni palette
ni signal ni état, un seul dégradé constant. Rayons `[0, 1.1]`, couleurs fixes (`{r:8,g:8,b:10,a:1}`
centre / noir bord) reprises en dur depuis le fichier source (non exportées) ; indépendance totale
du temps et des signaux vérifiée en comparant deux dessins avec des `update()` opposés ;
`reset()`/`dispose()` ne lèvent pas.

`tests/unit/radialBackground.test.ts` (nouveau, 8 tests) : rayons fixes `[0, 1.0]` (distincts de
`DeepVignette`, assertion ciblée) ; teinte intérieure exactement `bg[0]` à `brightness=0`, `bg[1]` à
`brightness=1`, point médian exact à `brightness=0.5` ; la couleur EXTÉRIEURE reste toujours `bg[1]`
quel que soit `brightness` ; `reset()` ne réinitialise PAS `brightness` en mémoire — l'état n'est
reconstruit que par le prochain `update()` (documenté explicitement en commentaire source, vérifié
par un test dédié).

`tests/unit/animatedDuotone.test.ts` (nouveau, 5 tests) : rayons `[0, 1.1]`, bord toujours `bg[1]` ;
`t=0` donne exactement le facteur `0.4` attendu (`sin(0)=0` → `drift=0.5` → `0.3+0.2×0.5`) ; les
extrêmes de l'animation (`facteur=0.5` au pic du sinus, `facteur=0.3` au creux) vérifiés à des `t`
calculés analytiquement ; PÉRIODICITÉ exacte vérifiée (`t` et `t + période` donnent EXACTEMENT le
même résultat — confirme que c'est une fonction pure de `step.t`, jamais de l'horloge réelle, Loi 1
de docs/00b) ; deux `update()` à des `t` différents changent bien la couleur dessinée.

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **559/559** verts (542 + 17 nouveaux, 17/17 du
premier coup). `npm run test:arch` : 1/1. `npm run build` : succès, 165 modules, 314,92 ko (gzip
86,02 ko) — aucune des trois couches source modifiée. `git status --short` : 3 fichiers touchés,
tous des tests, aucun fichier de production. Pas de vérification navigateur : zéro code de
production modifié.
Limites connues : aucune nouvelle.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 38 — hors roadmap : premiers tests des couches waveform/

**Hors de docs/00a.** `CircularWaveform` (style Pulse) et `FlatWaveform` (style Spectrum Pro)
restaient sans test, malgré une logique réelle de secteur/interpolation entre les 6 `step.bands` —
et surtout une différence de comportement DOCUMENTÉE mais jamais vérifiée entre les deux : le
dernier secteur BOUCLE (`% bandCount`) chez `CircularWaveform` (cohérent, c'est un cercle fermé)
mais est CLAMPÉ (`Math.min`, pas de bouclage) chez `FlatWaveform` (cohérent, c'est une ligne
ouverte). Un bug qui inverserait ces deux comportements ne casserait aucun test existant. Suite du
lot des couches visuelles du 3e audit (après `background/` à l'Étape 37) ; reste : les fabriques de
style et `ui/demoDoc.ts`.

Comme `spectrumBars.test.ts`, un `PmdiDocument` avec des `features` explicites PAR BANDE
(`stepperWithBands`) permet de fixer des valeurs différentes par bande — une seule valeur constante
partout ne distinguerait pas ces couches d'un simple cercle/ligne statique.

`tests/unit/circularWaveform.test.ts` (nouveau, 6 tests) : un seul `strokePath` FERMÉ, 64 segments,
`lineWidth=0.004`, couleur = `palette.secondary` ; toutes bandes à 0,5 → rayon constant = `BASE_
RADIUS` (0,4) sur tout le cercle ; aux limites de secteur EXACTES (64/6 segments par bande, deux
points où `64×n/6` tombe pile sur un entier) : segment 0 (secteur pur "sub") → rayon maximal,
segment 32 (secteur pur "mid") → rayon minimal ; segment 63 (dernier) : vérifie le BOUCLAGE vers le
secteur "sub" (`(i0+1) % bandCount`), valeur attendue calculée analytiquement (`frac=0,90625`) ;
`reset()`/`dispose()` ne lèvent pas.

`tests/unit/flatWaveform.test.ts` (nouveau, 6 tests) : un seul `strokePath` OUVERT, 96 segments,
`lineWidth=0.0018` ; couleur = RGB de `palette.secondary` mais alpha FORCÉE à 0,4, vérifié distinct
de `palette.secondary.a` (=1) ; abscisses suivant `-0,5 + frac×1,0` vérifiées aux bornes et à un
point interne ; segment 0 (secteur pur "sub") reflète `bands.sub` ; dernier segment : vérifie le
CLAMP (pas de bouclage) — construit pour que bouclage et clamp donnent des SIGNES OPPOSÉS
(`sub=0, high=1`), éliminant toute ambiguïté entre les deux hypothèses ; `reset()`/`dispose()` ne
lèvent pas.

Piège rencontré et corrigé AVANT tout run complet : `xs`/`ys` sont des `Float32Array` (docs/10 —
zéro allocation en boucle de rendu) — `toBeCloseTo(x, 10)` est trop strict pour une valeur qui a
transité par une précision 32 bits (~7 chiffres significatifs) ; ramené à `toBeCloseTo(x, 6)`
partout où une valeur lue depuis `xs`/`ys` est comparée. Un test initial supposait à tort que le
segment "du milieu" de `FlatWaveform` (index 47 sur 96) tombait à `xs=0` par symétrie — faux car
`frac = i/(SEGMENTS-1)` et `(SEGMENTS-1)` est impair (95), aucun index entier ne donne `frac=0,5`
exactement ; corrigé en comparant à la formule exacte plutôt qu'à une valeur supposée. Les deux
corrections faites avant le premier `vitest run` propre (7/12 échouaient au premier essai, tous
dus à ces deux causes, aucune ne révélant un bug du code source).

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **571/571** verts (559 + 12 nouveaux). `npm run
test:arch` : 1/1. `npm run build` : succès, 165 modules, 314,92 ko (gzip 86,02 ko) — ni
`CircularWaveform.ts` ni `FlatWaveform.ts` modifiés. `git status --short` : 2 fichiers, tous des
tests, aucun fichier de production. Pas de vérification navigateur : zéro code de production
modifié.
Limites connues : aucune nouvelle.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 39 — hors roadmap : premiers tests des fabriques de style Field/Spectrum Pro

**Hors de docs/00a.** `createFieldStyle()` et `createSpectrumProStyle()` restaient sans test direct
(seul `createPulseStyle` est exercé, indirectement, par `exportPipeline.test.ts`). La mécanique
GÉNÉRIQUE de `Scene` (délégation init/update/draw/reset/dispose dans l'ordre, `usesFeedback` ->
`captureFeedback`) est déjà couverte par `scene.test.ts`/`frameFeedback.test.ts` — ce lot cible donc
UNIQUEMENT ce qui est propre à chaque fabrique : la composition exacte (quelles couches, dans quel
ordre) et le câblage de ses paramètres propres. Dernier lot de couverture visuelle du 3e audit ;
reste seulement `ui/demoDoc.ts`.

`tests/unit/createFieldStyle.test.ts` (nouveau, 6 tests) : composition exacte — 4 couches dans
l'ordre `frameFeedback, deepVignette, perspectiveGrid, particleField`, vérifiée à la fois par `id`
ET par `instanceof` (pour écarter une coïncidence d'id sans être la vraie classe) ; `feedbackEnabled`
correctement câblé vers le 2e argument de `Scene` — omis (défaut) → `captureFeedback()` appelé,
`false` explicite → jamais appelé ; `maxParticles` correctement câblé vers `ParticleField` — omis →
capacité par défaut (2500), fourni → capacité = la valeur transmise, retrouvée via `particleStats()`
sur la couche `particleField` extraite de `scene.layers`.

`tests/unit/createSpectrumProStyle.test.ts` (nouveau, 3 tests) : composition exacte — 3 couches dans
l'ordre `animatedDuotone, spectrumBars, flatWaveform`, id + instanceof ; confirmation qu'aucun 2e
argument n'est transmis à `Scene` (`captureFeedback()` jamais appelé), la plus simple des trois
fabriques de style (aucun paramètre à câbler).

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **580/580** verts (571 + 9 nouveaux, 9/9 du
premier coup). `npm run test:arch` : 1/1. `npm run build` : succès, 165 modules, 314,92 ko (gzip
86,02 ko) — ni `createFieldStyle.ts` ni `createSpectrumProStyle.ts` modifiés. `git status --short` :
2 fichiers, tous des tests, aucun fichier de production. Pas de vérification navigateur : zéro code
de production modifié.
Limites connues : aucune nouvelle.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 40 — hors roadmap : premiers tests de ui/demoDoc.ts

**Hors de docs/00a.** `buildDemoDoc()`/`buildDemoAudioFile()` restaient sans test — deux fonctions
PURES malgré leur emplacement dans `ui/` (aucun DOM), repérées comme telles par le 3e audit de
couverture précisément parce qu'un grep par dossier les aurait ignorées à tort. Dernier fichier du
lot ouvert par ce même audit (après `background/` à l'Étape 37, `waveform/` à l'Étape 38, les
fabriques de style à l'Étape 39) — ce lot est maintenant épuisé.

`tests/unit/demoDoc.test.ts` (nouveau, 24 tests). `buildDemoDoc()` : passe `validatePmdi()` de bout
en bout ; `buildDemoDoc(2)` (durée courte) sert de cas d'ÉNUMÉRATION EXACTE — comptes vérifiés à la
main pour KICK (4), DOWNBEAT (1, le second à beat=4 tombe hors bornes), SNARE (2), HAT (8), DROP/
BUILDUP (0, `dropTimes=[8,20,36]` tous ≥ 2s) ; `grid.beats`/`grid.downbeats` cohérents avec ces
comptes ; événements triés par `t` croissant ; `features` (energy/centroid/6 bandes) toutes à la
bonne longueur (`sampleCount = ceil(2×10)+1 = 21`) ; `sections` A/B/A contiguës couvrant exactement
`[0, durationSec]` sans trou ni chevauchement. Filtre `dropTimes` vérifié aux deux régimes :
`durationSec=60` (défaut) garde les 3 temps, `durationSec=10` n'en garde qu'un seul (borne stricte
`<`, pas `<=`). Déterminisme (Loi 1) : deux appels au même `durationSec` produisent un document
`toEqual` bit pour bit ; `source.createdAt` figé à `new Date(0)`, jamais l'horloge réelle.

`buildDemoAudioFile()` : nom/type MIME, taille totale (`44 + numSamples×2`) ; en-tête WAV complet
décodé au navigateur (marqueurs RIFF/WAVE/fmt /data, PCM mono 16 bits, `sampleRate`/`byteRate`/
`blockAlign` corrects, tailles de sous-chunks cohérentes) ; contenu PCM du ton 220 Hz — échantillon
0 exactement 0 (`sin(0)=0`, aucune ambiguïté), un échantillon interne comparé au MÊME calcul ET au
MÊME passage par `Int16` que la source (plutôt que de supposer un résultat "propre", pour ne pas
présumer d'un comportement d'arrondi/troncature non vérifié) ; déterminisme — deux appels aux mêmes
paramètres produisent des octets identiques.

`npx tsc --noEmit` : 0 erreur (une erreur de type initiale — `doc.features` possiblement
`undefined`, `FeatureTrack[]` étant optionnel dans `PmdiDocument` — corrigée par un `!` avant le
premier run). `npx vitest run` : **604/604** verts (580 + 24 nouveaux, 24/24 du premier coup après
la correction de type). `npm run test:arch` : 1/1. `npm run build` : succès, 165 modules, 314,92 ko
(gzip 86,02 ko) — `demoDoc.ts` non modifié. `git status --short` : 1 fichier, un test, aucun fichier
de production. Pas de vérification navigateur : zéro code de production modifié.
Limites connues : aucune nouvelle. Le lot de couverture visuelle/harnais ouvert par le 3e audit
(Étapes 37-40) est maintenant épuisé — un nouvel audit sera nécessaire pour identifier la prochaine
cible.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 41 — hors roadmap : premiers tests de percentile.ts et trackSampling.ts

**Hors de docs/00a.** Le 3e audit (couches visuelles/harnais) étant épuisé, un 4e audit (agent de
recherche, lecture seule) a été dispatché pour trouver le prochain lot. Résultat : `core/math/
percentile.ts` (`percentile()`/`median()`) et `analysis/trackSampling.ts` (`sampleAt()`/
`averageOverInterval()`) — deux utilitaires numériques sous le pipeline d'analyse RÉEL (`normalize.
ts`, `macro.ts`, `structure.ts`), exercés seulement INDIRECTEMENT et uniquement dans leurs cas
« confortables » (p=0,05/0,95 fixes pour percentile ; intervalles non dégénérés pour
`averageOverInterval`) — jamais les cas limites (n=0/n=1, clampage, repli sur échantillon unique).
Une régression silencieuse dans l'un ou l'autre corromprait les données de visualisation sans jamais
lever d'exception. Candidats explicitement écartés par l'agent : `core/bus/TypedEmitter.ts` (déjà
signalé mort à l'Étape 36, toujours 0 référence hors de son propre fichier) et `export/
yieldToEventLoop.ts` (valeur de test plus faible, gardé en réserve).

`tests/unit/percentile.test.ts` (nouveau, 13 tests) : cas limites `n=0` (renvoie 0 quel que soit p)
et `n=1` (renvoie l'unique valeur, quel que soit p) ; clamp de `p` hors `[0,1]` (`p<0` ≡ `p=0`,
`p>1` ≡ `p=1`) ; interpolation à position ENTIÈRE (aucune interpolation, `sorted[pos]` exact) et
FRACTIONNAIRE (poids asymétrique vérifié par calcul direct, pas seulement le point médian 0,5) ;
confirmation que la fonction TRIE réellement l'entrée (ordre aléatoire = même résultat qu'une entrée
déjà triée) sans la MUTER ; `median()` vérifié comme délégation exacte à `percentile(data, 0.5)`
(n pair et impair).

`tests/unit/trackSampling.test.ts` (nouveau, 12 tests) : `sampleAt()` — lecture directe avec
arrondi, arrondi à 0,5 pile (vers le haut, `Math.round`), décalage `t0` pris en compte ; clampage
aux deux bornes (`t` très négatif -> premier échantillon, très grand -> dernier) ; piste VIDE ->
0 (repli `??`) sans lever. `averageOverInterval()` — intervalle normal (moyenne exacte vérifiée par
calcul), intervalle couvrant toute la piste, `tStart` avant `t0` (i0 clampé à 0) ; intervalle SOUS-
TRAME en plage (dégénère en la moyenne d'un seul échantillon, sans passer par le repli) ; et le
VRAI repli sur `sampleAt` — `tStart` au-delà de la fin de la piste (`i0 > data.length-1`), seul cas
où `i1 < i0` peut se produire dans le code source, vérifié en comparant directement au résultat de
`sampleAt(track, tStart)` plutôt qu'à une valeur supposée.

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **629/629** verts (604 + 25 nouveaux, 25/25 du
premier coup). `npm run test:arch` : 1/1. `npm run build` : succès, 165 modules, 314,92 ko (gzip
86,02 ko) — ni `percentile.ts` ni `trackSampling.ts` modifiés. `git status --short` : 2 fichiers,
tous des tests, aucun fichier de production. Pas de vérification navigateur : zéro code de
production modifié.
Limites connues : aucune nouvelle.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 42 — hors roadmap : premiers tests de yieldToEventLoop.ts et TypedEmitter.ts

**Hors de docs/00a.** Deux candidats mis en réserve par le 4e audit (Étape 41) : `export/
yieldToEventLoop.ts` (jamais testé, valeur de test jugée plus faible mais réelle) et `core/bus/
TypedEmitter.ts` (signalé mort — 0 référence hors de son propre fichier — dès l'Étape 36,
reconfirmé à l'Étape 41 : de la scaffolding réservée à de futurs événements applicatifs, docs/16,
pas encore câblée). Les deux restent des unités de logique réelle, autonomes, testables sans
nouvelle dépendance.

`tests/unit/yieldToEventLoop.test.ts` (nouveau, 3 tests) : le seul comportement à vraie valeur de
non-régression, documenté par le commentaire source (« piège #4 », docs/09) — que la promesse
traverse une VRAIE frontière de macrotâche, pas seulement la file de microtâches. Vérifié en
faisant la course entre `yieldToEventLoop()` et une chaîne de TROIS microtâches imbriquées : si
la fonction n'était qu'un wrapper autour de `Promise.resolve()`/`queueMicrotask` (une microtâche),
elle pourrait s'intercaler avant l'une d'elles ; l'ordre observé confirme qu'elle résout bien
APRÈS que toute la chaîne se soit vidée. Complété par : résolution effective vers `undefined` (ne
bloque pas indéfiniment), deux appels indépendants (deux `MessageChannel` distincts) résolvent
tous les deux.

`tests/unit/typedEmitter.test.ts` (nouveau, 10 tests) : `on()`/`emit()` de base (payload exact,
plusieurs listeners tous appelés dans l'ordre d'abonnement, emit() sans listener ne lève pas,
payload objet transmis PAR RÉFÉRENCE) ; isolation entre clés d'événement (`emit('foo')` n'atteint
jamais un listener de `'bar'`) ; `off()` (retire un listener précis, les autres restent actifs ;
off() d'un listener/événement inconnu ne lève pas) ; la closure renvoyée par `on()` équivaut à
`off()` pour ce listener précis ; un détail d'implémentation à VRAIE valeur de non-régression — le
stockage interne est un `Set`, pas un `Array` : un même listener enregistré deux fois via `on()`
n'est appelé qu'UNE SEULE fois par `emit()` (une implémentation naïve par tableau l'aurait appelé
deux fois) ; et un listener qui se désabonne LUI-MÊME pendant `emit()` (mutation du `Set` en cours
d'itération) n'empêche pas les autres listeners de s'exécuter et ne se ré-exécute pas à l'appel
suivant.

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : **642/642** verts (629 + 13 nouveaux, 13/13 du
premier coup). `npm run test:arch` : 1/1. `npm run build` : succès, 165 modules, 314,92 ko (gzip
86,02 ko) — ni `yieldToEventLoop.ts` ni `TypedEmitter.ts` modifiés. `git status --short` : 2
fichiers, tous des tests, aucun fichier de production. Pas de vérification navigateur : zéro code
de production modifié.
Limites connues : aucune nouvelle. `TypedEmitter` reste non câblée dans l'application (limite déjà
documentée, pas nouvelle) — cette étape en couvre le comportement avant tout premier câblage futur.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 43 — hors roadmap : correction d'un vrai bug dans bassCoherenceScore (tempo.ts)

**Hors de docs/00a.** Le 5e audit de couverture ayant conclu à un gisement épuisé (12 fichiers
restants tous déjà exclus ou du boilerplate trop trivial), un agent de recherche adversarial a été
dispatché pour chercher un vrai bug plutôt que de la couverture. Deux pistes solides remontées ;
sur validation directe du code source par moi-même (pas seulement le rapport de l'agent), l'une
d'elles s'est confirmée être un vrai défaut avec effet observable. L'autre (les anneaux secondaires
de `PulseRings` ne se déclenchent jamais sur un morceau importé, car `AnalysisPipeline.ts`/
`finalize.ts` ne convertissent jamais `grid.downbeats` en `MusicEvent`s `DOWNBEAT`) est mise en
réserve pour une étape séparée — portée plus large, nécessite un plan.

**Le bug :** `bassCoherenceScore()` (`analysis/tempo.ts`, fonction privée utilisée par
`resolveOctaveAmbiguity()`) parcourt une piste d'énergie basse par pas de `periodFrames` et lit
`bassEnergyTrack[Math.round(pos)]` — mais la condition de boucle ne garantit que `pos < length`,
alors que `Math.round(pos)` peut arrondir À `length` (hors limites) quand `pos` tombe dans
`[length-0,5, length)`. La lecture hors tableau renvoie `undefined`, et `sum += undefined`
corrompt la somme en `NaN` pour le reste de cette phase — silencieusement écartée du `max()` (`NaN
> best` est toujours faux), donc la phase potentiellement la MEILLEURE peut être ignorée sans que
rien ne le signale. Cette fonction alimente `resolveOctaveAmbiguity()`, l'arbitrage ×2/÷2 utilisé
précisément dans le cas déjà délicat où la courbe primaire hésite (écart < 15 %, docs/05 l.45-65) —
une corruption y peut faire élire le mauvais tempo (BPM erroné, grille de battements faussée pour
tout le reste du pipeline visuel).

**Reproduction AVANT correctif (discipline du projet) :** ajouté à `tests/unit/tempo.test.ts` un
test appelant directement `resolveOctaveAmbiguity()` (API publique exportée) avec une piste
d'énergie basse construite pour placer un pic d'énergie EXACTEMENT sur la grille de `rawBpm=70`
(frameRate STFT réaliste 22050/128, piste de 6 s) — valeurs trouvées par recherche exhaustive sur
des combinaisons (durée, BPM) réalistes jusqu'à localiser un cas où la corruption change
RÉELLEMENT le vainqueur de l'arbitrage (pas seulement le score interne d'un candidat isolé — un
premier essai avec `rawBpm=60` s'est révélé accidentellement insensible au bug : les DEUX candidats
étaient corrompus à la même valeur, laissant le bon résultat gagner par coïncidence). Lancé seul
contre le code non corrigé : échec confirmé, `expected 140 to be 70` — le grave parfaitement aligné
sur 70 BPM perdait l'arbitrage face à son octave 140.

**Correctif :** un seul `Math.min(bassEnergyTrack.length - 1, Math.round(pos))`, même schéma que
le clamp déjà en place dans `analysis/trackSampling.ts::sampleAt()`. Un hunk.

`npx tsc --noEmit` : 0 erreur. `npx vitest run tests/unit/tempo.test.ts` : 3/3 verts (le nouveau
test passe désormais). `npx vitest run` (suite complète) : **643/643** verts (642 + 1 nouveau).
`npm run test:arch` : 1/1. `npm run build` : succès, 165 modules, 314,92 ko (gzip 86,02 ko) — taille
identique, seuls les hash de fichiers changent (contenu de `tempo.ts` modifié). Pas de vérification
navigateur : le bug n'affecte que des cas limites d'ambiguïté d'octave (écart < 15 % sur la courbe
primaire) difficiles à provoquer de façon fiable et visible via l'UI avec un fichier audio
quelconque — même raisonnement que le clamp d'`AudioEngine` à l'Étape 27, vérifié par test
unitaire reproduisant le mécanisme exact plutôt qu'au navigateur.
Limites connues : le second bug trouvé (PulseRings/DOWNBEAT) reste ouvert, mis en réserve pour une
étape séparée (portée à trancher : DOWNBEAT seul vs BEAT+DOWNBEAT+BAR+PHRASE, docs/06).
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 44 — hors roadmap : synthèse des événements DOWNBEAT dans finalize.ts

**Hors de docs/00a.** Second bug de l'audit adversarial de l'Étape 43, portée validée avec
l'utilisateur : minimale (DOWNBEAT seul, pas BEAT/BAR/PHRASE — ces trois derniers n'ont aujourd'hui
aucun consommateur réel, contrairement à DOWNBEAT).

**Le bug :** `PulseRings.ts` (style Pulse) déclenche ses anneaux secondaires sur `step.fired.some(e
=> e.type === 'DOWNBEAT')` — mais aucun `MusicEvent` de type `DOWNBEAT` n'était jamais construit par
le vrai pipeline d'analyse. `AnalysisPipeline.ts` range les temps forts détectés dans `grid.
downbeats` (un tableau de nombres, pas des événements), et `finalize.ts` — qui assemble le tableau
`events` final à partir de `partial.events`/`classifiedEvents`/`macroEvents` — ne les convertissait
jamais. Seul `ui/demoDoc.ts` (la démo synthétique du harnais) construit un vrai `DOWNBEAT`, ce qui
masquait le trou : `tests/unit/pulseRings.test.ts` alimente la couche avec des événements
synthétiques directs, jamais avec la sortie réelle de `finalizePmdi`. Conséquence concrète : sur
n'importe quel morceau importé et auto-analysé (Mode A), le pool de 8 anneaux secondaires de Pulse
ne s'allumait jamais, pour aucun morceau, jamais — seul l'anneau central (piloté par `impact`/
`weight`, lui bien câblé) réagissait.

**Reproduction AVANT correctif :** 4 nouveaux tests dans `tests/unit/finalize.test.ts` appelant
`finalizePmdi()` avec un `grid.downbeats` non vide et vérifiant la présence d'événements `DOWNBEAT`
dans le résultat. Lancés seuls contre le code non corrigé : échec confirmé sur les 4 (`expected []
to have a length of 4`, etc.) — la fonctionnalité documentée (docs/06 : DOWNBEAT dans le vocabulaire
GÉNÉRAL, pas "Mode B uniquement") était bien absente en pratique.

**Correctif :** dans `finalize.ts`, un nouveau tableau `downbeatEvents` construit depuis
`downbeatTimes` (déjà extrait, ligne 65, pour `detectSections`/`detectMacroEvents`) — un événement
par temps fort, `intensity: 1` (même convention que `demoDoc.ts`), `confidence: partial.confidence.
grid` (reprend la confiance DÉJÀ calculée par la détection de grille, pas une valeur figée comme le
`0.95` arbitraire du harnais synthétique), `meta.barIndex` (index dans `grid.downbeats`, conforme au
payload documenté dans docs/06). Intégré à la fusion `events` existante (ordre inchangé pour les
autres sources, tri global par `t` préservé). Un hunk. `PulseRings.ts` lui-même non modifié : il
écoutait déjà correctement `'DOWNBEAT'`, il n'en recevait simplement jamais.

`npx tsc --noEmit` : 0 erreur. `npx vitest run tests/unit/finalize.test.ts` : 10/10 verts (les 4
nouveaux passent désormais). `npx vitest run` (suite complète) : **648/648** verts (643 + 4
nouveaux — aucune régression sur les fixtures existantes qui avaient déjà `grid.downbeats` non vide,
notamment `breakScenario` dans ce même fichier, vérifiées : aucune n'affirmait de compte total
d'événements). `npm run test:arch` : 1/1. `npm run build` : succès, 165 modules, 315,03 ko (gzip
86,06 ko) — légère hausse attendue (nouveau code de synthèse dans `finalize.ts`).

Pas de vérification navigateur complète (import d'un vrai fichier audio + pipeline Worker de bout
en bout) : le mécanisme du correctif est entièrement capturé par les tests unitaires (logique de
synthèse PMDI pure, déterministe, sans dépendance DOM/navigateur) ; une confirmation visuelle
nécessiterait d'importer un fichier audio réel et de faire tourner le pipeline d'analyse complet
(déjà couvert par ailleurs par `pipeline.test.ts`) — proposable sur demande si une confiance
supplémentaire est souhaitée.

Limites connues : `BEAT`/`BAR`/`PHRASE` (docs/06, même vocabulaire général) restent absents du vrai
pipeline — portée explicitement exclue de cette étape (décision utilisateur), aucun consommateur
réel aujourd'hui donc aucun impact visible actuel, mais le même trou de contrat documenté subsiste
pour ces trois types.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

Addendum post-commit : la correction ci-dessus a été confirmée de bout en bout au navigateur
(preview `pulsar-dev`, http://localhost:5174) — `importTrack()` exécuté avec un `AudioBuffer` réel
(`buildDemoAudioFile()` + `decodeAudioFile()`), pipeline Worker complet, sans contournement.
Résultat : **16 événements DOWNBEAT** synthétisés, exactement `grid.downbeats.length` (16), chacun
avec la vraie `confidence` de grille (0,8276…, pas figée) et `meta.barIndex` séquentiel (0..15).
Vérification demandée « sur demande » dans le rapport d'étape initial, effectuée dans la foulée
sans modification de fichier — aucun nouveau commit nécessaire pour cet addendum.

## Étape 45 — hors roadmap : correction de la mise en page responsive (canvas illisible < 768px)

**Hors de docs/00a.** Trouvé par exploration interactive du harnais dans le navigateur (pas par
lecture de code ni par test unitaire — exactement le genre de bug que ni l'audit statique ni les
tests ne peuvent détecter, `App.ts`/le DOM restant hors périmètre des tests unitaires par
conception, docs/16). En vérifiant la correction de l'Étape 44 au navigateur, la grille CSS de
`index.html` s'est révélée n'avoir AUCUN `@media` (vérifié par grep) : `body { grid-template-
columns: 1fr 340px; }`, une colonne principale flexible et une barre latérale fixe de 340px, sans
aucun point de rupture. Sous ~700px de large, `#preview-wrap` (`aspect-ratio: 16/9`) hérite d'une
largeur quasi nulle — confirmé en lisant `getBoundingClientRect()` en direct : à 406px de large
(largeur d'iPhone typique), le canvas de prévisualisation — le cœur du produit — tombait à **34×19
CSS px**, littéralement illisible, alors que le reste de l'interface (boutons, sliders) restait
normalement dimensionné. Pas une dégradation progressive : cassé net dès le passage sous le seuil,
y compris en redimensionnant une fenêtre de bureau (pas seulement sur mobile).

**Correctif (choix utilisateur : corriger, breakpoint 768px)** : un seul bloc `@media (max-width:
768px)` ajouté dans `index.html` — la grille passe d'une colonne à deux (`1fr 340px`) à une seule
colonne (`grid-template-rows: auto 1fr auto`), faisant passer la barre latérale sous l'aperçu au
lieu d'à côté ; `aside` perd sa bordure gauche au profit d'une bordure haute (cohérence visuelle de
l'empilement). `aside` avait déjà `overflow-y: auto` (pensé pour l'ancien layout à hauteur
contrainte) — devient un no-op inoffensif en layout empilé, où c'est la page entière qui défile
normalement. Un hunk, aucun fichier `.ts` touché.

**Vérification au navigateur (avant/après, aux deux extrêmes)** :
- Avant le correctif, à 406px : `#preview-wrap` = 34,4×19,35 CSS px (confirmé par
  `getBoundingClientRect()`).
- Après le correctif, à ~400-610px (plusieurs largeurs testées sous le seuil) : canvas 525-578px de
  large, barre latérale repositionnée SOUS l'aperçu (`aside.getBoundingClientRect().top` après le
  bas de `#preview-wrap`, plus de positionnement côte à côte) — capture d'écran prise à 400px de
  large : l'anneau central du style Pulse est bien visible et net.
- Au-dessus du seuil (1280px, desktop) : canvas 908×511 CSS px, IDENTIQUE à avant le correctif ;
  barre latérale toujours positionnée à côté (`aside.left = 940`, pas en dessous) — aucune
  régression du layout desktop.

`npx vite build` : succès, 165 modules, `index.html` 14,64 ko (gzip 4,29 ko, légère hausse attendue
— nouveau bloc CSS). `npx vitest run` (suite complète) : **648/648** verts, inchangé (fichier CSS
pur, aucune logique TypeScript touchée). `npm run test:arch` : 1/1. `git status --short` : 1
fichier (`index.html`).
Limites connues : le breakpoint (768px) et la stratégie (empilement simple plutôt que tiroir
repliable) sont un choix pragmatique, pas un audit UX mobile complet — d'autres réglages fins
(tailles de police, paddings) pourraient encore être resserrés sur très petits écrans si jugé utile
plus tard.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 46 — hors roadmap : synthèse des événements BEAT/BAR/PHRASE dans finalize.ts

**Hors de docs/00a.** Reprise, sur demande explicite, de la portée mise en réserve à l'Étape 44
(DOWNBEAT seul à l'époque). Referme le contrat documenté par docs/06_EVENT_SYSTEM.md §"Grille
rythmique" pour les trois types restants du vocabulaire général (pas "Mode B uniquement").

**BEAT** (`meta.indexInBar`, 0..3) : synthétisé depuis `grid.beats`, un événement par entrée. Le
calcul n'est PAS un simple `i % 4` (qui supposerait à tort que le premier beat détecté est toujours
un downbeat) : `AnalysisPipeline.ts::detectDownbeat()` calcule une phase interne (`downbeat.phase`,
0..3) jamais persistée dans le PMDI, et `downbeatTimes = beats.filter(i % 4 === phase)` — vérifié
en lisant le code source. `computeIndexInBar()` retrouve cette phase en cherchant l'index du
PREMIER downbeat dans `beatTimes` (égalité stricte, garantie exacte par construction — même valeur
`b.t` recopiée sans arithmétique dans les deux tableaux), puis calcule `((i − phase) % 4 + 4) % 4`
pour chaque beat. Sans aucun downbeat détecté (piste très courte/silencieuse), repli sur phase 0 —
seule hypothèse possible faute d'ancrage, documenté comme tel.

**BAR** ("début de mesure", sans payload documenté) : `DOWNBEAT` ("premier temps de la mesure") et
`BAR` coïncident exactement dans l'hypothèse MVP à 4 temps déjà posée par ce projet (un seul modèle
métrique, aucune distinction rythme/perception à faire) — mêmes instants que `grid.downbeats`,
sans `meta`.

**PHRASE** ("début de phrase, 4 ou 8 mesures", `meta.bars`) : AUCUN signal de structure phrastique
n'existe dans ce pipeline (`structure.ts` détecte des SECTIONS par énergie, un concept différent,
pas aligné sur des multiples de mesures) — hypothèse MVP explicite et assumée, au même titre que la
mesure à 4 temps déjà en place : une phrase toutes les 4 mesures (`PHRASE_BARS = 4`, une constante
nommée plutôt qu'un nombre magique), `meta.bars` reflète ce choix plutôt que de le taire.

`tests/unit/finalize.test.ts` (+6 tests, 16 au total) : BEAT — décalage de phase non trivial
vérifié avec des downbeats démarrant à l'index de beat 2 (pas 0), attendu `[2,3,0,1,2,3,0,1]` ;
repli phase 0 sans aucun downbeat. BAR — mêmes instants que DOWNBEAT, `meta` absent. PHRASE — un
événement tous les 4 downbeats, `meta.bars = 4`. `grid.beats`/`grid.downbeats` vides : aucun
événement des 3 types, ne lève pas. `confidence` des 3 types reprend celle de la grille (0,33 dans
le test), pas figée — même principe que DOWNBEAT (Étape 44).

**Vérification au navigateur** (pipeline Worker réel, `importTrack()` + `buildDemoAudioFile()` +
`decodeAudioFile()`, même méthode qu'à l'Étape 44) : sur une démo de 20 s, **64 BEAT**, **16
DOWNBEAT**, **16 BAR** (instants identiques aux DOWNBEAT, confirmé programmatiquement), **4
PHRASE** (`meta.bars=4` chacun). Les 2 premiers beats détectés (avant le tout premier downbeat)
reçoivent bien `indexInBar` 2 et 3 — pas 0 et 1 — confirmant que le calcul de phase fonctionne sur
de VRAIES données détectées, pas seulement sur les fixtures construites à la main des tests
unitaires.

`npx tsc --noEmit` : 0 erreur. `npx vitest run tests/unit/finalize.test.ts` : 16/16 verts, 6/6
nouveaux du premier coup. `npx vitest run` (suite complète) : **654/654** verts (648 + 6 nouveaux).
`npm run test:arch` : 1/1. `npm run build` : succès, 165 modules, 315,44 ko (gzip 86,19 ko) —
légère hausse attendue (nouvelle logique de synthèse). `git status --short` : 2 fichiers
(`finalize.ts`, `finalize.test.ts`).
Limites connues : PHRASE reste une hypothèse mécanique (toutes les 4 mesures, jamais 8, jamais liée
à une vraie répétition musicale) — pas de régression par rapport à avant (l'événement n'existait
pas du tout), mais à ne pas confondre avec une détection de structure réelle. Le vocabulaire complet
de docs/06 §"Grille rythmique" est maintenant entièrement câblé côté Mode A.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 47 — hors roadmap : la démo synthétique n'accumule plus une entrée par clic

**Hors de docs/00a.** Repéré pendant l'exploration interactive de l'Étape 45 (mis de côté à
l'époque) : le panneau Projets accumulait une entrée « Démo synthétique » distincte et permanente à
CHAQUE clic sur « Charger une démo », sans aucune action de l'utilisateur au-delà du clic lui-même
(l'auto-sauvegarde se déclenche 5 s après tout chargement, `applyActiveConfiguration()` →
`scheduleAutosave()`). Cause : `loadDemo()` (`App.ts`) appelle `startNewProjectIdentity()` — qui
génère un `projectId` (`crypto.randomUUID()`) neuf à chaque appel — exactement comme pour un vrai
fichier fraîchement importé, ce qui est correct pour un import réel mais pas pour un contenu
synthétique strictement identique rechargé plusieurs fois. `saveProject()` fait un `put` classique
(upsert par id, vérifié dans `db.test.ts`) : réutiliser le même id écrase l'entrée précédente au
lieu d'en créer une nouvelle — même principe déjà en place pour « Nouvelle variante », qui garde le
`projectId` et ne fait que régénérer la graine.

**Choix utilisateur** : réutiliser le même `projectId` entre chargements de démo, sans toucher au
comportement des fichiers réellement importés (qui gardent une identité neuve à chaque import,
inchangé).

**Correctif** : deux nouvelles variables de module `demoProjectId`/`demoProjectCreatedAt` (`null`
tant qu'aucune démo n'a été chargée cette session). Dans `loadDemo()`, après l'appel — inchangé —
à `startNewProjectIdentity()` (qui fait toujours son travail complet : nom, graine fraîche, hash,
cache audio), `projectId`/`projectCreatedAt` sont RÉÉCRITS avec l'identité stable de la démo si
elle existe déjà, ou celle-ci est initialisée au premier chargement. La graine (`projectSeed`) reste
fraîche à chaque clic — chaque rechargement produit donc une variante visuelle différente, mais
c'est la MÊME entrée sauvegardée qui est mise à jour, pas une nouvelle à chaque fois (exactement le
même principe que « Nouvelle variante », qui ne touche jamais `projectId` non plus).

**Vérification au navigateur** (seule vérification possible : logique d'orchestration `App.ts`,
hors périmètre des tests unitaires par conception, docs/16) : démo chargée 3 fois de suite, 5,6 s
d'attente après chaque clic (le délai d'auto-sauvegarde), panneau Projets rouvert et compté après
chaque chargement (avec un délai supplémentaire pour laisser `listProjects(db)`, asynchrone, se
résoudre — un premier essai sans ce délai donnait un compte à zéro, race condition de mesure, pas
un vrai comportement de l'app). Résultat : **7 entrées avant le 1er rechargement de cette
vérification, 7 après le 2e, 7 après le 3e** — le compte reste rigoureusement stable, confirmant
l'upsert. Le chemin d'import d'un vrai fichier n'a pas été retouché (code inchangé) : garde son
identité neuve par construction.

`npx tsc --noEmit` : 0 erreur. `npx vitest run` (suite complète) : **654/654** verts, inchangé
(`App.ts` n'a jamais de test dédié, par conception). `npm run test:arch` : 1/1. `npm run build` :
succès, 165 modules, 315,50 ko (gzip 86,22 ko). `git status --short` : 1 fichier (`App.ts`).
Limites connues : aucune nouvelle.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 48 — hors roadmap : deux imports qui se chevauchent ne corrompent plus l'audio joué

**Hors de docs/00a.** Un second agent de recherche adversarial, dédié cette fois à `ui/App.ts`
(jamais audité — l'audit statique précédent avait explicitement exclu l'orchestration DOM, docs/16),
a remonté trois pistes de concurrence. Validation directe du code source par moi-même (pas
seulement le rapport de l'agent) : deux confirmées, la première plus grave que décrite par l'agent.
Portée retenue avec l'utilisateur : le bug 1 (le plus sévère, le mieux circonscrit) — les bugs 2
(scrub pendant analyse) et 3 (vignette désynchronisée) restent ouverts, non corrigés.

**Le bug :** `AudioEngine.load()` (`audio/AudioEngine.ts:62-71`) n'a aucune protection de
concurrence : `this.decoded = await decodeAudioFile(...)` écrase l'état interne SANS CONDITION,
quel que soit l'ordre de RÉSOLUTION (pas l'ordre d'appel) des deux décodages. `loadFile()`
(`ui/App.ts`) ne vérifiait par ailleurs jamais `controller.signal.aborted` avant d'agir. Scénario
concret : déposer un gros fichier A (décodage lent), puis avant qu'il ne termine, déposer un petit
fichier B (décodage rapide). B se charge et s'affiche correctement en premier — mais quand le
décodage de A finit ENFIN (plus tard), `this.decoded` bascule silencieusement sur A à l'intérieur
du moteur audio, alors que la timeline/l'analyse affichées restent celles de B. Conséquence directe,
vérifiée en traçant `startSource()` (`AudioEngine.ts:157-172`, `node.buffer = this.decoded.buffer`) :
cliquer Lecture joue l'audio de A pendant que la grille de battements/sections vient de B — un vrai
désynchronisme audio/visuel qui persiste jusqu'au prochain import, pas seulement un risque au moment
d'une sauvegarde. Trois points d'appel touchés : `loadFile()`, `loadDemo()` (l'agent avait noté
qu'un import réel suivi d'un clic sur « Charger une démo » déclenche le même mécanisme) et un
troisième, `restoreProject()` (`App.ts:807-819`), repéré par moi en cherchant tous les appels à
`audioEngine.load()` — non signalé par l'agent, même défaut exact (un `AbortController` déjà créé,
mais son `signal` jamais transmis à `load()`, jamais vérifié après résolution).

**Correctif :** `AudioEngine.load()` accepte désormais un `signal?: AbortSignal` optionnel
(piège #11, numéroté à la suite du piège #10 déjà documenté dans ce fichier) — vérifié APRÈS la
résolution du décodage, AVANT toute affectation à `this.decoded`/le reste de l'état ; un signal déjà
annulé à ce moment précis fait ignorer silencieusement le résultat périmé (pas d'erreur — même
convention que le reste du pipeline face à un abandon), sans jamais toucher l'état interne, qui
reste celui du chargement gagnant. Les trois appelants (`loadFile`, `loadDemo`, `restoreProject`)
transmettent désormais leur `controller.signal` et vérifient `controller.signal.aborted` juste après
la résolution, avant de faire quoi que ce soit d'autre (identité de projet, cache, etc.).

**Reproduction AVANT correctif (discipline du projet) :** `tests/unit/audioEngine.test.ts`, nouveau
test simulant précisément la course — ordonnancement piloté par ORDRE D'APPEL de
`decodeAudioData()` (pas par timing de réassignation synchrone, un premier essai s'est révélé
insensible au bug à cause d'un tick de microtâche introduit par `file.arrayBuffer()` avant que
`decodeAudioFile()` n'atteigne effectivement `decodeAudioData()` — corrigé avant le run final).
Lancé avec la garde temporairement commentée : échec confirmé, `expected 100 to be 42` — le
résultat périmé de A écrasait bien celui de B. Remis en place : passe.

`npx tsc --noEmit` : 0 erreur. `npx vitest run tests/unit/audioEngine.test.ts` : 6/6 verts (2
nouveaux). `npx vitest run` (suite complète) : **656/656** verts (654 + 2). `npm run test:arch` :
1/1. `npm run build` : succès, 165 modules, 315,67 ko (gzip 86,25 ko). `git status --short` : 3
fichiers (`AudioEngine.ts`, `App.ts`, `audioEngine.test.ts`). Pas de vérification navigateur
supplémentaire : le mécanisme exact (deux `decodeAudioData()` qui se chevauchent, résolution hors
ordre) est un comportement standard et documenté de la Web Audio API, pas une particularité du
navigateur à confirmer — le test unitaire, qui exerce le VRAI `decodeAudioFile()` de production
avec uniquement le contexte simulé, capture entièrement le mécanisme ; même raisonnement que les
correctifs numériques des Étapes 27/43.
Limites connues : le bug 2 (scrub de la frise pendant une analyse en cours — `handleSeek()` ne
vérifie que la nullité de `currentTimeline`/`scene`, pas leur fraîcheur) et le bug 3 (vignette
d'auto-sauvegarde potentiellement désynchronisée si `captureThumbnail()` résout après le début d'un
nouveau chargement) restent ouverts, non corrigés — portée exclue par choix explicite de
l'utilisateur.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 49 — hors roadmap : le scrub de la frise pendant une analyse en cours n'applique plus le seek au mauvais audio

**Hors de docs/00a.** Reprise du bug 2 laissé ouvert à l'Étape 48, sur choix explicite de
l'utilisateur (le plus sévère des deux restants).

**Le bug :** `audioEngine.load()` bascule sur le nouveau fichier dès que son décodage résout, mais
`currentTimeline`/`scene`/`currentAudioBuffer` ne rattrapent l'ancien document qu'après l'analyse
complète (Worker, peut prendre plusieurs secondes pour un vrai morceau) — pas seulement en cas
d'imports qui se chevauchent (piège #11, Étape 48) : un import simple et seul suffit à ouvrir cette
fenêtre. `handleSeek()` (`App.ts:461-462`) ne vérifiait que la NULLITÉ de `currentTimeline`/
`stepper`/`behaviourEngine`/`scene`, jamais leur fraîcheur — ils restent non-nuls (juste périmés)
pendant toute la fenêtre. `#timeline-canvas` est un élément FRÈRE de `#preview-wrap`
(`index.html:173-186`), donc jamais couvert par l'overlay « Analyse… » : rien n'empêche
visuellement ni logiquement l'interaction. Scruber pendant cette fenêtre appliquait le seek au
NOUVEL audio (déjà chargé dans le moteur) avec l'ANCIENNE grille de battements/sections encore
affichée.

**Correctif :** un seul ajout à `handleSeek()` — `if (currentAudioBuffer !== audioEngine.
decodedBuffer) return;`. Choix délibéré de réutiliser un état déjà existant plutôt que d'introduire
un nouveau drapeau à réarmer/réinitialiser sur les 3 points d'appel (`loadFile`/`loadDemo`/
`restoreProject`, chacun avec ses propres chemins d'erreur/annulation) : `currentAudioBuffer` n'est
mis à jour qu'une fois l'analyse terminée — c'est EXACTEMENT la variable qui reste en retard sur le
moteur pendant la fenêtre dangereuse, et qui rattrape automatiquement dès que `applyDocCore()`
s'exécute. Protège uniformément les 3 points d'entrée du seek (`Timeline.onSeek`, `seekToStart`
pour l'export, « Nouvelle variante ») puisque tous passent par `handleSeek()`.

**Vérification au navigateur** (seule vérification possible : `App.ts` hors périmètre des tests
unitaires par conception, docs/16) : un fichier synthétique de 10 minutes (`buildDemoAudioFile()`)
déposé via un vrai événement `drop` (`DataTransfer`), pour déclencher le VRAI chemin `loadFile()` →
analyse Worker (contrairement à `loadDemo()`, qui saute cette étape). Scrub tenté ~400 ms après le
dépôt, `#analysis-status` confirmé visible (`analysisInProgress: true`) : `t` AVANT et APRÈS la
tentative de scrub strictement identiques (`15.400399218229762` des deux côtés) — le seek a bien
été bloqué. Sur un second essai (fichier de 10 s, analyse rapide, `#analysis-status` de nouveau
caché) : scrub à 50 % → `t` passe correctement de `0` à `5.5` — confirme que le correctif ne
bloque PAS le scrub en dehors de la fenêtre dangereuse.

`npx tsc --noEmit` : 0 erreur. `npx vitest run` (suite complète) : **656/656** verts, inchangé
(`App.ts` sans test dédié par conception). `npm run test:arch` : 1/1. `npm run build` : succès, 165
modules, 315,69 ko (gzip 86,26 ko). `git status --short` : 1 fichier (`App.ts`).
Limites connues : le bug 3 (vignette d'auto-sauvegarde potentiellement désynchronisée) reste
ouvert, non corrigé — fenêtre de déclenchement non garantie à tracer, confiance plus faible,
impact mineur (juste une image de prévisualisation, pas les données du projet).
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 50 — hors roadmap : réévaluation et clôture du bug 3 (vignette d'auto-sauvegarde)

**Hors de docs/00a.** Retraçage complet du mécanisme du bug 3 (laissé ouvert, confiance faible, aux
Étapes 48-49) avant toute proposition de correctif — conclusion : ne pas corriger, choix confirmé
avec l'utilisateur.

**Retraçage :** `saveCurrentProject()` (`App.ts:735-747`) capture `project` (métadonnées :
`projectId`/`audioHash`/`currentDoc`, etc.) de façon SYNCHRONE via `buildCurrentProject()`, puis
`await captureThumbnail()` — un `canvas.toBlob()`, encodage JPEG asynchrone mais typiquement de
l'ordre de quelques dizaines de millisecondes, pas plus. Pour que la vignette capturée dépeigne un
AUTRE projet que les métadonnées déjà figées dans `project`, il faudrait qu'un import COMPLET
(décodage + analyse Worker intégrale) se termine ENTIÈREMENT dans cette fenêtre de quelques
dizaines de ms. Or les mesures réelles des Étapes 48/49 (au navigateur, sur de vrais appels à
`runAnalysisWithProgress`) montrent une analyse Worker qui prend de plusieurs centaines de
millisecondes à plusieurs secondes, même pour un contenu synthétique court — un ordre de grandeur
au-dessus de la fenêtre de `captureThumbnail()`. Contrairement aux bugs 1 et 2 (déclenchables par un
simple import isolé, sans aucun timing particulier), le bug 3 demanderait une coïncidence de timing
non atteignable par une utilisation normale. Et même déclenché, l'impact resterait mineur : une
image de prévisualisation légèrement fausse dans le panneau Projets — les données réelles du projet
(référence audio, cache d'analyse, preset, macros) restent, elles, correctes et cohérentes.

**Décision (confirmée avec l'utilisateur) :** ne pas corriger. Clôt le fil des 3 pistes remontées
par l'audit adversarial de `ui/App.ts` (Étape 48) — 2 corrigées (bugs 1 et 2, Étapes 48-49), 1
documentée comme acceptée après réévaluation (bug 3, cette étape).

Aucun fichier de code touché — réévaluation et documentation seules.
Limites connues : aucune nouvelle — le bug 3 reste un risque théorique résiduel, accepté en
connaissance de cause.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 51 — hors roadmap : premiers tests de features.ts

**Hors de docs/00a.** 6e audit de couverture, sur demande explicite. Contrairement aux rounds 1-5,
celui-ci a explicitement RE-VÉRIFIÉ la conclusion « pool épuisé » du round 5 plutôt que de la tenir
pour acquise — et l'a réfutée : `analysis/features.ts::computeFrameFeatures()` (79 lignes, logique
DSP réelle) était passé inaperçu des 5 audits précédents, probablement parce que le fichier EST
importé par des tests existants (`onsetDescriptors.test.ts`, via `computeFrameFeatureTracks`) sans
que ses valeurs de sortie soient jamais directement assertées — un faux négatif pour un grep
superficiel par nom de fichier. Vérifié par moi-même avant d'écrire quoi que ce soit : seul `.peak`
transite réellement dans les tests existants, vers `computeOnsetDescriptor` qui recalcule son PROPRE
centroïde indépendamment (`spectralCentroid`) — `centroid`/`flatness`/`rolloff85`/`rms`/`energy` de
`features.ts` n'étaient jamais exercés.

`tests/unit/features.test.ts` (nouveau, 16 tests). `rms`/`peak` (domaine temporel, signal brut) :
valeurs connues, `peak` en valeur ABSOLUE, segment silencieux → 0. `energy` : somme des carrés de
magnitude. `centroid` (moyenne pondérée par fréquence) : une seule bande non nulle tombe pile sur sa
fréquence, distribution symétrique tombe sur le bin médian, trame silencieuse → repli sur 0 (pas de
division par zéro/NaN, la garde `magSum > 0 ? ... : 0`). `flatness` (ratio moyenne géométrique/
arithmétique) : spectre plat → proche de 1, pic dominant unique → proche de 0, toujours borné à 1
(`Math.min(1, ...)`) — noté par honnêteté : par l'inégalité arithmético-géométrique, ce clampage est
mathématiquement redondant en arithmétique exacte (la moyenne géométrique de `(m+ε)` est TOUJOURS
≤ la moyenne arithmétique de `(m+ε)`), il ne protège que contre un dépassement d'arrondi flottant —
pas testé comme un cas atteignable en pratique, seulement vérifié comme une garantie qui tient.
`rolloff85` (seuil cumulatif à 85% de l'énergie) : franchissement au bon bin sur une distribution
uniforme, franchissement immédiat quand l'énergie est concentrée au premier bin, cas à un seul bin.
`rawFrameSegment()` (extraction de segment) et `computeFrameFeatureTracks()` (boucle par trame,
vérifiée par comparaison directe à un appel manuel de `computeFrameFeatures()`).

`npx tsc --noEmit` : 0 erreur. `npx vitest run tests/unit/features.test.ts` : 16/16 verts, 16/16 du
premier coup. `npx vitest run` (suite complète) : 1 échec au premier lancement — `pipeline.test.ts`
§"AnalysisPipeline — intégration", SANS RAPPORT avec `features.test.ts` (aucun état partagé,
fonctions pures) ; passait seul en isolation (2/2) ; relancé sans aucun changement, **672/672**
verts (91/91 fichiers) — confirmé comme un flake ponctuel PRÉEXISTANT (probablement contention de
threads de test en parallèle sur cette intégration coûteuse), signalé pour transparence plutôt que
tu, hors du périmètre de cette étape. `npm run test:arch` : 1/1. `npm run build` : succès, 165
modules, 315,69 ko (gzip 86,26 ko) — `features.ts` non modifié. `git status --short` : 1 fichier,
un test, aucun fichier de production. Pas de vérification navigateur : zéro code de production
modifié.
Limites connues : un flake préexistant et intermittent a été observé dans `pipeline.test.ts` (voir
ci-dessus) — pas nouveau, pas causé par cette étape, mais noté pour une investigation future si la
récurrence devient gênante.
Dette introduite : aucune connue.
Bloque la suite : aucun blocage technique connu.

## Étape 52 — hors roadmap : pont audio postMessage pour embarquement en iframe

**Hors de docs/00a.** Demande d'Aaron : intégrer le visualizer dans son générateur de beats (Beat
Studio CDJ, projet séparé) via une iframe plein espace, avec le beat courant chargé automatiquement
— pas de ré-import manuel. Ajouté dans `src/ui/App.ts` : un listener `window.addEventListener(
'message', ...)`, actif seulement en contexte iframe (`window !== window.top`, aucun effet en usage
autonome), qui reçoit `{ type: 'pulsar:load-audio', buffer: ArrayBuffer, filename?: string }`,
construit un `File` et appelle `loadFile()` telle quelle — le MÊME chemin que l'import glisser-
déposer/sélecteur de fichier, aucune nouvelle logique d'analyse/décodage. Aucune vérification
d'origine sur le message : le pire cas (une page tierce embarque le visualizer et poste un faux
fichier) est équivalent à un import utilisateur normal, sans privilège particulier accordé.

Testé de bout en bout via Playwright + `file://` contre le fichier réel de Beat Studio CDJ (côté
émetteur, hors de ce dépôt) : rendu du beat courant en WAV côté Beat Studio (réutilisation de son
pipeline d'export existant, `_renderOfflineBars`/`audioBufferToWav`, aucune duplication), envoyé par
`postMessage` ciblé sur l'origine exacte du visualizer (jamais `'*'`), reçu et chargé automatiquement
— confirmé visuellement (écran d'import vide → écran d'analyse), sans ré-import manuel.

**Limite découverte à l'exécution, pas à la lecture** : le premier essai envoyait le beat ENTIER
(32 mesures) — 70,7 s réelles avant que le visualizer reçoive l'audio (pipeline par tranches côté
Beat Studio, chunké pour ne pas geler l'UI, mais pas plus rapide en temps total). Corrigé côté Beat
Studio (hors de ce dépôt) : extrait de 8 mesures au lieu du beat complet → 8,8 s, revérifié par le
même test de bout en bout.

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : 672/672 verts (91/91 fichiers), aucune régression.
`npm run test:arch` : 1/1. `npm run build` : succès, 165 modules, 315,95 ko (gzip 86,35 ko).
Vérification navigateur : bout en bout via Playwright (voir ci-dessus), le seul canal réaliste ici
puisque le comportement dépend d'un vrai contexte iframe cross-document.
Limites connues : pas de vérification d'origine sur les messages entrants (voir ci-dessus, risque
jugé nul) ; l'extrait envoyé est toujours les 8 premières mesures, jamais un passage plus
représentatif du morceau (ex. le refrain) — accepté comme suffisant pour une réaction visuelle,
pas comme une garantie de représentativité.
Dette introduite : aucune connue côté PULSAR VISUALIZER.
Bloque la suite : nécessite un redéploiement du `dist/` buildé vers l'hébergement (Netlify) pour que
le pont soit actif en production — fait manuellement par Aaron après cette étape, pas automatisé.

## Étape 53 — hors roadmap : pont audio EN DIRECT (WebRTC) vers Beat Studio CDJ

**Hors de docs/00a.** Retour d'Aaron sur l'Étape 52 : le pont fichier « capture un extrait puis
relit » ne « bouge pas au rythme » de ce qu'il entend réellement dans Beat Studio — deux lectures
indépendantes sur deux horloges différentes, pas un miroir en direct. But : un vrai flux audio
continu, pour que le visuel réagisse exactement à ce qui joue, sans jamais relancer le beat.

Contrainte dure confirmée par lecture du code avant toute décision : le moteur visuel existant
(presets « Trap Dark » etc., `Transport`/`AudioEngine`/`StepContext`/`BehaviourEngine`/`Scene`,
protégés par « Loi 1 » — rendu = fonction pure du temps) repose entièrement sur une analyse
complète et différée du morceau (autocorrélation globale pour le tempo, DP sur la fonction de
détection d'attaques complète pour la grille de battements, matrice d'auto-similarité globale pour
la structure) — rien de tout ça n'est incrémental, donc inutilisable sur un flux dont la fin n'est
pas connue. Déjà documenté comme non fait dans PULSAR (« Mode C », V3 future). Choix confirmé avec
Aaron après un compromis proposé et refusé (capture répétée conservant les presets) : vrai WebRTC en
direct, quitte à un visuel plus simple pendant le mode direct.

Nouveau, additif, n'importe jamais dans le moteur existant :
- `src/audio/LiveAudioSource.ts` (couche `audio`) : réception WebRTC côté réponse. `handleOffer(sdp)`
  → `setRemoteDescription`/`createAnswer`/`setLocalDescription`, attend la collecte ICE (non-trickle,
  bornée ~500 ms), retourne l'answer en objet simple `{type, sdp}` (un `RTCSessionDescription` natif
  n'est pas clonable par `postMessage` — `DataCloneError` rencontré et corrigé à l'exécution, des
  deux côtés du pont). `attachAnalysis()` branche un `AnalyserNode` sur le flux reçu, jamais sur
  `ctx.destination` (Beat Studio joue déjà le son, un second chemin créerait un écho). Piège Chrome
  rencontré et corrigé à l'exécution : un flux WebRTC distant connecté à un `AnalyserNode` via
  `createMediaStreamSource()` seul ne produit AUCUNE donnée, même `connectionState:'connected'` et
  octets RTP réellement reçus confirmés par `getStats()` — il faut AUSSI un élément `<audio>` (muet,
  jamais ajouté au DOM) consommant le flux pour que le pipeline audio de Chrome s'active. Ne réutilise
  pas `RealtimeProbe.ts` (explicitement « décorative », contrat différent).
- `src/ui/live/LiveVisualPanel.ts` (couche `ui`) : `<canvas id="live-canvas">` dédié, propre boucle
  `requestAnimationFrame`, dessin 2D brut (barres de fréquence radiales via `computeLogSpacedBinRanges`
  réutilisée de `spectrumBands.ts`, anneau pulsant sur l'énergie, étiquette « EN DIRECT »). Passe par
  une instance DÉDIÉE de `FlashLimiter` (garde anti-flash WCAG 2.3.1 même en direct), séparée de
  celle du mode fichier pour ne pas mélanger temps musical et temps réel dans la même fenêtre de
  débit.
- `src/ui/App.ts` : le listener `message` existant (Étape 52) reçoit une branche pour
  `pulsar:live-offer` — pas de second listener. `ontrack` attache l'analyse et démarre le panneau ;
  `onconnectionstatechange` sur `closed`/`failed`/`disconnected` arrête le panneau — vraie source de
  vérité pour la coupure, pas un message qui pourrait ne jamais arriver si l'iframe est retirée du
  DOM. Aucune modification de `loop()`/`raf()`/`loadFile()`/tout ce qui touche au moteur existant.

Côté Beat Studio CDJ (hors de ce dépôt, édition chirurgicale directe sur le fichier SOURCE) :
nouveaux flags `_VIZ_LIVE_V1`/`_VIZ_LIVE_TIMEOUT_MS`, tap additif sur `_master` (même motif que
`exportVideo()`), `RTCPeerConnection` sans serveur STUN/TURN (les deux pairs sont dans le même
onglet — candidats hôtes suffisants, garde l'app hors-ligne), garde dédiée `_vizPc` distincte de
`_exportInProgress` (un export WAV/vidéo ne doit pas être bloqué par le visualizer ouvert, et
réciproquement).

Vérifié en 6 étapes Playwright + `file://` distinctes (jamais de serveur HTTP pour le fichier Beat
Studio — bug de rendu déjà documenté, sans rapport) : (1) référence — chemin fichier existant
inchangé ; (2) signalisation + livraison du flux seule, `pc.getStats()` confirme des octets reçus,
lecture Beat Studio jamais interrompue, fermeture ramène les deux `RTCPeerConnection` à `closed` ;
(3) `getFrequencyData()`/`getEnergy()` varient réellement dans le temps (corrigé après le piège
Chrome ci-dessus — figés à zéro avant le correctif) ; (4) rendu réel — deux captures d'écran à
~700 ms d'écart, pixels différents confirmés ; (5) repli au premier échec — connexion simulée sans
réponse jamais reçue, offre envoyée à +0,26 s, `_VIZ_LIVE_TIMEOUT_MS` (4 s) déclenche le repli sur
`_sendCurrentBeatToVisualizer`, audio livré via `pulsar:load-audio` à +11 s (cohérent avec les
7-11 s de capture réelle documentées), jamais d'écran vide, lecture Beat Studio jamais interrompue ;
(6) cycle complet — ouvrir/fermer/rouvrir deux fois de suite (chaque cycle reconnecte proprement),
régénérer un beat pendant que l'overlay reste ouvert (connexion vérifiée persistante : `bytesReceived`
passe de 5001 à 13539 sans jamais quitter `connected`, donc pas de reconnexion), déclencher un
export WAV réel pendant que le direct tourne (téléchargement confirmé, non bloqué, connexion en
direct toujours `connected` après — la garde dédiée fonctionne dans les deux sens).

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : 672/672 verts (91/91 fichiers). `npm run test:arch` :
1/1 — `layerOf()` classe `src/audio/LiveAudioSource.ts` en couche `audio` et
`src/ui/live/LiveVisualPanel.ts` en couche `ui` par le seul premier segment du chemin, toutes deux
déjà autorisées, aucune modification du tableau `ALLOWED_LAYERS` nécessaire. `npm run build` :
succès, 168 modules, `index-DkyCcwSD.js` 321,43 ko (gzip 88,25 ko), 1,33 s.
Deux bugs réels trouvés uniquement par exécution, aucun par lecture (voir ci-dessus : `DataCloneError`
et l'analyse figée à zéro) — confirme une fois de plus que ce projet ne se vérifie pas à la lecture
seule.
Limites connues : sans serveur STUN/TURN, ce pont ne fonctionnerait pas si les deux pages étaient un
jour servies depuis des machines différentes (hors périmètre actuel — même onglet/même machine
uniquement). Une coupure en cours de session n'affiche qu'un message, sans retentative automatique
(choix confirmé avec Aaron).
Dette introduite : aucune connue côté PULSAR VISUALIZER.
Bloque la suite : nécessite un redéploiement du `dist/` buildé vers l'hébergement (Netlify) pour que
le pont EN DIRECT soit actif en production — fait manuellement par Aaron après cette étape, pas
automatisé (même geste que l'Étape 52 : glisser-déposer `dist/` sur le site Netlify existant).

## Étape 54 — hors roadmap : moteur d'analyse temps réel pour le mode EN DIRECT (étape 1/2)

**Hors de docs/00a.** Suite de l'Étape 53 : Aaron veut un visuel de meilleure qualité pour le mode
direct. Premier des deux volets d'un « PROMPT-live-visual-upgrade v2 » externe : le moteur d'analyse
temps réel (tempo, phase de battement, downbeat) qui alimentera le rendu. **Le rendu lui-même n'est
pas touché dans cette étape** — pipeline visuel (palettes OKLCH, scènes, director, overlays) reporté
à l'étape 2, journalisé par avance dans `src/ui/live/NOTES.md` comme hors périmètre ici.

Nouveau, sous `src/ui/live/` (choix assumé : pas de `live/` à la racine comme suggéré par le prompt
externe, pour rester dans le périmètre surveillé par `tests/unit/architecture.test.ts` qui ne
parcourt que `src/`) : `LiveConfig.ts` (constantes de réglage), `audio/bins.ts` (conversions Hz/bin
dérivées de `sampleRate`, aucune fréquence en dur), `audio/AnalysisGrid.ts` (rééchantillonnage à
50 Hz), `audio/AudioFeatures.ts` (bandes spectrales, centroïde, platitude, AGC), `audio/OnsetDetector.ts`
(détection d'attaques par blanchiment adaptatif + seuil adaptatif), `audio/TempoEstimator.ts`
(autocorrélation avec recherche fractionnaire), `audio/BeatClock.ts` (PLL de phase), `audio/
LiveAnalysisEngine.ts` (machine à états BOOT/IDLE/REACTIVE/LOCKED), `DebugHud.ts` (overlay de debug),
`testing/` (banc d'essai synthétique sans navigateur). Ajouts uniquement (liste blanche respectée)
dans `src/audio/LiveAudioSource.ts` (second `AnalyserNode`, accès aux données flottantes) et
`src/ui/App.ts` (signature de `start()` étendue en param optionnel, accesseurs de debug) — aucune
signature existante supprimée.

**Sept défauts trouvés par l'exécution sur signaux synthétiques, aucun par la lecture** (documentés
en détail dans `NOTES.md`) : seuil de détection empoisonné au démarrage (variance nulle → seuil
explosif) ; recherche d'harmoniques sur des lags entiers alors que le vrai pic est fractionnaire
(verrouillait à 63,8 BPM au lieu de 128) ; interpolation linéaire de l'autocorrélation qui renvoie
toujours un nœud entier (5,5 BPM de quantum) ; absence d'acquisition de phase initiale (le PLL
rejetait 77 kicks sur 77 et restait bloqué) ; quantification des instants d'onsets au pas de grille
(biais systématique sur signal périodique) ; flux spectral calculé par trame plutôt qu'intégré sur le
pas de grille (127,9 BPM à 60 fps contre 63,9 à 120 fps sur le même signal — dépendait du framerate) ;
hésitation d'octave confondue avec un changement de morceau (perte du tempo toutes les 8 s). Chacun
corrigé et verrouillé par un test dédié.

Deux écarts assumés par rapport au prompt externe, documentés avec dérivation complète dans
`NOTES.md` : le signe de la correction de phase du PLL (le prompt l'avait inversé, ce qui aurait fait
diverger l'horloge — dérivation dans l'en-tête de `BeatClock.ts`) ; une double compensation du même
retard entre la rétro-datation des onsets et le calcul de `syncOffsetMs` (~43 ms en trop), neutralisée
par un drapeau `sync.onsetBackdatingApplied` réglable, avec les cinq termes affichés séparément au HUD
pour vérification à l'œil — le réglage fin final (`sync.userTrimMs`) reste à trancher par Aaron à
l'oreille/à l'œil, pas mesurable en isolation.

Mesures (`npx vitest run tests/unit/live`, 22 tests) : verrouillage à 128 BPM en ±0,34 BPM à t=4s,
phase RMS 5,9 ms sur 60 s ; comportement correct testé à 90/140/174 BPM, avec gigue 2 %, sur rampe de
tempo, en silence, et sur changement de morceau. Vérifié aussi au navigateur (`live-bench.html` via
`npm run dev`, click track synthétisé par de vrais `OscillatorNode`/`AnalyserNode`) : état LOCKED,
tempo 127,96 BPM, aucune erreur console.

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : 694/694 verts (93/93 fichiers, +22 par rapport à
l'Étape 53). `npm run test:arch` : 1/1. `npm run build` : succès, 176 modules, `index-Ctfq0icd.js`
367,45 ko (gzip 101,55 ko).
Limites connues : le rendu visuel n'a pas encore changé (étape 2 requise pour que ce moteur soit
visible à l'écran) ; la confiance du vote de downbeat reste basse sur un motif de test simpliste
(pas de ligne de basse) — à réévaluer sur de la vraie musique ; la latence son→image réelle n'est pas
mesurée en conditions réelles (nécessiterait un filmage écran+son à 240 fps), le réglage `userTrimMs`
au HUD est prévu pour cette calibration manuelle.
Dette introduite : aucune connue.
Bloque la suite : étape 2 (pipeline de rendu) nécessaire pour que ce moteur d'analyse pilote
effectivement le visuel. Redéploiement Netlify fait après cette étape malgré l'absence de changement
visuel visible, pour garder le dépôt distant et la production synchronisés avec le code réellement
en place.

## Étape 55 — hors roadmap : pipeline de rendu du mode EN DIRECT (étape 2/2, palettes + post-FX)

**Hors de docs/00a.** Suite directe de l'Étape 54 : le moteur d'analyse temps réel existait, mais le
rendu à l'écran n'avait pas encore changé. Cette étape branche enfin un vrai pipeline visuel sur ce
moteur — c'est la partie visible par Aaron.

Nouveau sous `src/ui/live/render/` : `Palette.ts` (8 palettes OKLCH, 5 rôles, fondu perceptuel,
modulation de teinte bornée par construction — conversion OKLCH↔sRGB dans `util/oklch.ts`, fonctions
pures), `FrameBudget.ts` (qualité adaptative à 4 niveaux, descente rapide/remontée lente, zone morte,
gel), `LayerStack.ts` (point d'écriture unique de `ctx.filter`, feature-test), `Assets.ts` (grain,
halo, vignette/scanlines pré-composés), `Bloom.ts` (bright-pass + flou par paliers), `Feedback.ts`
(ping-pong avec décroissance normalisée par `dt`), `PostFX.ts` (aberration chromatique en
demi-résolution, grain, sonde de luminance 32×18, composition unique), `Camera.ts` (caméra 2D
commune, le shake est une modulation de cette caméra et non un effet séparé), `LivePipeline.ts`
(assemblage). Plus `audio/SectionEnergy.ts` (détection breakdown/build/drop sur les niveaux bruts,
quantifiée sur le downbeat) et `scenes/WitnessScene.ts` (scène témoin — les 6 scènes du prompt externe
restent pour une étape 3 non commencée, tout comme le director qui gérerait le budget d'effets
simultanés).

Deux écarts assumés documentés avec dérivation dans `NOTES.md` : l'ordre de dégradation qualité
suit la phrase normative du prompt externe plutôt que sa table entre parenthèses (les deux se
contredisaient) ; le comptage des passes de post-traitement est pondéré par l'aire réelle (un
`drawImage` sur un buffer au quart de résolution coûte 1/16 d'une passe plein écran, pas une passe
entière) — sans quoi le budget de passes du prompt externe n'était tout simplement pas atteignable.
Deux optimisations imposées par la mesure : composition directe à l'écran quand l'aberration
chromatique est désactivée (évite une copie + un blit plein écran, niveau 2 : 9 → 6,4 passes) et
finition (grain/vignette) en résolution réduite quand le diviseur interne est actif (niveau 1 :
3,75 → 2,31 passes). Exclusion mutuelle aberration/grain ajoutée : sans elle, une trame de transitoire
demandait 11 passes pour un budget de 10, et les deux effets se recouvrent perceptuellement de toute
façon.

Mesuré au navigateur (Chrome, canvas 1920×1080, écran 60 Hz, click track 128 BPM, médiane sur 200
trames) : les 4 niveaux de qualité tiennent 60 fps — la médiane est plafonnée par la période d'écran
(16,7 ms), pas par le pipeline lui-même ; marge réelle non mesurable dans ce cas simple, à réévaluer
à l'étape 3 sur une scène chargée en particules. Mémoire canvas 34,2 Mo au maximum pour un plafond de
120 Mo. Niveau 2 dépasse son budget de passes de 6 % (6,36 contre 6) — signalé plutôt que masqué en
ajustant le budget, sans effet mesurable sur le temps de trame.

Vérifié en conditions réelles (Playwright + `file://` contre Beat Studio, comme pour l'Étape 53) :
connexion WebRTC établie, moteur d'analyse en état REACTIVE avec BPM détecté, **trois captures d'écran
prises à quelques secondes d'écart montrent un rendu clairement différent de l'ancien panneau (barres
radiales) et clairement animé** — halo, traînées de feedback qui s'accumulent et se dissipent, arc
tournant, aucune erreur console côté PULSAR (la seule erreur capturée est un avertissement `Fetch API`
préexistant et sans rapport, propre au runtime de Beat Studio sous `file://`).

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : 721/721 verts (94/94 fichiers, +27 par rapport à
l'Étape 54). `npm run test:arch` : 1/1. `npm run build` : succès, 188 modules, `index-D7Wr5vBy.js`
402,96 ko (gzip 112,18 ko).
Limites connues : une seule scène témoin est câblée (les 6 scènes prévues et le director qui
orchestrerait les transitions restent à faire) ; la qualité d'image perçue et le choix des 8 palettes
ne sont validables qu'à l'œil, pas par un test automatisé ; la lisibilité du tempo dans le rendu
(arc/épaisseur/rotation portant respectivement temps/mesure/phrase) reste à confirmer par Aaron à
l'usage.
Dette introduite : aucune connue.
Bloque la suite : étape 3 du prompt externe (les 6 scènes + transitions) et étape 4 (director avec
budget d'effets simultanés, garde-fou de non-saturation) restent à faire pour la version complète.
Redéploiement Netlify fait immédiatement après cette étape.

## Étape 56 — hors roadmap : trois scènes du mode EN DIRECT (étape 3/6 du prompt externe)

**Hors de docs/00a.** Suite de l'Étape 55 : le pipeline de rendu existait mais une seule scène témoin
tournait dessus. Cette étape livre l'interface `LiveScene` définitive et trois scènes réelles, une par
famille visuelle — le prompt externe (§9.3) demande explicitement trois scènes à cette étape, pas les
six de §4.2 : les trois restantes sont reportées à l'étape 5, la sélection/rotation entre scènes
(`LiveDirector`, §4.3) à l'étape 4.

Nouveau sous `src/ui/live/` : `util/noise.ts` (simplex 2D et champ de bruit curl écrits à la main,
aucune dépendance npm ajoutée, déterministes et seedés — divergence du champ mesurée sous 5 %,
propriété testée), `scenes/index.ts` (registre : ajouter une scène = une entrée, ni le pipeline ni le
panneau n'ont besoin d'être touchés), et les trois scènes : `GridHorizonScene.ts` (géométrique/néon —
sol qui défile, horizon qui se soulève sur le kick, soleil qui se révèle sur la snare), `CurlFlowScene.ts`
(organique — noyau émetteur, particules portées par le champ curl), `SliceDisplaceScene.ts` (glitch —
barre façon VHS dont la position/épaisseur suit le kick). Chacune : 3 variantes internes (deux
décentrées, une centrée), un accent principal déclaré, un canal visuel dédié par instrument (kick/
snare/charley) sans jamais additionner deux enveloppes d'attaque — contrainte du prompt externe
respectée partout.

Écart assumé documenté avec dérivation dans `NOTES.md` : `slice-displace` est décrite par le prompt
externe comme « le buffer de feedback redécoupé en bandes », mais une autre règle du même prompt
(§3.3) impose de vider ce buffer à chaque coupe de scène — les deux mises bout à bout font démarrer la
scène sur du noir (luminance mesurée à 0,006 contre 0,064 pour `grid-horizon`). La règle de vidage
n'est pas contournée : la scène injecte sa propre matière (cinq bandes lumineuses quantifiées sur la
mesure musicale, pas un simple analyseur de spectre), qui sera redécoupée aux trames suivantes.

Mesuré (soak de 60 s par scène, Chrome, canvas 960×540, click track 128 BPM) : croissance du tas JS
sous 0,80 Mo pour les trois scènes (critère du prompt externe : sous 5 Mo), `curl-flow` — la plus
allouante en apparence avec 6000 particules — étant celle qui croît le moins, ce qui confirme que les
pools préalloués fonctionnent ; aucune exception ; tempo verrouillé pendant tout le soak sur les trois
scènes (127,8 à 128,3 BPM), ce qui vérifie au passage que le rendu ne perturbe pas l'analyse.

Vérifié en conditions réelles (Playwright + `file://` contre Beat Studio) : connexion établie, scène
par défaut `grid-horizon` confirmée active, puis les trois scènes sélectionnées explicitement une par
une et capturées — **trois rendus visuellement distincts et cohérents avec leur famille annoncée**
(horizon néon avec soleil, noyau organique à traînées, bandes VHS), aucune erreur console côté PULSAR.
Ajout mineur pour permettre cette vérification : `sceneId`/`selectScene` étaient déjà exposés sur
`LiveVisualPanel` (commentés « exposé pour la vérification Playwright », même intention que
`engineState`/`bpm` de l'Étape 54) mais pas encore branchés sur le hook `window.__pulsarLiveDebug`
dans `src/ui/App.ts` — branchement ajouté ici, DEV uniquement, même style que l'existant.

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : 744/744 verts (95/95 fichiers, +23 par rapport à
l'Étape 55). `npm run test:arch` : 1/1. `npm run build` : succès, 193 modules, `index-CCskCqsX.js`
411,79 ko (gzip 115,03 ko).
Limites connues : `slice-displace` est conçue pour hériter du feedback d'une scène précédente — son
rendu isolé (sans enchaînement) reste plus vide qu'en usage réel, à réévaluer à l'étape 4 quand le
director existera ; l'équilibre de luminance entre scènes est très inégal (0,064 pour `grid-horizon`
contre 0,007 pour les deux autres, un facteur 9) et se verra en enchaînement ; le tempo est-il lisible
son coupé reste à valider par Aaron à l'œil (le sol de `grid-horizon`, qui avance d'une cellule par
temps, est le test le plus direct des trois).
Dette introduite : aucune connue.
Bloque la suite : étape 4 du prompt externe (`LiveDirector`/`IntensityDirector` — choix de scène,
rotation, budget d'effets simultanés, garde-fou de non-saturation) et étape 5 (trois scènes restantes)
pour la version complète. Redéploiement Netlify fait immédiatement après cette étape.
