# Mode live - notes d'implementation

Refonte du visualiseur live (PROMPT-live-visual-upgrade v2). Ce fichier est le
journal impose par le prompt (§0, fin de chaque etape de §9).

---

## §0 - Chemins reels (releves, pas devines)

| role | chemin reel |
|---|---|
| panneau live | `src/ui/live/LiveVisualPanel.ts` |
| source audio live | `src/audio/LiveAudioSource.ts` |
| limiteur de flash | `src/visual/safety/FlashLimiter.ts` |
| bandes log | `src/analysis/spectrumBands.ts` (`computeLogSpacedBinRanges`) |
| FFT reutilisable | `src/analysis/fft.ts` (`fft(re, im)`, radix-2 en place) |

**Appelants de `LiveVisualPanel`** (recherche sur tout le depot hors `node_modules`) :

- `src/ui/App.ts` - seul appelant executable :
  - l.37 `import { LiveVisualPanel } from './live/LiveVisualPanel'`
  - l.1189 declaration `liveVisualPanel`
  - l.1206 `liveVisualPanel?.stop()` (nouvelle offre SDP)
  - l.1209 `new LiveVisualPanel(wrap)` (`wrap` = `#preview-wrap`)
  - l.1213 `liveVisualPanel?.stop()` (connexion fermee/echouee)
  - l.1219 `liveVisualPanel?.start(...)` (dans `onTrack`)
  - l.1238 `liveVisualPanel?.panelActive` (debug Playwright, `import.meta.env.DEV`)
- `docs/JOURNAL.md` - mention documentaire uniquement, aucun code.

Aucun autre appelant. `LiveVisualPanel` n'est importe par aucun test existant.

---

## Ecart assume n°1 - emplacement `src/ui/live/` et non `live/` racine

Le prompt (§5, §8.13) place l'arborescence dans un `live/` a la racine du depot.
Ici tout reste sous `src/ui/live/`. Raison : `tests/unit/architecture.test.ts` ne
parcourt que `src/`, et `CLAUDE.md` verrouille le tableau des couches
(`ui/ -> tout`). Un `live/` hors `src/` sortirait du perimetre controle par le
test d'architecture, c'est-a-dire du seul garde-fou automatique du depot.
`LiveVisualPanel.ts` etait deja dans `src/ui/live/` : la contrainte « deplace,
pas duplique » est satisfaite sans `git mv`.

