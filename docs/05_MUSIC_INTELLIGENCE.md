# 05 — INTELLIGENCE MUSICALE

> De la courbe de features à la compréhension du morceau : tempo, grille, instruments, structure.
> C'est ici que se joue la différence entre « ça bouge avec le son » et « ça comprend la musique ».

## Principe de gouvernance : l'honnêteté est une fonctionnalité

Chaque sortie de ce moteur porte une **confiance**. Une détection à 0,45 n'a pas le droit de
déclencher le même effet qu'une détection à 0,95. Un moteur qui prétend être sûr est un moteur qui
produira, une fois sur dix, un flash visuel sur un silence — et c'est ce genre d'erreur qui fait
juger un produit amateur.

```
confidence ≥ 0,85   →  effet plein
0,60 – 0,85         →  effet atténué proportionnellement
0,40 – 0,60         →  contribue au régime continu uniquement, aucun effet ponctuel
< 0,40              →  ignoré, conservé en debug
```

---

## 1. Tempo

### Méthode

```
1. ODF global = somme pondérée des flux par bande
      poids : sub 0,30 · bass 0,30 · lowmid 0,15 · mid 0,05 · himid 0,10 · high 0,10
      (le grave domine : c'est là que se trouve la pulsation dans nos genres)
2. suppression de la composante continue, lissage sur 3 trames
3. autocorrélation sur des décalages de 0,3 à 1,0 s (60 à 200 BPM)
4. filtre en peigne : pour chaque tempo candidat, sommer l'autocorrélation
   aux décalages T, 2T, 3T, 4T → renforce le vrai tempo, atténue les harmoniques
5. pondération par une préférence perceptuelle centrée sur 120 BPM
      w(BPM) = exp( −0,5 · ( ln(BPM/120) / 0,7 )² )
6. sélection du maximum → BPM brut
```

### Le piège ×2 / ÷2 — traité comme cas nominal, pas comme bug

Une Trap à 70 BPM avec des hats en doubles-croches sera détectée à 140 par tout algorithme naïf.
Une House à 128 avec un kick sur chaque temps peut être détectée à 64. Ce n'est pas une erreur de
code : les deux réponses sont **musicalement défendables**.

Arbitrage explicite en trois tests successifs :

```
Soit B le candidat principal, et B' ∈ {B/2, B×2} le concurrent.

Test 1 — Cohérence du grave
   Pour chaque candidat, mesurer l'énergie moyenne de la bande `bass` aux positions de temps.
   Le tempo dont les temps tombent sur les kicks gagne. Poids : 0,5

Test 2 — Régularité de la sous-division
   Compter les onsets de la bande `high` (hats) par temps.
   > 3,5 hats par temps → le tempo est probablement trop lent (×2 attendu). Poids : 0,3

Test 3 — Plage attendue du genre (si un preset genre est déjà choisi)
   Trap 60–90 (ou 120–180 en double-temps) · Drill 138–150 · House 118–130
   Lofi 70–90 · Boom Bap 85–95 · Afrobeat 100–115 · Jersey 130–140
   Poids : 0,2  —  indicatif, jamais bloquant

Si le score des deux candidats diffère de moins de 15 % → confiance plafonnée à 0,65
et le tempo « double » est conservé en métadonnée alternative.
```

Ce dernier point compte : quand l'algorithme hésite entre 70 et 140, le produit n'a pas besoin de
trancher — un visuel qui pulse à 70 avec des accents à 140 est correct dans les deux cas.

### Confiance du tempo

```
confidence = 0,45 · netteté_du_pic
           + 0,35 · stabilité_temporelle      (autocorrélation par tiers de morceau, cohérence)
           + 0,20 · marge_sur_le_second_candidat
```

### Tempo variable

Le MVP suppose un **tempo constant** — hypothèse valide sur 95 % des genres cibles (tous produits
sur grille). La structure `TempoMap` du PMDI accepte néanmoins plusieurs points, pour ne pas avoir à
casser le format en V2 (ralentis, morceaux live, changements de section).

---

## 2. Suivi de beats

Autocorrélation seule donne la *période*, pas la *phase*. Il faut placer les temps.

### Programmation dynamique (approche Ellis)

