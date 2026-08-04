# 00a — ORDRE DES ÉTAPES

> ⚠️ **Les numéros des fichiers ne sont PAS l'ordre du travail.**
> Les fichiers sont numérotés par **sujet** (`09` = export, `08` = presets…).
> Les étapes, elles, se suivent de 1 à 18 dans ce tableau.
> Tu descends ce document ligne par ligne. Tu ne suis jamais l'ordre des numéros de fichiers.

---

## Avant de commencer (une seule fois)

1. Lire `01_VISION.md` — 5 minutes, pour savoir où tu vas.
2. Ouvrir `00c_PROMPT_CODAGE.md`, **partie 1** → déposer `CLAUDE.md`, `.claude/settings.json` et
   `.claude/hooks/garde-fou.mjs` dans le projet, puis faire `git init`.
3. Garder `00c_PROMPT_CODAGE.md` ouvert : c'est là que tu copies le texte de procédure.

---

## Les 18 étapes

Pour chaque étape : tu copies le bloc, tu le colles dans une **nouvelle conversation**, puis tu
ajoutes en dessous le texte de la **partie 2 de `00c_PROMPT_CODAGE.md`**.

---

### Étape 1 — Fabriquer une vidéo, même moche

Vérifier qu'on sait produire un fichier MP4 depuis le navigateur. C'est le plus gros risque du
projet : si ça ne marche pas, tout le reste change.

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/09_EXPORT.md.
Phase du jour : P0 — prototype d'export vidéo.
```

### Étape 2 — Vérifier qu'on sait détecter les beats

Un premier essai de détection sur trois vrais morceaux, comparé à des repères posés à la main.
Deuxième plus gros risque du projet.

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/04_AUDIO_ANALYSIS.md.
Phase du jour : P1 — outil d'annotation, puis prototype de détection.
```

### Étape 3 — Poser les fondations du code

Installer TypeScript, Vite, les tests, et la structure des dossiers.

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/02_ARCHITECTURE.md.
Phase du jour : P2 — fondations du projet.
```

### Étape 4 — Lire un fichier audio

Charger, jouer, mettre en pause, se déplacer dans le morceau, et garder l'horloge précise.

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/03_DATA_FLOW.md.
Phase du jour : P3 — moteur audio et horloge.
```

### Étape 5 — Définir le format d'échange avec PULSAR

Les types de données et leur vérificateur. Court, mais nécessaire avant l'étape suivante.

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/12_INTEGRATION_PULSAR.md.
Phase du jour : P3bis — types et validateur PMDI.
```

### Étape 6 — Analyser la musique

Le gros morceau : tempo, beats, temps forts, énergie, fréquences. Tout en tâche de fond.

```
Lis docs/00b_MASTER_PROMPT_V2.md, docs/04_AUDIO_ANALYSIS.md et docs/05_MUSIC_INTELLIGENCE.md.
Phase du jour : P4 — pipeline d'analyse audio.
```

### Étape 7 — Ranger les événements musicaux sur une frise

La structure qui dit « à 12,48 s il y a un kick ». C'est le cœur du système.

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/06_EVENT_SYSTEM.md.
Phase du jour : P5 — MusicTimeline et StepContext.
```

### Étape 8 — Transformer la musique en mouvement

Le module qui convertit « kick à telle seconde » en « impulsion visuelle de 0,84 ».

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/07_VISUAL_ENGINE.md.
Phase du jour : P6 — BehaviourEngine.
```

### Étape 9 — Premier visuel à l'écran

Le système de couches, et le premier style complet (« Pulse »).

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/07_VISUAL_ENGINE.md.
Phase du jour : P7 — scènes, couches et style Pulse.
```

### Étape 10 — Export vidéo pour de vrai

