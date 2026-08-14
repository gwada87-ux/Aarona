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

## Étape 57 — hors roadmap : directors, transitions, overlays, contrôles (étape 4/6 du prompt externe)

**Hors de docs/00a.** Suite de l'Étape 56 : trois scènes existaient mais restaient figées (une seule
tournait en continu, sélectionnée une fois au démarrage). Cette étape branche enfin l'orchestration
automatique — c'est ce qui transforme trois scènes statiques en un vrai spectacle qui vit tout seul.

Nouveau sous `src/ui/live/` : `IntensityDirector.ts` (budget d'effets, plancher de vide, retenue avant
impact, retombée d'après drop, quasi-noir en breakdown, garde-fou de non-saturation — ne lit **jamais**
l'audio directement, uniquement la détection de section déjà produite par `SectionEnergy` à l'Étape 55 ;
c'est ce découpage qui rend vraie la règle « aucun effet ne se règle directement sur l'audio »),
`LiveDirector.ts` (arbitrage des coupes entre scènes par ordre de priorité strict, anti-répétition,
pondération par intensité/arc, mode dégradé, journal des coupes avec la frontière qui les a
déclenchées), `Overlays.ts` (six overlays expressifs avec budget et exclusions mutuelles, bascule
uniquement sur frontière de mesure), `Controls.ts` (raccourcis clavier : tap tempo, verrous de
scène/palette, navigation manuelle quantifiée à la mesure suivante, panic, HUD — persistés dans
`localStorage` sous `live-visual-controls`, sauf les verrous et le tap tempo, qu'on ne veut pas
retrouver au redémarrage suivant). Plus le tap tempo dans `BeatClock` et les transitions dans
`LivePipeline` (fondu additif, feedback partagé entre les deux scènes, `FrameBudget` gelé pendant la
coupe).

Écart assumé documenté avec dérivation dans `NOTES.md` : la règle anti-répétition du prompt externe
(« aucune scène ne revient avant que 3 autres soient passées ») rendrait TOUTE scène inéligible en
permanence avec seulement 3 scènes au registre — le director se figerait. La fenêtre est plafonnée à
`nombre de scènes - 1` (donc 2 aujourd'hui), passera automatiquement à 3 dès que la quatrième scène
sera ajoutée (étape 5), sans toucher au code. Ce qui reste garanti dans tous les cas et ce que le test
vérifie : jamais deux fois la même scène de suite.

Deux défauts trouvés par les tests, pas par la lecture : l'explosion d'après drop arrivait une trame
trop tard (`barsSinceDrop` calculé avant l'enregistrement du drop plutôt qu'après — la trame la plus
importante, celle qui porte l'impact, était perdue) ; `actionForKey` levait une exception hors DOM
(`target instanceof HTMLInputElement` explose si `HTMLInputElement` n'existe pas), ce qui rendait la
fonction elle-même impossible à tester — remplacé par un test sur `tagName`/`isContentEditable`.

Mesuré (`tests/unit/live/liveDirectorLong.test.ts`, critère du prompt externe : 10 minutes de signal
synthétique) : 600 s réelles analysées trame par trame en 30 s de temps de test, au moins 10
changements de scène, aucune répétition immédiate, aucune coupe hors grille métrique sauf en mode
dégradé ou action manuelle, écart minimal de 6 s entre deux coupes, budget d'overlays jamais dépassé.

Vérifié en conditions réelles (Playwright + `file://` contre Beat Studio, échantillonnage de la scène
courante toutes les 3 s sur 48 s) : **le director bascule effectivement tout seul** —
`grid-horizon` (0-15 s) → `curl-flow` (18-33 s) → `slice-displace` (36-48 s), deux coupes automatiques
observées sans aucune intervention manuelle, aucune répétition, tempo resté verrouillé (138-140 BPM)
pendant toute la rotation, aucune erreur console côté PULSAR.

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : 776/776 verts (97/97 fichiers, +32 par rapport à
l'Étape 56, dont le test de 10 minutes simulées). `npm run test:arch` : 1/1. `npm run build` : succès,
197 modules, `index-QymP7YBH.js` 433,72 ko (gzip 121,38 ko).
Limites connues : le rythme des coupes (15 à 60 s) est un choix de mise en scène du prompt externe,
pas mesuré comme « le bon » — à ajuster à l'usage si ça paraît trop long/court sur un set rapide ; la
dramaturgie (plancher de vide, retenue avant impact, retombée d'après drop) est mesurable mais son
EFFET perçu reste une question de goût ; l'esthétique des six overlays n'est vérifiée que pour le
budget/les exclusions, pas pour le rendu lui-même.
Dette introduite : aucune connue.
Bloque la suite : étape 5 du prompt externe (trois scènes restantes : `laser-tunnel`, `mandala-32`,
`type-slam`) et étape 6 (polish — easings, affinage grain/bloom, calibration de `userTrimMs`).
Redéploiement Netlify fait immédiatement après cette étape.

## Étape 58 — hors roadmap : dernières scènes + polish, les 6 étapes du prompt externe livrées

**Hors de docs/00a.** Clôture du « PROMPT-live-visual-upgrade v2 » : étapes 5 et 6 livrées ensemble.
Le registre passe de 3 à 6 scènes et le director tourne désormais sur l'ensemble complet ; le polish
corrige deux manques réels de dramaturgie découverts en relisant la spec plutôt qu'en avançant tête
baissée.

**Étape 5 — trois scènes restantes** : `LaserTunnelScene.ts` (anneaux émis sur le kick, point de fuite
qui se déplace), `Mandala32Scene.ts` (onde de choc sur le kick, secteurs qui passent de 6 à 8 à 12 à 16
sur les frontières de mesure, occultation d'un secteur sur deux sur la snare — pas un spectrogramme
déguisé : les 32 bandes ne sont pas lues mais repliées, et la scène pilote 5 paramètres par 5 sources
distinctes là où l'interdit de la spec externe ne vise que 2), `TypeSlamScene.ts` (texte rastérisé une
seule fois par changement — jamais dans la boucle de rendu, `measureText()` y coûterait cher à chaque
image — avec attente de `document.fonts.ready` pour ne jamais mettre en cache la police de repli).
Un nouvel accès `SceneContext.layers` permet à `type-slam` de rastériser son texte dans un calque
dédié sans échapper à l'inventaire mémoire du pipeline (`LayerStack`) ni au plafond global — Safari
renvoie `null` sur `getContext()` au-delà d'un certain total, silencieusement.

**Étape 6 — polish** : deux manques réels trouvés en relisant la spec en entier, aucun des deux visible
en testant au fil de l'eau. (1) L'enveloppe de réaction à une frappe (kick/snare/charley) ne revenait
jamais vraiment au repos — une exponentielle ne touche jamais zéro, elle restait donc partiellement
allumée quand la frappe suivante arrivait, mangeant le contraste qu'elle devait créer ; remplacée par
une fonction qui atteint zéro exactement à l'échéance (`util/easing.ts`), avec les durées reréglées en
conséquence (kick : 1,05 → 0,50 temps — changement volontaire et visible). (2) Les temps faibles et
contretemps ne recevaient aucun accent visuel quand rien n'était détecté à cet instant précis, alors
que l'horloge, elle, savait qu'un temps passait — un plancher par frontière d'horloge (`gridAccent`,
`util/accent.ts`) comble ce vide, en `max` jamais en somme (une somme cumulerait avec un vrai onset et
violerait la règle « un canal par instrument, jamais deux enveloppes additionnées »), pondéré par la
confiance de l'horloge pour ne jamais inventer un temps qu'elle n'est pas sûre d'avoir.

Trois autres corrections de fond : le garde-fou de non-saturation comparait la luminance moyenne au
seuil sans hystérésis — une boucle de régulation sans hystérésis oscille à chaque trame par
construction (mesuré : passait à 1 bascule sur 600 trames après correction, contre une par trame
avant) ; le grain était à plein régime en permanence plutôt que dosé à l'inverse de la luminance
mesurée ; la descente qualité (`FrameBudget`) mettait jusqu'à 1,4 s à se stabiliser en cas de
surcharge sévère récurrente au lieu du <1 s exigé — corrigé par une descente de deux crans d'un coup
sur récurrence rapprochée plutôt qu'un cran par cran systématique. Ajout d'une mire de calibration
(touche `C`) — un carré blanc allumé une seule trame au temps 1 visuel, passant par le `FlashLimiter`
comme tout le reste — qui rend mesurable la latence son→image réelle (nécessite un filmage à 240 fps,
qu'Aaron seul peut faire) sans pour autant fournir la valeur finale de calibration.

Écart assumé documenté avec dérivation dans `NOTES.md` : la règle du prompt externe imposant une
vérification statique façon ESLint sur les allocations en zone chaude (interdiction de `new`/`[]`/
`.map`/littéraux de fonction dans les fichiers marqués « hot-path ») aurait exigé d'installer ESLint
pour une seule règle, ce que le projet interdit par ailleurs (aucune nouvelle dépendance) — portée
en test (`liveHotPath.test.ts`) qui lit le même AST TypeScript qu'une règle ESLint aurait lu, avec un
garde-fou qui échoue si plus aucun fichier n'est marqué (une règle qui ne s'applique à rien passe
toujours).

Mesuré (soak 60 s par nouvelle scène, tempo verrouillé sur les trois pendant tout le soak, croissance
mémoire sous 1,31 Mo) ; composition vérifiée par échantillonnage de luminance en grille (le volet de
prévisualisation masqué empêchait les captures directes côté banc synthétique — contournement déjà
rencontré à l'étape 3). Le tableau de temps de trame par scène demandé par la spec externe (§8.10)
s'est révélé impossible à obtenir en onglet d'arrière-plan (0 `requestAnimationFrame` reçu) — mesuré à
la place le coût de rendu synchrone forcé, en round-robin sur les 7 scènes : l'écart entre la scène
témoin (qui ne dessine presque rien) et la plus lourde (`curl-flow`, 6000 particules) n'est que de 6 %
— la chaîne de post-traitement (6,36 passes plein écran) domine entièrement le budget, pas le choix de
scène. Conclusion actionnable et honnêtement rapportée plutôt que masquée : le tableau par scène
demandé ne discriminera jamais rien, c'est `FrameBudget` qui gouverne.

Vérifié en conditions réelles (Playwright + `file://` contre Beat Studio) : les trois nouvelles scènes
forcées explicitement produisent trois rendus distincts et cohérents (tunnel sombre au point de fuite,
rosace radiale à secteurs, texte « LIVE » avec séparation RVB) ; le director, laissé tourner librement
56 s sans aucune sélection manuelle, a traversé 4 scènes distinctes du registre étendu
(`type-slam → laser-tunnel → mandala-32 → slice-displace`) sans jamais répéter, confirmant que la
fenêtre d'anti-répétition s'élargit bien automatiquement avec le nombre de scènes (documentée à
l'Étape 57) ; aucune erreur console côté PULSAR.

`npx tsc --noEmit` : 0 erreur. `npx vitest run` : 794/794 verts (99/99 fichiers, +18 par rapport à
l'Étape 57). `npm run test:arch` : 1/1. `npm run build` : succès, 202 modules, `index-CLIiW5-q.js`
448,07 ko (gzip 125,24 ko) — chiffres identiques à ceux rapportés par l'autre session dans `NOTES.md`.
Limites connues : le bloom n'a pas pu être réglé finement faute de mesure de temps de trame exploitable
en onglet d'arrière-plan (outil `frametime()` livré pour qu'Aaron la fasse en fenêtre au premier plan) ;
la valeur finale de `userTrimMs` reste à déterminer par un filmage à 240 fps ; `laser-tunnel` reste la
plus sombre des six scènes (0,009 de luminance moyenne) et la cadence 6→8→12→16 de `mandala-32` change
toutes les deux secondes à 120 BPM — les deux peuvent paraître timides/rapides à l'usage, à juger sur
de la vraie musique ; l'esthétique des six overlays, le rythme des coupes et les textes de
`type-slam` restent des choix éditoriaux non mesurables.
Dette introduite : aucune connue.
Bloque la suite : rien côté implémentation — les 6 étapes du prompt externe sont livrées. Ne reste que
la validation humaine listée ci-dessus, à faire par Aaron à l'usage. Redéploiement Netlify fait
immédiatement après cette étape.

---

## Phase 2 — Chantier 1 : ouverture de phase et fondations

Périmètre : `docs/17_PHASE2_VISUELS.md` §11, chantier 1. Aucun visuel nouveau —
c'est le terrain qu'on dégage avant les chantiers 2 et 3.

### Ouverture du périmètre

Le MVP verrouillait explicitement ce que la phase 2 demande. `CLAUDE.md`
interdisait d'ajouter « ni style, ni preset, ni option », et
`docs/00b_MASTER_PROMPT_V2.md` §4 excluait nommément « styles 4 à 12 · presets
6 à 11 · mode Expert · texte/logo personnalisés ». Sans levée explicite, toute
session future se serait arrêtée au premier tour — à juste titre, la règle
disant elle-même de s'arrêter et de demander en cas de contradiction.

Acté dans les deux fichiers :

- `CLAUDE.md` : la section « Tu ne dépasses pas le MVP » devient « Tu ne dépasses
  pas le périmètre en cours », et distingue ce qui est ouvert (styles 4-12,
  presets 6-11, texte, composition de couches) de ce qui reste fermé (WebGL2,
  export 4K, rendu serveur, mobile, i18n, lyrics, notes/mélodie/accords).
- `docs/00b` §4 : encadré d'ouverture APRÈS la liste MVP, qui est conservée
  telle quelle — elle documente ce qui a été livré et sur quoi tout s'appuie.

`docs/17_PHASE2_VISUELS.md` déposé dans le dépôt (700 lignes). L'original vit
hors du projet, où `CLAUDE.md` interdit d'aller : c'est la copie qui fait foi.

### Le bloc `layers` des presets : RETIRÉ

Il était déclaré dans `Preset`, recopié par `resolvePreset` (`resolve.ts:118`),
et lu par personne — vérifié par recherche exhaustive sur `src/` et `tests/`,
y compris les accès dynamiques (`['layers']`, spread, `Object.keys`).

Retiré plutôt que branché, pour trois raisons :

1. **Ses clés ne désignent aucune couche réelle.** `trap-dark.json` écrivait
   `particles` / `field` / `postfx` ; les identifiants de couche sont
   `particleField` / `perspectiveGrid` / `frameFeedback` / `screenShake`. Le
   brancher aurait exigé d'inventer une correspondance qui n'a jamais existé —
   donc de deviner l'intention d'origine.
2. **Il entrait en collision avec `layerMacros.ts`**, qui écrit déjà
   `field.perspectiveGrid.rows` ; le bloc annonçait `rows: 24` pour le même
   paramètre. Deux mécanismes sur un chemin, dernier écrit gagne, en silence :
   exactement le piège documenté en tête de `layerMacros.ts`.
3. **Un seul preset sur cinq l'utilisait** (`trap-dark`).

Le besoin qu'il aurait servi — des valeurs ABSOLUES par preset, là où les macros
n'offrent qu'une courbe partagée par tous — est réel. C'est le compositeur de
couches (docs/17 §7.7, chantier 10) qui y répondra, avec des identifiants
vérifiés.

**Valeurs consignées avant retrait**, pour que l'intention ne soit pas perdue :

```json
"layers": {
  "particles": { "count": 2500, "lifetime": [1.2, 3.0], "gravity": -0.02 },
  "field": { "rows": 24, "perspective": 0.65 },
  "postfx": { "feedback": 0.90, "shake": 0.012, "chromatic": 0.004 }
}
```

`validatePreset` ignore les champs inconnus : un `.pvproj` ou un preset
utilisateur portant encore un bloc `layers` reste valide, simplement sans effet
— comme il l'était déjà.

### Catalogue de styles : source unique

Les trois options du `<select id="style-select">` étaient écrites en dur dans
`index.html` (lignes 253-257). Ajouter un style obligeait donc à modifier
`schema.ts` (`STYLE_IDS`), `App.ts` (`STYLE_FACTORIES`) **et** le HTML, sans
qu'aucun test ne signale l'oubli du troisième — ce qui allait devenir un piège
dès le chantier 5.

- `STYLE_LABELS: Readonly<Record<StyleId, string>>` ajouté dans `schema.ts`, à
  côté de `STYLE_IDS`. Le type `Record<StyleId, …>` fait échouer la compilation
  si un identifiant est ajouté sans libellé.
- `AdvancedPanel` peuple le `<select>` depuis `STYLE_IDS`.
- Deux tests de non-régression dans `presetCatalog.test.ts` : cohérence
  `STYLE_IDS` ↔ `STYLE_LABELS` dans les deux sens (le type ne couvre qu'un sens),
  et `index.html` ne contient plus aucune balise `<option>` dans ce `<select>`.

### Le curseur Profondeur en style `pulse`

`AdvancedPanel` portait bien un mécanisme d'avertissement — badge `⚠` et
infobulle — mais il testait `WIRED_MACROS = new Set(MACRO_NAMES)`, c'est-à-dire
un ensemble contenant TOUTES les macros. La condition était constamment vraie et
l'avertissement **inatteignable**. L'utilisateur voyait un curseur Profondeur
d'apparence normale qui ne faisait rien en style `pulse`.

Remplacé par `INERT_MACROS: Record<StyleId, readonly MacroName[]>`, évalué
**selon le style courant** — seule forme utile, une macro pouvant agir dans un
style et pas dans un autre. Le curseur reste manœuvrable à dessein : sa valeur
est enregistrée dans le preset et reprend son effet dès qu'un style qui
l'exploite est choisi. Le griser ferait croire qu'il est cassé.

Défaut trouvé et corrigé pendant l'écriture : la première version faisait
`label.childNodes[0].remove()` pour remplacer le libellé. Au premier appel, le
premier enfant du `<label>` est la ligne du curseur, pas un nœud texte — le
curseur lui-même aurait été supprimé. Corrigé par un nœud texte dédié, muté en
place.

### En-tête périmé de `SimplePanel`

Il annonçait encore Densité et Glow comme « sans effet visuel pour l'instant »,
en renvoyant à l'Étape 13/P11. Vrai à l'époque, faux depuis l'Étape 20 : les
huit macros agissent. Corrigé.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 99 fichiers, 796 tests (794 + 2 nouveaux)
npm run test:arch   -> 1 test
npm run build       -> 448,76 kB (gzip 125,35 kB), 202 modules, 1,73 s
```

Navigateur (`http://localhost:5174/`), **aucune erreur console** :

- `<select id="style-select">` peuplé : `pulse = Pulse`, `field = Field`,
  `spectrum-pro = Spectrum Pro`, valeur initiale `pulse`.
- Avertissement contextuel vérifié sur les trois styles :

| style | macros marquées inertes |
|---|---|
| `pulse` | `Profondeur ⚠` — infobulle « sans effet en style Pulse » |
| `field` | aucune |
| `spectrum-pro` | aucune |

### « Rien n'a changé à l'écran » — ce qui est prouvé, et comment

**Pas par comparaison de pixels.** L'analyse de la démo reste bloquée sur
« Analyse… » et le canvas reste noir (0 pixel non noir mesuré après 3 s) :
l'`AudioContext` ne démarre pas sans geste utilisateur réel, et le volet
d'aperçu n'étant pas affiché, aucune capture n'est possible. Même limite que
celle déjà notée dans `src/ui/live/NOTES.md`.

Ce qui est prouvé à la place, et qui vaut mieux qu'une empreinte sur une image
noire : **une seule modification touche le chemin de rendu**, le retrait de
`ResolvedPreset.layers`. Vérifié qu'aucun code ne le lit, ni statiquement
(`resolved.layers`, `preset.layers`), ni dynamiquement (`['layers']`, spread,
`Object.keys`/`Object.entries` sur un preset résolu), ni par sérialisation (le
preset résolu n'est pas persisté). Tout le reste — `LayerKind`, `STYLE_LABELS`,
les deux panneaux, le HTML — est soit purement typé et effacé à la compilation,
soit strictement hors canvas.

`exportDeterminism.test.ts` reste vert. Son en-tête précise qu'il couvre la
séquence de sous-pas et non les pixels ; c'est bien la simulation qui est
garantie identique, le rendu en étant une fonction pure.

### Limites connues

- Aucune vérification par capture d'écran ni par empreinte de pixels, pour la
  raison ci-dessus. Une vérification à l'œil par Aaron, fenêtre au premier plan,
  reste souhaitable avant le chantier 2.
- `LayerKind` accepte `'text'` mais aucune couche ne la porte : c'est voulu, la
  couche de texte est le chantier 8. La valeur est ajoutée maintenant pour ne
  pas rouvrir ce fichier au milieu d'un chantier sans rapport.
- Le bloc `layers` retiré rend `trap-dark.json` légèrement plus court que les
  autres presets ne le laissaient supposer ; aucune conséquence fonctionnelle.

---

## Phase 2 — Chantier 2 : réactivité complète, LFO, easings

Périmètre : `docs/17_PHASE2_VISUELS.md` §11, chantier 2 (§6.1, §7.1, §6.3).
Objectif chiffré : atteindre le critère 11 — « changer le `mapping` d'un preset
change visiblement l'image » — **avant** d'écrire le moindre style nouveau.

### Correction du diagnostic : sept signaux morts, pas six

`docs/17` §5.1 annonçait six signaux calculés puis jetés. Il y en avait **sept**.
Le relevé initial comptait `pulse` comme consommé par `PerspectiveGrid`, alors
que la seule occurrence de `signals.pulse` dans tout `src/visual/` était… une
docstring expliquant qu'elle ne l'utilisait PAS :

> « utilise `step.beat.index + step.beat.phase` directement, PAS `signals.pulse` »

Une recherche textuelle ne distingue pas un usage d'un commentaire. Le test
`signalCoverage.test.ts` retire donc les commentaires avant de chercher.

Et la raison de cet abandon était légitime : `pulse` est une SINUSOÏDE, qui
oscillerait avant/arrière et romprait le « jamais un saut » du défilement.
Le signal n'était pas oublié, il était de la mauvaise forme pour son seul
client possible. Il trouve ici son emploi juste — la sinusoïde pilote l'ALPHA
des lignes de la grille, où osciller est exactement ce qu'on veut, pendant que
la position brute continue de piloter le défilement.

### Couverture avant / après

| signal | source | avant | après |
|---|---|---|---|
| `impact` | KICK | PulseRings, ScreenShake | + SpectrumBars, FrameFeedback |
| `weight` | bande sub | PulseRings, ParticleField | inchangé |
| `brightness` | centroïde | RadialBackground, CentralGlow | inchangé |
| `drive` | énergie | CentralGlow | inchangé |
| `accent` | SNARE, CLAP | **aucune** | CircularWaveform, FlatWaveform, PerspectiveGrid |
| `tick` | HAT, PERC | **aucune** | CircularWaveform, ParticleField, SpectrumBars |
| `subImpact` | SUB_HIT | **aucune** | RadialBackground, DeepVignette, AnimatedDuotone |
| `sectionShift` | SECTION | **aucune** | RadialBackground, DeepVignette, AnimatedDuotone |
| `tension` | anticipation DROP | **aucune** | CentralGlow, FrameFeedback, SpectrumBars |
| `barPulse` | phase de mesure | **aucune** | CircularWaveform, FlatWaveform |
| `pulse` | phase de temps | **aucune** | PerspectiveGrid |
| `lfoA`..`lfoD` | grille | *n'existaient pas* | AnimatedDuotone, ParticleField, CentralGlow, SpectrumBars |

Les quinze signaux ont désormais au moins un consommateur, et chacun des trois
styles en lit au moins quatre. `spectrum-pro` était le pire cas : ses trois
couches ne lisaient RIEN, donc modifier le `mapping` de `lofi.json` ne pouvait
littéralement rien changer.

Règle tenue partout : **un instrument, un canal**. Chaque signal pilote un
paramètre qu'aucun autre ne touche — `tension` prend le DIAMÈTRE du halo parce
que `drive` tient déjà son intensité ; `impact` prend l'ÉCHELLE du feedback
parce que `tension` en tient l'alpha.

### LFO verrouillés au tempo

Quatrième famille de la table de câblage, sur la même convention que les trois
autres : la famille se déduit du préfixe de `from`, sans champ `kind`.

```json
"lfoA": { "from": "lfo:sine", "bars": 4 },
"lfoD": { "from": "lfo:random", "bars": 0.5 }
```

Cinq formes (`sine`, `triangle`, `saw`, `square`, `random`), période en MESURES
et non en secondes : à 90 comme à 140 BPM, « 2 mesures » boucle en deux mesures.

Deux choix qui méritent d'être écrits :

- **Aucune primitive à instancier.** La valeur est une fonction pure de
  `bar.index + bar.phase`. Zéro état, zéro allocation, déterminisme par
  construction (Loi 1). `setMapping` n'a donc rien à reporter pour les LFO,
  contrairement aux impulsions et aux continus.
- **`random` est échantillonné-bloqué par HACHAGE de l'index de période**, pas
  par `step.rng`. Consommer un tirage déplacerait tous les tirages suivants, et
  la Loi 1 interdit qu'un résultat dépende du nombre de tirages déjà consommés.
  La graine est une constante, volontairement indépendante de `projectSeed` :
  sinon le futur bouton « relancer » (§7.9) déplacerait aussi les LFO, ce qu'il
  n'annonce pas.

Périodes par défaut premières entre elles (4, 2, 1, 0,5 avec décalages) : des
périodes multiples se réaligneraient et les quatre mouvements se liraient comme
un seul. Un test le vérifie.

### Ce que `Impulse` n'avait PAS besoin qu'on lui fasse

`docs/17` §6.3 signalait qu'une décroissance exponentielle « ne revient jamais
au repos », piège corrigé côté live à l'étape 6. Vérification faite, **le
diagnostic ne s'applique pas ici** et `Impulse` n'a pas été touchée.

Raison : côté live, `decayBeats` était une constante de temps τ, et la durée
visible valait environ 3 τ — un kick réglé « 0,35 temps » restait allumé
1,05 temps. Côté fichier, `Impulse.decay` est une **demi-vie en secondes**, et
les valeurs choisies par les auteurs en tiennent compte : `impact` à 0,10 s
passe sous 5 % en 0,43 s, soit 0,5 temps à 70 BPM — dans la bande 0,3-0,6 de
§2.7.8. Remplacer l'exponentielle aurait changé le caractère de tous les presets
pour corriger un défaut qui n'existait pas.

**Point ouvert, à traiter au chantier 9** : `decay` est en SECONDES, donc la
durée des réactions ne suit pas le tempo. Un preset réglé à 70 BPM ne se comporte
pas pareil à 140. Le corriger touche le format de preset, hors périmètre ici.

### Module de courbes partagé

`src/core/math/easing.ts` : `easeOutCubic`, `easeOutQuint`, `easeInQuad`,
`easeInOutSine`, `overshootLobe`, `impact`. Dans `core/` et non dans `visual/`
parce que `behaviour/` en a besoin aussi, et que la règle de dépendance leur
interdit de s'importer l'un l'autre.

Consommateur immédiat : `Anticipation` redéfinissait `easeInQuad` sur place ;
elle utilise désormais la version partagée.

**Limite assumée** : les cinq autres fonctions n'ont pas encore de client. Ce
sont les fondations des chantiers 3 (caméra), 5-6 (styles) et 8 (texte). Livrer
du code sans consommateur est précisément le défaut que ce chantier corrige —
il est donc au minimum entièrement TESTÉ (`easing.test.ts`, 9 tests), pour que
personne n'ait à découvrir plus tard s'il fonctionne.

### Trois défauts trouvés en écrivant les tests

1. **`field` ne lisait `impact` NULLE PART.** Le style du trap et du drill —
   celui dont le kick est l'élément central. Ses particules ne réagissent qu'à
   `step.fired`, en contournant la table de câblage : régler `impact.decay` dans
   un preset n'y changeait rien. Corrigé, le kick pilote désormais l'échelle du
   feedback.

2. **Le charley n'était pas visible dans `spectrum-pro`.** Il poussait les
   chapeaux de pics vers le haut, mais quand les barres montent le chapeau est
   ré-épinglé à leur hauteur à chaque pas et la poussée disparaît. Mesuré, pas
   supposé : couper le charley ne changeait pas l'image. Un second canal a été
   ajouté — la taille du halo.

3. **Une faute de priorité d'opérateurs** dans ce même correctif :
   `0.12 + h * 0.18 * scale` ne met à l'échelle que le second terme, donc une
   barre au repos ne réagissait pas du tout. Parenthèses ajoutées.

### Deux angles morts de mes propres tests

À signaler, parce que les deux m'ont fait conclure à tort à un défaut du code :

- L'empreinte de rendu ignorait la POSITION des sprites (`x`/`y`). Or c'est
  exactement là qu'agissent le charley sur les particules et les LFO sur le
  halo. Le test annonçait « `field` ne réagit pas au charley » alors qu'il
  réagissait.
- `FakeRenderer.drawFeedback` est volontairement inerte tant qu'aucune
  `captureFeedback` n'a eu lieu — fidèle à `Canvas2DRenderer`. Créer un
  renderer neuf par image ne capturait donc JAMAIS le feedback. L'empreinte
  utilise maintenant un seul renderer pour toute la séquence, ce qui est aussi
  plus fidèle puisque le feedback s'accumule.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 103 fichiers, 826 tests (796 -> 826, +30)
npm run test:arch   -> 1 test
npm run build       -> 451,63 kB (gzip 126,35 kB), 1,55 s
```

Navigateur (`http://localhost:5174/`), après rechargement : **aucune erreur
console**, catalogue de styles toujours peuplé, canvas dimensionné.

**Critère 11 atteint et verrouillé par test** (`mappingChangesImage.test.ts`,
5 tests) : les trois styles réels sont montés, pilotés sur une séquence
d'événements identique avec deux tables de câblage, et leurs appels de rendu
comparés. Sont vérifiés — couper la caisse claire, couper le charley, changer
la décroissance du kick, changer les quatre LFO. Plus un contrôle de
déterminisme : deux exécutions du même mapping donnent une empreinte
rigoureusement identique, sans quoi les quatre autres tests ne prouveraient
rien.

Deux tests de non-régression structurels (`signalCoverage.test.ts`) : aucun
signal ne peut redevenir orphelin, et aucun style ne peut retomber sous quatre
signaux lus.

### À valider par Aaron, à l'œil

Le chantier est validé par les tests sur le plan « le signal atteint l'image ».
Ce que les tests ne disent pas, c'est si le résultat est BEAU :

- **Le dosage de chaque nouveau canal.** Toutes les amplitudes sont des
  premières estimations, choisies pour être visibles sans écraser l'accent
  principal. Les constantes sont nommées en tête de chaque couche
  (`ACCENT_DEFORM`, `TICK_SPEED_GAIN`, `SUB_BREATH`, `TENSION_SWELL`…).
- **Le charley** est le canal le plus susceptible d'être trop présent : il
  frappe à la croche, donc huit fois par mesure.
- **La dérive du halo central** (`LFO_DRIFT = 0.045`) doit être perceptible sans
  qu'on voie le halo « bouger ». Si on la remarque, elle est trop grande.
- **`tension`** ne se juge que sur un morceau ayant un vrai drop détecté ; sur
  un morceau sans DROP, ce canal reste à zéro et c'est normal.
- **Comparer deux presets du même style** — `trap-dark` contre `drill`, `house`
  contre `rnb` — pour juger si la différence est maintenant suffisante. Elle
  reste limitée à la réaction et aux couleurs : la GÉOMÉTRIE ne changera qu'aux
  chantiers 5 et 6.

### Limites connues

- Cinq des six fonctions de `easing.ts` n'ont pas encore de consommateur
  (voir plus haut).
- `Impulse.decay` reste en secondes, donc indépendant du tempo (chantier 9).
- Les LFO ne sont configurables qu'en éditant le JSON du preset ; l'interface
  d'assignation est le chantier 10.
- `ParticleField` continue de faire naître ses particules sur `step.fired`
  (KICK/HAT/SNARE en dur). Seuls sa vitesse et son balancement passent par la
  table de câblage. Router les naissances par le mapping demanderait un
  quatrième type d'entrée et n'était pas dans ce chantier.

---

## Phase 2 — Chantier 3 : dramaturgie et caméra

Périmètre : `docs/17_PHASE2_VISUELS.md` §11, chantier 3 (§6.2, §6.4).
Livrable : montrer que l'intro, la montée, le drop et le breakdown produisent
des images distinctes.

### Le défaut corrigé

`step.section` existe depuis toujours dans le `StepContext` — énergie, lettre de
répétition A/B/C, label, confiance — et **aucune couche ne le lisait**.
`step.regime` non plus. Un morceau de trois minutes se rendait donc sans la
moindre variation structurelle. Aucune quantité de nouveaux styles n'aurait
corrigé ça : c'est un problème de durée, pas de géométrie.

### Loi 1 : un director SANS ÉTAT

`IntensityDirector`, son équivalent du mode live, accumule — il compte les
mesures depuis le drop, mémorise le niveau d'avant, suit une moyenne glissante
de luminance. **Rien de tout ça n'est permis ici** : le rendu doit être une
fonction pure de `t`, sinon l'export cesse de reproduire l'aperçu.

`VisualDirector` n'a donc aucun état de dramaturgie. Chaque valeur est
recalculée depuis `t` par consultation de la timeline, qui sait regarder en
arrière (`prevEventOfType`) comme en avant (`nextEventOfType`). Le niveau
d'avant le drop, par exemple, n'est pas mémorisé : il est **relu** à
`sectionAt(dropT - ε)`.

Le test le vérifie de trois façons : lecture continue depuis zéro, saut direct,
et série de sauts arrière désordonnés donnent tous exactement le même budget à
t = 26,4 s.

**Tout est compté en MESURES, jamais en secondes.** « Deux mesures avant le
drop » veut dire la même chose à 90 et à 140 BPM. Les positions viennent de
`barIndexAt + barPhaseAt`, ce qui évite en prime d'avoir à connaître la
métrique — l'API de la timeline ne l'expose pas.

### Relevé sur un morceau structuré de 64 s

Intro (0,15 d'énergie) · couplet (0,7) · refrain avec drop à 24 s (1,0) ·
breakdown (0,1) · refrain repris, même lettre.

| moment | arc | amplitude | niveau | caméra |
|---|---|---|---|---|
| intro (3 s) | `intro` | 0,700 | 0,420 | +0,051 +0,033 |
| couplet (14 s) | `sustain` | 1,000 | 0,865 | +0,030 +0,013 |
| montée, −2 mesures | `build` | 0,999 | 0,865 | −0,008 +0,032 |
| montée, −0,5 mesure | `build` | **0,516** | 0,865 | +0,013 +0,032 |
| montée, juste avant | `build` | **0,451** | 0,865 | +0,016 +0,031 |
| DROP +0,5 mesure | `drop` | 1,000 | **1,000** | +0,010 +0,037 |
| retombée +1,5 mesure | `fallout` | 0,700 | **0,779** | +0,010 +0,032 |
| refrain (33 s) | `sustain` | 1,000 | 1,000 | −0,016 +0,022 |
| vide avant section | `void` | 0,350 | 0,300 | +0,011 +0,037 |
| breakdown (44 s) | `breakdown` | 0,500 | **0,180** | −0,041 +0,042 |

La retenue avant impact est visible : l'amplitude tombe de 1,000 à 0,451 sur les
deux dernières mesures. Contre-intuitif et c'est le point — si tout monte en
même temps que le drop, le drop n'a plus de contraste à franchir.

### Une intro n'est pas un breakdown

Trouvé par un test qui échouait : l'intro du morceau, à 0,15 d'énergie, tombait
sous le seuil de breakdown et était rendue en quasi-noir. Or les deux moments
ont souvent la **même énergie** et ne racontent pas du tout la même chose :
l'une prépare, l'autre effondre. Un morceau aurait démarré sur un écran presque
éteint.

Ce qui les distingue n'est pas l'énergie mais la **position** : la première
section d'un morceau est une intro, quelle que soit son énergie. Niveau 0,42
contre 0,18.

### Un défaut trouvé en relevant les chiffres, pas en lisant le code

La retombée d'après drop utilisait `easeOutCubic`. Une courbe ease-**out**
remonte vite au début : mesuré, le niveau était revenu à **0,992 dès 2,5 mesures
après le drop**, alors qu'il valait 0,865 avant. La règle « rester sous le
niveau d'avant pendant deux mesures » n'était donc tenue que sur la première
moitié de la fenêtre.

Corrigé en deux temps : `easeInQuad`, qui tient bas puis remonte à la fin ; et
un plafond dur à `beforeLevel * 0.98` sur toute la fenêtre, pour qu'un futur
réglage de courbe ne puisse pas recasser la règle en silence. Un test balaie
maintenant la fenêtre par pas de 0,05 mesure.

Ce défaut n'était visible ni au typecheck, ni aux tests que j'avais écrits, ni à
la lecture — seulement en imprimant les valeurs réelles.

### Caméra : translation seulement, et pourquoi

§6.4 demande trois choses. Deux sont livrées :

- **Recadrage franc sur frontière de section.** Le décalage est une fonction de
  l'instant de début de section et de sa lettre, donc constant à l'intérieur
  d'une section — il ne PEUT pas changer au milieu d'une mesure. Deux sections
  de lettres différentes ne sont pas cadrées pareil, si bien qu'un refrain
  revenu ne se lit pas comme une copie du précédent.
- **Dérive lente**, d'autant plus ample que le passage est calme.

La troisième — « poussée lente pendant une montée » — **n'est pas réalisable en
l'état**. `Renderer.applyShake(dx, dy)` fait `ctx.translate` et rien d'autre :
l'interface n'expose aucun zoom, et `docs/17` §4 n'autorise que deux extensions,
les modes de fusion et `drawImage`. Une caméra à zoom en serait une troisième.

Ce qui est livré à la place, et qui n'est pas un pis-aller : la dérive se
**resserre** à l'approche du drop, jusqu'à l'immobilité. À défaut de pouvoir
pousser, c'est le figement du cadre qui porte la tension. Un test le vérifie.

**Décision pour Aaron** : ajouter `Renderer.setCamera(x, y, zoom)` demanderait
un ADR dans `docs/15_ADR.md`. Le mécanisme est le même que `applyShake` — un
`ctx.scale` dans le `save/restore` déjà en place — donc peu risqué, et la Loi 1
serait respectée puisque tout dériverait de `t`. À trancher avant le chantier 5,
parce que `monolith` et `iso-pulse` en tireraient tous deux parti.

### Un seul point d'application pour l'aperçu et pour l'export

`ui/App.ts` et `export/ExportPipeline.ts` ont deux boucles d'images
indépendantes. À l'Étape 25, les macros de couche avaient été branchées dans la
première et oubliées dans la seconde — pendant plusieurs étapes, l'export ne
produisait pas la même image que l'aperçu, et personne ne l'a vu.

La dramaturgie présente le même risque, en pire : un morceau exporté sans elle
serait plat de bout en bout, ce qui ne saute pas aux yeux sur une vignette.
D'où `visual/scene/dramaFrame.ts`, deux fonctions appelées des deux côtés :

- `stepSceneWithDrama(scene, behaviour, director, step)` remplace le trio
  « calculer les signaux / les doser / avancer la scène ».
- `openFrameWithCamera(renderer, viewport, couleur, director)` remplace
  `beginFrame` + `clear` + la pose de la caméra.

La caméra est posée **après** `clear` et **avant** le dessin : `applyShake` est
un décalage global qui n'affecte que ce qui vient ensuite ; le poser avant le
`clear` décalerait le fond et laisserait une bande non peinte au bord.

Un test lit les deux fichiers et vérifie qu'ils appellent bien les deux
fonctions, et qu'aucun n'appelle plus `scene.update()` directement — un appel
direct signifierait que cette boucle contourne le director.

### Aucune couche modifiée

Le budget dose les SIGNAUX, pas les couches. Une couche réagit déjà aux
signaux ; le director ne fait que les atténuer avant qu'elle ne les voie. C'est
ce qui permet d'ajouter toute cette dramaturgie sans toucher une seule des
treize couches.

Ce qui n'est délibérément **pas** dosé :

- `pulse`, `barPulse`, `lfoA`..`lfoD` sont des **horloges**. Les atténuer ferait
  ralentir le mouvement au lieu de le calmer, ce qui se lit comme une erreur de
  tempo.
- `tension` **est** la montée. La réduire pendant la retenue effacerait le signal
  qui décrit exactement ce moment.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 105 fichiers, 847 tests (826 -> 847, +21)
npm run test:arch   -> 1 test
npm run build       -> 454,05 kB (gzip 127,39 kB), 1,49 s
```

Navigateur (`http://localhost:5174/`), après rechargement : **aucune erreur
console**.

**Critère 12 atteint et verrouillé** (`dramaChangesImage.test.ts`) : les trois
styles réels sont montés et simulés depuis le début du morceau jusqu'à chacun
des cinq moments — intro, montée, drop, refrain, breakdown — et les cinq images
sont deux à deux différentes, pour chaque style. Plus un contrôle de
déterminisme.

### À valider par Aaron, à l'œil

- **Le dosage de la retenue** : l'amplitude tombe à 0,45 juste avant le drop.
  Si l'image paraît s'éteindre au lieu de se contenir, remonter
  `RESTRAINT_FLOOR`.
- **Le breakdown à 0,18** est volontairement très sombre. À juger sur un vrai
  morceau : si c'est trop, `BREAKDOWN_LEVEL`.
- **Le vide d'une demi-mesure** avant chaque frontière de section : il doit se
  lire comme une respiration, pas comme un bug d'affichage.
- **La dérive de caméra** doit être imperceptible en tant que mouvement. Si on
  voit l'image glisser, `DRIFT_CALM` est trop grand.
- **Le recadrage entre sections** (0,05) : assez pour que deux refrains ne se
  ressemblent pas, pas assez pour qu'on voie un saut.
- **La décision sur le zoom de caméra** (voir plus haut).

### Limites connues

- **Pas de poussée de caméra**, faute de zoom dans le `Renderer`.
- Le breakdown est détecté par un **seuil d'énergie** (0,25) et non par le
  `label` de section, qui n'existe qu'en Mode B (PULSAR). Un morceau dont
  l'analyse donne une énergie mal calibrée sera mal classé.
- La règle du **plancher de vide** de §6.2 est implémentée par position — la
  demi-mesure avant une frontière de section — et non par mesure de luminance
  comme en mode live. Mesurer la luminance exigerait de lire l'image rendue, ce
  que la Loi 1 et l'interdiction de `getImageData` par image excluent toutes
  deux. C'est un écart assumé : le vide est garanti et musicalement placé, mais
  il ne s'adapte pas à ce que la scène affiche réellement.
- Aucune vérification par capture d'écran : le volet d'aperçu n'est pas affiché
  et l'`AudioContext` ne démarre pas sans geste utilisateur réel. Les cinq
  moments sont prouvés par empreinte d'appels de rendu, pas par pixels.

---

## Phase 2 — Chantier 4 : caméra, modes de fusion, variantes, zones sûres, graine

Périmètre : `docs/17_PHASE2_VISUELS.md` §11, chantier 4 (§7.2, §7.4, §7.9,
§7.10), plus la caméra restée en suspens au chantier 3.

### Décision d'Aaron : le zoom de caméra est autorisé

Le chantier 3 avait livré la caméra en translation seule, faute de zoom dans
l'interface `Renderer`, et laissé la question ouverte. Aaron a tranché :
**ADR-011** ajoute `applyCamera(dx, dy, zoom)`.

Trois conséquences documentées dans l'ADR, dont une non évidente :

- **Le zoom est borné à [1, 2].** La borne BASSE est la vraie contrainte : sous
  1, le cadrage s'élargit et découvre les bords, or les fonds plein écran ont un
  rayon de 1,0 à 1,1 et cesseraient de couvrir le cadre. Conséquence pratique
  inversée par rapport à l'usage courant : « plan large » est la valeur par
  défaut, « plan rapproché » un zoom supérieur.
- **`drawFeedback` est rendu INSENSIBLE à la caméra.** La capture contient
  l'image telle qu'affichée, donc déjà zoomée ; la redessiner sous le même zoom
  la grossit encore, et le facteur croît géométriquement. Un zoom tenu à 1,15
  pendant deux secondes dépasserait **10 000**. La traînée reste donc en espace
  écran — ce qui a en prime un intérêt visuel, elle se déforme quand la caméra
  bouge au lieu de la suivre rigidement.
- `applyShake` est conservée telle quelle : elle a une sémantique de secousse
  par couche, documentée et testée. Les deux transformations se composent.

La poussée avant le drop, impossible au chantier 3, est maintenant livrée :
zoom montant jusqu'à +12 % sur les deux dernières mesures, **relâché d'un coup
au drop**. C'est le relâchement qui produit la sensation d'ouverture — le
maintenir pendant l'explosion garderait le cadre serré au moment précis où il
doit s'ouvrir.

### Modes de fusion par couche (§7.2)

`drawSprite` imposait `'lighter'` en dur et aucune couche ne pouvait choisir.
Six modes exposés : `normal`, `additive`, `screen`, `multiply`, `overlay`,
`difference`.

Trois points de conception :

- **`Layer.blend` est OPTIONNEL, et son absence ne change rien.** `Scene.draw`
  n'émet aucun appel quand aucune couche n'en déclare : le chemin par défaut est
  rigoureusement celui d'avant.
- **Posé avant la couche, retiré après, systématiquement.** Sans la remise à
  `null`, une couche en `multiply` imposerait son mode à toutes les suivantes,
  et le symptôme — « le style est trop sombre » — ne pointerait pas vers elle.
- **`'lighter'` reste le défaut des sprites.** Un sprite est additif par nature,
  c'est ce qui remplace `shadowBlur` ; une couche qui déclare un mode l'emporte.

### Variantes de cadrage (§7.10), et pourquoi elles ne touchent aucune couche

Deux à trois variantes par style, soit huit au total. Une variante ne modifie
**aucune couche**, pour deux raisons :

1. `applyLayerMacrosToScene` **remplace** `layer.params` en entier à chaque
   résolution de preset. Tout réglage passant par `params` serait écrasé au
   prochain glissement de macro, en silence.
2. Une variante est un point de vue, pas une géométrie. Caméra et mode de fusion
   suffisent, et s'appliquent uniformément à tous les styles — y compris ceux
   des chantiers 5 et 6, qui n'existent pas encore.

Règle de composition de §8 tenue et vérifiée par test : **au plus une variante
sur trois est centrée**, et chaque style expose au moins une variante décentrée
d'au moins 0,1 en unités normalisées.

Un test vérifie aussi que **les modes de fusion ne visent que des couches
existantes** : une faute de frappe dans un identifiant de couche ne produit
aucune erreur, le mode est simplement ignoré en silence.

### L'`architecture.test` a refusé ma première version, et il avait raison

`variants.ts` avait été écrit dans `src/visual/styles/`. Le test a rejeté
l'import de `presets/schema` : `visual/` n'a pas le droit d'importer `presets/`.

Sur le fond, le test avait raison — `visual/` dessine, il n'a pas à savoir
quels styles le catalogue expose. Le fichier a été déplacé en
`src/presets/styleVariants.ts`, à côté de `layerMacros.ts` qui fait exactement
le même travail de traduction « réglage de preset → configuration de rendu ».

La contrainte a produit une meilleure signature : `dramaFrame` ne prend plus une
`StyleVariant` mais un type STRUCTUREL `Framing { offsetX, offsetY, zoom }`, et
`applyLayerBlends` prend une simple table `Record<layerId, BlendMode>`. Ce
module n'a jamais eu besoin de savoir d'où venaient ces valeurs.

`BlendMode` est ré-exporté par `visual/scene/Layer` : `presets/` en a besoin et
la règle de dépendance lui interdit `render/`. Le mode de fusion d'une COUCHE
est légitimement une notion de couche.

### Graine (§7.9) — correction d'une affirmation fausse du prompt

`docs/17` §7.9 affirme que `projectSeed` « n'est simplement pas exposé ».
**C'est faux** : le bouton « Nouvelle variante » existe depuis l'Étape 13
(`App.ts`, section « docs/13 : régénère la graine, effet fort, coût nul ») et
relance déjà la graine.

Ce qui manquait réellement, et qui est livré ici :

- **L'affichage et la saisie** de la graine. Sans elle, un rendu qu'on aime est
  perdu dès qu'on reclique. La graine était déjà persistée dans le `.pvproj` ;
  il ne manquait que de pouvoir la lire et la ressaisir.
- **Le lien graine → variante.** Sans lui, « Nouvelle variante » ne changeait
  que les tirages internes des couches et laissait le cadrage identique —
  c'est-à-dire l'essentiel de ce que l'utilisateur regarde.

Détail d'interface corrigé après vérification au navigateur : une saisie non
appliquée — invalide, ou valide mais sans morceau chargé — est désormais
annulée à l'affichage. Laisser le champ montrer une graine qui n'est pas celle
du rendu ferait mentir précisément le champ dont on attend qu'il dise la vérité.

### Zones sûres (§7.4)

`Viewport.safe` était **déclaré et jamais lu** : `createViewport` recevait
toujours son défaut `{0,0,0,0}`, alors que `export/formats.ts` propose
Shorts/TikTok/Reels en 1080×1920 et que ces plateformes recouvrent le bas et la
droite du cadre de leur propre interface.

`render/safeArea.ts` expose `safeAreaFor(width, height)` — critère sur
l'ORIENTATION et non sur l'identifiant de format, pour qu'un format vertical
ajouté plus tard hérite des marges sans qu'on y touche — et `safeRect(aspect,
safe)`, qui convertit en rectangle. La conversion est fournie plutôt que laissée
aux appelants : elle dépend de `aspect` dans les deux axes, et la refaire à
trois endroits garantit qu'un des trois se trompera de signe sur `y`.

Câblé dans `createOffscreenExportTarget`. Un test lit le fichier pour le
vérifier, `OffscreenCanvas` étant indisponible sous Node.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 106 fichiers, 863 tests (847 -> 863, +16)
npm run test:arch   -> 1 test
npm run build       -> 456,23 kB (gzip 128,11 kB), 1,52 s
```

Navigateur, **onglet neuf, aucune erreur console**. Les erreurs relevées lors
d'un premier contrôle portaient des horodatages HMR intermédiaires — états
transitoires pendant les éditions, pas l'état livré ; vérifié en rouvrant un
onglet propre.

Contrôle fonctionnel du champ de graine :

| action | résultat |
|---|---|
| affichage initial | `4049523024` |
| saisie `12345` | acceptée |
| saisie `pas-un-nombre` | rejetée, retour à `4049523024` |

### À valider par Aaron, à l'œil

- **La poussée de caméra à +12 %** avant le drop. Elle doit se sentir sans se
  voir ; si on remarque le cadre bouger, baisser `PUSH_MAX`.
- **Les huit variantes.** Ce sont des premières estimations de cadrage. Relancer
  la graine plusieurs fois sur le même morceau est le meilleur test.
- **Le `screen` sur les formes d'onde** (variantes « rapproché haut » de `pulse`
  et « barres basses » de `spectrum-pro`). C'est le seul endroit où un mode de
  fusion est utilisé aujourd'hui ; à juger, et à étendre ou retirer.
- **Les marges de zone sûre** (bas 0,34 · droite 0,20 · haut 0,12 du petit côté)
  ne sont pas publiées par les plateformes et changent avec leurs versions.
  Volontairement un peu larges.

### Limites connues

- **Le critère 13 de §12 n'est PAS vérifié.** Il demande que le `FlashLimiter`
  ne se déclenche pas en permanence sur les modes de fusion ajoutés. Le
  `FlashLimiter` mesure des pixels réels ; le vérifier exige un canvas et une
  fenêtre au premier plan, indisponibles ici. `difference` et `overlay` ne sont
  utilisés par aucune variante livrée, ce qui limite le risque — mais la mesure
  reste à faire avant de les proposer dans le compositeur du chantier 10.
- **Aucun guide de zone sûre dans l'aperçu.** Il exigerait que l'aperçu se
  recadre au format d'export choisi, ce qui n'existe pas : `App.ts` crée son
  viewport une fois pour toutes à 16/9 (`const viewport = createViewport(16/9)`,
  jamais recalculé, y compris au redimensionnement). C'est un manque
  préexistant, distinct de ce chantier, à traiter avec l'interface du
  chantier 10.
- **Aucune couche ne respecte encore la zone sûre.** Rien de ce qui est dessiné
  aujourd'hui ne porte d'information — pas de texte, pas de pochette. La
  contrainte prendra son sens au chantier 8, et c'est là qu'elle sera appliquée.
- Les variantes ne sont pas choisissables : elles dérivent de la graine. Le choix
  explicite viendra avec le compositeur (§7.7, chantier 10).

---

## Phase 2 — Chantier 5 : `monolith` et `iso-pulse`

Périmètre : `docs/17_PHASE2_VISUELS.md` §11, chantier 5 (§8). Les styles 4 et 5
des « styles 4 à 12 » que `docs/00b` §4 réservait à l'après-MVP.

### `monolith` — trap, drill, phonk

« La masse et le silence. » Une masse géométrique sombre en fausse perspective,
décentrée, occupant les deux tiers du cadre. Sur le kick, une **fissure** s'ouvre
et se referme — c'est l'accent principal, et la seule chose lumineuse d'un cadre
par ailleurs sombre, donc identifiable sur une capture figée (§8).

kick → largeur de la fissure · sub → travelling latéral · caisse claire →
bascule de l'éclairage d'une face à l'autre · charley → étincelles d'arête
(plafonnées à 40 %) · anticipation → lueur qui monte dans la faille avant
qu'elle ne s'ouvre · LFO → frémissement de facette.

**DEUX COUCHES seulement**, et c'est le point : le trap a d'énormes vides entre
les frappes, et tout ce qu'on ajouterait pour meubler détruirait le contraste
dont la fissure tire son impact. Pas de `FrameFeedback` non plus — une traînée
adoucirait les arêtes, or c'est leur netteté qui donne son poids à la masse.
C'est le seul style du catalogue dont le parti pris est de ne PAS traîner.

Deux contraintes de l'API ont façonné la conception :

- `fillPath` ne prend qu'une couleur PLATE. Le volume vient donc du découpage en
  sept facettes de valeurs différentes, pas d'un ombrage.
- La lueur intérieure de la faille est un **sprite radial pré-rendu**, posé sept
  fois le long de la fissure. C'est la seule façon d'obtenir un bord doux avec
  cette interface.

La fissure n'ouvre pas la géométrie : elle est dessinée par-dessus, en polygone
à deux lèvres. Image identique à un découpage booléen, pour une fraction du coût.

### `iso-pulse` — house, techno, garage

« La régularité EST le plaisir. » Grille isométrique dont chaque kick lance une
onde de soulèvement qui se propage en **losange** — distance de Manhattan, pas
euclidienne : un cercle se lirait mal sur une grille. Plusieurs ondes coexistent
et s'additionnent, ce qui produit des interférences sur un motif pourtant
parfaitement régulier.

kick → hauteur des ondes · caisse claire → damier de valeurs · charley →
scintillement des crêtes · sub → inclinaison de la grille · anticipation →
resserrement de la maille · LFO → dérive de la trame.

Toute la propagation est comptée en **temps musicaux**, jamais en secondes : à
128 comme à 170 BPM, une onde traverse la grille en deux temps.

### Écart assumé n°11 — les « 8 tranches de hauteur » sont irréalisables

`docs/17` §8 prévoyait pour `iso-pulse` : « Regroupe par tranche de hauteur —
**8 tranches, donc 8 `fillPath`**, pas un par tuile. »

C'est impossible. `fillPath(xs, ys, count, color)` dessine **un seul polygone**,
pas une collection de sous-chemins ; regrouper cent tuiles en huit appels
demanderait un `beginPath` partagé que l'interface n'expose pas. La phrase du
prompt supposait une API qui n'existe pas.

Conception retenue : la grille est un **maillage** — une polyligne par rangée et
par colonne, dont les sommets se soulèvent. Coût `2·(N+1)` appels de
`strokePath` au lieu de `N²` de `fillPath` : **26 au lieu de 144** pour une
grille de 12. Seules les tuiles de crête sont remplies, et leur nombre est
plafonné. Le rendu est bien celui décrit — une grille isométrique qui ondule.

### Déterminisme : hachage plutôt que `step.rng`

Les deux styles tirent leurs formes d'un **hachage de l'index de temps**, jamais
de `step.rng`. Deux raisons :

1. `step.rng` est PARTAGÉ par toutes les couches d'une scène. Y puiser décale
   tous les tirages des couches suivantes — un couplage invisible entre couches
   qui n'ont rien à voir.
2. Un hachage se recalcule à l'identique après un seek, sans rejouer quoi que ce
   soit.

### Ce que le typage a attrapé tout seul

Ajouter deux entrées à `STYLE_IDS` a fait échouer la COMPILATION sur
`INERT_MACROS` (`AdvancedPanel`), qui est typé `Record<StyleId, …>` depuis le
chantier 1. Impossible d'ajouter un style sans déclarer quelles macros y sont
inertes — exactement l'effet recherché.

Le même mécanisme manquait à deux tests : leurs tables de styles étaient typées
`Record<string, …>`, si bien que `monolith` et `iso-pulse` y auraient été
ignorés en silence. Les deux sont passés en `Record<StyleId, …>`.

Quatre macros sur six sont câblées pour chaque nouveau style. Les deux autres
sont déclarées inertes plutôt que câblées de force : `monolith` n'a ni densité
(une seule masse) ni lissage (rien ne se lisse, c'est le principe) ;
`iso-pulse` n'a pas de chaos — l'origine des ondes est déjà hachée — ni de
lissage, la maille étant rigide par construction.

### Deux angles morts de mes empreintes de test, encore

Les critères 11 et 12 ont d'abord échoué sur les nouveaux styles. Ni l'un ni
l'autre n'était un défaut du code :

- L'empreinte ignorait la **couleur des `fillPath`**. Or `monolith` fait réagir
  la caisse claire sur l'ÉCLAIRAGE des facettes, dont la forme ne bouge pas.
- Puis elle ignorait la **couleur des `strokePath`**. Or `iso-pulse` fait réagir
  la caisse claire sur la valeur des lignes en damier.

La couleur fait partie de l'image autant que la géométrie. Les deux empreintes
l'incluent désormais, et les critères 11 et 12 sont vérifiés sur les **cinq**
styles.

### Mesures — 60 s de simulation, 3 600 images

| style | `Scene.update` | `Scene.draw` | appels de rendu | par image |
|---|---|---|---|---|
| `monolith` | 0,0117 ms/pas | 0,0064 ms/image | 38 793 | ~10,8 |
| `iso-pulse` | 0,0159 ms/pas | 0,0142 ms/image | 135 248 | ~37,6 |

**Ce que ces chiffres disent, et ce qu'ils ne disent pas.** `Scene.update` est
mesuré en entier : il n'y a pas de rastérisation dans `update`, donc 0,016 ms
est le coût RÉEL, très loin du budget de 3 ms. `Scene.draw`, en revanche, est
mesuré contre un `FakeRenderer` qui enregistre au lieu de dessiner : le chiffre
ne couvre que la logique et le dispatch, pas le travail Canvas. **Le budget de
9 ms de `Scene.draw` n'est donc PAS vérifié** — il le sera au navigateur,
fenêtre au premier plan.

Le nombre d'appels, lui, est significatif et tient la conception : `iso-pulse`
émet 37,6 appels par image, cohérent avec 26 polylignes plus au plus 20 crêtes
et un lot de sprites.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 107 fichiers, 870 tests (863 -> 870, +7)
npm run test:arch   -> 1 test
npm run build       -> 464,44 kB (gzip 130,52 kB), 1,57 s
```

Tests automatisés des deux styles : 60 s de simulation sans exception, rendu
correct en 16:9 / 9:16 / 1:1 sans code conditionnel et sans produire un seul
`NaN` (Loi 4), image non vide **sans aucun onset** (Loi 3), et empreinte
identique à graine identique (Loi 1).

Navigateur, onglet neuf, **aucune erreur console**. Le catalogue expose bien les
cinq styles, et l'avertissement de macro inerte suit le style choisi :

| style | macros marquées inertes |
|---|---|
| `pulse` | Profondeur |
| `field` | — |
| `spectrum-pro` | — |
| `monolith` | Densité, Douceur |
| `iso-pulse` | Chaos, Douceur |

### À valider par Aaron, à l'œil

Rien de ce qui précède ne dit si c'est BEAU. Les points à juger :

- **`monolith` est un pari sur le vide.** S'il paraît simplement vide plutôt que
  tendu, c'est que le contraste entre l'immobilité et la fissure ne prend pas —
  et c'est tout le style qui est à revoir, pas un réglage.
- **La fissure** : `FISSURE_MAX_WIDTH = 0,055`. Trop fine, elle se lit comme une
  rayure ; trop large, comme un trou.
- **`iso-pulse` doit être hypnotique, pas monotone.** Le test : peut-on compter
  le tempo à l'œil, son coupé, pendant trente secondes sans s'ennuyer ?
- **La densité de la grille** (12 tuiles par côté) et le plafond de crêtes (20).
- **Les quatre variantes ajoutées** — `monolith` n'en a aucune centrée, sa masse
  l'étant déjà dans la couche.
- **Les deux styles n'ont pas encore de preset.** Ils ne sont atteignables que
  par le sélecteur de style. Les presets trap/house qui devraient y pointer
  arrivent au chantier 9.

### Limites connues

- **Le budget de 9 ms de `Scene.draw` n'est pas vérifié** (voir plus haut).
- **Aucun preset ne pointe vers les nouveaux styles** : `trap-dark` et `drill`
  restent sur `field`, `house` sur `pulse`. La réécriture des presets est le
  chantier 9 ; changer leur `style` maintenant modifierait le rendu de presets
  existants sans que le travail de couleurs qui va avec soit fait.
- Aucune capture d'écran : volet d'aperçu non affiché, `AudioContext` bloqué
  sans geste utilisateur. Même limite qu'aux chantiers précédents.

---

## Phase 2 — Chantier 6 : `chambre`, `eclats`, `aurore`

Périmètre : `docs/17_PHASE2_VISUELS.md` §11, chantier 6 (§8). Le catalogue passe
de trois à **huit styles** — les « styles 4 à 12 » que `docs/00b` §4 réservait à
l'après-MVP sont donc à mi-parcours.

### Décision tranchée : le bruit simplex DÉPLACÉ, pas dupliqué

`docs/17` §8 posait la question sans y répondre : le bruit simplex vit dans
`src/ui/live/util/noise.ts`, et `visual/` n'a pas le droit d'importer `ui/`.
« Le déplacer dans `src/core/`, ou en écrire un jumeau. Décide et justifie. »

**Déplacé** en `src/core/math/noise.ts`. Trois raisons :

1. Le fichier **n'importe rien** — il est déjà, de fait, du `core/`.
2. Il n'a que deux consommateurs, dont un test qui le couvre déjà : une erreur
   de déplacement aurait échoué immédiatement.
3. Un jumeau, ce serait 120 lignes de mathématiques dupliquées entre deux
   moteurs, avec la certitude qu'ils divergeront.

Le mode live n'est touché que par un chemin d'import. Aucun changement de
comportement.

### `chambre` — lofi, jazzhop, downtempo

« La texture, pas l'impact. » Faisceau oblique décentré, poussières en
suspension éclairées par lui, rayures de pellicule intermittentes, respiration
lente du vignettage.

Le kick ne produit qu'une inflexion de **2 %** sur la luminosité du faisceau —
le chiffre est celui de §8, et il est délibérément sous le seuil de conscience.
On ne doit pas voir l'image réagir, seulement sentir qu'elle est vivante. Un
lofi qui pulse au kick n'est plus du lofi.

Les poussières ne sont visibles que DANS le faisceau : c'est ce qui fait qu'on
lit un rai de lumière et non un ciel étoilé. Leurs positions sont des fonctions
pures de `t` et de l'index — aucun état, donc rien à rattraper après un seek.

Les rayures dépendent d'un hachage de l'index de MESURE : elles apparaissent et
disparaissent sans jamais clignoter. Une rayure qui changerait à chaque image
serait du bruit, pas du grain.

### `eclats` — drum & bass, jungle, breakbeat

« La syncope. » Le cadre se brise sur chaque caisse claire ; les éclats fuient
radialement le point d'impact, tournent, puis se recollent.

**Pas de vrai Voronoï.** §8 disait « partition de Voronoï pré-calculée ». Un
diagramme de Voronoï exige une triangulation de Delaunay — quelques centaines de
lignes, pour un résultat visuellement indiscernable ici. La partition retenue est
POLAIRE : anneaux × secteurs, rayons et angles perturbés par hachage, rayons en
progression quadratique pour que les éclats soient fins au centre et larges au
bord — comme casse un vrai panneau de verre. Calculée une seule fois à
l'initialisation ; par image, il ne reste qu'une translation et une rotation.

Le `FrameFeedback` n'est pas décoratif : sur un break à 174 BPM une caisse claire
dure moins de 200 ms, et sans traînée l'œil ne suivrait pas la dislocation.

### `aurore` — ambient, cinematic, chill

« La lenteur assumée. » Cinq rubans translucides qui ondulent, médiane pilotée
par le bruit simplex, épaisseur locale par les **six bandes** — graves en bas,
aigus en haut (Loi 2 : jamais un spectre plein).

Le dégradé n'est pas dessiné, il est **empilé** : `fillPath` ne prend qu'une
couleur plate, donc chaque ruban est cinq bandes translucides de largeur
décroissante autour de la même médiane. Moins cher qu'un vrai dégradé — qui
n'existe pas dans l'interface — et meilleur en additif, les recouvrements
faisant monter la densité vers le centre.

**C'est le style qui prouve la Loi 3.** Aucun onset ne le pilote. Il rend donc
exactement la même chose en régime événementiel et en régime continu : sur un
morceau que l'analyse comprend mal, c'est vers lui qu'il faut se tourner.

### Ce que les tests ont trouvé, et ce que ça a changé

**Quatre échecs sur cinq venaient du même angle mort de MES empreintes** :
elles enregistraient `r`, `g`, `b` mais **pas l'alpha**. Or `chambre` fait
réagir le kick sur l'alpha du faisceau, et `eclats` le LFO sur celui des éclats.
Troisième correction du même ordre après la couleur des `fillPath` (chantier 5)
et celle des `strokePath` : une empreinte d'image doit tout enregistrer de ce
qui est visible, et je l'ai découvert par morceaux.

**Un cinquième était un vrai manque** : `aurore` ne lisait que trois signaux, en
dessous du seuil de quatre. Corrigé sans lui ajouter d'onset — ce serait
contredire son principe : `brightness` (centroïde) fait glisser la teinte quand
le morceau s'éclaircit, `lfoB` resserre et rouvre très lentement l'écartement
des rubans.

**Un sixième était une exigence mal posée par mon propre test.** Il demandait à
TOUS les styles de réagir à la caisse claire. `aurore` est délibérément sourde
aux onsets ; l'exigence ne s'y applique pas. Mais l'exempter sans contrepartie
aurait fait de « je suis un style contemplatif » une excuse pour n'être branché
sur rien. Un test dédié vérifie donc qu'`aurore` réagit bien à un changement de
mapping CONTINU.

Enfin, le seuil « dessine au moins 4 primitives sans onset » punissait `chambre`,
qui en émet légitimement trois — fond, faisceau, poussières. Abaissé à 2 : le
test doit détecter un style MUET, pas un style dépouillé.

### Le typage a encore fait le travail

Ajouter trois `STYLE_IDS` a fait échouer la compilation sur `INERT_MACROS` et
sur les tables `Record<StyleId, …>` de deux tests. Impossible d'ajouter un style
sans déclarer ses macros inertes ni sans le soumettre aux contrôles existants —
exactement ce que le chantier 1 visait, et ce que le chantier 5 avait étendu aux
tests.

### Mesures — 60 s de simulation, 3 600 images, les cinq styles de phase 2

| style | `Scene.update` | `Scene.draw` | appels/image |
|---|---|---|---|
| `eclats` | 0,0089 ms/pas | 0,0211 ms/image | 53,0 |
| `chambre` | 0,0103 ms/pas | 0,0055 ms/image | 4,0 |
| `monolith` | 0,0105 ms/pas | 0,0096 ms/image | 10,8 |
| `iso-pulse` | 0,0171 ms/pas | 0,0135 ms/image | 37,6 |
| `aurore` | 0,0257 ms/pas | 0,0340 ms/image | 26,0 |

`Scene.update` est le coût RÉEL — il n'y a pas de rastérisation dedans. Le plus
lourd, `aurore`, consomme 0,026 ms contre 3 ms autorisées : le bruit simplex sur
5 × 40 points par pas ne pèse rien.

`Scene.draw`, en revanche, est mesuré contre un `FakeRenderer` qui enregistre au
lieu de dessiner. **Le budget de 9 ms n'est toujours PAS vérifié.** Le nombre
d'appels est l'indicateur utile : `eclats` en émet 53 par image (50 éclats plus
le fond et le feedback), ce qui en fait le style le plus coûteux du catalogue et
le premier à surveiller au navigateur.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 107 fichiers, 877 tests (870 -> 877, +7)
npm run test:arch   -> 1 test
npm run build       -> 471,79 kB (gzip 132,79 kB), 1,59 s
```

Les cinq styles de phase 2 passent : 60 s sans exception, corrects en 16:9 /
9:16 / 1:1 sans code conditionnel et sans un seul `NaN`, image non vide sans
aucun onset, empreinte identique à graine identique. Les critères 11 et 12 sont
vérifiés sur les **huit** styles.

Navigateur, onglet neuf, **aucune erreur console**. Le catalogue expose les huit
styles, et l'avertissement de macro inerte suit le style choisi :

```
pulse         Pulse         inertes: Profondeur
field         Field         inertes: —
spectrum-pro  Spectrum Pro  inertes: —
monolith      Monolith      inertes: Densité, Douceur
iso-pulse     Iso Pulse     inertes: Chaos, Douceur
chambre       Chambre       inertes: Profondeur, Chaos
eclats        Éclats        inertes: Densité, Douceur
aurore        Aurore        inertes: Profondeur, Chaos
```

### À valider par Aaron, à l'œil

- **`chambre` tient sur un pari radical** : son kick agit à 2 %. Si le style
  paraît mort plutôt que calme, c'est le pari qui est à revoir, pas la valeur.
- **`eclats` est le plus coûteux** (53 appels par image) et le plus susceptible
  de déclencher le `FlashLimiter` sur un break rapide. À surveiller en premier.
- **`aurore` doit être belle SANS musique analysable.** Le vrai test : lui
  donner un morceau que l'analyse rate, et regarder trente secondes.
- **L'empilement de cinq bandes** d'`aurore` produit-il un dégradé convaincant,
  ou voit-on les cinq marches ? C'est le point technique le plus incertain du
  chantier.
- **Aucun des cinq nouveaux styles n'a de preset.** Ils ne sont atteignables que
  par le sélecteur. C'est le chantier 9.

### Limites connues

- **Budget de 9 ms de `Scene.draw` non vérifié** — mesure au navigateur requise,
  fenêtre au premier plan.
- **Critère 13 (FlashLimiter et modes de fusion) toujours non vérifié.** Aucune
  variante d'`eclats` n'utilise `difference` pour cette raison, alors que ce
  serait le mode le plus naturel pour un miroir brisé.
- **Aucun preset ne pointe vers les cinq nouveaux styles** (chantier 9).
- Aucune capture d'écran : mêmes limites d'environnement qu'aux chantiers
  précédents.

---

## Phase 2 — Chantier 7 : pochette et palette extraite

Périmètre : `docs/17_PHASE2_VISUELS.md` §11, chantier 7 (§7.5). Il n'existait
**aucune entrée d'image** dans tout le projet, alors que le cas d'usage le plus
courant d'un visualiseur musical est la pochette au centre avec le visuel
autour.

### L'extension du `Renderer` autorisée n'a PAS servi

`docs/17` §4 réservait `drawImage` comme seconde extension autorisée de
l'interface. Elle n'a pas été nécessaire : `createSprite(draw, size)` fournit un
`OffscreenCanvasRenderingContext2D` hors écran où l'image se dessine UNE FOIS,
et `drawSprite` la place ensuite. Les sprites sont carrés, les pochettes aussi.

Ce chemin satisfait par construction la contrainte que §7.5 rappelle — « l'image
doit être décodée AVANT le rendu, jamais pendant » : décodage à l'import, tracé
dans le sprite à l'initialisation, et la boucle ne fait plus que placer une
texture. Une extension d'interface en moins à maintenir.

### La coupe : d'étendue, pas de médiane — et la mesure qui l'a imposé

§7.5 proposait « une quantification par médiane répétée ou un k-moyennes à
graine fixe ». La première version implémentait la coupe médiane classique :
diviser chaque boîte en deux moitiés de même POPULATION.

**Un test l'a prise en défaut, et le défaut est exactement le cas d'usage.** Sur
une image de 4 096 pixels dont 80 sont rouge vif et le reste presque noir,
aucune des huit couleurs extraites n'avait `r > 150` : la médiane tombe en plein
dans le noir, et il faut cinq ou six passes avant d'isoler le rouge. Or les
pochettes sont souvent sombres, et ce qu'on veut en tirer, c'est précisément le
petit élément vif.

Corrigé en coupant au **milieu de l'étendue du canal**, pas à la médiane de la
population : la séparation se fait selon la distance dans l'espace des couleurs,
indépendamment du nombre de pixels. Le rouge part du premier coup.

Vérifié ensuite sur une vraie image au navigateur — pochette sombre avec un
disque `#ff2e63` couvrant 2,6 % de la surface. L'accent extrait est
`rgb(255, 46, 99)`, soit la couleur exacte du disque.

L'en-tête du module a été corrigé en conséquence : il annonçait « coupe
médiane » et décrivait déjà, à tort, le comportement qu'il n'avait pas.

### Aucune image n'est refusée

§7.5 : « si elle échoue [le contraste], corrige la luminance plutôt que de
refuser — une pochette sombre est un cas normal, pas une erreur ». C'est la
règle qui structure `paletteFromCover`, et chacune de ses étapes existe pour un
cas dégénéré précis :

- **Fond** : la dominante, ramenée de force sous 0,08 de luminance en préservant
  sa teinte. Une pochette blanche donnerait sinon un fond blanc, et tout le
  moteur deviendrait illisible.
- **Accent** : la couleur la plus CHROMATIQUE, pas la deuxième plus peuplée. Sur
  une pochette sombre, le second rang est encore un gris.
- **Image monochrome** : signalée et assumée. Plutôt qu'inventer une couleur
  absente de l'image, on joue sur la seule luminance — ce qui reste fidèle.
- **Aucune couleur** (image vide ou entièrement transparente) : palette neutre.
  L'appelant est une action utilisateur, pas un chemin fautif.

Les pixels transparents sont écartés de la quantification : un PNG à fond
transparent porte souvent du noir sous l'alpha nul, et le compter donnerait une
dominante absente de l'image visible.

Six cas d'image sont testés — sombre, claire, entièrement noire, entièrement
blanche, monochrome, vide — et chacun doit produire une palette dont le
contraste fond/accent atteint 4:1.

### Le piège de l'Étape 25, évité de justesse

`ExportDialog` reçoit une fabrique de scène et `ExportPipeline` construit la
sienne. Sans intervention, **l'export aurait produit la même image moins la
pochette** — et le défaut ne se serait vu sur aucune vignette. Exactement le
scénario de l'Étape 25, où les macros de couche avaient été branchées d'un seul
côté pendant plusieurs étapes.

Trois points câblés : `withCover` dans la fabrique passée à l'export, un
`getCover()` sur les options du dialogue, et la transmission jusqu'à
`scene.init`. Un test lit les trois fichiers pour le vérifier.

### La pochette n'appartient à aucun style

`withCover(scene, hasCover)` rend une NOUVELLE scène augmentée d'une dernière
couche. Deux options écartées :

- **Inscrire la couche dans les huit fabriques** : huit fichiers à modifier,
  huit fois la même ligne, et une de plus à chaque style ajouté.
- **Un style `cover` dédié** — le format de Specterr : ce serait n'offrir la
  pochette qu'avec UN décor sur huit, alors qu'on veut l'inverse.

En dernière position toujours : une pochette à moitié cachée par des particules
ne remplit plus sa fonction. Un test le vérifie sur les huit styles, ainsi que
la préservation de `usesFeedback` — une scène recomposée qui perdrait ses
traînées ferait croire que le style a changé d'aspect.

C'est aussi **le premier élément du moteur qui porte de l'information**, donc le
premier à respecter la zone sûre de §7.4 : il se centre sur `viewport.safe`, pas
sur le cadre. En 9:16, une pochette centrée sur le cadre tomberait derrière la
légende et les boutons de la plateforme.

### Sur le `getImageData` de l'extraction

`CLAUDE.md` l'interdit « à chaque image ». L'interdit vise la boucle de rendu,
où une lecture de pixels coûte une synchronisation GPU par trame. Ici : une
action utilisateur, une fois par import, sur un bitmap de 64×64. Écrit dans le
fichier pour qu'on ne le signale pas comme une infraction à la relecture
suivante.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 109 fichiers, 902 tests (877 -> 902, +25)
npm run test:arch   -> 1 test
npm run build       -> 478,88 kB (gzip 135,35 kB), 1,98 s
```

Navigateur, onglet neuf, **aucune erreur console**. Import de bout en bout d'une
pochette synthétique :

```
pochette-test.png — contraste 5.4:1 · luminance corrigée pour rester lisible
```

| moment | pastilles de palette |
|---|---|
| avec pochette | fond `13,10,24` · primaire `117,107,150` · accent `255,46,99` |
| après « Retirer » | fond `5,6,11` · primaire `123,76,255` · accent `255,46,99` |

L'accent extrait est exactement la couleur du logo dessiné, et « Retirer » rend
bien la main à la palette du preset — seul moyen de revenir en arrière une fois
qu'une pochette a imposé la sienne.

### À valider par Aaron, à l'œil

- **La taille de la pochette** (42 % du petit côté) et son **halo**. C'est le
  réglage le plus subjectif du chantier.
- **La réaction au kick est plafonnée à 3 %** (§7.5 autorise 2 à 4 %). Si la
  pochette paraît morte, monter à 4 — mais pas au-delà : c'est un point fixe
  dans le cadre, et une pochette qui pompe fait cheap.
- **Les palettes extraites sur de VRAIES pochettes.** Les six cas testés sont
  synthétiques ; seule une série de vraies images dira si l'accent choisi est
  celui qu'un œil humain aurait retenu.
- **Le comportement en 9:16**, où la zone sûre déplace la pochette vers le haut.

### Limites connues

- **La pochette n'est PAS persistée.** Elle est perdue au rechargement ; la
  palette extraite l'est aussi, faute d'être écrite dans les surcharges du
  projet. Persister une image demande soit une montée de version d'IndexedDB
  avec migration, soit le mécanisme référence + relink utilisé pour l'audio.
  Les deux relèvent de `docs/13_PROJECT_FORMAT.md`, distinct de « faire
  apparaître la pochette et en tirer les couleurs », qui est ce que §7.5
  demandait. À traiter avec l'interface du chantier 10.
- **Aucun recadrage** : une pochette non carrée est étirée au carré. Le recadrage
  centré serait une ligne dans `createSprite`, mais le choix — recadrer ou
  laisser des bandes — est éditorial et n'était pas spécifié.
- La palette extraite l'emporte sur celle du preset tant qu'une pochette est
  active. Changer de preset ne la reprend donc pas ; il faut retirer la
  pochette. C'est délibéré, et le bouton le rend explicite.

---

## Phase 2 — Chantier 8 : texte et ses animations

Périmètre : `docs/17_PHASE2_VISUELS.md` §11, chantier 8 (§9.3 et §7.6), plus
l'exposition de `slamText` côté live. Aaron : « on peut faire un visuel avec des
choses qui sont écrites en lettres, comme LIVE, il faut pouvoir marquer ce que
l'on veut. »

### Le grain retenu : UN SPRITE PAR GLYPHE

§9.3 laissait le choix entre ajouter `drawText` à l'interface `Renderer` et
rastériser dans `createSprite`, en recommandant la seconde. Elle est suivie —
donc, comme au chantier 7, **aucune extension de l'interface**. Le grain, lui,
n'était pas donné : ligne ou glyphe.

C'est le glyphe, et ce n'est pas un détail de découpage. **Un sprite ne se
dessine qu'entier** : un sprite par ligne rendrait impossibles la machine à
écrire et l'entrée mot par mot, soit deux des six animations de §7.6. En prime
il est plus FIN à mémoire égale — une ligne de vingt caractères dans un carré de
512 donne vingt-cinq pixels par caractère, vingt carrés de 160 en donnent cent
soixante.

Les sprites sont mutualisés par CARACTÈRE : « MEL VEL » a six glyphes et quatre
sprites. Le côté du sprite décroît avec le nombre de glyphes, de sorte que la
mémoire totale reste bornée quel que soit le texte.

### Les deux animations que l'absence de `clip()` interdisait

Quatre des six animations demandées se posent directement sur `drawSprite`, qui
accepte position, échelle et alpha. Deux ne le pouvaient pas : « révélation par
masque » et « découpe en tranches » demandent un masque animé, et §4 est
formelle — pas de `clip()` pour les couches.

Résolues par le même mécanisme : **chaque glyphe est rastérisé une seconde fois
en trois TRANCHES horizontales**, chacune un sprite à part, découpée dans le
`createSprite` où `clip()` est licite. Les tranches se déplacent alors
indépendamment, ce qui donne la bande qui s'ouvre depuis le centre pour l'une,
les bandes qui glissent en sens alterné pour l'autre. Les tranches ne sont
construites que si l'animation choisie en a besoin, et ne sont dessinées que
pendant l'animation — au repos, c'est le sprite net qui repasse.

Sens de départ des tranches donné par leur PARITÉ, jamais tiré au sort :
`step.rng` est partagé entre les couches, en consommer décalerait toutes les
autres.

### Ce qui est calé sur les mesures, pas sur les secondes

§7.6 : « chaque animation calée sur la grille musicale, pas sur une durée en
secondes. C'est ce que CapCut ne sait pas faire. » `textAnimations.ts` ne connaît
donc qu'un `progress` de 0 à 1, que la couche dérive de `bar.index + bar.phase`.
Aucune seconde, aucune horloge : sept fonctions pures d'un scalaire, testables
sans rendu, et conformes à la Loi 1 par construction.

Le curseur de la machine à écrire clignote lui aussi sur le BEAT (`pulse`), pas
à 500 ms fixes.

**L'invariant qui compte : à `progress === 1`, les sept animations reviennent à
l'identité.** Un décalage résiduel donnerait un texte légèrement de travers en
permanence, sans que rien ne bouge à l'écran pour l'expliquer, et le symptôme
serait attribué à la mise en page. Vérifié sur les sept, glyphes et tranches.

### Le défaut le plus important du chantier : le texte sortait du cadre

Trouvé au navigateur, pas à la lecture. Un titre centré à sa taille par défaut
était **coupé au bord droit du cadre**. Le centre du texte allait de -20 à
+125 px sur un cadre de 893 px, et il suivait la GRAINE : ce n'était pas la mise
en page, c'était le cadrage de variante du chantier 4 qui déplaçait tout.

Le calcul le confirme : `STYLE_VARIANTS` va jusqu'à 0,17 de décalage et 1,30 de
zoom ; avec la dérive de la dramaturgie par-dessus, la demi-largeur encore
visible tombe à (0,889 - 0,22) / 1,45 = 0,46, alors qu'un titre centré en occupe
0,71. Un tiers du titre dehors.

**La règle posée** — `framingFor(scene, variant)` : le cadrage de variante décrit
un STYLE, les habillages n'appartiennent à aucun style, donc une scène qui en
porte un garde le cadrage NEUTRE. La caméra de la dramaturgie reste : elle est
dix fois plus discrète et c'est le morceau qui la dicte, pas un tirage. Un titre
doit suivre le morceau.

La règle vaut aussi pour la POCHETTE du chantier 7, qui avait le même défaut
sans que personne l'ait vu — une pochette à moitié hors cadre ne remplit pas
mieux sa fonction qu'un titre coupé.

Le remède n'était PAS de rapetisser le texte : il aurait fallu le ramener à 55 %
de la largeur du cadre pour survivre au pire cadrage, c'est-à-dire supprimer le
titre plein cadre pour parer un cas de bord.

Reste la caméra de dramaturgie. Mesurée plutôt qu'estimée : 122 échantillons sur
46 s de la piste de démonstration, la marge droite minimale tombait à **1 px**
au moment où la caméra pousse (t = 7,7 s, le titre passant de 752 à 843 px). D'où
`CAMERA_HEADROOM = 0.88`, l'inverse arrondi du zoom maximal. Après correction,
sur 118 échantillons : **marge minimale 51 px**, et le titre fait encore 83 % du
cadre.

### Deux balayages indexés par STYLE frappaient les habillages

Trouvé en relisant le câblage, avant toute exécution, puis mis sous test.

`applyLayerBlends` et `applyLayerMacrosToScene` parcourent TOUTES les couches et
écrasent respectivement `blend` et `params`, à partir de tables indexées par
style. Une couche d'habillage n'y figure par construction jamais — donc les deux
lui remettaient ses valeurs à vide.

Pour le texte la conséquence était nette : il déclare `blend = 'normal'` pour
rester lisible (du texte additif sur fond clair s'éclaircit jusqu'au blanc), et
il serait redevenu additif **au premier mouvement de curseur de macro**.

Les deux fonctions sautent désormais les couches d'habillage, reconnues par
`isOverlayLayer` — la même notion que celle qui justifie `withCover` et
`withText`, remontée dans `Layer.ts` pour n'exister qu'une fois.

### Le mode live partage le MÊME champ

§9.3 : « `LiveConfig.content.slamText` existe [...] mais aucune interface ne
l'expose. Expose-le. » Fait par le même champ que le texte du mode fichier :
Aaron écrit son label une fois, il sert aux deux moteurs. Deux champs séparés
auraient demandé de choisir lequel fait foi.

`LivePipeline.setSlamText` baisse `sceneInited` pour que `TypeSlamScene.init`
relise la configuration à la trame suivante. C'est la seule voie qui évite un
`start()` complet — lequel repartirait de zéro sur l'analyse, donc perdrait le
verrou de tempo au milieu d'un morceau.

### Ce qui a été décidé de NE PAS faire

- **Pas de substitution `{bpm}` en mode fichier.** Le mode live la fait, et c'est
  légitime là-bas : son texte tient dans un calque réutilisable qu'un changement
  de chaîne reconstruit sans drame. Ici, un texte qui change en cours de lecture
  voudrait dire reconstruire N sprites PENDANT la boucle. Le texte du mode
  fichier est donc fixe.
- **Pas de police téléchargée.** Trois piles système. Une police web absente au
  moment du rendu produirait un export à la police de repli sans que rien ne le
  signale — et c'est aussi ce qui rend inutile ici la danse autour de
  `document.fonts.ready` que fait `TypeSlamScene`. Écrit dans le fichier : le
  piège reviendrait à la première police web ajoutée.
- **Pas de rotation.** `Renderer` n'expose pas `setTransform`. La mise en page
  « diagonale » décale les lignes en escalier ; le mot décrit la disposition du
  bloc, pas l'inclinaison des glyphes.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 112 fichiers, 1007 tests (902 -> 1007, +105)
npm run test:arch   -> 1 test
npm run build       -> 491,14 kB (gzip 139,75 kB), 1,99 s
```

Navigateur, onglet neuf, **aucune erreur console**. Toutes les mesures qui
suivent sont faites en lisant les PIXELS du canevas d'aperçu (893x502), la
simulation étant pilotée pas à pas.

**Les sept animations vivent** (pixels clairs, min -> max sur un cycle) :

| animation | amplitude mesurée |
|---|---|
| `none` | 46 076 -> 47 314 (respiration du kick seule) |
| `word` | 46 009 -> 50 209 |
| `typewriter` | 45 853 -> 47 002 |
| `reveal` | **251 -> 50 446** |
| `scale` | **30 -> 51 289** |
| `rgb` | 1 146 -> 51 296 |
| `slice` | 13 055 -> 50 319 |

**Le décalage RVB pose vraiment de la couleur** — pixels franchement rouges /
bleus, même scène, texte posé :

| | rouges | bleus |
|---|---|---|
| sans `rgb` | 1 864 | 8 458 |
| avec `rgb` | **13 200** | **16 626** |

**Les cinq mises en page placent le texte ailleurs** (centre et largeur d'encre) :

| mise en page | centre | largeur |
|---|---|---|
| `center` | (457, 215) | 661 |
| `lower-third` | (400, 312) | 692 |
| `diagonal` | (456, 217) | 553 |
| `oversize` | (446, 204) | **893, bord à bord** |
| `third` | (527, 136) | 430 |

`diagonal` sur trois lignes : bords gauches à 235, 295, 348 px — l'escalier est
bien là.

**Coût par image** (`update` + `beginFrame` + `draw` + `endFrame` +
`FlashLimiter`, 120 appels chronométrés) :

| | ms |
|---|---|
| sans texte | 3,405 |
| titre posé, 6 glyphes | 3,719 (**+0,31**) |
| 2 lignes, 22 glyphes, tranches | 4,063 (**+0,66**) |

Trois familles de police donnent trois rendus distincts (hauteurs d'encre 154 /
167 / 138 px) : `measureText` est bien lu, la mise en page n'est pas sur des
avances forfaitaires. La troncature est SIGNALÉE : « Texte tronqué à 40
caractères (hors espaces). »

### À valider par Aaron, à l'œil

- **La taille par défaut d'un titre centré** : 83 % de la largeur du cadre après
  la marge de caméra. C'est un parti pris fort ; le curseur « Taille » le
  rattrape dans les deux sens.
- **Le curseur de la machine à écrire.** Sa logique est sous test, mais son tracé
  n'a pas pu être isolé au pixel. À regarder : clignote-t-il sur le beat, et
  reste-t-il collé au bon caractère ?
- **La `slice` sur trois tranches.** Trois est le minimum qui se lise comme des
  tranches. Si ça fait pauvre, c'est le nombre qu'il faut monter, pas la course.
- **`framingFor` est le seul changement qui touche l'EXISTANT** : avec une
  pochette ou un texte, le cadrage de variante ne s'applique plus. Comparer un
  projet avec et sans texte pour juger si la perte de cadrage se voit.
- **Le rendu en 9:16**, où la zone sûre remonte le bloc de 34 % du petit côté.
  Non vérifiable à l'aperçu, qui reste en 16:9 quel que soit le format d'export.

### Limites connues

- **Le texte n'est PAS persisté** — perdu au rechargement, comme la pochette du
  chantier 7 et pour la même raison : c'est `docs/13_PROJECT_FORMAT.md`, à
  traiter avec l'interface du chantier 10. C'est la limite la plus gênante des
  deux, un texte se retapant plus souvent qu'une image ne se réimporte.
- **Aucun preset ne pose de texte.** Il n'est atteignable que par le panneau
  (chantier 9).
- **Mesures de coût à 893x502**, pas à 1080p : le rapport entre les trois
  colonnes tient, la valeur absolue non.
- **Aucune capture d'écran** : mêmes limites d'environnement qu'aux chantiers
  précédents. Tout ce qui est affirmé ci-dessus est un comptage de pixels.

---

## Phase 2 — Chantier 9 : couleurs, bloom par preset, presets réécrits

Périmètre : `docs/17_PHASE2_VISUELS.md` §11, chantier 9 (§9.2, §6.5, §9.4).
C'est le chantier qui répond le plus directement au grief d'origine d'Aaron :
« les presets sont inutilisables, ça ne change rien ».

### OKLCH remonté dans `core/` — et la mesure qui l'a décidé

§9.2 demandait de trancher : porter la conversion OKLCH du mode live vers
`visual/`, ou pas, en disant pourquoi dans les deux cas.

Elle est portée, et la raison est chiffrée. `temperature(energy)` relie deux
couleurs choisies dans le preset ; en RGB, le trajet passe par une zone terne.
Mesuré sur les cinq presets d'alors, chroma OKLCH du point intermédiaire :

| preset | pire perte de chroma en RGB |
|---|---|
| `house` | **58,5 %** (au quart du trajet) |
| `lofi` | 23,9 % |
| `rnb` | 18,2 % |
| `trap-dark` | 12,6 % |
| `drill` | 5,5 % |

`house` dérive de `#402410` (brun sombre) vers `#3CE7FF` (cyan) : le premier
quart du trajet était **un gris**. C'est le cas d'école qu'OKLCH corrige.

Le module a donc été déplacé de `ui/live/util/` vers `core/color/`, exactement
comme le bruit simplex au chantier 6 — `core/ → rien`, donc le déplacement est
licite, et `visual/` comme `presets/` peuvent enfin le lire. **Effet de bord
bienvenu** : la duplication que j'avais assumée par écrit au chantier 7
(`relativeLuminance` / `contrastRatio` recopiées dans `visual/palette/contrast
.ts`) n'a plus de raison d'être et disparaît. La justification d'alors tenait au
découpage du module ; elle ne tenait plus une fois le module déplacé en entier.

Les EXTRÊMES de la dérive restent rendus tels qu'écrits dans le preset :
l'aller-retour sRGB → OKLCH → sRGB est exact à 1e-5 près mais pas au bit, et
`temperature(0)` doit rendre la couleur que l'auteur a tapée.

### La dérive n'était lue nulle part — troisième sprite du halo

En branchant l'OKLCH, j'ai constaté que `temperature(0,5)` **n'était lu par
personne**. Une seule couche lit `temperature`, `CentralGlow`, et elle n'en
prenait que les deux bornes, qu'elle fondait ADDITIVEMENT l'une dans l'autre.
Or la somme de deux couleurs opposées à demi-alpha est le milieu arithmétique —
c'est-à-dire, exactement, la zone terne qu'on venait de corriger. L'amélioration
aurait été invisible.

Un troisième sprite au milieu perceptuel et des poids en TRIANGLE (dont la somme
vaut 1 quelle que soit la valeur de `brightness`, pour que le fondu de
température ne se lise pas comme une pulsation de luminosité). Une allocation de
plus, à l'initialisation.

### Le bloom appartient au preset (§6.5)

Avant : `ui/App.ts` et `ExportPipeline.ts` passaient directement le bloom du
NIVEAU DE QUALITÉ au `Renderer`. Un preset volontairement mat et un preset
volontairement incandescent recevaient donc le même halo, et **la macro Glow —
qui a pourtant un curseur dans le panneau Simple — n'avait aucune action sur
lui**. Un réglage offert au choix qui ne change rien : le diagnostic de §5, mot
pour mot.

`resolveBloom(preset, glow, plafond)` :

- le **veto du plafond est absolu** — le niveau `low` coupe le bloom parce que la
  machine ne suit pas, et aucune intention artistique ne le rallume ;
- mais `ultra` **n'impose plus** ses deux passes à un preset qui n'en veut
  qu'une ;
- `resolutionScale` reste entièrement au plafond : c'est un réglage de COÛT, pas
  d'intention. Un preset n'a rien à en dire.

**Un test a corrigé ma formule.** J'avais écrit `passes × (0,5 + glow)` en
commentant qu'à Glow = 0 un preset d'une passe devait pouvoir tomber à zéro. Il
tombait à 0,5, que `Math.round` remonte à 1 : le curseur n'avait pas de bas de
course, et mon propre commentaire affirmait le contraire. Corrigé en
`passes × 2 × glow`, où 0,5 reste le point neutre.

### Onze presets, et chaque style en a un (§9.4)

Cinq presets ne pointaient que sur **trois** styles : `pulse` deux fois, `field`
deux fois, `spectrum-pro` une fois. Deux presets sur cinq rendaient donc la même
géométrie, à la palette près — troisième cause du grief d'origine, après les
sept signaux jetés (chantier 2) et l'absence de dramaturgie (chantier 3).

Les cinq d'origine sont redirigés, les six presets 6 à 11 de `docs/00b` §4 sont
ajoutés :

| preset | style | preset | style |
|---|---|---|---|
| Trap Dark | `field` | Techno | `monolith` |
| Drill | `eclats` | Dubstep | `pulse` |
| House | `iso-pulse` | EDM Festival | `spectrum-pro` |
| Lofi | `chambre` | Phonk | `eclats` |
| R&B | `aurore` | Afrobeats | `iso-pulse` |
| | | Ambient | `aurore` |

Onze pour huit : trois styles en portent deux, avec des câblages et des palettes
sans rapport. Un test vérifie que **chaque style a au moins un preset** — sans
lui, le style ajouté au chantier suivant redeviendrait inatteignable par le
sélecteur de preset.

Chaque preset déclare désormais les **treize entrées câblables**, LFO compris.
En omettre une la fait retomber sur `defaultMapping`, donc rend deux presets
identiques sur ce signal — ce que §9.4 refuse. Un test le vérifie, un autre
vérifie qu'aucun preset ne partage le câblage d'un autre.

**Deux intentions documentées ont failli être perdues.** En réécrivant les cinq
presets d'origine, j'ai écrasé le recâblage R&B (`impact` sur SNARE/CLAP, parce
que « le snare mène, pas le kick ») et les seuils de classification du drill
(remontés à cause des faux positifs sur les 808 glissantes). Deux tests écrits
au MVP les ont rattrapés immédiatement. Restaurés, et le pourquoi est désormais
en commentaire à côté de la valeur.

### Le catalogue de palettes : les huit du mode live, pas huit inventées

§9.2 : « Regarde-les avant d'en inventer. » Elles ont été regardées, et elles
sont reprises telles quelles. Elles ont derrière elles une contrainte que rien
n'égale ici : elles ont tourné en direct, sur du son réel, avec une modulation de
teinte en temps réel, et un test leur impose déjà 4:1.

Ce qu'il a fallu ajouter, le mode fichier ayant des rôles que le live n'a pas :
`bg` est une PAIRE (le fond live plus une version assombrie en OKLCH, donc à
teinte constante) ; `glow` n'existe pas en live — le `highlight` presque blanc
laverait la palette, c'est donc la primaire remontée en clarté et en chroma ;
`drift`, les deux bornes de `temperature`.

Les recettes sont écrites **en OKLCH** et converties au chargement. Écrire
directement l'hexadécimal aurait figé des valeurs dont personne n'aurait plus pu
dire d'où elles viennent, alors qu'ici on lit « même teinte, clarté 0,2 de
moins ».

**Une valeur a dû être corrigée** : l'accent de `lime-violet`, à la clarté du
mode live, ne tenait que 3,81:1 contre le fond du mode fichier, plus sombre.
Remonté de 0,55 à 0,63. Un accent marque une frappe : il porte de l'information
et doit tenir le seuil **pour lui-même**, pas seulement par le biais de la
primaire. Un test le vérifie sur les huit.

### L'éditeur avertit, il n'interdit pas

§9.2 est explicite là-dessus, et c'est la bonne règle : sur une palette extraite
d'une pochette sombre, l'utilisateur n'a aucun moyen de « corriger » son image,
et une interdiction le bloquerait sur un réglage qu'il n'a pas choisi.

**Priorité des couleurs** : édition explicite, puis pochette, puis preset. Une
couleur choisie à la main est l'acte le plus délibéré, elle l'emporte ;
symétriquement, importer une pochette EFFACE l'édition en cours — demander les
couleurs d'une image, c'est renoncer aux siennes.

Les huit pastilles se remplissent depuis la palette ACTIVE, pas depuis celle du
preset : sinon, bouger une seule pastille ramènerait d'un coup les sept autres à
des valeurs que l'utilisateur ne voyait plus, notamment après un import de
pochette.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 114 fichiers, 1034 tests (1007 -> 1034, +27)
npm run test:arch   -> 1 test
npm run build       -> 506,56 kB (gzip 143,92 kB), 2,11 s
```

Navigateur, onglet neuf, **aucune erreur console** après avoir parcouru les onze
presets, appliqué une palette du catalogue et fait « revenir à la palette du
preset ». Mesures par lecture des pixels du canevas d'aperçu.

**Critère 11, les onze presets rendent onze images différentes.** Empreinte à
`t = 3,17 s` (moyennes RGB, pixels clairs, luminance par quadrant) :
**11 empreintes distinctes sur 11**.

**Le catalogue de palettes agit**, mesuré sur le CONTENU DESSINÉ seul (pixels de
luminance > 20, pour que le fond noir ne noie pas la moyenne), `t = 26,6 s` :

| palette | R | G | B |
|---|---|---|---|
| celle du preset (trap-dark) | 135,9 | 25,1 | 74,4 |
| `ember` | 110,3 | 48,5 | 22,5 |
| `glacier` | 45,8 | 66,6 | 87,4 |
| `lime-violet` | 73,2 | 44,9 | 101,5 |
| retour à celle du preset | 135,3 | 25,5 | 74,7 |

**L'avertissement de contraste se déclenche.** Palette poussée à l'illisible
(gris très sombres sur fond noir) :

```
Contraste 1.1:1 — sous le seuil de 4:1. Le visuel sera difficile à lire.
```

...et le réglage est appliqué quand même, comme §9.2 le demande.

**Le curseur Glow agit sur le halo** (pixels de luminance intermédiaire /
pixels vifs) :

| Glow | lumière étalée | pixels vifs |
|---|---|---|
| 0 | 16 207 | 164 |
| 0,5 | 18 420 | 1 226 |
| 1 | 19 184 | **2 597** |

À l'aperçu, cet effet est COMBINÉ : le curseur Glow pilote à la fois les macros
de couche et, depuis ce chantier, le bloom. Le navigateur ne peut pas séparer les
deux ; c'est `resolveBloom` qui est testé unitairement pour ça, veto du plafond
et bas de course compris, plus un test qui vérifie que l'aperçu ET l'export
passent tous les deux par lui.

### À valider par Aaron, à l'œil et à l'oreille

- **Les cinq presets d'origine ont CHANGÉ DE STYLE.** C'est le changement le plus
  visible du chantier et le plus discutable : `drill` passe de `pulse` à
  `eclats`, `house` de `spectrum-pro` à `iso-pulse`, `lofi` de `pulse` à
  `chambre`, `rnb` de `field` à `aurore`. Seul `trap-dark` garde `field`. La
  justesse du genre associé à chaque style est exactement ce que §12 demande de
  valider à l'œil.
- **Les six nouveaux genres**, et surtout `ambient` — le seul preset marqué
  `reducedFlashing` et le seul dont l'analyse ratera probablement le tempo. C'est
  le test de la Loi 3 : « un morceau non analysable doit rester beau. »
- **Les palettes du catalogue sur de vrais morceaux.** Elles viennent du mode
  live, où le fond est plus clair : elles peuvent paraître trop saturées ici.
- **Le halo du style `pulse` est passé à trois sprites.** À regarder sur un
  morceau qui monte en brillance : le fondu de température doit se lire comme un
  changement de couleur, pas comme une pulsation de luminosité.
- **Les valeurs de `bloom.passes` par preset** (1 pour `drill`, `lofi`, `techno` ;
  3 pour `rnb`, `dubstep`, `edm`, `ambient` ; 2 pour les autres). C'est le
  réglage le plus subjectif du lot.

### Limites connues

- **Ni la palette éditée ni le texte ne sont persistés** — même limite qu'aux
  chantiers 7 et 8, même cause (`docs/13_PROJECT_FORMAT.md`), à traiter avec
  l'interface du chantier 10. Une palette patiemment réglée est perdue au
  rechargement.
- **Le critère 13 (`FlashLimiter` et modes de fusion) reste non vérifié**, comme
  aux chantiers 5 et 6.
- **Les onze presets n'ont pas été écoutés sur leur genre.** Leurs câblages sont
  raisonnés (temps de décroissance, dominance du sub, densité d'onsets) et testés
  pour leur distinction mutuelle, mais aucun n'a été confronté à un morceau du
  genre visé.
- **`suggest.ts` n'a pas été retouché.** Son algorithme est générique — il score
  les `genre` du catalogue, sans identifiant en dur — donc il fonctionne sur onze
  presets sans modification. Mais sa constante de normalisation de densité porte
  un commentaire devenu faux : « faute de genre réellement dense dans le
  catalogue MVP ». `drill`, `techno` et `afro` le sont maintenant. La suggestion
  reste donc à recalibrer, et rien ne le signalera tant que personne ne la
  compare à ce qu'un humain choisirait.
- Aucune capture d'écran : mêmes limites d'environnement qu'aux chantiers
  précédents. Tout ce qui est affirmé ci-dessus est un comptage de pixels.

---

## Phase 2 — Chantier 10, lot A : interface

§11 prévenait : « Le chantier 10 est le plus gros ; s'il devient trop lourd,
découpe-le et propose le découpage avant de commencer. » Il l'est. Découpage
proposé, cinq lots :

| lot | contenu | §17 |
|---|---|---|
| **A** | **interface : CSS, mise en page par intention, vignettes de style** | §10.1 |
| B | persistance de la pochette, du texte et de la palette dans le projet | dette des chantiers 7, 8, 9 |
| C | éditeur de réaction + compositeur de couches et « Looks » | §7.11, §7.7 |
| D | automatisation par images-clés | §7.3 |
| E | marqueurs et correction de l'analyse + options d'export | §7.8, §7.12 |

A d'abord, parce que les quatre autres ajoutent tous des contrôles et que les
poser dans la barre latérale d'avant aurait été empiler une dixième boîte dans
une colonne qui en comptait déjà huit.

**Ce lot ne couvre que §10.1.** Trois de ses six points étaient déjà faits au
chantier 1 et ont été revérifiés plutôt que refaits : le catalogue de styles est
peuplé depuis `STYLE_IDS` (le `<select>` en dur avait disparu), les résidus morts
d'`AdvancedPanel` sont retirés (`WIRED_MACROS` contenait toutes les macros, donc
l'avertissement était inatteignable), et l'en-tête périmé de `SimplePanel` est
corrigé. Le curseur Profondeur en `pulse` est traité comme §10.1 l'autorise —
marqué `⚠` avec une infobulle plutôt que grisé, parce que sa valeur est
enregistrée dans le preset et reprend effet dès qu'on change de style ; le griser
ferait croire qu'il est cassé.

### Le CSS sort du HTML

130 lignes dans un `<style>` en ligne, plus huit attributs `style=`. `#2c2e38`
y apparaissait onze fois, `#1b1d24` sept fois : changer le thème demandait un
remplacement global, et un oubli ne se voyait que sur le composant concerné.

`src/ui/styles.css`, importée depuis `App.ts` et non liée depuis le HTML — Vite
l'assemble avec le reste, et un chemin faux casse la compilation au lieu de
laisser passer une page sans style. Les couleurs, espacements et rayons sont des
variables de `:root`.

**Un test interdit désormais toute couleur hexadécimale hors de `:root`.** Sans
lui, la première règle ajoutée recopierait un `#2c2e38` et le thème cesserait
d'être changeable en un point. Il a fallu lui apprendre à ignorer les
commentaires : l'en-tête de la feuille CITE les couleurs qu'elle remplace, et une
garde qui se déclenche sur sa propre documentation est inutilisable.

### Les onglets FILTRENT, ils ne découpent plus

Il y avait `#panel-simple` et `#panel-advanced`, dont un seul était visible. Un
réglage changeait donc de place selon l'onglet, et certains n'existaient que d'un
côté sans que rien ne l'indique — la palette n'était nulle part en Avancé, le
curseur Glow était dans les deux.

Les contrôles sont maintenant en **cinq groupes par intention** (§10.1 : Visuel /
Couleurs / Texte / Réactivité / Export), toujours présents, chacun un `<details>`
repliable — la seule façon de garder une colonne de 340 px lisible avec cinq
groupes. Les onglets ne font plus que masquer les éléments marqués `data-mode`.

L'état initial du filtre est posé par un appel au chargement, pas par des
attributs `hidden` dans le HTML : le filtre porte sur dix éléments disséminés
dans les cinq groupes, et les marquer un à un garantissait un oubli.

### Des vignettes rendues PAR LE MOTEUR

§10.1 : « Des vignettes de style, pas une liste déroulante. »

Chaque vignette est une vraie image du style : la vraie scène, le vrai
`Canvas2DRenderer`, la palette du projet. Huit pictogrammes dessinés à la main
auraient coûté dix fois moins et auraient été faux dès la première retouche d'un
style — une vignette qui ment est pire qu'une liste déroulante honnête. Bénéfice
immédiat : **les vignettes suivent la palette**, donc on voit la géométrie dans
ses propres couleurs sans avoir à l'appliquer.

Une scène ne se dessine pas sans `StepContext`, et il n'y a pas de morceau au
démarrage : `buildDemoDoc` en fabrique un — le même que le bouton « Charger une
démo », donc déjà validé par `validatePmdi`.

Deux réglages non évidents, tous deux imposés par ce qu'on voyait :

- **La simulation démarre à 4 s, pas à 0.** Le début d'un morceau est une intro,
  et une vignette prise là montre un cadre presque vide. `StepContext` étant une
  fonction pure de `t`, démarrer plus loin ne coûte pas un pas de plus.
- **Les 24 dernières images sont réellement DESSINÉES**, pas seulement simulées.
  Une couche à feedback part d'un canvas noir : sans cette queue, `field` et les
  styles à traînée rendaient une vignette vide.

### `setTimeout` et non `requestAnimationFrame` — mesuré

Les huit vignettes d'affilée coûtaient **68,7 ms** (8,6 ms chacune), soit quatre
images perdues d'un coup à chaque changement de palette. Étalées à une par tâche,
chacune passe sous le budget de 16 ms — l'appel synchrone tombe de **68,7 ms à
2,5 ms**.

Premier essai avec `requestAnimationFrame`, le primitif naturel pour du dessin.
**Les huit vignettes sont restées noires** : rAF ne se déclenche pas dans un
onglet qui ne composite pas. `setTimeout` s'exécute partout, laisse le navigateur
peindre entre deux tâches exactement de la même façon, et son ralentissement en
arrière-plan ne concerne que des vignettes que personne ne regarde. Un test
interdit le retour à rAF, avec la raison.

Deux garde-fous en plus : rien n'est rendu tant que le groupe « Visuel » est
replié, et une empreinte palette + graine évite de tout redessiner à chaque pixel
de course d'un curseur de macro.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 114 fichiers, 1045 tests (1034 -> 1045, +11)
npm run test:arch   -> 1 test
npm run build       -> index.html 12,95 kB (18,91 avant) + CSS 7,64 kB
                       JS 508,04 kB (gzip 144,46 kB), 2,05 s
```

Navigateur, onglet neuf, **aucune erreur console**.

| contrôle | mesure |
|---|---|
| feuille de style chargée | `--accent` = `#7b4cff`, fond `rgb(13, 14, 18)` |
| groupes | 5, dans l'ordre, « Visuel » ouvert |
| vignettes | **8 / 8 non vides** |
| ancien `#style-select` | absent |
| clic sur une vignette | `pulse` -> `eclats`, une seule pressée |
| filtre Simple | 10 éléments `avance` masqués sur 10 |
| filtre Avancé | 0 masqué, grille de 8 macros présente |
| appel synchrone d'un changement de palette | **2,5 ms** (68,7 avant) |

Les vignettes suivent bien la palette : sur `ember`, les huit ont une dominante
rouge (R nettement supérieur à G et B sur les huit).

### À valider par Aaron, à l'œil

- **La lisibilité des vignettes à 160 x 90.** C'est la question du lot : à cette
  taille, `field` ne montre que 638 pixels non noirs sur 14 400. Reconnaît-on le
  style, ou faut-il agrandir la vignette — ou allonger la chauffe ?
- **L'instant capturé (4 s) et la durée de chauffe (2 s).** Un autre instant
  donnerait d'autres vignettes ; celui-ci est un compromis entre « il se passe
  quelque chose » et « ça ne coûte pas ».
- **Le repliage par défaut** : seul « Visuel » est ouvert au démarrage. Trop
  fermé, ou juste ce qu'il faut ?
- **Le passage Simple / Avancé** : les dix éléments avancés apparaissent-ils là
  où on les attend, maintenant qu'ils ne sont plus dans un panneau à part ?

### Limites connues

- **Aucune capture d'écran** — c'est le lot où ça manque le plus, puisqu'il est
  entièrement visuel. Tout ce qui est affirmé ci-dessus est un comptage de
  pixels et une lecture du DOM.
- **Les vignettes ne sont pas mises en cache entre les sessions** : elles sont
  recalculées à chaque ouverture du groupe si la palette a changé.
- **Le lot A ne couvre que §10.1.** Le compositeur de couches, les « Looks »,
  l'éditeur de réaction, l'automatisation, les marqueurs et les options d'export
  sont les lots B à E.
- **La dette de persistance des chantiers 7, 8 et 9 n'est pas payée** : la
  pochette, le texte et la palette éditée sont toujours perdus au rechargement.
  C'est le lot B.

---

## Phase 2 — Chantier 10, lot B : persistance

Trois limites signalées trois fois de suite — la pochette au chantier 7, le
texte au 8, la palette éditée au 9 — et toutes renvoyées à
`docs/13_PROJECT_FORMAT.md`. C'est ce lot. Un texte patiemment réglé et une
pochette importée disparaissaient au rechargement.

### Ce qui n'a PAS eu besoin d'être fait

Les trois chantiers annonçaient soit « une montée de `DB_VERSION` avec
migration », soit « le mécanisme référence + relink de l'audio ». Ni l'un ni
l'autre n'a servi, et la raison mérite d'être écrite parce qu'elle vaudra encore
la prochaine fois :

- **`DB_VERSION` reste à 1.** Un magasin IndexedDB n'a pas de schéma de colonnes.
  Il stocke des objets structurés-clonables indexés par `keyPath` ; ajouter un
  champ `cover` à `StoredProject` est donc lisible par l'ancienne version comme
  par la nouvelle — l'ancienne l'ignore, la nouvelle le trouve `undefined` sur
  les enregistrements écrits avant. `DB_VERSION` ne sert qu'à créer ou supprimer
  des MAGASINS et des index, et il n'y en a ni l'un ni l'autre ici.
- **Aucune migration de `.pvproj`.** Les trois champs sont OPTIONNELS : un projet
  d'avant ce lot est valide tel quel, et `migrate` préserve déjà les champs
  inconnus.
- **`visual.palette` existait déjà.** Déclaré depuis l'Étape 13, du type
  `string | PaletteOverride`, et écrit par PERSONNE. L'éditeur de couleurs du
  chantier 9 perdait son réglage dans un champ prévu pour lui depuis un an.

### Trois décisions

**La palette du catalogue est enregistrée par IDENTIFIANT**, pas par ses huit
couleurs. Figer les valeurs dans chaque projet interdirait au catalogue
d'évoluer : une correction de contraste comme celle de `lime-violet` au chantier
9 ne rattraperait aucun projet existant. Une palette éditée à la main, elle, n'a
pas d'identifiant et part couleur par couleur — et `PaletteOverride` ayant tous
ses champs optionnels, une surcharge PARTIELLE est complétée depuis le preset
actif au chargement, ce qui est la définition d'une surcharge.

**La pochette est stockée en octets D'ORIGINE**, pas ré-encodée depuis
l'`ImageBitmap`. Ré-encoder aurait deux défauts : une seconde compression avec
perte à chaque sauvegarde d'un JPEG, et la disparition de la transparence si
l'on écrit en JPEG. `importCover` rend donc désormais aussi son `Blob` source —
une référence, pas une copie décodée.

**Elle est écrite dans les DEUX contenants.** IndexedDB pour la reprise
automatique, entrée `cover/<nom>` du `.pvproj` pour le partage. En oublier un
donnerait un projet qui rouvre avec sa pochette chez soi et sans elle chez le
destinataire — et le nom, lui, serait bien dans `project.json` : une pochette
annoncée et absente, pire qu'une absence franche. Un test lit `App.ts` pour
vérifier les deux.

Le nom seul va dans `project.json`, jamais les octets : une image en base64 le
ferait grossir de 33 % du poids du fichier, alors que `docs/13` exige qu'il reste
petit — c'est déjà la raison pour laquelle le PMDI en a été sorti.

### La règle qui gouverne la restauration

**Une valeur absente, inconnue ou illisible remet le réglage à zéro ; elle ne
fait jamais échouer l'ouverture.** Un projet écrit par une version future doit
s'ouvrir, quitte à perdre ce que celle-ci ne comprend pas.

`validateProject` vérifie donc la FORME et pas les valeurs : `ProjectText` a des
champs `string` et non des unions littérales, et une animation
`kaleidoscope-2029` passe la validation avant d'être ramenée au défaut par
`normaliseTextConfig` au moment de l'application. Rejeter le projet entier pour
un champ inconnu ferait perdre tout le reste du fichier. Une pochette illisible
se dit dans le panneau — « Pochette du projet illisible — réimporte-la » — et
n'interrompt rien.

### Le piège des contrôles muets

Restaurer `textConfig` ne suffit pas : sans réécrire les huit champs du panneau,
le texte réapparaîtrait à l'écran pendant que les contrôles afficheraient les
valeurs par défaut — et **la première interaction avec l'un d'eux écraserait tout
le reste** par ce qu'affichent les autres, puisque `readTextControls` relit les
huit d'un coup. D'où `writeTextControls`, l'inverse exact, appelé à la
restauration. Un test vérifie qu'il est bien appelé juste après.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 115 fichiers, 1060 tests (1045 -> 1060, +15)
npm run test:arch   -> 1 test
npm run build       -> 510,27 kB (gzip 145,10 kB), 2,11 s
```

Navigateur, **aucune erreur console** sur l'ensemble de la séquence ci-dessous.

**Aller-retour complet par IndexedDB.** Réglé : texte « MEL VEL / BASE » sur deux
lignes, mise en page `lower-third`, animation `slice`, police `mono`, casse
`lower`, taille 1,35, palette `lime-violet`, pochette synthétique importée
(disque `#00ff88` sur fond sombre ; accent extrait `#00ff88`, contraste 14,7:1).
Autosave, **rechargement complet de la page**, réouverture depuis « Projets » :

| champ | avant | après rechargement |
|---|---|---|
| texte | `MEL VEL\nBASE` | `MEL VEL\nBASE` |
| mise en page | `lower-third` | `lower-third` |
| animation | `slice` | `slice` |
| police / casse | `mono` / `lower` | `mono` / `lower` |
| taille | 1,35 | 1,35 |
| palette | `lime-violet` (`#81c042`) | `lime-violet` (`#81c042`) |
| pochette | `album-test.png` | `album-test.png — restaurée` |

**Et elle est réellement DESSINÉE**, pas seulement annoncée — pixels vert vif du
disque de la pochette :

| | pixels verts |
|---|---|
| avec la pochette restaurée | **3 260** |
| après « Retirer » | 47 |

**Aller-retour par `.pvproj`.** Archive de 35 654 octets capturée à
l'enregistrement, tout remis à zéro (texte vidé, palette réinitialisée, pochette
retirée — vérifié), puis réimportée : texte, mise en page, animation, taille,
palette `ember` et pochette reviennent tous.

**Compatibilité arrière.** Un projet enregistré AVANT ce lot, sans aucun des
trois champs, s'ouvre normalement et remet les trois à zéro — texte vide, palette
du preset (`#7b4cff`), aucune pochette. Aucune erreur.

### À valider par Aaron

- **Le comportement à l'import d'une pochette** : elle efface l'édition de
  couleurs en cours (règle posée au chantier 9). Vu depuis la persistance, ça
  veut dire qu'on ne peut pas enregistrer « pochette + couleurs à moi » en
  important la pochette EN DERNIER. Il faut importer, puis régler. C'est
  cohérent mais pas évident.
- **Le poids des projets.** Une pochette de 4 Mo est stockée deux fois pour un
  même projet — une dans IndexedDB, une dans chaque `.pvproj` exporté. Le cache
  audio a un plafond LRU de 500 Mo ; le magasin `projects`, lui, n'en a aucun.
- **La reprise automatique au démarrage** : PULSAR ne rouvre pas le dernier
  projet tout seul, il faut passer par « Projets ». Inchangé par ce lot, mais
  c'est maintenant que ça se remarque, puisqu'il y a quelque chose à reprendre.

### Limites connues

- **La palette extraite d'une pochette n'est pas stockée** — elle est recalculée
  depuis l'image au chargement. C'est délibéré : l'extraction est déterministe,
  et la stocker créerait deux sources de vérité qui divergeraient à la première
  correction de l'algorithme. Conséquence assumée : si `quantize` change, les
  projets existants changent de couleurs.
- **`prefs.debugOverlay` est toujours écrit `false` et jamais lu**, comme avant
  ce lot. Ce n'est pas un champ de ce lot, mais c'est le dernier résidu du même
  genre que ceux traités en §5.6.
- **Aucun plafond sur le magasin `projects`.** Voir ci-dessus.
- Aucune capture d'écran : mêmes limites d'environnement.

---

## Phase 2 — Chantier 10, lot C : éditeur de réaction, compositeur, « Looks »

§7.11 et §7.7. Trois pièces liées : §7.7 décrit le Look comme « le prolongement
naturel du compositeur de couches », et le compositeur n'a de sens qu'une fois
le câblage éditable.

### Éditeur de réaction (§7.11)

« Le bloc `mapping` est la chose la plus puissante du format de preset, et il
n'est éditable qu'en JSON brut. » Il l'était encore : le seul accès passait par
un `<textarea>` de JSON validé par schéma. Autant dire par personne.

**Une ligne par SIGNAL, pas par instrument.** La maquette de §7.11 met
l'instrument à gauche (« Caisse claire → révélation »). Le modèle de PULSAR est
l'inverse : la clé est le signal, l'instrument n'est qu'une de ses propriétés
(`impact: { from: ['KICK'] }`). Suivre la maquette littéralement aurait demandé
d'inverser la table à l'affichage puis de la réinverser à l'écriture, avec une
question sans réponse chaque fois qu'un instrument alimente deux signaux — ou
aucun. La ligne est donc le signal et l'instrument un menu SUR la ligne : la
lecture « le kick pilote la frappe, à telle force, avec tel retour » y est la
même, et l'écriture ne peut pas produire d'état impossible.

**Quatre familles, quatre jeux de contrôles**, déduits de la forme de `from`
comme le fait `MappingSchema` — impulsion, continu, anticipation, LFO.
**L'éditeur ne change pas de famille** : on recâble `impact` du kick vers le
snare, on ne le transforme pas en LFO. La famille est une propriété du MOTEUR
(`BehaviourEngine` construit un `Impulse` ou une `Continuous` selon elle), et la
permuter donnerait un signal syntaxiquement valide et visuellement absurde.

**Un menu de combinaisons plutôt que sept cases par ligne** : à cinq lignes
d'impulsion, les cases feraient trente-cinq contrôles dans une colonne de 340 px.
La liste couvre tous les câblages des onze presets du chantier 9, et une valeur
du preset absente de la liste y est AJOUTÉE plutôt qu'écrasée en silence.

**`userMappingOverrides` existait et n'était utilisé par personne.**
`resolvePreset` lui réserve depuis docs/08 la place du dernier étage —
« surcharges utilisateur, stockées comme un diff ». C'est exactement ce que
l'éditeur produit.

**Les quatre LFO n'étaient typés nulle part.** Les onze presets du chantier 9
les déclarent tous, et `PresetMapping` valait `Partial<Record<SignalName, …>>`
sans `lfoA`..`lfoD`. Ça passait parce qu'un JSON importé n'affronte le type que
par le `as` de `validatePreset`. `LFO_NAMES` les nomme enfin — séparés de
`SIGNAL_NAMES`, un LFO n'ayant ni instrument ni gain.

### Compositeur de couches (§7.7)

« Activer, désactiver et réordonner les couches d'un style. » Trois verbes dont
un est un piège, et §7.7 le dit :

> **l'ordre des couches n'est pas cosmétique** : `ScreenShake` doit être dessinée
> en premier parce que son décalage n'affecte que ce qui vient après, et
> `drawFeedback` aussi. L'éditeur doit empêcher les ordres invalides, ou au
> minimum les signaler.

Il les EMPÊCHE, par un drapeau `mustDrawFirst` sur la couche — pas par une liste
d'identifiants recopiée dans le compositeur, qui aurait silencieusement raté la
prochaine couche de ce genre. Deux couches le portent aujourd'hui.

Une composition qui descend une couche verrouillée n'est pas refusée, elle est
**corrigée** : refuser obligerait l'utilisateur à comprendre une contrainte de
pipeline pour déplacer un curseur. Et l'interface le dit **avant** : la ligne
porte un cadenas, ses flèches sont désactivées, et — détail trouvé en cliquant —
**la flèche « monter » de la première couche libre l'est aussi**. Sans ça, le
clic échangeait les deux et `composeLayers` remettait aussitôt la verrouillée en
tête : le bouton ne faisait rien, ce qui se lit comme un bouton cassé.

Deux autres décisions :

- **`usesFeedback` suit la couche de traînée.** Désactiver `frameFeedback` sans
  ça laisserait `Scene.draw` capturer le composite à chaque image — un
  `drawImage` plein écran pour un buffer que plus personne ne lit.
- **Composition D'ABORD, habillages ENSUITE.** La pochette et le texte ne sont
  pas des couches du style ; les faire passer par le compositeur permettrait de
  les désactiver depuis deux endroits ou, pire, de les glisser sous le décor.

### « Looks » (§7.7)

Style + macros + palette + texte + câblage (assignations de LFO comprises : ce
sont quatre lignes du `mapping`) + composition des couches. La liste de §7.7 est
couverte à deux exceptions près, toutes deux délibérées :

- **La variante de cadrage et les modes de fusion n'y sont pas**, parce qu'ils ne
  sont pas des réglages : `variantFor(styleId, projectSeed)` les DÉRIVE de la
  graine (§7.10). Les figer reviendrait à figer la graine, donc à casser
  « Nouvelle variante » — le bouton le moins cher et le plus rentable du projet
  (§7.9). Appliquer un Look garde la graine courante et laisse la variante
  suivre.
- **La pochette n'y est pas** : c'est l'image d'un morceau, pas une identité
  réutilisable.

Rangés dans le magasin `settings`, dont la signature est déjà
`[key: string]: unknown` — donc **aucune montée de `DB_VERSION`**, pour la raison
écrite au lot B. Un Look est une préférence d'APPLICATION : il survit au projet
et s'applique à n'importe quel autre, ce qui est tout son intérêt.

Une entrée abîmée est ignorée sans faire disparaître la liste, un nom déjà pris
écrase, et le plus ancien saute à 24.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 116 fichiers, 1080 tests (1060 -> 1080, +20)
npm run test:arch   -> 1 test
npm run build       -> 520,78 kB (gzip 148,56 kB), 2,22 s
```

Navigateur, onglet neuf, **aucune erreur console**.

**Éditeur de réaction — le câblage atteint l'image.** Pic de pixels clairs sur
deux secondes de lecture, style `pulse` :

| gain de la frappe | pixels clairs (pic) |
|---|---|
| 0,8 (preset + macros) | 21 885 |
| **0** | **4 064** |
| après « Revenir au câblage du preset » | gain revenu à 0,8, marque effacée |

**Compositeur.** Style `pulse`, cinq couches, `screenShake` verrouillée :

| | pixels clairs |
|---|---|
| halo central actif | 9 619 |
| halo désactivé | **2 891** |

La couche retirée reste dans la liste, grisée et décochée, donc rallumable. Les
flèches de la ligne verrouillée sont désactivées, et celle de la première ligne
libre aussi (`[true, false]`).

**« Looks », aller-retour complet.** Composé : style `aurore`, palette `glacier`,
texte « LOOK TEST », couche `auroraRibbons` retirée. Enregistré sous « nuit
froide ». Tout remis à zéro — style `monolith`, aucune palette, aucun texte,
toutes les couches. Réappliqué : **les quatre reviennent**, couche retirée
comprise. Et après un **rechargement complet de la page**, le look est toujours
dans la liste et s'applique de la même façon.

### Un creux qui n'est PAS de ce lot

En vérifiant le compositeur, j'ai constaté que rallumer une couche ne ramenait
pas l'image : 2 828 pixels clairs au lieu de 9 619. Test de contrôle, sans
toucher au compositeur — changer de style **en pause** :

| | pixels clairs |
|---|---|
| départ | 2 828 |
| après changement de style | **0** |
| retour au style d'origine | 2 828 |
| après deux secondes de lecture | 10 858 |

**Toute reconstruction de scène en pause laisse les couches à leur état initial
jusqu'à la reprise de la lecture** — les signaux ne se recalculent que dans
`update()`. C'est antérieur à ce lot et vaut déjà pour le sélecteur de style ;
le compositeur ne fait que le rendre plus visible, puisqu'on y touche plus
souvent. Non corrigé ici : amorcer la scène demanderait un `update` de plus hors
de la boucle, donc d'avancer les enveloppes du `BehaviourEngine` sans que le
temps avance — un accroc à la Loi 1 que je ne veux pas poser en fin de lot.

### À valider par Aaron

- **Le vocabulaire de l'éditeur de réaction.** « Frappe », « Grave », « Accent »,
  « Scintillement », « Poids », « Brillance »... c'est une traduction des noms de
  signaux, pas une nomenclature établie. Si un nom ne parle pas, il se change en
  une ligne.
- **« Retour » est en SECONDES**, pas en temps. La maquette de §7.11 écrit
  « 0,35 temps », mais `Impulse` travaille en demi-vie de secondes, sans jamais
  voir le tempo — et c'est ce qui rend le câblage indépendant du morceau.
  Afficher des temps demanderait une conversion que le moteur ne fait pas.
- **Les noms de couches** du compositeur : « Masse », « Éclats », « Rubans »,
  « Maille isométrique ». Même remarque.
- **Ce qu'un Look devrait contenir.** J'en ai exclu la graine et la pochette avec
  des raisons, mais c'est un choix de produit.

### Limites connues

- **Le compositeur ne propose pas d'AJOUTER une couche** d'un autre style. §7.7
  dit « activer, désactiver et réordonner » ; mélanger les couches de deux
  styles demanderait que chaque couche sache s'initialiser hors de sa fabrique,
  ce qu'aucune ne garantit aujourd'hui.
- **Aucun aperçu au survol d'un Look** : il faut l'appliquer pour le voir.
- **Le nom d'un Look passe par `window.prompt`.** §10.1 interdit toute
  dépendance, et une boîte de dialogue maison pour saisir une ligne serait trois
  fois plus de code que ce qu'elle remplace.
- **La reconstruction de scène en pause** — voir ci-dessus, antérieur au lot.
- Aucune capture d'écran : mêmes limites d'environnement.

---

## Phase 2 — Chantier 10, lot D : automatisation par images-clés

§7.3 : « Aujourd'hui tout est automatique : l'utilisateur subit l'analyse. Il ne
peut pas dire "à 1:20, monte le glow" ni "ici, coupe tout". »

### Le module fait quatre-vingts lignes, et c'est le sujet

§7.3 le dit avant moi : « `render(t)` est déjà une fonction pure de `t` (Loi 1).
Une courbe d'automatisation EST littéralement `f(t)`. » Il n'y a donc dans
`core/automation/` qu'une recherche dichotomique et une interpolation linéaire —
aucun état de lecture, aucune position courante, rien à réinitialiser sur un
seek. Dans un monteur vidéo, la même fonction demanderait tout cela. Un test
vérifie explicitement la pureté : mêmes entrées, même sortie, quel que soit
l'ordre des appels.

Deux choix de comportement, tous deux écrits dans le module :

- **Tenue aux extrémités, pas d'extrapolation.** Prolonger la pente donnerait des
  valeurs hors bornes en fin de morceau, sur une automatisation dont
  l'utilisateur n'a rien demandé au-delà de ce qu'il a posé.
- **Deux points au même instant font une MARCHE.** C'est le seul comportement qui
  ne divise pas par zéro, et il est utile : « ici, coupe tout » de §7.3 est
  exactement une marche.

**Cible en chaîne libre**, comme `EventType` et `FeatureId`. Les noms de macros
vivent dans `presets/`, que ni `core/` ni `behaviour/` n'ont le droit
d'importer — la table des douze cibles est donc construite dans `ui/`, seule
couche qui connaît à la fois les macros et la caméra.

### Trois points d'application, trois cadences

§7.3 : « à appliquer APRÈS le preset et les macros, comme dernier étage — même
position que les surcharges utilisateur de `resolve.ts` ». Les trois familles de
cibles n'ont pas le même coût, et c'est ce qui décide de leur cadence :

- **L'intensité globale** multiplie `amplitude` et `level` du budget de
  dramaturgie, à chaque SOUS-PAS (120 Hz). Multiplier le budget plutôt que les
  signaux un par un évite de dupliquer la table de `modulate` — avec la
  certitude qu'une des deux copies oublierait un signal au prochain ajout.
- **La caméra** s'ajoute au bout de la chaîne existante, une fois par IMAGE : la
  variante dit d'où on regarde, la dramaturgie ce que le morceau fait au cadre,
  l'automatisation ce que l'utilisateur a décidé à cet instant. Elle est la
  dernière parce qu'elle est la plus explicite des trois.
- **Les huit macros** sont revues une fois par image, et seulement si la valeur a
  bougé de plus de `MACRO_EPSILON`. `applyLayerMacrosToScene` remplace
  `layer.params` en entier : une allocation par couche, que les 120 Hz de la
  simulation transformeraient en exactement ce que docs/10 proscrit.

L'objet passé au moteur est MUTÉ en place et non recréé, et l'absence
d'automatisation court-circuite tout : un projet sans image-clé rend exactement
la même image qu'avant ce lot, ligne pour ligne. Un test fige les valeurs
neutres — 1 et 0 — pour que ça reste vrai.

### Le défaut que seule la vérification a montré

Les trois pistes de caméra étaient INERTES. La frise ne produit que des valeurs
de 0 à 1, or `applyCamera` borne le zoom à [1, 2] : une piste de zoom brute
valait donc toujours moins de 1, c'est-à-dire toujours écrêtée à la neutralité.
Et `cameraX` ne pouvait décaler que dans un sens, le neutre n'étant atteignable
qu'à la valeur 0, en bas du cadre.

Trois options de plus qui ne changent rien — exactement ce que cette phase est
censée éliminer. Les pistes sont désormais ÉTALÉES à la lecture, avec un neutre
atteignable et intuitif : milieu de la frise pour un décalage nul, bas de la
frise pour aucun zoom. Les libellés le disent.

### L'édition tient sur la frise

Pas de piste séparée sous la timeline : la frise EST l'axe des temps, et une
seconde bande n'aurait fait que doubler la hauteur d'un panneau déjà chargé.
Groupe « Automatisation » ouvert, la frise passe en mode édition — un voile
sombre, la courbe, ses points — et le clic pose une image-clé au lieu de
déplacer la tête de lecture. Sans cette bascule il faudrait viser une bande de
quelques pixels pour éditer, et chercher où cliquer pour naviguer.

Le clic droit retire, et le menu contextuel du navigateur est neutralisé pour ne
pas le voler. Poser et retirer par le même geste modifié plutôt que par un mode
à basculer, qu'il faudrait ensuite penser à quitter.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 117 fichiers, 1099 tests (1080 -> 1099, +19)
npm run test:arch   -> 1 test
npm run build       -> 526,58 kB (gzip 150,53 kB), 2,14 s
```

Navigateur, onglet neuf, **aucune erreur console**. Douze cibles proposées :
l'intensité globale, les trois paramètres de caméra et les huit macros — la
liste de §7.3, mot pour mot.

**L'intensité atteint l'image.** Luminance moyenne du cadre sur une fenêtre de
quatre secondes de lecture :

| piste d'intensité | moyenne | pic |
|---|---|---|
| 0,1 sur tout le morceau | 12,49 | 12,71 |
| **1,0** | **19,73** | **23,88** |

**Une macro automatisée aussi**, avec la valeur résolue lue au passage :

| piste `macro:glow` | moyenne | pic | macro vue par le moteur |
|---|---|---|---|
| 0 | 13,24 | 13,59 | 0,00 |
| **1** | **14,98** | **16,12** | **1,00** |

**Les pistes de caméra, après correction de l'étalement :**

| geste | valeur résolue |
|---|---|
| zoom, haut de la frise | **1,80** |
| zoom, bas de la frise | 1,00 (neutre) |
| horizontale, milieu | 0,00 (centré) |
| horizontale, haut | **+0,30** |

**Édition et persistance.** Deux pistes posées — trois images-clés sur
l'intensité, deux sur `macro:glow` —, sauvegarde automatique, **rechargement
complet de la page**, réouverture depuis « Projets » : les deux pistes reviennent
avec le bon nombre de points, et le moteur lit bien `intensity = 0,80` et
`glow = 0,90` à `t = 1,04 s`. Une piste jamais posée le dit sans se confondre
avec les autres : « Aucune image-clé sur cette piste — 2 autre(s) piste(s)
automatisée(s). »

Un compteur d'images-clés qui ne se mettait pas à jour au clic a été corrigé au
passage : `refreshAutomationStatus` manquait dans le gestionnaire de pose.

### À valider par Aaron

- **Les amplitudes de caméra** : ±0,3 de décalage et 1,8 de zoom maximal. Ce sont
  les seules valeurs vraiment arbitraires du lot.
- **L'interpolation est LINÉAIRE.** Une courbe en S serait plus douce sur une
  montée lente ; la ligne droite est plus lisible et prévisible. À voir sur un
  vrai morceau lequel des deux manque le plus.
- **Le geste d'édition** : le groupe ouvert change ce que fait un clic sur la
  frise. C'est cohérent, mais ça se découvre.
- **L'intensité automatisée multiplie la dramaturgie**, elle ne la remplace pas :
  poser 1 partout ne « désactive » pas le `VisualDirector`, ça le laisse faire.
  C'est voulu — mais si Aaron attend un contrôle absolu, c'est là qu'il faut
  changer.

### Limites connues

- **Aucun déplacement de point.** On pose et on retire ; corriger un point se
  fait en recliquant à côté, ce qui le remplace. Un glisser demanderait une
  gestion du pointeur que la frise ne fait pas aujourd'hui.
- **Les courbes ne sont pas dans les « Looks ».** Une automatisation est liée à
  un morceau — les instants n'ont aucun sens sur un autre.
- **`MACRO_EPSILON` vaut 0,01** : une transition de macro très lente peut se voir
  par paliers. Assez fin en pratique, mais c'est un compromis, pas une garantie.
- **La reconstruction de scène en pause** (voir lot C) rend une automatisation
  invisible tant qu'on n'a pas relancé la lecture.
- Aucune capture d'écran : mêmes limites d'environnement.

---

## Phase 2 — Chantier 10, lot E : marqueurs, corrections, options d'export

§7.8 et §7.12. Dernier lot du chantier 10, donc **dernier lot de la phase 2**.

### Corriger l'analyse (§7.8)

« L'analyse se trompera parfois : un downbeat décalé, un drop manqué, une
section mal découpée. Aujourd'hui l'utilisateur n'a aucun recours. [...] Loi 3
le rend d'autant plus utile : les morceaux à faible confiance sont exactement
ceux qu'il faut pouvoir rattraper. »

**Une transformation du DOCUMENT, pas un étage de plus.** Les corrections
produisent un `PmdiDocument` corrigé, que `buildMusicTimeline` consomme comme
n'importe quel autre. Rien en aval ne sait qu'une correction existe : ni la
timeline, ni les signaux, ni les couches, ni l'export. C'était la seule façon
d'éviter un « et si c'est corrigé ? » à chaque lecture de la grille — et c'est
aussi ce qui garantit que l'aperçu et la vidéo voient exactement le même morceau,
sans qu'aucun test de plus n'ait à le surveiller.

Les trois corrections de §7.8, et ce que chacune touche :

- **Décalage de grille** : décale les cartes de tempo et de mesure, **jamais les
  événements**. Quand la grille est fausse, ce sont les temps qui tombent à côté ;
  les onsets viennent du signal audio et sont, eux, à leur place. Un test vérifie
  que `beatPhaseAt(t + 0,25)` sur la grille décalée vaut `beatPhaseAt(t)` sur
  l'originale — le décalage est celui demandé, pas un à-peu-près.
- **Drop marqué à la main** : un `MusicEvent` de type `DROP` ordinaire, avec
  `confidence: 1` — c'est un humain qui l'a posé, il n'y a rien de plus certain
  dans le document. `anticipate:DROP` le trouve sans rien savoir de son origine,
  donc `tension` monte devant lui exactement comme devant un drop détecté :
  **aucun code de signal à toucher.** Un test l'a d'ailleurs corrigé en cours de
  route — la démo porte déjà des DROP détectés, et le drop manuel s'y mêle sans
  qu'on puisse les distinguer. C'est précisément le but.
- **Frontière de section déplacée**, par index. Les sections sont **retriées**
  après coup : déplacer une frontière peut la faire passer devant la précédente,
  et tout ce qui lit `sections()` suppose l'ordre chronologique.

**Le document BRUT est conservé à part du corrigé.** On ne peut pas retirer un
décalage de grille d'un document auquel on l'a déjà appliqué sans accumuler les
arrondis, et « annuler toutes les corrections » doit rendre exactement le
document d'origine.

Le curseur de grille agit sur `change` et non sur `input` : chaque pas
reconstruit la timeline entière, la scène et la frise. À chaque pixel de course,
il serait inutilisable.

Rangées dans `music` et non dans `visual` : elles corrigent la LECTURE du
morceau, pas son habillage. Conséquence voulue — **un « Look » ne les emporte
pas**, les instants n'auraient aucun sens sur un autre morceau.

### Les deux options d'export (§7.12)

**Image fixe.** « Presque gratuit, la chaîne existe déjà. » C'est vrai, à une
condition qui ne l'est pas : la scène doit être **simulée** jusqu'à l'instant
courant avant d'être dessinée. Un `scene.draw` sur une scène fraîche rendrait un
cadre vide — pools de particules à zéro, feedback noir. Deux secondes de pré-roll,
le même remède qu'aux vignettes du lot A.

Au passage, `getStyleFactory` a été extraite en `buildExportScene` : l'image fixe
a besoin exactement de la même scène que la vidéo, et deux fabriques auraient
divergé jusqu'à ce que l'image ne ressemble plus au film du même projet.

**Export en boucle.** §7.12 demandait de le documenter honnêtement s'il n'était
pas tenable partout. Il ne l'est pas, et voici la formulation exacte :

> Ce que ça fait : la scène est SIMULÉE sur les deux dernières secondes du
> morceau avant que la première image ne soit dessinée. Les couches à état —
> pools de particules, traînée de feedback — démarrent donc dans l'état où elles
> finissent, et la couture ne se voit plus.
>
> Ce que ça ne fait PAS : rendre la dernière image identique à la première. Elle
> ne peut pas l'être — les signaux viennent de la musique, et la musique de la
> dernière seconde n'est pas celle de la première. La boucle est visuellement
> continue, pas mathématiquement fermée.

La case à cocher le dit dans les mêmes termes, en une ligne.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 118 fichiers, 1118 tests (1099 -> 1118, +19)
npm run test:arch   -> 1 test
npm run build       -> 531,23 kB (gzip 152,06 kB), 2,12 s
```

Navigateur, onglet neuf, **aucune erreur console**.

**Les trois corrections, et leur annulation :**

| geste | état rapporté |
|---|---|
| décalage de grille | `grille 180 ms` |
| marquer un drop | `grille 180 ms · 1 drop(s) marqué(s)` |
| déplacer la frontière B | `... · 1 frontière(s) déplacée(s)`, section B passée de 0:18 à 0:00 |
| tout annuler | `Analyse non corrigée.`, sections revenues à 0:00 / 0:18 / 0:42, décalage 0 ms |

**Persistance** : `grille -120 ms · 1 drop(s) marqué(s)`, sauvegarde automatique,
**rechargement complet de la page**, réouverture — les deux reviennent, curseur
compris.

**Image fixe** : PNG **1920×1080, 1 037 Ko**, redécodé et mesuré — **57 261
pixels clairs**, luminance moyenne 14,39. Une vraie image, pas un cadre noir.
Refaite après restauration d'un projet : 1 124 Ko, même chaîne.

### Ce que le lot E clôt

Les sept groupes du panneau sont en place — Visuel, Couleurs, Texte, Réactivité,
Automatisation, Analyse, Export — et les cinq lots du chantier 10 sont livrés.
Avec eux, **la phase 2 est terminée** : dix chantiers, de l'ouverture du verrou
MVP à la correction manuelle de l'analyse.

### À valider par Aaron

- **La plage du décalage de grille** : ±500 ms, par pas de 5 ms. Assez pour un
  demi-temps à 60 BPM ; au-delà, c'est l'analyse qu'il faut refaire.
- **La tolérance de « retirer le drop le plus proche »** : 400 ms. Trop large, on
  retire le mauvais ; trop étroite, le bouton semble ne rien faire.
- **Déplacer une frontière déplace le DÉBUT d'une section**, donc allonge ou
  raccourcit celle d'avant. C'est la seule lecture possible sans inventer une
  poignée de fin, mais ça se découvre.
- **L'export en boucle sur un vrai morceau.** C'est l'option la plus difficile à
  juger sans regarder : la couture est-elle vraiment invisible, ou voit-on le
  saut musical ?

### Limites connues

- **Aucune poignée sur la frise pour les sections** : on choisit dans une liste
  et on déplace à la tête de lecture. Un glisser aurait été plus direct, mais le
  clic sur la frise sert déjà à l'automatisation depuis le lot D, et empiler un
  troisième sens sur le même geste aurait rendu les trois illisibles.
- **Le décalage de grille ne décale pas la forme d'onde**, qui vient de l'audio :
  c'est correct, mais l'œil peut lire un désaccord entre les traits de mesure et
  les crêtes — c'est justement ce qu'on est en train de corriger.
- **`LOOP_PREROLL_SEC` vaut 2 s** : suffisant pour une traînée dont l'alpha de
  0,88 par image ne laisse plus rien au bout d'une demi-seconde, jamais vérifié
  sur un pool de particules à durée de vie longue.
- Aucune capture d'écran : mêmes limites d'environnement que sur toute la phase.

---

## Phase 2 — Critère 13 : le `FlashLimiter` face aux modes de fusion

§12, critère 13 : « Le `FlashLimiter` ne se déclenche pas en permanence sur les
modes de fusion ajoutés (§7.2). Si un mode le déclenche sans arrêt, il est
retiré de la liste proposée, et c'est écrit dans le journal. »

Reporté **trois fois** — chantiers 5, 7 et 9 — avec chaque fois la même raison :
il fallait des pixels réels, et je n'avais pas de moyen de mesurer. Les lots A
à E ont fourni ce moyen (pilotage pas à pas + lecture du canevas), et
`FlashLimiter.clampedCount` existe depuis le MVP.

### Comment c'est mesuré

Un crochet de développement, `__pulsarDebug.setBlend(mode)`, forçait un mode sur
**toutes** les couches du style — le pire cas, bien au-delà de ce qu'une
variante fait (une ou deux couches). Un second, `__pulsarDebug.clamped`, exposait
le compteur. Puis : lecture, N images pilotées une par une, différence du
compteur. `apply()` ne mesurant qu'une image sur deux, **le taux d'écrêtage
plafonne à 50 %** — c'est la valeur qui signifierait « à chaque image mesurée ».

> **Les deux crochets ont été RETIRÉS après cette mesure** (voir l'entrée
> « Retrait des crochets de debug » plus bas). Le verdict ci-dessous reste vrai ;
> refaire la mesure demanderait de les réintroduire. `clampedCount` reste lisible
> dans le panneau debug de l'appli, ligne « frames clampées ».

**Témoin positif, parce qu'un zéro ne prouve rien tant qu'on n'a pas montré que
le compteur peut bouger.** Bascule du fond blanc/noir d'une image à l'autre, sur
`pulse` :

```
images écrêtées, cumulées : 0, 0, 0, 1, 1, 2, 2, 3, 3, 4
```

Les trois premières transitions passent, les suivantes sont écrêtées : très
exactement le budget de trois par seconde documenté. Le harnais mesure bien
quelque chose.

### Le résultat

Environ vingt séries de 240 à 300 images, couvrant les six modes, six styles,
les deux seuils (0,45 normal et 0,18 en réduction des flashs) et plusieurs
graines :

| | taux d'écrêtage |
|---|---|
| `pulse`, seuil normal, les 6 modes + variante | **0 %** partout |
| `eclats`, seuil RÉDUIT, `normal` / `additive` / `screen` / `multiply` / `overlay` | **0 %** |
| `difference`, seuil réduit, sur `spectrum-pro`, `iso-pulse`, `field`, `monolith` | **0 %** |
| `difference`, seuil réduit, sur `eclats`, 6 graines | **0 %** |
| `eclats` avec sa propre variante, seuil réduit, 3 graines | **0 %** |

**Aucun mode n'est retiré.** Les six restent proposés, `difference` compris —
celui que `Renderer.ts` soupçonnait depuis le chantier 4 (« peut produire des
sauts de luminance que le `FlashLimiter` écrêterait en permanence »). Le
soupçon n'est pas confirmé.

### Une observation isolée que je n'ai pas su reproduire

Le tout premier relevé sur `eclats` + `difference` + seuil réduit a donné
**150 images écrêtées sur 300, soit 50 % — le maximum possible**. Et dans la
même série, `eclats` avec sa propre variante a donné 7 % (21 sur 300).

**Quatorze séries ultérieures, dans les mêmes conditions apparentes, ont toutes
donné 0 %** — six graines différentes, avec et sans rechargement du morceau,
avec et sans le témoin positif juste avant.

Hypothèse examinée puis **réfutée** : un verrouillage du limiteur.
`previousLuminance` serait resté bloqué à une valeur extrême laissée par le
témoin positif exécuté juste avant, écrêtant ensuite chaque image. C'est faux, et
c'est mesuré : après une salve forcée qui écrête 5 images, le retour au calme
donne **0 image écrêtée sur les 240 suivantes**. La fenêtre glisse en temps
musical, le budget se reconstitue, la scène retrouve sa luminance en une
transition. Un test unitaire inscrit ce comportement (`flashLimiter.test.ts`,
« NE RESTE PAS bloqué ») pour qu'une régression le fasse échouer plutôt que de
ressortir en observation isolée.

Ce que je ne sais pas dire : d'où venaient ces deux relevés. Ils sont écrits ici
tels quels plutôt que passés sous silence — un 50 % isolé n'est pas une preuve,
mais ce n'est pas rien non plus.

### À valider par Aaron

- **`difference` à l'œil, en réduction des flashs.** La mesure dit que le
  limiteur ne s'en mêle pas ; elle ne dit pas que c'est agréable à regarder.
  Aucune variante ne l'utilise aujourd'hui — c'est le chantier 4 qui s'en était
  abstenu par précaution, et rien n'oblige à revenir dessus.
- **Le seuil de la réduction des flashs** (0,18) n'a jamais été confronté à un
  morceau qui stroboscope vraiment. La démo synthétique ne suffit pas pour ça.

### Limites connues

- **Mesures sur la piste de démonstration**, jamais sur un vrai morceau à
  breaks rapides — précisément le cas que le chantier 6 redoutait pour `eclats`.
- Le crochet `setBlend` force le mode sur toutes les couches ; c'est plus dur que
  la réalité, donc conservateur, mais ce n'est pas la configuration qu'un
  utilisateur rencontre.
- **L'observation à 50 % reste inexpliquée.**

---

## Phase 2 — Correctif : le creux en pause

Défaut trouvé au chantier 10 lot C, écarté alors avec sa raison, corrigé ici sur
mandat d'Aaron.

### Le défaut

Une scène qui vient d'être construite est VIDE : pools de particules à zéro,
traînée noire, enveloppes au repos. Ses couches ne se remplissent que dans
`update()`, appelé uniquement quand le transport joue. **Changer de style, de
couche ou de palette pendant une pause laissait donc l'aperçu noir jusqu'à ce
qu'on relance la lecture.**

Mesuré au lot C, style `pulse`, en pause :

| | pixels clairs |
|---|---|
| départ | 2 828 |
| après changement de style | **0** |
| retour au style d'origine | 2 828 |
| après deux secondes de lecture | 10 858 |

Le défaut est ANTÉRIEUR à la phase 2 — il valait déjà pour le sélecteur de
style. Mais le compositeur de couches et l'automatisation du chantier 10 le
rendent visible en permanence : on y touche cent fois plus souvent qu'on ne
change de style.

### Pourquoi il avait été écarté

Amorcer la scène demande de la SIMULER, et simuler demande un `BehaviourEngine`.
Or celui-ci est stateful : ses enveloppes avancent de `step.dt` à chaque
`update`. Amorcer avec le moteur VIVANT ferait donc avancer ses enveloppes sans
que le temps avance — un accroc à la Loi 1 que je ne voulais pas poser en fin de
lot.

### Ce qui lève l'objection

Des moteurs JETABLES. `primeScene` construit un `StepContextBuilder`, un
`BehaviourEngine` et un `VisualDirector` neufs, rejoue les deux dernières
secondes sur la scène, puis les abandonne. Le moteur vivant n'est pas touché, et
comme les deux partent de la même graine et de la même table de câblage, ils
s'accordent à l'instant courant. **La Loi 1 tient : l'état amorcé est une
fonction pure de l'instant et de la graine**, et deux tests l'inscrivent — le
premier compare deux moteurs menés à l'identique avec l'amorçage intercalé sur
un seul, le second vérifie que deux amorçages identiques donnent le même dessin.

Ce n'était pas une invention : c'est déjà le remède des vignettes de style
(§10.1) et de l'export d'image fixe (§7.12). Troisième usage, donc extrait dans
`visual/scene/dramaFrame.ts` — un seul endroit à corriger désormais.

### Trois conditions, et chacune évite un coût

- **Seulement à l'arrêt.** En lecture, l'image suivante remplit la scène toute
  seule ; amorcer par-dessus serait deux fois le même travail.
- **Seulement si la scène a été RECONSTRUITE.** `applyActiveConfiguration` se
  déclenche à chaque pixel de course d'un curseur de macro. Rejouer deux
  secondes à chacun figerait l'interface.
- **Seulement s'il y a un morceau.** Sans timeline, il n'y a rien à rejouer.

### Un piège évité de justesse

`primeScene` RETOURNE son `VisualDirector`. En câblant l'export d'image fixe
dessus, j'avais d'abord construit un director neuf pour ouvrir l'image — et
`openFrameWithCamera` lit `director.budget`. Un director neuf a un budget
NEUTRE : l'image fixe aurait perdu toute la dramaturgie que l'aperçu montre au
même instant, sans que rien ne le signale. Le rendre coûte une ligne et supprime
la seule façon de se tromper ici.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 119 fichiers, 1126 tests (1119 -> 1126, +7)
npm run test:arch   -> 1 test
npm run build       -> 531,39 kB (gzip 152,13 kB), 2,10 s
```

Navigateur, onglet neuf, **aucune erreur console**. Le geste exact qui révélait
le défaut, refait en pause à t = 5,18 s :

| geste (en pause) | avant | après |
|---|---|---|
| départ | 2 828 | 12 504 |
| changement de style vers `field` | **0** | **1 314** |
| retour à `pulse` | 2 828 | **12 565** |
| couche « halo » désactivée | — | 9 620 |
| **couche rallumée** | **2 828, perdu** | **12 565, exactement le départ** |

La dernière ligne est celle qui compte : rallumer une couche rend précisément
l'image d'avant.

**Vérifié sur les styles sombres**, où un seuil trop haut m'a d'abord fait lire
des zéros. Au seuil honnête, l'état amorcé est celui de la lecture :

| style | amorcé (pixels non noirs / luminance moyenne) | après 2 s de lecture |
|---|---|---|
| `aurore` | 99 955 / 11,93 | 110 154 / 13,54 |
| `chambre` | 253 638 / 14,01 | **253 638** / 13,56 |
| `field` | 28 916 / 6,24 | 29 224 / 5,75 |

`chambre` est identique au pixel près ; les deux autres sont à 10 % et 1 %.

**Le coût, et les garde-fous qui l'évitent :**

| geste | durée |
|---|---|
| changement de style EN PAUSE (amorçage compris) | 20,2 / 5,5 / 8,0 ms |
| le même EN LECTURE (pas d'amorçage) | 2,3 / 1,8 ms |
| curseur de macro en pause (scène non reconstruite) | 1,5 à 3,2 ms |

Un à-coup unique de 5 à 20 ms au changement de style, et rien du tout partout
ailleurs. Les 20,2 ms sont pour `field` et ses 2 500 particules.

### Limites connues

- **La traînée de feedback n'est PAS amorcée.** `primeScene` simule sans
  dessiner ; une couche à feedback repart donc d'un canevas noir et reconstruit
  sa traînée sur les images suivantes. Délibéré : dessiner demanderait un
  `Renderer` et un `Viewport`, et la boucle d'aperçu redessine de toute façon dès
  l'image suivante — sauf, précisément, en pause, où la traînée met alors une
  demi-seconde de lecture à revenir.
- **Deux secondes d'amorçage** (`PRIME_SECONDS`) : assez pour un pool de
  particules, jamais vérifié sur une couche dont l'état s'accumulerait sur plus
  longtemps. Aucune ne le fait aujourd'hui.
- Aucune capture d'écran : mêmes limites d'environnement que sur toute la phase.

---

## Phase 2 — Recalibrage de `suggest.ts`

Signalé au chantier 9 : la suggestion automatique choisit désormais parmi onze
genres, et sa constante de normalisation datait des cinq du MVP.

### Ce que la mesure a dit, et ce qu'elle a démenti

Harnais : pour chaque preset, un document synthétique dont le tempo, la
dominance de grave et la densité d'onsets valent EXACTEMENT ce qu'il déclare.
Si un preset ne se retrouve pas lui-même, la suggestion est fausse par
construction.

**Résultat : 11 sur 11.** Ma note du chantier 9 laissait entendre que le
calibrage était faux ; sur les profils exacts, il ne l'était pas. C'est écrit ici
parce que la note d'alors était plus alarmante que la réalité.

Le vrai défaut est ailleurs, et il a fallu mesurer un document RÉEL pour le
voir :

> La piste de démonstration — kick à la noire, caisse claire aux temps 2 et 4,
> charley à la croche, 120 BPM — produit **7,55 onsets par seconde**, soit une
> densité normalisée de **0,94** avec l'ancienne référence de 8.

Autrement dit : **le motif le plus banal qui soit saturait le critère.** Au-delà
de 8 onsets/s tout valait 1, et le critère cessait de distinguer quoi que ce
soit — alors que les onze presets déclarent des densités de 0,08 à 0,80,
c'est-à-dire toutes en dessous.

### La référence passe de 8 à 16 onsets/s

Ce que valent les profils déclarés dans les deux échelles :

| preset | densité | avec 8 | **avec 16** |
|---|---|---|---|
| `ambient` | 0,08 | 0,6/s | **1,3/s** |
| `lofi` | 0,25 | 2,0/s | **4,0/s** |
| `trap-dark` | 0,55 | 4,4/s | **8,8/s** |
| `techno` | 0,80 | 6,4/s | **12,8/s** |

Avec 8, `techno` visait 6,4 onsets/s et `lofi` 2 : deux valeurs qu'aucun morceau
du genre ne produit — la démo, qui n'est ni l'un ni l'autre, en produit déjà
7,55. Avec 16, la démo tombe à 0,47, au milieu de l'échelle, et sa suggestion
passe de 0,881 à **0,953** — le critère a recommencé à travailler.

### Deux profils de preset qui se marchaient dessus

Second harnais : 440 morceaux synthétiques tirés autour des profils déclarés
(±0,12 de dominance, ±0,15 de densité, tempo dans la plage), pour voir si un
morceau PLAUSIBLE retrouve son preset.

`phonk` sortait à **13 sur 40**, confondu 17 fois avec `trap-dark`. En regardant
les deux profils, la raison saute aux yeux — et c'est ma faute, ils viennent du
chantier 9 :

| | tempo | doubleTime | sub | densité |
|---|---|---|---|---|
| `trap-dark` | 60–90 | **oui**, donc 120–180 aussi | 0,90 | 0,55 |
| `phonk` (avant) | 130–160 | oui | 0,90 | 0,60 |

Deux presets identiques à 0,05 près, sur une plage de tempo qui se recouvre
entièrement. Corrigé sur ce que la musique dit réellement :

- **`phonk.doubleTimeHint` passe à `false`.** Le phonk se compte DROIT à 130–160 ;
  l'indication de demi-temps est une convention trap/drill, et c'est elle qui
  faisait recouvrir 130–160 avec le 60–90 doublé de `trap-dark`.
- **`phonk.onsetDensity` 0,60 → 0,78** : cloche et charleys rapides, plus dense
  que le trap.
- **`phonk.subDominance` 0,90 → 0,82** : la cloche vit dans les médiums.
- **`dubstep.onsetDensity` 0,45 → 0,32** : sa signature est l'ESPACE, des coups
  énormes et rares. À 0,45 il tombait sur `trap-dark` douze fois sur quarante.

Effet mesuré, sur les mêmes 440 tirages :

| preset | avant | après |
|---|---|---|
| `phonk` | 13/40 | **26/40** |
| `dubstep` | 25/40 | **37/40** |
| `trap-dark` | 31/40 | **38/40** |
| `drill` | 28/40 | 18/40 |
| **total** | 350/440 = 80 % | **366/440 = 83 %** |

### Là où je me suis arrêté, et pourquoi

`drill` recule à 18/40, confondu avec `phonk` et `trap-dark`. J'ai tenté un
second réglage — `phonk.subDominance` à 0,72, `drill.onsetDensity` à 0,62 — qui
a rendu `drill` à 22 mais fait retomber `phonk` à 21, pour un total identique.
J'ai reculé ce réglage.

C'est le moment où l'on cesse de calibrer et où l'on commence à ajuster au
harnais. **`drill`, `phonk` et `trap-dark` sont réellement voisins** : mêmes
130–160 BPM, même grave dominant, même percussion dense. Idem pour `edm`,
`house` et `techno`, tous entre 118 et 140. **Trois scalaires ne les séparent
pas, et aucune valeur de constante n'y changera rien** — ils décrivent la même
musique.

### Ce que j'ai fait à la place : le dire

docs/08 : la suggestion est « un bon point de départ », pas de la classification
de genre. Quand deux presets sont à 0,001 l'un de l'autre, trancher en silence
n'est pas un verdict, c'est un tirage — et jusqu'ici le vainqueur était le
premier du catalogue, ce qui n'est pas une raison.

`SuggestResult` porte désormais un `runnerUp`, renseigné quand le second
candidat est à moins de 0,04 du premier, et le motif affiché le nomme :

```
suggéré d'après l'analyse (tempo 145 BPM, profil grave) — Phonk conviendrait aussi
```

Un utilisateur à qui l'on propose « Drill, ou Phonk » choisit en une seconde ; à
qui l'on impose « Drill » sans rien dire, il ne saura jamais que l'autre
existait. Le panneau affiche déjà `reason`, donc rien à câbler.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 119 fichiers, 1131 tests (1126 -> 1131, +5)
npm run test:arch   -> 1 test
npm run build       -> 531,55 kB (gzip 152,22 kB), 2,17 s
```

Cinq tests ajoutés, tous sur le VRAI catalogue plutôt que sur des presets de
laboratoire : les onze se retrouvent eux-mêmes ; un motif ordinaire ne sature
plus le critère de densité ; le second candidat est nommé quand il est plausible
et tu quand la suggestion est nette ; un catalogue d'un seul preset n'a pas de
second.

**Un test existant a été corrigé, et c'est le montage qui était faux** : il
fabriquait 6,7 onsets/s en les appelant « forte densité ». C'était vrai à
l'échelle de 8, plus à celle de 16. Compte relevé à 900 sur 60 s, soit 15/s —
une vraie forte densité.

### Limite de vérification

**La suggestion n'est pas observable au navigateur ici.** Elle n'est calculée
que sur l'import d'un fichier audio réel : `loadDemo` appelle
`applyImportedDoc(doc, null, …)` et ne la déclenche jamais. Tout ce qui précède
est donc mesuré par harnais, sur des documents synthétiques et sur le document
de démonstration — pas sur un morceau du commerce.

### À valider par Aaron

- **Les 83 %** ne veulent rien dire tant qu'un vrai morceau n'a pas été importé.
  Le seul juge utile : charger un morceau de chaque genre et regarder ce qui est
  proposé.
- **La marge de 0,04** pour nommer un second candidat. Trop large, la mention
  apparaîtra toujours ; trop étroite, jamais.
- **Les profils de `phonk` et `dubstep` ont changé.** Ils ne touchent QUE la
  suggestion — ni le rendu, ni les couleurs, ni le câblage.

### Limites connues

- **`drill` reste le moins bien retrouvé** (18/40), au profit de `phonk` et
  `trap-dark`. Assumé : les séparer demanderait un quatrième critère — la
  syncope, ou la présence de 808 glissantes — que l'analyse ne produit pas.
- **`edm`, `house` et `techno` se confondent** entre eux dans un quart des cas.
  Même raison, et conséquence bénigne : les trois donnent un rendu plausible sur
  la même musique.
- Le harnais de mesure a été archivé dans `_corbeille/` après relevé.

---

## Phase 2 — Retrait des crochets de debug `setBlend` et `clamped`

Sur mandat d'Aaron, après que le critère 13 de §12 a été mesuré et tranché.

### Ce qui est retiré

Deux entrées de `window.__pulsarDebug`, dans `src/ui/App.ts`, toutes deux
introduites à la vérification du critère 13 :

- **`setBlend(mode)`** — forçait un mode de fusion sur TOUTES les couches du
  style, `null` rendant la main à la variante.
- **`clamped`** — accesseur sur `flashLimiter.clampedCount`.

Ils ne servaient qu'à cette mesure. Elle est faite, le verdict est au journal :
zéro écrêtage sur six modes de fusion, six styles, deux seuils.

### Ce qui n'est PAS retiré

- **`FlashLimiter.clampedCount` reste**, et reste affiché dans le panneau debug
  de l'appli, ligne « frames clampées ». C'est la seule fenêtre qu'Aaron a sur
  l'écrêtage en usage normal ; elle date du MVP et n'a rien à voir avec le
  critère 13.
- **`applyLayerBlends` reste** : c'est le chemin NORMAL des modes de fusion,
  appelé à quatre endroits par l'application elle-même. `setBlend` ne faisait que
  l'appeler avec un argument forcé.
- **`step`, `play`, `pause`, `loadDemo`, `t`, `automation` restent.** Aaron n'a
  demandé que ces deux-là, et `step` est l'outil qui rend toute vérification au
  navigateur possible dans cette session — le retirer coûterait cher.

### Le test du critère 13 survit

`tests/unit/flashLimiter.test.ts` ne touchait pas aux crochets : il instancie
`FlashLimiter` directement. Le test « NE RESTE PAS bloqué », écrit pour réfuter
l'hypothèse du verrou, tient donc toujours, crochets ou pas. C'était le but en
l'écrivant : mettre le verdict dans un test plutôt que dans une procédure
manuelle.

### Effet de bord traité

`import type { BlendMode }` devenait inutilisé dans `App.ts` — retiré. C'est le
seul autre changement.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 119 fichiers, 1131 tests
npm run test:arch   -> 1 test
npm run build       -> 531,55 kB (gzip 152,22 kB) — INCHANGÉ au octet près
```

Aucun test ne change de résultat : rien dans la suite ne dépendait des crochets.

**Le bundle ne bouge pas d'un octet, et c'est attendu** : les crochets vivaient
sous `import.meta.env.DEV`, donc déjà élidés en production, et `BlendMode` était
un `import type`, effacé à la compilation. Le retrait allège le SOURCE, pas le
livré. J'avais écrit ici une baisse de 0,11 kB avant de lancer la mesure — elle
était fausse, et la mesure l'a dit.

### Limite connue

**Le critère 13 n'est plus re-mesurable sans réintroduire les crochets.** C'est
le prix du retrait, et il est faible : le verdict est écrit, et la partie qui
comptait vraiment — le limiteur ne se verrouille pas — est verrouillée par un
test unitaire qui, lui, ne dépend de rien.

---

## Phase 2 — Critère 14 : `prefers-reduced-motion`

> « `prefers-reduced-motion` : la liste des styles autorisés reste non vide et
> aucun d'eux ne stroboscope. »

Le dernier des quatorze critères de §12 qui restait ouvert. Il l'était pour une
raison simple et gênante : **la préférence système n'était observée nulle part
sur le chemin preview/export.** `LiveVisualPanel` l'écoute depuis la refonte VJ,
`Camera` divise le shake — mais `App.ts` n'avait aucun `matchMedia`, seulement
une case à cocher manuelle « Réduction des flashs ». Une préférence système et
un réglage manuel ne sont pas la même chose : l'utilisateur qui a réglé son OS
n'a aucune raison de venir le redire dans mon interface.

C'est le piège de l'Étape 25 sous une autre forme — câblé d'un côté, absent de
l'autre.

### La mesure d'abord, la liste ensuite

Deux instruments, chacun validé par un témoin avant de servir (image identique
-> 0 ; noir vers blanc -> 1) :

- **Écart de luminance** — copie exacte de `FlashLimiter.measureLuminance`
  (32x18, luma Rec. 709). C'est la définition du clignotement que le projet
  applique déjà ; en inventer une autre pour l'occasion n'aurait rien prouvé.
- **Mouvement** — différence absolue moyenne par composante sur 64x36. Il a
  fallu l'ajouter : **la luminance moyenne est aveugle au mouvement.** `eclats`
  fracasse l'image sans déplacer sa moyenne d'un pouce, et une liste bâtie sur
  la seule luminance l'aurait déclaré calme.

Piste de démonstration, 180 images pilotées une par une après 60 de chauffe :

| style          | écart lum. max | mouvement p95 | mouvement max |
|----------------|----------------|---------------|---------------|
| `chambre`      | 0,0022         | **0,0022**    | 0,0061        |
| `monolith`     | 0,0202         | 0,0097        | 0,0325        |
| `aurore`       | 0,0022         | 0,0106        | 0,0390        |
| `spectrum-pro` | 0,0118         | 0,0119        | 0,0212        |
| `iso-pulse`    | 0,0064         | 0,0149        | 0,0190        |
| `pulse`        | 0,0063         | 0,0155        | 0,0271        |
| `field`        | 0,0037         | 0,0179        | 0,0431        |
| `eclats`       | 0,0344         | **0,0392**    | 0,0818        |

**Aucun style ne clignote.** Le pire, `eclats`, est cinq fois sous le seuil de
0,18 de `REDUCED_FLASHING_MODE` ; le meilleur, quatre-vingts fois. La seconde
moitié du critère est donc satisfaite par la mesure, pas par une exclusion — et
c'est une bonne nouvelle qu'il fallait vérifier plutôt que supposer.

Le MOUVEMENT, lui, varie d'un facteur **dix-huit**. Les deux seuils retenus
tombent dans les deux vrais trous de la série : `chambre` est quatre fois plus
calme que le suivant, `eclats` deux fois plus agité que le précédent. Ce ne sont
pas des valeurs rondes choisies d'avance.

**Recoupement que je n'ai pas cherché** : docs/17 §9 écrit de `chambre` « Doit
passer `prefers-reduced-motion` sans modification ». La mesure, faite sans
relire cette phrase, le désigne comme le plus calme des huit et de loin. C'est
le seul contrôle indépendant dont je dispose sur ce classement.

### Deux erreurs de mesure, toutes deux les miennes

**Cinq styles ont d'abord rendu exactement 0,0000.** J'ai failli l'écrire comme
« cinq styles parfaitement calmes ». Ce n'était pas ça : l'horloge avait atteint
la fin de la démo (0:58 / 1:00) pendant les trois premiers, et les cinq suivants
mesuraient des images FIGÉES. Un zéro exact sur 300 images consécutives est
impossible pour un style animé — c'est ce qui m'a arrêté. Corrigé en rechargeant
la démo avant chaque style, ce que confirme `t_avance` autour de 4,1 s partout.

**Le premier relevé de clampage valait zéro pour les huit styles**, et je l'ai
mis de côté : c'était circulaire. Le `FlashLimiter` tourne, donc mesurer après
lui revient à demander au garde-fou s'il a bien tenu. D'où la mesure directe des
écarts de luminance, en amont de son verdict.

### Ce que fait le code

- **`src/presets/reducedMotion.ts`** (nouveau) — `STYLE_MOTION_LOAD` en
  `Record<StyleId, MotionLoad>` : ajouter un style ne compilera pas tant que sa
  charge n'aura pas été décidée. Précédent : `STYLE_LABELS`.
  `REDUCED_MOTION_STYLES` en est DÉRIVÉE, jamais recopiée.
- **`App.ts`** — `matchMedia('(prefers-reduced-motion: reduce)')` écouté EN
  CONTINU, comme le fait déjà `LiveVisualPanel` : la préférence peut être activée
  pendant que le visuel tourne, et c'est le moment où elle sert.
- **`applyImportedDoc`** — seul endroit où l'application impose un style
  (suggestion à l'import) : il passe par `pickReducedMotionStyle`.
- **`AdvancedPanel.setReducedMotion`** — marque les vignettes concernées.

### Trois décisions qui auraient pu aller autrement

**La préférence ALLUME la réduction des flashs, elle ne l'éteint jamais.** Si
elle disparaît, une case cochée à la main le reste. L'inverse effacerait un
réglage que l'utilisateur a posé lui-même.

**Les styles agités sont MARQUÉS, pas retirés ni grisés.** Un style absent de la
grille laisse croire qu'il n'existe pas ; un style grisé laisse croire qu'il est
cassé. La marque dit ce qui est vrai — ce style bouge beaucoup — et laisse le
choix. Elle passe par `title` ET par l'alternative textuelle du canevas : une
mention invisible aux lecteurs d'écran, sur un réglage d'accessibilité, serait
un comble.

**Un seul style est écarté, pas sept.** J'aurais pu ne garder que `chambre`, le
seul mesuré vraiment calme, et le critère serait passé aussi bien. Retirer six
styles sur huit à Aaron sur la foi d'une seule piste douce n'était pas une
lecture honnête de ce que j'avais mesuré.

### Vérification

```
npm run typecheck   -> 0 erreur
npm test            -> 120 fichiers, 1146 tests (1131 -> 1146, +15)
npm run test:arch   -> 1 test
npm run build       -> 532,42 kB (gzip 152,57 kB), 2,13 s
```

Au navigateur, sans préférence active : 8 vignettes, **0 marquée**, case
décochée, aucune erreur console — le cas ordinaire est inchangé, ce qui est la
première chose à prouver. Marque appliquée à la main sur `eclats` : le repère
apparaît en `rgb(255,178,107)`, `chambre` reste vierge, la vignette demeure
cliquable, et le retrait de la classe restaure l'état initial.

### Limites connues

- **Je n'ai pas pu déclencher la vraie préférence système.** `matchMedia` rend
  un objet neuf à chaque appel : je n'atteins pas l'écouteur d'`App.ts` depuis la
  console. Le câblage est donc vérifié par lecture de source (4 tests) et par les
  tests unitaires de la fonction de repli (11 tests), pas de bout en bout.
  **À valider par Aaron : activer « Réduire les animations » dans Windows,
  recharger, et vérifier que la case « Réduction des flashs » se coche seule et
  qu'`Éclats` porte un point orange.**
- **Tout est mesuré sur la piste de démonstration**, qui est douce. Le chantier 6
  redoutait `eclats` sur un morceau à breaks rapides : ce cas n'a jamais été
  mesuré, et le classement est donc un plancher de prudence.
- **La préférence n'atténue PAS le mouvement** des styles autorisés : elle
  choisit lesquels proposer, et allume la réduction des flashs. Atténuer
  vraiment demanderait de toucher `applyCamera` et le shake, donc le pipeline
  d'export aussi — hors du mandat « fais le critère 14 », et à demander avant.
- **`pulse` et `field`, à 0,0155 et 0,0179 de mouvement p95, sont les plus agités
  des autorisés.** Si Aaron trouve que ça bouge encore trop sous la préférence,
  la frontière se déplace en changeant une ligne de `STYLE_MOTION_LOAD`.

---

## Phase 2 — Critère 12 : les quatre moments, par capture

> « Sur un morceau complet, l'intro, la montée, le drop et le breakdown donnent
> des images visiblement différentes. **À démontrer par capture.** »

Le dernier des quatorze. Deux obstacles, un de mesure et un de transport.

### D'abord un resultat NEGATIF, et il ne pointait pas ou je regardais

Premiere mesure, style `pulse`, quatre moments pris sur la demo. Ecarts entre
moments : 0,0207 a 0,0375 sur la difference absolue moyenne par pixel. Or le
mouvement image a image de `pulse`, mesure au critere 14, vaut deja 0,0155 au
p95 et 0,0271 au maximum.

**Autant dire rien.** J'ai donc ajoute le controle qui manquait : deux instants
de la MEME section, a quelques secondes d'ecart. Verdict :

| | ecart |
|---|---|
| temoins intra-section | 0,0243 - 0,0339 |
| entre moments | 0,0238 - 0,0491 |

Les deux plages se recouvrent presque entierement, et `montee / drop` (0,0238)
tombait SOUS le temoin `intro / intro_bis` (0,0339). Sans ce controle j'aurais
pu presenter six nombres d'apparence honorable et conclure a tort.

### La cause : la demo se contredisait elle-meme

Les descripteurs ont trahi le coupable. La proportion de pixels clairs suivait
la courbe `energy` du document avec une correlation de **0,906** — le moteur
faisait donc exactement son travail. C'est la courbe qui etait fausse :

| instant | section declaree | `energy` |
|---------|------------------|----------|
| 5,0 s | A, energie 0,30 | **0,832** |
| 19,4 s | B, energie 0,85 | **0,153** |

`energy` valait `0.5 + 0.35 * sin(t * 0.25)`, une sinusoide heritee du harnais
P7, ecrite avant que les sections n'existent et jamais reconciliee avec elles.
**En plein coeur de la section haute, la courbe touchait son minimum.** Le
critere 12 etait indemontrable sur ce document, non par la faute du moteur mais
par celle du morceau.

`structuralEnergy` la remplace : base de section, rampe sur les 3 s de chaque
BUILDUP, pic a chaque DROP, ondulation de +/-0,05 pour que rien ne soit une
ligne morte. **Les six bandes ne sont PAS touchees** — la mesure a montre que
`energy` seul portait la correlation, et deplacer le spectre deplacerait la
dominance de grave que lit `suggestPreset`.

Remesure, memes instants, memes temoins :

| | ecart |
|---|---|
| temoins intra-section | 0,0244 / 0,0346 |
| intro / montee | **0,0644** |
| intro / drop | **0,0609** |
| montee / drop | **0,0626** |
| montee / breakdown | **0,0726** |
| drop / breakdown | **0,0662** |
| intro / breakdown | 0,0277 |

Cinq paires sur six depassent nettement le plancher de bruit. Pixels clairs :
intro 4,13 %, **montee 24,31 %**, drop 18,40 %, breakdown 3,82 % — six fois
l'ecart entre l'intro et la montee.

**`intro / breakdown` reste sous le plancher, et c'est CORRECT** : le document
declare les deux en section A, a la meme energie. Deux moments que la musique
dit identiques doivent se ressembler. Je ne l'ai pas maquille.

### Le transport : un echec franc avant la solution

Le mot « capture » a coute plus cher que la mesure.

1. Capture d'ecran du panneau : expire, le panneau ne compose pas d'images.
2. Telechargement du navigateur : atterrit hors du dossier du projet, interdit.
3. Faire transiter le `toDataURL` par la conversation : **essaye, echoue.**
   5 543 caracteres arrives sur 23 416, marqueur de fin `fff6` au lieu de
   `ffd9`. J'ai decode le fichier avant de le montrer, ce qui a revele la
   troncature. **Une image tronquee qui ressemble a une preuve est pire que pas
   d'image.**

D'ou `tools/captureSink.ts` : un greffon Vite en `apply: 'serve'`, absent du
bundle de production, qui recoit un POST et ecrit sous `docs/captures/`. Le
trajet ne traverse plus rien qui puisse le tronquer.

**Il a d'abord ecrit hors du projet.** `process.cwd()` est le dossier de
lancement du serveur, pas la racine servie — les deux different ici. Corrige en
`server.config.root`. Le fichier temoin egare est signale a Aaron plus bas.

### Les captures

- `docs/captures/critere12-pulse.jpg` (1310x864)
- `docs/captures/critere12-eclats.jpg` (1310x864)

`pulse` est spectaculaire : l'anneau passe d'etroit et sombre a large et
sature, le coeur s'embrase au drop, le breakdown retombe. **`eclats` est plus
subtil** : les cellules de Voronoi se redistribuent et la montee est plus
remplie, mais un oeil presse pourrait trouver les quatre vignettes proches. Je
le dis plutot que de choisir deux styles flatteurs.

### Verification

```
npm run typecheck   -> 0 erreur
npm test            -> 120 fichiers, 1151 tests (1146 -> 1151, +5)
npm run test:arch   -> 1 test
npm run build       -> 532,64 kB (gzip 152,68 kB), 2,14 s
```

Les cinq tests ajoutes verrouillent la coherence du document. Le principal a ete
verifie comme un VRAI garde-fou : sur l'ancienne courbe, max(A) = 0,824 et
min(B) = 0,253, donc il echoue ; sur la nouvelle, 0,350 et 0,805, il passe.

### A valider par Aaron

- **Regarder les deux planches.** C'est un critere visuel ; ma mesure dit que
  les images different, elle ne dit pas qu'elles sont BELLES ni que la
  dramaturgie se lit.
- **La demo a change d'allure.** « Charger une demo » ne donnera plus la meme
  chose : elle respire maintenant par sections au lieu d'onduler lentement. Si
  ce n'etait pas souhaite, la fonction est isolee et se retire en une ligne.

### Limites connues

- **Toujours pas un vrai morceau.** La demo est synthetique, et sa structure est
  maintenant coherente parce que je l'ai rendue telle. Le critere dit « sur un
  morceau complet » : un import reel reste le seul juge.
- **Deux styles sur huit** ont ete captures. Les six autres n'ont pas ete
  regardes sous cet angle.
- **Un fichier egare hors du projet**, ecrit par la premiere version du greffon :
  `Correcction, implementation/docs/captures/temoin.png` (93 octets, un carre
  rouge de 2x2). Je ne sors pas du dossier du projet, donc je ne l'ai pas
  touche : a supprimer a la main.
- Le `temoin.png` interne a ete deplace dans `_corbeille/20260808/`.

---

## Correctif — quatre presets sur onze figeaient l'image

Signale par Aaron : « quand je clic sur un preset du visualizer, l'image ne
change pas, est ce normal ? »

Non. C'etait une exception.

### Reproduction

Onze presets essayes un par un au navigateur, chacun sur une demo rechargee,
avec mesure de l'ecart d'image avant/apres selection :

| preset | ecart | exception |
|---|---|---|
| `lofi` `rnb` `afro` `ambient` | **0,0000** | `TypeError: CURVES[this.curve] is not a function` |
| les sept autres | 0,054 a 0,225 | aucune |

**L'ecart valait exactement zero.** L'exception tuait la boucle de rendu :
l'image ne changeait pas parce qu'elle ne se dessinait plus du tout. Rien ne
l'indiquait a l'ecran.

### Cause

Ces quatre presets declarent `curve: "easeInOutSine"` depuis le chantier 9.
`Anticipation.CURVES` ne contenait que `linear` et `easeInQuad`.

Trois choses rendaient la panne invisible :

1. **`easeInOutSine` EXISTE** dans `core/math/easing`. Elle n'a jamais ete
   branchee dans cette table-la.
2. **`ReactionEditor` la propose deja** dans sa liste deroulante — donc
   l'interface offrait un choix que le moteur ne savait pas honorer. La panne
   etait atteignable a la main, pas seulement par les presets.
3. **Les noms de courbes vivaient dans un TYPE TypeScript**, efface a la
   compilation, alors que les presets sont du JSON lu a l'execution et introduit
   dans le typage par un `as`. Les deux ne pouvaient pas se rencontrer. Aucun
   test ne les confrontait.

Le commentaire qui gardait la table — « pas de catalogue de courbes invente sans
plus de specification » — etait une bonne regle appliquee trop tard : la
decision d'offrir cette courbe avait deja ete prise deux fois ailleurs.

### Correctif, en trois temps

- **`ANTICIPATION_CURVES`** devient un tableau EXECUTABLE, pas seulement un
  type, et `easeInOutSine` y entre. C'est ce tableau qui manquait : un type ne
  peut rien verifier a l'execution.
- **Repli sur `linear`** au lieu d'une exception quand la courbe est inconnue.
  Une donnee fausse ne doit pas ARRETER LE RENDU — meme esprit que la Loi 3.
  L'utilisateur n'a pas vu une erreur, il a vu une image figee.
- **`validatePreset` refuse le mauvais nom a l'entree**, en le citant. Le reste
  de `mapping` reste volontairement non valide (diffs partiels), mais un nom de
  courbe est un identifiant qui doit exister, pas un reglage libre.

### Verification

```
npm run typecheck   -> 0 erreur
npm test            -> 121 fichiers, 1160 tests (1151 -> 1160, +9)
npm run test:arch   -> 1 test
npm run build       -> 532,90 kB (gzip 152,76 kB), 2,17 s
```

Au navigateur, apres correctif, onze presets sur onze : **aucune exception**,
ecarts de 0,058 a 0,214. Les quatre morts sont revenus — `lofi` 0,070,
`rnb` 0,078, `afro` 0,214, `ambient` 0,060 — et leurs teintes moyennes sont
distinctes (`lofi` 41,22,22 chaud ; `ambient` 9,15,24 froid). Reverifie sur une
page rechargee A NEUF, les erreurs residuelles de la console portant toutes des
horodatages de modules anterieurs au correctif.

### Ce que ca dit du critere 11

`docs/17` §12 critere 11 — « passer d'un preset a un autre change la geometrie »
— etait declare tenu. Il l'etait pour sept presets sur onze. **Je ne les avais
pas tous essayes**, et aucun test ne le faisait a ma place. Le nouveau
`tests/unit/anticipationCurves.test.ts` parcourt le catalogue REEL.

### Limites connues

- Le repli sur `linear` rend une courbe inconnue SILENCIEUSE a l'execution.
  C'est voulu — mieux vaut une image un peu fausse qu'une image figee — et
  `validatePreset` la refuse a l'entree. Mais un preset charge par un chemin qui
  ne validerait pas passerait sans bruit.
- **Seule la famille Anticipation** a ete auditee. Les autres familles de
  `MappingSchema` (Impulse, Continuous, Lfo) peuvent avoir le meme genre de
  nom-qui-doit-exister non verifie : `lfo:triangle`, `lfo:random`... Non
  verifie, a faire.

---

## Audit des quatre familles de mapping

Demande par Aaron apres le correctif des courbes d'anticipation, dont la
derniere ligne de limites disait : « seule la famille Anticipation a ete
auditee ».

### Methode

Un harnais de MESURE, pas de lecture : il inventorie ce que les onze presets
CITENT, le confronte a ce que le moteur CONNAIT et a ce que le document
CONTIENT, puis fait tourner `BehaviourEngine` sur 60 s et releve le maximum
atteint par chaque signal. Un signal qui plafonne a zero est mort.

### Trouvaille principale : `sectionShift` etait mort depuis toujours

```
sectionShift   max = 0.0000   <<<< MORT
```

Il est cable sur `from: ['SECTION']` dans `behaviour/mapping/defaults.ts`
depuis le MVP, dans les onze presets, et « Frontiere de section » figure dans
l'editeur de reaction. **Aucun producteur n'a jamais existe.**

- `structure.ts` n'emet AUCUN evenement — pas une seule ligne `type:`. Il
  remplit le tableau `sections`.
- `finalize.ts` range ce tableau dans le document et s'arrete la. Son propre
  commentaire le dit : « `structure.ts` detecte des SECTIONS par energie, un
  concept different ».

Le signal etait donc a zero sur TOUT document, depuis toujours, pendant que
onze presets pretendaient s'en servir.

Les donnees existaient pourtant : `doc.sections` porte les frontieres. Il ne
manquait que la conversion. `derivedSectionEvents` la fait dans
`buildMusicTimeline` — pas dans `finalize.ts`, pour trois raisons :

1. Les projets DEJA ENREGISTRES n'ont pas d'evenements `SECTION` ; la timeline
   est traversee par tous les documents, anciens comme neufs.
2. C'est le seul point traverse a la fois par la preview ET par l'export — le
   piege de l'Etape 25.
3. Le PMDI reste le contrat d'analyse ; on ne le reecrit pas pour reparer un
   cablage.

Trois decisions, chacune defendable autrement :

- **Le document fait autorite.** S'il porte deja des `SECTION`, rien n'est
  ajoute — le jour ou l'analyse en produira, la derivation s'efface au lieu de
  doubler chaque frontiere.
- **La premiere frontiere est ignoree.** Le debut du morceau n'est pas un
  changement, et un flash a t=0 serait un artefact.
- **`intensity: 1`, pas un delta d'energie.** Ponderer par l'ecart d'energie
  inventerait une semantique que personne n'a specifiee, et rendrait MUETTES
  les transitions entre deux sections de meme intensite — justement celles ou
  le repere visuel sert le plus.

Mesure apres correctif : `sectionShift max = 1.0000`. Au navigateur, pic de
mouvement **0,1000** a la frontiere de 18 s contre **0,0074** de moyenne
ailleurs, soit treize fois.

### Le defaut silencieux : `resolve()` n'a pas d'`else`

Une entree dont le `from` ne correspond a aucune des quatre familles est
simplement ABSENTE de la table resolue. Pas d'erreur, pas de trace : le signal
reste a zero pour toujours. `lfo:trianlge`, une simple faute de frappe, echoue
a `isLfoEntry` qui exige une onde connue, et disparait exactement comme ca.

**Le correctif des courbes tuait bruyamment ; celui-ci tue en silence. Le
silence est pire** — c'est ce qui a permis a `sectionShift` de rester mort tout
ce temps.

`validatePreset` refuse desormais, en les nommant : un prefixe de `from`
inconnu, une onde de LFO inconnue, un tableau d'impulsion vide. Il continue de
**n'imposer aucun vocabulaire aux types d'evenements** — docs/04 principe #3,
`EventType` est une chaine libre et un type inconnu est ignore ; controler le
vocabulaire rejetterait a tort un document d'analyse plus riche.

### Ce qui est SAIN

- **Les cinq ondes de LFO** citees (sine, triangle, saw, square, random) sont
  toutes connues du moteur.
- **Les trois features** citees (energy, centroid, band.sub) sont toutes
  produites par `AnalysisPipeline`.
- **Les six types percussifs** (KICK, SNARE, CLAP, HAT, PERC, SUB_HIT) et DROP
  sont tous emis par l'analyse.
- **Les treize cles de signal** correspondent exactement a `SIGNAL_NAMES` +
  `LFO_NAMES`.
- **`resolve()` ne perd aucune entree** sur les onze presets du catalogue.

### Une limite de la DEMO, pas un defaut du moteur

```
subImpact      max = 0.0000   <<<< MORT
```

Distinction qui compte : `SUB_HIT` EST emis par l'analyse ; c'est la piste de
demonstration qui n'en contient aucun, comme elle ne contient ni CLAP ni PERC.
Sur un vrai morceau, `subImpact` doit vivre — **non verifie**, faute d'import
reel dans cette session. Ajouter un SUB_HIT a la demo la rendrait plus
representative : deux lignes, pas faites, a decider.

### Verification

```
npm run typecheck   -> 0 erreur
npm test            -> 122 fichiers, 1173 tests (1160 -> 1173, +13)
npm run test:arch   -> 1 test
npm run build       -> 533,73 kB (gzip 153,08 kB), 2,17 s
```

Au navigateur, sur une page rechargee A NEUF : onze presets essayes, **zero
exception**.

### A valider par Aaron

**Ceci change l'image de tous les projets** : il y a maintenant une reaction a
chaque frontiere de section, la ou il n'y en avait aucune. C'est ce que les
presets demandaient depuis le debut, mais l'effet est nouveau a l'oeil. Si
c'est trop marque, `intensity` ou le `decay` de `sectionShift` se reglent ; si
ce n'etait pas voulu du tout, `derivedSectionEvents` se neutralise en rendant
un tableau vide.

### Limites connues

- **Les seuils de classification** (`preset.classification.*`) n'ont pas ete
  audites : meme famille de risque, des noms et des bornes lus a l'execution.
- **`intensity: 1` est un choix**, pas une mesure. Aucune specification ne dit
  quelle force doit avoir une frontiere de section.
- Le harnais de mesure a ete archive dans `_corbeille/20260808/`.

---

## Audit des seuils de classification

Demande par Aaron apres l'audit des familles de mapping, dont les limites
disaient que ces seuils n'avaient pas ete regardes. Troisieme round de la meme
famille de defaut, et le plus couteux des trois.

### Trouvaille principale : les seuils n'atteignaient JAMAIS l'analyse

```
--- CHEMIN REEL DE L'APPLICATION ---
  App.ts passe-t-il `classification` a importTrack ?  false
  pipeline.ts le transmet-il a finalizePmdi ?         true
  suggestPreset est appele APRES finalizePmdi ?       true
```

**Huit presets sur onze declarent un bloc `classification`, et il ne servait a
rien.** Tout etait en place — `mergeClassification` fusionne correctement,
`pipeline.ts` transmet, `finalizePmdi` accepte — sauf le dernier maillon :
`App.ts` n'a jamais rempli le champ. `finalizePmdi` retombait donc toujours sur
`DEFAULT_CLASSIFICATION_THRESHOLDS`.

Et ce n'etait pas un simple oubli : c'est un probleme de **l'oeuf et de la
poule**. On ne sait quel preset proposer qu'APRES avoir analyse, et il faut
avoir classe pour analyser. La ligne `suggestPreset(doc, …)` vient
structurellement apres `finalizePmdi(…)`, dans la meme fonction.

Ce n'etait pas cosmetique. Sur cinq onsets synthetiques :

| preset | bascules |
|---|---|
| `drill` | grave net KICK -> aucun, grave limite KICK -> aucun, charley HAT -> aucun |
| `techno` | idem, trois cas sur cinq |
| `dubstep` | deux graves sur cinq |
| `trap-dark` | un grave limite |

Le mecanisme marchait parfaitement. Il n'etait jamais alimente.

### Le correctif : une SECONDE passe

`importTrack` finalise une premiere fois avec les defauts, demande la
suggestion, puis **refinalise avec les seuils du preset suggere**. Fait dans
`pipeline.ts` et non dans `App.ts` : l'oeuf et la poule est un probleme du
pipeline, pas de l'interface, et chaque appelant n'a pas a connaitre cette
subtilite. `importTrack` rend desormais un document COHERENT avec la
suggestion qu'il rend.

**Le cout a ete mesure avant d'etre accepte**, et j'avais d'abord ecrit une
estimation fausse dans le commentaire (~3 ms) avant de la mesurer :

```
finalizePmdi sur 3000 onsets : 0,58 ms par passe
```

`finalizePmdi` est PUR et travaille sur `ext.onsetDescriptors` deja calcules :
ni FFT, ni Worker, ni relecture de l'audio. Doubler la finalisation est
invisible a cote des secondes que prend l'analyse.

Deux garde-fous : la passe est SAUTEE si l'appelant a impose ses propres seuils
(il sait ce qu'il veut), et si le preset suggere ne declare aucune surcharge —
sinon ce serait du travail pur perdu.

### Le defaut silencieux, pour la troisieme fois

`mergeClassification` fait `{ ...base.kick, ...overrides.kick }`. Une cle mal
orthographiee — `bassRation` pour `bassRatio` — **s'ajoute a l'objet**, n'est
lue par personne, et le seuil qu'on croyait regler garde sa valeur par defaut.
Sans un mot.

Meme cause de fond que les deux rounds precedents : `ClassificationOverrides`
est un TYPE, efface a la compilation, alors que les presets sont du JSON lu a
l'execution. D'ou `CLASSIFICATION_FIELDS`, une liste executable, et
`checkClassificationNames` qui refuse une famille inconnue, un champ inexistant
(en citant les champs attendus) et une valeur non numerique.

**Aucune borne n'est imposee aux VALEURS.** docs/05 §4 appelle ces nombres des
« points de depart a calibrer sur le corpus » ; un `maxCentroid` de 180 Hz pour
un kick techno est aussi legitime que 250. Decider ici de ce qui est
musicalement raisonnable serait s'arroger un jugement que la documentation
confie explicitement a la calibration.

### Ce qui est SAIN

- **Zero cle inconnue** dans les onze presets : les 18 surcharges declarees
  nomment toutes un champ reel.
- **Les trois presets sans bloc** (`lofi`, `rnb`, `edm`, `ambient`) resolvent
  exactement les defauts.
- `CLASSIFICATION_FIELDS` est confronte par test a
  `DEFAULT_CLASSIFICATION_THRESHOLDS` — la liste ne peut pas deriver en silence.

### Une surcharge qui ne sert a rien

`afro` declare `perc.minCentroid: 800`, ce qui est EXACTEMENT la valeur par
defaut. Elle ne change rien. Laissee telle quelle : elle documente une
intention (« afro se contente du reglage standard ») et la retirer serait du
bruit dans l'historique. Signale pour que personne ne cherche son effet.

### Verification

```
npm run typecheck   -> 0 erreur
npm test            -> 123 fichiers, 1184 tests (1173 -> 1184, +11)
npm run test:arch   -> 1 test
npm run build       -> 534,85 kB (gzip 153,30 kB), 2,64 s
```

Un test a du etre RENFORCE apres coup : sa premiere version tombait sur `rnb`,
qui ne surcharge aucun seuil, si bien que sa branche utile ne s'executait
jamais. Le montage vise maintenant explicitement un preset surcharge, et un
test separe VERIFIE que c'est bien le cas avant que l'autre ne mesure.

Au navigateur, page rechargee a neuf : demo chargee, 3,8 s simulees,
11 196 pixels clairs, aucune erreur.

### Limite de verification

**Rien de tout ceci n'est observable au navigateur ici.** La classification
n'est calculee que sur l'import d'un fichier audio reel, et `loadDemo` fournit
un document deja classe. Meme limite que la suggestion de preset. Tout ce qui
precede est mesure par harnais.

### A valider par Aaron

**Ceci change le resultat de l'analyse de tout morceau importe.** Les
evenements detectes ne seront plus les memes qu'avant sur les genres dont le
preset surcharge les seuils — c'est l'intention documentee depuis docs/05, mais
l'effet est nouveau. Le seul juge : importer un vrai morceau de trap, de drill
ou de techno et ecouter si les frappes detectees tombent mieux.

### Limites connues

- **La seconde passe suit la SUGGESTION**, pas le preset que l'utilisateur
  choisit ensuite a la main. Changer de preset apres l'import ne reclasse rien.
  Le faire demanderait de conserver `result.pmdi` dans `App.ts` et de refinaliser
  a chaque changement — faisable a 0,58 ms, non fait, a decider.
- **Les seuils eux-memes n'ont jamais ete calibres sur un corpus**, comme
  docs/05 le demande. Ils restent des « points de depart » ecrits a la main.
- Les deux harnais de mesure ont ete archives dans `_corbeille/20260808/`.

---

## Correctif CRITIQUE — le visuel gele quand « Reduire les animations » est actif

Signale par Aaron : « quand je change le style du visuel et sa couleurs et je
pense aussi tout le reste, ca ne change pas du tout le visuel ».

**C'est moi qui l'ai casse, au critere 14, et aucun de mes controles ne pouvait
le voir.**

### Ce que j'ai d'abord decouvert sur MOI

En cherchant a reproduire, j'ai pose un compteur `requestAnimationFrame` dans le
panneau navigateur :

```
images rAF depuis la pose du compteur : 0
```

**Zero.** Le panneau ne compose pas d'images, donc `requestAnimationFrame` ne se
declenche jamais. Ce qui veut dire, sans detour : **je n'ai JAMAIS teste la
vraie boucle de rendu de cette application.** Toutes mes mesures de la session —
les huit styles, les onze presets, le critere 12, le critere 14 — forcaient les
images une par une avec `__pulsarDebug.step()`. J'ai verifie la FONCTION de
rendu ; jamais ce qu'un utilisateur voit.

Je l'avais signale pour la suggestion de preset et pour la classification. Je ne
l'avais pas compris pour la boucle elle-meme, et je l'ai ecrit « verifie au
navigateur » des dizaines de fois.

### Le defaut

`applyReducedMotion(motionQuery.matches)` etait appele **ligne 825**, au niveau
module, juste a cote de la declaration de la fonction — ce qui semblait propre.

Quand `prefers-reduced-motion` est ACTIF, cette fonction appelle
`applyActiveConfiguration()`, qui touche `SWATCHES`, `reactionEditor`,
`layerComposer`... tous declares en `const` **plus bas dans le fichier**.

```
ReferenceError: Cannot access 'SWATCHES' before initialization
```

Zone morte temporelle. L'evaluation du module s'arrete net ligne 825, donc le
`requestAnimationFrame(raf)` de la ligne 2548 **n'est jamais atteint**. Le
canevas ne se repeint plus jamais et tous les controles sont morts. Exactement
ce qu'Aaron decrit.

### Pourquoi rien ne l'a vu

La branche fautive ne s'execute QUE si la preference systeme est active. Elle ne
l'est pas sur cette machine — je l'avais d'ailleurs ecrit noir sur blanc dans
l'entree du critere 14 : « Je n'ai pas pu declencher la vraie preference
systeme [...] le cablage est verifie par lecture de source ». **J'ai livre du
code dont je savais qu'une branche entiere n'etait pas executee**, et cette
branche cassait tout.

### Reproduction

En forcant `matchMedia` avant une reevaluation du module :

```js
window.matchMedia = (q) => q.includes('reduced-motion') ? { matches: true, … } : vrai(q);
await import('/src/ui/App.ts?repro=' + Date.now());
```

```
AVANT : { verdict: 'MODULE MORT', erreur: "ReferenceError: Cannot access 'SWATCHES' before initialization" }
APRES : { verdict: 'MODULE VIVANT avec prefers-reduced-motion actif' }
```

### Correctif

L'installation de l'ecoute descend dans `installerReducedMotion()`, appelee
APRES `applyActiveConfiguration()`, la ou tout existe. La fonction
`applyReducedMotion` porte desormais un avertissement en tete : ne jamais
l'appeler pendant l'evaluation du module.

### Trois tests, verifies comme de VRAIS garde-fous

Remis le code casse en gardant les tests neufs :

```
=== tests NEUFS contre le code CASSE ===
  × l'installation de l'écoute vient APRÈS la configuration initiale
  × aucun appel à applyReducedMotion au niveau module avant l'installation
  Tests  2 failed | 16 passed (18)
--- correctif restaure ---
  Tests  18 passed (18)
```

Le troisieme verrouille que `requestAnimationFrame(raf)` est enregistre AVANT la
configuration initiale : defense en profondeur, pour qu'une exception plus bas
laisse au moins l'image vivante.

### Verification

```
npm run typecheck   -> 0 erreur
npm test            -> 123 fichiers, 1187 tests (1184 -> 1187, +3)
npm run test:arch   -> 1 test
npm run build       -> 534,87 kB (gzip 153,30 kB), 2,16 s
```

### Ce que ca change pour la suite

**Toute mention « verifie au navigateur » de cette session doit se lire :
verifie en forcant les images a la main.** Le rendu automatique n'a jamais
tourne ici. Les journaux precedents ne le disent pas, et c'est une exageration
que je corrige ici plutot que de reecrire chaque entree.

### Limites connues

- **Je ne peux toujours pas executer la vraie boucle.** Le correctif est prouve
  par reproduction du plantage de module, pas par une image animee.
- **Le seul juge reste Aaron** : recharger la page et verifier que le visuel
  bouge et que les styles changent quelque chose.

---

## Le visuel ne bouge toujours pas — filet sous la boucle, et un diagnostic deporte

Aaron, apres le correctif de zone morte temporelle : « toujours aucun
changement ». Mon hypothese etait donc fausse, ou incomplete.

### Ce que je ne peux pas faire, et qu'il faut arreter de contourner

```
images rAF en 1 s = 0
```

Le panneau navigateur dont je dispose **ne compose pas d'images**. J'ai
reessaye : mettre l'onglet au premier plan, demander une capture — « the
Browser pane is not displayed ». Je ne peux pas executer la vraie boucle de
rendu, point. Continuer a formuler des hypotheses depuis ici serait de la
divination.

Mon propre diagnostic le montre crument :

```
canvas_change_apres_clic_style = false
aria_pressed = true
```

Le clic est bien enregistre, le canevas ne change pas — parce que rien ne le
repeint. Chez Aaron, rAF tourne : le meme test y sera decisif.

### Un vrai defaut trouve en chemin

```js
function raf(nowMs) {
  loop(nowMs);
  requestAnimationFrame(raf);   // jamais atteint si loop() leve
}
```

**Une seule exception, a une seule image, arretait la boucle POUR TOUJOURS.**
Canevas gele, tous les controles en apparence morts, rien a l'ecran pour dire
pourquoi, et aucun moyen de s'en relever sans recharger. Une panne a consequence
disproportionnee : un defaut passager dans une couche condamnait l'application
entiere.

Ce n'est **pas un correctif de cause** — je ne sais toujours pas ce qui casse
chez Aaron. C'est un correctif de PROPAGATION : la boucle se replanifie quoi
qu'il arrive, et l'erreur est remontee a la console (les trois premieres en
entier, les suivantes comptees) plutot qu'avalee. Une boucle qui absorbe en
silence echangerait une panne visible contre une panne invisible, ce qui est
pire.

`__pulsarDebug.loopErreurs` expose le compteur. **`step()` continue d'appeler
`loop()` DIRECTEMENT, sans filet** : c'est l'outil de mesure, et s'il avalait
les exceptions, le defaut des courbes d'anticipation ne se serait jamais
montre — il a ete trouve exactement comme ca.

### Deux erreurs de ma part dans cette seule verification

1. **Mon premier test du filet ne testait rien** : il forcait une exception puis
   appelait `step()`, qui appelle `loop()` et non le `raf()` protege. Les cinq
   exceptions se sont propagees, comme il se doit. Verdict corrige en testant la
   STRUCTURE plutot que le comportement.
2. **Mon test de structure a echoue sur du code correct** : il cherchait `\n}\n`
   dans un fichier en CRLF, ou c'est `\r\n}\r\n`. Fins de ligne normalisees.
   A retenir pour tout test qui lit la source de ce depot.

### Diagnostic deporte

`public/diag.js`, servi par Vite, a lancer dans un VRAI navigateur :

```
import('/diag.js').then(m => m.diag())
```

Il rend l'etat du module, la preference `reduced-motion`, le nombre d'images rAF
en une seconde, le mouvement du canevas au repos puis en lecture, et l'ecart
d'image apres trois changements de style et deux de preset. Il copie son compte
rendu dans le presse-papiers.

### Verification

```
npm run typecheck   -> 0 erreur
npm test            -> 124 fichiers, 1193 tests (1187 -> 1193, +6)
npm run test:arch   -> 1 test
npm run build       -> 535,10 kB (gzip 153,44 kB), 2,18 s
```

### Limites connues

- **Le defaut signale par Aaron n'est PAS diagnostique.** Le filet empeche une
  exception d'emporter l'application ; il ne dit pas ce qui echoue chez lui.
- Le filet lui-meme n'est verifie que par lecture de structure — six tests sur
  la forme de `raf`, faute de pouvoir executer rAF ici.

---

## LA CAUSE — le transport epingle a zero par la correction de derive

Diagnostic d'Aaron, bien meilleur que mes suppositions :

> apres avoir clique lecture, le compteur de temps reste bloque a 0:00 / 1:00
> indefiniment, alors que la boucle de rendu tourne activement
> (requestAnimationFrame declenche plus de 4000 fois) et que le canvas reste
> pixel-identique tout du long. Aucune erreur console.

Il avait aussi verifie que changer de preset REDESSINE bien (somme des pixels
977187 -> 538902). Le rendu n'etait donc pas en cause : **la lecture ne
demarrait jamais.**

### Ce que mes suppositions valaient

Trois hypotheses successives, trois erreurs :

1. Zone morte temporelle sous `prefers-reduced-motion` — vraie panne, corrigee,
   mais **pas celle-la**.
2. Boucle de rendu morte — refutee par sa console : rAF tournait.
3. Un `dist/` local fige — refutee par lui : la surcouche pointe vers l'URL
   Netlify de production, redeployee a chaque build.

**Aucune de mes trois hypotheses n'etait la bonne, et c'est son releve qui a
tranche a chaque fois.**

### Le mecanisme, exact

Le contexte audio ne tourne pas — politique d'autoplay, ou iframe sans
`allow="autoplay"`, PULSAR etant embarque en surcouche. Donc :

- `ctx.currentTime` est GELE, donc `currentRawT()` reste a ~0 ;
- `predictedT` avance, lui, sur l'horloge murale (+16,7 ms par image) ;
- au bout de HUIT images l'ecart franchit `HARD_RESYNC_THRESHOLD_SECONDS`
  (0,12 s) ;
- `correctDrift` fait alors exactement ce pour quoi il est ecrit : une
  resynchronisation DURE vers la valeur mesuree, c'est-a-dire **zero** ;
- et cela se repete a chaque image.

**Le transport etait epingle a zero par un correcteur qui fonctionnait
parfaitement.** Nourri d'une horloge a l'arret, il ne pouvait rien faire
d'autre.

Mesure, sur le code d'avant, avec un contexte factice a horloge gelee :

```
apres 2 s d'horloge murale : t = 0,029 s   (attendu > 1,5)
image 9 : t retombe de 0,117 a 0           (le seuil de 0,12 s, franchi)
motif du refus de resume() : undefined     (avale)
```

0,117 s a l'image 9 : le seuil et le compte d'images predits par la lecture du
code, retrouves au chiffre pres par la mesure.

### Correctif, en deux temps

**1. Ne pas se caler sur une horloge a l'arret.** `tick()` ne consulte
`correctDrift` que si `ctx.state === 'running'`. Sinon la position avance sur
l'horloge murale : le visuel joue, silencieusement, au lieu de se figer sans
explication. La correction reprend d'elle-meme des que le contexte demarre.

**2. Ne plus avaler le refus.** `void this.ctx.resume()` jetait la promesse
rejetee. Dans une iframe sans `allow="autoplay"`, `resume()` REJETTE, et rien
nulle part ne le disait : ni son, ni avancee du temps, ni message. Le motif est
desormais conserve dans `contextBlockedReason` et journalise. `contextState`
expose l'etat reel.

**Une panne muette est une panne qu'on cherche pendant des heures** — celle-ci
a coute trois hypotheses fausses.

### Ce qui n'a PAS ete touche

`correctDrift` est inchange. Un test l'etablit explicitement comme non coupable :
nourri de (0,5 predit ; 0 mesure), il resynchronise dur, et c'est correct. Un
autre verifie qu'un contexte QUI TOURNE garde la correction intacte — payer une
panne par une regression de synchronisation aurait ete un mauvais echange.

### Une erreur de test, la mienne

Mon dernier test attendait qu'une horloge decrochant en cours de route fasse
REVENIR la position sous la mesure. Faux : elle OSCILLE — elle grimpe de
~14,7 ms par image jusqu'a franchir le seuil, resynchronise, et repart. Elle ne
repasse jamais dessous. Attente corrigee sur ce que le mecanisme fait vraiment.

### Verification

```
npm run typecheck   -> 0 erreur
npm test            -> 125 fichiers, 1199 tests (1193 -> 1199, +6)
npm run test:arch   -> 1 test
npm run build       -> 535,45 kB (gzip 153,60 kB), 2,25 s
```

Trois des six tests neufs ECHOUENT sur le code d'avant, verifie en le remettant
sous les tests neufs. Ce sont de vrais garde-fous.

### Limites connues

- **Non verifie en conditions reelles.** Je ne peux toujours pas executer la
  boucle de rendu ici ; la preuve est un contexte audio factice a horloge gelee,
  pas la surcouche d'Aaron.
- **Le son ne reviendra pas pour autant.** Si le navigateur refuse le contexte,
  le visuel jouera desormais, mais muet. La vraie correction cote hote est
  d'ajouter `allow="autoplay"` a l'iframe qui embarque PULSAR — a verifier de
  ce cote-la.
- **`contextBlockedReason` n'est pas affiche dans l'interface**, seulement en
  console. A faire si le cas se reproduit.

---

## Rendre la panne visible : rapport de transport et horodatage de build

Aaron, apres quatre allers-retours : « c'est toujours pareil pffff ». Legitime.

### Ce que ces quatre rondes ont coute

Chacune lui a demande un copier-coller de console, et trois de mes hypotheses
etaient fausses. Pendant tout ce temps, **l'application savait parfaitement ce
qui n'allait pas et ne le disait nulle part.** C'est le vrai defaut de
conception ici, plus grave que chacun des bugs pris separement.

Deux ambiguites ont brouille le diagnostic :

1. **Quelle version teste-t-il ?** Sa console montrait `index-xz3DyyNa.js`
   alors que deux correctifs plus recents existaient deja. Impossible de savoir,
   sans le lui demander, si un correctif etait present dans ce qu'il regardait.
2. **Qu'est-ce qui bloque le transport ?** `loop()` avance `simT` sous une
   condition a six termes ; n'importe lequel absent fige tout, en silence.

### Ce qui est ajoute

**Un horodatage de build**, injecte par Vite (`__PULSAR_BUILD__`) et affiche
dans le panneau « Etat (debug) ». La question « la version testee contient-elle
le correctif ? » se tranche desormais a l'oeil, en une seconde.

**Une ligne « transport »**, mise a jour a chaque image :

```
lecture=oui ctx=running audio=8.20s sim=6.64s timeline=oui stepper=oui
```

Six valeurs, exactement les termes de la condition de `loop()`.

**Un avertissement visible**, declenche sur le SYMPTOME constate — lecture
active et `simT` immobile depuis plus d'une seconde et demie — qui nomme la
cause la plus probable :

> La lecture ne demarre pas : le navigateur bloque le son (contexte
> « suspended »). Si PULSAR est affiche dans une autre application, son
> `<iframe>` doit porter `allow="autoplay"`.

### Verification

Demo chargee, lecture lancee, boucle forcee :

```
build      = 2026-08-08 00:22:08
transport  = lecture=oui ctx=running audio=8.20s sim=6.64s timeline=oui stepper=oui
horloge    = 0:06 / 1:00
avertissement visible = false
```

**Le transport avance ICI** — `ctx=running`, horloge a 0:06. Mon environnement
n'a jamais reproduit sa panne, et c'est precisement pour cela que j'ai tourne en
rond quatre fois. Le rapport le montre desormais sans ambiguite, des deux cotes.

```
npm run typecheck   -> 0 erreur
npm test            -> 125 fichiers, 1199 tests
npm run build       -> 536,51 kB (gzip 154,03 kB), 2,33 s
```

### Limites connues

- **La branche d'avertissement n'est pas verifiee en conditions reelles** : mon
  contexte audio tourne, donc le cas `ctx !== 'running'` n'est atteint ici que
  par les tests unitaires de `AudioEngine`, pas a l'ecran.
- Le rapport vit dans le panneau « Etat (debug) », qui est repliable et ferme
  par defaut. L'avertissement, lui, s'affiche hors du panneau.

## Panneau Style/Preset/Palette/Texte/Macros reellement fonctionnel en direct

### Le probleme

Un test reel (Playwright, `__pulsarLiveDebug.sceneId` lu avant/apres chaque
clic — un hash d'image ne suffit pas, il change tout seul avec l'animation)
a confirme le signalement d'Aaron : aucun controle du panneau n'avait d'effet
en mode direct. Cause : deux moteurs de rendu separes, empiles sur deux
canvas differents (`#canvas`/`Scene`/`StepContext` pour le fichier,
`#live-canvas`/`LiveDirector`/`LivePipeline` pour le direct), jamais relies.

Deux tentatives precedentes dans cette session (masquer le panneau, puis le
remplacer par un panneau minimal scene/palette) ont ete rejetees par Aaron —
decidees et livrees sans lui demander avant. Toutes les deux annulees
(`git revert`) avant ce chantier.

### L'approche retenue

Plutot qu'etendre le systeme a 6 scenes, le VRAI moteur fichier (`Scene`/
`Layer`/8 styles/presets/macros/texte) tourne desormais en direct, alimente
par un nouveau pont causal :

- **`src/ui/live/bridge/LiveEventBridge.ts`** — traduit les signaux temps reel
  deja calcules par `LiveAnalysisEngine` en `MusicEvent[]` (KICK/SNARE/HAT
  passthrough, DOWNBEAT sur front de `barIndex`, DROP/BUILDUP/BREAK/SILENCE
  approximes depuis `SectionEnergy`).
- **`src/ui/live/bridge/LiveStepContextBridge.ts`** — construit un
  `StepContext` par image (pas de sous-pas fixe a 120 Hz — le direct n'a rien
  a rattraper). Sur les 12 champs du contrat, un seul — `section` — reste
  `null` : aucun equivalent causal a la matrice d'auto-similarite du mode
  fichier (a besoin du futur, voir `analysis/structure.ts`). Inclut un shim
  `MusicTimeline` complet (`LiveMusicTimeline`) pour les couches qui y
  accedent directement.
- **`src/ui/live/LiveManualOverride.ts`** — bascule automatique/manuel :
  le systeme a 6 scenes reste le comportement par defaut, inchange, tant que
  le panneau n'est pas touche. Un seul point d'accroche (`applyActiveConfiguration()`,
  ~20 appelants, tout changement de controle y passe) active le mode manuel.
- **`src/ui/App.ts`** — `loop()` bascule la source de `StepContext` quand le
  mode manuel est actif ; `#canvas` repasse au premier plan (`#live-canvas`
  MIS EN PAUSE, pas arrete — le tempo reste chaud, retour instantane sans
  reacquisition) ; bouton « Revenir a l'automatique » ; `#groupe-automation`/
  `#groupe-analyse` grises pendant tout le direct (reposent sur un fichier/
  une duree connus, absents en direct).

### Bug trouve et corrige pendant la verification

Premiere passe Playwright : les 8 styles changeaient bien l'etat interne
(`currentStyleId`, confirme par le hook de debug) mais **le canvas affichait
toujours l'ecran d'accueil** (« Glisse un fichier audio ici ») par-dessus le
rendu reel. Cause : `#dropzone` ne connait que le mode fichier — sans lui, il
restait affiche des lors qu'aucun fichier n'est charge dans PULSAR, ce qui
est TOUJOURS le cas en direct. Corrige : masque tant que le mode manuel est
actif, remis SEULEMENT si aucun fichier n'a par ailleurs ete charge.

### Verification

```
npm run typecheck   -> 0 erreur
npm test             -> 125 fichiers, 1199 tests, tous verts
npm run build        -> succes
```

Playwright, navigateur reel, WebRTC reel, contre le serveur de dev PUIS contre
la production apres deploiement :

- **8 styles** : etat reel avant/apres (`currentStyleId`), pas un hash
  d'image — 7/8 confirmes changer immediatement ; le 8e (Pulse) est le style
  par defaut deja actif, la garde anti-double-clic d'`AdvancedPanel` l'empeche
  a raison de se re-appliquer. Captures d'ecran : Aurore rend des rubans
  fluides magenta/violet, radicalement different de la grille par defaut —
  confirme en production, memes pixels que le serveur de dev.
- **Preset de genre** (« Trap Dark ») : change le STYLE (`field`) ET la
  palette d'un coup, comme en mode fichier (`Preset.style` prime).
- **Retour a l'automatique** : le systeme a 6 scenes reprend a une scene
  DIFFERENTE de celle laissee (`mandala-32` apres `grid-horizon`) — preuve
  que la mise en pause garde le moteur vivant en arriere-plan, pas fige.
- **Non-regression** : `liveManualActive` reste faux tant que rien n'est
  touche ; une session direct fraiche (fermeture/reouverture) redemarre
  proprement en mode automatique, aucun etat manuel qui fuit d'une session a
  l'autre.
- **Cycle complet** : regenerer un beat overlay ouvert ne casse pas la
  connexion WebRTC ; fermer/rouvrir fonctionne sans erreur console.
- **Session prolongee** : 9 changements de style consecutifs (~54 s, le pire
  cas pour l'allocation — chaque changement reconstruit toute la `Scene`) —
  tas JS entre 11 et 21 Mo, aucune tendance a la hausse, zero erreur console.
- **Production** : bundle reellement servi verifie (pas juste « deploiement
  reussi ») ; bouton, masquage de `#dropzone`, desactivation d'Automatisation/
  Analyse et rendu du style confirmes sur `pulsar-visualizer-aaron.netlify.app`.

### Hors perimetre, assume

`step.section` toujours `null` en direct. DROP/BUILDUP/BREAK/SILENCE sont une
approximation (depuis `SectionEnergy.arc`/`dropFired`), pas une reproduction
image-pour-image d'`analysis/macro.ts`. Automatisation et corrections d'Analyse
desactivees en direct — aucun des deux n'a de sens sans fichier de duree
connue.

## Grille « Scène automatique » — choisir une scène procédurale au même titre qu'un style

### La demande

Apres le chantier ci-dessus, Aaron : « il faudrait remettre aussi les visuels
dans la premiere version et les rajouter au style actuel ». Clarifie par deux
questions (AskUserQuestion) : il parle des 6 scenes procedurales d'origine
(grid-horizon, curl-flow, slice-displace, laser-tunnel, mandala-32, type-slam),
et il veut pouvoir CHOISIR l'une d'elles explicitement, au meme titre qu'un
Style — l'un OU l'autre, pas les deux en meme temps.

### Ce qui est ajoute

- **`LiveVisualPanel.selectSceneLocked(id)`** — choisit une scene ET la
  verrouille (`director.sceneLocked = true`) ; sans le verrou, le director
  automatique la remplacerait a la prochaine frontiere de phrase/mesure,
  contredisant le choix qui vient d'etre fait. `get sceneLocked`/`unlockScene()`
  pour la synchronisation UI et le retour a l'automatique.
- **Grille « Scene automatique »** (`ui/App.ts::ensureLiveSceneGrid`) —
  inseree juste apres `#style-grid`, meme classe `.style-tile` que le mode
  fichier pour la coherence visuelle. Une vignette par scene, desactivee sous
  `prefers-reduced-motion` si la scene n'est pas `reducedMotionSafe` (WCAG
  2.3.1, meme discipline que `INERT_MACROS`/`FlashLimiter` ailleurs dans ce
  fichier) — au lieu d'une redirection silencieuse vers une autre scene.
- **Trois etats, un seul a la fois** : AUTO (6 scenes auto-cyclees, defaut),
  SCENE-LOCKED (une scene choisie a la main, immobile), FILE-STYLE (le vrai
  moteur fichier, chantier precedent). Choisir un Style deverouille
  automatiquement une scene deja choisie (et vice-versa implicitement, la
  grille de scenes ne s'affiche que si aucun Style manuel n'est actif) — les
  deux grilles n'affichent donc jamais une selection en meme temps.

### Verification

```
npm run typecheck   -> 0 erreur
npm test             -> 125 fichiers, 1199 tests, tous verts
```

Playwright, navigateur reel : clic sur « Tunnel laser » -> `sceneId` devient
`laser-tunnel` et RESTE `laser-tunnel` 5 s plus tard (verrouille, ne derive
plus tout seul) ; vignette correctement surlignee (`aria-pressed`) ; bouton
« Revenir a l'automatique » apparait. Clic sur un Style ensuite -> repasse en
FILE-STYLE, la vignette de scene se desurligne toute seule. Clic sur
« Revenir a l'automatique » -> tout se reinitialise, bouton disparait. Zero
erreur console sur l'ensemble du parcours.

Deploye sur `pulsar-visualizer-aaron.netlify.app`, bundle reellement servi
verifie.

### Suite : icones sur les vignettes de scene

Retour d'Aaron : « ça a l'air de marcher mais il faut mettre des icônes comme
pour les autres » — les vignettes de style ont un aperçu rendu par le vrai
moteur (`styleThumbnails.ts`), celles de la grille « Scène automatique »
n'avaient qu'un texte.

**Pas un rendu réel du moteur direct**, contrairement aux styles : les
utilitaires capables de chauffer un `LiveAnalysisEngine` sur un signal
synthétique (`ui/live/testing/AnalyserModel.ts`, `SyntheticAudio.ts`,
`runEngine.ts`) portent une garantie explicite dans leur propre en-tête —
« jamais importé par le code d'application, donc absent du bundle de
production ». Les importer depuis `App.ts` aurait casse cette garantie.

**`src/ui/live/sceneIcons.ts`** (nouveau) — un dessin Canvas 2D statique,
simple, par scène (grille en perspective pour Horizon, courbes fluides pour
Flux, bandes decalees pour Tranches, anneaux concentriques pour Tunnel laser,
rayons radiaux pour Mandala, glyphe « Aa » pour Texte), dans le meme habillage
que les vignettes de style (canvas 160×90, fond sombre, accent violet).
`ensureLiveSceneGrid()` (App.ts) l'appelle une fois par vignette a la
construction.

Verifie : `npm run typecheck`/`npm test` verts, `npm run build` sans nouvel
import de `ui/live/testing/` (grep), capture d'ecran des 6 icones — toutes
distinctes et reconnaissables a la taille d'une vignette.

## Migration Netlify -> GitHub Pages

### Le probleme

Le compte Netlify d'Aaron a atteint la limite de son plan gratuit (compte
d'equipe `nf_team_dev`, aucun moyen de paiement enregistre) -- consequence du
volume tres eleve de deploiements effectues pendant cette session. `netlify
deploy --prod` echouait avec `Forbidden`. Aaron a signale, a raison, que ce
risque n'avait pas ete anticipe.

### Ce qui est fait

**`.github/workflows/deploy-pages.yml`** (nouveau) -- build + `typecheck` +
`test` + deploiement automatique sur GitHub Pages a chaque push sur `main`
(`actions/deploy-pages@v4`, pas de branche `gh-pages`). Gratuit, sans limite
de bande passante pratique pour ce site.

**`vite.config.ts`** -- `base` conditionne a `process.env.GITHUB_ACTIONS`
(vrai UNIQUEMENT dans ce workflow) : GitHub Pages sert le depot sous
`/Aarona/`, jamais la racine. Netlify (si un jour reactive) et le serveur de
dev local restent inchanges (`base: '/'`).

### Deux echecs successifs avant le run reussi (docs/JOURNAL, discipline
habituelle : reproduire avant de corriger)

1. **Run #1** : `npm ci` echoue en 13 s (avant meme `typecheck`). Reproduit
   localement -- `npm ci` reussit sans erreur sur Node 24 (l'environnement de
   dev). Correctif tente : aligner le workflow sur Node 24 (au lieu de 20).
2. **Run #2** : `build` reussit cette fois (57 s, typecheck+tests+build), mais
   `deploy` echoue : `Failed to create deployment (status: 404) ... Ensure
   GitHub Pages has been enabled`. GitHub Pages n'etait pas encore active sur
   le depot (`has_pages: false`, confirme via l'API) -- une action que seul
   Aaron pouvait faire (Settings -> Pages -> Source : GitHub Actions).
3. **Run #3** : reussi de bout en bout, apres qu'Aaron a active Pages.

### Verification finale

Playwright, navigateur reel, Beat Studio pointe sur
`https://gwada87-ux.github.io/Aarona` (nouveau `_VIZ_URL`) :

```
bundle reellement servi verifie -> chemins /Aarona/assets/... corrects
contenu du bundle verifie -> grille "Scene automatique" et icones presentes
```

Connexion WebRTC en direct etablie a travers l'iframe charge depuis la
nouvelle adresse, clic sur un style -> le vrai moteur prend la main (bouton
« Revenir a l'automatique » apparait, capture d'ecran a l'appui) -- confirme
que `postMessage(..., _VIZ_URL)` fonctionne correctement meme avec un
`_VIZ_URL` qui porte un chemin (`/Aarona`) et non plus seulement une origine.
Zero erreur console sur l'ensemble du parcours.

`_VIZ_URL` dans Beat Studio CDJ (fichier SOURCE, hors depot Git) mis a jour
directement : `https://gwada87-ux.github.io/Aarona`.

---

## 13 août 2026 — ADR-012 : canal de vérité PMDI en direct (Mode C)

Reclassement des priorités validé par Aaron le 12 août 2026, dans l'ordre :
1. canal de vérité Beat Studio → visualizer, 2. rendu GPU, 3. visuels
mélodie/accords. Le verrou « Mode C = V3 » est levé pour ce seul chantier.

`docs/15_ADR.md`, ADR-012 : événements PMDI sur un `DataChannel` de la
`RTCPeerConnection` existante, horodatés sur l'horloge audio de Beat Studio,
alignés par corrélation kicks annoncés ↔ onsets détectés (médiane glissante,
adoption après convergence, PLL en repli). L'analyse devient aligneur
d'horloge + repli. Le moteur visuel ne change pas. `AudioContext` partagé (I3)
reste la cible ; l'aligneur y deviendra l'identité.

Aucune ligne de code dans cette livraison — l'ADR est le préalable exigé.

---

## 13 août 2026 — ADR-012 lot 1 livré : horloge de vérité (canal PMDI live)

Nouveaux : `src/ui/live/truth/{TruthChannel,ClockAligner,TruthDirector}.ts`,
`tests/unit/live/liveTruth.test.ts` (6 tests, hôte synthétique à offset connu
12,345 s, lookahead 100 ms). Édités : `LiveConfig` (groupe `truth`),
`BeatClock` (mode vérité additif : `setTruthGrid`/`truthDownbeatAt`/
`clearTruth`, gardes `onKick`/`setTempo`/`closeBar`/`reArm`),
`LiveAnalysisEngine` (confiance 1 ; re-arm par dérive de tempo inhibé sous
vérité), `LiveAudioSource` (réception DataChannel `pmdi`, ajouts seulement),
`LiveVisualPanel` (câblage, `truth.step` après `engine.step`).

Portique : typecheck 0 erreur · 126 fichiers / 1205 tests verts (≥ 1199 tenu)
· test d'architecture vert · build 553,65 kB (gzip 159,33 kB).

Mesure notable, à lire avant de juger le critère « ±3 ms » de l'ADR-012 :
l'aligneur retrouve l'offset à ±3 ms **par rapport à la convention
d'horodatage du détecteur d'onsets**, qui porte elle-même un biais constant
d'environ 6,4 ms face aux instants nominaux du générateur synthétique — la
même constante que le PLL porte déjà (NOTES.md étape 1 : moyenne 5,3 ms), et
que la mire + `userTrimMs` calibrent. Gigue résiduelle de l'alignement < 3 ms,
cohérence absolue ≤ 10 ms, bascule vérité → PLL sans saut d'ancre > 15 ms par
trame (borné par `resyncMaxJumpMs`, structurel).

Reste ouvert : HUD sans affichage de l'état du canal (lot suivant) ;
événements exacts + anticipation (lot 2) ; émetteur côté Beat Studio
(lot 3, observation de `schedulerTick` derrière flag `_XXX_V1`) — sans lui,
le canal reste inerte en production, comportement identique à avant.

---

## 13 août 2026 — Mode C vérifié de bout en bout (ADR-012, lots 1+3)

Chaîne complète confirmée sur capture HUD d'Aaron, en conditions réelles
(Beat_Studio_CDJ_MOBILE_alpha16_PMDI_LIVE.html → Pages `index-DG_BwLbk.js`) :

```
verite   canal vivant   msgs 522/0/0   hote 150.90 BPM   paires 24 (+2 amb.)
         MAD 5.0 ms   offset -1.777 s   ACTIF
tempo    150.90 BPM (= hôte, exact)   downbeat 1.00   phrase valide   LOCKED
kicks    0/0 (le PLL ne juge plus, la grille hôte fait foi)
```

Corrigé dans la foulée : la ligne `tempo` du HUD affichait la confiance de
l'ESTIMATEUR (0.60) sous une ligne vérité ACTIF — elle affiche désormais
`effectiveConfidence` (ce que la machine à états consomme réellement), avec
l'estimateur entre parenthèses quand il diffère. Portique : 126/1205 verts.

Reste ouvert (inchangé) : lot 2 (événements exacts + anticipation ~100 ms),
validation à l'œil de la qualité de synchro perçue.

---

## 13 août 2026 — ADR-012 lot 2 : événements exacts + tir à l'instant visuel

En mode vérité, le rendu tire désormais sur les ANNONCES de l'hôte
(KICK/SNARE/CLAP/HAT, vélocités réelles composées) au lieu des détections, à
l'instant VISUEL exact : tFire = (tHost + offset) - syncOffset — la même
convention que `visualBeatPhase`. L'anticipation du scheduler hôte (~100 ms)
est ce qui rend le tir possible sans latence de détection. Le détecteur reste
l'aligneur, le taux d'onsets (mesure de l'AUDIO, via `rateFired`) et le repli.

Livré : file d'événements dans `TruthChannel` (rings parallèles, float32),
drainage + garde anti-rafale à l'activation dans `TruthDirector`,
mode vérité-événements dans `LiveAnalysisEngine` (`fireTruth`, accesseurs
unifiés `onsetTime`/`onsetStrength` consommés par `OnsetView` et le HUD),
compteur `evts` sur la ligne vérité du HUD. 2 nouveaux champs de config
(`eventRingSize`, `fireMaxLateSec`), tous consommés.

Côté Beat Studio : `Beat_Studio_CDJ_MOBILE_alpha16_PMDI_LIVE2.html`, flag
`_PMDI_LIVE_EVENTS_V1=true` (2 hunks, node --check OK) : familles SNARE/HAT
annoncées avec les mêmes règles que le KICK (un message par famille et par
instant, `_dpVel`, t+mt, piste inaudible jamais annoncée).

Portique : typecheck 0 · 126 fichiers / 1207 tests verts (+2) · build OK.
Tests clés : vélocités exactes au fround près, un tir par annonce (pas de
double tir détecteur+vérité), tir à ≤15 ms de la convention visuelle, trame
porteuse ≤2,5 intervalles, repli du rendu vers le détecteur vérifié.

Ajustement de mesure au passage : la décomposition biais/gigue du test lot 1
était fragile (le biais n'est mesurable qu'avant activation) — remplacée par
la borne exploitable : RMS total < 8 ms, sous le PLL seul (5,9 ms étape 1).

### Lot 2 vérifié de bout en bout (capture HUD d'Aaron, 13 août 2026)

`conf 1.00 (estimateur 0.60)` · `144.08 BPM` = hôte exact · `downbeat 1.00` ·
`phrase 2` avec coupe director `[phrase-score / phrase] db=1.00` (le repli
deux-mesures n'est plus nécessaire) · marqueurs `kick 0.81 / snare 0.33 /
hat 0.19` = vélocités composées (contre 1.00/0.48/1.00 côté détecteur sur la
capture de référence) · `MAD 4.5 ms`, 24 paires, 363 messages, 0 rejet.

L'ADR-012 est clos de bout en bout : vérité d'horloge (lot 1), événements
exacts (lot 2), émetteur Beat Studio (lot 3), le tout en production. Reste le
jugement esthétique continu d'Aaron, qui n'est pas un critère fermable.

---

## 13 août 2026 — ADR-013 lot 1 : WebGL2Renderer, parité SDR derrière l'opt-in

Nouveaux : `src/render/webgl2/{WebGL2Renderer,shaders,strokeGeometry,fillGeometry}.ts`,
`tests/unit/{strokeGeometry,fillGeometry}.test.ts` (8 + 6 tests — les parties
PURES du backend, testables en Node comme `bloomMath`). Édités (`ui/App.ts`,
4 hunks) : choix du backend (`?renderer=webgl2`, Canvas 2D par défaut, un seul
point de décision), repli `fallbackToCanvas2D()` sur contexte perdu (lu à
chaque frame après `endFrame`, sans écran noir), crochets de sonde
`setStyle`/`seek` dans `__pulsarDebug` (dev uniquement, méthode §10 — ils
serviront tels quels aux lots 2-3). `Canvas2DRenderer` : zéro ligne touchée.

**Décision de méthode consignée (la note ouverte d'ADR-013)** : le rendu GL
vit dans un OffscreenCanvas INTERNE, blitté vers le canvas d'affichage 2D
dans `endFrame()` — `drawImage` d'un canvas GL dans la MÊME tâche que le
rendu, donc défini sans `preserveDrawingBuffer`. Raison contraignante :
`FlashLimiter.dimTowards()` fait `getContext('2d')` sur le canvas
d'affichage ; un contexte WebGL dessus rendrait le survoile de sécurité
silencieusement inopérant (Loi 5), sans qu'aucun test ne le voie.
Corollaires gratuits : FlashLimiter inchangé, sonde `getImageData` identique
sur les deux backends, repli 2D sur le même canvas.

Architecture : couleurs prémultipliées ; `normal`/`additive`/`screen`/
`multiply` en blending fixe, `overlay`/`difference` par calque intermédiaire
+ passe de composition (ping-pong de deux textures de scène) ; sprites
rasterisés en OffscreenCanvas 2D (mêmes pixels) uploadés en textures,
instanciés ; traits extrudés CPU (mitre, testée) ; cercles en SDF ; bloom et
aberration en shaders sur les MÊMES constantes que `bloomMath`/
`chromaticMath` ; résolution interne = FBO réduit + agrandissement final.

**Deux corrections imposées par la sonde elle-même** (l'exécution trouve, la
lecture non) :
1. `fillPath` en éventail remplissait le creux des rubans CONCAVES d'`aurore`
   (luminance ×3, couverture ×14) — c'était précisément le point que
   l'ADR-013 demandait de « VÉRIFIER sur les 8 styles avant de
   sophistiquer ». Remplacé par une découpe d'oreilles (`fillGeometry.ts`).
   `monolith` en profite aussi (couverture +34 % → +2 %).
2. Sans anticrénelage, la couverture dérivait de −30 %/+37 % sur
   `spectrum-pro`/`iso-pulse` (bords durs des traits) — MSAA 4× sur les
   cibles scène/calque, résolution différée à la demande.

### Sonde comparative des 8 styles

Méthode : Playwright headless (SwiftShader), vite :5175, `loadDemo()`,
graine 123456 (champ `#seed-value`), `seek(6,0 s)` en pause amorcée,
2 `step(1/60)`, `getImageData` du canvas d'affichage 908×511 — identique sur
les deux backends grâce au blit (voir plus haut). Luma Rec.709 sur 0-255 ;
couverture = fraction de pixels à luma > 40.

| style | Canvas 2D (moy / couv / max) | WebGL2 (moy / couv / max) | Δ moy | Δ couv |
|---|---|---|---|---|
| pulse | 18,94 / 6,69 % / 114,8 | 19,04 / 6,29 % / 117,1 | +0,5 % | −6,0 % |
| field | 7,01 / 0,263 % / 255,0 | 6,95 / 0,285 % / 255,0 | −0,9 % | +8,3 % |
| spectrum-pro | 11,98 / 0,511 % / 120,6 | 12,37 / 0,539 % / 121,9 | +3,2 % | +5,7 % |
| monolith | 15,66 / 7,40 % / 145,6 | 15,60 / 7,57 % / 147,7 | −0,4 % | +2,2 % |
| iso-pulse | 12,51 / 1,18 % / 104,0 | 12,61 / 1,19 % / 104,8 | +0,8 % | +1,1 % |
| chambre | 14,09 / 0 % / 38,2 | 13,91 / 0 % / 36,9 | −1,3 % | = |
| eclats | 37,37 / 47,78 % / 71,7 | 37,26 / 47,87 % / 72,5 | −0,3 % | +0,2 % |
| aurore | 14,46 / 3,76 % / 62,0 | 14,33 / 3,43 % / 60,8 | −0,9 % | −8,9 % |

Critère ADR-013 (±25 %) : tenu partout, avec de la marge (pire cas : +3,2 %
en luminance moyenne, −8,9 % en couverture). Zéro erreur console sur les
deux chargements (seuls messages : `[debug] vite` et l'avertissement
`willReadFrequently` déclenché par la sonde elle-même, identique en
Canvas 2D). Signatures distinctes : oui, 8 triplets nettement différents.

### Portique

```
npm run typecheck   -> 0 erreur
npm test            -> 128 fichiers, 1221 tests verts (1207 -> 1221, +14)
npm run test:arch   -> 1 test vert (render/ -> core uniquement)
npm run build       -> 585,17 kB (gzip 167,67 kB), 2,19 s
```

`exportDeterminism` + golden export : verts — l'export reste sur Canvas 2D
au lot 1 (même backend), le critère « sur le même backend » d'ADR-013 est
tenu par construction.

### Limites connues

- Mitre écrêtée à `miterLimit × demi-largeur` au lieu d'un vrai biseau
  au-delà (différence sub-pixel sur les angles très fermés).
- Remplissage de fait en polygones SIMPLES (pair-impair ≈ nonzero pour tous
  les polygones que les styles produisent) — voir `fillGeometry.ts`.
- Coût de présentation : un `drawImage` plein cadre GL→2D par frame + 1 à 4
  blits de résolution MSAA — à mesurer au lot 2 contre le critère 60 fps p95
  (la sonde ne mesure pas la performance).
- `overlay`/`difference` composés PAR COUCHE (l'architecture d'ADR-013) : au
  sein d'une même couche, deux dessins qui se recouvrent se composent en
  `normal` entre eux.
- Sonde exécutée en headless SwiftShader (rendu logiciel) : chiffres sur GPU
  réel possiblement différents à la marge — le verdict à l'œil d'Aaron sur
  `?renderer=webgl2` reste la validation finale du lot.

---

## 13 août 2026 — ADR-013 lot 2 : pipeline HDR linéaire et tone mapping

Nouveaux : `src/render/webgl2/hdrMath.ts` (+ `tests/unit/hdrMath.test.ts`,
11 tests — sRGB exact, ACES, AgX, courbe retenue, chaîne MIP). Édités :
`shaders.ts` (bright-pass physique, tonemap tri-courbe, décodage sRGB des
sprites APRÈS filtrage, dégradés interpolés en sRGB à sortie linéaire, bornes
d'alpha), `WebGL2Renderer.ts` (cibles RGBA16F + MSAA flottant, chaîne MIP du
bloom, passe tonemap vers une image d'affichage RGBA8, aberration
post-tonemap, copies par blit — copyTexSubImage2D est interdit entre formats
flottants), `ui/App.ts` (1 hunk : `?tonemap=` / `?exposure=`).
`Canvas2DRenderer` : zéro ligne. Sans `EXT_color_buffer_float`, repli SDR =
chemin du lot 1 à l'identique.

### La courbe — tranchée à la mesure, et ce n'est aucune des deux candidates

ACES (Narkowicz) et AgX (ajustement minimal) sont implémentées et mesurées
sur les 8 styles : leur PIED de courbe écrase les fonds très sombres — qui
sont l'esthétique même de ce produit — de 50 à 80 % (coin de `spectrum-pro` :
(20,10,36) → (3,2,9) sous ACES à exposition 1), et aucune exposition globale
ne remonte les fonds sans surexposer le reste (erreur moyenne ≥ 28 % sur tout
le balayage exposition × courbe). Courbe RETENUE : `pulsar` (épaule seule) —
IDENTITÉ stricte sous un pivot 0,8 (tout le contenu SDR traverse intact, la
parité des fonds est structurelle), épaule exponentielle C¹ au-dessus,
asymptote 1 : l'énergie additive accumulée au-delà du pivot roule vers le
blanc au lieu d'écrêter — l'objectif du lot. ACES et AgX restent comparables
au navigateur : `?renderer=webgl2&tonemap=aces|agx&exposure=N`.

### Le vrai bug du lot — l'alpha ACCUMULÉ des buffers flottants

En RGBA8, l'alpha écrête à 1 ; en RGBA16F, les fusions additives l'ACCUMULENT
au-delà. Trois conséquences corrigées, trouvées à la sonde (l'exécution
trouve, la lecture non) :
1. le tonemap « déprémultipliait » en divisant par cet alpha — TOUTE l'image
   était divisée par ~1,55 (le bright-pass recopiait en plus l'alpha partout,
   et la composition additive du bloom le gonflait sur tout le cadre). La
   scène étant OPAQUE par construction (le clear pose a = 1), la radiance
   finale est `c.rgb`, sans division ;
2. le bright-pass émet désormais un alpha NUL (le bloom ajoute de la lumière,
   pas de la couverture) ;
3. le blit générique et la composition overlay/difference bornent l'alpha lu
   à 1 (sinon `ONE_MINUS_SRC_ALPHA` donne un poids négatif au fond).

Un « gain émissif » sur les dessins additifs avait été introduit pour
compenser l'assombrissement (−56 à −80 % sur les styles à glows) — il ne
compensait que ce bug : une fois l'alpha corrigé, la mesure a donné le gain
NEUTRE comme meilleur réglage global, et le mécanisme a été retiré.

### Sonde des 8 styles (pulsar, exposition 1 — mêmes conditions que le lot 1)

| style | Canvas 2D (moy / couv / max) | WebGL2 HDR (moy / couv / max) | Δ moy |
|---|---|---|---|
| pulse | 18,94 / 6,69 % / 114,8 | 21,78 / 12,77 % / 114,2 | +15,0 % |
| field | 7,01 / 0,26 % / 255,0 | 8,11 / 0,96 % / 172,0 | +15,5 % |
| spectrum-pro | 11,98 / 0,51 % / 120,6 | 12,63 / 0,63 % / 115,1 | +5,4 % |
| monolith | 15,66 / 7,40 % / 145,6 | 16,62 / 8,74 % / 134,1 | +6,1 % |
| iso-pulse | 12,51 / 1,18 % / 104,0 | 12,79 / 2,09 % / 105,2 | +2,3 % |
| chambre | 14,09 / 0 % / 38,2 | 19,40 / 0,55 % / 71,7 | +37,7 % |
| eclats | 37,37 / 47,78 % / 71,7 | 43,66 / 77,80 % / 73,8 | +16,8 % |
| aurore | 14,46 / 3,76 % / 62,0 | 23,62 / 30,13 % / 86,6 | +63,4 % |

Zéro erreur console. **Critère « aucun style ne sature » : tenu avec une
marge énorme** (pire luminance moyenne : 43,7 / 255 = 0,17, critère < 0,55).
`chambre`/`aurore` sont nettement plus lumineux : c'est l'empilement de
bandes TRANSLUCIDES composé en linéaire — plus dense et plus saturé par
nature, pas un défaut mesurable (captures avant/après remises à Aaron, c'est
son œil qui tranche). Le max de `field` passe de 255 (écrêté blanc) à 172 :
les cœurs saturés GARDENT leur teinte au lieu de blanchir — le comportement
HDR attendu.

### Réglages exposés (liste demandée par docs/20 SESSION B)

`DEFAULT_TONE_MAP` ('pulsar'), `PULSAR_SHOULDER_PIVOT` (0,8), `HDR_EXPOSURE`
(1), `BLOOM_THRESHOLD_LINEAR` (srgbToLinear(200/255) ≈ 0,578),
`BLOOM_INTENSITY` (0,55, réparti sur les niveaux), `BLOOM_LEVEL_SIGMA`
(2 px/niveau), profondeur de chaîne = `passes + 2` niveaux (bornée à 8 px).
URL : `?tonemap=pulsar|aces|agx`, `?exposure=N`.

### Portique

```
npm run typecheck   -> 0 erreur
npm test            -> 129 fichiers, 1232 tests verts (1221 -> 1232, +11)
npm run test:arch   -> 1 test vert
npm run build       -> 594,51 kB (gzip 170,81 kB), 2,54 s
```

### Performance — critère 60 fps p95 : à confirmer sur la machine d'Aaron

La sonde tourne en headless SwiftShader (rendu 100 % LOGICIEL : chaque
shader émulé au CPU) : 781 ms p50 / 1908 ms p95 par frame en 1080p contre
144 ms en Canvas 2D — ces chiffres ne disent RIEN d'un GPU réel, où ces
passes sont massivement parallèles. Procédure de mesure réelle : ouvrir
`?renderer=webgl2`, style `field`, qualité HIGH, fenêtre au premier plan,
panneau debug ouvert — lire p50/p95/p99. C'est le critère d'ADR-002/013.

### Limites connues

- `chambre` +38 % / `aurore` +63 % de luminance moyenne (empilement
  translucide en linéaire) — verdict à l'œil, l'exposition URL permet de
  moduler pour comparer.
- `screen` reste en fusion fixe sur valeurs linéaires : écart doux vs le
  screen sRGB de Canvas sur les couches de variante qui l'utilisent.
- Perf GPU réel non mesurée ici (voir ci-dessus) — le blit final GL→2D et
  1-4 résolutions MSAA 16F par frame sont les suspects à surveiller.
- Le tonemap suppose la scène OPAQUE (vrai pour tous les styles : clear
  systématique). Un style futur qui rendrait sur fond transparent devrait
  revisiter la note d'alpha ci-dessus.

---

## 13 août 2026 — ADR-013 lot 3 : WebGL2 par défaut, aperçu ET export

Nouveaux : `src/render/backendChoice.ts` (décision PURE + `tests/unit/
backendChoice.test.ts`, 7 tests), `src/render/createRenderer.ts` (fabrique
unique + `disposeRenderer`). Édités : `WebGL2Renderer` (`dispose()`, blit
final durci), `createOffscreenExportTarget` (backend transmis + `dispose`),
`ui/App.ts` (fabrique, `?renderer=` élargi, libération après export fixe),
`ui/dialogs/ExportDialog.ts` (même backend, libération dans le `finally`),
`ui/styleThumbnails.ts` (commentaire : Canvas 2D délibéré), `docs/10`.

### La décision structurante : l'export bascule AVEC l'aperçu

C'était la question ouverte du lot. Laisser l'export en Canvas 2D aurait eu
deux conséquences inacceptables : l'aperçu montrerait le « look » HDR du
lot 2 et la vidéo livrerait autre chose — l'aperçu MENTIRAIT sur le fichier —
et le critère golden « preview ≡ export (< 2 % de pixels) » comparerait deux
rasterizers différents, exactement ce qu'ADR-013 exclut (« sur le MÊME
backend »). Les deux passent donc par `createRenderer`.

Conséquence d'architecture : la fabrique vit dans `render/`, pas dans `ui/` —
`export/` en a besoin et n'a pas le droit d'importer `ui/` (docs/02). La
DÉCISION de l'utilisateur reste bien dans `ui/`, qui lit `?renderer=` et
passe l'`override` ; la fabrique ne connaît ni URL ni DOM. Test
d'architecture vert, `render/ -> core` inchangé.

### Deux gardes que la mise en production exigeait

1. **Libération du contexte GL après chaque export.** Un navigateur borne le
   nombre de contextes WebGL vivants (~16) et tue le PLUS ANCIEN au-delà —
   c'est-à-dire celui de l'aperçu. Sans libération, une dizaine d'exports
   auraient fait basculer l'aperçu en Canvas 2D sans que rien ne l'explique.
   `WebGL2Renderer.dispose()` (`WEBGL_lose_context`) est appelé dans le
   `finally` des deux chemins d'export, et par le repli sur contexte perdu.
   **Vérifié : 6 exports successifs, l'aperçu rend toujours en WebGL2.**
2. **Blit final en espace écran garanti.** Le canvas d'affichage n'appartient
   pas qu'au renderer : le `FlashLimiter` y écrit, et en session directe le
   pipeline live aussi. Une transformation laissée par un autre écrivain
   aurait décalé l'image entière. Le blit est désormais encadré par
   `save`/`setTransform(identité)`/`restore` — un par image, pas un par
   primitive.

**Les vignettes de style restent Canvas 2D, délibérément** : huit contextes
WebGL recréés à chaque changement de palette évinceraient celui de l'aperçu,
et une vignette 160×90 ne montre ni halo étendu ni haute lumière.

### Vérification au navigateur (sonde headless, style `field`, t = 6 s)

| | contextes WebGL2 | luminance max | export d'image fixe |
|---|---|---|---|
| **sans paramètre (défaut)** | 1 (aperçu) → 2 (export) | **172** | PNG 1920×1080, 355 Ko |
| **`?renderer=canvas2d`** | **0** | **255** | PNG 1920×1080, 947 Ko |

Les deux signatures sont sans ambiguïté : le défaut crée un contexte GL et la
luminance max plafonne à 172 (le cœur de `field` GARDE sa teinte), tandis que
le repli forcé n'en crée aucun et écrête à 255 (blanc pur, signature 8 bits).
Le second contexte au moment de l'export prouve que l'export suit bien
l'aperçu ; il retombe à zéro création supplémentaire quand `canvas2d` est
forcé. **Zéro erreur console, zéro repli intempestif dans les deux cas.**

### Portique

```
npm run typecheck   -> 0 erreur
npm test            -> 130 fichiers, 1239 tests verts (1232 -> 1239, +7)
npm run test:arch   -> 1 test vert
npm run build       -> 595,19 kB (gzip 171,09 kB), 2,26 s
```

`exportDeterminism` reste vert et le RESTERA quel que soit le backend : il
teste la séquence de sous-pas, pas les pixels (voir son en-tête).

### Ce qui reste ouvert — et c'est à Aaron

- **Le critère 60 fps p95 en 1080p n'est PAS vérifié.** La sonde tourne en
  SwiftShader (rendu logiciel) : ses temps ne disent rien d'un vrai GPU.
  Procédure de mesure en 5 minutes dans `docs/10_PERFORMANCE.md` (panneau de
  debug, fenêtre au premier plan). **Si le p95 dépasse 16,6 ms sur ta
  machine, `?renderer=canvas2d` rétablit l'état d'avant immédiatement**, et
  la bascule se rediscute.
- **`QualityGovernor`/`qualityLevels` non ré-étalonnés, délibérément** :
  leurs seuils viennent de mesures Canvas 2D réelles ; les remplacer par des
  valeurs déduites d'un rendu logiciel serait pire que ne rien changer.
- Le critère produit de `01_VISION.md` — « le rendu est jugé pro sur
  comparaison à l'aveugle » — n'est pas fermable par une mesure : c'est le
  verdict d'Aaron, sur le tour complet import → aperçu → export.

---

## 13 août 2026 — ADR-013 lot 4 : l'ADR du portage GPU du pipeline live (ADR-014)

Livrable de la SESSION D, dont le mandat est explicite : « écris l'ADR […]
puis attends ma validation avant toute ligne de code ». **Aucune ligne du
pipeline live n'a été touchée** — l'entrée qui suit résume ce que la mesure a
appris, la décision revient à Aaron.

Édités : `docs/15_ADR.md` (ADR-014), `docs/20_FEUILLE_DE_ROUTE_SESSIONS.md`
(état de la SESSION D, renumérotation de la SESSION E en ADR-015).

### Ce que la mesure a appris — et qui change la réponse

Le périmètre réel du portage est de **≈ 3 410 lignes** (`LivePipeline` 634,
`LayerStack` 320, `Bloom`/`PostFX`/`Feedback`/`Camera` 720, `Assets` 231, les
6 scènes 1 505), sous **130 tests live** dont ceux d'ADR-012, en production.

L'option (b) — « faire passer les scènes live par l'interface `Renderer` » —
se heurte à un mur chiffré : les scènes reçoivent un
`CanvasRenderingContext2D` BRUT, et utilisent **sept capacités que `Renderer`
n'expose pas** (texte, `clip`, calques par scène, transformation affine
arbitraire, dégradé linéaire, lecture arbitraire de la trame précédente,
`lineCap`), dont **quatre pour la seule scène `type-slam`**. Les ajouter
signifierait quatorze implémentations (deux backends) et transformerait
`Renderer` en API Canvas 2D généraliste — l'inverse exact du choix d'ADR-002,
dont l'étroitesse (17 opérations) est précisément ce qui a permis d'écrire un
second backend en un seul lot.

Le fait qui pèse le plus lourd n'est pas un coût, c'est une CONSTATATION :
**le mode direct MANUEL profite déjà de WebGL2 depuis le lot 3.** Toucher un
contrôle du panneau en session directe active `liveManualOverride`, met le
système à 6 scènes en pause et laisse dessiner le vrai moteur fichier — donc
en WebGL2 HDR. ADR-013 disait déjà « le mode direct manuel, là où Aaron
vit ». Le seul chemin resté en Canvas 2D est le système AUTOMATIQUE.

### Recommandation, et la mesure qui tranche

(c) maintenant — ne rien réécrire — assorti d'un **critère de bascule chiffré
vers (a)**, dans l'esprit du critère que l'ADR-002 s'était fixé à l'avance :

> En session directe réelle, fenêtre au premier plan, le HUD (touche `D`)
> montre-t-il `FrameBudget` stabilisé au **niveau 1 ou 0** ? Si oui, le mode
> live rend en permanence une version amputée de lui-même (sans feedback, ou
> sans grain ni seconde échelle de bloom) et l'option (a) s'ouvre. Si le
> niveau reste à **2 ou 3**, le compositeur tient le budget et le portage n'a
> pas d'objet.

`FrameBudget` documente lui-même pourquoi la mesure ne peut pas se faire
autrement : « un `performance.now()` autour du code de rendu renvoie ~2 ms
alors que le GPU en met 30 — le travail Canvas 2D est soumis de façon
asynchrone ». Le seul juge est le delta de `requestAnimationFrame`, donc le
niveau de qualité que le gouverneur finit par tenir.

### Portique

Aucun code modifié : `npm test` reste à 130 fichiers / 1239 tests verts
(état du lot 3, commit `e6a84b4`). Deux fichiers de documentation édités.

### Ce qui reste ouvert

- **La décision d'Aaron sur ADR-014**, après la mesure de dix secondes
  ci-dessus.
- Le chantier GPU d'ADR-013 est par ailleurs CLOS pour les lots 1-3 ; restent
  en attente de son verdict : la mesure 60 fps p95 du lot 2 et le jugement à
  l'œil sur la bascule du lot 3.
- Si la mesure conclut à (c), la prochaine session utile est la **SESSION E**
  (visuels mélodie/accords, priorité n° 3), dont l'ADR devient l'**ADR-015**.

---

## 13 août 2026 — ADR-015 lot 1 : la couleur suit l'harmonie (cercle des quintes)

Ouverture du chantier mélodie/accords, priorité n° 3 d'Aaron. ADR-015 écrit
PUIS exécuté, conformément au mandat de la SESSION E.

Nouveaux : `src/ui/live/util/tonalHue.ts` (pur), `tests/unit/live/tonalHue.test.ts`
(15 tests). Édités : `TruthChannel` (payloads `chord`/`note`, anneau
d'accords), `TruthDirector` (accord courant + centre tonal, installés à
l'instant visuel), `render/Palette.ts` (décalage de teinte borné et glissé),
`LiveVisualPanel` (câblage), `liveTruth.test.ts` (5 tests ajoutés, bloc
additif — les tests d'ADR-012 ne sont pas touchés).

### Le piège que la lecture du code a évité

`render/Palette.ts` §3.5 interdit noir sur blanc « la rotation de teinte
pilotée par l'index d'un élément ou par le temps parcourant le cercle
chromatique — c'est la signature de l'amateurisme », et borne toute modulation
temps réel à `hueModulation` (8 à 24° selon la palette). Un chantier « la
couleur tourne avec la musique » passait donc à un cheveu de l'interdit.

Deux décisions l'en sortent :

1. **La teinte est fonction de l'HARMONIE, jamais de l'index ni de
   l'horloge** — retirer l'audio supprime l'effet (critère §6.1).
2. **La borne est tenue par PARTAGE DE BUDGET, pas par superposition.**
   L'accord et la modulation par élément puisent dans la même enveloppe : ce
   que l'accord consomme est retiré à `hexModulated`. L'excursion totale d'un
   élément reste `≤ hueModulation`, exactement comme avant — l'invariant reste
   STRUCTUREL, et un test le vérifie sur les 8 palettes. À décalage nul (aucun
   accord annoncé), `perElement` vaut `modulation` et la teinte de base est
   inchangée : le rendu est alors rigoureusement identique à celui d'avant.

### Le cercle des quintes plutôt que `pitchClass / 12`

Une correspondance linéaire rendrait Do et Si visuellement VOISINS alors
qu'ils sont harmoniquement éloignés, et Do et Sol ÉLOIGNÉS alors qu'ils sont
les plus proches parents qui soient. La distance en quintes, elle, est
proportionnelle à l'écart perçu — et elle est mesurée depuis le CENTRE TONAL
(le premier accord annoncé), si bien que le morceau se colore à la teinte de
sa palette au repos et ne s'en écarte que lorsqu'il module. La discontinuité
inévitable — comprimer un cercle de douze sur un arc borné en casse forcément
la continuité quelque part — tombe sur le triton, c'est-à-dire l'accord le
plus lointain : le saut y est musicalement juste.

### Deux comportements que le banc a révélés (et que l'ADR décrivait)

Le test de bout en bout a d'abord échoué, et c'est le TEST qui avait tort —
deux fois :

- à l'activation de la vérité, les accords annoncés pendant l'acquisition
  s'installent d'un coup ; trois accords périmés en une trame ne laissent
  qu'un seul état final, le dernier. Le centre tonal, lui, reste bien le
  PREMIER accord annoncé ;
- ce premier install tombe donc à l'instant de la convergence, pas à celui de
  son accord. Le contrôle temporel ne vaut qu'en régime établi — où il tient
  à moins de 50 ms de la convention visuelle `tHost + offset − syncOffset`,
  la même que les frappes du lot 2 d'ADR-012.

### Portique

```
npm run typecheck   -> 0 erreur
npm test            -> 131 fichiers, 1259 tests verts (1239 -> 1259, +20)
npm run test:arch   -> 1 test vert
npm run build       -> 597,44 kB (gzip 171,69 kB), 2,66 s
```

Les tests `liveTruth` d'ADR-012 restent verts **sans modification** (règle 3
de `docs/20`) : les cinq tests ajoutés le sont dans un bloc `describe` séparé.

### Ce qui reste — et pourquoi le chantier n'est pas encore VISIBLE

- **Le lot 1 est INERTE tant que Beat Studio n'émet pas d'accords** : aucun
  message `chord` n'arrive, le décalage reste nul, le rendu est identique à
  avant. Même discipline que le lot 1 d'ADR-012, qui a attendu son émetteur.
  **C'est le lot 2 (émetteur `_PMDI_LIVE_NOTES_V1` côté alpha20) qui rendra
  l'effet visible** — et c'est lui qu'il faut faire avant tout verdict à
  l'œil.
- Le moteur FICHIER (donc le mode direct MANUEL) ne reçoit pas l'effet : ses
  couches capturent la palette dans `init()`, et la changer par mesure
  recréerait tous les sprites en pleine boucle de rendu. Raison mesurée,
  consignée dans l'ADR-015, à rouvrir seulement si le verdict le justifie.
- Une palette monochrome (`graphite`, 8°) ne montrera qu'un effet ténu :
  c'est voulu, la palette reste le choix artistique dominant.

---

## 13 août 2026 — ADR-015 lot 2 : l'émetteur Beat Studio (notes et accords en direct)

Livré : `Beat_Studio_CDJ_MOBILE_alpha21.html` (= alpha20 + 2 hunks additifs).
Le lot 1 cesse d'être inerte : le canal transporte enfin de l'harmonie.

**Format du fichier hôte — piège évité.** `alpha21` est au format
`text/x-dc` (le code applicatif vit dans `<script type="text/x-dc">`), donc
s'édite DIRECTEMENT par remplacement de chaîne exact. `bundle.py` ne concerne
que la lignée `v16_*` (code encodé en JSON dans `<script
type="__bundler/template">`) : l'appliquer ici n'aurait rien donné de bon.
Vérifié avant la première édition, pas supposé.

### Les deux hunks

1. Drapeau `_PMDI_LIVE_NOTES_V1` dans le bloc de flags.
2. `_pmdiLiveSchedule` appelle `_pmdiLiveEmitTonal(t, step, stepDur, p)`,
   nouvelle méthode voisine de `_pmdiLiveEmitHit`.

`diff` : **2 hunks, 52 lignes ajoutées, 0 supprimée.** Rien n'est retiré ni
déplacé, l'invariant de timing du scheduler n'est pas touché — l'émission
OBSERVE, elle ne replanifie rien (même discipline que les lots 3 et 3b).

**Aucune logique harmonique nouvelle.** La conversion est strictement celle de
l'export PMDI statique (`_PMDI_NOTES_V1`) : `NOTES[nm]` →
`_midiFreqToNoteNumber` pour les notes, `_chordNoteNamesToPitchClasses` +
`_detectChordName` pour la fondamentale et la qualité. La dupliquer autrement
aurait été le seul moyen sûr de la faire diverger de l'export.

Règles des frappes reprises telles quelles : instant `t + mt` (celui que
`playCell` utilise pour le son), vélocité réelle via `_dpVel`, **piste
inaudible jamais annoncée**. L'accord n'est émis qu'au pas 0 de chaque mesure
— il décrit la mesure entière, et côté visualizer il s'INSTALLE jusqu'au
suivant au lieu de se tirer comme une frappe.

### Vérification par EXÉCUTION (Playwright, `file://`, DataChannel espionné)

Le DataChannel PMDI est remplacé par un espion, un beat est généré, la lecture
lancée, et on lit ce que l'hôte annonce réellement :

```
messages : 201   ->   chord 6 · note 77 · event 95 · tempo 23
accords : root 9 / 2 / 2 / 7      dur 1,567 s (= 16 x stepDur, une mesure)
notes   : midi 62/61/62/61  velocity 0,395 / 0,087 / 0,224  track "piano"
fondamentales hors 0..11 : 0      hauteurs invalides : 0      erreurs page : 0
```

**Drapeau à `false`, même scénario : `event 84 · tempo 20`, zéro note, zéro
accord** — exactement le comportement d'alpha20. La règle « flag éteint =
sortie identique » est donc vérifiée par exécution, pas seulement par lecture.

### Ce que la mesure a appris — `quality` vaut souvent « ? »

Les accords annoncés portent `quality: "?"` ou `"?maj7"`. Ce n'est pas un
défaut de ce lot : `_detectChordName` ne reconnaît que les triades standard
(majeur, mineur, dim, aug) et annote `?` pour tout le reste — or les accords
générés n'en sont pas toujours. **La même chaîne figure dans un fichier
`.pmdi.json` exporté pour le même accord** : la parité export statique /
canal direct est intacte, ce qui est précisément la propriété recherchée.

La FONDAMENTALE, elle, est correcte et c'est la seule donnée que le lot 1
consomme : `_detectChordName` la dérive de `pcs[0]`, exactement la valeur
envoyée dans `root`.

À garder en tête pour le lot 3 (scène vitrine) : si `quality` devait piloter
quelque chose de visible, il faudrait d'abord améliorer `_detectChordName` —
ce qui changerait AUSSI l'export statique, donc un lot à part, avec son propre
drapeau.

### Écart assumé avec le texte de l'ADR-015

L'ADR annonçait le drapeau « à `false` par défaut ». Il est livré à **`true`**,
pour la même raison que `_PMDI_LIVE_EVENTS_V1` au lot 2 d'ADR-012 : sans lui
le chantier reste invisible et aucun verdict n'est possible. Le risque est nul
— l'émission est doublement gardée en amont (`_PMDI_LIVE_V1` et un
DataChannel ouvert), n'existe donc que lorsqu'un visualizer est connecté, et
ne touche à aucun chemin audio. Passer le drapeau à `false` rétablit alpha20 à
l'identique, ce qui est vérifié ci-dessus.

### Ce qui reste

- **Le verdict à l'œil d'Aaron, sur un de SES beats** : lancer alpha21 avec le
  visualizer connecté et regarder si la couleur suit l'harmonie. C'est le
  différenciateur produit — il doit se VOIR. Rappel : l'effet est BORNÉ par
  `hueModulation` (8 à 24° selon la palette), c'est une dérive, pas un
  arc-en-ciel ; et il n'agit que sur le mode live AUTOMATIQUE (pas sur le
  mode direct manuel, raison mesurée dans l'ADR-015).
- Lot 3 : la scène vitrine qui VOIT la mélodie (les 77 notes par run
  ci-dessus prouvent que la matière est là).

---

## 13 août 2026 — ADR-015 lot 3 : `note-helix`, la scène qui VOIT la mélodie

Le chantier mélodie/accords est complet : le lot 1 colorait, le lot 2 émettait,
le lot 3 DESSINE.

Nouveaux : `src/ui/live/scenes/NoteHelixScene.ts` (7e scène du registre).
Édités : `scenes/types.ts` (`NoteSet`, `LiveFrame.notes`), `TruthChannel`
(anneau de notes), `TruthDirector` (tampon de trame pré-alloué),
`LiveVisualPanel` (câblage), `scenes/index.ts`, `liveScenes.test.ts` (table
§4.2 étendue), `liveTruth.test.ts` (3 tests ajoutés).

### La géométrie : l'hélice des hauteurs

Une note se place en polaire : sa **classe de hauteur** donne l'ANGLE (cercle
chromatique), son **octave** donne le RAYON. Un la est donc toujours sur le
même rayon, quelle que soit l'octave, et les octaves s'empilent vers
l'extérieur. C'est l'hélice des hauteurs, un objet de théorie musicale — pas
une disposition décorative : une mélodie y **dessine une forme reconnaissable**,
et deux notes à l'octave tombent sur le même rayon, ce qu'aucun piano-roll ne
montre. Un arc relie chaque note à la précédente : la ligne mélodique se trace
elle-même.

La teinte d'une étoile suit sa position sur le **cercle des quintes**, pas sur
l'index de sa classe de hauteur — deux notes harmoniquement voisines reçoivent
donc des teintes voisines, et une gamme chromatique ne produit pas un balayage
arc-en-ciel. Même raisonnement qu'au lot 1, même module (`util/tonalHue.ts`),
et la modulation passe par `hexModulated`, bornée par construction.

### Pourquoi ce n'est pas un analyseur (§6.1)

Retirer l'audio ne laisse ni écran vide ni nappe de barres : les douze rayons
et les anneaux d'octave existent en propre, respirent, et l'ensemble dérive
lentement ; le noyau bat sur le kick. Les notes ALLUMENT cette structure, elles
ne la constituent pas. Et surtout — c'est le fond de l'affaire — ce qui est
montré n'est **pas mesurable par une analyse spectrale** : ce sont les notes
COMPOSÉES, annoncées par l'hôte avant même d'avoir sonné. C'est exactement ce
que le canal de vérité rend possible et qu'aucun visualizer par analyse ne peut
imiter.

### Une décision de test à assumer

Les tests figeaient la table §4.2 par `SCENE_REGISTRY.length === 6` et par la
liste exacte des scènes jouables en mouvement réduit. Une 7e scène les casse.
Plutôt que d'assouplir ces assertions, la table de la **passe 1 reste
intacte** et une seconde liste, explicite, porte les ajouts postérieurs
(`HORS_PASSE_1`) : une scène de plus ne doit jamais pouvoir masquer une
régression sur les six d'origine. Le registre était conçu pour cette extension
(« ajouter une scène = ajouter une entrée ici »).

### Transport des notes — zéro allocation, zéro effet de bord

`LiveFrame.notes` est **optionnel** à dessein : les constructeurs de trame qui
ne le fournissent pas (banc de mesure) restent valides sans modification, et
une scène qui l'ignore se comporte exactement comme avant. Le tampon
(`NOTE_FRAME_CAP = 24`) est pré-alloué et vidé à chaque trame, y compris hors
mode vérité — une scène ne voit donc jamais les notes de la trame précédente,
ni celles d'une session perdue.

Une note est traitée comme une **impulsion**, pas comme un état : trop en
retard, elle est jetée (`fireMaxLateSec`), et la rafale d'activation est
sautée. Une note qui apparaîtrait une seconde après avoir été entendue serait
pire qu'absente. C'est l'inverse de l'accord du lot 1, qui s'installe.

### Portique

```
npm run typecheck   -> 0 erreur
npm test            -> 131 fichiers, 1262 tests verts (1259 -> 1262, +3)
npm run test:arch   -> 1 test vert
npm run build       -> 602,98 kB (gzip 173,25 kB), 2,33 s
```

Les 24 invariants de scène (§3.6, §6, particules) passent sur `note-helix`
sans exception accordée : aucune coordonnée en pixels, aucun `hsl()`, aucun
`Math.random` dans `render`, une variante décentrée, `resetCompositing` en
sortie.

### Ce qui reste

- **Le verdict à l'œil, et il est enfin possible** : alpha21 + visualizer,
  mode live AUTOMATIQUE, et laisser le director amener `note-helix` (plage
  d'intensité 0,2-0,8) — ou la verrouiller à la main depuis le panneau.
- La scène ne consomme pas encore `quality` (majeur/mineur) : le lot 2 a
  montré que `_detectChordName` retourne souvent `?`, améliorer la détection
  changerait aussi l'export statique. Lot séparé si le besoin se confirme.

---

## 13 août 2026 — SESSION F : l'anticipation devient visible (retenue avant impact)

ADR-012 promettait que l'avance d'annonce (~100 ms) serait « exposée au
dispatcher ». Elle l'est enfin, et surtout : **quelque chose s'en sert.**

Édités : `scenes/types.ts` (`Anticipation`, `LiveFrame.anticipation`),
`TruthDirector` (mesure de l'avance), `LiveVisualPanel` (câblage),
`Mandala32Scene` (le consommateur), `liveTruth.test.ts` (3 tests ajoutés).

### La règle « pas d'API sans consommateur », tenue

L'exposition et son usage sont livrés dans le MÊME lot, comme `docs/20` le
demandait. Une API d'anticipation sans scène qui s'en serve n'aurait été
qu'une promesse de plus à maintenir.

### Ce que ça change à l'écran

`mandala-32` **arme** désormais son onde de choc au lieu de seulement y
réagir : pendant les 60 ms qui précèdent un kick ANNONCÉ, un anneau fin
converge vers le noyau, et le noyau se CONTRACTE — puis l'onde repart de
l'endroit exact où l'anneau arrive. Deux gestes opposés, donc lisibles l'un
après l'autre : on voit le système INSPIRER avant de frapper.

C'est la première chose du produit qu'aucune analyse ne pourra jamais faire.
Un détecteur ne connaît le passé qu'après coup ; seule la vérité annoncée
permet de se préparer. C'était l'argument central d'ADR-012 — il est
maintenant démontré à l'image, pas seulement dans un ADR.

### Inerte par construction

`nextIn(kind)` vaut `+Infinity` quand rien n'est annoncé — sans canal, sur du
son externe, ou avant convergence de l'aligneur. La charge est alors nulle et
le bloc ne dessine rien : `mandala-32` rend exactement ce qu'elle rendait
avant. Même discipline que `notes` au lot 3, et `anticipation` est
OPTIONNEL sur `LiveFrame` pour la même raison — aucun constructeur de trame
existant n'a été touché.

### Ce que le banc a vérifié

```
npm run typecheck   -> 0 erreur
npm test            -> 131 fichiers, 1265 tests verts (1262 -> 1265, +3)
npm run test:arch   -> 1 test vert
npm run build       -> 603,97 kB (gzip 173,54 kB), 2,29 s
```

Trois propriétés mesurées sur l'hôte synthétique, et deux d'entre elles sont
des garde-fous plus que des confirmations :

- **l'avance ne dépasse JAMAIS le lookahead de l'hôte** (~100 ms). C'est ce
  qui borne la retenue : une scène ne peut pas s'armer plus tôt que ce que
  l'hôte a réellement planifié ;
- **elle fond vers zéro** à l'approche de l'impact (décroissances comptées) ;
- **rien n'est publié avant convergence de l'aligneur** — une anticipation
  non alignée serait pire qu'absente, elle armerait au mauvais moment.

### Limites connues

- Un seul consommateur (`mandala-32`, sur le kick). `laser-tunnel` était
  l'autre candidat de `docs/20` ; l'y ajouter est une ligne, mais deux scènes
  qui inspirent en même temps n'apportent rien tant que la première n'a pas
  été jugée à l'œil.
- La fenêtre de 60 ms est un choix, pas une mesure : assez pour que le geste
  se voie, assez peu pour qu'il appartienne encore à la frappe. À réviser au
  verdict.

---

## 13 août 2026 — SESSION F (suite) : `laser-tunnel` charge son point de fuite

Second consommateur de l'anticipation, demandé après coup. Édité :
`LaserTunnelScene.ts` seul — l'API livrée avec `mandala-32` n'a pas bougé
d'une ligne, ce qui était l'intérêt de la livrer avec un consommateur plutôt
que seule.

### Un geste différent, à dessein

`mandala-32` fait CONVERGER un anneau depuis l'extérieur vers son noyau. Le
copier ici aurait été une faute de langage : tout le vocabulaire de
`laser-tunnel` est centrifuge — les anneaux naissent au fond et foncent vers
l'œil. Sa retenue se lit donc en PROFONDEUR : la lumière s'amasse au POINT DE
FUITE pendant les 80 ms qui précèdent le kick annoncé, et l'anneau jaillit
ensuite exactement de là.

Sur une image figée, les deux scènes restent distinguables : un anneau isolé
loin du centre (mandala qui inspire) contre un cœur brillant sans anneau
proche (tunnel qui charge).

**Fenêtre de 80 ms, contre 60 ms pour `mandala-32`** : l'anneau du tunnel part
très vite (progression exponentielle), il faut voir la lumière s'amasser un
peu plus longtemps pour que le lien de cause à effet se lise. Chaque scène
règle SA fenêtre — c'est un paramètre de geste, pas une constante du canal.

### Portique

```
npm run typecheck   -> 0 erreur
npm test            -> 131 fichiers, 1265 tests verts (inchangé)
npm run test:arch   -> 1 test vert
npm run build       -> 604,21 kB (gzip 173,63 kB), 2,34 s
```

Aucun test ajouté, et c'est volontaire : l'API d'anticipation et ses trois
garde-fous (avance bornée au lookahead, décroissance vers l'impact, rien avant
convergence) sont déjà couverts. Ce lot n'ajoute qu'un consommateur, dont la
seule propriété vérifiable sans œil — l'inertie quand `nextIn` vaut
`+Infinity` — est structurelle : `charge` vaut alors 0 et le bloc ne dessine
rien. Les 24 invariants de scène passent sur le fichier modifié.

### Limite assumée

Les deux scènes inspirent maintenant, alors qu'aucune n'a encore été jugée à
l'œil. Si le geste s'avère trop discret ou trop appuyé, ce sont deux
constantes à bouger (`PREARM_SEC` dans chaque scène), pas une reprise de
l'architecture.

---

## 13 août 2026 — Nommage d'accord V2 : la quinte n'est plus exigée

Livré : `Beat_Studio_CDJ_MOBILE_alpha22.html` (= alpha21 + drapeau
`_CHORD_DETECT_V2`). Corrige le constat du lot 2 d'ADR-015 : `quality` valait
souvent `?` sur le canal PMDI.

### Le diagnostic était déjà écrit dans le fichier

Ce n'était pas une découverte à faire, mais une dette à ramasser. Le
commentaire de `chordLabel` (moteur de mélodie V5) avait **mesuré** le
problème et l'avait laissé en l'état :

> « La QUINTE peut être omise — c'est même le voicing le plus courant d'un V7
> (mesuré : le tritone-sub de ce moteur rend `['G3','B3','F4']`, fondamentale/
> tierce/septième, sans quinte). La qualité se juge donc sur la TIERCE
> d'abord ; la quinte ne sert qu'à distinguer dim et aug. `_detectChordName`,
> lui, exige la quinte et rend `?` dans ce cas : on ne l'appelle pas ici, et
> on ne le corrige pas non plus (il sert à l'export MIDI — signalé, hors
> périmètre). »

V2 adopte donc **l'échelle de `chordLabel`, déjà validée** — pas une logique
harmonique nouvelle, ce qui est précisément ce qui rend le correctif sûr.

### Reproduit avant d'être corrigé

Sur les progressions réelles du moteur, deux mesures indépendantes :

```
['F#3','A3','C#4']  -> F#m   (deja correct)
['G3','B3','D4']    -> G     (deja correct)
['E4','F#3','A3']   -> E?    <- echoue
['B3','D4','F#4']   -> Bm    (deja correct)
                       en place : 2 accords sur 4 rendus '?'
                       echelle de reference : 0 sur 4
```

### Deux écarts assumés avec la référence

- **La relaxation est étendue aux SUSPENDUES** : `sus4`/`sus2` ne réclament
  plus la quinte non plus. C'est le principe énoncé par le commentaire
  ci-dessus, appliqué jusqu'au bout plutôt qu'à moitié.
- **Le résidu reste `?` au lieu de retomber sur « majeur »**, comme le fait
  `chordLabel`. Un accord sans tierce, sans quarte, sans seconde et sans
  quinte n'est pas majeur : l'annoncer majeur serait un mensonge confiant, là
  où `?` dit seulement « je ne sais pas ». Le cas devient rare.

### Vérification par EXÉCUTION, sur les trois consommateurs d'un coup

`_detectChordName` sert à la piste CHORDS de l'export MIDI (nom lisible en
DAW), au `quality` de l'export PMDI statique et au `quality` du canal PMDI en
direct. Un seul correctif, trois sorties corrigées.

```
alpha22, canal espionne, lecture reelle :
  accords -> quality "min" · "sus4" · "min" · "5"      (aucun '?')
  168 messages, 0 fondamentale invalide, 0 erreur page

meme fichier, _CHORD_DETECT_V2=false :
  accords -> quality "?" · "min" · "min" · "maj"       (ancienne echelle)
```

Le drapeau est donc un vrai interrupteur, vérifié dans les deux sens.
`node --check` du bloc `text/x-dc` : OK. Diff : 3 hunks, 44 lignes ajoutées,
6 retirées — et les 6 retirées **réapparaissent verbatim** dans la branche
`else`, seulement ré-indentées : le chemin drapeau-éteint est conservé mot
pour mot.

**Aucun son n'est touché** : cette fonction ne sert qu'à NOMMER.

### Un défaut plus profond, mesuré mais NON corrigé

La mesure a révélé autre chose : **l'ordre du tableau d'accord n'est pas
l'ordre des hauteurs.** `['E4','F#3','A3']` trié par hauteur donne F#3–A3–E4,
soit un **F#m7** — la fondamentale n'est pas `pcs[0]`, qui vaut ici E.
`_detectChordName` (V1 comme V2) et `chordLabel` partagent cette hypothèse.

Corriger cela demanderait de dériver la fondamentale de la note la plus
GRAVE, ce qui changerait le nom d'accords aujourd'hui jugés corrects — un
risque d'un autre ordre que celui pris ici. **Signalé, délibérément non
corrigé**, exactement comme la session précédente l'avait fait pour la quinte.
À rouvrir avec son propre drapeau si le besoin se confirme.

---

## 13 août 2026 — Fondamentale d'accord V3 : la reconnaissance par gabarits

Livré : `Beat_Studio_CDJ_MOBILE_alpha23.html` (= alpha22 + drapeau
`_CHORD_ROOT_V3`). Corrige le défaut signalé — et non corrigé — au lot
précédent : `_detectChordName` prenait le PREMIER élément du tableau de notes
pour fondamentale.

### Deux heuristiques simples, et pourquoi aucune ne suffit

Le tableau de notes n'est pas trié par hauteur : `['E4','F#3','A3']` est un
**F#m7**, et sortait `Esus4`. On pourrait croire qu'il suffit de prendre la
note la plus GRAVE — c'est faux dès que l'accord est renversé :
`['E3','G3','C4']` est un **do majeur** premier renversement, que la basse
nommerait « Em ». Les deux heuristiques échouent, et sur des cas différents.

**Mesure sur cas de contrôle à vérité connue : premier élément 4/8,
basse 6/8, gabarits 8/8.** V3 essaie donc chaque classe de hauteur présente
et garde l'interprétation qui reconnaît le plus de degrés sans en laisser
d'étranger ; à égalité, la basse tranche (lecture standard d'un renversement).

### La première version était fausse, et la mesure l'a dit

V3 telle qu'écrite d'abord produisait sur des voicings RÉELS :
`['E4','G#4','A3']` → **`A5maj7`**, un nom que personne n'écrit, et
`['G#4','C4']` → **`C?`** là où le premier élément donnait `G#`, juste. Mes
cas de contrôle ne couvraient ni les dyades ni les septièmes sans tierce.
Deux resserrements, chacun tiré de sa régression :

1. **Il faut au moins TROIS degrés reconnus pour DÉPLACER la fondamentale.**
   Une dyade tombe dans un gabarit par accident : `G#`–`C` « correspond » à
   l'accord augmenté depuis do. Sans preuve suffisante, on ne bouge pas.
2. **La septième nomme l'accord quand la tierce manque.** A–E–G# est un
   `Amaj7` sans tierce, pas un « A5maj7 » : le seuil de quinte à vide ne doit
   se déclencher qu'en l'absence de septième.

Contrôles ÉTENDUS (dyades, septièmes sans tierce, quinte à vide, plus les
huit d'origine) : **actuel 6/12, V3 resserrée 12/12.**

### Cohérence `root` / `quality` — le piège du lot

Déplacer la fondamentale casse les deux points d'export, qui déduisaient
`rootName` du PREMIER élément du tableau : ils auraient publié `root: D` avec
un nom `Gm`, un accord qui se contredit. Les deux lisent désormais la
fondamentale sur le **nom détecté**, via `_chordNoteNamesToPitchClasses`.
Drapeau éteint, le nom commence par `_order[pcs[0]]` et cette lecture redonne
exactement `pcs[0]` : comportement identique.

### Vérification par exécution

```
alpha23, canal espionne, lecture reelle :
  quality -> "sus4" · "maj" · "min" · "maj"   roots coherents, 0 erreur page
_CHORD_ROOT_V3=false, meme scenario :
  quality -> "min" · "5" · "min" · "maj"      comportement alpha22 restaure
```

`node --check` du bloc `text/x-dc` : OK. Diff alpha22 → alpha23 : 12 hunks,
84 lignes ajoutées, 9 retirées (déplacements de lignes existantes, conservées
à l'identique). **Aucun son n'est touché** : ces fonctions ne servent qu'à
nommer.

### Limites connues

- La reconnaissance ne couvre que les gabarits listés (`_CHORD_TEMPLATES`) :
  triades, septièmes, sixtes, suspendues, quinte à vide. Un accord altéré
  (9♯, 11♭, add9 sur basse étrangère) retombe sur le premier élément — le
  comportement d'avant, jamais pire.
- Les renversements sont nommés par leur FONDAMENTALE, pas en accord barré
  (`C/E`). Le contrat PMDI de doc 12 ne porte qu'une `root` et une `quality` :
  la basse n'y a pas de champ. C'est une information perdue, pas fausse.
- `quality` reste `'m7'` et non `'min7'` : la table de conversion des deux
  points d'export ne traduit que `'m'` → `'min'`. Doc 12 donne `quality` comme
  chaîne ouverte ; harmoniser demanderait de toucher le format de l'export
  statique, hors périmètre de ce lot.

---

## 13 août 2026 — Qualité PMDI normalisée : le mineur s'épelle `min`

Livré : `Beat_Studio_CDJ_MOBILE_alpha24.html` (= alpha23 + drapeau
`_PMDI_QUALITY_NORM_V1`). Ferme la dernière limite consignée au lot
précédent.

### Deux notations, une seule frontière

`_detectChordName` produit la notation de PARTITION, où le mineur s'écrit
`m` : `m`, `m7`, `mmaj7`. Le contrat PMDI (doc 12) l'épelle `min` — son
exemple donne « maj | min | min7 | sus4 ». La conversion en place ne
traduisait que le cas NU (`'m'` → `'min'`), si bien qu'un mineur septième
partait en `m7` et un mineur majeur septième en `mmaj7`.

Règle retenue : **le `m` INITIAL devient `min`, sauf quand il ouvre `maj`** —
qui marque le majeur, pas le mineur. Tout le reste passe inchangé. Les NOMS
d'accord du MIDI, eux, gardent la notation de partition : c'est ce qu'un
musicien lit dans son DAW. Seule la frontière PMDI est normalisée.

### Vérifié sur le code LIVRÉ, pas sur une copie

La fonction a été extraite du fichier tel qu'il est livré, puis exécutée sur
une table de cas — plutôt que retapée dans un test, ce qui n'aurait prouvé que
la fidélité de ma frappe :

```
  m       -> min        mmaj7  -> minmaj7      dim  -> dim     5 -> 5
  m7      -> min7       maj7   -> maj7         aug  -> aug     7 -> 7
  maj     -> maj        sus4   -> sus4         ?    -> ?       "" -> ""
                                        TOUS JUSTES (14 cas)
```

Le cas `maj7` est celui qui compte le plus : il commence lui aussi par `m`, et
une règle naïve en aurait fait `minaj7`.

Bout en bout, sur `buildPmdiDocument(32)` — le chemin réel de l'export
statique — la qualité `minmaj7` apparaît dans le document. C'est la preuve du
CÂBLAGE : elle ne peut venir que de la nouvelle branche, `m7` empruntant
exactement le même chemin. Drapeau à `false`, même appel : aucune qualité en
notation de partition, ancienne conversion rétablie.

`node --check` du bloc `text/x-dc` : OK. Diff alpha23 → alpha24 : 4 hunks,
26 lignes ajoutées, 2 retirées. **Aucun son touché.**

### Limite connue

La normalisation ne porte que sur le marqueur de mineur. Une qualité composée
comme `sus47` (suspendue avec septième) reste telle quelle, là où l'usage
écrirait `7sus4` ; et `7` seul désigne une dominante sans que doc 12 tranche
la graphie. Ces cas n'ont pas été demandés et ne sont pas des erreurs de
contrat — doc 12 donne `quality` comme chaîne OUVERTE. À rouvrir si un
consommateur en a besoin.

---

## 13 août 2026 — Ordre septième/suspension, et un BANC pour la chaîne d'accords

Livré : `Beat_Studio_CDJ_MOBILE_alpha25.html` (= alpha24 + drapeau
`_CHORD_SUS_ORDER_V1`), plus un banc de test réutilisable.

### Le correctif

L'assemblage du nom faisait `qualité + extension`, soit `Csus47` pour une
suspendue avec septième. Personne n'écrit ça : la septième se place AVANT la
suspension — `C7sus4`. Corrigé **à la source**, dans `_detectChordName`, donc
pour les trois consommateurs à la fois : le nom lisible du MIDI, la qualité de
l'export PMDI statique et celle du canal direct. Ne concerne que les
suspendues : `m7`, `dim7` et `aug7` étaient déjà dans le bon ordre.

Diff alpha24 → alpha25 : **2 hunks, 14 lignes ajoutées, 0 retirée** —
purement additif.

### Le banc — ce qui restera de cette série

Quatre lots successifs ont touché la même chaîne (qualité, fondamentale,
normalisation, ordre), chacun vérifié par une sonde jetable. C'était une
dette : rien ne protégeait les lots précédents des suivants.

`banc_accords.js` **EXTRAIT du fichier livré** `_CHORD_TEMPLATES`,
`_chordNoteNamesToPitchClasses`, `_chordRootFromNames`, `_detectChordName` et
`_pmdiNormalizeQuality`, lit les quatre drapeaux tels qu'ils sont posés, puis
exécute la chaîne sur une table de vérité de quinze accords — en reproduisant
aussi le calcul de `quality` des deux points d'export. Rien n'est retapé :
ce qui est testé est le TEXTE du fichier, pas une copie fidèle de ma frappe.

```
node banc_accords.js Beat_Studio_CDJ_MOBILE_alpha25.html
```

Résultat, et c'est la mesure du lot :

```
alpha24 : Csus47 / sus47 et Csus27 / sus27      -> 2 ACCORDS FAUX sur 15
alpha25 : C7sus4 / 7sus4 et C7sus2 / 7sus2      -> TOUS JUSTES (15 accords)
_CHORD_SUS_ORDER_V1=false sur alpha25            -> 2 faux, ancien ordre retabli
```

La table couvre ce que les quatre lots ont corrigé : renversements
(`['E3','G3','C4']` → C), tableau non trié (`['E4','F#3','A3']` → F#m7),
quinte omise (`['G3','B3','F4']` → G7), septième sans tierce
(`['E4','G#4','A3']` → Amaj7), dyade laissée tranquille (`['G#4','C4']` →
G#), quinte à vide, mineur septième normalisé `min7`. Un futur lot qui
casserait l'un de ces cas le saura en une seconde.

`node --check` du bloc `text/x-dc` : OK. **Aucun son touché.**

### Limite connue

La table est écrite à la main : elle atteste ce que nous avons décidé, pas ce
qu'un traité d'harmonie exigerait. Deux conventions y sont des CHOIX
assumés — les renversements sont nommés par leur fondamentale et non en
accord barré (`C/E`), et une dyade conserve la lecture d'avant faute de preuve
suffisante.

---

## 13 août 2026 — Le banc appliqué à toute la lignée : mesure de la régression

`banc_accords.js` rendu TOLERANT aux versions anciennes (gabarits, choix de
fondamentale et normalisation deviennent facultatifs à l'extraction). Sans
cela il ne savait mesurer que la dernière version — c'est-à-dire tout sauf
une régression.

| version | faux / 15 | lot |
|---|---|---|
| alpha20 · alpha21 | **12** | état d'origine |
| alpha22 | 8 | la quinte n'est plus exigée (`_CHORD_DETECT_V2`) |
| alpha23 | 4 | fondamentale par gabarits (`_CHORD_ROOT_V3`) |
| alpha24 | 2 | `m7` → `min7` (`_PMDI_QUALITY_NORM_V1`) |
| alpha25 | **0** | `sus47` → `7sus4` (`_CHORD_SUS_ORDER_V1`) |

Sur alpha21, seuls trois accords passaient : les triades en position
fondamentale, quinte présente. Tout le reste sortait `E?`, `C?`, `G?7`.

### Ce que la mesure dit et qui n'est pas flatteur

**alpha22, pris isolément, échange des `?` contre des réponses CONFIANTES ET
FAUSSES.** `['E3','G3','C4']` passe de `E?` — « je ne sais pas » — à `Em`,
alors que c'est un do majeur renversé. Le point d'interrogation signalait au
moins le doute. Il a fallu la fondamentale par gabarits (alpha23) pour que ces
cas deviennent justes.

Le progrès est donc net (12 → 8 → 4 → 2 → 0) mais **pas monotone en
qualité d'erreur** : c'est l'enchaînement des quatre lots qui est correct, pas
chacun pris seul. À retenir avant de livrer un maillon de cette chaîne sans
les autres.

À partir d'alpha23, les erreurs restantes ne portaient plus que sur
l'ORTHOGRAPHE (`m7`, `sus47`) : les accords étaient déjà correctement
identifiés.

### Le tableau de la lignée entre dans le banc (même jour)

Le tableau ci-dessus avait été produit par une boucle shell jetable — donc
perdu. `banc_accords.js` accepte désormais PLUSIEURS fichiers et sort la
matrice lui-même : une ligne par cas, une colonne par version, et l'on voit
d'un coup d'œil à partir de quelle version chaque cas devient juste.

```
cas                        alpha20  alpha21  alpha22  alpha23  alpha24  alpha25
mineur septieme            »m7      »m7      »m7      »m7      ok       ok
V7 SANS QUINTE             G?7      G?7      ok       ok       ok       ok
1er renversement           E?       E?       Em       ok       ok       ok
tableau NON trie           E?       E?       Esus4    »m7      ok       ok
suspendue + 7e             C?7      C?7      Csus47   Csus47   Csus47   ok
7e SANS tierce             E?       E?       E        ok       ok       ok
FAUX sur 15                12       12       8        4        2        0
```

Le marqueur `»xxx` distingue les deux natures d'erreur : nom d'accord JUSTE
mais orthographe de `quality` fausse, contre nom carrément faux. C'est ce qui
rend visible d'un coup d'œil que la ligne « 1er renversement » passe de `E?`
(doute honnête) à `Em` (faux assuré) avant de devenir juste.

**Code de sortie : il ne juge que la DERNIÈRE version passée** — celle qu'on
livre. Compter les échecs des versions anciennes rendrait le banc inutilisable
dans un script de livraison ; la lignée est là pour montrer d'où l'on vient,
pas pour faire échouer la livraison du jour. Vérifié dans les deux sens
(alpha25 en dernier → 0 ; alpha21 en dernier → 1).

### Le banc entre au dépôt (même jour)

`tools/bancAccords.js` + script `npm run banc:accords`. Documenté dans
`docs/20`, section « Maintenance courante », où l'on ira le chercher.

**Outil, PAS test vitest** — et c'est le point de conception. Il mesure un
fichier EXTERNE au dépôt (la lignée Beat Studio) : un test qui échoue quand ce
fichier est absent ferait tomber le portique sur toute machine qui ne l'a pas,
et un test qui se contente de sauter mentirait sur sa couverture. Il vit donc
dans `tools/`, hors du `include` de `tsconfig` et hors du périmètre scanné par
le test d'architecture — vérifié : typecheck 0, 1265 tests, arch verte,
inchangés.

Une correction au passage : le dépôt est `"type": "module"`, si bien que le
`require` hérité du brouillon échouait dès le premier lancement par le script
npm. Converti en ESM.

Pourquoi ce banc appartient à PULSAR et non à Beat Studio : la chaîne
`root`/`quality` est produite là-bas mais CONSOMMÉE ici — la rotation de teinte
d'ADR-015 lit `root`, une scène future lira `quality`. Une erreur de nommage
chez l'hôte devient une erreur de couleur ici, et Beat Studio n'a aucune
infrastructure de test où la loger.

### Le banc entre dans `test:arch` (même jour)

Demandé après coup. Deux pièges évités, et un troisième trouvé par la
vérification elle-même.

**Pas de chemin absolu dans `package.json`.** La lignée avance d'un fichier à
chaque lot (alpha21 → 25 en une journée) : un chemin écrit en dur serait faux
dès la version suivante. Le banc, appelé sans argument, DÉCOUVRE le fichier
canonique — le plus haut `Beat_Studio_CDJ_MOBILE_alpha<N>` de
`BEAT_STUDIO_DIR`, ou du dossier parent du dépôt.

**Fichier absent ⇒ 0, avec un message qui ne ment pas.** Le banc mesure un
fichier EXTERNE au dépôt ; le faire échouer ferait tomber le portique sur
toute machine sans la lignée Beat Studio, pour une raison qui n'est pas une
régression. Il annonce alors `AUCUN CONTROLE EFFECTUE` et ce qu'il a cherché,
plutôt que de se taire ou de se déclarer vert.

**Le troisième piège est le mien.** Ma première vérification lisait `$?`
après un `| tail`, donc le code de sortie de `tail` — elle montrait 0 sur une
version RÉGRESSÉE et aurait laissé passer un portique qui ne protège rien.
Remesuré sans le tube :

```
fichier sain (alpha25)      -> code 0, TOUS JUSTES (15 accords)
fichier absent              -> code 0, AUCUN CONTROLE EFFECTUE + ce qui a ete cherche
version regressee (alpha21) -> code 1, 12 ACCORD(S) FAUX sur 15   <- le portique tombe
```

Portique complet inchangé par ailleurs : typecheck 0, 1265 tests.

### Versions intermédiaires archivées (même jour)

alpha22, 23 et 24 quittent le dossier de livraison pour
`Downloads/_corbeille/20260813/`. **Déplacées, pas détruites** — et vérifiées
inutiles avant de l'être, ce qui est l'ordre correct.

Les quatre drapeaux SONT l'historique : éteindre les derniers dans alpha25
redonne les états antérieurs. Mesuré au banc, colonne par colonne — les
variantes reconstruites reproduisent alpha22, alpha23 et alpha24 sur les
quinze cas, totaux compris (8, 4, 2). Rien n'est donc perdu sur la chaîne
d'accords ; le reste l'est par construction, chaque lot n'ayant touché
qu'elle (2 à 12 hunks, tous dans cette chaîne).

La recette de reconstruction est consignée dans `docs/20`, à côté du banc :
c'est elle qui rend l'archivage sans conséquence, pas la bonne volonté.

`npm run test:arch` après archivage : le fichier canonique reste trouvé
(alpha25 est toujours le plus haut numéro), TOUS JUSTES, code 0.

## 13/08/2026 — Adaptation de qualité live : limite mesurée, correctif écarté

Aaron lit le HUD en mode direct et rapporte `rendu qualite 3/3`, `ref 33.3 ms`.
La lecture ouvre une question qui n'était pas celle posée : je lui avais donné
l'échelle **à l'envers** (3 est le maximum, le compteur descend), et surtout il
objecte, à juste titre, que régler les performances sur SA machine n'a pas de
sens — ce sont les machines des clients qui comptent.

L'objection a mené à une mesure. Sonde directe sur `FrameBudget`, 60 trames de
calibration puis 10 s de régime établi :

```
A. lente AVANT la calibration      B. ralentit APRÈS la calibration
  60 fps -> ref  16,7 ms -> 3/3      60 -> 40 fps : 3/3 -> 3/3  (zone morte)
  30 fps -> ref  33,3 ms -> 3/3      60 -> 30 fps : 3/3 -> 0/3
  20 fps -> ref  50,0 ms -> 3/3      60 -> 20 fps : 3/3 -> 0/3
  10 fps -> ref 100,0 ms -> 3/3      60 -> 10 fps : 3/3 -> 0/3
```

**Une machine à 10 images par seconde garde 6000 particules.** Le mécanisme de
descente n'est pas en faute — colonne B, il fonctionne exactement comme spécifié.
La référence apprise, elle, n'a pas de plafond : la lenteur présente avant la
calibration devient la définition de « normal ». Écart en jeu : ×10 particules,
×3,3 passes plein écran.

Vérifié au passage : `setLevel` n'est appelé que par `live-bench.ts`. **Aucun
réglage de qualité n'est exposé à l'utilisateur**, ni manuel ni automatique, sur
ces machines-là.

**Décision d'Aaron : ne pas corriger.** Le plafond absolu sur la référence porte
un risque réel (un écran bloqué à 30 Hz serait dégradé à tort) et le rapport
risque/gain ne le justifie pas tant qu'aucun utilisateur ne s'est plaint. Le
sélecteur manuel ne corrige rien par défaut.

Consigné en détail — les deux correctifs écartés, leurs risques, et le
discriminant variance qui séparerait un écran bloqué d'une machine qui souffre —
dans `src/ui/live/NOTES.md`, § « LIMITE CONNUE », c'est-à-dire à côté des seuils
que quelqu'un voudra un jour retoucher. À rouvrir sur signalement réel.

Aucun code modifié. Sonde supprimée après lecture.

## 13/08/2026 — ADR-014 tranché par la mesure : pas de portage GPU du live

La lecture du HUD d'Aaron ne servait pas qu'à la question des performances : elle
était le **critère de bascule pré-accepté** de l'ADR-014, écrit en SESSION D et
laissé en attente depuis. Le critère disait, mot pour mot : « stabilisé à 1 ou 0
⇒ (a) s'ouvre ; à 2 ou 3 ⇒ le portage n'a pas d'objet ».

Relevé : `qualite 3/3`, aucun `DEGRADE`, `flashs limites 0`. **Option (c), pas de
portage.** Périmètre évité : ≈ 3 410 lignes, 130 tests live, 7 capacités à
ajouter à `Renderer` dont 4 pour la seule `type-slam`.

Deux réserves consignées dans l'ADR plutôt que passées sous silence :

- « 3/3 » veut dire « tient la cadence qu'il a lui-même apprise », pas « tient
  60 fps ». Le `ref 33.3 ms` relevé est une cadence de 30 fps, et les 50,0 puis
  33,3 ms sont des multiples exacts d'une trame de 60 Hz — signature d'un vsync
  qui saute des images, pas d'un rendu coûteux.
- Cette réserve ne rendrait le critère discutable que si l'on cherchait à servir
  les machines faibles, chantier qu'Aaron a écarté le même jour. Le critère est
  donc appliqué tel qu'il a été écrit, sur la machine où il était prévu de le lire.

**Fausse alerte levée au passage.** J'avais signalé `evts 46/-67` comme un défaut
possible du lot notes/accords — plus de la moitié des événements jetés. Vérifié
dans le code : `skipDue` vaut `!wasActive`, donc la rafale n'est sautée qu'à la
PREMIÈRE trame après convergence de l'aligneur. Les 67 sont l'arriéré de la phase
d'acquisition, jeté d'un coup et par conception (`TruthDirector.collectDueNotes` :
« une note qu'on verrait apparaître une seconde après l'avoir entendue serait pire
qu'absente »). Le ring fait 64 entrées, donc 67 > 64 a aussi fait tourner le
tampon — même cause. Cohérent avec les deux captures : `evts 0` en acquisition,
`evts 46/-67` une fois ACTIF. Aucun défaut. Le compteur étant cumulatif, la rafale
reste affichée pour toujours ; le discriminant, si le doute revenait, est de
regarder si le nombre CONTINUE de monter.

Portique : typecheck 0, `test:arch` vert, banc d'accords TOUS JUSTES (15).
Aucun code modifié — documentation seule.

## 13/08/2026 — ADR-014 tranché par la mesure : pas de portage GPU du live

La lecture du HUD d'Aaron ne servait pas qu'à la question des performances : elle
était le **critère de bascule pré-accepté** de l'ADR-014, écrit en SESSION D et
laissé en attente depuis. Le critère disait, mot pour mot : « stabilisé à 1 ou 0
⇒ (a) s'ouvre ; à 2 ou 3 ⇒ le portage n'a pas d'objet ».

Relevé : `qualite 3/3`, aucun `DEGRADE`, `flashs limites 0`. **Option (c), pas de
portage.** Périmètre évité : ≈ 3 410 lignes, 130 tests live, 7 capacités à
ajouter à `Renderer` dont 4 pour la seule `type-slam`.

Deux réserves consignées dans l'ADR plutôt que passées sous silence :

- « 3/3 » veut dire « tient la cadence qu'il a lui-même apprise », pas « tient
  60 fps ». Le `ref 33.3 ms` relevé est une cadence de 30 fps, et les 50,0 puis
  33,3 ms sont des multiples exacts d'une trame de 60 Hz — signature d'un vsync
  qui saute des images, pas d'un rendu coûteux.
- Cette réserve ne rendrait le critère discutable que si l'on cherchait à servir
  les machines faibles, chantier qu'Aaron a écarté le même jour. Le critère est
  donc appliqué tel qu'il a été écrit, sur la machine où il était prévu de le lire.

**Fausse alerte levée au passage.** J'avais signalé `evts 46/-67` comme un défaut
possible du lot notes/accords — plus de la moitié des événements jetés. Vérifié
dans le code : `skipDue` vaut `!wasActive`, donc la rafale n'est sautée qu'à la
PREMIÈRE trame après convergence de l'aligneur. Les 67 sont l'arriéré de la phase
d'acquisition, jeté d'un coup et par conception (`TruthDirector.collectDueNotes` :
« une note qu'on verrait apparaître une seconde après l'avoir entendue serait pire
qu'absente »). Le ring fait 64 entrées, donc 67 > 64 a aussi fait tourner le
tampon — même cause. Cohérent avec les deux captures : `evts 0` en acquisition,
`evts 46/-67` une fois ACTIF. Aucun défaut. Le compteur étant cumulatif, la rafale
reste affichée pour toujours ; le discriminant, si le doute revenait, est de
regarder si le nombre CONTINUE de monter.

Portique : typecheck 0, `test:arch` vert, banc d'accords TOUS JUSTES (15).
Aucun code modifié — documentation seule.

## 13/08/2026 — Verdicts d'Aaron : les deux sont positifs. Chantier clos.

Les deux derniers points ouverts de la feuille de route n'appartenaient qu'à
Aaron — aucun ne se mesure, tous deux se regardent. Ils sont rendus le même jour.

**Test 2 — look HDR + bascule WebGL2 (SESSIONS B et C).** Fichier audio chargé
sur le site déployé, aller-retour avec `?renderer=canvas2d` pour comparer à
l'ancien rendu. Verdict : **« ça a l'air mieux maintenant »**. Le nouveau rendu
est donc préféré à l'ancien sur la seule comparaison qui compte — la sienne.

C'est le dernier verrou de trois sessions : la parité SDR (lot 1) avait été
mesurée style par style, le look HDR (lot 2) avait été mesuré en luminance et en
saturation, et la bascule par défaut (lot 3) reposait sur ces mesures — mais
« est-ce que c'est plus beau » ne se mesure pas. La réponse est oui.

**Test 1 — mélodie/accords + anticipation (SESSIONS E et F).** Mode direct
automatique depuis `alpha25`, panneau laissé intact. Verdict positif également.
Ce qui est validé ici : la teinte qui suit l'harmonie par le cercle des quintes
en restant sous le plafond de `hueModulation` (§3.5), et la retenue avant impact
sur `mandala-32` et `laser-tunnel`.

**Aucune réserve exprimée, aucun défaut signalé.** Les verdicts sont donnés tels
quels, sans détail — c'est ce qui a été demandé et c'est suffisant pour clore.
Si un défaut apparaît à l'usage, il sera signalé à ce moment-là.

### État de la feuille de route

Toutes les sessions A à F sont livrées et validées. L'ADR-014 est tranché par la
mesure (option (c), pas de portage). **Il ne reste aucun point ouvert.** Les deux
seules choses consignées comme non faites sont des décisions explicites d'Aaron,
documentées avec leurs raisons :

- la LIMITE CONNUE de `FrameBudget` (référence apprise sans plafond), écartée ;
- le portage GPU du pipeline live, sans objet au vu de la mesure.

Portique : typecheck 0, 1265 tests, arch verte, banc d'accords TOUS JUSTES (15).

## 13/08/2026 — Blueprint 2026, chantier P0 n°1 : ADN visuel

Premier chantier de `docs/18_BLUEPRINT_VISUELS_2026.md` (§G, feuille de route
§J, TOP 10 n°1). Il répond au constat F1 de l'audit : « un même preset + style
rend presque la même chose pour deux morceaux différents ».

### Ce qui a été fait

`src/presets/visualDna.ts`, module PUR, ne dessine rien. Il dérive du document
PMDI seul : huit traits ramenés à 0..1 (tempo, énergie moyenne, variance
d'énergie, dominance du grave, brillance, platitude, densité d'onsets, nombre de
sections), huit deltas de macro bornés à ±0,20, et une graine de projet repliée
sur un condensé du morceau.

Le preset reste un PRIOR : `DNA_MAX_DELTA = 0,20`. Sans cette borne, un morceau
très dense ferait ressembler `ambient` à `techno` et le catalogue de genres
perdrait son sens.

Câblage en cinq éditions dans `ui/App.ts` : dérivation dans `applyDocCore`
(document BRUT, une seule fois par document — une correction de grille ne doit
pas redistribuer la graine), adoption graine+macros dans `applyImportedDoc`,
helper `macrosForCatalogPreset` appelé aux DEUX endroits où un preset de
catalogue devient la configuration active. PAS à la restauration d'un projet ni
à l'application d'un Look : ces valeurs-là ont été posées une fois et font
autorité.

`structure` (nombre de sections) est calculé et exposé mais n'alimente AUCUNE
macro : le nombre de sections décrit un DÉROULÉ, pas une texture. Sa place est
le chantier « mise en scène par section » (§F3), pas un curseur global qui
vaudrait pareil à la minute 1 et à la minute 3.

### Ce que la mesure a donné

Preset de référence Trap Dark (`energy 0,75  reactivity 0,85  density 0,60
movement 0,55  depth 0,80  glow 0,70  chaos 0,35  smoothness 0,40`) :

| morceau | graine | variante | macros résultantes |
|---|---|---|---|
| démo 120 BPM, motif ordinaire | 3632722564 | fuite basse | 0,75 / 0,84 / 0,59 / 0,55 / 0,81 / 0,69 / 0,45 / 0,41 |
| trap 152 BPM, dense et grave | 2577433356 | fuite basse | 0,81 / 0,97 / 0,72 / 0,66 / 0,95 / 0,62 / 0,42 / 0,28 |
| ambient 76 BPM, clairsemé et brillant | 1859773107 | plan large | 0,69 / 0,70 / 0,45 / 0,40 / 0,67 / 0,80 / 0,21 / 0,55 |

Trois morceaux, trois graines, trois configurations, deux cadrages différents.
Le livrable P0 n°2 du blueprint est tenu.

### Le test qui a eu raison contre moi

Le test « trois morceaux, trois mondes » utilisait d'abord les deux fixtures
Beat Studio MELVELBASE comme deux morceaux distincts. Il a échoué en montrant un
écart de 0,01. Vérification faite : ce sont **deux exports du même beat** (136
contre 139 BPM, 145 contre 137 événements) — l'écart de 0,01 est exactement ce
qu'on veut. Le test a été retourné : il vérifie désormais que ces deux documents
donnent des mondes VOISINS (< 0,05 par macro), et trois profils réellement
distincts ont été écrits pour le test de divergence. Au passage, ces deux
fixtures sont en Mode B et ne portent AUCUNE piste de descripteurs : elles
vérifient que la dérivation tient sur un PMDI sans `features`.

### Drapeau

`VISUAL_DNA_V1 = true` dans `src/presets/visualDna.ts`. À `false`, `App.ts` ne
dérive aucun ADN, `currentDna` reste `null`, `applyVisualDna` renvoie les macros
d'entrée PAR LA MÊME RÉFÉRENCE, et la graine reste celle de
`startNewProjectIdentity` : comportement identique à celui d'avant ce chantier.
Un test verrouille l'identité par référence.

### Vérification navigateur

Serveur Vite réel (`localhost:5174`), démo chargée : le champ de graine affiche
**3632722564**, la valeur dérivée de la démo, et non un tirage aléatoire.
Sélection de Trap Dark : les curseurs affichent **0,75 / 0,59 / 0,69**
(energy/density/glow), exactement les valeurs du banc. Aucune erreur console.

Portique : typecheck 0, **1289 tests verts** (132 fichiers, 24 nouveaux),
`test:arch` verte, banc d'accords TOUS JUSTES (15).

### Ce qu'Aaron doit regarder

Charger DEUX morceaux réellement différents, choisir le MÊME preset sur les deux,
et dire si les deux rendus se distinguent — et si le genre reste reconnaissable
dans les deux cas. La démo, elle, ne bougera presque pas : c'est un motif
volontairement ordinaire, il tombe au milieu de toutes les échelles.

## 13/08/2026 — Blueprint 2026, chantier P0 n°2 : mémoire visuelle (TraceField)

Deuxième chantier de `docs/18_BLUEPRINT_VISUELS_2026.md` (§F1, TOP 10 n°2).
Répond au constat F2 : « un kick est un flash, pas une empreinte ; le monde n'a
pas d'histoire, et la répétition se voit ».

### Ce qui a été fait

`src/visual/memory/TraceField.ts` : tampon circulaire de tableaux typés,
capacité 96, zéro allocation après construction. Trois familles d'empreintes,
et leur durée de vie EN MESURES, pas en secondes — un morceau lent laisse des
marques aussi longues qu'un morceau rapide.

| famille   | événements    | vit      |
|-----------|---------------|----------|
| cratère   | KICK, SUB_HIT | 8 mesures |
| cicatrice | SNARE, CLAP   | 4 mesures |
| poussière | HAT, PERC     | 2 mesures |

`src/visual/layers/memory/TraceMarks.ts` : la couche de preuve, insérée dans
`pulse` (après le fond) et `field` (après la vignette, donc DANS la traînée de
feedback). Trois primitives choisies par leur coût — toute la poussière part en
UN SEUL `drawSprite`, les cratères en `strokeCircle`, les cicatrices en
`strokePath` (`SpriteTransform` n'a pas de rotation, c'est la seule primitive
orientable du `Renderer`).

### Le vrai problème du chantier : la Loi 1

`primeScene` ne rejoue que 2 secondes, soit environ UNE mesure à 120 BPM. Un
tampon qui se contenterait d'accumuler serait donc vide aux trois quarts après
un seek, et l'image à 24 s dépendrait du chemin par lequel on y est arrivé.

D'où la mécanique de §F1 : `reset(t)` ne VIDE pas le champ, il le marque
périmé, et le prochain `update()` le RECONSTRUIT en relisant
`timeline.eventsBetween(t - horizon, t)`. Corollaire imposé : la position d'une
empreinte ne peut pas venir de `step.rng` — reseedé par sous-pas, il placerait
ailleurs une empreinte reconstruite (toutes au même sous-pas) que la même
empreinte déposée en lecture. La position est donc une fonction pure de
l'événement, repliée par `hash()` sur son temps quantifié et sa famille.

Coût assumé : la graine de projet n'entre pas dans la position, donc « Nouvelle
variante » ne redistribue pas les empreintes. L'alternative demandait d'ajouter
un champ à `LayerInitContext` et de le passer aux SEPT appelants de
`scene.init()` ; en oublier un donnait une graine nulle sans que rien ne le
signale. Sur le fond, une empreinte est le relevé de ce qui a été joué, pas un
habillage tiré au sort.

Test correspondant : lecture continue de 0 à 24,5 s contre reconstruction
directe à 24,5 s — instantanés IDENTIQUES, sur plus de 20 empreintes vivantes.

### Le harnais avait tort avant le code

Le test de la Loi 1 a échoué au premier jet avec un écart de 0,0005 sur tous les
restes de vie, plus un événement de différence. Cause : la boucle de lecture
continue avançait par `t += 1/120` et s'arrêtait un sous-pas AVANT la cible,
pendant que la reconstruction tombait SUR la cible — deux instants différents
comparés. Itération refaite sur l'INDICE de sous-pas. L'écart minuscule disait
déjà que le mécanisme était juste ; c'est la mesure qui ne l'était pas.

### CONSTAT À PART, non corrigé : la Loi 3 n'est appliquée nulle part

En écrivant `confidenceRamp`, relevé dans `behaviour/BehaviourEngine.ts` :
`fire(event.intensity * entry.gain)` — `event.confidence` n'est JAMAIS lu. La
rampe de `docs/06_EVENT_SYSTEM.md` (« effet = intensity × rampe(confidence) »,
0 sous 0,60) n'est donc appliquée nulle part dans le moteur fichier, alors
qu'elle est la Loi 3. La corriger changerait le rendu de TOUS les styles
existants : c'est un lot à part, avec son drapeau et son verdict. Signalé ici,
pas corrigé. `TraceField`, lui, est neuf : il l'applique dès le départ, et un
événement sous 0,60 n'y grave rien ni n'y occupe d'emplacement.

### Mesure, protocole identique dans les deux sens

Démo chargée, `seek(24.5)`, 60 `step()` pour laisser la scène se dessiner,
lecture du canvas, puis 30 pas de chauffe jetés et 120 pas chronométrés.

| drapeau | pulse : pixels clairs / luminance / ms | field : pixels clairs / luminance / ms |
|---|---|---|
| OFF | 189 394 / 104,62 / **4,167** | 33 115 / 32,32 / **4,467** |
| ON  | 209 559 / 108,62 / **4,667** | 50 309 / 36,68 / **4,797** |

Coût : **+0,50 ms** au pire (pulse), sur un budget de 16 ms. Les empreintes
mettent bien de la lumière à l'écran : +4,0 de luminance moyenne sur `pulse`,
+4,4 sur `field`. `field` en reçoit proportionnellement plus (+13,5 % de
luminance moyenne contre +3,8 %) parce que les empreintes entrent dans la
traînée de feedback et s'y accumulent — c'est voulu, et c'est le premier point
à juger à l'œil.

Première série de mesures ÉCARTÉE : les pixels y étaient lus plusieurs secondes
après le `seek` d'un côté et immédiatement de l'autre, donc une image pas encore
redessinée dans le second cas. Elle donnait 8,3 ms contre 4,3 ms, un écart qui
n'existe pas. Refaite symétriquement.

Portique : typecheck 0, **1310 tests verts** (133 fichiers, 20 nouveaux + 1
mis à jour), `test:arch` verte, banc d'accords TOUS JUSTES (15), zéro erreur
console.

### Test mis à jour, pas fait taire

`createFieldStyle.test.ts` affirmait la liste exacte des 4 couches. La
composition a réellement changé ; la liste attendue est désormais CALCULÉE
depuis `TRACE_FIELD_V1`, ce qui verrouille la promesse « drapeau éteint,
composition d'avant » plutôt que de la documenter.

### Ce qu'Aaron doit regarder

1. Sur `pulse` : au moment d'un BREAK, est-ce qu'on VOIT l'histoire du morceau
   accumulée sur la surface ?
2. Sur `field` : les empreintes prises dans la traînée sont-elles trop
   présentes ? Un seul réglage les calme (`traceAlpha`, 0,30 par défaut).
3. Est-ce que les marques restent au SECOND regard, sans jamais concurrencer la
   géométrie vivante ?

## 13/08/2026 (soir) — Les deux chantiers du jour sont ÉTEINTS sur signalement d'Aaron

Aaron, en testant sur son propre morceau : « c'est vraiment pas synchro au beat
du tout et ça continue à bouger même quand il n'y a plus de son du tout ».

### Ce qui a été fait

`VISUAL_DNA_V1` et `TRACE_FIELD_V1` sont à **`false`**. Le comportement est
celui d'avant les deux chantiers du jour. Vérifié à l'écran : les 5 couches
d'origine de `pulse`, aucune trace, aucune modulation de macro.

C'est l'état qu'Aaron a lui-même validé comme meilleur, et il y reste jusqu'à
nouvel ordre. Le code des deux chantiers demeure dans le dépôt, dormant.

### Discrimination faite, dans l'ordre

| état | verdict d'Aaron |
|---|---|
| les deux drapeaux éteints | **mieux** |
| ADN seul rallumé, traces éteintes | **pas synchro** |

Donc le symptôme suit `VISUAL_DNA_V1`.

### Je n'ai PAS trouvé le mécanisme, et je ne le prétends pas

Mesure directe, même morceau, même graine, en pilotant les huit curseurs de
macro depuis le DOM : macros du preset contre macros modulées par l'ADN d'un
morceau lent et clairsemé. Écart-type de la luminance sur un temps complet
(12 points, 120 BPM), qui sert de mesure de « punch » :

```
macros du preset            ecart-type 0,883   (min 61,05  max 64,04)
macros modulees par l'ADN   ecart-type 0,851   (min 61,25  max 63,97)
macros du preset, repete    ecart-type 0,882   -> mesure reproductible
```

**4 % d'écart.** Les deltas de macro ne peuvent pas produire « pas synchro du
tout ». La table des temps de réaction le confirmait déjà : `impact.decay`
passe de 0,065 s à 0,081 s au pire, soit ×1,24.

### Ce que la mesure soutient, en revanche

La GRAINE, que l'ADN remplaçait par une valeur dérivée du morceau, pèse
beaucoup plus lourd que les macros :

```
graine 1              ecart-type 0,644
graine 777            ecart-type 0,687
graine calculee (ADN) ecart-type 0,882
```

**37 % d'écart, neuf fois l'effet des macros.** La graine choisit la VARIANTE
de cadrage (`variantFor`) — décentrage, zoom jusqu'à 1,22, et pour l'une des
trois un mode de fusion `screen` sur la forme d'onde. Certains cadrages tapent
visiblement moins que d'autres.

Le chantier remplaçait un tirage aléatoire par une valeur fixe par morceau : il
VERROUILLAIT donc Aaron sur un cadrage donné au lieu d'en tirer un nouveau à
chaque import. Sur un morceau tombant sur une variante molle, le défaut devient
permanent au lieu d'être un tirage malheureux.

C'est une piste soutenue par la mesure, pas une preuve. Elle n'explique pas
« ça bouge même sans son ».

### Défaut de conception de test, corrigé

Deux tests de `visualDna.test.ts` cassaient dès que le drapeau passait à
`false` : ils vérifiaient la DÉRIVATION (« trois morceaux, trois mondes ») mais
passaient par `applyVisualDna`, qui est derrière l'interrupteur. Ils
signalaient donc l'interrupteur ouvert, pas un défaut de dérivation. Réécrits
pour appliquer les deltas directement ; le respect du drapeau reste testé à
part. La promesse « drapeau éteint = comportement d'avant » est désormais
vérifiée par la suite entière, dans les deux positions.

Portique, drapeaux éteints : typecheck 0, **1310 tests verts**, zéro erreur
console.

### Reste ouvert

- La « confiance grille » du morceau d'Aaron n'a pas encore été relevée. Sous
  0,60, le moteur passe en régime continu et ne se cale plus sur la grille —
  ce serait l'explication exacte des DEUX symptômes, et elle serait antérieure
  aux chantiers du jour.
- Savoir si, tout éteint, la synchro est BONNE ou seulement MOINS MAUVAISE.

## 14/08/2026 — Blueprint 2026, chantier P0 n°3 : partition de plans

Troisième chantier de `docs/18_BLUEPRINT_VISUELS_2026.md` (§F3, TOP 10 n°3) :
« le morceau écrit son storyboard ». Lancé APRÈS l'extinction des deux
chantiers précédents, et conçu autour de cette régression.

### Ce qui a été fait

`src/behaviour/SectionScore.ts`, module pur. Il lit la structure (les sections
et leurs lettres de répétition) et en dérive une suite de PLANS : un point de
vue par IDENTITÉ de section, et des coupes quantifiées sur le temps fort le
plus proche. `VisualDirector` le consulte à la place de `sectionKey`.

### Le choix que ce chantier RENVERSE, et il faut le dire

`sectionKey(startSec, letter)` faisait entrer l'INSTANT DE DÉBUT dans le
calcul, et son commentaire l'assumait : « c'est ce qui fait qu'un refrain
revenu ne se lit pas comme une copie du précédent ». §F3 demande l'inverse —
« répétition A → variante 1 ramenée, la mémoire de mise en scène ».

La mesure tranche en faveur du blueprint. Démo, graine 424242, distance du
recadrage mesurée au centre de gravité des pixels clairs, EN LECTURE RÉELLE :

| | A vers B | A vers le RETOUR de A |
|---|---|---|
| avant (`sectionKey`) | ~9 px | **~15 px** |
| après (partition) | ~41 px | **~28 px** |

Avant, le refrain qui revenait était cadré PLUS LOIN de A que ne l'était la
section B : la structure était non seulement invisible, elle était inversée.
Après, la section différente est la plus éloignée et celle qui revient se
rapproche. Le contraste entre sections passe au passage de 9 à 41 px — les
coupes deviennent visibles.

Les deux A ne coïncident pas exactement (28 px et non 0) : la dérive lente de
caméra (`DRIFT_CALM`, période 6,5 mesures) s'ajoute au plan et n'a pas la même
phase à 8 s et à 50 s. C'est voulu — le plan revient, pas l'image.

### Ce que ce chantier NE fait PAS, à cause de la régression du 13/08

§F3 cite aussi les variantes de style et le motif de couche alterné. **Les deux
sont écartés**, pour la raison mesurée hier : commuter une variante déplace de
37 % l'écart-type de luminance sur un temps — la sensation de punch. Les
variantes vont jusqu'à 0,17 de décalage, 1,30 de zoom, et l'une impose un mode
de fusion. Les commuter à chaque frontière ferait varier le punch EN COURS DE
MORCEAU, c'est-à-dire exactement le défaut qu'Aaron vient de signaler.

Ce chantier reste donc sur le levier déjà en service : décalage de l'ordre de
`REFRAME` (0,05), zoom au plus 1,07, aucun mode de fusion. Un test borne ces
valeurs. Et surtout : **il ne touche ni `amplitude`, ni `level`, ni `modulate()`
— rien de ce qui dose la réponse aux frappes.** La réaction au beat ne peut pas
changer par construction, pas seulement par mesure.

### Deux défauts trouvés par l'exécution

**1. Ma mesure était fausse avant de l'être moins.** Premier relevé : luminance
moyenne, identique à la décimale près dans les deux positions du drapeau.
Explication : translater une image ne change pas la quantité de lumière — la
luminance moyenne est aveugle à un cadrage. Passé au centre de gravité, avec un
contrôle (six graines, donc six variantes) qui déplace le centre de 135 px et
prouve que la mesure voit bien un cadrage.

**2. En PAUSE, la caméra de dramaturgie est gelée.** Le second relevé donnait
0,3 px d'écart entre sections, là où `REFRAME` = 0,05 devait en donner ~31.
Cause : `ui/App.ts` ne fait tourner la simulation que si `audioEngine.playing`
(ligne 2701), et `primeSceneIfPaused()` JETTE le director rendu par
`primeScene` — alors que la docstring de `primeScene` dit explicitement qu'un
appelant qui va dessiner en a besoin. Après un saut en pause, la caméra garde
donc le budget de la position précédente. Défaut ANTÉRIEUR à ce chantier, sans
effet sur la lecture ni sur l'export. Signalé, non corrigé : il a son propre
périmètre. Toutes les mesures ci-dessus ont été refaites en lecture réelle.

### Vérification

```
tsc --noEmit          exit 0
vitest run            134 fichiers / 1327 tests (17 nouveaux, 1 mis a jour)
npm run test:arch     arch verte + accords TOUS JUSTES (15)
navigateur            0 erreur console
```

`visualDirector.test.ts` mis à jour : il affirmait `cameraZoom === 1` hors
montée. Le zoom du plan s'y multiplie désormais ; l'assertion compare au plan
courant plutôt qu'à `1` en dur, ce qui exprime son intention réelle (« la
poussée de dramaturgie est nulle hors montée ») au lieu de nier la partition.

### Ce qu'Aaron doit regarder

Un morceau à structure claire (couplet / refrain / couplet), style Pulse.

1. Est-ce que le cadre CHANGE franchement quand la section change ?
2. Quand le refrain revient, est-ce qu'on retrouve le même point de vue ?
3. Est-ce que la synchro au beat est restée intacte ?

La 3 est la question qui compte, vu hier.

## 14/08/2026 — Aaron trouve la vraie piste : le kick n'a presque aucun poids visuel

### Le fait qui a tout recadré

Aaron, sur son morceau récalcitrant : « il ne paraît pas synchro sur PULSAR
mais il est synchro avec d'autres visuels — peut-être que c'est parce que le
kick manque d'impact visuel sur PULSAR ».

Ce n'est donc PAS un décalage de temps. C'est que l'œil n'arrive pas à
accrocher le beat. Mesure faite immédiatement, elle lui donne raison.

### Ce qu'un kick déclenche réellement sur `pulse`

Relevé du câblage, puis mesure du signal sur trois documents :

| ce qui réagit à `impact` | amplitude |
|---|---|
| rayon de `PulseRings` (trait fin) | 0,28 -> 0,375, soit **+32 %** |
| `ScreenShake` | 0,012 unité, et **seulement au-dessus de `impact > 0,7`** |
| `RadialBackground` | rien : il lit `subImpact` (SUB_HIT), pas KICK |
| `CircularWaveform` | rien : `accent` (SNARE/CLAP), `tick` (HAT), `barPulse` |
| `CentralGlow` | **rien** : `drive`, `brightness`, `tension`, LFO |

```
DEMO (kick a la noire)          impact max 0,929   secousse sur 2,2 % des pas
BEAT STUDIO v18 MELVELBASE      impact max 0,947   secousse sur 2,3 % des pas
BEAT STUDIO v18 + notes         impact max 0,956   secousse sur 2,6 % des pas
```

**Le signal est excellent** — `impact` monte à 0,93-0,96. Le défaut n'est ni
dans la détection ni dans le câblage musique->signal : c'est que **presque
rien à l'écran n'est branché dessus**.

Pire, l'élément le plus visible de `pulse` — le halo central — suit `drive`,
une enveloppe continue de retombée 0,55 s. À 136 BPM (0,44 s par temps) elle
n'a jamais le temps de redescendre entre deux kicks. Elle varie de **675 %**,
mais au rythme de l'ÉNERGIE du morceau, pas du beat. L'œil suit donc la grosse
masse lumineuse, qui respire lentement, pendant que le beat ne déplace qu'un
trait fin.

Sur un morceau au kick franc et régulier, la grille suffit à donner
l'illusion. Sur un morceau au kick moins saillant, l'illusion tombe — et c'est
exactement ce qu'Aaron décrit.

### Effet de bord relevé au passage

Sur les deux fixtures Beat Studio (Mode B, PMDI sans pistes de descripteurs),
`drive`, `weight` et `brightness` valent **0,000 en permanence** : elles se
câblent sur `feature:energy`, `feature:band.sub` et `feature:centroid`, qui
n'existent pas dans ces documents. Sans objet pour l'import audio (PULSAR
analyse alors lui-même), mais cela concerne le pont PMDI direct.

### État remis

Les TROIS chantiers du blueprint sont **éteints** : `VISUAL_DNA_V1`,
`TRACE_FIELD_V1`, `SECTION_STAGING_V1`. Aaron avait confirmé la synchro bonne
sur son beat 136 BPM dans cet état, puis cassée les trois allumés — cette
régression-là reste NON EXPLIQUÉE et garde son drapeau éteint.

Portique, trois drapeaux éteints : typecheck 0, **1327 tests verts**.

### Ce qui a permis d'y arriver

Un TÉMOIN. Aaron a exporté un beat de Beat Studio à 136 BPM ; PULSAR l'analyse
à 136 BPM et la synchro est bonne. Deux jours d'allers-retours ont été perdus à
lui faire juger « mieux / moins bien » sur des morceaux DIFFÉRENTS à chaque
essai. La première question à poser était : « quel BPM as-tu réglé, et quel BPM
PULSAR affiche-t-il ? »

## 14/08/2026 — Le halo bat sur la grosse caisse (`KICK_PUNCH_V1`)

Premier correctif du défaut trouvé par Aaron à l'oreille. Un seul changement,
délibérément : les trois autres corrections possibles (seuil de la secousse,
épaisseur de l'anneau, anneau à chaque kick) attendent son verdict sur
celle-ci. Juger quatre changements mélangés est exactement l'erreur des deux
jours précédents.

### Le choix : le DIAMÈTRE, pas l'intensité

`CentralGlow` ne lisait pas `impact`. Le brancher sur l'intensité aurait été
sans effet, et c'est mesuré : `gain = drive * intensityMul`, les trois alphas
sont écrêtés à 1, et sur Trap Dark (`glow` = 0,70 → `intensityMul` = 1,38) avec
`drive` mesuré à 0,909 au maximum, le gain vaut déjà **1,25**. Le canal est
SATURÉ là où l'on en a le plus besoin.

Le diamètre ne sature pas. `KICK_PUNCH = 0,30` : le halo enfle de 30 % sur une
frappe pleine, et `impact` porte déjà sa décroissance de 0,12 s — attaque
franche, retombée courte, aucun lissage à ajouter.

Cela n'enfreint pas « un instrument, un canal » : `tension` et `impact` sont
deux instruments distincts — la montée vers le drop dure des mesures, la frappe
un dixième de seconde — et leurs gonflements s'additionnent sans se confondre.

### Mesure, en LECTURE réelle, démo, graine 424242, section forte (t = 30 s)

Somme de luminance sur 70 images consécutives, échantillonnées par
`requestAnimationFrame` :

| drapeau | moyenne | min | max | **amplitude du battement** |
|---|---|---|---|---|
| OFF | 43 | 41 | 44 | **7,9 %** |
| ON | 44 | 42 | 50 | **18,1 %** |

**L'image bat 2,3 fois plus sur le beat.** Le pic monte de 44 à 50 : ce sont les
kicks qui ressortent, pas le niveau moyen qui augmente.

### Première mesure ÉCARTÉE, et pourquoi

Premier relevé fait à t = 12 s : aucune différence (48,7 % contre 50,3 %,
l'écart allant même dans le mauvais sens). Cause : à t = 12 la démo est en
section A, énergie 0,30, `drive` mesuré à 0,117 — **le halo y est quasiment
éteint**. Faire enfler de 30 % un objet invisible ne produit rien. Mesure
refaite en section B (énergie 0,82), où le halo existe.

C'est la troisième fois en deux jours qu'une mesure mal placée dit le contraire
de la vérité. Les deux précédentes : la luminance moyenne aveugle à un cadrage,
et la caméra gelée en pause.

### Vérification

```
tsc --noEmit          exit 0
vitest run            134 fichiers / 1332 tests (5 nouveaux)
npm run test:arch     arch verte + accords TOUS JUSTES (15)
navigateur            0 erreur console
```

Un test vérifie que l'INTENSITÉ ne bouge pas d'un iota selon `impact` : le kick
n'agit que sur la taille, et le drapeau éteint redonne exactement
`diameter * (1 + tension * 0,55)`.

### État des drapeaux

`KICK_PUNCH_V1` est le SEUL allumé. `VISUAL_DNA_V1`, `TRACE_FIELD_V1` et
`SECTION_STAGING_V1` restent éteints — la régression du 13/08 n'est toujours
pas expliquée.

### Ce qu'Aaron doit regarder

Son morceau récalcitrant, celui qui paraissait synchro ailleurs et pas ici.

1. Est-ce que le beat s'ACCROCHE maintenant ?
2. Est-ce que le halo pompe trop ? (30 % est un réglage, pas une fatalité)

Si la réponse à 1 est « oui mais pas encore assez », les trois autres
corrections restent en réserve.

## 14/08/2026 — LA DÉSYNCHRO EST TROUVÉE : l'horloge visuelle n'était jamais réancrée

Deux jours de fausses pistes se terminent ici, sur un défaut reproduit et
mesuré. Aucun des trois chantiers du blueprint n'était en cause.

### Le défaut

La boucle d'aperçu n'avançait `simT` **que par deltas** :

```ts
const audioAdvance = Math.max(0, audioEngine.t - lastAudioT);
const steps = fixedStep.advance(Math.min(audioAdvance, 0.25));
```

Elle ne la comparait **jamais** à la position audio ABSOLUE. Toute avance
perdue l'était donc pour toujours, et deux chemins la perdent :

1. un saut EN ARRIÈRE de l'horloge audio donne `max(0, négatif) = 0` :
   l'image garde son avance ;
2. une image de plus de 250 ms — saccade, onglet en arrière-plan, autre
   application — voit son avance ÉCRÊTÉE par le `Math.min`, et l'excès est jeté.

`correctDrift` protégeait `AudioEngine.t` depuis le MVP. Rien ne protégeait la
position de l'IMAGE. Et `SYNC_TOLERANCE_MS` existait… uniquement pour AFFICHER
le problème au panneau debug, jamais pour le corriger : le moteur mesurait sa
propre désynchronisation, l'affichait avec un ⚠️, et ne faisait rien.

### La reproduction, au navigateur

Curseur de recalage manœuvré de +200 à -200 ms, soit un saut de 400 ms de
l'horloge audio :

| étape | AVANT | APRÈS |
|---|---|---|
| référence 0 ms | -25,2 ms | -28,8 ms |
| réglage +200 ms | -29,3 ms | **+8,0 ms** |
| saut de 400 ms | **-426,3 ms** | **+6,0 ms** |
| 1,5 s plus tard | **-423,7 ms** — jamais rattrapé | **+5,9 ms** |
| gel forcé de 800 ms | perte définitive | **+4,0 ms** |

Un temps dure 441 ms à 136 BPM : l'image se retrouvait décalée d'un temps
ENTIER, définitivement. Seul un saut manuel dans la frise remettait les
compteurs à zéro — ce qui explique un symptôme insaisissable pendant deux
jours : « c'était synchro, et ensuite non ».

### Le correctif

`core/time/driftCorrection.ts::resyncVisualClock`, fonction pure, au MÊME seuil
que `correctDrift` (`HARD_RESYNC_THRESHOLD_SECONDS` = 0,12 s) — deux constantes
auraient dérivé l'une de l'autre sans que rien ne le signale. Drapeau
`AV_RESYNC_V1`.

La scène n'est PAS réinitialisée : un `scene.reset()` viderait les pools et la
traînée, un clignotement noir bien plus visible que le décalage corrigé. Les
couches se remettent d'un saut de 120 ms en quelques images, et
`EventDispatcher` gère déjà les deux sens.

Un compteur **réancrages** est ajouté au panneau debug : s'il MONTE en lecture
normale, la machine saccade. C'est le seul symptôme observable du défaut.

### Deuxième correctif du même jour : le recalage manuel image/son

`AudioEngine.setCalibrationOffset()` existait depuis le MVP et n'avait **aucun
appelant** : la calibration manuelle était écrite, testée, et inatteignable.
Le piège n°5 de CLAUDE.md la dit pourtant « obligatoire ».

Elle couvre un cas que rien ne peut deviner : `ctx.outputLatency` déclare ici
**40 ms**, mais un casque ou une enceinte Bluetooth ajoute 150 à 300 ms que le
navigateur ne voit pas. Le moteur se croit alors parfaitement calé pendant que
le son arrive à l'oreille un temps plus tard. Curseur ±300 ms, mémorisé en
`localStorage` — le retard est une propriété du MATÉRIEL, pas du projet, et
l'écrire dans le `.pvproj` le ferait voyager vers une machine où il est faux.

### Vérification

```
tsc --noEmit          exit 0
vitest run            134 fichiers / 1339 tests (7 nouveaux)
npm run test:arch     arch verte + accords TOUS JUSTES (15)
navigateur            0 erreur console
```

### Ce que cette affaire a coûté, et pourquoi

Deux jours à faire juger « mieux / moins bien » à Aaron sur des morceaux
DIFFÉRENTS à chaque essai, en soupçonnant successivement l'ADN visuel, les
traces, la partition de plans, le tempo détecté, puis la latence Bluetooth.

Trois choses ont débloqué l'affaire, toutes venues de lui :
1. **un témoin** — un beat exporté de Beat Studio à 136 BPM, détecté à 136 ;
2. **« synchro sur d'autres visuels »** — donc pas un décalage de temps mais un
   défaut de lisibilité, ce qui a mené au poids visuel du kick ;
3. **« synchro, puis plus synchro »** — le mot « puis », qui décrit une PERTE
   et non un décalage constant. C'est celui-là qui a designé le vrai coupable.

La leçon est écrite ici pour ne pas la reperdre : demander d'abord un TÉMOIN
qui marche, puis faire décrire le symptôme dans le TEMPS (constant ? progressif ?
après quoi ?) avant de toucher au code.
