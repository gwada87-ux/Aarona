# Mode live - notes d'implementation

Refonte du visualiseur live (PROMPT-live-visual-upgrade v2). Ce fichier est le
journal impose par le prompt (§0, fin de chaque etape de §9).

**Avancement : etapes 1, 2 et 3 de §9 livrees. Etapes 4 a 6 non commencees.**

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

---

## Etape 2 - Pipeline de rendu, palettes, FrameBudget

### Ce qui est livre

- `util/oklch.ts` (§3.5) - conversion OKLCH <-> sRGB dans le code, dans les
  deux sens, plus luminance WCAG et contraste. Fonctions pures.
- `render/Palette.ts` (§3.5) - 8 palettes, 5 roles, fondu perceptuel, cache de
  chaines `#rrggbb`, modulation de teinte BORNEE par construction.
- `render/FrameBudget.ts` (§3.7) - 4 niveaux, periode de reference estimee,
  descente 8/12, remontee 90, zone morte, gel.
- `render/LayerStack.ts` (§3.1) - inventaire memoire, `withFilter` comme seul
  point d'ecriture de `ctx.filter`, feature-test correct de `ctx.filter`.
- `render/Assets.ts` (§3.4) - tuile de grain additive, sprite de halo, overlay
  vignette + scanlines pre-compose.
- `render/Bloom.ts` (§3.2) - bright pass en deux variantes, flou par cascade
  ou par `ctx.filter`, remontee par paliers, replication des bords.
- `render/Feedback.ts` (§3.3) - ping-pong, decroissance normalisee par `dt`,
  injection ponderee par `(1-k)`, plancher 8 bits.
- `render/PostFX.ts` (§3.4) - aberration 2 canaux en demi-resolution, grain,
  overlay, sonde de luminance 32x18. Un seul `composite()`.
- `render/Camera.ts` (§3.6) - camera 2D commune ; le shake est une modulation
  de cette camera, pas un effet separe.
- `render/LivePipeline.ts` - assemblage.
- `audio/SectionEnergy.ts` (§2.7.9, §2.8) - detection breakdown / build / drop
  sur les niveaux BRUTS, drop quantifie sur le downbeat, plus l'intensite
  globale que consommera le director.
- `scenes/types.ts` (§4.1) et `scenes/WitnessScene.ts` - contrat des scenes et
  scene temoin.

### Ecart assume n°5 - ordre de degradation contre table des passes de bloom

§3.7 donne un ORDRE de desactivation (« aberration -> scanlines -> 2e echelle
de bloom -> grain -> feedback ») et, entre parentheses, une table
« passes de bloom (0/1/2/2) ». Les deux se contredisent : la table garde deux
echelles de bloom au niveau 1, alors que l'ordre les retire avant le grain,
lui-meme absent du niveau 1. L'ordre est la phrase normative, la parenthese
une illustration : c'est l'ordre qui est suivi. Decoupage retenu pour trois
descentes et cinq effets :

- 3 -> 2 : retire aberration et scanlines
- 2 -> 1 : retire la 2e echelle de bloom et le grain
- 1 -> 0 : retire le feedback

### Ecart assume n°6 - comptage des passes PONDERE PAR L'AIRE

Compter chaque `drawImage` comme une passe plein ecran donne 9 passes au
niveau 2 pour un budget de 6, et 7 au niveau 1 pour un budget de 3. Or une
passe sur un buffer au quart de la resolution lineaire ne coute pas une passe :
elle en coute 1/16. Le budget de §3.7 est un budget de REMPLISSAGE, et c'est
la seule lecture sous laquelle ses chiffres sont atteignables.

Le comptage est donc pondere par l'aire, relativement au canvas visible. Le
dessin de la scene elle-meme n'y entre pas : §3.7 chiffre la chaine de POST et
mesure les scenes separement, en temps de trame par scene.

### Deux optimisations que la mesure a imposees

1. **Chemin direct vers l'ecran.** L'aberration est le seul etage qui exige
   une source stable et relisible ; elle seule justifie un buffer de post
   intermediaire. Sans elle et a diviseur 1, composer directement sur le canvas
   visible economise une copie ET un blit plein ecran par trame, et libere un
   calque 1080p. Mesure : niveau 2 passe de 9 a 6,4 passes.
2. **Finition en resolution reduite.** Quand le diviseur est > 1, grain et
   overlay sont appliques sur le buffer de post, pas sur l'ecran : ils y
   coutent un quart de passe au lieu d'une, et le seul cout plein ecran
   restant est le blit final. Mesure : niveau 1 passe de 3,75 a 2,31 passes.

### Exclusion mutuelle aberration / grain

Ajoutee a la liste de §4.4. Le blit simple coute 1 passe, l'aberration a
2 canaux en demi-resolution en coute 4 : sans exclusion, une trame de
transitoire demande 11 passes la ou §3.7 en autorise 10. Les deux effets jouent
de toute facon sur le meme registre - la texture de l'image - et l'aberration
masque largement le banding que le grain sert a dithering.

### Mesures - navigateur, click track 128 BPM, Chrome

