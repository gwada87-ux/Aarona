# 07 — MOTEUR VISUEL

## Les deux étages, et pourquoi ils sont séparés

```
BehaviourEngine   musique  →  signaux abstraits (0..1, sans unité)
SceneEngine       signaux  →  géométrie, couleur, mouvement
```

Une couche visuelle **ne doit pas savoir ce qu'est un kick**. Elle sait qu'un signal nommé `impact`
vaut 0,84. Cette séparation a trois conséquences directes :

1. **Le Mode B se branche sans rien changer** — les signaux sont identiques, plus précis.
2. **Une couche est testable sans audio** — on injecte des signaux synthétiques.
3. **Un preset peut recâbler la musique** sans toucher au code visuel : en R&B, `impact` sera nourri
   par le snare plutôt que par le kick, et la même scène change de caractère.

---

## BehaviourEngine

### Les quatre familles de signaux

| Famille | Comportement | Alimenté par |
|---|---|---|
| **Impulse** | saut instantané, décroissance exponentielle | événements ponctuels |
| **Envelope** | attaque + maintien + relâchement, avec durée | événements à durée (`BUILDUP`, `BREAK`) |
| **Continuous** | suivi lissé d'une courbe | `FeatureTracks` |
| **Trend** | pente sur une fenêtre glissante | dérivée des courbes |
| **Anticipation** | montée vers un événement futur | `timeToNext()` |

### Impulse — la brique la plus importante

```ts
class Impulse {
  private v = 0;
  constructor(private decay: number) {}          // temps de demi-vie, en secondes

  fire(amount: number) { this.v = Math.max(this.v, amount); }   // max, pas +=
  update(dt: number)   { this.v *= Math.exp(-dt * Math.LN2 / this.decay); }
  get value() { return this.v; }
}
```

Deux détails qui comptent plus qu'il n'y paraît :

- **`max` et non `+=`.** Deux kicks rapprochés ne doivent pas produire une valeur de 1,7 puis un
  écrêtage brutal. Ils doivent relancer l'impulsion.
- **Décroissance exponentielle par `dt`**, jamais par frame. C'est ce qui rend l'impulsion identique
  à 30, 60 ou 144 fps — et donc à l'export.

**Écart d'implémentation (Étape 8/P6) :** une méthode `reset(): void` (qui ramène `v` à 0) a été
ajoutée, absente du code ci-dessus. Requise par `BehaviourEngine.reset(t)` (docs/02 §Seek) : le
repos naturel d'une impulsion hors déclenchement est déjà 0, donc `reset()` EST son équilibre — pas
une approximation.

Temps de décroissance par défaut :

```
impact      0,12 s     kick — sec, percussif
subImpact   0,45 s     808 — long, ça continue de vibrer
accent      0,18 s     snare / clap
tick        0,06 s     hat — très court, presque un scintillement
sectionShift 1,20 s    changement de section — respire longtemps
```

### Continuous — lissage asymétrique

```ts
class Continuous {
  private v = 0;
  constructor(private riseTau: number, private fallTau: number) {}
  update(target: number, dt: number) {
    const tau = target > this.v ? this.riseTau : this.fallTau;
    this.v += (target - this.v) * (1 - Math.exp(-dt / tau));
  }
}
```

L'asymétrie (montée rapide, descente lente) imite le comportement d'un VU-mètre et, surtout, la
perception humaine de l'énergie. Un signal symétrique paraît mou à la montée et nerveux à la descente.

