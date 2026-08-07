<!--
  Copie de reference du prompt de phase 2, deposee dans le projet au chantier 1.
  L'original vit hors du depot ; CLAUDE.md interdit d'y acceder. C'EST CETTE COPIE
  QUI FAIT FOI. Si l'original evolue, c'est ici qu'il faut le reporter.
-->
# PULSAR_VISUALIZER_v2 — Phase 2 : réactivité, dramaturgie, catalogue visuel, interface

Projet : `C:\Users\gwada\Downloads\PULSAR_VISUALIZER_v2`
Propriétaire : Aaron. Réponses en **français**, concises, sans remplissage.

---

## 0. AUTORISATION EXPLICITE DE SORTIR DU MVP

**Lis cette section en entier avant d'ouvrir le moindre fichier. Sans elle, tu vas
t'arrêter et demander dès le premier tour — à juste titre.**

`CLAUDE.md` contient cette règle :

> **Tu ne dépasses pas le MVP.** Le périmètre est verrouillé dans
> `docs/00b_MASTER_PROMPT_V2.md` §4. Tu n'ajoutes ni style, ni preset, ni option,
> ni « petit plus pendant que j'y suis ».

Et `docs/00b_MASTER_PROMPT_V2.md` §4 exclut nommément :

> **Explicitement exclu du MVP** : WebGL2 · **styles 4 à 12** · **presets 6 à 11** ·
> **mode Expert** · … · **texte/logo personnalisés** · …

Tout ce que demande ce document est donc hors MVP. Ce n'est **pas** un oubli de
conception — le MVP a été délibérément réduit à 3 styles et 5 presets.

**Aaron, propriétaire du projet, lève ce verrou et ouvre la phase 2.** Le MVP est
livré ; ceci est sa suite prévue. Remarque que le périmètre exclu nomme « styles
**4 à 12** » et « presets **6 à 11** » : les nombres visés ici tombent exactement
dans ces plages. Ce n'est pas une entorse à la conception, c'est la continuation
qu'elle annonçait.

**Premier acte du chantier 1, avant tout code** : modifier `CLAUDE.md` et
`docs/00b_MASTER_PROMPT_V2.md` §4 pour acter l'ouverture de la phase 2, en
gardant la trace de ce qui était MVP. Sans ça, chaque nouvelle session
re-litigera la question.

**Ce qui reste verrouillé** : WebGL2 (le rendu reste Canvas 2D), l'export 4K, le
rendu serveur, le mobile, l'i18n, les lyrics, les notes/mélodie/accords. Les cinq
Lois de §2 restent intouchables. Si tu penses avoir besoin d'un de ces éléments,
**arrête-toi et demande**.

`CLAUDE.md` t'interdit de sortir du dossier du projet. Recopie donc ce document
en `docs/17_PHASE2_VISUELS.md` au chantier 1 ; c'est cette copie qui fait foi.

---

## 1. Contexte de départ

Ordre de lecture : **`CLAUDE.md`**, puis **`docs/00b_MASTER_PROMPT_V2.md`** (les
cinq Lois, le périmètre), puis **`docs/07_VISUAL_ENGINE.md`** et
**`docs/08_PRESETS.md`**. Pour toute intervention sur le mode live :
**`src/ui/live/NOTES.md`** d'abord.

Portique obligatoire :

```bash
npm run typecheck && npm test && npm run test:arch && npm run build
```

État de départ vérifié : **99 fichiers de test, 794 tests verts, 0 erreur de
typecheck**, build 448 kB. Toute régression est un échec, pas un détail.

Le projet est un dépôt git. `CLAUDE.md` impose un commit de point de sauvegarde
avant toute opération irréversible — applique-le.

---

## 2. LES CINQ LOIS — non négociables

**Loi 1 — `render(t)` est une fonction pure du temps.** La même image à
t = 12,480 s en preview 60 fps, en scrub, ou en export à 0,3×. Donc : aucun
`Math.random()` (PRNG seedé par `hash(projectSeed, round(t·120))`), simulation à
**pas fixe de 1/120 s**, aucune lecture de `performance.now()` hors du
`Transport`, aucun état accumulé par image sans `dt` explicite. Les couches à
état de framebuffer déclarent `needsDrawPriming`.
*Le test qui casse en premier : `tests/unit/exportDeterminism.test.ts`.*

> **Cette Loi est un ATOUT, pas une contrainte.** Elle rend triviales des
> fonctionnalités que les monteurs vidéo peinent à tenir : une courbe
> d'automatisation est littéralement `f(t)`, un LFO verrouillé au tempo est une
> fonction de `t` et de la grille, un rendu identique à chaque export est acquis.
> Plusieurs propositions de §7 en découlent directement.

**Loi 2 — le moteur visuel ne connaît que le `StepContext`.** Ni `AudioContext`,
ni fichier, ni analyseur. `visual/` **ne voit jamais un spectre plein** —
6 bandes (`docs/07:397`), plus `step.spectrum` en résolution réduite pour les
couches de spectre.

**Loi 3 — toute détection porte une `confidence`.** Une détection à 0,4 ne
déclenche jamais un effet fort. Sous 0,6 de confiance rythmique globale, le
moteur bascule en **régime continu** au lieu du régime événementiel.
**Un morceau non analysable doit rester beau.**

**Loi 4 — coordonnées normalisées uniquement.** `1,0` = **petit côté**, origine
au **centre**, `y` vers le **haut**. Le `Viewport` n'expose **ni largeur, ni
hauteur, ni pixels** :

```ts
interface Viewport { readonly aspect: number; readonly safe: SafeArea; }
```

Un style doit être correct en 16:9, 9:16 et 1:1 **sans aucun code conditionnel
par ratio**. C'est la contrainte qui tue le plus de conceptions naïves.

**Loi 5 — `FlashLimiter` non contournable**, dernier étage, avant encodage.

---

## 3. LE PIÈGE — deux moteurs de rendu séparés

