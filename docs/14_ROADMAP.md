# 14 — FEUILLE DE ROUTE

## Principe d'ordonnancement : le risque d'abord

Le brief initial plaçait l'export en phase 12 sur 15. C'est le plus gros risque technique du projet,
et il **conditionne l'architecture entière du moteur de rendu**. Le découvrir au mois 4 imposerait
une réécriture.

> Règle : on attaque le risque maximal le plus tôt possible, sur le périmètre le plus petit possible.

Les deux premières phases sont donc des **spikes jetables**. Leur seul rôle est de transformer deux
inconnues en certitudes avant que quoi que ce soit ne soit figé.

---

## Phases

Estimations pour **un développeur à temps plein**.

### P0 — Spike d'export · 1 jour · 🔴 risque maximal

Exporter 5 secondes de MP4 1080p60 d'un carré qui tourne, rendu **image par image, hors temps réel**,
avec piste audio muxée.

```
✓ WebCodecs disponible et configurable en H.264
✓ Mediabunny produit un MP4 lisible par VLC, QuickTime et un navigateur
✓ le rendu hors temps réel fonctionne (aucun rAF)
✓ audio et vidéo restent synchronisés sur 5 secondes
```

**Si ce spike échoue, tout le plan change.** C'est pourquoi il est en premier.

### P1 — Outil d'annotation + spike de détection · 3 jours · 🔴 risque élevé

**P1a (0,5 j)** — `tools/annotate/` : tap-tempo au clavier avec correction de la latence d'entrée.
Annoter 3 morceaux (Trap, House, Lofi). Sans vérité terrain, « comparer à une annotation manuelle »
n'est pas une phrase exécutable — et le corpus est exigé dès ce spike, puis en P4 et P10.

**P1b (2,5 j)** — STFT + flux spectral + autocorrélation sur ces trois morceaux.

Premier livrable de code de production, avant tout : le **test de la convention d'horodatage**
(impulsion de Dirac à `t` connu → onset à ±2 ms, doc 04). Il est invérifiable une fois 900 lignes de
DSP écrites.

```
✓ tempo correct sur les 3, sans erreur ×2 / ÷2
✓ beats à ± 30 ms de l'annotation
✓ kicks détectés à plus de 80 %
✓ analyse d'un morceau de 4 min en moins de 15 s
```

Si la qualité n'y est pas, l'ampleur du travail DSP est réévaluée maintenant, pas au mois 3.

### P2 — Fondations · 3 jours

Vite + TypeScript strict · `core/` (RNG seedé, pas fixe, math, bus applicatif) · `Renderer` et
`Canvas2DRenderer` minimal · `Viewport` normalisé · test d'architecture · Vitest · CI.

```
✓ tsc --noEmit passe en strict
✓ le test d'architecture échoue volontairement sur un import interdit
✓ un cercle s'affiche identiquement en 16:9, 9:16 et 1:1
```

### P3 — Moteur audio et Transport · 4 jours

Chargement, décodage, lecture, pause, seek, volume, boucle. Horloge avec compensation
d'`outputLatency` et lissage de dérive. `RealtimeProbe`.

```
✓ dérive ≤ 20 ms mesurée sur 3 min, jamais en avance
✓ seek en avant et en arrière, 50 fois → aucune dérive cumulée
✓ testé avec sortie Bluetooth (latence 100–200 ms compensée)
```

### P3bis — Types et validateur PMDI · 1 jour

Extrait de P5 et remonté ici : P4 produit déjà un document PMDI, il ne peut pas le faire avant que le
format existe. Types, validateur, sérialisation, tests de tolérance à l'inconnu.

### P4 — Pipeline d'analyse · 8 jours · 🟠

Worker complet : rééchantillonnage, STFT, features, onsets **et descripteurs d'onsets**, tempo,
beats, downbeats. Progression. Inclut une **classification minimale KICK** avec les seuils par
défaut, sans quoi la table de câblage de P6 et le critère d'acceptation de P7 (« son coupé : on
devine où est le kick ») ne sont pas vérifiables à leur position dans le plan.

```
✓ 4 min analysées en ≤ 8 s
✓ F-mesure beats ≥ 0,80 sur un corpus provisoire de 6 morceaux
✓ l'interface reste fluide pendant l'analyse
```

### P5 — MusicTimeline + StepContext · 3 jours

Index de la timeline. `StepContext` **par sous-pas**. `EventDispatcher`. Import/export de fichiers
`.pmdi.json`. (Les types et le validateur ont été livrés en P3bis.)