```
Pour chaque trame i, on cherche la séquence de beats maximisant :

   score(i) = ODF(i) + max_j [ score(j) + α · penalite(i − j, période) ]

   penalite(Δ, P) = −( ln(Δ / P) )²        ← pénalise l'écart au tempo attendu
   α ≈ 0,8   (compromis entre « suivre le signal » et « rester régulier »)

Puis remontée du chemin optimal depuis le maximum final.
```

Cette formulation a une propriété précieuse : elle **tolère les mesures sans onset** (un break, un
silence) tout en gardant la grille. Un détecteur de pics naïf perdrait le compte.

Complexité : O(n · W) avec W ≈ 2 périodes. Pour 4 minutes : quelques dizaines de millisecondes.

### Confiance par beat

```
confidence_beat = 0,6 · ODF_normalisée_au_beat + 0,4 · confidence_tempo_globale
```

Un beat placé par inertie dans un break aura une confiance basse — et le moteur visuel le saura.

---

## 3. Downbeats et mesures

Hypothèse MVP : **mesure à 4 temps** (vraie sur tous les genres cibles).

```
Pour chaque phase φ ∈ {0, 1, 2, 3} :
   score(φ) = Σ  [ 0,55 · énergie_bass(beat)          ← le kick est sur le 1
                 + 0,25 · force_onset(beat)
                 + 0,20 · nouveauté_spectrale(beat) ]   pour tous les beats ≡ φ (mod 4)

downbeat = argmax(score)
confiance = (meilleur − deuxième) / meilleur, écrasée dans 0..1
```

Fiabilité réelle : 70 à 85 %. En Drill et en Jersey, le kick est délibérément déplacé — c'est
précisément le genre où l'algorithme se trompe. La confiance le reflétera, et les effets « sur la
mesure » seront atténués en conséquence.

Les **phrases** (groupes de 4 ou 8 mesures) sont déduites des frontières de sections quand elles
s'alignent sur une mesure ; sinon supposées de 8 mesures avec confiance 0,5.

---

## 4. Classification des onsets

Chaque onset détecté (04, étape 4) est classé par un arbre de règles sur son empreinte spectrale.

### Vecteur descripteur

**Point décisif : les descripteurs sont mesurés sur le spectre de DIFFÉRENCE, pas sur le spectre
absolu.**

```
Δm(f) = moyenne sur les 3 trames suivant l'onset de  max(0, m_t(f) − m_{t−1}(f))
```

C'est l'énergie **ajoutée par l'onset**, et non l'énergie totale présente à cet instant. La distinction
n'est pas cosmétique : sur les 17 ms qui suivent un kick, le mix contient aussi les hats, le snare et
la mélodie ; le centroïde du spectre absolu y est typiquement entre 800 et 3 000 Hz, jamais sous
250 Hz. Une règle KICK appliquée au spectre absolu rejetterait la quasi-totalité des kicks. Sur le
spectre de différence, le kick est seul à avoir ajouté de l'énergie sous 120 Hz, et les seuils
ci-dessous deviennent atteignables.

```
E_sub, E_bass, E_lowmid, E_mid, E_himid, E_high     énergies relatives de Δm, normalisées
centroid                                             centroïde de Δm
flatness                                             platitude de Δm (bruit vs tonal)
decay30                                              décroissance, sur l'enveloppe brute
```

**`decay30` doit être défini pour le cas saturé.** Dans un mix dense — c'est-à-dire le cas nominal de
nos genres — l'enveloppe ne redescend jamais de 30 dB avant le hit suivant.

```
decay30       = min( premier t où env(t) < env_pic / 31,6 ,  500 ms )
decaySature   = vrai si le seuil n'a pas été atteint dans les 500 ms
```

Quand `decaySature` est vrai, la condition sur `decay30` est **neutralisée** : elle ne contribue ni à
la satisfaction de la règle, ni à sa marge. L'évaluer sur une valeur plafonnée fausserait la
classification exactement dans les cas les plus fréquents.

> Les valeurs numériques des règles ci-dessous sont des **points de départ à calibrer sur le corpus**,
> pas des constantes normatives. Elles vivent dans un fichier de configuration, pas dans le code.

### Règles

