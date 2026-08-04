# 00c — PROMPT DE CODAGE & GARDE-FOUS

> Pour travailler avec Claude Code (Sonnet) sur ce projet, sans dérive, sans casse, sans erreur
> silencieuse.

---

## Partie 1 — Mettre en place les protections MÉCANIQUES (à faire une fois)

**À comprendre avant tout le reste :** un fichier d'instructions comme `CLAUDE.md` est du **contexte**,
pas une barrière. Le modèle le lit et en tient compte, mais rien ne l'empêche physiquement d'agir
autrement s'il se trompe. Les seules protections réellement contraignantes sont les **permissions** et
les **hooks**. C'est pourquoi ce projet en installe trois couches.

```
Couche 1  permissions deny     refuse par préfixe de commande        │ mécanique
Couche 2  hook PreToolUse      inspecte la commande complète         │ mécanique
Couche 3  CLAUDE.md            explique pourquoi, et quoi faire      │ contextuel
```

### Fichiers livrés

```
.claude/settings.json          permissions allow / deny / ask + déclaration du hook
.claude/hooks/garde-fou.mjs    hook Node qui bloque en dur (exit 2)
CLAUDE.md                      règles permanentes, chargées à chaque session
```

Le hook est déjà testé : 14 cas sur 14 (`rm -rf /`, `rm` en commande composée, `sudo`,
`curl | bash`, `git reset --hard`, install globale, chemin hors projet, accès aux secrets…) bloquent
correctement, et les commandes légitimes (`tsc`, `vitest`, `git commit`, `mv` vers `_corbeille/`)
passent.

### Vérifier que c'est actif, à chaque début de session

```
/status         → les sources de configuration chargées
/permissions    → les règles allow / deny / ask effectives
```

Dans la barre d'état, le mode affiché doit être **manuel** (`⏸`). Si tu vois « bypass permissions »,
arrête et redémarre : dans ce mode, **rien ne protège plus**.

### Les trois règles d'or côté utilisateur

1. **Ne lance jamais Claude Code avec `--dangerously-skip-permissions`.** C'est très probablement
   l'origine de l'incident passé : dans ce mode, aucune permission n'est demandée et aucune règle
   `deny` n'est appliquée.