| | **mode FICHIER** | **mode LIVE** |
|---|---|---|
| entrée | fichier audio, analysé hors ligne | flux WebRTC en direct |
| moteur | `Scene` + `Layer[]` + interface `Renderer` | `LivePipeline` + `LiveScene` |
| code | `src/visual/`, `src/render/`, `src/behaviour/` | `src/ui/live/` |
| accès au dessin | **API fermée** (§4) | contexte 2D brut |
| unité visuelle | 3 **styles** | 6 **scènes** |
| dramaturgie | **aucune** | `IntensityDirector` |
| caméra | **aucune** | `Camera` |
| easings | **aucun** | `util/easing.ts` |
| texte | **aucun** | `TypeSlamScene` |
| export vidéo | oui | non |

**Ne fusionne pas les deux moteurs.** Le mode live tourne sous contrainte temps
réel ; le mode fichier doit être déterministe pour l'export (Loi 1).

Mais **regarde le mode live avant d'écrire du mode fichier** : il a déjà résolu
la dramaturgie, les easings, la caméra, l'accent de grille et la typographie.
Mêmes problèmes. Ne les redécouvre pas — transpose, en respectant la Loi 1 que le
mode live n'a pas à tenir.

**Tout le travail décrit ici concerne le mode FICHIER**, sauf §10.3 (exposer le
texte du mode live, déjà configurable mais sans interface).

---

## 4. CE QUE LE `Renderer` PERMET RÉELLEMENT

**Section critique.** Une couche ne reçoit **pas** de `CanvasRenderingContext2D`,
mais l'interface fermée `Renderer` (`src/render/Renderer.ts`).

```ts
clear(color)
fillCircle(x, y, radius, color)
strokeCircle(x, y, radius, lineWidth, color)
strokePath(xs, ys, count, lineWidth, color, closed)   // Float32Array parallèles
fillPath(xs, ys, count, color)                        // polygone plein, couleur PLATE
fillRadialGradient(innerRadius, outerRadius, inner, outer)  // PLEIN ÉCRAN, centré (0,0)
createSprite(draw: (ctx: OffscreenCanvasRenderingContext2D) => void, size): SpriteHandle
drawSprite(sprite, transforms, count)                 // composite ADDITIF, imposé
applyShake(dx, dy)                                    // décalage global ; couche dessinée EN PREMIER
drawFeedback(scale, alpha)                            // image précédente ENTIÈRE, centrée+échelle
captureFeedback()
setBloomConfig(config) / setChromaticAberration(on) / setInternalResolutionScale(s)
```

### Ce qui N'EXISTE PAS

- **Pas de `clip()`.** Aucun découpage par forme arbitraire.
- **Pas de dégradé par forme.** `fillPath` prend **une couleur plate**.
- **Pas de `drawImage` arbitraire.** `drawFeedback` redessine l'image précédente
  **entière**. Impossible d'en lire une région et de la replacer ailleurs.
- **Pas de `setTransform`.** Toute projection se calcule **en JS**.
- **Pas de texte.** `Renderer.ts:56` : « `drawText` reste différé : aucune couche
  `Text` avant P12. »
- **Pas de choix de mode de fusion.** `'lighter'` est câblé en dur dans
  `drawSprite` ; `'multiply'` n'existe qu'en interne pour l'aberration
  chromatique. Une couche ne peut pas choisir. **C'est le manque le plus rentable
  à combler** — voir §7.2.
- **Pas d'entrée d'image.** Aucune pochette, aucun logo, nulle part dans le projet.

### La seule échappatoire : `createSprite`

`createSprite(draw, size)` donne un vrai `OffscreenCanvasRenderingContext2D`,
**une seule fois**, hors écran, pour fabriquer une texture réutilisable. C'est là
qu'on met tout ce que l'API ne sait pas faire : un dégradé, un glyphe, un bord
doux. `drawSprite` la place ensuite N fois en additif, depuis un tableau
pré-alloué muté en place. `size` est **un seul nombre** — sprites carrés.

**C'est le mécanisme central du projet.** Une conception qui a besoin d'autre
chose doit être réécrite, ou justifier une extension de l'interface `Renderer` —
ce qui touche l'export et la Loi 1, donc exige un ADR dans `docs/15_ADR.md` et
l'accord d'Aaron **avant** d'être écrite. Ce document autorise explicitement
deux extensions, et seulement deux : les **modes de fusion** (§7.2) et
**`drawImage`** pour la pochette (§7.5).

---

## 5. LE DIAGNOSTIC — pourquoi « les presets ne changent rien »

### 5.1 Six signaux sur onze sont calculés puis JETÉS

`BehaviourEngine` produit onze signaux à chaque pas. Voici qui les lit :

| signal | source musicale | couches qui le lisent |
|---|---|---|
| `impact` | KICK | `PulseRings`, `ScreenShake` |
| `weight` | bande sub | `PulseRings`, `ParticleField` |
| `brightness` | centroïde | `RadialBackground`, `CentralGlow` |
| `drive` | énergie | `CentralGlow` |
| `pulse` | phase de temps | `PerspectiveGrid` |
| **`accent`** | **SNARE, CLAP** | **aucune** |
| **`tick`** | **HAT** | **aucune** |
| **`subImpact`** | **SUB_HIT** | **aucune** |
| **`sectionShift`** | **changement de section** | **aucune** |
| **`tension`** | **anticipation du DROP** | **aucune** |
| **`barPulse`** | **phase de mesure** | **aucune** |

**Rien ne réagit à la caisse claire. Rien ne réagit au charley.**
`trap-dark.json` déclare `accent: { from: ["SNARE","CLAP"], gain: 0.75,
decay: 0.16 }` — calculé à chaque pas, puis jeté. `house.json` déclare
`tension: { from: "anticipate:DROP", window: 6.0, curve: "easeInQuad" }` :
l'anticipation du drop est **entièrement implémentée** et personne ne la lit.

**C'est la vraie raison pour laquelle les presets ne changent rien.** Le bloc
`mapping` est ce qui distingue le plus les presets, et plus de la moitié
n'atteint jamais l'image.

Pire pour `spectrum-pro` (le preset lofi) : ses trois couches — `AnimatedDuotone`,
`SpectrumBars`, `FlatWaveform` — ne lisent **aucun signal**. Modifier le `mapping`
de `lofi.json` ne peut, littéralement, rien changer.

### 5.2 Cinq presets pour trois styles

```
trap-dark -> field        drill -> field           <- même style
house     -> pulse        rnb   -> pulse           <- même style
lofi      -> spectrum-pro
```

### 5.3 Le bloc `layers` des presets est une donnée morte

