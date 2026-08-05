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
