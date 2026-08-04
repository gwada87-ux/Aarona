# 00 — AUDIT CRITIQUE DU MASTER PROMPT

> Revue d'ingénierie du brief « PULSAR VISUALIZER ».
> Objectif : identifier ce qui est juste, ce qui est contradictoire, ce qui est techniquement faux,
> et surtout **ce qui manque et qui coûtera cher plus tard**.

---

## Verdict global

Le brief est **au-dessus de la moyenne de ce qu'on voit sur ce type de projet**. Points forts réels :

- séparation audio / analyse / musique / visuel / rendu / export explicitement demandée ;
- notion de **confiance de détection** présente (c'est rare, et c'est ce qui sépare un jouet d'un produit) ;
- refus des dépendances par habitude ;
- interface d'intégration future pensée dès le départ plutôt que bricolée après coup ;
- priorité affichée à la qualité plutôt qu'au nombre de fonctionnalités.

Mais il souffre de **4 défauts structurels** qui, non corrigés, mènent mécaniquement à une réécriture
au bout de 3 mois :

| # | Défaut structurel | Conséquence si non corrigé |
|---|---|---|
| **D1** | Le **déterminisme temporel** n'est jamais mentionné | La vidéo exportée ne ressemblera pas à la preview, et chaque `seek` fera diverger la scène. Réécriture du moteur de rendu. |
| **D2** | Le « MUSIC EVENT BUS » est décrit comme un **flux push** | Un bus push ne sait pas reculer dans le temps. Incompatible avec seek, scrub et export offline. |
| **D3** | Le **Mode B (PULSAR)** est traité comme un « plus tard » | On construit tout autour de l'analyse approximative d'un MP3, alors que la seule vraie supériorité concurrentielle du produit est de connaître la musique *exactement*. |
| **D4** | L'**export** est planifié en phase 12 sur 15 | Le plus gros risque technique du projet est validé en dernier. C'est l'inverse de ce qu'il faut faire. |

Le reste (22 points ci-dessous) va du bug de raisonnement au manque de garde-fou.

---

## A. Contradictions internes

### A1 — Canvas 2D imposé vs. exigences visuelles incompatibles

Le brief impose Canvas 2D comme moteur principal **et** demande : glow, profondeur, particules,
« visuellement impressionnant », export 1080p/4K.

Le piège n'est pas Canvas 2D en soi — c'est que la façon naïve de faire du glow en Canvas 2D
(`ctx.shadowBlur`) est **le tueur de performance n°1** de cette API : elle force un re-flou CPU par
primitive dessinée. Un développeur qui suit le brief à la lettre écrira `shadowBlur` et constatera
12 fps à 1080p, puis conclura à tort que « Canvas 2D ne peut pas ».

**Ce n'est pas une contradiction fatale, c'est une contrainte mal outillée.** Canvas 2D tient
largement le cahier des charges **à condition** d'appliquer trois techniques non mentionnées dans
le brief :

1. **glow = sprite pré-rendu** (un dégradé radial rendu une seule fois dans un canvas hors écran),
   puis `drawImage` avec `globalCompositeOperation = 'lighter'`. Coût : une copie de texture. Rendu :
   indiscernable d'un bloom additif. Jamais de `shadowBlur` dans la boucle de rendu.
2. **atlas de sprites** pour les particules, jamais `arc()` + `fill()` par particule.
3. **rendu en couches sur canvas hors écran** + composition finale, pour n'appliquer les effets
   coûteux qu'une fois par frame et non par objet.

→ Décision retenue : **Canvas 2D confirmé pour le MVP**, mais derrière une interface `Renderer`
abstraite, avec un **critère chiffré de bascule** vers WebGL2 documenté à l'avance (voir ADR-002).
On respecte la contrainte du brief tout en gardant la porte de sortie ouverte sans réécriture.

### A2 — « Analyse temps réel » et « analyse préalable » mises sur un pied d'égalité

Le brief (§7) les présente comme deux modes équivalents. Ils ne le sont pas.

`AnalyserNode` fournit un spectre du « maintenant », lissé, sans horodatage fiable, avec une
résolution temporelle floue. **Il est structurellement incapable** de produire un événement
`{ type: "KICK", time: 12.48, confidence: 0.91 }` : il ne sait pas ce qu'est 12.48.

Le fichier audio est connu **à l'avance**. Il n'y a donc aucune raison de deviner en temps réel ce
qu'on peut mesurer précisément avant lecture.

→ Décision : l'**analyse hors-ligne dans un Web Worker est le chemin principal et unique** pour tout
ce qui est événementiel (beats, kicks, sections, tempo). `AnalyserNode` est rétrogradé au rang de
**sonde décorative** (`RealtimeProbe`) : elle sert au micro-mouvement continu de la preview, jamais
à décider d'un événement. Cela simplifie le moteur et améliore la précision d'un ordre de grandeur.

### A3 — « 100 % local » vs. « commercialisable avec protection »

Le brief exige un fonctionnement entièrement local et un produit commercialisable, sans jamais
définir le modèle économique. Or les deux interagissent directement :

- un watermark posé côté client dans une application 100 % locale est **contournable par principe** ;
- une limitation de durée d'export l'est tout autant.

Ce n'est pas rédhibitoire (c'est le cas de la plupart des outils créatifs indépendants), mais il
faut le **décider consciemment** plutôt que le découvrir. Voir ADR-006.