`resolve.ts:118` recopie `preset.layers` dans `ResolvedPreset.layers`. **Personne
ne le lit** — ni `ui/App.ts`, ni `export/ExportPipeline.ts`. Vérifié.

### 5.4 Aucune structure sur la durée

`step.section` existe — `energy`, `letter` (répétition A/B/C détectée), `label`,
`confidence`. **Aucune couche ne le lit** ; `App.ts:653` ne s'en sert que pour la
timeline. Un morceau de trois minutes se rend donc sans la moindre variation
structurelle. C'est la signature amateur la plus reconnaissable.
`step.regime` (Loi 3) n'est lu par aucune couche non plus.

### 5.5 Le bloom n'appartient pas au preset

`setBloomConfig` et `setChromaticAberration` ne sont appelés que depuis le
**niveau de qualité** (`App.ts:235-236`, `ExportPipeline.ts:104-105`). Aucun
preset, aucune macro ne peut donner son caractère au bloom.

### 5.6 Autres manques structurels, vérifiés

- **Aucun module d'easing** dans `src/visual/` ni `src/core/`.
- **Aucune caméra** en mode fichier (seul `ScreenShake`).
- **Aucune variante de cadrage** par style.
- **`Viewport.safe` est déclaré et JAMAIS lu.** Les formats verticaux existent
  (`export/formats.ts` : Shorts/TikTok/Reels en 1080×1920) mais rien n'évite les
  zones couvertes par l'interface de ces plateformes.
- **Aucun sélecteur de couleur** : `#palette-swatch` (`index.html:220`) est un
  `<div>` en lecture seule.
- Le curseur **Profondeur** n'a aucun effet en style `pulse`
  (`layerMacros.ts:54-60`).
- Résidus périmés : `AdvancedPanel.ts:31` fait
  `WIRED_MACROS = new Set(MACRO_NAMES)`, rendant le badge `⚠` (ligne 56) et
  l'infobulle (ligne 65) inatteignables ; l'en-tête de `SimplePanel.ts` annonce
  encore Densité/Glow comme non câblées, faux depuis l'Étape 20.

### 5.7 Ce qui n'est PAS cassé

Les 37 contrôles de `index.html` ont tous un consommateur ; les 18 paramètres de
couche des macros sont tous lus ; les 12 raccourcis du mode live fonctionnent ;
`projectSeed` est déjà généré, persisté et rejouable (`App.ts:169`, `535`, `719`,
`835`).

---

## 6. CE QUI FAIT QU'UN VISUEL EST PROFESSIONNEL

Six manques structurels, par ordre d'impact. **Ils comptent plus que le nombre de
styles** : un seul style bien dirigé bat cinq styles plats.

### 6.1 La réactivité complète — brancher les six signaux morts

Chaque style doit répondre à **kick, caisse claire, charley et sub sur des
paramètres différents**. Meilleur rapport impact/coût du document : les signaux
sont calculés, les presets les décrivent, il ne manque que la lecture. Après ce
chantier, passer d'un preset à l'autre devient visible **sans ajouter un style**.

### 6.2 La dramaturgie — le visuel doit connaître la structure

Un `VisualDirector` lisant `step.section` et `step.regime`, produisant un budget
d'effets plutôt que de laisser chaque couche décider :

- **Intensité par section**, dérivée de `section.energy`.
- **Retenue avant l'impact** : sur les deux dernières mesures d'une montée,
  l'amplitude des réactions DIMINUE. Contre-intuitif, et c'est le point : si tout
  monte en même temps que le drop, le drop n'a plus de contraste à franchir.
- **Explosion puis retombée** : une mesure à fond après le drop, puis deux mesures
  SOUS le niveau d'avant. L'impact se mesure à la chute qui suit.
- **Plancher de vide** : au moins deux temps consécutifs par phrase où l'image
  retombe nettement. Sans respiration, pas d'accent.
- **Breakdown en quasi-noir** assumé.
- **Variation par lettre de section** : la section B ne doit pas être identique à
  la A. `section.letter` porte déjà l'information.

`src/ui/live/IntensityDirector.ts` est le modèle, avec ses seuils déjà mesurés.
Transpose en respectant la Loi 1 (aucun état accumulé par image, tout dérivé de `t`).

### 6.3 Les easings — l'attaque et le retour au repos

Aucun module d'easing n'existe en mode fichier. Piège déjà rencontré et corrigé
côté live, documenté dans `NOTES.md` : **une décroissance exponentielle ne revient
jamais au repos.** À `tau` elle vaut encore 0,37 ; il faut trois `tau` pour passer
sous 5 %. Une réaction de kick réglée « 0,35 » reste allumée quand la frappe
suivante arrive, et mange le contraste qu'elle devait créer.

Il faut : attaque quasi instantanée, **retour au repos sur 0,3 à 0,6 temps**,
dépassement de 8 % maximum **réservé aux éléments massifs**. Plus
l'**anticipation** : contre-mouvement dans les `max(90 ms, période/5)` qui
précèdent le temps — sous 90 ms c'est invisible, d'où un plancher absolu.

`src/ui/live/util/easing.ts` contient tout ça, testé. Le déplacer dans
`src/core/` le rendrait accessible aux deux moteurs (`visual/` peut importer
`core/`, pas `ui/`). **Décide et justifie.**

### 6.4 La caméra