```
✓ un document PMDI écrit à la main produit une timeline correcte
✓ eventsBetween et nextEventOfType corrects aux bornes
✓ un type d'événement inconnu est ignoré sans erreur
```

**Fin de P5 : le contrat d'intégration PULSAR est opérationnel.** C'est plus tôt que dans le brief
initial, et c'est délibéré.

### P6 — BehaviourEngine · 4 jours

Impulse, Envelope, Continuous, Trend, Anticipation. Table de câblage par données. `reset(t)`.

```
✓ décroissance identique à 30, 60 et 144 fps
✓ le câblage se modifie sans recompilation
✓ le seek restaure un état cohérent (avec rattrapage de 0,5 s)
```

### P7 — Scene, Layer, style `Pulse` · 6 jours

Système de couches, composition, palettes, `FlashLimiter`, premier style complet.

```
✓ 60 fps p95 en 1080p
✓ son coupé : on devine où est le kick
✓ le FlashLimiter respecte 3 flashs/s sur une séquence agressive
```

### P8 — Export production · 5 jours · 🟠

Industrialisation du spike P0 : formats, résolutions, contre-pression, annulation, progression,
audio muxé ou réencodé, repli `MediaRecorder`, watermark.

```
✓ 60 s de 1080p60 exportées en ≤ 120 s
✓ test golden : preview ≡ export à moins de 2 % de différence pixel
✓ 9:16 et 1:1 corrects sans adaptation du style
✓ annulation à 50 % → aucune fuite
```

**Fin de P8 : le produit fait le tour complet.** Import → analyse → visuel → vidéo. C'est le premier
jalon démontrable, et il arrive au bout d'environ 6 semaines au lieu de 4 mois.

### P9 — Styles `Field` et `Spectrum Pro` · 8 jours

Champ de particules (pool `Float32Array`, sprites additifs, feedback), spectre en échelle
logarithmique soigné.

```
✓ Field : 2 500 particules à 60 fps p95
✓ aucune allocation dans la boucle de rendu (profileur)
✓ chaque style est reconnaissable au premier coup d'œil
```

### P10 — Classification complète, structure, macro-événements · 6 jours · 🟠

Classification SNARE / CLAP / HAT / PERC et calibration par genre (le KICK est livré en P4), contour
de basse, matrice d'auto-similarité, DROP / BUILDUP / BREAK, régime de dégradation. Corpus complet
(22 morceaux) annoté à ce stade, en extension de l'outil livré en P1a.

```
✓ F kicks ≥ 0,80 · F snares ≥ 0,70 sur le corpus complet
✓ frontières de sections F ≥ 0,60
✓ un morceau sans grille bascule proprement en régime continu
```

### P11 — Presets et macros · 5 jours

5 presets genre, 8 macro-contrôles, courbes de macros, suggestion automatique de preset.

```
✓ le preset R&B change réellement le caractère du même style
✓ chaque macro a un effet perceptible sur toute sa course
✓ la suggestion tombe juste sur 7 morceaux sur 10
```

### P12 — Interface et timeline · 8 jours

Mise en page (preview centrale), transport, timeline avec beats et sections, panneaux Simple et
Avancé, plein écran, dialogue d'export, éditeur JSON de preset.

```
✓ un utilisateur non initié produit une vidéo en moins de 3 min sans aide
✓ le scrub reste fluide (≤ 40 ms par saut)
✓ l'interface ne descend jamais sous 55 fps
```

### P13 — Projet et persistance · 4 jours

IndexedDB, `.pvproj`, caches, migration, sauvegarde automatique, liste de projets avec vignettes.

```
✓ fermer et rouvrir → état identique au pixel près (grâce à la graine)
✓ audio renommé → redemandé proprement, vérifié par hash
✓ 30 cycles charger/décharger → dérive mémoire ≤ 5 Mo
```

### P14 — Performance et QualityGovernor · 5 jours

Profilage, suppression des allocations, culling, mise en cache des fonds, 4 niveaux de qualité,
gouverneur adaptatif, moniteur.

```
✓ toutes les cibles de 10_PERFORMANCE atteintes
✓ machine modeste : dégradation automatique sans oscillation
✓ 2 h d'utilisation continue → mémoire stable
```

### P15 — Tests, durcissement · 6 jours

Bancs automatisés, tests golden, matrice navigateurs, gestion d'erreurs, scénarios manuels.
(L'outil d'annotation est livré en P1a, le corpus complet en P10.)

