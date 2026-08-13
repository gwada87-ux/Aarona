# 18 — BLUEPRINT VISUELS 2026 : analyse, recherche, innovation

> Rapport stratégique produit le 13/08/2026 en réponse au brief « PRO VISUALIZER
> RESEARCH 2026 ». Phase d'analyse pure : **aucun code n'a été modifié**.
> Fondé sur la lecture du code réel (styles, couches, directors, presets,
> renderers, docs/JOURNAL.md jusqu'à la clôture ADR-014/015) et sur l'état de
> l'art connu à début 2026.
>
> **Limite de séance, à lire** : l'outil de recherche web était en panne pendant
> toute la rédaction (indisponibilité du service de validation, hors de notre
> contrôle). La section C repose donc sur des connaissances vérifiées jusqu'à
> janvier 2026, pas sur des URL consultées le jour même. Les conclusions
> stratégiques n'en dépendent pas — elles découlent d'abord de l'audit du code —
> mais une passe de vérification web reste à faire pour dater précisément les
> références. Elle est marquée [À VÉRIFIER WEB] là où ça compte.

---

## A. EXECUTIVE SUMMARY

1. **Le différenciateur existe déjà et il est rare : la vérité musicale.**
   Aucun visualizer grand public ne dispose de ce que PULSAR a : des événements
   EXACTS (kick, snare, hat, 808, mesure, section, notes, accords) fournis par
   le séquenceur via PMDI, une `render(t)` déterministe, et une couleur qui
   suit l'harmonie par le cercle des quintes. Les concurrents DEVINENT la
   musique ; PULSAR la SAIT. Toute la stratégie doit amplifier cet écart, pas
   ajouter des effets.

2. **Le manque n'est pas la technique, c'est la durée.** Le socle (directors,
   dramaturgie chiffrée, palettes OKLCH bornées, bloom/HDR WebGL2) est au
   niveau des références pro. Ce qui sépare encore PULSAR d'un rendu « signé » :
   un même style rend quasiment la même expérience pour deux morceaux du même
   genre, et une même expérience à la minute 1 et à la minute 3. Les trois
   chantiers à plus fort levier sont **Visual DNA** (le morceau paramètre le
   monde), **mémoire visuelle** (les événements laissent des traces), et
   **mise en scène par section** (le morceau écrit son storyboard — le mode
   fichier connaît le FUTUR, avantage unique qu'aucun outil temps réel n'a).

3. **Pas de nouvelle technologie nécessaire.** WebGL2 est en place côté fichier,
   le live reste Canvas2D sur mesure (ADR-014, tranché par la mesure — on ne
   re-litige pas). WebGPU : attendre. Les gains viennent de systèmes, pas de
   pixels : 5 nouveaux styles maximum, choisis pour couvrir des identités
   absentes du catalogue, et 4 systèmes transverses qui profitent aux 8 styles
   existants d'un coup.

---

## B. AUDIT DE L'EXISTANT

### Ce qui est là (relevé du code, pas des intentions)

**Architecture** — deux moteurs assumés :
- **Mode fichier** : analyse hors ligne → PMDI → `MusicTimeline` →
  `StepContext` (1/120 s) → `BehaviourEngine` (signaux abstraits) → `Scene` /
  `Layer[]` → `Renderer` (Canvas2D **et** WebGL2 HDR, parité testée) →
  `FlashLimiter`. `render(t)` pure, PRNG seedé `hash(projectSeed, stepIndex)`.
- **Mode live** : WebRTC → analyse temps réel (onsets blanchis, PLL de tempo
  ±0,34 BPM, sections) **ou canal de vérité PMDI direct depuis Beat Studio
  (Mode C, ADR-012)** → `LivePipeline` Canvas2D → scènes → directors.

**Intelligence musicale** (`analysis/`, `music/`) :
- Événements classifiés : KICK, SNARE, CLAP, HAT, PERC, SUB_HIT ; synthétisés :
  BEAT, BAR, DOWNBEAT, PHRASE ; macro : DROP, BUILDUP, BREAK, ENERGY_UP/DOWN,
  SILENCE ; structure en sections avec lettres A/B/C et énergie ; notes et
  accords (Mode B/C). Toute détection porte une `confidence` ; sous 0,6 de
  confiance de grille, régime continu (Loi 3).
- Signaux : familles Impulse/Envelope/Continuous/Trend/**Anticipation**
  (`anticipate:DROP` — la montée vers un événement futur existe déjà), 4 LFO
  verrouillés au tempo, câblage musique→signal en JSON par preset.

**Dramaturgie** — le point le plus au-dessus de la moyenne du marché :
- Live : `IntensityDirector` (budget d'effets, plancher de vide forcé par
  phrase, retenue avant impact, retombée post-drop sous le niveau antérieur,
  garde-fou de saturation) + `LiveDirector` (coupes quantifiées à la phrase,
  anti-répétition) + `Overlays` (exclusions mutuelles, budget).
- Fichier : `VisualDirector` **sans état** (Loi 1) — arcs
  intro/build/drop/fallout/breakdown/void relus depuis la timeline, amplitude
  qui TOMBE de 1,0 à 0,45 sur les deux dernières mesures d'une montée, caméra
  translation + zoom [1..2] avec poussée +12 % relâchée au drop (ADR-011).

**Couleur** : OKLCH partout, 8 palettes live à 5 rôles, palettes de preset avec
`drift` par énergie, harmonie→teinte par cercle des quintes RELATIF au centre
tonal (ADR-015), rotation de teinte horloge interdite et bornée
(`CHORD_HUE_SHARE = 0,6` de l'enveloppe `hueModulation`). Pochette → palette
extraite (chantier 7).

**Catalogue** : 8 styles fichier + variantes de cadrage (au plus 1/3 centrées),
8 scènes live, 11 presets de genre, 8 macros (energy, reactivity, density,
movement, depth, glow, chaos, smoothness), suggestion automatique de preset
(3 critères + filtre de régime), Looks, automatisation par images-clés, texte
animé, modes de fusion par couche.

**Rendu** : Canvas2D discipliné (sprites additifs pré-rendus, bloom 1/4 rés.
≈2,5 ms, aberration chromatique sans getImageData, résolution interne 0,6–1×,
zéro allocation en boucle) ; WebGL2 par défaut en fichier (HDR linéaire,
tonemap, bloom multi-échelles GPU) ; `FrameBudget` 4 niveaux en live ;
`FlashLimiter` non contournable. Export WebCodecs figé à HIGH, déterministe.

**Qualité de fabrication** : ~800 tests verts au seuil de la phase 2, test
d'architecture qui verrouille les dépendances entre couches, journal
d'ingénierie exemplaire (défauts trouvés par l'exécution, mesures collées).

### Forces (à ne surtout pas casser)

1. La **vérité PMDI** + le déterminisme : personne d'autre ne l'a.
2. La **retenue** comme principe (« ce que l'écran ne fait PAS ») — c'est
   littéralement le critère n°1 du rendu pro, déjà codé et chiffré.
3. La séparation musique→signaux→visuel : recâbler sans toucher au code.
4. La discipline de perf mesurée (jamais « ça devrait aller »).

### Faiblesses / occasions (les vraies)

| # | Constat | Conséquence perçue |
|---|---|---|
| F1 | Un même preset+style rend presque la même chose pour deux morceaux différents (seuls le drift d'énergie, les events et la graine varient) | « joli mais générique » à la 3e vidéo |
| F2 | Aucune trace persistante des événements : un kick est un flash, pas une empreinte ; le seul passé visuel est le feedback (uniforme, non sémantique) | le monde n'a pas d'histoire, la répétition se voit |
| F3 | Le `VisualDirector` module intensité/caméra mais pas la **composition** : pas de changement de point de vue, de densité de couches ou de motif entre section A et section B | minute 1 = minute 3 |
| F4 | La physique est par-couche et ad hoc (drift, attraction, ondes) : pas de vocabulaire commun ressorts/inertie/turbulence réutilisable | mouvements corrects mais peu « organiques » |
| F5 | Le catalogue couvre sobre/particules/spectre/masse/grille/poussière/éclats/rubans — il manque : fluide, tunnel/profondeur 3D, typographie cinétique (fichier), et un style « lumière-matière » haut de gamme | pas de style « wow » de démo |
| F6 | Les notes/accords ne sont exploités que par la teinte (fichier) et `note-helix` (live) | l'atout mélodique reste sous-utilisé |
| F7 | WebGL2 livré à parité SDR/HDR mais aucun style n'exploite ce que le GPU permet en PLUS (particules ×10, grain/LUT, distorsions) | l'investissement GPU ne se voit pas encore |

---

## C. RECHERCHE 2026 — références, tendances, techniques

> Connaissances arrêtées à janvier 2026 ; [À VÉRIFIER WEB] pour les dates fines.

### Références produits et scène

| Référence | Ce qui fonctionne | Pourquoi | À adapter | À ne pas copier |
|---|---|---|---|---|
| **Synesthesia** (VJ desktop) | scènes GLSL avec « meta-controls » mappés au son | chaque scène expose peu de paramètres, bien choisis | nos macros font déjà ça ; ajouter le morphing continu entre variantes | son analyse audio approximative — on a mieux |
| **projectM / MilkDrop** | héritage : feedback + warp du framebuffer | la rémanence déformée crée une richesse infinie à coût nul | un `FeedbackWarp` paramétrique (zoom/rotation/warp par signal) au lieu du feedback fixe 0,88/1,004 | le côté psychédélique aléatoire, illisible musicalement |
| **Astrofox / Specterr** (export vidéo) | positionnement produit : vidéo pour artistes | c'est le même marché que PULSAR | rien techniquement — leur réactivité est volume→scale, PULSAR est déjà loin devant | tout le reste |
| **TouchDesigner** (scène pro) | pipelines nodal GPU, instancing massif, feedback 3D | la norme des concerts 2024-2026 | les IDÉES d'effets (particules instanciées, feedback transformé), pas l'outil | la généralité : PULSAR gagne à rester opinioné |
| **Notch / Resolume** (tours, clubs) | beat-sync ferme, « looks » commutés par section | les VJ pro commutent des états entiers sur les frontières musicales | conforte le chantier « mise en scène par section » | dépendance à un opérateur humain |
| **Anyma / Eric Prydz HOLO** (esthétique festival 2024-25) | volumes 3D monumentaux, lumière comme matière, noir dominant | le contraste et l'échelle, pas la quantité d'effets | style « monolithe de lumière » (E3) ; l'espace négatif est déjà une règle du live — le garder | le kitsch humanoïde, déjà daté |
| **Refik Anadol** | données → matière fluide | la fluidité continue hypnotise | un style fluide par curl noise (pas de vraie simu) | le brouillard IA générique |
| **Shadertoy** (culture shader) | palettes cosine (I. Quilez), fbm, domain warping | beauté/coût imbattables en fragment | palettes cosine comme MOTEUR de dégradés animés ; warp léger en WebGL2 | le raymarching plein écran (coût iGPU) |
| **Spotify Canvas / Apple Music** | boucles courtes, direction artistique serrée | la retenue premium grand public | conforte : moins d'éléments, mieux éclairés | la passivité (aucune réactivité) |

### Tendances transversales 2025-2026 utiles ici

- **Le noir est premium** : les rendus haut de gamme sont sombres, avec 1-2
  sources de lumière franches. PULSAR l'a déjà en règle (§3.6 live). À étendre
  au mode fichier comme contrainte de palette, pas comme hasard.
- **Grain + tonemap partout** : le « digital propre » fait amateur ; grain
  animé subtil + courbe filmique unifient l'image. Le live a le grain, le mode
  fichier WebGL2 a le tonemap — il manque grain/vignette unifiés côté fichier.
- **Typographie cinétique** : lyrics/titres énormes, coupés au beat (`type-slam`
  l'a en live ; le fichier n'a que le texte statique animé).
- **La caméra fait le cinéma** : dolly lent permanent + coupes franches
  quantifiées — pas de zoom élastique continu. ADR-011 va dans ce sens ;
  il manque les COUPES (changement de variante à la frontière) en fichier.
- **Anti-tendance à éviter** : l'accumulation (glitch + glow + particules +
  chromatic en permanence). La dramaturgie codée de PULSAR est précisément
  l'antidote — c'est un argument produit, pas juste une règle interne.

---

## D. VISUALIZERS EXISTANTS — verdicts

### Mode fichier (8 styles)

| Style | Verdict | Justification et amélioration ciblée |
|---|---|---|
| `pulse` | **KEEP+** | Identité claire (défaut fiable). Amélioration : consommer la mémoire visuelle (E1) pour que les anneaux laissent des cicatrices brèves ; rien d'autre. |
| `field` | **IMPROVE** | Le plus « démo » mais 2 500 particules plafonnées CPU. Sur WebGL2 : ×4-10 par instancing (déjà dans le renderer), tailles variées, profondeur par parallaxe 2-3 plans. Identité conservée. |
| `spectrum-pro` | **KEEP** | Fait exactement ce qu'il promet, bien. Seul ajout : éclairage des barres par la teinte harmonique (F6), coût nul. |
| `monolith` | **IMPROVE** | Le parti pris (masse+silence) est excellent pour trap/drill. Lui donner la lumière volumétrique simulée (E3-lite : rais additifs pré-rendus) pour passer de « sobre » à « monumental ». |
| `iso-pulse` | **KEEP** | Régularité house/techno bien tenue par les ondes + duotone. |
| `chambre` | **KEEP** | Lofi juste ; la texture est le propos. Bénéficiera du grain unifié fichier sans modification propre. |
| `eclats` | **IMPROVE** | Bonne idée (syncope + rémanence) ; l'amener au `FeedbackWarp` (C) pour que la dislocation TOURNE/dérive au lieu de seulement traîner. |
| `aurore` | **KEEP** | Preuve vivante de la Loi 3 (beau sans onsets). Ne pas y toucher. |

Aucun REMOVE : le catalogue est petit et chaque style a une identité réelle.
C'est rare et ça se protège.

### Mode live (8 scènes)

| Scène | Verdict | Note |
|---|---|---|
| `grid-horizon` | KEEP | lisibilité du tempo exemplaire (une cellule par temps) |
| `curl-flow` | KEEP+ | déjà le meilleur candidat « organique » ; hériter du FeedbackWarp |
| `slice-displace` | IMPROVE | dépend de la scène précédente (écart n°7) — vérifier à l'oreille en enchaînement réel, sinon augmenter sa matière propre |
| `laser-tunnel` | IMPROVE | la plus sombre des six (0,009) : à rééquilibrer À L'ŒIL, pas au code d'abord |
| `mandala-32` | KEEP | riche, cinq paramètres/cinq sources, conforme §6 |
| `type-slam` | KEEP | l'idée à PORTER en mode fichier (E4) |
| `note-helix` | KEEP+ | unique au monde (mélodie exacte en live) ; à mettre en avant produit |
| `witness` | KEEP | scène d'attente, rôle utilitaire |

---

## E. NOUVEAUX VISUALIZERS — 5 concepts maximum, pas 30

Chacun respecte les 5 Lois (fonction pure de `t`, StepContext seul, coordonnées
normalisées, confidence, FlashLimiter) et consomme les systèmes de F/G/H.

**E1. `sillage` — la mémoire faite style** *(organic / energy-based)*
Le monde est une surface sombre ; chaque événement y grave une empreinte qui
décline sur 2 à 8 mesures : cratères de kick (creux lumineux), cicatrices de
snare (entaille oblique), poussière de hats. Le morceau LABOURE la surface ;
un break laisse voir tout ce qui s'est accumulé, le drop efface tout (reset
narratif). Techniquement : buffer de traces à décroissance par `dt`,
reconstructible après seek par relecture des événements de la fenêtre
(`needsDrawPriming`). Genres : trap, drill, boom bap.

**E2. `marée` — pseudo-fluide curl** *(fluid / atmospheric)*
Champ de vitesses = curl noise (déjà écrit dans `util/noise.ts` — dette
remboursée : le portage fichier est petit) + advection de 2-3 encres colorées
aux rôles de palette. Le 808 déforme le potentiel (vagues lentes), le kick
injecte de l'encre accent, les sections changent la viscosité apparente.
Aucune simulation de fluide réelle : incompressible par construction, coût
maîtrisé. Genres : R&B, afro, house mélodique.

**E3. `phare` — lumière comme matière** *(cinematic / architectural)*
2-4 faisceaux volumétriques simulés (cônes en dégradé additif pré-rendu +
occlusion fausse par masques), fumée par fbm lent, poussière dans les rais.
Les faisceaux se braquent sur la grille (positions quantifiées à la mesure),
s'ouvrent sur les accords majeurs, se resserrent sur les mineurs (F6). C'est
le style « scène de concert » que le catalogue n'a pas. Genres : drill,
techno, hyperpop.

**E4. `verbe` — typographie cinétique fichier** *(minimal / brutal)*
Portage du savoir-faire `type-slam` vers le mode fichier : titre/artiste/mots
choisis, énormes, coupés au beat, révélés par le snare, séparés RVB sur
l'accent — avec ce que le live ne peut pas faire : le placement PLANIFIÉ sur
la structure entière (le mot n'apparaît qu'au drop, jamais au hasard).
Genres : tous — c'est le style « lyric video premium ».

**E5. `constellation` — la mélodie dessinée** *(spatial / procedural)*
Généralisation fichier de `note-helix` : les notes deviennent des astres
placés par hauteur (verticale) et temps (orbite), reliés par les accords
(constellations dont la géométrie suit la qualité maj/min/7e), teinte par
cercle des quintes. Entre deux notes, rien ne bouge — c'est la mélodie qui
crée la matière. Nécessite le PMDI Mode B/C avec notes. Genres : R&B, lofi,
mélodique. **Différenciateur absolu** : personne ne peut le faire sans la
vérité MIDI.

---

## F. AUDIO-VISUAL ENGINE — ce qui manque au pipeline

Le pipeline demandé par le brief (AUDIO → ANALYSIS → FEATURES → EVENTS →
VISUAL STATE → BEHAVIOR → RENDERING) **existe déjà** — c'est exactement
analysis → PMDI → StepContext → BehaviourEngine → Scene → Renderer. Les
étages réellement manquants :

1. **Mémoire visuelle** (`TraceField`) : un module transverse, par scène,
   où les événements déposent des empreintes typées (position, intensité,
   âge) à décroissance en mesures. Pur : reconstruit après seek en relisant
   `timeline.eventsInWindow(t - horizon, t)`. Toutes les couches peuvent le
   lire (les anneaux de `pulse` s'ancrent sur les cratères récents, etc.).
2. **Physique commune** (`core/motion/`) : ressorts critiques amortis,
   inertie, répulsion — en fonctions pures de `(t, événements passés)`,
   à la manière du VisualDirector sans état. Un vocabulaire, pas un moteur :
   les couches l'appellent au lieu de recoder leurs easings.
3. **Mise en scène par section** : étendre `VisualDirector` pour produire,
   en plus du budget, une **partition de plans** dérivée de la structure :
   variante de cadrage par section (A→variante 1, B→variante 2, répétition
   A→variante 1 ramenée — la mémoire de mise en scène), coupes de caméra sur
   les frontières, motif de couche alterné. Déterministe, relu depuis la
   timeline, zéro état.

---

## G. VISUAL DNA — recommandation précise

Objectif : deux morceaux différents → deux expériences différentes, SANS
random incohérent. Tout existe pour le faire proprement :

```
ENTRÉES (déjà calculées)                 SORTIES (déjà paramétrables)
BPM, énergie moyenne/variance      →     choix de variante de cadrage
profil spectral (sub/centroid)     →     8 macros (density, movement, …)
densité d'onsets                   →     palette + drift + hueModulation
structure (nb sections, lettres)   →     partition de plans (F3)
centre tonal + mode maj/min        →     teinte de base + température
graine = hash(PMDI)                →     micro-variations par style
```

Concrètement : un module `presets/visualDna.ts` qui, à la résolution du
preset, DÉRIVE les macros et la variante depuis le document PMDI au lieu de
prendre les valeurs fixes du JSON — le JSON du genre devient un PRIOR, le
morceau le module (±20 % bornés, jamais plus : le genre reste reconnaissable).
La graine dérivée du hash du PMDI (pas d'horloge) garantit : même morceau →
même monde, morceau différent → monde différent. C'est le chantier au
meilleur rapport impact/effort de tout ce rapport : ~zéro rendu nouveau,
uniquement de la dérivation de paramètres existants.

---

## H. COLOR / MOTION / VARIATION

**Couleur** — le socle OKLCH + rôles + harmonie est déjà le bon système. Trois
extensions, dans l'ordre :
1. **Palettes cosine comme générateur de dégradés** (fond animé continu au
   lieu de 2 arrêts fixes) — coût quasi nul, gain visible sur tous les fonds.
2. **Directions nommées** (DARK/CINEMATIC/NEON/PASTEL/…) : ce sont des
   contraintes sur (contraste, chroma max, luminance de fond), pas de
   nouvelles palettes — un axe orthogonal au genre, exposé comme un macro.
3. La température par énergie et l'harmonie existent : les brancher sur les
   styles qui ne les lisent pas encore (audit rapide par style).

**Motion** — règle unique à écrire dans docs/07 : *tout mouvement est soit
quantifié à la grille, soit un ressort vers une cible, soit un drift < 0,02
unité/s ; jamais de lerp linéaire visible.* Puis appliquer via `core/motion/`.

**Variation** — hiérarchie stricte : structure du morceau (sections) >
événements rares déterministes (« toutes les 16 mesures sans DROP, un
événement de respiration », tiré de la graine) > LFO lents > jamais de
random par frame. La règle des presets (« rotation de teinte par horloge =
signature de l'amateurisme ») se généralise : **aucune variation qui ne soit
pas racontable musicalement.**

---

## I. PERFORMANCE — coûts et compromis

| Technique | Qualité | Perf iGPU | Complexité | Verdict |
|---|---|---|---|---|
| Instancing sprites WebGL2 (10-25k particules) | 8 | 9 | 3 (déjà dans le renderer) | **ADOPTER** (fichier) |
| FeedbackWarp paramétrique | 8 | 9 | 3 | **ADOPTER** (les 2 modes) |
| Curl noise advection | 8 | 8 | 4 | **ADOPTER** (E2) |
| Grain + vignette + LUT tonemap unifiés fichier | 7 | 9 | 3 | **ADOPTER** |
| Palettes cosine | 7 | 10 | 2 | **ADOPTER** |
| Dual-Kawase bloom (remplacement du bloom GPU actuel) | 6 | 8 | 5 | plus tard — le bloom actuel suffit, mesurer d'abord |
| GPU particles transform feedback (100k+) | 9 | 7 | 7 | plus tard — utile seulement si un style le RÉCLAME |
| SDF/raymarching plein écran | 9 | 3-5 | 8 | **ÉVITER** (iGPU + 2 backends à maintenir) |
| Stable fluids GPU | 9 | 4-6 | 9 | **ÉVITER** — curl noise donne 80 % pour 20 % du coût |
| WebGPU | — | — | 9 | **ATTENDRE** (Safari/parité ; re-décider quand un besoin le justifie) |
| OffscreenCanvas + Worker rendu | 6 | 7 | 8 | plus tard — aucun symptôme actuel ne le réclame |

Règles inchangées : budget 16 ms/1080p, pas de nouvelle techno sans mesure
préalable (ADR-014 est le précédent de méthode), le live reste Canvas2D.

---

## J. ROADMAP

Un chantier = un lot livré = une validation d'Aaron, comme toujours.

**P0 — le socle qui profite à tout (2 chantiers)**
1. `TraceField` (mémoire visuelle, F1) + branchement minimal sur `pulse` et
   `field` pour la preuve à l'œil.
2. Visual DNA (G) : dérivation bornée des macros/variante/graine depuis le
   PMDI. Livrable : le même preset sur 3 morceaux → 3 rendus distincts,
   captures à l'appui.

**P1 — la durée (2 chantiers)**
3. Mise en scène par section (F3) : partition de plans, coupes quantifiées,
   mémoire de mise en scène A/B/A.
4. FeedbackWarp paramétrique + grain/vignette unifiés fichier (H) ;
   `eclats` et `field` en premiers bénéficiaires.

**P2 — le catalogue (3 chantiers, un style à la fois)**
5. E4 `verbe` (typo cinétique fichier — réutilise `type-slam`).
6. E1 `sillage` (consomme TraceField).
7. E3 `phare` OU E2 `marée` — au choix d'Aaron après les deux premiers.

**P3 — l'exclusif (2 chantiers)**
8. E5 `constellation` (notes/accords, Mode B/C).
9. `field` WebGL2 ×10 particules (I) + directions de couleur nommées (H2).

À chaque étape : flag par défaut compatible, sortie byte-identique flag éteint
(discipline déjà en vigueur côté Beat Studio), mesure de perf collée.

## K. DIFFÉRENCIATION

La question « qu'est-ce qui rend PULSAR impossible à confondre ? » a une
réponse en une phrase : **c'est le seul visualizer où le visuel SAIT — les
autres écoutent.** Trois manifestations à rendre visibles et à revendiquer :

1. **La vérité** : kick/snare/808/notes/accords exacts (PMDI), zéro fausse
   détection, réactivité à l'échantillon près — et en fichier, la
   **connaissance du futur** (l'anticipation avant le drop est réelle, pas
   extrapolée). Aucun produit temps réel ne peut l'imiter.
2. **La mémoire** : un monde qui porte les traces de ce qui s'est joué
   (E1/F1) — à l'opposé des effets sans passé de toute la concurrence.
3. **La retenue codée** : la dramaturgie chiffrée (plancher de vide, retenue
   avant impact, retombée post-drop) est un goût de réalisateur transformé en
   invariant testé. C'est ce que les références pro font à la main ; PULSAR
   le fait par construction.

## L. TOP 10 FINAL (ordre d'implémentation)

1. **Visual DNA** (G) — impact maximal, risque minimal, tout existe.
2. **TraceField / mémoire visuelle** (F1) — le monde gagne un passé.
3. **Mise en scène par section** (F3) — la minute 3 cesse de ressembler à la minute 1.
4. **FeedbackWarp paramétrique** — richesse gratuite pour eclats/field/curl-flow.
5. **Grain + tonemap unifiés fichier** — le « liant » premium de l'image.
6. **Style `verbe`** (E4) — la lyric video que le marché attend.
7. **Style `sillage`** (E1) — première vitrine de la mémoire.
8. **Palettes cosine + directions nommées** (H) — profondeur colorée.
9. **Style `phare` ou `marée`** (E3/E2) — le style de démo spectaculaire.
10. **`constellation` + particules WebGL2 ×10** (E5/I) — l'exclusif et le muscle.

---

## RÉPONSE À LA QUESTION FINALE — les 4 innovations « WOW »

**1. Visual DNA — le morceau paramètre le monde** *(P0, difficulté 2/5)*
Pourquoi d'abord : c'est la réponse directe au reproche « générique », elle
multiplie la valeur perçue de TOUS les styles existants sans en toucher un
seul, et l'infrastructure (macros, variantes, graine, suggest.ts) est déjà là.
Impact : chaque beat d'Aaron obtient SON visualizer. Différenciation : forte —
les concurrents ont des presets, pas une dérivation par morceau.

**2. La mémoire visuelle — les événements laissent des traces** *(P0-P2, 3/5)*
Pourquoi : c'est la rupture conceptuelle « la musique crée le monde » à l'état
pur — un kick qui marque la matière au lieu de faire clignoter un calque. Peu
coûteux (un buffer de traces + relecture d'événements), compatible Loi 1, et
visuellement inédit dans cette catégorie de produit. Impact démo immédiat sur
un break : on VOIT l'histoire du morceau.

**3. La mise en scène par section — le morceau écrit son storyboard** *(P1, 3/5)*
Pourquoi : le mode fichier connaît le futur — avantage structurel unique sur
tout outil temps réel — et ne l'exploite aujourd'hui que pour l'intensité.
Variantes par section, coupes quantifiées, retour de la variante quand la
section revient : c'est ce qui fait passer une vidéo de « screensaver réactif »
à « clip réalisé ». Les VJ pro le font à la main ; PULSAR peut le faire seul.

**4. `constellation` — la mélodie visible** *(P3, 4/5)*
Pourquoi : c'est l'innovation que PERSONNE ne peut copier sans le lien
séquenceur→visualizer. Notes et accords exacts dessinés dans l'espace, teintés
par l'harmonie réelle — le pont Beat Studio (lot 2 ADR-015) l'alimente déjà.
À garder pour la fin : sa valeur explose quand les trois systèmes précédents
existent (elle en hérite gratuitement).

*(La 5e candidate — particules GPU massives — est volontairement reléguée :
spectaculaire mais copiable en un week-end par n'importe qui. Les quatre
ci-dessus sont des SYSTÈMES, pas des effets.)*