Seul `ScreenShake` existe. Il manque le mouvement lent et délibéré : **poussée**
pendant une montée qui se relâche au drop, **recadrage franc** sur une frontière
de section (jamais au milieu d'une mesure), **dérive** très lente pendant les
passages calmes pour qu'aucun plan ne reste statique plus de quelques secondes.

Loi 4 : la caméra travaille en coordonnées normalisées et son recadrage doit
rester correct en 9:16 comme en 16:9.

### 6.5 Le bloom appartient au preset

`setBloomConfig` doit être piloté par le preset et par la macro Glow, avec le
niveau de qualité comme **plafond** et non comme source.

### 6.6 La profondeur — parallaxe entre les plans

Les couches sont plates : tout bouge au même rythme. Un arrière-plan plus lent
que le premier plan crée un volume qui ne coûte presque rien.

---

## 7. CE QUE FONT LES MEILLEURS OUTILS — analyse et transposition

### 7.0 Trois familles, trois forces différentes

**Avertissement de cadrage.** CapCut et Filmora sont des **monteurs vidéo**, pas
des visualiseurs musicaux : ils n'ont aucun moteur réactif, tout y est posé à la
main sur une timeline. Les comparer directement à PULSAR n'a pas de sens. Mais
ils sont excellents sur l'**ergonomie, les modèles prêts à l'emploi et
l'animation de texte**, et c'est là qu'il faut aller chercher.

| famille | exemples | ce qu'ils font mieux que nous | ce qu'ils n'ont pas |
|---|---|---|---|
| **Monteurs vidéo** | CapCut, Filmora, Premiere | modèles en un clic, bibliothèque d'animations de texte, **automatisation par images-clés**, modes de fusion, zones sûres sociales, étalonnage | aucun moteur réactif, aucune intelligence musicale, tout est manuel |
| **Visualiseurs musicaux** | Specterr, Renderforest, Vizzy | **pochette d'album au centre**, palette extraite de la pochette, titre/artiste, modèles par genre | réactivité pauvre, souvent un seul paramètre animé |
| **Logiciels VJ** | Resolume, TouchDesigner, MilkDrop | **LFO verrouillés au tempo sur n'importe quel paramètre**, fusion et opacité par couche, pile d'effets, pilote automatique | pas d'analyse hors ligne, pas d'export déterministe |

Ce que PULSAR a déjà et qu'**aucun** des trois n'a : une analyse musicale hors
ligne complète (tempo, temps, downbeats, sections, classification d'onsets avec
confiance) **et** un rendu déterministe. C'est un socle rare. Le reste de cette
section liste ce qu'on peut y greffer, classé par rentabilité réelle.

---

### 7.1 LFO verrouillés au tempo — le meilleur rapport du document

**Emprunté à Resolume**, dont c'est le mécanisme central de richesse.

N'importe quel paramètre peut être piloté par un oscillateur **verrouillé à la
grille musicale** : forme d'onde (sinus, triangle, dent de scie, carré,
aléatoire-tenu), division (1/8, 1/4, 1/2, 1, 2, 4, 8 mesures), décalage de phase,
amplitude, et un mode aller-retour.

PULSAR n'a aujourd'hui que `pulse` (sinus sur le temps) et `barPulse` (sinus sur
la mesure) — et `barPulse` n'est même pas lu. Une banque de 4 LFO assignables
multiplierait la variété de **tous les styles à la fois**, y compris ceux qui
existent déjà.

**Pourquoi c'est presque gratuit ici** : un LFO est une fonction pure de `t` et de
la position musicale. Zéro état, zéro allocation, **déterministe par construction**
— la Loi 1 est respectée sans le moindre effort. Dans un monteur vidéo ce serait
une couche d'automatisation à stocker ; ici c'est une dizaine de lignes de maths.

À ajouter dans `VisualSignals`, à côté des onze existants.

### 7.2 Modes de fusion par couche — la variété la moins chère qui soit

**Emprunté à Resolume et à tous les monteurs.**

`drawSprite` impose `'lighter'` en dur, et aucune couche ne peut choisir autre
chose. Or `globalCompositeOperation` est natif et gratuit : `screen`, `multiply`,
`difference`, `overlay`, `color-dodge`, `hard-light` donnent chacun un caractère
**complètement différent** à la même géométrie.

C'est l'une des deux extensions du `Renderer` autorisées par ce document : un
champ `blend` sur `Layer`, honoré par le renderer, exposé dans le preset et dans
le compositeur de couches (§7.7).

**Attention Loi 5** : `difference` et `color-dodge` peuvent produire des sauts de
luminance violents. Le `FlashLimiter` reste le dernier étage et n'est pas
contournable — vérifie qu'il ne se déclenche pas en permanence sur ces modes,
sinon le mode est inutilisable et il vaut mieux ne pas le proposer.

### 7.3 Automatisation par images-clés — l'autorité rendue à l'utilisateur

**Emprunté aux monteurs vidéo**, où c'est la fonction reine.

Aujourd'hui tout est automatique : l'utilisateur subit l'analyse. Il ne peut pas
dire « à 1:20, monte le glow » ni « ici, coupe tout ». Une piste
d'automatisation sur la timeline, avec des points et une interpolation, pour
l'intensité globale, les 8 macros et les paramètres de caméra.

**Pourquoi ça tombe parfaitement ici** : `render(t)` est déjà une fonction pure de
`t` (Loi 1). Une courbe d'automatisation **est** littéralement `f(t)`. Ça
s'intègre mieux dans PULSAR que dans n'importe quel monteur vidéo, où il faut
gérer un état de lecture.

À stocker dans le `.pvproj` (`docs/13_PROJECT_FORMAT.md`), et à appliquer
**après** le preset et les macros, comme dernier étage — même position que les
surcharges utilisateur de `resolve.ts`.

### 7.4 Zones sûres pour les formats sociaux

**Emprunté aux monteurs**, qui affichent tous des guides de cadrage.

`export/formats.ts` propose Shorts/TikTok/Reels en 1080×1920. Mais `Viewport.safe`
est **déclaré et jamais lu** : rien n'évite les zones que ces plateformes
recouvrent de leur propre interface — en gros la bande basse (légende, boutons)
et une colonne à droite (avatar, likes, partage).

Deux choses : un **guide visible en preview** quand un format vertical est
sélectionné, et des **couches qui respectent `safe`** pour tout ce qui porte du
sens — texte, pochette, accent principal. Le décor peut déborder, l'information
non.

C'est peu de code et ça sépare immédiatement un rendu amateur d'un rendu publiable.

### 7.5 Pochette d'album et palette extraite — le manque le plus visible

**Emprunté aux visualiseurs musicaux**, dont c'est LE format dominant.

Il n'existe **aucune entrée d'image** dans tout le projet. Or le cas d'usage le
plus courant d'un visualiseur musical, c'est la pochette au centre avec le visuel
autour. Sans ça, PULSAR ne peut pas produire le rendu que 80 % des gens
attendent d'un outil de ce genre.

À faire :