**Écart d'implémentation (Étape 8/P6) :** une méthode `reset(target: number): void` (`v = target`)
a été ajoutée. Contrairement à `Impulse`, l'équilibre naturel d'un `Continuous` n'est PAS 0
(docs/02 §Seek : « repartent à leur valeur d'équilibre... pas à zéro ») — `reset()` doit donc sauter
directement à la valeur cible au nouveau `t`, sans quoi une fenêtre de rattrapage courte (scrub,
0,15 s) n'aurait pas le temps de la rejoindre via `riseTau`/`fallTau` avant le premier rendu.

### Table de câblage (mapping)

Le lien musique → signal est **une donnée, pas du code**. C'est ce qui rend les presets puissants.

```json
{
  "impact":     { "from": ["KICK"],            "gain": 1.0,  "decay": 0.12 },
  "subImpact":  { "from": ["SUB_HIT"],         "gain": 0.9,  "decay": 0.45 },
  "accent":     { "from": ["SNARE", "CLAP"],   "gain": 0.85, "decay": 0.18 },
  "tick":       { "from": ["HAT", "PERC"],     "gain": 0.4,  "decay": 0.06 },
  "drive":      { "from": "feature:energy",    "rise": 0.08, "fall": 0.55 },
  "weight":     { "from": "feature:band.sub",  "rise": 0.05, "fall": 0.30 },
  "brightness": { "from": "feature:centroid",  "rise": 0.20, "fall": 0.40 },
  "tension":    { "from": "anticipate:DROP",   "window": 4.0, "curve": "easeInQuad" }
}
```

Le preset R&B remplacera simplement `"impact": { "from": ["SNARE"] }`. Zéro ligne de code.

**Complété à l'Étape 8/P6** (`src/behaviour/mapping/defaults.ts`) : `sectionShift` (famille Impulse,
`from: ["SECTION"]`, `decay: 1.2` — valeur déjà donnée dans le tableau de décroissance ci-dessus,
absente de l'exemple JSON). `pulse`/`barPulse` ne passent PAS par cette table : ce sont des
fonctions directes de `StepContext.beat.phase`/`bar.phase`, calculées inconditionnellement par
`BehaviourEngine`. `density`, `release`, `chaos` (docs/03 `VisualSignals`) restent différés, faute
de formule ou de durée spécifiée — voir docs/JOURNAL.md, Étape 8.

---

## SceneEngine

### Scène = liste ordonnée de couches

```ts
interface Scene {
  readonly layers: readonly Layer[];         // ordre de dessin, du fond vers l'avant
  update(f: StepContext, s: VisualSignals): void;
  draw(r: Renderer, vp: Viewport): void;
  reset(t: number): void;
}
```

### Familles de couches

| Famille | Rôle | Coût |
|---|---|---|
| `Background` | fond, dégradés, vignettage, grain | faible |
| `Field` | grilles, lignes de fuite, tunnels | moyen |
| `Waveform` | forme d'onde (locale ou globale) | faible |
| `Spectrum` | représentation spectrale retravaillée | moyen |
| `Particles` | systèmes de particules | **élevé** |
| `Geometry` | formes primaires réactives | faible |
| `Glow` | halos additifs par sprite pré-rendu | moyen |
| `Text` | titre, artiste, horodatage | faible |
| `Overlay` | cadre, lettrage, éléments fixes | faible |
| `PostFx` | feedback, décalage chromatique, tremblement | moyen à élevé |

**Implémenté à l'Étape 9/P7** (`src/visual/scene/`, `src/visual/layers/`) : `Scene` exactement comme
ci-dessus, plus `init(ctx)` (docs/02 §4, absent de ce croquis). Seules les familles `Background`,
`Geometry`, `Waveform`, `Glow`, `PostFx` existent — celles que `Pulse` requiert ; `Field`,
`Spectrum`, `Particles`, `Text`, `Overlay` attendent leur premier style consommateur (P9, P12).
`LayerRegistry`/`Composer` (nommés dans `docs/16_STRUCTURE_ET_RISQUES.md`) ne sont PAS construits :
aucun consommateur avant que les presets (P11) assemblent des couches par nom depuis du JSON — les
styles sont pour l'instant assemblés directement en code (`styles/pulse/createPulseStyle.ts`).

### Contrat d'une couche

```ts
interface Layer {
  readonly id: string;
  readonly kind: LayerKind;
  readonly needsDrawPriming: boolean;   // true si l'état dépend d'images DESSINÉES
  params: LayerParams;                                  // sérialisable, animable

  init(ctx: LayerInitContext): void;                    // création des sprites, allocation
  update(s: StepContext, sig: VisualSignals): void;     // état uniquement, aucun dessin
  draw(r: Renderer, vp: Viewport): void;                // dessin uniquement, aucun calcul
  reset(t: number): void;                               // retour à un état cohérent pour t
  dispose(): void;
}
```

`needsDrawPriming = true` concerne les couches à **état de framebuffer** : le feedback du style
`Field` (qui redessine l'image précédente) et tout post-traitement à rétention. Leur état ne peut pas
être reconstruit par `update()` seul après un seek — il faut des `draw()` réels, effectués à
résolution réduite pendant le rattrapage. Sans cette distinction, le test golden est
mathématiquement impossible à passer.

La séparation `update` / `draw` est **obligatoire** : lors d'un rattrapage après seek, `update` est
appelé 60 fois pour un seul `draw`. Une couche qui dessine dans `update` produira 60 images
superposées.

---

## Viewport : composition indépendante du ratio

Aucune coordonnée en pixels dans une couche. Jamais.

**Toutes** les valeurs passées au `Renderer` sont en unités normalisées. La conversion en pixels est
interne au `Canvas2DRenderer` et n'est jamais exposée.

```
Espace de coordonnées du Renderer :
   origine     centre du canvas
   1,0         = plus petite dimension du viewport
   y           vers le haut
   x ∈ [−aspect/2, +aspect/2]  en paysage,  y ∈ [−1/(2·aspect), …] en portrait
```

```ts
interface Viewport {
  readonly aspect: number;                                        // w / h
  readonly safe: { x: number; y: number; w: number; h: number };   // unités normalisées
  // PAS de w, h, ni u : ce sont des pixels, ils appartiennent au Renderer.
}
```

Une couche écrit `r.fillCircle(0, 0, 0.3)` : un cercle occupant 60 % du petit côté, correct en 16:9,
9:16 et 1:1 sans une seule condition.

Exposer une unité en pixels (`vp.u`) conduirait immanquablement à mélanger les deux systèmes dans le
même appel — `fillCircle(0, 0, 0.3 * vp.u)` a une position normalisée et un rayon en pixels — puis à
trois conventions différentes dans trois styles, et enfin à un portage WebGL2 impossible.

**Safe area.** En 9:16, la zone utile centrale est réduite (les plateformes superposent leur UI en
haut et en bas). Chaque couche déclare son mode de recadrage :

```
"cover"    remplit tout, déborde       → fonds, particules
"contain"  reste dans la safe area     → texte, formes principales
"stretch"  suit le ratio               → grilles, lignes d'horizon
```

C'est cette abstraction qui évite d'avoir à refaire chaque style pour chaque format.

---

## Techniques Canvas 2D indispensables

Le brief impose Canvas 2D. Il tient largement le cahier des charges — **à condition** d'éviter trois
pièges qui font conclure à tort à une limite de l'API.

### 1. Le glow : jamais `shadowBlur`

```
❌  ctx.shadowBlur = 30 ; ctx.arc(...) ; ctx.fill()
    → flou CPU recalculé à chaque primitive. 2 000 particules = 8 fps.

✅  sprite = radial-gradient rendu UNE FOIS dans un OffscreenCanvas 128×128
    ctx.globalCompositeOperation = 'lighter'
    ctx.drawImage(sprite, x, y, s, s)
    → une copie de texture accélérée. 3 000 particules = 60 fps.
```

Le rendu est **indiscernable** d'un bloom additif. C'est la technique standard, et elle rend le
choix Canvas 2D parfaitement défendable.

### 2. Le bloom d'ensemble : chaîne de sous-échantillonnage

```
1. rendu de la scène dans un canvas hors écran, taille pleine
2. extraction des hautes lumières → canvas à 1/4 de résolution
3. deux passes de flou séparable (horizontal puis vertical) à 1/4
4. remontée en additif sur la scène
```

À 1/4 de résolution, le coût est divisé par 16 et le flou est de toute façon invisible en détail.
Budget mesuré : ≈ 2,5 ms en 1080p.

**Implémenté à l'Étape 21** (`src/render/Renderer.ts` — `BloomConfig`/`setBloomConfig()`,
`src/render/canvas2d/Canvas2DRenderer.ts::applyBloom()`, `src/render/canvas2d/bloomMath.ts` pour la
partie testable en Node). Sur l'image COMPOSITE finale de la frame (dans `endFrame()`, jamais par
couche individuelle), pas sur un canvas hors écran séparé dès l'étape 1 : le rendu direct existant
sert déjà de source pour l'étape 2, un canvas hors écran supplémentaire pour l'étape 1 n'aurait rien
apporté. Deux écarts assumés et documentés dans le code : (1) `ctx.filter = 'blur()'` natif plutôt
que « deux passes de flou séparable » écrites à la main — supporté par toute la matrice navigateurs
de docs/11, même résultat visuel, bien plus simple ; `passes` (docs/10) élargit le RAYON du flou
plutôt que de répéter une vraie convolution. (2) Seuil des hautes lumières sur `max(r,g,b)`, pas une
luma perceptuelle — une particule d'une seule couleur saturée doit être détectée comme un point
chaud. `getImageData`/`putImageData` uniquement sur le petit buffer réduit, jamais l'image pleine
résolution — même principe que `FlashLimiter` (32×18). Câblé sur le niveau de qualité courant
(`ui/App.ts`) et figé à HIGH pendant tout export (`ExportPipeline.ts::runExport()`, indépendamment
de l'appelant). Coût réel en millisecondes non mesuré (pas de `<canvas>` en Node) — à confirmer par
Aaron au navigateur ; vérifié visuellement : halo net et attendu autour des particules/anneaux en
HIGH/ULTRA, absent en LOW, aucune erreur sur 3 styles × 4 niveaux de qualité.

### 3. Les particules : atlas et tableau typé

```
❌  particles.forEach(p => { ctx.beginPath(); ctx.arc(...); ctx.fill(); })
✅  état dans des Float32Array parallèles (x, y, vx, vy, life, size, tint)
    dessin par r.drawSprite(handle, transforms)  → une seule traversée, zéro allocation
```

Aucune allocation dans la boucle de rendu. Pool fixe, particules mortes recyclées par index libre.
Un `GC` en pleine frame coûte 8 à 30 ms — c'est la première cause de saccade sur ce type d'app.

### Autres règles

- `ctx.save()` / `restore()` sont coûteux : les éviter dans les boucles serrées, gérer les
  transformations à la main.
- Arrondir les coordonnées de `drawImage` quand la précision sous-pixel n'apporte rien.
- `willReadFrequently: false` sur le contexte principal.
- Un seul `clearRect` par frame, ou un `fillRect` opaque (souvent plus rapide).

### Critère chiffré de bascule vers WebGL2 (ADR-002)

> Si, après optimisation, la scène de référence (`Field` en qualité HIGH, 2 500 particules, bloom
> actif) ne tient pas **60 fps p95 en 1080p** sur la machine de référence, alors et seulement alors
> on implémente `WebGL2Renderer` derrière l'interface `Renderer` existante.

Estimation honnête : le seuil sera franchi vers 4 000 à 6 000 particules avec bloom. Le MVP est
dimensionné en dessous. WebGL2 est donc un **sujet de V2**, pas un renoncement.

---

## Les trois styles du MVP

Chaque style a une identité propre : formes, mouvement, rapport aux fréquences, comportement
rythmique. Ce ne sont pas trois palettes du même moteur.

### 1. `Pulse` — géométrie réactive

> Formes primaires concentriques. Sobre, percussif, lisible. Le style « par défaut » qui ne trahit
> jamais un morceau.

```
Background   dégradé radial sombre, teinte pilotée par brightness
Geometry     anneau central : rayon = 0.28 + 0.10·impact      (unités normalisées)
                              épaisseur = f(weight)
             anneaux secondaires émis sur DOWNBEAT, expansion + fondu (1,2 s)
Waveform     forme d'onde circulaire déformée par le spectre, ± 0.04
Glow         halo central, intensité = drive, teinte = brightness
PostFx       tremblement d'écran sur impact > 0,7, amplitude ≤ 0.012, décroissance 0,15 s
```

Rapport aux fréquences : le rayon suit le grave, l'épaisseur le corps, la déformation les aigus.
Sur un break, tout se contracte et le halo respire.

**Implémenté à l'Étape 9/P7** (`src/visual/layers/`, `src/visual/styles/pulse/`) — constantes non
précisées ci-dessus, choisies et documentées dans le code plutôt que dans ce fichier :
- `épaisseur = f(weight)` : linéaire, `0,006 + 0,014·weight`.
- Anneaux secondaires : pool fixe de 8 (zéro allocation), rayon final ≈ `0,28 + 0,32·progress`.
- « déformée par le spectre » : `visual/` ne voit jamais de spectre plein (Loi 2) — utilise les 6
  `step.bands` de `StepContext` (P5/P6), interpolés entre secteurs adjacents.
- Glow « teinte pilotée par brightness » sans re-rendre le sprite par image (interdit,
  `shadowBlur`-like) : deux sprites pré-rendus (`palette.temperature(0)`/`(1)`) fondus
  additivement avec des poids `1-brightness`/`brightness`.
- PostFx doit être dessinée EN PREMIER, pas en dernier : voir `render/Renderer.ts` (`applyShake`).
  Le tableau ci-dessus décrit des responsabilités, pas un ordre d'exécution.

**Étendu à l'Étape 20** (macros densité/glow/chaos/douceur, docs/08_PRESETS.md) : `PulseRings`
expose `params.maxActiveRings` (densité, plafonne le pool de 8), `params.lifetimeSec` (mouvement,
vitesse d'expansion), `params.chaosJitter` (chaos, léger décalage de rayon tiré une fois par
anneau) ; `CentralGlow` expose `params.intensityMul`/`params.diameter` (glow) ; `ScreenShake`
expose `params.decaySec` (douceur — sa décroissance est désormais recopiée à la main plutôt que
déléguée à `Impulse`, dont le `decay` est fixé au constructeur, incompatible avec un macro
modifiable en cours de lecture). `depth` (Profondeur) n'a AUCUNE entrée pour ce style — délibérément
plat/2D, voir `presets/layerMacros.ts`.

### 2. `Field` — champ de particules

> Espace profond, mouvement continu, réaction en gerbes. Le style « impressionnant ».

```
Background   noir profond, vignettage
Field        grille en perspective, avancée pilotée par pulse (phase continue, jamais un saut)
Particles    2 500 particules, pool fixe
               forces : dérive constante + attraction centrale modulée par weight
               sur KICK   → impulsion radiale, 120 particules, vitesse ∝ intensity
               sur HAT    → 20 particules fines, courte durée de vie
               sur SNARE  → onde de choc annulaire
Glow         additif par sprite, taille ∝ vitesse de la particule
PostFx       feedback léger (canvas précédent redessiné à 0,88 d'alpha, mis à l'échelle 1,004)
                → traînées naturelles, aucun coût de simulation
```

Sur un `BUILDUP` : les particules convergent vers le centre et la vitesse monte. Sur le `DROP` :
explosion radiale. Cette anticipation est ce qui fait la valeur du style.

**Implémenté à l'Étape 11/P9** (`src/visual/layers/{background,field,particles,postfx}/`,
`src/visual/styles/field/`) :
- Pas de couche `Glow` séparée : `ParticleField` dessine déjà chaque particule en sprite additif
  dont la taille dépend de sa vitesse — exactement ce que ferait une couche dédiée, sans un second
  passage sur 2500 sprites.