```
KICK      E_sub + E_bass > 0,55 · E_totale
          ET centroid < 250 Hz
          ET decay30 < 220 ms
          → intensité = E_bass normalisée

SNARE     E_lowmid > 0,20 · E_totale
          ET E_himid + E_high > 0,25 · E_totale
          ET flatness > 0,35                    ← composante bruitée obligatoire
          ET decay30 ∈ [80 ms, 400 ms]

CLAP      profil de SNARE
          MAIS présence de 2 à 4 micro-onsets espacés de 8 à 25 ms   ← signature du clap
          (détectés sur l'enveloppe brute, pas sur l'ODF)

HAT       E_high > 0,45 · E_totale
          ET centroid > 5 000 Hz
          ET decay30 < 400 ms
          → closed si decay30 < 120 ms, open sinon  (meta.open)

PERC      onset significatif ne correspondant à aucune règle ci-dessus,
          avec centroid ∈ [800 Hz, 5 000 Hz]

(aucune)  rejeté — conservé en debug
```

### Confiance de classification

La marge se mesure sur **la règle retenue**, condition par condition, chacune ramenée sur une échelle
déclarée explicitement (les unités sont hétérogènes : ratios sans dimension, hertz, millisecondes —
une « distance normalisée » globale n'aurait aucun sens).

```
Pour chaque condition i de la règle retenue :
      marge_i = (x_i − θ_i) / échelle_i          (signe orienté vers « satisfait »)

      échelles déclarées :   ratios d'énergie  0,10
                             centroïde         200 Hz
                             decay30           60 ms       (ignorée si decaySature)
                             flatness          0,10

marge_de_règle = clamp( min_i(marge_i), 0, 1 )
confidence     = min( force_onset, marge_de_règle )
```

Un onset qui satisfait KICK de justesse (`E_bass = 0,56` pour un seuil de 0,55) obtient
`marge = 0,10` et donc une confiance très basse. C'est exactement le comportement voulu : il sera
classé kick, mais ne déclenchera aucun effet fort.

### Calibration par genre

Les seuils ci-dessus sont des valeurs par défaut. Chaque preset genre peut les surcharger :

```json
{
  "classification": {
    "kick": { "bassRatio": 0.62, "maxCentroid": 200 },
    "hat":  { "minCentroid": 6500 }
  }
}
```

**Où cette étape s'exécute.** Pas dans le Worker d'analyse. Le Worker produit les *descripteurs*
d'onsets et les conserve dans le PMDI (`ext.onsetDescriptors`) ; la classification est une fonction
pure `descripteurs × seuils → événements typés`, exécutée sur le thread principal. Raison : les
seuils viennent du preset, et le preset est suggéré à partir du résultat de l'analyse — la
dépendance serait circulaire. Effet secondaire très utile : changer de preset en cours de lecture
reclasse tout le morceau en moins d'une milliseconde, sans réanalyse.

En Drill, les 808 glissantes déclenchent des faux kicks : le preset Drill remonte `bassRatio` et
ajoute une contrainte de `decay30 < 180 ms`. C'est ce genre d'ajustement, invisible à l'utilisateur,
qui fait la différence entre un moteur générique et un moteur qui « comprend » le genre.

**Implémenté à l'Étape 12/P10** (`src/analysis/classify.ts`) : `classifyOnset()`/`classifyOnsets()`,
fonction pure comme spécifié, appelée depuis le thread principal par `analysis/finalize.ts` (jamais
le Worker). Ordre de test des règles : KICK, puis CLAP (avant SNARE — plus spécifique), puis SNARE,
puis HAT, puis PERC — repli sur `null` (rejeté) sinon. `DEFAULT_CLASSIFICATION_THRESHOLDS` couvre
toutes les valeurs par défaut ci-dessus. `classifyOnset()` accepte un second paramètre optionnel au
format JSON de « Calibration par genre » ci-dessus, mais **aucun système de preset n'existe encore**
(P11) — personne n'appelle ce paramètre pour l'instant, la porte est seulement ouverte.

**Écart d'implémentation :** la fenêtre de détection des micro-onsets du CLAP (60 ms après l'onset)
et le seuil de proéminence d'un pic (15 % du pic local) ne sont pas donnés par ce document — seul
l'espacement 8–25 ms l'est. Choisis dans `onsetDescriptors.ts` (`MICRO_ONSET_WINDOW_SEC`,
`MICRO_ONSET_MIN_PROMINENCE_RATIO`) faute de valeur normative ; à ajuster avec la calibration par
corpus quand elle sera possible.