- **Import d'une image** (pochette, logo), stockée dans le projet.
- Une **couche pochette** : cadrage, coin arrondi, halo, réaction discrète au
  kick (2 à 4 % d'échelle, pas plus — une pochette qui pompe fait cheap).
- **Extraction de palette depuis l'image** : sur une version réduite à ~64×64,
  une quantification par médiane répétée ou un k-moyennes à graine fixe. Quelques
  dizaines de lignes, déterministe si la graine l'est. Extrêmement rentable en
  valeur perçue.
- Filet de sécurité : la palette extraite doit passer la garantie de contraste de
  §10.2. Si elle échoue, **corrige la luminance plutôt que de refuser** — une
  pochette sombre est un cas normal, pas une erreur.

C'est la seconde extension du `Renderer` autorisée : un `drawImage` cadré.
Contrainte Loi 1 : l'image doit être **décodée avant le rendu**, jamais pendant —
sinon l'export n'est plus déterministe.

### 7.6 Bibliothèque d'animations de texte

**Emprunté à CapCut**, dont c'est la vraie force.

Une fois la couche de texte écrite (§10.3), ce sont les animations qui font la
différence entre « du texte posé » et « un générique ». À prévoir : entrée mot par
mot, machine à écrire, révélation par masque, échelle avec dépassement, décalage
RVB, découpe en tranches. Et surtout : **chaque animation calée sur la grille
musicale**, pas sur une durée en secondes. C'est ce que CapCut ne sait pas faire.

### 7.7 « Looks » — les modèles en un clic

**Emprunté aux monteurs et aux visualiseurs.**

Un preset PULSAR ne décrit aujourd'hui que la réaction et les couleurs. Un
« Look » regrouperait tout ce qui fait une identité : style + variante de cadrage
+ palette + mise en page du texte + assignations de LFO + modes de fusion +
réglages de bloom. Un clic, un rendu complet et cohérent.

C'est le prolongement naturel du compositeur de couches (activer, désactiver et
réordonner les couches d'un style, sauvegarder comme preset personnel).

**Attention, l'ordre des couches n'est pas cosmétique** : `ScreenShake` doit être
dessinée **en premier** parce que son décalage n'affecte que ce qui vient après,
et `drawFeedback` aussi. L'éditeur doit empêcher les ordres invalides, ou au
minimum les signaler.

### 7.8 Marqueurs et correction manuelle de l'analyse

**Emprunté aux monteurs.**

L'analyse se trompera parfois : un downbeat décalé, un drop manqué, une section
mal découpée. Aujourd'hui l'utilisateur n'a aucun recours. Pouvoir déplacer une
frontière de section, marquer un drop à la main, ou décaler la grille d'un demi-
temps transforme un échec en réglage. Loi 3 le rend d'autant plus utile : les
morceaux à faible confiance sont exactement ceux qu'il faut pouvoir rattraper.

### 7.9 Le bouton « relancer » — quelques lignes, forte valeur

`projectSeed` existe déjà : généré aléatoirement, persisté dans le projet,
rejouable à l'identique (Loi 1). **Il n'est simplement pas exposé.** Un bouton qui
le retire donne une variation infinie sur le même style, le même preset et la
même musique. Affiche la graine et permets de la saisir pour retrouver un
résultat.

### 7.10 Variantes de cadrage

Chaque style expose 2 à 3 variantes : position du point d'intérêt, plan large ou
rapproché, sens de lecture. Le mode live le fait pour ses six scènes. Trois
variantes sur huit styles, c'est vingt-quatre images pour le coût de quelques
constantes.

Règle : **au plus une variante sur trois est centrée**, et chaque style expose au
moins une variante dont le point d'intérêt est hors centre, sur un point fort du
tiers.

### 7.11 Éditeur de réaction — « quel instrument fait quoi »

Le bloc `mapping` est la chose la plus puissante du format de preset, et il n'est
éditable qu'en JSON brut. Une interface qui présente, pour chaque instrument, ce
qu'il pilote et avec quelle force :

```
Caisse claire  →  [ révélation ▾ ]    force ▓▓▓▓▓▓░░░░   retour  0,35 temps
Charley        →  [ scintillement ▾ ] force ▓▓▓░░░░░░░   retour  0,18 temps
Kick           →  [ échelle ▾ ]       force ▓▓▓▓▓▓▓▓░░   retour  0,50 temps
Sub            →  [ caméra ▾ ]        force ▓▓▓▓░░░░░░
LFO 1          →  [ rotation ▾ ]      2 mesures, triangle
```

C'est **exactement** la richesse de choix recherchée, et ça devient possible dès
que §6.1 et §7.1 sont faits.

### 7.12 Deux options d'export peu coûteuses

- **Export en boucle** : dernière image identique à la première. Contrainte réelle
  sur les couches à état (feedback) — à documenter honnêtement si elle n'est pas
  tenable partout.
- **Export d'une image fixe** en pleine résolution à l'instant courant, pour une
  pochette ou une vignette. Presque gratuit, la chaîne existe déjà.

### 7.13 Ce que je NE recommande pas, et pourquoi

Par honnêteté, pour éviter qu'on y revienne :

- **Étalonnage complet par LUT.** En Canvas 2D, appliquer une table de
  correspondance par pixel exige `getImageData` à chaque image — explicitement
  interdit par `CLAUDE.md`. Des approximations par modes de fusion (§7.2) donnent
  80 % du résultat pour 1 % du coût. Un vrai étalonnage attendra WebGL.
- **Masquage par forme arbitraire.** Pas de `clip()` dans l'API, et l'ajouter
  casserait le budget de passes. Les révélations passent par des formes dessinées.
- **Transitions de style à la manière d'un monteur** (fondus, balayages entre deux
  rendus complets). Il faudrait rendre deux scènes simultanément, soit le double du
  budget. Le mode live le fait à 0,6× de résolution parce qu'il n'a pas à être
  déterministe ; en mode fichier, une coupe franche sur frontière de section est
  plus juste musicalement et infiniment moins chère.
- **Effets génératifs par IA.** Hors périmètre, hors budget, et incompatible avec
  la Loi 1.

---

## 8. LES CINQ NOUVEAUX STYLES

Trois existent : `pulse` (pop, R&B), `field` (trap, drill), `spectrum-pro`
(lofi). Cinq à créer — les **styles 4 à 8** annoncés par `docs/00b` §4. Chaque
conception est **exprimable dans l'API de §4**.

### `monolith` — trap, drill, phonk

**Le principe : la masse et le silence.** Presque immobile, puis violent.