2. **Ouvre chaque session en mode plan** (`Shift+Tab` jusqu'à « plan mode ») pour les tâches
   importantes. Le modèle explore et propose, tu valides, puis seulement il écrit.
3. **Lis les commandes Bash avant d'approuver.** C'est le seul moment où un humain regarde. Une
   commande que tu ne comprends pas est une commande que tu refuses.

### En cas de faux positif du hook

Le hook est volontairement **trop prudent** : il bloque `echo "rm" > note.txt` alors que c'est
inoffensif. C'est le bon sens du compromis. Si une commande légitime est bloquée, tu commentes
temporairement la ligne de motif concernée dans `garde-fou.mjs`, tu exécutes, tu la remets. Tu ne
désactives jamais le hook entier.

### Filet de sécurité supplémentaire, gratuit

```bash
git init && git add -A && git commit -m "état initial"
```

Un dépôt git dans le projet transforme presque toute erreur en `git diff` puis en annulation. C'est
la meilleure protection existante, et elle ne coûte rien.

---

## Partie 2 — Le prompt d'ouverture de session

À coller au début de chaque session de codage. `CLAUDE.md` étant chargé automatiquement, ce prompt
n'a pas besoin de répéter les règles : il déclare le **périmètre du jour**.

```
PULSAR VISUALIZER — Session de codage

Contexte : lis d'abord CLAUDE.md, puis docs/00b_MASTER_PROMPT_V2.md, puis le ou les
documents de docs/ correspondant à la phase du jour. Ne lis pas tout le dossier.

Phase du jour : P<n> — <titre>
Objectif : <une phrase>
Critères d'acceptation : ceux listés dans docs/14_ROADMAP.md pour cette phase.

Procédure imposée, dans cet ordre :

1. INVENTAIRE
   Liste ce qui existe déjà et qui est concerné. Ne modifie rien à ce stade.

2. PLAN
   Liste les fichiers que tu vas créer ou modifier, avec en une ligne ce que chacun fait.
   Attends ma validation avant d'écrire quoi que ce soit.

3. IMPLÉMENTATION
   Un fichier à la fois. Éditions ciblées. Aucune réécriture d'un fichier qui fonctionne.
   Aucun fichier hors de la liste validée.

4. VÉRIFICATION
   Exécute npx tsc --noEmit et les tests concernés. COLLE la sortie réelle.
   Une affirmation sans sortie exécutée ne compte pas.

5. RAPPORT
   - critères d'acceptation : cochés ou non, avec la raison
   - limites connues : listées, même celles qui te gênent
   - dette introduite : listée
   - ce que tu proposes pour la suite

Interdits pour cette session :
- toucher un fichier hors de la liste validée en étape 2
- ajouter une dépendance (ouvre un ADR et attends)
- refactoriser du code qui fonctionne
- ajouter une fonctionnalité hors du MVP défini en docs/00b §4
- écrire « devrait fonctionner », « normalement », « je pense que »
- passer à la suite avec une erreur connue non documentée

Si tu es bloqué : arrête-toi et explique. Ne contourne pas, ne réinitialise pas,
ne repars pas de zéro.

Commence par l'étape 1.
```

---

## Partie 3 — Prompt spécialisé : optimisation des performances

À utiliser en phase P14, ou dès qu'une mesure sort du budget. **Jamais avant d'avoir mesuré** :
optimiser sans profil, c'est deviner.

```
PULSAR VISUALIZER — Session d'optimisation

Règle absolue : on ne modifie que ce qu'on a mesuré. Pas de micro-optimisation à l'aveugle,
pas de réécriture "parce que ce serait plus rapide".

ÉTAPE 1 — MESURER (aucune modification de code autorisée)
  a. Lance la scène de référence : style Field, qualité HIGH, 1080p, 60 secondes.
  b. Relève : p50, p95 et p99 du temps d'image ; répartition update / draw /
     FlashLimiter / présentation.
  c. Relève le nombre d'allocations par image (profileur mémoire, onglet Allocation
     sampling) et le nombre de passages du ramasse-miettes sur 60 secondes.
  d. COLLE ces chiffres. Tant qu'ils ne sont pas là, on ne code pas.

ÉTAPE 2 — CLASSER
  Range les dépassements par coût réel décroissant. Pour chaque poste, dis à quel
  budget de docs/10_PERFORMANCE.md il devrait se tenir et de combien il dépasse.
  Ne traite que les trois premiers.

ÉTAPE 3 — CORRIGER, UN POSTE À LA FOIS
  Pour chaque poste :
    - explique la cause en une phrase (pas "c'est lent", mais "3 000 appels à
      ctx.arc() par image")
    - applique UNE correction
    - re-mesure
    - COLLE l'avant / après
    - si le gain est inférieur à 10 %, ANNULE la modification et passe au suivant
      (une optimisation qui complexifie sans gagner est une régression de
      maintenabilité)

Ordre de traitement imposé, du plus rentable au moins rentable :
  1. allocations dans la boucle (cause n°1 des saccades : un GC coûte 8 à 30 ms)
  2. shadowBlur ou tout flou par primitive        → sprite pré-rendu additif
  3. appels de dessin par objet                   → drawSprite instancié sur un atlas
  4. post-traitement à pleine résolution          → 1/4 de résolution
  5. recalculs invariants dans la boucle          → mise en cache, invalidation ciblée
  6. save()/restore() en boucle serrée            → transformations manuelles
  7. objets hors safe area                        → culling

INTERDITS pendant une session d'optimisation :
  - changer un comportement visuel (une optimisation qui change l'image est un bug)
  - casser le déterminisme : le test golden doit passer À CHAQUE étape, tu le relances
  - toucher au moteur d'analyse (il tourne hors ligne, il n'est pas dans le budget d'image)
  - introduire un cache sans stratégie d'invalidation écrite
  - remplacer Canvas 2D par WebGL2 : c'est une décision d'ADR, pas une optimisation

CRITÈRE DE SORTIE :
  60 fps p95 en 1080p sur la scène de référence, test golden vert, et zéro allocation
  détectée dans update() et draw() au profileur.
```

---

## Partie 4 — Prompt spécialisé : correction d'un bug

```
PULSAR VISUALIZER — Session de débogage

N'écris aucun correctif avant d'avoir terminé l'étape 3.

1. REPRODUIRE
   Donne la séquence exacte qui produit le bug. Si tu ne sais pas la reproduire,
   dis-le : on cherche d'abord la reproduction, pas la cause.

2. ISOLER
   Réduis au plus petit cas qui échoue encore. Écris-le comme un test qui échoue.

3. DIAGNOSTIQUER
   Explique la cause RACINE en trois phrases. Pas le symptôme.
   Si tu hésites entre deux causes, dis-le et propose comment trancher.

4. CORRIGER
   La plus petite modification qui traite la cause. Pas de refactor à l'occasion.

5. PROUVER
   Le test de l'étape 2 passe. Les autres tests passent. Le test golden passe.
   COLLE les sorties.

6. REGARDER AUTOUR
   Le même défaut existe-t-il ailleurs dans le code ? Cite les endroits, ne les
   corrige pas encore.

Si après deux tentatives le bug résiste : ARRÊTE. Résume ce que tu as éliminé et
ce qui reste comme hypothèses. Ne tente pas une troisième variante au hasard.
```

---

## Partie 5 — Les signaux qui doivent te faire arrêter la session

Ils sont fiables. Quand tu en vois un, tu interromps et tu relis.

| Signal | Ce qu'il veut dire |
|---|---|
| « J'ai aussi amélioré/nettoyé/refactorisé au passage » | dérive de périmètre — annule et recadre |
| Un fichier non annoncé apparaît dans les modifications | dérive de périmètre |
| « Cela devrait fonctionner » sans sortie exécutée | non vérifié, donc probablement faux |
| Une fonctionnalité déclarée faite sans preuve | à re-tester intégralement |
| Une réécriture complète d'un fichier qui marchait | perte de travail, régressions cachées |
| Une nouvelle dépendance sans ADR | risque de licence et de poids |
| Une commande Bash que tu ne comprends pas | tu refuses, tu demandes l'explication |
| Le hook bloque et le modèle tente une autre formulation | **grave** — arrête immédiatement la session |
| Le mode affiché n'est plus « manuel » | arrête et redémarre |
| Plus de 15 tours d'édition dans la même conversation | ouvre une session fraîche avec un résumé |

Le huitième mérite d'être détaillé : un modèle qui, après un blocage, essaie une **formulation
différente pour la même action** a cessé de suivre les règles et cherche à atteindre son objectif.
C'est exactement le comportement qui produit un incident. Dans ce cas, on n'ajuste pas le prompt : on
ferme la session.

---

## Partie 6 — Rituel de fin de session

```
1. npx tsc --noEmit                       → 0 erreur
2. npm run test                           → tout vert
3. npm run test:golden                    → déterminisme intact
4. git status                             → aucun fichier inattendu
5. git diff --stat                        → l'ampleur correspond-elle à ce qui était annoncé ?
6. git commit -m "P<n> : <ce qui est fait>"
7. mise à jour du document docs/ concerné
8. ls _corbeille/                         → quelque chose y a-t-il été déplacé ? à vérifier
```

L'étape 5 est celle qu'on saute et qu'il ne faut pas sauter. Un `git diff --stat` qui annonce
40 fichiers modifiés alors que le plan en prévoyait 4 est le signal le plus clair qu'il existe.

---

## Partie 7 — Ordre de démarrage recommandé

```
Jour 1        Garde-fous · git init · npm create vite · P0 spike d'export complet
              (MP4 1080p60 rendu image par image, audio muxé, lisible dans VLC)
Jour 2 matin  P1a : outil de tap-tempo + annotation de 3 morceaux
Jour 2–4      P1b : STFT + flux spectral + autocorrélation
              → PREMIER livrable de P1b : le TEST DE DIRAC (docs/04)
Fin jour 4    jalon M1 : les deux risques majeurs sont levés
```

Ne commence pas par l'interface. Ne commence pas par les styles visuels. Ils sont plus agréables à
écrire et ils ne lèvent aucun risque — c'est exactement pour ça qu'il faut résister.

---

## Partie 8 — Que donner à chaque session

### La règle en une ligne

> **Tu ne colles jamais les documents. Tu dis lesquels lire.**

Les fichiers sont dans le dépôt. Claude Code les ouvre lui-même, quand il en a besoin. Coller un
document dans le chat le duplique dans le contexte sans rien apporter.

### Une session = une phase

| ❌ Ne fais pas ça | ✅ Fais ça |
|---|---|
| Donner les 20 documents en début de session | Nommer les 2 ou 3 documents de la phase |
| Enchaîner P4, P5 et P6 dans la même conversation | Une conversation par phase, `git commit` entre les deux |
| Recoller `CLAUDE.md` | Il est chargé automatiquement, à chaque fois |
| Recoller `00b_MASTER_PROMPT_V2.md` en entier | Le citer : « relis `docs/00b` §4 » |

**Pourquoi ce n'est pas une question de coût mais de qualité.** Le dossier complet fait environ
250 ko, soit à peu près 65 000 tokens. Chargé d'un bloc, il occupe une part énorme du contexte, et
les instructions qui comptent vraiment — celles de ta phase — se retrouvent noyées au milieu de
19 documents dont 17 sont hors sujet. Un modèle avec 3 documents pertinents suit mieux les consignes
qu'un modèle avec 20 documents dont il doit deviner lesquels s'appliquent.

Même logique pour la longueur de conversation : après une quinzaine de tours d'édition, l'historique
contient surtout des essais, des sorties de tests et du code déjà remplacé. Tu ouvres une session
neuve avec un résumé court — la qualité remonte immédiatement.

### Quels documents pour quelle phase

`CLAUDE.md` est toujours là sans que tu aies à le demander. Ajoute uniquement :

| Phase | Documents à faire lire |
|---|---|
| **P0** spike d'export | `09_EXPORT` · `02_ARCHITECTURE` (§Renderer) |
| **P1** annotation + détection | `04_AUDIO_ANALYSIS` · `11_TESTING` (§vérité terrain) |
| **P2** fondations | `02_ARCHITECTURE` · `16_STRUCTURE_ET_RISQUES` |
| **P3** audio + Transport | `03_DATA_FLOW` (§horloge, §dérive) · `02` (§Transport) |
| **P3bis** types PMDI | `12_INTEGRATION_PULSAR` |
| **P4** pipeline d'analyse | `04_AUDIO_ANALYSIS` · `05_MUSIC_INTELLIGENCE` · `03` (flux 1) |
| **P5** timeline + StepContext | `06_EVENT_SYSTEM` · `02` (§5 objets) · `12` |
| **P6** BehaviourEngine | `07_VISUAL_ENGINE` (§BehaviourEngine) · `06` |
| **P7** scène + style Pulse | `07_VISUAL_ENGINE` · `02` (§Layer, §seek) · `10_PERFORMANCE` |
| **P8** export production | `09_EXPORT` · `03` (flux 3) · `10` |
| **P9** styles Field + Spectrum | `07_VISUAL_ENGINE` · `10_PERFORMANCE` |
| **P10** classification + structure | `05_MUSIC_INTELLIGENCE` · `04` · `11` |
| **P11** presets et macros | `08_PRESETS` · `07` |
| **P12** interface + timeline | `07` · `08` · `01_VISION` |
| **P13** projet et persistance | `13_PROJECT_FORMAT` · `12` |
| **P14** performance | `10_PERFORMANCE` · `07` · partie 3 de ce document |
| **P15** tests | `11_TESTING` · `16` |
| **P16** finition | `01_VISION` · `09` |

Jamais plus de trois. Si tu hésites, donne-en deux : il demandera le troisième s'il en a besoin.

### Le passage d'une phase à la suivante

En fin de session, tu demandes :

```
Écris dans docs/JOURNAL.md une entrée de 10 lignes maximum pour cette phase :
- ce qui est fait et vérifié
- ce qui est fait mais non vérifié
- les limites connues et la dette introduite
- ce qui bloque la phase suivante
```

Puis `git commit`, puis **nouvelle conversation**. La session suivante commence par :

```
Lis docs/JOURNAL.md (dernière entrée), puis docs/<les 2-3 documents de la phase>.
Phase du jour : P<n> — <titre>.
[la procédure de la partie 2]
```

`JOURNAL.md` remplace l'historique de conversation, en 10 lignes au lieu de 40 000 tokens. C'est ce
qui permet d'enchaîner 18 phases sans jamais traîner le passé.

### Cas particuliers

- **Un bug qui traverse plusieurs domaines** → donne les documents des domaines concernés, mais
  utilise le prompt de débogage (partie 4), pas celui de codage.
- **Une décision d'architecture à prendre** → `15_ADR` seul, et demande un ADR en sortie.
- **Tu ne sais pas quoi donner** → `docs/README.md` seul : c'est l'index, il ira chercher le reste.