Canvas 1920x1080, ecran 60 Hz. Mediane sur 200 trames par niveau.

| qualite | mediane | passes (pic) | budget §3.7 | bitmap de post | memoire canvas |
|---|---|---|---|---|---|
| 3 | 15,4 ms | 9,36 | 10 | 1920x1080 | 34,2 Mo |
| 2 | 15,0 ms | 6,36 | 6 | 1920x1080 | 26,3 Mo |
| 1 | 15,6 ms | 2,31 | 3 | 960x540 | 10,0 Mo |
| 0 | 15,7 ms | 1,50 | 3 | 960x540 | 6,1 Mo |

**Les quatre niveaux tiennent 60 fps en 1080p sur cette machine** : la mediane
est plafonnee par la periode de l'ecran (16,7 ms), pas par le pipeline. La
marge reelle n'est donc pas mesurable ici ; elle le sera sur une scene chargee
en particules, a l'etape 3.

**Le niveau 2 depasse son budget de 0,36 passe** (6,36 contre 6). Les passes
irreductibles y sont : feedback 2, composition 1, recomposition du bloom 1,
grain 1, overlay 1 = 6,0 exactement. Le depassement est le travail
sous-resolution du bloom (bright pass et flou a 1/4 et 1/8). Le supprimer
demanderait de retirer le grain ou la 2e echelle de bloom au niveau 2, ce qui
inverserait l'ordre de desactivation de §3.7. Le depassement est de 6 % et
n'a aucun effet mesurable sur le temps de trame ; il est laisse tel quel et
signale ici plutot que masque en ajustant le budget.

Memoire canvas : 34,2 Mo au maximum, pour un plafond de 120 Mo (§3.1). Un
ecran 4K a DPR 2 sans plafond de bitmap en demanderait quatre fois plus - c'est
exactement ce que le plafond de 1920x1080 evite.

### Captures

Trois captures a trois instants, trois palettes, deux niveaux de qualite, dans
la reponse de livraison. Visibles : trainees de feedback, halo de bloom,
degrade d'horizon a 4 arrets, vignette, arc decentre, et un espace negatif
dominant (95 a 96 % du cadre sous 8 % de luminance).

### A valider par un humain

- Qualite d'image percue - le seul critere de §0 qui ne se mesure pas.
- Lisibilite du tempo son coupe : l'arc, l'epaisseur et la rotation portent
  respectivement le temps, la mesure et la phrase. A verifier a l'oeil.
- Choix des 8 palettes : les contrastes et les compositions sont verifies
  automatiquement, le GOUT ne l'est pas.

### Ce qui n'est PAS dans l'etape 2

Les scenes (etape 3), `LiveDirector` et `IntensityDirector` avec le budget
d'effets simultanes, le plancher de vide, la retenue avant impact et le
garde-fou de non-saturation (§2.8, etape 4), les overlays expressifs et leurs
exclusions (§4.4), les transitions de scene (§4.3), les controles clavier
(§4.5). La sonde de luminance de §2.8 EXISTE et est affichee au HUD ; ce qui
manque est le director qui s'en sert pour retirer un cran d'effets.

---

## Etape 3 - Interface LiveScene et trois scenes

§9.3 demande « interface `LiveScene` + 3 scenes (une par famille) », pas les six
de §4.2 - celles-ci sont reparties entre l'etape 3 (trois) et l'etape 5 (les
trois restantes). L'interface avait ete ecrite a l'etape 2 (§4.1 : « types a
ecrire en premier ») ; cette etape livre les trois scenes et le registre.

### Ce qui est livre

- `util/noise.ts` - simplex 2D et champ curl ECRITS A LA MAIN (§1 : aucune
  dependance npm ajoutee), deterministes et seedes.
- `scenes/index.ts` - registre. Ajouter une scene = ajouter une entree ; ni le
  pipeline, ni le panneau, ni le futur director n'ont a etre touches (§4.2).
- `scenes/GridHorizonScene.ts` - famille geometrique / neon.
- `scenes/CurlFlowScene.ts` - famille organique.
- `scenes/SliceDisplaceScene.ts` - famille glitch.

Chaque scene : 3 variantes internes, deux decentrees et une centree (§3.6), un
plan large et un gros plan, un accent principal declare (§2.7.6), et un canal
visuel par instrument sans jamais additionner deux enveloppes d'onset (§2.7.7).

| scene | accent principal | kick | snare | charley |
|---|---|---|---|---|
| `grid-horizon` | defilement du sol | echelle, soulevement de l'horizon | revelation du soleil | scintillement des fuyantes |
| `curl-flow` | noyau emetteur | rayon et bouffee d'emission | decalage lateral du noyau | dispersion fine |
| `slice-displace` | barre VHS | position et epaisseur de la barre | amplitude du decoupage | rayures fines |

### Pourquoi du bruit CURL et pas du bruit brut

Un champ de vitesse pris directement dans un bruit a de la divergence : les
particules s'accumulent dans les puits et se vident des sources, et au bout de
quelques secondes tout le monde est agglutine au meme endroit. Le curl d'un
potentiel scalaire est incompressible par construction (`div(curl(psi)) = 0`),
donc la densite reste homogene indefiniment. La propriete est verifiee par test
- divergence relative mesuree sous 5 %, le residu venant uniquement des
differences finies.