Une masse géométrique sombre en fausse perspective occupe les deux tiers du
cadre, décentrée. Sur le **kick**, elle se fissure : une faille s'ouvre depuis un
point d'impact puis se referme sur 0,5 temps. Le **sub** pilote un lent
travelling latéral. La **caisse claire** fait basculer l'éclairage d'une face à
l'autre. Les **charleys** sont des étincelles le long des arêtes, plafonnées à
40 % de l'amplitude de la fissure.

Le contraste entre l'immobilité quasi totale et la violence de la fissure est ce
qui le rend impressionnant : la retenue crée l'impact.

*Primitives* : masse et lèvres de la faille en `fillPath` (couleur plate — le
volume vient du découpage en facettes de valeurs différentes). Lueur intérieure =
**sprite radial pré-rendu** placé par `drawSprite` le long de la faille à échelles
décroissantes. Perspective calculée en JS.

### `iso-pulse` — house, techno, garage

**Le principe : la régularité EST le plaisir.**

Grille isométrique de tuiles. Sur chaque **kick**, une onde de soulèvement se
propage en losange, chaque tuile se levant puis retombant avec un léger
dépassement ; plusieurs ondes coexistent et s'additionnent. La **caisse claire**
inverse la valeur d'une tuile sur deux en damier. Les **charleys** font scintiller
les arêtes hautes. Sur le **drop**, la grille bascule d'un quart de tour en une
demi-mesure.

*Primitives* : projection isométrique **en JS** (pas de `setTransform`), tuiles en
`fillPath`, regroupées par tranche de hauteur — **8 tranches, 8 `fillPath`**, pas
un par tuile.

### `chambre` — lofi, jazzhop, downtempo

**Le principe : la texture, pas l'impact.** Style « repos » du catalogue, il
laisse du budget aux autres.

Duotone chaud très doux. Poussières en suspension éclairées par un faisceau
oblique. Rayures de pellicule intermittentes. Respiration lente du vignettage sur
la phrase. Le **kick** ne produit qu'une inflexion de 2 % sur la luminosité du
faisceau — délibérément sous le seuil de conscience. La **caisse claire** décale
la teinte. Le **charley** module le grain.

*Primitives* : réutilise `AnimatedDuotone`. Poussières = **un seul sprite** placé
N fois. Rayures = `fillPath` fins. Faisceau = `fillPath` en trapèze ou sprite
étiré. Doit passer `prefers-reduced-motion` sans modification.

### `eclats` — drum & bass, jungle, breakbeat

> **Contrainte qui a changé la conception.** L'idée naturelle — briser l'image en
> éclats montrant chacun une portion **décalée dans le temps** — est
> **irréalisable** : `drawFeedback` redessine l'image précédente entière, et il
> n'y a ni `clip()` ni lecture de région. N'y repars pas.

Conception retenue, entièrement géométrique : partition de Voronoï **pré-calculée
une seule fois**. Sur chaque **caisse claire**, chaque cellule se décale de son
centre, tourne de quelques degrés et change de valeur, puis revient — les cellules
proches de l'impact bougent plus. Le **kick** fait respirer l'échelle globale. Le
**charley** fait vibrer les arêtes. Un léger `drawFeedback` laisse une rémanence.

*Primitives* : chaque cellule est un `fillPath` (sommets calculés une fois, puis
transformés) ; `drawFeedback` en début de trame.

### `aurore` — ambient, cinematic, chill

**Le principe : la lenteur assumée.** Le style qui prouve la Loi 3 : magnifique
**sans aucun onset**.

Des rubans de lumière larges et translucides ondulent en se chevauchant, ligne
médiane pilotée par du bruit simplex. Les **6 bandes de fréquence** pilotent
l'épaisseur locale — graves en bas, aigus en haut. Aucun onset ne déclenche quoi
que ce soit ; le seul événement toléré est le changement de section, qui fait
dériver les teintes.

*Primitives* : `fillPath` ne prend qu'une couleur plate, donc **le dégradé
s'empile** — 5 à 7 `fillPath` translucides de largeur décroissante autour de la
même médiane. Moins cher qu'un vrai dégradé, et meilleur en additif.

Le bruit simplex est **déjà écrit** dans `src/ui/live/util/noise.ts`, mais
`visual/` n'a pas le droit d'importer `ui/`. Le déplacer dans `src/core/`, ou en
écrire un jumeau. **Décide et justifie ; ne duplique pas par défaut.**

### Contraintes communes

- **Un instrument, un canal.** Kick, caisse claire, charley et sub pilotent des
  paramètres DIFFÉRENTS. Jamais deux enveloppes additionnées sur le même.
- **Un accent principal identifiable sur une capture figée.** Les autres réactions
  plafonnent à 40 % de son amplitude.
- **Beau sans onsets** (Loi 3).
- **Correct en 16:9, 9:16 et 1:1 sans code conditionnel** (Loi 4), et respectant
  `Viewport.safe` pour tout ce qui porte du sens (§7.4).
- **2 à 3 variantes de cadrage** (§7.10).
- **Interdit** : le spectre en barres alignées sur une ligne de base et rien
  d'autre ; l'anneau centré dont le seul paramètre animé est le volume ; la
  rotation de teinte arc-en-ciel pilotée par le temps.

---

## 9. TEXTE, COULEURS, PRESETS

### 9.1 Le bloc `layers` mort

Trancher (§5.3) : le brancher ou le retirer, avec justification écrite.

### 9.2 Couleurs

```ts
interface Palette {
  readonly id: string;
  readonly bg: readonly [Color, Color];
  readonly primary: Color; readonly secondary: Color;
  readonly accent: Color;  readonly glow: Color;
  readonly contrast: number;
  readonly temperature: (energy: number) => Color;
}
```

`Color` est `{ r, g, b, a }` en 0-255. À ajouter : éditeur des six couleurs, du
contraste et des deux couleurs de dérive, catalogue de palettes prêtes, et
l'extraction depuis la pochette (§7.5).

Le mode live a **8 palettes OKLCH** (`src/ui/live/render/Palette.ts` : `nocturne`,
`glacier`, `ember`, `amber`, `duotone-cyan-magenta`, `duotone-lime-violet`,
`graphite`, `pulsar`). **Regarde-les avant d'en inventer** : OKLCH interpole
perceptuellement, le RGB non — un dégradé RGB entre deux teintes passe par une
zone terne, un dégradé OKLCH non. Si tu portes cette conversion vers `visual/`,
dis pourquoi ; sinon dis pourquoi aussi. `contrastRatio` est dans
`src/ui/live/util/oklch.ts:146`.