---

## 5. Basse et 808

Une 808 n'est pas un onset : c'est une **note tenue** avec un contour. La traiter comme un événement
ponctuel produit un visuel qui frappe puis meurt, alors que la musique, elle, continue de vibrer.

```
Sortie double :
  - événements  SUB_HIT   au début de chaque segment de basse (onset de note)
  - piste continue  bass.contour  → hauteur normalisée sur l'étendue du morceau
  - piste continue  bass.presence → énergie sub+bass lissée
```

Le moteur visuel utilise l'événement pour l'impact et la piste continue pour la **déformation lente**
— exactement la distinction demandée dans le brief initial (« mouvement lent, pulsation basse
fréquence, déformation de forme »).

---

## 6. Structure du morceau

### Méthode : matrice d'auto-similarité synchrone aux beats

```
1. agrégation des features par beat (moyenne sur chaque intervalle de beat)
      vecteur par beat : 6 bandes + centroïde + platitude + densité d'onsets = 9 dimensions
2. normalisation par dimension
3. matrice S[i][j] = similarité cosinus entre le beat i et le beat j
4. convolution par un noyau en damier (taille 16 beats = 4 mesures)
      → courbe de nouveauté
5. sélection de pics sur la nouveauté, avec distance minimale de 16 beats
6. alignement des frontières sur le downbeat le plus proche (± 2 beats)
```

### Étiquetage — la limite honnête

On peut détecter **où** ça change. On ne peut pas nommer « couplet » ou « refrain » sans modèle.
Le produit ne prétendra pas le faire.

Les sections sont donc étiquetées par **niveau d'énergie relatif** :

```
"low"    énergie < 0,40 du maximum du morceau       → intro, break, pont
"mid"    0,40 – 0,70                                 → couplet
"high"   > 0,70                                      → refrain, drop
```

C'est moins impressionnant sur une capture d'écran, et infiniment plus utile pour piloter des
visuels : ce dont une scène a besoin, c'est de savoir si l'énergie monte, pas comment le morceau
s'appelle. Les groupes de sections d'énergie identique et de profil spectral proche reçoivent une
**lettre** (`A`, `B`, `A`, `C`…), ce qui permet à un style de réutiliser le même traitement visuel
pour deux refrains — un effet perceptuellement très fort, obtenu sans transcription.

**Implémenté à l'Étape 12/P10** (`src/analysis/structure.ts`, `detectSections()`) : les 6 étapes
ci-dessus telles quelles. Repli honnête si moins de 17 beats (2×16+1) : une section unique couvrant
tout le morceau, confiance 0,3, plutôt que de fabriquer des frontières sur du bruit.

**Écart d'implémentation :** les seuils « low/mid/high » ci-dessus **ne sont pas écrits** dans
`Section.label` — ce champ est documenté « Mode B uniquement » (`src/music/pmdi.ts`, noms
sémantiques réels comme « intro »/« verse »), pas un synonyme de ce triage par énergie. `structure.ts`
exporte à la place `SECTION_ENERGY_LOW_MAX` (0,4) et `SECTION_ENERGY_HIGH_MIN` (0,7) ; tout
consommateur de `Section.energy` (toujours 0..1, toujours présent) peut catégoriser lui-même.

---

## 7. Macro-événements

Depuis l'enveloppe d'énergie lissée sur une mesure (`E_bar`) :

```
DROP        E_bar passe de < 0,45 à > 0,80 en ≤ 2 mesures
            ET l'énergie basse était < 0,3 juste avant
            → intensité = amplitude du saut
            → confiance élevée : c'est un des motifs les plus fiables à détecter

BUILDUP     E_bar croît de façon monotone sur ≥ 4 mesures
            ET la densité d'onsets high augmente (rolls de hats, snare rolls)
            ET (souvent) le centroïde monte     ← risers filtrés
            → posé comme événement de DURÉE (dur = longueur du buildup)

BREAK       E_bar < 0,35 pendant ≥ 2 mesures, après une section > 0,65
            ET absence de kick

ENERGY_UP   variation de E_bar > +0,20 sur 1 mesure, hors DROP
ENERGY_DOWN variation < −0,20

SILENCE     RMS < −45 dBFS pendant ≥ 0,4 s     ← les coupures nettes sont visuellement puissantes
```