### Ecart assume n°7 - `slice-displace` privee de matiere par §3.3

§3.3 impose de vider SECHEMENT le feedback a chaque coupe de scene. §4.2 decrit
`slice-displace` comme « le buffer feedback redecoupe en bandes ». Mises bout a
bout, ces deux regles font demarrer la scene sur du noir : le decoupage n'a
rien a decouper, et la scene ne se remplit jamais - mesure de 0,006 de
luminance moyenne, contre 0,064 pour `grid-horizon`.

Le vidage est une regle explicite qu'on ne contourne pas. La scene injecte donc
sa PROPRE matiere - cinq bandes lumineuses dont la position est quantifiee sur
la mesure - qui sera decoupee aux trames suivantes. Ce ne sont pas des barres
de spectre au sens de l'interdit §6.1 : leur position vient de la grille
metrique et non d'un index de bande, et retirer l'audio ne rend pas la scene
identique a un analyseur, elle continue de defiler sur la mesure.

### Garde de taille sur la frame precedente

Le feedback n'est redimensionne qu'APRES le rendu de la scene. Juste apres un
resize, le buffer lisible est encore a l'ancienne taille, et une scene qui y
decoupe des bandes aux nouvelles coordonnees lit hors du bitmap. `LivePipeline`
n'expose donc `previousFrame` que lorsque les dimensions concordent : une trame
sans image precedente vaut mieux qu'une trame fausse.

### Mesures - 60 s par scene (livrable §9.3)

Chrome, canvas 960x540, click track 128 BPM, cadence ~20 Hz simulee (le volet
de previsualisation etait masque une partie du temps, voir plus bas).

| scene | trames | exceptions | croissance du tas JS | memoire canvas | passes (pic) |
|---|---|---|---|---|---|
| `grid-horizon` | 1650 | 0 | +0,22 Mo | 8,56 Mo | 9,36 / 10 |
| `curl-flow` | 1203 | 0 | **-0,06 Mo** | 6,58 Mo | 9,36 / 10 |
| `slice-displace` | 1202 | 0 | +0,80 Mo | 6,58 Mo | 9,36 / 10 |

Critere §8.9 : croissance sous 5 Mo entre deux GC forces. Le maximum mesure est
0,80 Mo, et `curl-flow` - la scene la plus allouante en apparence, avec ses
6000 particules - est celle qui croit le MOINS, ce qui confirme que les pools
pre-alloues font leur travail.

**Limite de la mesure, a lire :** sans `--expose-gc` on ne peut pas forcer de
collecte, donc l'ecart mesure INCLUT les ordures pas encore ramassees. Une
croissance nulle ou negative est concluante ; +0,80 Mo ne prouve pas une fuite,
seulement qu'il n'y en a pas de grosse.

Tempo verrouille pendant tout le soak sur les trois scenes (127,8 a 128,3 BPM,
0 a 4 kicks rejetes sur 130, aucune resynchronisation dure), ce qui verifie au
passage que le rendu ne perturbe pas l'analyse.

### Le volet de previsualisation et `requestAnimationFrame`

Quand le volet Navigateur n'est pas affiche, `document.hidden` vaut `true` et
`requestAnimationFrame` ne se declenche JAMAIS - la page ne compose pas de
trames. Aucune mesure de rendu n'est alors possible.

Le banc expose donc `window.__liveBench` : `start`, `stop`, `step(n, dtMs)`,
`setScene`, `stats`, `probe()`, `capture()` et `soak(scene, secondes)`. Le
`step` force une trame avec un horodatage injecte, ce qui suffit a verifier que
la chaine rasterise et a mesurer memoire et passes. Ce qu'il ne remplace PAS :
le temps de trame, qui n'a de sens que sur des trames reellement cadencees par
le compositeur.

### A valider par un humain

- **Le tempo est-il lisible son coupe ?** Sur `grid-horizon` le sol avance
  d'exactement une cellule par temps - c'est le test le plus direct des trois.
- Le rendu de `slice-displace` en situation reelle : elle est concue pour
  passer APRES une autre scene, et le vidage du feedback la prive de cet
  heritage. A revoir a l'etape 4, quand le director enchainera les scenes.
- L'equilibre entre les trois scenes : `grid-horizon` mesure 0,064 de luminance
  moyenne contre 0,007 pour les deux autres. C'est coherent avec §3.6 (espace
  negatif >= 40 % en `calm`), mais l'ecart de 9x se verra en enchainement.

### Ce qui n'est PAS dans l'etape 3

`LiveDirector` (§4.3) : le choix de scene, la rotation, l'arbitrage des coupes,
l'anti-repetition et les transitions. Le panneau affiche UNE scene fixe, prise
dans le registre - deliberement pas de minuteur de rotation, qui serait
exactement ce que §4.3 interdit, un changement de scene ne tombant sur aucune
frontiere. Les trois scenes restantes de §4.2 sont l'etape 5.