```
✓ toutes les cibles de 11_TESTING atteintes
✓ aucun plantage sur les cas limites
✓ Safari, Firefox et Chrome validés
```

### P16 — Finition et mise en ligne · 5 jours

Écran d'accueil, morceau de démonstration embarqué, textes, licence, page produit, analytique locale
optionnelle, empaquetage.

---

## Récapitulatif

| Bloc | Jours | Cumul |
|---|---|---|
| Spikes (P0–P1) | 4 | 4 |
| Fondations (P2–P3, P3bis) | 8 | 12 |
| Cœur musical (P4–P6) | 15 | 27 |
| Premier tour complet (P7–P8) | 11 | **38** |
| Styles et intelligence (P9–P10) | 14 | 52 |
| Presets et interface (P11–P12) | 13 | 65 |
| Projet, perf, tests (P13–P15) | 15 | 80 |
| Finition (P16) | 5 | **85** |

**≈ 85 jours-homme, soit 17 semaines à temps plein.**
Avec 30 % de marge pour les imprévus — qui existeront : **21 à 24 semaines**, environ 5 mois.

À temps partiel (2 jours par semaine) : **10 à 12 mois**. C'est le chiffre honnête. Un plan qui
annonce 6 semaines pour ce périmètre est un plan qui n'a pas été fait sérieusement.

---

## Jalons de démonstration

| Jalon | Jour | Ce qu'on peut montrer |
|---|---|---|
| **M1** | 4 | « L'export fonctionne, la détection fonctionne. » |
| **M2** | 38 | Tour complet : un MP3 devient une vidéo. **Premier vrai test de marché.** |
| **M3** | 65 | Produit utilisable, 3 styles, 5 presets, interface complète. **Premiers testeurs.** |
| **M4** | 85 | MVP livrable. |

M2 est le jalon critique : à 38 jours, on sait si le produit intéresse quelqu'un, avant d'investir
les 47 jours restants.

---

## V2 — après validation du marché

Priorisées par (valeur × facilité) ÷ risque :

| Fonctionnalité | Valeur | Effort | Priorité |
|---|---|---|---|
| **Import PMDI depuis PULSAR (I2)** | ⭐⭐⭐⭐⭐ | 3 j | **1** — l'argument différenciant, quasi gratuit |
| Texte et logo personnalisés | ⭐⭐⭐⭐⭐ | 5 j | **2** — demandé par tous les beatmakers |
| 3 styles supplémentaires | ⭐⭐⭐⭐ | 12 j | 3 |
| 6 presets supplémentaires | ⭐⭐⭐⭐ | 6 j | 4 |
| Export 4K | ⭐⭐⭐ | 3 j | 5 |
| `WebGL2Renderer` | ⭐⭐⭐ | 15 j | 6 — seulement si le critère chiffré est franchi |
| Export dans un Worker (`OffscreenCanvas`) | ⭐⭐⭐ | 5 j | 7 |
| Automation par images clés | ⭐⭐⭐ | 10 j | 8 |
| Import/export de presets | ⭐⭐ | 2 j | 9 |
| Largeur stéréo, dynamique | ⭐ | 3 j | 10 |

## V3 — plateforme

- **Mode C : PULSAR en direct** (`AudioContext` partagé, sync exacte par construction)
- PULSAR STUDIO : projet unifié
- Séparation de stems (modèle léger, à évaluer)
- Presets communautaires
- Rendu serveur pour les 4K longs
- Mode VJ temps réel (entrée micro/ligne)
- Application desktop (Tauri) pour les longs rendus

---

## Ce qu'il faut refuser

| Demande probable | Réponse |
|---|---|
| « Ajoute 8 styles de plus » | Un style excellent vaut mieux que quatre corrects. Le nombre ne vend pas. |
| « Fais une version mobile » | Le rendu et l'export sont trop coûteux. Preview mobile éventuelle, export non. |
| « Ajoute de l'IA générative pour les visuels » | Contredit « aucune API payante » et « 100 % local ». Le coût par export tuerait le modèle. |
| « Reconnais le genre automatiquement » | Trop peu fiable pour l'annoncer. La suggestion par tempo et profil spectral suffit. |
| « Affiche les paroles synchronisées » | Nécessite un alignement forcé — un projet en soi. V3 au mieux. |
| « Ajoute un compte et du cloud » | Détruit l'argument « 100 % local, aucun upload ». |