`BUILDUP` a une **durée**, ce qui est essentiel : le visuel doit monter *pendant* le buildup, pas
réagir à sa fin. C'est pour cela que la timeline est requêtable en avant — une scène qui sait qu'un
drop arrive dans 3,2 secondes peut construire une tension.

**Implémenté à l'Étape 12/P10** (`src/analysis/macro.ts`, `detectMacroEvents()`) : les 6 motifs
ci-dessus depuis `E_bar` agrégé par mesure. `ENERGY_UP`/`ENERGY_DOWN` sont supprimés sur les mesures
déjà couvertes par un `DROP` (évite la redondance visuelle sur la même transition).

**Dépendance d'ordre :** `BREAK` a besoin des événements `KICK` déjà **typés** (« absence de kick »)
— pas seulement des onsets bruts. `analysis/finalize.ts` impose donc `classifyOnsets()` avant
`detectMacroEvents()`, jamais l'inverse ; un test dédié (`finalize.test.ts`) vérifie qu'un kick caché
dans la plage basse supprime effectivement un `BREAK` qui serait sinon détecté.

**Écart d'implémentation — SILENCE.** Les pistes de features générales du PMDI sont normalisées par
percentile (docs/04 : jamais de normalisation en valeur absolue, pour qu'un master silencieux ou
fort paraisse également engageant). Mais SILENCE a besoin d'un seuil dBFS **absolu** (−45 dBFS), non
exprimable depuis `energy` normalisée. Ajout d'une piste brute (non normalisée) `ext.rawRmsDb` à la
sortie d'`AnalysisPipeline.ts`, sans toucher à `features[].rms` existante. Le balayage est fait
échantillon par échantillon (pas un pas fixe de 0,4 s, qui raterait le vrai début du silence de
manière asymétrique) — corrigé pendant les tests unitaires de cette étape.

---

## 8. Régime de dégradation

Sur du R&B live sans percussion nette, du lofi noyé, de l'ambient sans grille : la détection échoue,
et c'est normal. Le produit doit rester beau.

```
confiance_grille = 0,5 · confiance_tempo + 0,3 · confiance_beats_moyenne + 0,2 · densité_onsets_norm

confiance_grille ≥ 0,60  →  RÉGIME ÉVÉNEMENTIEL
     impacts nets, coupes sur la grille, accents synchronisés

confiance_grille < 0,60  →  RÉGIME CONTINU
     mouvement piloté par les enveloppes d'énergie et le centroïde
     pas d'impact ponctuel, transitions longues, respiration lente

zone 0,55 – 0,65  →  mélange proportionnel, pas de bascule brutale
```

Le passage entre régimes est **lissé sur 2 secondes**. Une bascule visible serait pire que le
problème qu'elle résout.

---

## 9. Ce que le Mode B change

| Information | Mode A (analyse) | Mode B (PULSAR) |
|---|---|---|
| Tempo | estimé, conf. 0,7–0,97 | **exact**, conf. 1,0 |
| Grille de beats | estimée | **exacte** |
| Downbeats | 70–85 % | **exacts** |
| Kick / snare / hat | 75–95 %, classification | **exacts**, avec le nom de la piste source |
| Vélocité de chaque hit | approximée par l'énergie | **exacte** |
| 808 / basse | contour de f0 | **notes exactes** (hauteur, durée) |
| Mélodie / accords | ❌ impossible | **exacts** |
| Sections | frontières estimées | **exactes**, avec le rôle réel |
| Buildup / drop | inférés | **intentionnels**, connus à l'avance |

Autrement dit : en Mode B, tout ce document devient inutile — et c'est exactement le but. Le moteur
d'analyse est un **estimateur remplaçable**, pas une fondation. Il remplit le même contrat PMDI, avec
des confiances inférieures à 1.