On reprend le prototype de l'étape 1 et on le finit : formats 16:9, 9:16, 1:1, audio, qualité.

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/09_EXPORT.md.
Phase du jour : P8 — export vidéo de production.
```

> 🎉 **À la fin de cette étape, le produit fait le tour complet : un MP3 devient une vidéo.**
> C'est le moment de le montrer à des beatmakers avant d'aller plus loin.

### Étape 11 — Les deux autres styles visuels

« Field » (particules) et « Spectrum Pro » (spectre soigné).

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/07_VISUAL_ENGINE.md.
Phase du jour : P9 — styles Field et Spectrum Pro.
```

### Étape 12 — Reconnaître les instruments et la structure

Distinguer kick, snare, hat. Repérer les couplets, les drops, les breaks.

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/05_MUSIC_INTELLIGENCE.md.
Phase du jour : P10 — classification et structure du morceau.
```

### Étape 13 — Les presets par genre

Trap Dark, Drill, House, Lofi, R&B, et les 8 réglages simples.

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/08_PRESETS.md.
Phase du jour : P11 — presets par genre et macro-contrôles.
```

### Étape 14 — L'interface

L'écran, les boutons, la frise de lecture, le plein écran.

```
Lis docs/00b_MASTER_PROMPT_V2.md, docs/08_PRESETS.md et docs/01_VISION.md.
Phase du jour : P12 — interface utilisateur et timeline.
```

### Étape 15 — Sauvegarder les projets

Retrouver son travail en rouvrant l'application, et exporter un fichier de projet.

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/13_PROJECT_FORMAT.md.
Phase du jour : P13 — projets et sauvegarde.
```

### Étape 16 — Rendre tout ça fluide

Mesurer, optimiser, ajouter les niveaux de qualité automatiques.

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/10_PERFORMANCE.md.
Phase du jour : P14 — performance.
```

### Étape 17 — Tester sérieusement

Le corpus de 22 morceaux, les mesures de précision, les navigateurs.

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/11_TESTING.md.
Phase du jour : P15 — tests et durcissement.
```

### Étape 18 — Finition

Écran d'accueil, morceau de démonstration, textes, mise en ligne.

```
Lis docs/00b_MASTER_PROMPT_V2.md et docs/01_VISION.md.
Phase du jour : P16 — finition et mise en ligne.
```

---

## Entre chaque étape, toujours la même chose

```
1. « Écris dans docs/JOURNAL.md une entrée de 10 lignes pour cette phase. »
2. git commit
3. NOUVELLE conversation pour l'étape suivante
```

---

## Les fichiers qu'on ne donne jamais dans le chat

| Fichier | Pourquoi |
|---|---|
| `00_AUDIT_DU_PROMPT.md` | lecture pour toi, une seule fois |
| `00a_ORDRE_DES_ETAPES.md` | ce document, pour toi |
| `00c_PROMPT_CODAGE.md` | ton mode d'emploi, tu y copies le texte de procédure |
| `CLAUDE.md` | déposé dans le projet, lu automatiquement à chaque session |
| `.claude/settings.json` et `garde-fou.mjs` | déposés dans le projet, appliqués par le logiciel |
| `README.md`, `14_ROADMAP.md`, `15_ADR.md`, `16_STRUCTURE_ET_RISQUES.md` | documents de référence, à consulter si besoin |

---

## Pourquoi certains fichiers reviennent deux fois

Un fichier couvre un **sujet**. Un sujet peut se travailler en deux passes : le prototype d'abord,
la version finie plus tard.

| Fichier | Étapes |
|---|---|
| `09_EXPORT.md` | 1 (prototype) et 10 (version finie) |
| `04_AUDIO_ANALYSIS.md` | 2 (prototype) et 6 (version finie) |
| `05_MUSIC_INTELLIGENCE.md` | 6 et 12 |
| `07_VISUAL_ENGINE.md` | 8, 9 et 11 |
| `08_PRESETS.md` | 13 et 14 |
| `01_VISION.md` | 14 et 18 |

## Pourquoi l'export est en premier alors qu'il porte le numéro 09

C'est le plus gros risque technique du projet. Si produire une vidéo ne marche pas, toute
l'architecture change. Autant le découvrir au premier jour plutôt qu'au quatrième mois.

C'est le seul endroit où l'ordre paraît illogique, et c'est volontaire.