**Garantie de contraste** : au moins **4:1** entre le fond et la couleur de plus
haute intensité. L'éditeur **avertit** quand un choix passe sous ce seuil — il
avertit, il n'interdit pas.

### 9.3 Texte

`docs/00b` §4 classait « texte/logo personnalisés » hors MVP — verrou levé en §0.

Deux décisions à prendre et justifier **avant** d'écrire :

1. **`LayerKind`** (`src/visual/scene/Layer.ts:12`) vaut
   `'background' | 'geometry' | 'waveform' | 'glow' | 'postfx' | 'field' |
   'particles' | 'spectrum'`. Ajouter `'text'`.
2. **Comment dessiner.** `Renderer.ts:56` annonce que `drawText` a toujours été
   prévu pour P12. Deux voies : ajouter `drawText` à l'interface, ou rastériser
   dans un sprite via `createSprite` (aucune extension, mais sprites carrés et une
   texture par changement de texte). **Recommandation : la seconde pour la
   première livraison.**

Ce que la couche doit offrir : texte multi-lignes ; mises en page (empilé centre,
bandeau bas, diagonale, très gros débordant du cadre, aligné sur un tiers) ;
animations de §7.6 ; choix de graisse et de casse ; respect de `Viewport.safe`.

Les deux pièges de la typographie sur canvas, **déjà résolus** dans
`src/ui/live/scenes/TypeSlamScene.ts` — lis-le avant d'écrire :

1. **`measureText` JAMAIS dans la boucle.** Il alloue un `TextMetrics` ET
   re-rastérise le glyphe à chaque appel. Rastériser **une fois**.
2. **Attendre `document.fonts.ready`** et précharger les graisses. Sinon le
   premier rendu utilise la police de repli, le buffer est mis en cache avec, et
   la vraie police n'apparaît jamais — le cache masque le problème.

**Côté mode live** : `LiveConfig.content.slamText` existe (défaut
`['LIVE', '{bpm}', '{palette}']`, avec substitution) mais **aucune interface ne
l'expose**. Expose-le.

### 9.4 Presets

Chaque genre pointe sur **son propre style**, et les presets des nouveaux genres
sont ajoutés — les **presets 6 à 11** de `docs/00b` §4. Chaque preset exploite les
onze signaux, pas cinq.

`src/export/ExportPipeline.ts` reçoit `createScene: () => Scene` et construit **sa
propre `Scene`**. Un style ajouté doit être atteignable par les deux chemins —
c'est exactement le trou découvert à l'Étape 25 pour les macros de couche.

---

## 10. INTERFACE ET PERFORMANCE

### 10.1 Interface

`index.html` fait 362 lignes avec tout le CSS dans un `<style>` en ligne.

- **Le catalogue des styles est écrit en dur** (lignes 253-257). Ajouter un style
  oblige à toucher `schema.ts` (`STYLE_IDS`), `App.ts` (`STYLE_FACTORIES`) **et**
  `index.html`. Le `<select>` doit se peupler depuis `STYLE_IDS`, comme
  `#preset-select` se peuple déjà depuis `PRESET_CATALOG` (`SimplePanel.ts:45`).
- **Des vignettes de style**, pas une liste déroulante.
- **Une vraie mise en page** : aperçu dominant, contrôles groupés par intention
  (Visuel / Couleurs / Texte / Réactivité / Export).
- **Le CSS sort du HTML**, avec des variables CSS pour le thème.
- **Retirer les résidus morts** d'`AdvancedPanel.ts` (lignes 31, 56, 65) et
  corriger l'en-tête périmé de `SimplePanel.ts`.
- **Régler le curseur Profondeur en `pulse`** : lui donner un effet, ou le griser
  avec une explication. Ne le laisse pas actif et sans effet.

**Aucune dépendance npm nouvelle.** Le projet a une dépendance de production
(`mediabunny`) et cinq de développement. Toute nouvelle dépendance exige un ADR
dans `docs/15_ADR.md`. Pas de framework CSS, pas de bibliothèque de composants,
pas de sélecteur de couleur tiers — `<input type="color">` est natif et suffit.

### 10.2 Budget de performance — chiffré

`CLAUDE.md` fixe : **16,0 ms par image en 1080p**, dont **`Scene.draw` ≤ 9 ms** et
**`Scene.update` ≤ 3 ms**.

```
❌ ctx.shadowBlur dans la boucle           → sprite pré-rendu + composite additif
❌ allocation dans update() ou draw()      → pools, Float32Array, objets pré-alloués
❌ `rgba(...)` construit par appel         → chaînes pré-calculées ou cache indexé
❌ .map()/.filter()/spread en chemin chaud → boucles for
❌ ctx.save()/restore() en boucle serrée   → transformations manuelles
❌ ctx.arc() par particule                 → drawSprite d'un sprite pré-rendu
❌ getImageData() à chaque image           → 32×18, une image sur deux
❌ gradient recréé par image               → mis en cache
```

---

## 11. ORDRE DE TRAVAIL

Un chantier par livraison. Ne commence pas le suivant sans validation d'Aaron.

**Les chantiers 2 et 3 comptent plus que tous les autres.** Ils transforment ce
qui existe déjà. Livrer cinq styles par-dessus un moteur qui jette la moitié de
ses signaux et ignore la structure du morceau serait bâtir sur du sable.

1. **Ouverture de phase et fondations.** Acter la levée du verrou MVP (§0),
   recopier ce document en `docs/17_PHASE2_VISUELS.md`. Résidus morts (§5.6), sort
   du bloc `layers` (§9.1), catalogue de styles peuplé dynamiquement (§10.1),
   `LayerKind` étendu à `'text'`. **Aucun visuel nouveau.** Livrable : portique
   vert, démonstration que rien n'a changé à l'écran.

2. **Réactivité complète, LFO et easings** (§6.1, §7.1, §6.3). Brancher `accent`,
   `tick`, `subImpact`, `sectionShift`, `tension`, `barPulse` dans les trois
   styles existants ; banque de 4 LFO verrouillés au tempo ; module d'easing
   partagé. Livrable : démonstration que changer le `mapping` d'un preset change
   l'image — critère 11 de §12, à atteindre **dès ce chantier**.