### A4 — La liste finale de priorités est ambiguë

Le brief se termine par une liste de priorités dont le dernier élément est
« QUANTITÉ DE FONCTIONNALITÉS », sans négation. Lu littéralement, cela en fait une priorité comme
les autres. L'intention est manifestement l'inverse. À reformuler explicitement (corrigé dans le
prompt v2).

---

## B. Hypothèses techniques inexactes

### B1 — La détection des instruments dans un mixdown masterisé est présentée comme acquise

Le brief (§8) demande de détecter kick, snare, clap, hat, percussions, basse, **notes, mélodie,
accords** — sur un fichier stéréo mixé et masterisé. Il faut être honnête sur ce qui est réellement
atteignable sans modèle d'apprentissage lourd :

| Cible | Méthode viable | Fiabilité réaliste | Verdict MVP |
|---|---|---|---|
| Tempo / BPM | autocorrélation de la fonction d'onset + désambiguïsation harmonique | 90–97 % sur musique à grille | ✅ |
| Beats | beat-tracking par programmation dynamique | 85–95 % | ✅ |
| Downbeat / mesures | phase à 4 maximisant l'énergie grave | 70–85 % | ⚠️ avec confiance |
| Kick | onset 30–120 Hz, forte énergie | 85–95 % | ✅ |
| Snare / clap | onset 150–400 Hz + bruit 2–8 kHz + transitoire | 70–85 % | ⚠️ |
| Hat | onset > 6 kHz, décroissance courte | 75–90 % | ⚠️ confondu avec cymbales/percs |
| 808 / basse | contour de f0 sur signal passe-bas | 60–80 % | ⚠️ contour, pas notes |
| Sections | matrice d'auto-similarité + noyau de nouveauté | frontières oui, **noms non** | ⚠️ |
| **Notes / mélodie / accords** | transcription polyphonique | **non fiable sans modèle** | ❌ **hors périmètre Mode A** |

→ Le brief demande implicitement l'impossible sur la dernière ligne. Le prompt v2 le retire du
Mode A et le renvoie explicitement au **Mode B**, où l'information est exacte parce que PULSAR l'a
composée. C'est précisément là que se trouve la valeur du produit.

**Corollaire produit :** la seule façon d'avoir un visualizer *parfaitement* synchronisé n'est pas
d'analyser mieux — c'est de ne pas avoir à analyser. Le Mode B n'est pas une intégration future,
c'est **l'argument de vente**.

### B2 — Le piège tempo double/moitié n'est pas anticipé

