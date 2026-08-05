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

**Implémenté à l'Étape 13/P11** (`src/presets/schema.ts`, `validatePreset()`) : forme JSON fidèle à
cet exemple, avec deux écarts. (1) `classification.kick.maxDecay` de cet exemple est en réalité
`maxDecay30` dans `analysis/classify.ts` (`ClassificationThresholds`) — corrigé dans les 5 presets
livrés, l'exemple ci-dessus garde la coquille d'origine. (2) `genre` porte 3 champs supplémentaires
non montrés ici (`subDominance`, `onsetDensity`, `continuousRegimePreference`) — nécessaires à
`suggest.ts` (voir plus bas, §"Adaptation automatique") pour les étapes 2 à 4 de la suggestion
automatique, absents de cet unique exemple JSON du document.

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

**Implémenté à l'Étape 13/P11** (`src/presets/genres/*.json`) : les 5 presets ci-dessus, au format
de la §"Structure". Seul Trap Dark reprend des valeurs numériques données par ce document (l'unique
exemple JSON complet) ; les 4 autres traduisent la prose ci-dessus en valeurs concrètes — hex de
palette, `mapping`, seuils de classification, `genre.tempoHint` — qui SONT DES CHOIX, pas des
données du corpus (aucun corpus n'existe encore, voir docs/JOURNAL.md Étape 13/P11). Notamment :
`R&B.genre.tempoHint` (`[60,95]`) est entièrement auto-choisi — R&B n'apparaît pas dans la table de
plages de tempo de docs/05 §1 (Trap/Drill/House/Lofi/Boom Bap/Afrobeat/Jersey seulement).
`House.genre.doubleTimeHint = true` : docs/05 §1 cite explicitement l'ambiguïté 128↔64 pour la
House dans son exemple ×2/÷2, alors que la présente section ne le mentionne pas — retenu par
cohérence avec docs/05. `layers` (particules, grille, postfx) n'est renseigné QUE pour Trap Dark
(seul cas aux valeurs documentées) : voir §"Les 8 macro-contrôles" ci-dessous pour la raison de ne
pas avoir inventé les 4 autres.

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

**Implémenté à l'Étape 13/P11** (`src/presets/macros.ts`, `applyMacroCurves()`) : interpolation
`at0 → at1` avec courbe optionnelle (`linear` par défaut, `easeInQuad` déjà attestée ailleurs dans
le code, `easeOut` nommée par l'exemple ci-dessus mais sans formule donnée — ease quadratique
standard retenue, symétrique de `easeInQuad`).

**Limite assumée — seules `energy` et `reactivity` ont un effet câblé aujourd'hui**, sur les gains
et décroissances/lissages de `behaviour/mapping` (réellement consommés par `BehaviourEngine`). Les 6
autres macros (densité, mouvement, profondeur, glow, chaos, douceur) ciblent, par leur propre
description dans le tableau ci-dessus, des paramètres de **couches visuelles** (`layers.*`, bloom,
dispersion de bruit) — et AUCUNE couche du MVP (`ParticleField`, `PerspectiveGrid`, `FrameFeedback`,
`ScreenShake`, `SpectrumBars`, livrées en P7/P9) n'accepte de paramètres de construction : chacune
fixe ses constantes en interne. Câbler ces 6 macros sur des chemins qu'aucun code ne lit aurait
prétendu un effet qui n'existe pas. Leur valeur brute (0..1) reste disponible dans
`ResolvedPreset.macros` pour quand les couches deviendront configurables — hors périmètre de cette
étape (voir docs/JOURNAL.md, Étape 13/P11). Aussi non implémenté : « chaque style déclare ses
propres courbes » — une seule table `WIRED_MACRO_CURVES`, partagée par les 3 styles, faute de
valeurs distinctes données par style ailleurs que dans l'exemple `reactivity` ci-dessus.

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

**Implémenté à l'Étape 14/P12** (`src/ui/dialogs/PresetEditorDialog.ts`) : `<textarea>` +
`validatePreset()` + application à chaud, comme annoncé — quelques heures de développement, pas plus.
Le preset édité devient la configuration active TELLE QUELLE (le module interne `customPreset` de
`ui/App.ts`), pas un diff sur `userMappingOverrides` — plus simple que ce que l'Étape 13/P11 avait
anticipé, et couvre en plus palette/classification/safety, que `userMappingOverrides` ne couvrait
pas.

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

**Implémenté à l'Étape 13/P11** (`src/presets/resolve.ts`, `resolvePreset()`) : les 4 étapes du
pipeline, dans l'ordre. « Surcharges de style » est un NO-OP aujourd'hui — un seul jeu de valeurs
par défaut existe (`defaultMapping`, `DEFAULT_CLASSIFICATION_THRESHOLDS`), pas un jeu distinct par
style, donc rien à surcharger à cette étape précise (voir aussi la limite sur `macroCurves`
ci-dessus, même cause). Les « surcharges utilisateur » ne couvrent pour l'instant que `mapping`
(`userMappingOverrides`, même forme de diff que `Preset.mapping`) : aucune UI n'existe encore pour
éditer une palette ou des macros (P12, « éditeur JSON du preset »), donc rien ne produirait un tel
diff aujourd'hui — étendre `resolvePreset` à d'autres diffs attendra un vrai consommateur.

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

**Implémenté à l'Étape 13/P11** (`src/presets/suggest.ts`, `suggestPreset()`) : les 4 étapes.
L'étape 4 (confiance de grille basse) est un FILTRE dur sur le catalogue candidat (« propose
d'office » = impose la famille, pas juste une préférence) plutôt qu'une simple pondération ; les
étapes 1 à 3 (tempo, profil spectral, densité) sont ensuite combinées à **poids égaux** — ce
document ne chiffre pas de pondération pour elles, contrairement à l'arbitrage ×2/÷2 du tempo
(docs/05 §1, poids 0,5/0,3/0,2 explicites) : poids égaux retenus faute d'autre donnée, pas une
valeur du corpus. Le critère d'acceptation « la suggestion tombe juste sur 7 morceaux sur 10 »
(docs/14, P11) reste **bloqué** — même blocage que la F-mesure de classification/structure depuis
l'Étape 2 : Aaron n'a pas encore fourni de corpus annoté. Vérifié uniquement sur des documents PMDI
synthétiques (`tests/unit/presetSuggest.test.ts`).