Le module reste self-contained : `src/ui/live/**` n'importe hors de lui que
`src/analysis/` (bandes log, FFT du banc d'essai), `src/audio/LiveAudioSource`
et `src/visual/safety/FlashLimiter` - tous autorises depuis la couche `ui`.

---

## Cout reel de `FlashLimiter` (impose par §1)

Lu dans `src/visual/safety/FlashLimiter.ts` avant cablage :

- **Il lit bien des pixels.** `measureLuminance()` fait
  `sampleCtx.drawImage(canvas, 0, 0, 32, 18)` puis `getImageData(0, 0, 32, 18)`
  sur un `OffscreenCanvas` **32x18 alloue une seule fois** au constructeur, avec
  `willReadFrequently: true` sur ce buffer de mesure uniquement.
- Il ne travaille donc **jamais en pleine resolution** : l'exigence §1
  (« maintiens un buffer de mesure 32x18 reutilise ») est **deja satisfaite par
  l'implementation existante**, sans modification. Le `willReadFrequently: true`
  porte sur le buffer 32x18, pas sur un calque du pipeline - l'interdit §3.1
  n'est pas viole.
- Il mesure **une image sur deux** (`frameParity`), le seuil etant en
  flashs/seconde et non par image.
- `apply(t)` attend un temps **musical** en secondes. En live il n'y a pas de
  temps musical au sens du mode fichier ; on lui passe le temps ecoule depuis
  `start()` en secondes d'horloge audio (`audioContext.currentTime`), pas
  `performance.now()`.
- Cout par image mesuree : 1 `drawImage` vers 32x18 + 1 `getImageData` de
  576 pixels + une boucle de 576 iterations. Le poste dominant est le flush
  synchrone du pipeline 2D impose par `getImageData`, pas la boucle.

**Etape 1 : le limiteur reste cable exactement comme avant** (appel unique en
fin de `draw()`). Le pipeline de post (§3.1) et le partage du downscale 32x18
avec la mesure de saturation (§2.8) sont de l'etape 2.

---

## Etape 1 - Analyse audio + BeatClock + HUD + banc synthetique

### Ce qui est livre

- `LiveConfig.ts` (§5.1) - toutes les constantes de reglage des sections
  couvertes par l'etape 1 (`audio`, `beat`, `sync`, `state`, `content`).
  Les groupes `render` / `director` / `perf` / `safety` ne sont **pas** encore
  definis : ils n'ont aucun consommateur avant l'etape 2, et `CLAUDE.md`
  interdit d'ajouter des options non utilisees.
- `audio/bins.ts` - conversions Hz <-> bin, derivees de `ctx.sampleRate`.
  Aucun `44100` en dur nulle part (§2.0).
- `audio/AnalysisGrid.ts` (§2.1) - reechantillonnage a 50 Hz par interpolation
  lineaire, horodate sur `audioContext.currentTime`, normalisation du flux par
  le hop reel, garde anti-buffer-rejoue.
- `audio/AudioFeatures.ts` (§2.2) - 5 macro-bandes, 32 bandes log, centroide et
  platitude **recalcules en puissance lineaire**, enveloppes a coefficients
  fonction de `dt`, AGC a suiveur de crete asymetrique.
- `audio/OnsetDetector.ts` (§2.3) - blanchiment adaptatif par bin, 3 flux
  divises par leur nombre de bins, peak-picking normalise + maximum local +
  seuil adaptatif + refractaire relatif au tempo, retro-datation du retard de
  groupe, arbitrage de diaphonie kick/snare.
- `audio/TempoEstimator.ts` (§2.4) - autocorrelation non biaisee sur fonction
  de detection large bande centree, scoring de familles d'octave avec a priori
  log-normal, preuve rythmique pairs/impairs, hysteresis d'adoption et
  d'octave, fenetre a croissance 3 -> 6 -> 8 s.
- `audio/BeatClock.ts` (§2.5) - PLL a erreur de phase circulaire, avance de
  phase bornee, resync dur, vote de downbeat a quatre indices, `syncOffsetMs`
  calcule.
- `audio/LiveAnalysisEngine.ts` (§2.6) - machine a etats BOOT/IDLE/REACTIVE/
  LOCKED, gate de silence, detection de changement de morceau, retour d'onglet.
- `DebugHud.ts` (§4.6) - dessine sur le canvas visible, apres tout le reste.
- `testing/` - banc synthetique sans navigateur (§7).

### Ecart assume n°2 - `syncOffsetMs` : double compensation dans le prompt

Le prompt impose **deux** compensations qui portent sur le meme retard :

- §2.3 (MUST) : `onsetTime = tLecture - fftSize / (2 * sampleRate)`. Les
  horodatages d'onsets sont donc **deja** ramenes sur la timeline reelle du
  contenu audio, et c'est cette timeline que `BeatClock` verrouille.
- §2.5 : `syncOffsetMs = analyserDelayMs + pickLookaheadMs + presentDelayMs
  - audioAheadMs + userTrimMs`, ou `analyserDelayMs` vaut exactement le meme
  `1000 * fftSize / (2 * sampleRate)`.

Appliquer les deux avance le visuel de `analyserDelayMs + pickLookaheadMs`
~= 23,2 + 20 = **43 ms** de trop. Derivation de la valeur correcte, avec la
convention `tMusical = tFrame + syncOffsetMs / 1000` :

```
contenu vu par l'analyseur a t  ->  entendu par l'oreille a  t + audioAhead
image rendue a t                ->  affichee a               t + presentDelay
egalite voulue a l'instant d'affichage :
    tMusical = (t + presentDelay) - audioAhead
d'ou  syncOffsetMs = presentDelayMs - audioAheadMs + userTrimMs
```

Implementation retenue : la formule complete du prompt est ecrite telle quelle,
mais les deux termes deja compenses sont neutralises par le drapeau
`sync.onsetBackdatingApplied` (defaut `true`, coherent avec §2.3). Le mettre a
`false` reproduit litteralement la formule §2.5. Le HUD affiche les cinq termes
separement pour que le choix soit verifiable a l'oeil.

**A trancher par Aaron** si la calibration reelle contredit cette derivation :
c'est `sync.userTrimMs` qui absorbe l'ecart, reglable au HUD (fleches haut/bas).

### Ecart assume n°2bis - signe de la correction de phase du PLL

Le prompt §2.5 ecrit `phase += alphaEff * e`. Ce signe est **inverse** et fait
diverger le PLL - exactement le defaut contre lequel son propre commentaire met
en garde. Derivation complete dans l'en-tete de `audio/BeatClock.ts`. En
resume : un kick tombant a `beatPhase = 0.05` signifie que l'horloge a deja
emis son temps, elle est EN AVANCE, il faut DIMINUER la phase - or `e = +0.05`.
La correction est donc `phase -= alphaEff * e`.

Le signe de la correction de PERIODE du prompt est en revanche correct.

### Ecart assume n°3 - `TempoEstimator` non etale sur 4 trames

Le prompt suggere d'etaler l'evaluation d'autocorrelation sur 4 trames
consecutives. Non fait : mesure ci-dessous. La plage BPM 60-200 a 50 Hz donne
des lags entiers de 15 a 50, soit **36 candidats seulement** ; la passe entiere
(lags 15 a 200 pour les harmoniques) plus la recherche fractionnaire locale
coutent ensemble ~176 000 MAC, mesures a moins de 0,3 ms. Etaler un pic de
0,3 ms toutes les 250 ms ajouterait de l'etat mutable (snapshot de la fenetre,
resultat partiel) pour un gain non mesurable. Chiffre reel consigne plus bas.

