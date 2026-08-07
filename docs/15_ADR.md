# 15 — DÉCISIONS D'ARCHITECTURE (ADR)

Format court : contexte → options → décision → conséquences. Une décision se rouvre par un nouvel
ADR, jamais par une modification de l'ancien.

---

## ADR-001 — TypeScript strict + Vite, sans framework UI

**Contexte.** Le brief laissait le choix entre JavaScript et TypeScript. Le produit doit vivre
plusieurs années et fusionner avec PULSAR.

**Options.** (a) JS vanilla monofichier, à la manière de PULSAR — (b) JS + Vite — (c) TS strict + Vite —
(d) TS + React ou Svelte.

**Décision : (c).**

**Motifs.**
- Le contrat PMDI et le format projet sont des structures partagées entre deux produits. Un contrat
  non typé est un contrat qui dérive silencieusement.
- Le moteur manipule beaucoup de `Float32Array`, d'index et d'unions discriminées : le typage y
  attrape des erreurs qu'aucun test ne verrait.
- Un framework UI est rejeté : l'interface est un panneau de contrôles autour d'un canvas, pas une
  application à état complexe. React ajouterait 45 ko et une boucle de rendu concurrente de la
  nôtre — exactement ce qu'on ne veut pas à côté d'une boucle à 60 fps.

**Conséquences.**
- Étape de build obligatoire — rupture assumée avec la philosophie monofichier de PULSAR.
- L'intégration future se fait donc par **module ESM publié**, consommable sans bundler par un hôte
  monofichier. Contrainte notée dans `12_INTEGRATION_PULSAR.md`.
- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` activés dès le premier jour :
  les activer après coup coûte dix fois plus cher.

---

## ADR-002 — Canvas 2D, derrière une interface `Renderer`

**Contexte.** Le brief impose Canvas 2D et interdit PixiJS par défaut, tout en demandant glow,
particules, profondeur et 1080p60.

**Options.** (a) Canvas 2D seul — (b) WebGL2 écrit à la main — (c) PixiJS — (d) Canvas 2D derrière une
abstraction, WebGL2 ajouté plus tard si nécessaire.

**Décision : (d).**

**Motifs.**
- La contrainte du brief est légitime : Canvas 2D est plus simple, plus maintenable, et suffisant
  jusqu'à un plafond élevé **si** on évite `shadowBlur` et si on utilise des sprites additifs
  pré-rendus. Ces techniques changent complètement le budget, et le brief ne les mentionnait pas.
- Écrire WebGL2 d'emblée coûterait 3 à 4 semaines de plomberie avant le premier pixel intéressant.
- PixiJS résoudrait le problème mais ajoute 120 ko et une architecture imposée pour un besoin que
  300 lignes de WebGL2 couvriraient — contraire au principe « pas de dépendance par habitude ».
- L'abstraction `Renderer` coûte environ deux jours et supprime définitivement le risque de blocage.

**Critère de bascule, fixé à l'avance.**
> Si la scène de référence (`Field`, HIGH, 2 500 particules, bloom) ne tient pas 60 fps p95 en 1080p
> sur la machine de référence après optimisation, alors `WebGL2Renderer` est implémenté en V2.

**Conséquences.** Interface volontairement étroite (~15 opérations) ; `drawSprite` prend un tableau de
transformations pour rester efficace sur les deux backends.

---

## ADR-003 — Analyse hors-ligne en Worker, DSP écrit maison

**Contexte.** Il faut des événements horodatés avec une confiance, sur des morceaux entiers.

**Options.** (a) `AnalyserNode` en temps réel — (b) Essentia.js — (c) portage WASM d'aubio —
(d) DSP maison hors-ligne en Worker.

**Décision : (d).**

**Motifs.**
- `AnalyserNode` ne peut pas horodater et lisse les transitoires. Structurellement inadapté.
- **Essentia.js est en AGPL-3.0** : une licence commerciale auprès de l'UPF serait obligatoire pour
  un produit propriétaire. Rédhibitoire.
- aubio est en GPL-3.0. Même problème.
- Le périmètre à écrire est borné (~900 lignes) et **c'est le cœur de valeur du produit** : le
  déléguer à une boîte noire reviendrait à déléguer l'avantage concurrentiel.

**Conséquences.** Environ 8 jours de développement DSP. Qualité entièrement sous contrôle, calibrable
par genre. Nécessite un corpus annoté pour être mesurable — d'où le niveau 2 de `11_TESTING.md`.

---

## ADR-004 — `MusicTimeline` requêtable plutôt que bus d'événements push

**Contexte.** Le brief décrivait un bus push comme couche centrale.

**Décision.** La source de vérité est une **structure immuable indexée par le temps**. Le « bus »
devient un dispatcher sans état, placé en aval.

**Motifs.** Un bus push ne sait pas reculer (seek, scrub), ne sait pas avancer plus vite que le
temps réel (export), et ne sait pas répondre à « quand est le prochain drop ? » (anticipation).
Ces trois besoins sont posés par le brief lui-même.

**Conséquences.** Preview, scrub et export partagent le même code et produisent le même résultat.
L'anticipation devient possible, ce qui est la principale source d'effets visuels convaincants.
Contrepartie : l'analyse doit être terminée avant la lecture — ce qui est de toute façon le cas.

---

## ADR-005 — Export : WebCodecs + Mediabunny, `MediaRecorder` en repli

**Contexte.** Il faut un export vidéo local, déterministe, de qualité, sans dépendance lourde.

**Décision.** WebCodecs pour l'encodage, Mediabunny (MPL-2.0) pour le multiplexage, rendu image par
image hors temps réel. `MediaRecorder` en repli explicitement dégradé.

**Motifs.**
- Seule option satisfaisant simultanément déterminisme, qualité, poids (~40 ko) et licence.
- Couverture ≈ 92 % (Chrome/Edge 94+, Firefox 130+, Safari 26+).
- `ffmpeg.wasm` est écarté sur deux critères : 30 Mo de WASM, et les builds avec x264 sont **GPL**.
- Le rendu serveur contredit le principe « 100 % local » et introduit un coût par export.

**Conséquences.** Le pipeline de rendu doit être **déterministe** — c'est cette décision qui impose la
Loi 1. Un repli à maintenir. Un spike en phase 0 pour lever le risque immédiatement.

---

## ADR-006 — Local pur, licence par clé, watermark honnête

**Contexte.** Le brief exige un fonctionnement 100 % local et un produit commercialisable.

**Décision.** Aucun serveur pour produire. Gratuit avec watermark et export limité à 720p ; payant
par clé de licence, sans watermark, jusqu'à 4K. Vérification locale, contrôle en ligne optionnel et
non bloquant.

**Motifs.** Dans une application entièrement locale, aucune protection côté client n'est inviolable.
La reconnaître évite d'investir dans une obfuscation qui gêne les clients honnêtes sans arrêter les
autres. Le « 100 % local » est par ailleurs un **argument de vente** (confidentialité, vitesse, pas
d'abonnement d'infrastructure) qui vaut plus que la fraction d'utilisateurs perdue.

**Conséquences.** Le watermark est appliqué dans le pipeline de rendu, avant encodage. Contournement
possible et assumé.

---

## ADR-007 — Licences autorisées : MIT, BSD, Apache-2.0, MPL-2.0 uniquement

**Contexte.** Le brief interdisait les API payantes mais ne disait rien des licences de code.

**Décision.** Aucune dépendance GPL ou AGPL, y compris transitive. Vérification automatisée en CI.

**Motifs.** Les deux meilleures bibliothèques du domaine (Essentia pour l'analyse, ffmpeg+x264 pour
l'export) sont copyleft fort. Les intégrer par confort contaminerait juridiquement tout le produit,
et le problème ne se découvrirait qu'au moment de la commercialisation — c'est-à-dire au pire moment.

**Conséquences.** DSP maison (ADR-003), Mediabunny plutôt que ffmpeg.wasm (ADR-005). Un contrôle de
licences (`license-checker`) tourne en CI et bloque la fusion en cas de violation.

---

## ADR-008 — IndexedDB + fichier `.pvproj`, surcharges en diff

**Décision.** Projets et caches en IndexedDB ; échange par archive ZIP `.pvproj` ; les modifications
utilisateur sont stockées comme un **diff** du preset, pas comme une copie ; la graine du PRNG est
sauvegardée.

**Motifs.** Le diff garde les fichiers minuscules et fait profiter les projets existants des
améliorations de presets. La graine rend le projet rigoureusement reproductible — indispensable dès
qu'on réexporte dans plusieurs formats.

**Conséquences.** `presetVersion` doit être suivi et les migrations doivent traduire les chemins de
diff obsolètes.

---

## ADR-009 — PMDI v1.0, tolérant à l'inconnu, Mode B en premier

**Décision.** Contrat JSON versionné, une seule base de temps (les secondes), confiance obligatoire,
types inconnus ignorés silencieusement. L'architecture est dimensionnée pour le Mode B ; le Mode A
est un estimateur qui remplit le même contrat.

**Motifs.** PULSAR évoluera plus vite que le visualizer. Un contrat strict casserait à chaque
évolution ; un contrat tolérant permet d'ajouter des types d'événements sans coordination. Et surtout :
la supériorité du produit vient de la connaissance exacte de la musique, pas d'une meilleure analyse.

**Conséquences.** Le moteur d'analyse est explicitement **remplaçable**. Aucune ligne du moteur visuel
ne dépend de la façon dont les données ont été obtenues.

---

## ADR-010 — Sécurité photosensible intégrée au pipeline

**Contexte.** Absent du brief. Un visualizer qui flashe sur le kick dépasse largement les 3 flashs
par seconde de repère (WCAG 2.3.1) — à 140 BPM en doubles-croches, on est à 9,3.

**Décision.** `FlashLimiter` en dernier étage du pipeline de rendu, non contournable, appliqué avant
l'encodage. Mode « réduction des flashs » exposé et activé par défaut sur les presets à forte énergie.

**Motifs.** Protection juridique sur un produit vendu, conformité de diffusion sur les plateformes,
et argument commercial. Le coût est d'environ un jour de développement ; l'ajouter après coup
obligerait à réétalonner tous les presets.

**Conséquences.** Environ 1 ms de budget par image. Certains effets extrêmes sont bornés — ce qui est
l'objectif.

---

## ADR-011 — Caméra globale (translation + échelle) dans l'interface `Renderer`

**Contexte.** Phase 2, chantier 4. `Renderer` n'exposait qu'`applyShake(dx, dy)`, une translation
globale. Trois besoins la débordent : la « poussée lente pendant une montée » de la dramaturgie
(chantier 3, livrée en translation seule faute de mieux), les variantes de cadrage « plan large ou
rapproché » (chantier 4), et deux des cinq styles prévus au chantier 5 — `monolith` construit tout
son effet sur un travelling, `iso-pulse` sur un basculement de grille.

`docs/17_PHASE2_VISUELS.md` §4 n'autorisait que deux extensions de l'interface, les modes de fusion
et `drawImage`. Une caméra en est une troisième : décision prise explicitement par Aaron.

**Décision.** Ajouter `applyCamera(dx, dy, zoom)` à l'interface `Renderer`, à côté d'`applyShake`
qui reste inchangée. L'échelle est centrée sur l'origine du repère normalisé et **bornée à
[1, 2]** ; `applyShake` conserve son rôle de secousse par couche.

**Motifs.** Le mécanisme est celui qui existe déjà : `Canvas2DRenderer.applyShake` fait un
`ctx.translate` à l'intérieur du `save`/`restore` posé par `beginFrame`/`endFrame`. Ajouter un
`ctx.scale` au même endroit ne change ni la structure ni le coût. La Loi 1 est préservée : la
caméra est calculée par `VisualDirector`, qui dérive tout de `t` sans état.

Une méthode NOUVELLE plutôt qu'une signature élargie : `applyShake` est appelée par la couche
`ScreenShake` avec une sémantique de secousse, documentée et testée. Les deux se composent
naturellement — deux transformations successives sur le même contexte.

**Zoom borné à [1, 2] — la borne basse est le point important.** Sous 1, le cadrage s'élargit et
découvre les bords : les fonds plein écran (`fillRadialGradient`, rayon 1,0 à 1,1) cesseraient de
couvrir le cadre et laisseraient une bande non peinte. La conséquence pratique est que « plan
large » est la valeur par défaut (zoom 1) et « plan rapproché » un zoom supérieur, jamais l'inverse.

**Conséquences.**

- `drawFeedback` est explicitement rendu INSENSIBLE à la caméra. Sans cette exception, le zoom
  entrerait en composition avec lui-même : la capture contient l'image telle qu'affichée, donc déjà
  zoomée ; la redessiner sous le même zoom la grossit encore, et l'échelle croît géométriquement
  d'une image à l'autre. Un zoom tenu à 1,15 pendant deux secondes produirait un facteur supérieur
  à 10 000. La traînée reste donc en espace ÉCRAN, ce qui a en prime un intérêt visuel : elle se
  déforme quand la caméra bouge, au lieu de la suivre rigidement.
- Le `FlashLimiter` reste le dernier étage et n'est pas contourné : la caméra agit avant lui.
- Les couches ne connaissent pas la caméra. Elles dessinent dans le même repère normalisé
  qu'avant ; seul l'appelant de la trame la pose.