- Grille en perspective rendue comme des anneaux concentriques (`strokeCircle`), rayon en
  `maxRayon·perspective/(perspective+profondeur)` (perspective classique, rayon ∝ 1/profondeur).
  24 rangées, `perspective = 0,65` (valeurs de l'exemple « Trap Dark » de docs/08_PRESETS.md).
  « Piloté par pulse » : utilise `step.beat.index + step.beat.phase` directement, PAS
  `signals.pulse` (une sinusoïde qui oscillerait avant/arrière, incompatible avec « jamais un
  saut »).
- SNARE → 60 particules en anneau ; DROP → 400 particules, explosion pleine puissance (au-delà du
  simple KICK ×120) ; BUILDUP → fenêtre de convergence (attraction centrale renforcée, vitesse
  ×1,6) pendant sa durée (`MusicEvent.dur`), interrompue net par le DROP suivant.
- Feedback : `Renderer.drawFeedback`/`captureFeedback` (ajoutées à cette étape), pas le
  `pushLayer`/`popLayer` générique un temps envisagé — voir `render/Renderer.ts` et
  `docs/JOURNAL.md`, Étape 11.
- `SpriteTransform` (glow/particules) et `drawSprite` acceptent désormais un `count` — le pool de
  2500 particules pré-alloue son tableau de transformations une fois et le mute en place (zéro
  allocation par image, docs/10_PERFORMANCE.md).

**Étendu à l'Étape 20** (macros densité/mouvement/profondeur/glow/chaos/douceur, docs/08_PRESETS.md) :
`ParticleField` expose `params.spawnCountMul` (densité, multiplie les 4 comptes de spawn par
événement), `params.driftSpeed` (mouvement), `params.glowAlphaMul` (glow), `params.chaosMul`
(chaos — multiplie l'amplitude de tirages `step.rng` déjà existants au spawn, n'en ajoute aucun),
`params.drag` (douceur, amortissement de vitesse) ; `PerspectiveGrid` expose `params.rows`
(densité, 12 à 36 au lieu de 24 fixe) et `params.perspective` (profondeur, falloff plus ou moins
dramatique).

### 3. `Spectrum Pro` — le spectre, mais bien fait

> Le classique, exécuté avec le soin qu'on ne lui accorde jamais.

```
Background   dégradé bicolore, très légèrement animé
Spectrum     64 bandes en échelle logarithmique (et non linéaire — c'est là que 90 % des
             visualizers échouent : une échelle linéaire tasse tout le spectre musical
             dans le premier quart de l'écran)
               lissage par bande, montée rapide / descente lente
               réflexion inférieure atténuée à 0,25
               chapeaux de pics avec chute gravitaire
Waveform     ligne d'onde superposée, fine, alpha 0,4
Glow         halo par bande, intensité ∝ hauteur
Text         titre / artiste, typographie soignée, dans la safe area
```

Une échelle logarithmique, un lissage asymétrique, des chapeaux de pics et une vraie typographie
suffisent à faire passer un spectre d'« amateur » à « pro ». C'est un excellent rapport
qualité/effort, et c'est le style que la plupart des utilisateurs choisiront pour du R&B et du Lofi.

**Implémenté à l'Étape 11/P9** (`src/visual/layers/{background,spectrum,waveform}/`,
`src/visual/styles/spectrum-pro/`) — PÉRIMÈTRE RÉDUIT ET DOCUMENTÉ, décidé sans mandat d'Aaron
(coût d'erreur : corrigible en une étape dédiée si besoin) :
- **6 bandes RÉELLES, pas 64.** Le spectrogramme est explicitement jeté après l'analyse hors-ligne
  (docs/03_DATA_FLOW.md : « le spectrogramme est traité par blocs et libéré au fur et à mesure ») —
  aucune donnée plus fine que les 6 `step.bands` n'atteint `visual/`. Un vrai spectre log-scale à
  64 bandes exigerait de conserver une résolution spectrale plus fine en sortie d'analyse (P4),
  un chantier séparé et plus gros que celui-ci. Les largeurs de barres restent non uniformes
  (proportionnelles à `log(hauteHz/basseHz)` par bande, dupliquées depuis `analysis/bands.ts` —
  `visual/` ne peut pas l'importer) pour garder l'esprit « plus d'espace pour le grave ».
- Lissage par bande via `Continuous` (behaviour/signals, déjà existant) — une instance par bande,
  montée 0,05s / descente 0,35s.
- Chapeaux de pics à chute gravitaire : accélération constante, rattrapés (vitesse remise à 0)
  dès que la barre les dépasse à nouveau.
- Pas de couche `Glow` séparée, même raisonnement que `Field` : `SpectrumBars` dessine un halo
  additif par barre dans son propre `draw()`.
- `Text` (titre/artiste) non implémenté : `Renderer.drawText` reste différé (aucune couche `Text`
  avant P12).
- `Renderer.fillPath` ajouté à cette étape : ni `fillCircle` (rond) ni `strokePath` (contour) ne
  peuvent produire une barre rectangulaire pleine — voir `render/Renderer.ts`.
- Waveform « superposée » : comme `CircularWaveform` (Pulse), approximée depuis les 6 bandes
  (aucune forme d'onde réelle n'atteint `visual/`), dépliée horizontalement. `strokePath` accepte
  désormais un paramètre `closed` : `false` ici (ligne ouverte), `true` pour le cercle de Pulse.

**Étendu à l'Étape 20** (macros densité/mouvement/profondeur/glow/chaos/douceur, docs/08_PRESETS.md) :
`SpectrumBars` expose `params.gap` (densité, barres plus ou moins serrées), `params.riseTau`
(mouvement, attaque des barres), `params.fallTau` (douceur, retombée — délibérément SÉPARÉE de
`riseTau` pour que mouvement et douceur ne s'écrasent pas l'un l'autre), `params.reflectionAlpha`
(profondeur, repère de « sol »), `params.glowAlphaMul` (glow), `params.peakChaosJitter` (chaos —
petit à-coup de vitesse aléatoire, parfois un léger rebond, à la retombée d'un chapeau de pic).
Le lissage par bande n'utilise plus `Continuous` (behaviour/signals) : sa décroissance est recopiée
à la main, `Continuous.riseTau`/`fallTau` étant fixés au constructeur — même raison que `ScreenShake`
en Pulse.

---

## Palettes

Une palette n'est pas une liste de couleurs, c'est un **système** :

```ts
interface Palette {
  id: string;
  bg: [Color, Color];          // dégradé de fond
  primary: Color;              // élément principal
  secondary: Color;            // élément secondaire
  accent: Color;               // impacts, points chauds
  glow: Color;                 // teinte additive — souvent plus saturée que `primary`
  contrast: number;            // 0..1, pilote l'écart de luminance global
  temperature: (energy: number) => Color;   // interpolation pilotée par l'énergie
}
```

La fonction `temperature` est ce qui crée la cohérence dans la durée : un morceau dont l'énergie monte
voit sa palette dériver progressivement, sans changement brutal de couleur. Effet fort, coût nul.

---

## FlashLimiter — dernier étage, non contournable

```ts
class FlashLimiter {
  readonly needsDrawPriming = true;
  // Fenêtre d'historique exprimée en SECONDES DE TEMPS MUSICAL, jamais en nombre d'images :
  // sinon un export 30 fps et une preview 60 fps ne limitent pas la même chose.
  // Mesure de la luminance moyenne par sous-échantillonnage 32×18.
  // Si |L(t) − L(t_precedent)| > seuil ET que plus de N transitions ont eu lieu
  // dans la dernière seconde de temps musical, interpole vers L(t_precedent).
  apply(r: Renderer, reduced: boolean, t: number): void;
}
```

**Coût réel et déterminisme.** La mesure impose un `drawImage` du canvas vers un petit canvas puis un
`getImageData` — donc un **flush synchrone du pipeline 2D** à chaque image. Dans la boucle d'export,
serrée et sans `rAF`, ce blocage n'est recouvert par rien. Mesure retenue : **une image sur deux**,
avec interpolation de la luminance sur l'image intermédiaire. Le seuil étant exprimé en flashs par
seconde et non par image, cela ne change rien à la protection — mais la règle doit être écrite ici
pour rester déterministe entre preview et export.

| Mode | Seuil de delta | Flashs/s max |
|---|---|---|
| Normal | 0,45 | 3 |
| Réduction des flashs | 0,18 | 2 |

**Écarts d'implémentation (Étape 9/P7)** : la signature réelle est `apply(t: number)` — `reduced`
devient `setReducedFlashing(reduced)` (état, pas un paramètre répété à chaque appel), et `r:
Renderer` disparaît : `FlashLimiter` lit/écrit directement le `HTMLCanvasElement` (`getImageData`,
survoile de correction) — `Renderer` n'expose délibérément aucun accès aux pixels bruts, seul le
backend Canvas 2D le peut, comme documenté dans `render/Renderer.ts`. Le cœur pur (seuil + fenêtre
de fréquence, sans canvas) est isolé dans `FlashRateGate`, testé automatiquement ; le clampage
lui-même (survoile noir/blanc dont l'alpha vise `cible = actuelle·(1−a)` ou `actuelle·(1−a)+a`) est
une approximation qui déplace la luminance MOYENNE sans préserver le contraste local — acceptable
car elle ne s'engage que sur des transitions déjà extrêmes et rares. Un compteur public
`clampedCount` existe pour l'observation en développement (panneau de debug du harnais).

Le mode réduction est **activé par défaut sur les presets à forte énergie** (Trap Rage, Hyperpop,
Drill), avec un message clair. Ce n'est pas une contrainte imposée à l'utilisateur : c'est une
protection juridique sur un produit vendu, une conformité de plateforme, et un argument commercial
(« safe-for-platform »).

Le limiteur agit **après** le rendu et **avant** l'encodage : ce qui est exporté est protégé, pas
seulement ce qui est prévisualisé.
