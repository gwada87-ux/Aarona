# 08 — PRESETS ET PERSONNALISATION

## Un preset est un profil de comportement, pas un thème de couleurs

C'est la distinction qui décide de la qualité perçue du produit. Un preset définit :

```
1. le style visuel de base et sa configuration de couches
2. le CÂBLAGE musique → signaux              ← le plus important
3. la palette et sa dérive
4. la dynamique (attaques, décroissances, inerties)
5. les seuils de classification spécifiques au genre     ← invisible, décisif
6. les valeurs des macro-contrôles
7. les réglages de sécurité (réduction des flashs)
```

Les points 2 et 5 sont ce qui fait qu'un preset Drill *sonne* Drill visuellement, et pas simplement
« bleu foncé ».

---

## Structure

```jsonc
{
  "id": "trap-dark",
  "version": 1,
  "name": "Trap Dark",
  "genre": { "tempoHint": [60, 90], "doubleTimeHint": true },

  "style": "field",

  "mapping": {
    "impact":     { "from": ["KICK"],          "gain": 1.0,  "decay": 0.10 },
    "subImpact":  { "from": ["SUB_HIT"],       "gain": 1.0,  "decay": 0.55 },
    "accent":     { "from": ["SNARE","CLAP"],  "gain": 0.75, "decay": 0.16 },
    "tick":       { "from": ["HAT"],           "gain": 0.55, "decay": 0.05 },
    "drive":      { "from": "feature:energy",  "rise": 0.10, "fall": 0.70 },
    "weight":     { "from": "feature:band.sub","rise": 0.04, "fall": 0.35 },
    "brightness": { "from": "feature:centroid","rise": 0.25, "fall": 0.50 },
    "tension":    { "from": "anticipate:DROP", "window": 4.0 }
  },

  "classification": {
    "kick": { "bassRatio": 0.58, "maxCentroid": 220, "maxDecay": 0.20 },
    "hat":  { "minCentroid": 6000 }
  },

  "palette": {
    "bg": ["#05060B", "#0D0A18"],
    "primary": "#7B4CFF", "secondary": "#2A1B5E",
    "accent": "#FF2E63",  "glow": "#8A5CFF",
    "contrast": 0.85,
    "drift": { "lowEnergy": "#3A2A6B", "highEnergy": "#FF2E63" }
  },

  "macros": {
    "energy": 0.75, "reactivity": 0.85, "density": 0.60, "movement": 0.55,
    "depth": 0.80, "glow": 0.70, "chaos": 0.35, "smoothness": 0.40
  },

  "layers": {
    "particles": { "count": 2500, "lifetime": [1.2, 3.0], "gravity": -0.02 },
    "field":     { "rows": 24, "perspective": 0.65 },
    "postfx":    { "feedback": 0.90, "shake": 0.012, "chromatic": 0.004 }
  },

  "safety": { "reducedFlashing": false }
}
```

Format **JSON pur, versionné, validé par schéma**. Un preset n'exécute jamais de code : c'est ce qui
permettra d'en partager sans risque de sécurité.

---

## Les 5 presets du MVP

Chacun est choisi pour couvrir une zone distincte de l'espace musical, pas pour faire nombre.

### Trap Dark — `field`
> Lourd, sombre, spatial. Le sub est le personnage principal.

Le câblage donne le rôle dominant à `subImpact` (décroissance 0,55 s) : la scène **continue de
respirer** entre les kicks, comme une 808 tenue. Les hats pilotent un scintillement fin qui donne la
densité sans encombrer. Palette violet profond → magenta sur les pics. Réaction forte au `DROP`.

### Drill — `field`
> Nerveux, froid, décalé. Le kick n'est pas là où on l'attend.

Le kick glissé de la Drill produit des faux positifs : `bassRatio` remonté à 0,64 et `maxDecay`
abaissé à 0,18. Décroissances courtes partout (`impact` 0,08 s) pour un rendu sec. Palette bleu
acier / blanc froid. Les downbeats étant peu fiables sur ce genre, le preset **réduit volontairement
le poids des effets « sur la mesure »** au profit des effets par événement.

### House — `pulse`
> Régulier, hypnotique, lumineux. La grille est fiable, on s'appuie dessus.

C'est le genre où la détection est la meilleure (kick sur chaque temps). Le preset exploite
massivement `pulse` et `barPulse` — la phase continue de la mesure — pour un mouvement circulaire
ininterrompu. Décroissances moyennes, forte anticipation sur `BUILDUP` (les montées House sont
longues et lisibles). Palette orange chaud → cyan.

### Lofi — `spectrum-pro`
> Calme, chaud, grainé. Aucun impact violent.

