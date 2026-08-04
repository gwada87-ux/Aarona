# PULSAR VISUALIZER — Dossier de conception

Version 1.0 · Août 2026

---

## Comment lire ce dossier

**Pour comprendre les corrections apportées au brief initial** — commencer par `00_AUDIT_DU_PROMPT.md`.

**Pour coder avec Claude Code** — `00c_PROMPT_CODAGE.md`. Installer d'abord les garde-fous
(`.claude/settings.json`, `.claude/hooks/garde-fou.mjs`, `CLAUDE.md` à la racine), puis utiliser le
prompt d'ouverture de session de la partie 2.

**Pour cadrer une session de conception** — coller `00b_MASTER_PROMPT_V2.md` en ouverture.

**Pour reprendre le projet en tant que développeur** — lire dans l'ordre 01 → 02 → 03, puis le
document du domaine concerné.

**Pour brancher PULSAR** — `12_INTEGRATION_PULSAR.md` se suffit à lui-même.

---

## Index

| Document | Contenu |
|---|---|
| `00_AUDIT_DU_PROMPT.md` | Revue critique du brief : contradictions, hypothèses fausses, angles morts, 12 corrections retenues |
| `00b_MASTER_PROMPT_V2.md` | Prompt corrigé et resserré, à réutiliser à chaque session |
| `00c_PROMPT_CODAGE.md` | **Garde-fous de sécurité + prompts opérationnels** (codage, optimisation, débogage) |
| `01_VISION.md` | Produit, marché, positionnement, avantage concurrentiel |
| `02_ARCHITECTURE.md` | Couches, règles de dépendance, les cinq objets structurants, traitement du seek |
| `03_DATA_FLOW.md` | Les trois flux (ingestion, lecture, export), budgets, structures de données, mémoire |
| `04_AUDIO_ANALYSIS.md` | DSP bas niveau : STFT, bandes, features, onsets, normalisation |
| `05_MUSIC_INTELLIGENCE.md` | Tempo, beats, downbeats, classification, structure, régimes de dégradation |
| `06_EVENT_SYSTEM.md` | Timeline requêtable vs bus push, vocabulaire d'événements, dispatcher, anticipation |
| `07_VISUAL_ENGINE.md` | BehaviourEngine, scènes et couches, viewport normalisé, techniques Canvas 2D, les 3 styles |
| `08_PRESETS.md` | Presets comme profils de comportement, les 5 du MVP, macro-contrôles, adaptation automatique |
| `09_EXPORT.md` | Comparaison des stratégies, pipeline déterministe, formats, performance, modèle commercial |
| `10_PERFORMANCE.md` | Budgets par image, niveaux de qualité, QualityGovernor, règles d'écriture |
| `11_TESTING.md` | 5 niveaux de tests, corpus annoté, métriques F-mesure, tests golden, revue visuelle |
| `12_INTEGRATION_PULSAR.md` | **Spécification PMDI v1.0** — le contrat de données PULSAR ↔ Visualizer |
| `13_PROJECT_FORMAT.md` | Modèle de projet, diff de preset, graine, IndexedDB, `.pvproj`, migrations |
| `14_ROADMAP.md` | 18 phases (P0–P16 + P3bis), estimations, jalons, V2, V3, ce qu'il faut refuser |
| `15_ADR.md` | 10 décisions d'architecture avec contexte, options, motifs, conséquences |
| `16_STRUCTURE_ET_RISQUES.md` | Arborescence complète, registre des risques coté, points de contrôle |

---

## Sécurité de l'environnement de codage

Trois couches, dont deux mécaniques :

| Couche | Fichier | Nature |
|---|---|---|
| Permissions `deny` / `ask` | `.claude/settings.json` | mécanique, par préfixe de commande |
| Hook `PreToolUse` | `.claude/hooks/garde-fou.mjs` | mécanique, inspecte la commande complète |
| Règles permanentes | `CLAUDE.md` | contextuel — le modèle les lit, elles ne bloquent pas |

Ne jamais lancer avec `--dangerously-skip-permissions`. Vérifier `/permissions` et le mode « manuel »
à chaque session. Détails en `00c_PROMPT_CODAGE.md`.

---

## Les cinq lois du projet

1. **Le rendu est une fonction pure du temps.** `render(t)` produit la même image en preview,
   en scrub et en export.
2. **Le moteur visuel ne connaît que le `StepContext`.** Ni audio, ni fichier, ni analyseur.
3. **Toute détection porte une confiance,** et le visuel en tient compte.
4. **Les scènes sont composées dans un espace normalisé,** indépendant du ratio et de la résolution.
5. **La sécurité photosensible n'est pas négociable.**

---

## Décisions arrêtées

| Sujet | Décision |
|---|---|
| Langage / build | TypeScript strict + Vite, sans framework UI |
| Rendu | Canvas 2D derrière une interface `Renderer` ; WebGL2 en V2 sous critère chiffré |
| Analyse | Hors-ligne, en Web Worker, DSP écrit maison |
| Source de vérité | `MusicTimeline` immuable et requêtable, pas de bus push |
| Export | WebCodecs + Mediabunny (MPL-2.0), `MediaRecorder` en repli |
| Licences | MIT / BSD / Apache-2.0 / MPL-2.0 uniquement — **aucune GPL ni AGPL** |
| Intégration | PMDI v1.0, contrat JSON versionné et tolérant à l'inconnu |

---

## Chiffres clés

```
MVP                85 jours-homme  ≈ 17 semaines à temps plein  (21–24 avec marge)
Premier tour complet (M2)   jour 38   ← premier test de marché
Styles MVP         3        Presets MVP  5
Preview            1080p · 60 fps p95
Sync               ≤ 20 ms, jamais en avance
Analyse            ≤ 8 s pour 4 min
Export             60 s de 1080p60 en ≤ 120 s
F-mesure beats     ≥ 0,85
```