L'erreur la plus fréquente de tout détecteur de BPM est de retourner 2× ou 0,5× le tempo réel
(une Trap à 70 BPM détectée à 140, une House à 128 détectée à 64). Ce n'est pas un bug de code, c'est
une **ambiguïté musicale réelle** que l'algorithme doit trancher avec une heuristique explicite
(plage de tempo préférentielle par genre, poids sur la périodicité de l'énergie grave). À traiter
comme un cas nominal, pas comme une régression.

### B3 — Le budget de latence de synchronisation n'est jamais chiffré

Le brief demande « la synchronisation » sans définir le seuil. La perception humaine tolère mal un
visuel **en avance** sur le son ; un visuel légèrement **en retard** passe mieux. Budget à imposer :

```
dérive visuel/audio :  cible ≤ 10 ms,  limite dure ≤ 20 ms,  jamais en avance
```

Cela oblige à compenser `AudioContext.outputLatency`, ce que le brief ne mentionne pas et qui vaut à
lui seul 20 à 60 ms de décalage sur un poste Bluetooth.

### B4 — Aucune limite mémoire

Le brief demande de tester des « fichiers longs » sans donner de plafond. Ordre de grandeur :

```
5 min, 48 kHz, stéréo, Float32 décodé ≈ 115 Mo
+ spectrogramme + pistes de features + pics de waveform ≈ 230–290 Mo
1 h de DJ set ≈ 1,4 Go décodé → refus nécessaire
```

→ Limite MVP à poser explicitement : **12 minutes**, avec message clair au-delà.

---

## C. Angles morts (le plus important)

### C1 — ⚠️ Risque juridique : les licences de code, pas seulement les API payantes

Le brief interdit les API externes payantes mais ne dit **rien des licences des bibliothèques**.
C'est un piège classique et coûteux sur ce domaine précis :

- **Essentia.js** — la meilleure bibliothèque d'analyse musicale du web — est sous **AGPLv3**. Elle
  exige une licence commerciale payante auprès de l'UPF pour tout produit propriétaire. L'intégrer
  « parce que c'est la référence » contamine juridiquement l'intégralité du produit.
- **ffmpeg.wasm** : les builds incluant x264 sont **GPL** (viral), ceux en LGPL n'ont pas les codecs
  utiles. Piège identique pour l'export.
- **Mediabunny** (muxing MP4/WebM sur WebCodecs) est en **MPL-2.0** : copyleft *par fichier*,
  parfaitement compatible avec un produit propriétaire tant qu'on ne modifie pas ses fichiers.

→ Règle à inscrire dans le prompt : **toute dépendance doit être MIT / BSD / Apache-2.0 / MPL-2.0.
Aucune dépendance GPL / AGPL, y compris transitive.** Corollaire : le DSP d'analyse est écrit
maison (≈ 900 lignes, entièrement maîtrisé, et c'est de toute façon le cœur de valeur du produit —
il ne doit pas être sous-traité à une dépendance).

### C2 — ⚠️ Sécurité photosensible : absent du brief, obligatoire sur un produit commercial

Un visualizer qui flashe sur le kick produit mécaniquement des séquences à risque pour les personnes
photosensibles. Le repère est **3 flashs par seconde maximum** (WCAG 2.3.1). À 140 BPM, un flash par
double-croche = 9,3 flashs/seconde. C'est un dépassement direct.

C'est à la fois :
- une protection juridique sur un produit vendu ;
- une contrainte de diffusion (les plateformes signalent ce type de contenu) ;
- **et un argument commercial** (« safe-for-platform »).

→ Ajout non négociable : un module **`FlashLimiter`** dans le pipeline de rendu, appliqué en dernier,
qui borne le delta de luminance moyenne par seconde, plus un mode « réduction des flashs » exposé à
l'utilisateur et **activé par défaut sur les presets à forte énergie**.

### C3 — Le comportement en cas d'échec de détection n'est pas défini

Que fait le visualizer sur un morceau de R&B live sans percussion nette, un lofi noyé, un ambient
sans grille ? Le brief demande de détecter, jamais de **dégrader proprement**.

→ Règle de conception : le moteur visuel a **deux régimes**, et bascule automatiquement selon la
confiance globale de la grille rythmique :

```
confiance tempo ≥ 0,6  →  régime ÉVÉNEMENTIEL  (impacts, coupes, accents sur la grille)
confiance tempo < 0,6  →  régime CONTINU       (mouvement piloté par les enveloppes d'énergie)
```

Un morceau non analysable doit rester **beau**, pas devenir immobile ou aléatoire. C'est ce qui
distingue un produit robuste d'une démo.

### C4 — L'indépendance à la résolution et au ratio n'est pas posée

Le brief demande des exports 16:9, 9:16 et 1:1. Si les scènes sont écrites en pixels (« cercle de
rayon 200 »), le passage en 9:16 casse toutes les compositions et il faudra ajuster 12 styles à la
main.

→ Contrainte architecturale à imposer dès la première ligne de scène : **toutes les scènes sont
composées dans un espace normalisé** (unité = plus petite dimension du viewport), avec une notion de
*safe area* et un mode de recadrage déclaré par couche (`cover` / `contain` / `stretch`). Coût si
posé au début : nul. Coût si posé après 12 styles : plusieurs semaines.

### C5 — Aucune vérité terrain pour mesurer la détection

Le brief demande de « vérifier la précision des événements » sur 11 genres. Sans fichiers annotés
manuellement, cette vérification est une impression subjective.

→ Livrable à ajouter : un **corpus de référence** (2 morceaux par genre) avec annotation manuelle des
beats et des sections, plus un petit outil interne de tap-tempo pour produire ces annotations, plus
une métrique automatisée (F-mesure avec tolérance ±70 ms, standard MIREX). Sans cela, « la détection
s'est améliorée » n'est pas une affirmation vérifiable.

### C6 — Aucun format de réponse imposé à l'exécutant

Le brief décrit magnifiquement *quoi* construire et jamais *comment livrer*. Sur un projet de cette
taille confié à une IA, l'absence de protocole de livraison produit invariablement : des milliers de
lignes non testées, des fonctionnalités annoncées comme faites qui ne compilent pas, et une dérive
d'architecture silencieuse.

→ Le prompt v2 ajoute un **protocole de phase strict** avec critères d'acceptation vérifiables et
interdiction explicite de déclarer une phase terminée sans preuve d'exécution.

### C7 — « Fluide », « professionnel », « impressionnant » ne sont pas testables

Aucun critère chiffré dans tout le brief. Cibles à inscrire :

```
Preview      1080p, 60 fps p95, sur un portable de référence (iGPU, 2021)
Sync         dérive ≤ 20 ms, jamais en avance sur l'audio
Analyse      ≤ 8 s pour un morceau de 4 min, avec progression affichée
Export       60 s de 1080p60 rendues en ≤ 120 s
Détection    F-mesure beats ≥ 0,85 sur le corpus interne
Mémoire      pic ≤ 700 Mo sur un fichier de 10 min
Bundle       ≤ 400 ko gzip hors polices
Démarrage    interface interactive en ≤ 1,5 s
```

---

## D. Sur-spécifications à couper (elles coûtent plus qu'elles ne rapportent)

| Demande du brief | Problème | Correction |
|---|---|---|
| **12 familles de styles visuels** | ~2–3 mois de travail visuel. Personne n'achète pour le nombre de styles ; on achète pour le rendu de la démo. | **3 styles excellents en MVP**, extension par la suite. |
| **11 presets par genre** dès le départ | Un preset n'a de sens qu'une fois le moteur de comportement stabilisé, sinon il faut tous les refaire. | **5 presets MVP** (Trap Dark, Drill, House, Lofi, R&B). |
| **3 niveaux d'UI** (Simple / Avancé / Expert) | Trois interfaces à concevoir, tester et maintenir pour un MVP. | **2 niveaux**. Le mode « Expert » = édition JSON du preset (coût : quasi nul, public : minuscule). |
| Timeline servant aussi au débogage | Mélange deux publics dans un composant. | Timeline produit **+** overlay de debug séparé, désactivable. |
| « largeur stéréo », « dynamique » dans le MVP | Peu d'impact visuel pour le coût. | Repoussé en V2. |

---

## E. Correction majeure de la méthode : l'ordre des phases

Le brief place l'export en phase 12 sur 15. **C'est le risque technique le plus élevé du projet**
(déterminisme, WebCodecs, muxing, performance), et il conditionne l'architecture entière du moteur
de rendu.

Règle d'ingénierie : **on attaque le risque maximal le plus tôt possible, sur le périmètre le plus
petit possible.**

→ Correction : un **spike d'export en phase 0**, avant même le moteur audio. Objectif : exporter
5 secondes de MP4 1080p60 d'un carré qui tourne, rendu image par image, hors temps réel, avec piste
audio muxée. Une journée de travail. Si ça marche, toute l'architecture de rendu est validée. Si ça
ne marche pas, on l'apprend au jour 2 et non au mois 4.

Même logique pour l'analyse : un spike de détection de beats sur un morceau réel en phase 1, avant
de construire quoi que ce soit de visuel.

---

## F. Correction majeure d'architecture : le bus d'événements

Le brief décrit (§9) un **MUSIC EVENT BUS** qui reçoit les événements du moteur audio et les
transmet au moteur visuel. C'est un modèle *push*, et il est incompatible avec trois exigences
posées ailleurs dans le même brief :

- le **seek** (un bus push ne sait pas revenir en arrière) ;
- le **scrub** de la timeline (il faudrait rejouer tous les événements passés) ;
- l'**export hors temps réel** (le rendu avance à 0,3× ou 3× la vitesse réelle).

→ Correction : la source de vérité n'est pas un flux, c'est une **structure de données indexée par le
temps** — la `MusicTimeline`, immuable, requêtable :

```ts
timeline.eventsBetween(t0, t1)      // recherche binaire, O(log n)
timeline.featureAt(t, "band.bass")  // interpolation de la courbe
timeline.sectionAt(t)
timeline.beatPhaseAt(t)             // position dans le temps courant, en fraction
```

Le « bus » devient un simple **dispatcher** placé en aval, qui compare la fenêtre `[t_précédent, t]`
et émet ce qui la traverse. Il consomme la timeline, il ne la produit pas. Conséquence : preview,
scrub et export utilisent **exactement le même code** et produisent **exactement le même résultat**.

C'est le point qui, à lui seul, sauve le projet d'une réécriture.

---

## G. Ce que le brief a raison de demander et qu'il ne faut surtout pas diluer

- la séparation stricte analyse / musique / comportement / rendu ;
- la **confiance** attachée à chaque détection ;
- le refus des animations aléatoires sans relation avec la musique ;
- l'interface d'intégration PULSAR définie avant l'intégration ;
- « chaque effet doit avoir une raison d'exister » — à garder comme critère de revue de code visuel.

---

## H. Synthèse des 12 corrections retenues

1. Rendu **déterministe et adressable par le temps** (`render(t)` est une fonction pure) — **fondamental**.
2. `MusicTimeline` requêtable en remplacement du bus push.
3. Architecture **Mode B (PULSAR) en premier**, Mode A comme estimateur remplissant le même contrat.
4. Spike d'export en phase 0, spike de détection en phase 1.
5. Analyse hors-ligne en Worker comme chemin unique pour l'événementiel ; `AnalyserNode` décoratif.
6. Interdiction des dépendances GPL/AGPL ; DSP d'analyse écrit maison.
7. `FlashLimiter` + mode réduction des flashs (sécurité photosensible).
8. Deux régimes visuels (événementiel / continu) selon la confiance rythmique.
9. Espace de composition normalisé, indépendant du ratio et de la résolution.
10. Périmètre MVP réduit : 3 styles, 5 presets, 2 niveaux d'UI.
11. Notes / accords / mélodie retirés du Mode A, réservés au Mode B.
12. Critères d'acceptation chiffrés + corpus annoté + protocole de livraison par phase.