Régime volontairement proche du continu : `impact` plafonné à 0,45, décroissances longues, lissage
fort. Grain et vignettage prononcés. Palette sépia / vert d'eau, faible contraste. C'est le preset
qui démontre que le produit sait **ne pas en faire trop** — souvent plus convaincant en démo qu'un
preset spectaculaire.

### R&B — `pulse`
> Fluide, sensuel, mélodique. Le snare mène, pas le kick.

Recâblage significatif : `impact` est alimenté par `SNARE` et `CLAP`, `weight` par la basse.
Le kick devient secondaire. Mouvements lents, larges, `smoothness` à 0,85. Palette bordeaux /
doré. C'est la démonstration la plus visible de la valeur du câblage par données : même moteur,
même style, caractère radicalement différent.

---

## Presets V2

Afrobeat · Boom Bap · Jersey · Hyperpop · Trap Melodic · Trap Rage.

Ils n'arriveront qu'après stabilisation du `BehaviourEngine` : un preset créé avant que le moteur de
comportement soit figé devra être refait intégralement. C'est la raison — la seule — pour laquelle le
MVP en compte 5 et non 11.

---

## Les 8 macro-contrôles

Un utilisateur ne doit jamais voir « décroissance de l'impulsion sub en secondes ». Il voit huit
curseurs, chacun agissant sur plusieurs paramètres internes selon une courbe définie par le style.

| Macro | Effet perçu | Agit sur |
|---|---|---|
| **Énergie** | intensité générale | gains globaux, amplitude des impulsions, luminosité |
| **Réactivité** | nervosité vs souplesse | temps de décroissance (inversement), constantes de lissage |
| **Densité** | quantité d'éléments | nombre de particules, de bandes, de lignes |
| **Mouvement** | vitesse générale | facteurs de vitesse, vitesse de dérive, rotation |
| **Profondeur** | sensation 3D | perspective, parallaxe, échelle du flou de champ |
| **Glow** | halo lumineux | intensité additive, force du bloom |
| **Chaos** | imprévisibilité | amplitude du bruit seedé, dispersion |
| **Douceur** | rondeur des transitions | courbes d'accélération, temps d'interpolation |

Chaque macro est une courbe déclarée par le style :

```jsonc
"macroCurves": {
  "reactivity": {
    "mapping.impact.decay":    { "at0": 0.30, "at1": 0.06, "curve": "easeOut" },
    "mapping.tick.decay":      { "at0": 0.15, "at1": 0.03 },
    "layers.postfx.shake":     { "at0": 0.000, "at1": 0.020 }
  }
}
```

Un même curseur produit donc un effet différent selon le style — ce qui est exactement le
comportement attendu par un utilisateur créatif.

---

## Deux niveaux d'interface (et non trois)

| Niveau | Contenu | Public |
|---|---|---|
| **Simple** | preset + palette + 3 macros (Énergie, Densité, Glow) + format d'export | 85 % des utilisateurs |
| **Avancé** | 8 macros + choix des couches + câblage + réglages par couche | 15 % |

Le mode « Expert » du brief initial est remplacé par un **éditeur JSON du preset**, avec validation
par schéma et rechargement à chaud. Coût de développement : quelques heures. Public : très restreint,
mais exactement celui qui écrira les presets communautaires de la V2. Trois interfaces complètes à
maintenir pour un MVP est un mauvais investissement ; un éditeur JSON en est un bon.

---

## Résolution d'un preset

```
preset de base (JSON)
   → surcharges de style
   → macros appliquées via macroCurves
   → surcharges utilisateur (stockées comme un diff, pas comme une copie)
   → configuration finale, gelée
```

Stocker les modifications utilisateur comme un **diff** a deux conséquences directes : le fichier
projet reste minuscule, et une amélioration d'un preset livrée en mise à jour bénéficie
automatiquement aux projets existants. Stocker une copie complète figerait chaque projet dans la
version du preset au jour de sa création.

---

## Adaptation automatique au morceau

Au chargement, avant même que l'utilisateur ne choisisse, le produit propose un preset :

```
1. tempo détecté          → filtre les presets dont la plage correspond
2. profil spectral moyen  → distingue les genres à sub dominant (Trap, Drill)
                            des genres à médium dominant (Lofi, R&B, Boom Bap)
3. densité d'onsets       → distingue les genres denses (Jersey, Hyperpop)
                            des genres aérés (Lofi, R&B)
4. confiance de la grille → si < 0,6, propose d'office un preset à régime continu (Lofi, R&B)

→ preset suggéré, jamais imposé, avec la mention « suggéré d'après l'analyse »
```

Ce n'est pas de la classification de genre — le produit ne prétendra pas reconnaître de l'Afrobeat.
C'est un **bon point de départ**, et cela suffit à supprimer la principale friction de premier usage :
ne pas savoir par où commencer.