### Ecart assume n°4 - mediane glissante remplacee par moyenne + ecart-type

§2.3 le prevoit explicitement (« Utilise moyenne + ecart-type glissants (mise a
jour O(1)) plutot qu'une vraie mediane recalculee par trame sur 3 bandes »).
Le terme `median(o[n-50..n])` du seuil est donc la moyenne glissante sur 50
echantillons de la fonction normalisee. La vraie mediane est en revanche
conservee dans `TempoEstimator.confidence`, ou elle n'est calculee que 4 fois
par seconde sur 36 valeurs.

### Precision du BPM - pourquoi une recherche fractionnaire etait obligatoire

Critere §8.2 : +/- 0,5 BPM. A 128 BPM le lag vaut `3000 / 128 = 23,44`
echantillons, et `d(bpm)/dL = -3000 / L^2 = -5,46 BPM par echantillon`. Le
critere exige donc de resoudre **0,09 echantillon**. Un `argmax` entier donne
5,5 BPM de quantum, et l'interpolation parabolique seule est biaisee sur un pic
d'autocorrelation de train d'impulsions (sommet triangulaire, pas parabolique).

Le PLL ne peut pas rattraper : avec `alpha = 0,20`, l'erreur de phase
stationnaire vaut `e* = rho / alpha = 5 * rho` (rho = erreur relative de
periode), et la correction de periode `beta * e` avec `beta = 0,01` corrige
`0,05 * rho` par temps - soit une constante de temps de 20 temps, ~9 s a
128 BPM. Incompatible avec « verrouillage en moins de 4 s ».

Retenu : passe entiere pour choisir la famille d'octave, puis recherche
fractionnaire au pas de 0,02 echantillon sur `[Lb - 1, Lb + 1]` en score
harmonique (autocorrelation interpolee lineairement). Resolution effective
~0,11 BPM a 128 BPM.

### Sept defauts trouves par l'EXECUTION, pas par la lecture

Aucun de ces sept n'etait visible dans le code. Tous ont ete localises en
instrumentant le moteur sur signaux synthetiques, puis corriges et verrouilles
par un test. Ils sont documentes a l'endroit du code qui les corrige.

1. **Seuil de peak-picking empoisonne au demarrage.** Au premier pas la
   variance vaut 0, `(x - mu) / (sigma + 1e-6)` produit des valeurs de l'ordre
   de 1e6, et la moyenne glissante qui sert de seuil met des dizaines de
   secondes a redescendre. Mesure : seuil a 439 apres 2 s, **11 kicks detectes
   sur 42**. Corrige par une correction de biais sur l'alpha
   (`OnsetDetector.normalizeChannels`).
2. **Harmoniques evaluees a des multiples ENTIERS d'un lag entier.** Le pic
   d'autocorrelation a une demi-largeur d'environ 0,5 echantillon
   (`r[46] = 0.225` contre `r[47] = 0.820`) : les harmoniques d'un lag entier
   tombent dans les creux quand le vrai lag est fractionnaire. Le moteur
   verrouillait **63,8 BPM au lieu de 128**. Corrige par une recherche
   entierement fractionnaire, en deux passes (`TempoEstimator.searchLag`).
3. **Interpolation lineaire de l'autocorrelation.** Le maximum d'une fonction
   affine par morceaux est toujours sur un noeud : la « recherche fine »
   renvoyait systematiquement un lag entier, soit 5,5 BPM de quantum a
   128 BPM. Corrige en decalant le SIGNAL, pas la correlation
   (`TempoEstimator.acfAt`).
4. **Aucune acquisition de phase initiale.** A 174 BPM l'erreur de phase
   stationnaire valait -0,18 temps : au-dessus de la fenetre d'acceptation
   (0,12) mais en dessous du seuil de resynchronisation dure (0,25). Le PLL
   rejetait **les 77 kicks du signal** et restait bloque a -62,6 ms
   indefiniment. Corrige par un court-circuit d'acquisition et par le comptage
   de toute rejection consecutive vers la resynchronisation (`BeatClock.onKick`).
5. **Instants d'onsets quantifies au pas de grille.** Sur un signal periodique
   la quantification n'est pas un bruit independant : le motif d'arrondi se
   repete et biaise toute estimation de periode ajustee sur ces instants
   (126,6 BPM au lieu de 128). Corrige par interpolation parabolique du pic
   (`OnsetDetector.evaluateCandidate`).
6. **Flux spectral calcule par TRAME.** La fenetre d'analyse fait 42,7 ms :
   a 120 fps l'energie d'une attaque s'etale sur cinq trames, a 30 fps sur une
   seule. Normaliser par `hop / dt` ne corrige que la moyenne, pas le pic - et
   c'est le pic qui decide du niveau metrique. Mesure : **127,9 BPM a 60 fps,
   63,9 a 120 fps** sur le meme signal. Corrige en integrant le flux sur le pas
   de grille et en le repartissant au prorata du temps
   (`SpectralFlux.accumulate` / `take`, `LiveAnalysisEngine.onGridTick`).
7. **Hesitation d'octave lue comme un changement de morceau.** L'hysteresis
   d'octave dure 6 s, le delai de changement de morceau 4 s : un candidat a la
   moitie du tempo declenchait un re-arm complet avant d'avoir pu etre rejete,
   et le moteur reperdait son BPM toutes les 8 s. Corrige par exclusion des
   rapports harmoniques (`LiveAnalysisEngine.detectTrackChange`).

### Mesures - criteres §8.1 a §8.7

Sortie de `npx vitest run tests/unit/live`, 22 tests, tous verts. Valeurs
relevees pendant la mise au point :

| critere | mesure |
|---|---|
| §8.2 128 BPM, verrouillage | +/- 0,34 BPM a t = 4 s |
| §8.2 128 BPM, phase RMS sur 60 s | 5,9 ms (moyenne 5,3 / ecart-type 2,4) |
| §8.3 90 BPM | phase RMS 7,0 ms |
| §8.3 140 BPM | phase RMS 3,9 ms |
| §8.3 174 BPM | phase RMS 5,0 ms |
| §8.3 128 et 174 BPM, gigue 2 % | verrouilles a t = 4 s, RMS sous 12 ms |
| §8.4 rampe 120 -> 128 | reverrouillage 3,3 s apres la fin de la rampe |
| §8.4 saut de phase maximal | borne par construction a 15 ms/trame (`resyncMaxJumpMs`) |
| §8.5 four-on-the-floor 126 | 0 changement de downbeat sur 32 mesures |
| §8.6 silence 5 s | 0 onset, etat IDLE, AGC gele |
| §8.7 90 -> reset -> 140 | 140 BPM, aucun residu de 90 |
| decouplage framerate | 60 fps 127,96 / 120 fps 128,13 / 30 fps 128,55 |

Cout de l'evaluation d'autocorrelation : environ 460 000 MAC (passe grossiere
au pas de 0,1 sur les lags 15-50, puis passe fine au pas de 0,02), soit moins
de 1 ms, a 4 Hz en regime etabli et 8 Hz pendant l'acquisition.

**A 30 fps l'intervalle de trame (33 ms) depasse le pas de la grille (20 ms).**
La resolution temporelle des attaques est alors bornee par le framerate et la
periode estimee est mecaniquement moins precise : 128,55 BPM au lieu de 128,00.
Ce qui compte a cette cadence est l'absence de basculement de niveau metrique,
et c'est ce que verifie le test.

### Verification au navigateur

`src/ui/live/testing/live-bench.html`, servi par `npm run dev`
(`http://localhost:5174/src/ui/live/testing/live-bench.html`), click track a
128 BPM synthetise par de vrais `OscillatorNode` / `BiquadFilterNode`, analyse
par de vrais `AnalyserNode` :

```
etat        LOCKED
tempo       127.96 BPM   conf 0.72   downbeat 0.17
octaves     127.7:1.19  63.8:0.86  85.7:0.77
kicks       33 acceptes / 0 rejetes   resync 0
sync        -28.8 ms   avance audio 53.8 ms   trim 0 ms
```

Aucune erreur console. Noter le signe : `audioAheadMs` vaut +53,8 ms - l'analyse
est bien EN AVANCE sur l'oreille - donc `syncOffsetMs` est NEGATIF. C'est
exactement le point de §2.5 sur lequel le raisonnement « -45 ms compense la
latence » se trompe.

`downbeatConfidence` reste basse (0,17) sur ce motif : le click track du banc a
un kick sur chaque temps et un snare sur 2 et 4, sans ligne de basse ni
variation de mesure, donc trois des quatre indices du vote n'ont rien a dire.
Le critere §8.5 porte sur la STABILITE de l'hypothese, pas sur sa confiance, et
il est tenu. A reevaluer sur de la vraie musique.

### Fichiers touches hors `src/ui/live/`

- `src/audio/LiveAudioSource.ts` - **ajouts seulement**, liste blanche §8.13 :
  second `AnalyserNode` 8192, `smoothingTimeConstant` / `minDecibels` /
  `maxDecibels`, `getFloatFrequencyData()`, `getFloatBandsFrequencyData()`,
  `getFloatTimeDomainData()`, `getSampleRate()`, `fftSizeOnset`, `fftSizeBands`,
  `analysisReady`. Aucune signature existante supprimee : `getFrequencyData()`,
  `getEnergy()` et `frequencyBinCount` fonctionnent a l'identique, et le
  troisieme parametre d'`attachAnalysis` accepte toujours un nombre.
- `src/ui/App.ts` - `start(source, sampleRate, fftSize)` devient
  `start(source, config?)`, plus `attachAudioContext(liveCtx)` et deux
  accesseurs de debug (`engineState`, `bpm`) dans le bloc `import.meta.env.DEV`
  existant.

### A valider par un humain (non mesurable ici)

- Lisibilite du tempo son coupe - impossible tant que l'etape 2 (rendu) n'est
  pas livree ; l'etape 1 ne change pas le visuel.
- Latence son -> image reelle : exige de filmer ecran + son a 240 fps sur un
  click track de BPM connu. `sync.userTrimMs` est le reglage prevu pour ca,
  aux fleches haut/bas quand le HUD est ouvert (`D`).
- Comportement en Bluetooth : le HUD affiche `audioAheadMs`, attendu entre
  100 et 250 ms. Verifier que `syncOffsetMs` devient franchement negatif.

### Ce qui n'est PAS dans l'etape 1

Pipeline de rendu (§3), palettes OKLCH (§3.5), scenes (§4.2), director (§4.3),
overlays (§4.4), controles clavier hors HUD (§4.5), `FrameBudget` (§3.7),
`IntensityDirector` (§2.8). Le rendu reste celui d'avant, simplement alimente
par les nouvelles features au lieu des octets bruts.