3. **Dramaturgie et caméra** (§6.2, §6.4). `VisualDirector` lisant `step.section`
   et `step.regime` ; caméra. Livrable : sur un morceau complet, montrer que
   l'intro, la montée, le drop et le breakdown produisent des images distinctes —
   captures aux quatre moments.

4. **Modes de fusion, variantes, zones sûres, graine** (§7.2, §7.10, §7.4, §7.9).
   Quatre changements peu coûteux à fort effet, tous sur l'existant.

5. **`monolith` et `iso-pulse`** (§8). Les deux plus éloignés de l'existant. 60 s
   par style sans erreur console ni croissance mémoire, `Scene.draw` et
   `Scene.update` mesurés et collés, captures à trois instants.

6. **`chambre`, `eclats`, `aurore`** (§8).

7. **Pochette et palette extraite** (§7.5). Import d'image, couche pochette,
   extraction de palette, filet de contraste.

8. **Texte et ses animations** (§9.3, §7.6), plus l'exposition de `slamText`.

9. **Couleurs, bloom par preset, presets réécrits** (§9.2, §6.5, §9.4).

10. **Interface, compositeur, éditeur de réaction, automatisation, marqueurs**
    (§10.1, §7.7, §7.11, §7.3, §7.8), plus les options d'export (§7.12).

Le chantier 10 est le plus gros ; s'il devient trop lourd, découpe-le et propose
le découpage avant de commencer.

À la fin de chaque chantier, rapport court dans `docs/JOURNAL.md` : ce qui est
fait, les mesures obtenues, les décisions prises, les points à valider à l'œil.

---

## 12. CRITÈRES D'ACCEPTATION

1. `npm run typecheck` sort 0. Aucun `any`, aucun `@ts-ignore` ajouté.
2. `npm test` : **au moins 794 tests**, tous verts. Chaque nouveau style a son
   test, sur le modèle de `tests/unit/createFieldStyle.test.ts`.
3. `npm run test:arch` vert. La règle qui te concerne :
   `visual/ → core, behaviour, music (types), render (interface)`, **jamais**
   `audio`, `analysis`, ni `ui`.
4. `npm run build` réussit.
5. **`exportDeterminism.test.ts` reste vert.** Le test qui casse en premier si une
   couche introduit du hasard non seedé ou un état par image (Loi 1). Il doit
   rester vert **avec** la pochette, les LFO et l'automatisation.
6. **Les onze signaux de `VisualSignals` sont lus par au moins une couche**, et un
   test le vérifie — sinon la régression reviendra silencieusement.
7. Chaque nouveau style tient **60 s sans exception console**, sans croissance de
   tas supérieure à 5 Mo, et dans le budget de §10.2 — **mesuré et collé**.
8. Chaque style reste correct en 16:9, 9:16 et 1:1 sans code conditionnel (Loi 4),
   et rien de porteur de sens ne tombe hors de `Viewport.safe` en vertical.
9. Chaque style reste regardable **sans aucun onset détecté** (Loi 3).
10. Chaque palette garantit le rapport de luminance de 4:1, **y compris celles
    extraites d'une pochette** (§7.5).
11. **Changer le `mapping` d'un preset change visiblement l'image**, et passer d'un
    preset à un autre change la géométrie, pas seulement les couleurs.
12. **Sur un morceau complet, l'intro, la montée, le drop et le breakdown donnent
    des images visiblement différentes.** À démontrer par capture.
13. **Le `FlashLimiter` ne se déclenche pas en permanence** sur les modes de fusion
    ajoutés (§7.2). Si un mode le déclenche sans arrêt, il est retiré de la liste
    proposée, et c'est écrit dans le journal.
14. `prefers-reduced-motion` : la liste des styles autorisés reste non vide et
    aucun d'eux ne stroboscope.

**À valider par Aaron, à l'œil**, écrit dans `docs/JOURNAL.md` : beauté et impact
de chaque style, justesse du genre associé, lisibilité du tempo son coupé, goût
sur les palettes, ergonomie de la nouvelle interface, et surtout **si le visuel
raconte quelque chose sur la durée d'un morceau entier**.

---

## 13. RÈGLES D'EXÉCUTION

Elles viennent de `CLAUDE.md` et restent intégralement en vigueur.

- **Ne supprime jamais un fichier.** `mkdir -p _corbeille/$(date +%Y%m%d)` puis
  `mv`, et liste dans ta réponse ce que tu as déplacé.
- **Commit de point de sauvegarde** avant toute opération irréversible.
- **Édits ciblés.** Pas de réécriture d'un fichier qui marche, pas de
  reformatage, pas de renommage, pas de refactorisation non demandée.
- **Une tâche = les fichiers annoncés au début.** Si un autre doit changer, tu le
  signales et tu demandes.
- **Tu ne déclares jamais faux.** Une fonctionnalité est « faite » uniquement si
  tu l'as exécutée et que tu colles la sortie réelle. Jamais « devrait
  fonctionner » ni « normalement ».
- **Si tu es bloqué, arrête-toi et demande.** Pas de contournement silencieux.
- Format de réponse : OBJECTIF (3 lignes max) / FICHIERS TOUCHÉS (avant d'écrire) /
  IMPLÉMENTATION / VÉRIFICATION (sortie réelle collée) / CRITÈRES (cochés ou non,
  avec la raison) / LIMITES CONNUES.

### Vérification au navigateur

```bash
npm run dev
```

puis `http://localhost:5174/`. Pour le mode live :
`http://localhost:5174/src/ui/live/testing/live-bench.html`, qui expose
`window.__liveBench` (`start`, `stop`, `step`, `stats`, `probe`, `capture`,
`soak`, `frametime`).

**Deux limites connues de l'environnement**, documentées dans
`src/ui/live/NOTES.md` : un onglet en arrière-plan ne reçoit aucun
`requestAnimationFrame` — mesuré, 0 trame en 1 000 ms — donc toute mesure de
temps de trame exige une fenêtre au premier plan ; et `start()` ne peut pas
reprendre l'`AudioContext` sans un vrai geste utilisateur, donc le banc reste en
état BOOT et les scènes rendent au repos.
