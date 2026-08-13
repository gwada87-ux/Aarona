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

---

## ADR-012 — Mode C par canal d'événements PMDI sur la liaison WebRTC, horloges alignées par corrélation

**Contexte.** Le visualizer sert d'abord Beat Studio CDJ : embarqué en iframe cross-origin
(GitHub Pages), audio reçu par `RTCPeerConnection`, contrôle UI par `postMessage`. Dans cet usage,
le mode live ré-estime — PLL, onsets, autocorrélation — ce que le scheduler de Beat Studio sait
exactement, et ~100 ms à l'avance (doc 12, « Pourquoi le Mode C sera visuellement parfait »).
Doc 12 spécifie le Mode C mais pose comme « seule contrainte d'intégration réelle » le partage d'un
même `AudioContext` — condition que l'architecture réelle ne remplit pas : l'audio traverse WebRTC
et rejoue dans un second contexte, avec un retard de bout en bout inconnu (jitter buffer, tampon de
lecture) et deux horloges audio qui dérivent l'une par rapport à l'autre.

Le verrou « Mode C = V3 » est levé pour ce seul chantier, sur mandat explicite d'Aaron
(12 août 2026, reclassement des priorités : 1. canal de vérité, 2. rendu GPU,
3. visuels mélodie/accords). Les autres verrous de la phase 3 tiennent.

**Options.**
(a) Statu quo : analyse seule, la vérité attend I3.
(b) `AudioContext` partagé — l'idéal de doc 12 : le visualizer devient module ESM dans le document
hôte, offset nul par construction. Exige d'abandonner l'iframe, donc un chantier lourd côté hôte
monofichier sans build.
(c) Canal d'événements PMDI sur un `DataChannel` de la `RTCPeerConnection` existante, horodatés sur
l'horloge audio de Beat Studio, alignés sur l'horloge locale par corrélation avec les onsets
détectés. L'analyse existante est rétrogradée : aligneur d'horloge + repli.
(d) Même contenu que (c), transporté par `postMessage`.

**Décision : (c). (b) reste la cible I3 et n'est pas abandonnée.**

**Motifs.**

- Contre (a) : sur le son de Beat Studio, chaque défaut résiduel de l'estimation — verrouillage en
  4 s, hésitations d'octave, confiance de downbeat basse, anticipation impossible — est un défaut
  évitable. La donnée exacte existe déjà de l'autre côté du pont.
- Contre (b) seul : la marche est trop haute pour être un préalable. (c) livre l'essentiel de la
  valeur — sync exacte et anticipation — sans toucher au mode d'embarquement. Et l'API de doc 12
  (`PmdiLiveSource`) est la même dans les deux cas : quand I3 partagera l'`AudioContext`,
  l'aligneur devient l'identité (offset nul) et rien d'autre ne change.
- Contre (d) : les événements doivent vivre et mourir avec la session audio qu'ils horodatent —
  une reconnexion audio invalide l'alignement, et porter les deux sur la même `RTCPeerConnection`
  rend ce couplage structurel. `postMessage` garde son rôle actuel de canal de contrôle UI ;
  la signalisation existe déjà, le `DataChannel` (reliable, ordered) coûte une ligne à l'offre SDP.

**Le contrat du canal — du PMDI, pas un nouveau format.** Enveloppe
`{ pmdiLive: "1.0", tHost, payload }` où `tHost` est l'instant où l'événement SONNERA, en secondes
de l'`audioContext.currentTime` de Beat Studio. Payloads : `event` (le `MusicEvent` de doc 12),
`tempo`, `meter`, `section`, `note`, `chord`, `heartbeat` (2 Hz), `reset`. Toutes les règles de
doc 12 s'appliquent telles quelles : confiance obligatoire (1,0 seulement pour ce qui est composé),
tolérance à l'inconnu, émission au moment où le scheduler PLANIFIE, jamais au moment où ça sonne.

**L'alignement d'horloge — le cœur de la décision.** L'inconnue unique est
`offset(t) = tLocal - tHost`. Estimation : appariement des KICK annoncés avec les onsets kick de
l'`OnsetDetector` existant — kicks seulement (le flux le plus net), fenêtre d'appariement bornée,
réfractaire du tempo réutilisé. `offset` est la médiane glissante des écarts appariés, et **la
vérité n'a d'autorité qu'alignée** : adoption après convergence (au moins 8 appariements,
dispersion MAD ≤ 10 ms), puis suivi lent pour la dérive. Avant convergence, et après 2 s de
heartbeats manqués, le moteur reste ou revient en mode analyse — sans à-coup : le PLL continue de
tourner en arrière-plan, déjà verrouillé, et la bascule est bornée par `resyncMaxJumpMs` comme
toute resynchronisation. `userTrimMs` et la mire (touche `C`) restent inchangés en aval : ils
mesurent la latence d'affichage, qui ne disparaît pas avec la vérité.

**Conséquences.**

- Le moteur d'analyse n'est plus le chemin nominal dans Beat Studio, mais il n'est pas mort : il
  devient l'aligneur d'horloge, le repli, et le chemin unique pour du son externe. Le banc
  synthétique s'étend d'un simulateur d'hôte à offset connu. Critères fixés à l'avance : offset
  retrouvé à ± 3 ms, bascule vérité ↔ analyse sans discontinuité de phase supérieure à 15 ms,
  les tests live existants inchangés et verts.
- Le moteur visuel ne change pas (la Loi 2, transposée au live) : les scènes consomment le même
  `LiveFrame` ; seule la provenance de la phase, du downbeat et des accents change. La confiance
  passe à 1, donc l'accent de grille (`gridAccent`, pondéré par la confiance) prend automatiquement
  sa pleine autorité, sans retouche des scènes. L'anticipation (~100 ms) est exposée au dispatcher
  — retenue avant impact exacte, émissions préparées — sans obliger aucune scène à s'en servir.
- Le canal est une entrée non fiable comme une autre : validation à la réception (extension de
  `validatePmdi` au flux), types inconnus ignorés (règle 3 de doc 12), `tHost` hors de la fenêtre
  `[maintenant, maintenant + lookahead + marge]` rejeté.
- Côté Beat Studio : l'émission s'OBSERVE depuis `schedulerTick` sans rien replanifier —
  l'invariant de timing du dépôt hôte n'est pas touché — derrière un flag `_XXX_V1` à `false` par
  défaut, conformément à ses règles (sortie byte-identique flag éteint).
- Ce qui est perdu tant que (b) n'existe pas : l'offset est estimé, pas nul. La corrélation le
  borne à quelques millisecondes — sous `userTrimMs`, et sous les ~6 ms RMS du PLL actuel — mais
  un passage prolongé sans kick (ambient) retarde la convergence initiale. C'est le prix de (c),
  assumé et mesuré par le banc.

---

## ADR-013 — Rendu GPU : `WebGL2Renderer` derrière l'interface `Renderer` existante

**Contexte.** Mandat explicite d'Aaron (13 août 2026, « lance le rendu GPU »), qui lève le verrou
WebGL2 posé par `CLAUDE.md` et la phase 3. Le diagnostic est mesuré depuis l'étape 6 du mode live :
en 1080p, la scène la plus lourde ne coûte que 6 % de plus que la scène vide — tout le budget part
dans la chaîne de post Canvas 2D, et surtout le PLAFOND DE QUALITÉ est atteint : bloom par cascade
de downscale, additif qui écrête au blanc 8 bits, banding combattu au grain, aucune composition en
lumière linéaire. Le critère de bascule d'ADR-002 (60 fps p95) ne sera jamais franchi parce que le
`FrameBudget` dégrade avant ; il est requalifié : la bascule est une décision de qualité d'image,
plus une décision de performance.

**Options.** (a) Rester en Canvas 2D — (b) `WebGL2Renderer` derrière l'interface `Renderer`,
prévu par ADR-002 — (c) WebGPU — (d) réécrire d'abord le pipeline live (6 scènes).

**Décision : (b).** WebGPU (c) est rejeté pour l'instant : couverture Safari incomplète, et
l'interface `Renderer` n'exprime rien qu'un compute shader servirait — réévaluable par un futur
ADR sans rien jeter. (d) est rejeté comme PREMIER pas : le pipeline live n'a pas d'interface de
rendu abstraite, c'est une réécriture, pas un backend — ADR séparé si souhaité. Le backend (b)
sert déjà DEUX chemins : le mode fichier (styles, export) et le mode direct manuel (les styles
en live via `LiveStepContextBridge`), là où Aaron vit.

**Choix d'architecture, figés ici.**
- Les sprites restent rasterisés par `createSprite` en OffscreenCanvas 2D (mêmes pixels source),
  uploadés en textures, dessinés en quads instanciés. Aucun changement d'API.
- Modes de fusion : `normal`/`additive`/`screen`/`multiply` en blending fixe ;
  `overlay`/`difference` par composition de calque (texture intermédiaire + shader) — plus cher,
  rare, et le seul moyen correct.
- Lot 2 : composition en RGBA16F LINÉAIRE, bright-pass + chaîne MIP pour le bloom, tone mapping
  filmique en sortie sRGB (courbe exacte tranchée à la mesure), aberration et résolution interne
  portés en shader.
- Repli AUTOMATIQUE et silencieux vers `Canvas2DRenderer` si WebGL2 est absent ou si le contexte
  est perdu — même esprit que la Loi 3 : une capacité absente ne doit jamais arrêter le rendu.
- Opt-in d'abord (drapeau de configuration / paramètre d'URL) ; Canvas 2D reste le défaut jusqu'au
  verdict d'Aaron (lot 3).

**Critères d'acceptation, fixés à l'avance.**
- Parité inter-backend : PAS byte-identique (deux rasterizers ne le sont jamais). Critère mesuré à
  la sonde pixels (méthode §10 de la phase 3) : les 8 styles rendent sans erreur, signatures
  distinctes, luminance moyenne et couverture dans ±25 % du Canvas 2D en lot 1.
- Déterminisme : Loi 1 intacte (aucun aléa nouveau) ; `exportDeterminism` et le golden
  preview≡export (<2 % pixels) restent verts SUR LE MÊME backend.
- Le portique ne descend jamais : typecheck 0, ≥1207 tests, architecture verte
  (`render/ -> core` uniquement).
- Perf : en lot 2, la scène de référence d'ADR-002 (`Field`, HIGH, 2500 particules, bloom) tient
  60 fps p95 en 1080p — mesurée fenêtre au premier plan.

**Découpage — un lot = une livraison validée par Aaron.**
1. **Lot 1 — parité SDR.** `WebGL2Renderer` complet derrière le drapeau, primitives + sprites +
   feedback + caméra + 6 modes de fusion, post SDR (bloom/aberration/échelle interne) en shader.
   Livrable : les 8 styles mesurés à la sonde, tableau comparatif vs Canvas 2D.
2. **Lot 2 — HDR et le « look ».** Pipeline linéaire 16F, bloom à seuil physique, tone mapping.
   C'est le lot qui change ce qu'on voit ; capture avant/après par style, verdict à l'œil.
3. **Lot 3 — bascule.** WebGL2 par défaut là où il est disponible, Canvas 2D en repli, golden
   export re-mesuré, `docs/10_PERFORMANCE.md` mis à jour.
4. **Lot 4 (optionnel, ADR séparé)** — pipeline live 6 scènes en GPU.

**Conséquences.** `render/` gagne un second backend et des shaders embarqués (chaînes dans le
source, aucune dépendance). Le `FlashLimiter` lit les pixels du canvas final : inchangé, il lit le
canvas WebGL comme l'autre (drawImage d'un canvas GL est défini). La vérification navigateur de la
phase 3 (§10) s'applique, avec une note : `getImageData` ne lit pas un canvas WebGL directement —
la sonde passe par un canvas 2D intermédiaire, méthode à consigner au premier lot.

---

## ADR-014 — Portage GPU du pipeline live : options, coûts, et critère de bascule

**Statut : TRANCHÉ le 13/08/2026 — option (c), PAS de portage. Le critère chiffré ci-dessous a
été mesuré et il ferme la question.** Aucune ligne du pipeline live n'a été touchée, ni ne le sera
au titre de cet ADR.

> Mesure décisive — Aaron, session directe réelle sur `Beat_Studio_CDJ_MOBILE_alpha25.html`,
> HUD ouvert par `D`, scène `grid-horizon`, canal de vérité ACTIF :
> `rendu  qualite 3/3   ref 33.3 ms   passes 6.36/10   bitmap 1426x802   14.5 Mo`
> et `perf  33.3 ms/trame   flashs limites 0`.
>
> Le critère disait : « stabilisé à 1 ou 0 ⇒ (a) s'ouvre ; à 2 ou 3 ⇒ le portage n'a pas d'objet ».
> Relevé **3/3**, aucun `DEGRADE`, aucun flash limité. **Le portage n'a pas d'objet.**

**Deux réserves consignées, qui ne changent pas la décision.**

1. Le niveau 3 tenu ne prouve PAS une marge de calcul : `FrameBudget` calibre sa référence sur la
   machine, donc « 3/3 » signifie « tient la cadence qu'il a lui-même apprise », pas « tient
   60 fps ». Le `ref 33.3 ms` relevé est d'ailleurs une cadence de 30 fps, et les valeurs 50,0 puis
   33,3 ms sont des multiples exacts d'une trame de 60 Hz — signature d'un vsync qui saute des
   images, pas d'un rendu coûteux. Voir `src/ui/live/NOTES.md`, § « LIMITE CONNUE ».
2. Cette réserve rendrait le critère discutable si l'on cherchait à servir les machines faibles.
   Aaron a explicitement écarté ce chantier le même jour (même section de NOTES). Le critère est
   donc appliqué tel qu'il a été écrit et pré-accepté, sur la machine où il a été prévu de le lire.

Si un jour des utilisateurs réels signalent un rendu live lent, c'est la LIMITE CONNUE qu'il faudra
rouvrir en premier — pas ce portage, dont le coût (≈ 3 410 lignes, 7 capacités absentes de
`Renderer`) reste sans rapport avec le gain attendu.

**Mandat d'origine.** `docs/20` (SESSION D) le fixait mot pour mot : « écris l'ADR du portage GPU du
pipeline live (6 scènes), options et coûts, puis attends ma validation avant toute ligne de code ».
Il a été tenu.

**Contexte.** Les lots 1 à 3 d'ADR-013 ont donné au moteur FICHIER un backend WebGL2, devenu le
défaut. Le mode live, lui, a son propre pipeline de rendu, antérieur et indépendant :
`src/ui/live/render/` + `src/ui/live/scenes/`. Il n'implémente pas l'interface `Renderer` — ses
scènes reçoivent un `CanvasRenderingContext2D` **brut** (`LiveScene.render(ctx, frame)`). C'est
pourquoi ADR-013 le classait « une réécriture, pas un backend » et le renvoyait à un ADR séparé.

**Ce que pèse réellement le périmètre** (mesuré, `wc -l`) :

| Bloc | Lignes | Lié au backend ? |
|---|---|---|
| `LivePipeline` (4 étages : scène → feedback → compose → post) | 634 | oui |
| `LayerStack` | 320 | oui |
| `Bloom` / `PostFX` / `Feedback` / `Camera` | 720 | oui |
| `Assets` (sprites pré-rendus) | 231 | oui (→ textures) |
| Les 6 scènes du registre | 1 505 | oui |
| `FrameBudget` / `Palette` / types / registre | 841 | non (purs) |
| **À porter** | **≈ 3 410** | |

Filet de sécurité à préserver : **130 tests live verts**, dont ceux d'ADR-012 (canal de vérité, en
production, intouchable par `docs/20` règle 3).

**Ce que le pipeline live utilise et que `Renderer` n'expose PAS** — l'écart qui décide de l'option
(b), relevé sur les 6 scènes :

| Capacité manquante | Scènes concernées |
|---|---|
| Texte (`font`/`fillText`/`measureText`/alignements) | `type-slam` |
| Découpe (`clip`) | `type-slam` |
| Calques par scène (`layers.acquire`) | `type-slam` |
| Transformation affine arbitraire (`setTransform`) | `type-slam` |
| Dégradé LINÉAIRE (`createLinearGradient`) | `grid-horizon`, `slice-displace` |
| Lecture arbitraire de la trame précédente (`drawImage` avec rects source/destination) | `slice-displace` |
| Terminaisons de trait (`lineCap`) | 5 usages, plusieurs scènes |

Sept extensions d'interface, dont quatre pour la seule scène `type-slam`. Or `Renderer` ne compte
que 17 opérations, et c'est précisément cette étroitesse qui a rendu les lots 1-3 possibles :
chaque opération ajoutée doit être écrite DEUX fois (Canvas 2D et WebGL2), et `clip` + texte +
transformation arbitraire sont les trois plus coûteuses à porter en GL. ADR-013 interdit d'ailleurs
explicitement toute extension de `Renderer` sans nouvel ADR.

**Le diagnostic de performance, et ce qu'il ne dit pas.** `FrameBudget` documente le fait central :
« un `performance.now()` autour du code de rendu renvoie ~2 ms alors que le GPU en met 30 — le
travail Canvas 2D est soumis de façon asynchrone ». Le mode live est donc bien limité par le
compositeur, pas par le CPU, ce qui est exactement le profil qu'un portage GPU corrigerait.
**Mais aucune mesure ne dit aujourd'hui à quel niveau de qualité le mode live tourne réellement chez
Aaron.** `FrameBudget` dégrade automatiquement, dans un ordre fixé (aberration → scanlines →
2e échelle de bloom → grain → feedback) : si le niveau reste à 3, il n'y a pas de problème à
résoudre ; s'il tombe à 1 ou 0, le mode live rend en permanence une version amputée de lui-même, et
c'est mesurable en dix secondes sur le HUD.

**Options.**

**(a) Réécrire `LayerStack`/`Bloom`/`Feedback`/`PostFX` + les 6 scènes sur WebGL2.** Le pipeline
live devient un moteur GPU à part entière.
*Pour* : supprime le plafond du compositeur là où il est mesuré ; le post (bloom multi-échelle,
grain, scanlines, aberration) est exactement ce qu'un shader fait le mieux ; `FrameBudget`
cesserait de retirer des effets.
*Contre* : ≈ 3 410 lignes réécrites ; les 130 tests live à re-verdir ; et surtout la perte du
capital de contraintes NAVIGATEUR accumulé et documenté dans `LayerStack` (pas d'`OffscreenCanvas` —
`ctx.filter` absent sur Safari ; pas de `willReadFrequently` — bascule logicielle permanente dans
Chrome ; `ctx.filter` est un état persistant ; plafond mémoire canvas global de Safari à
~224-256 Mo où `getContext` renvoie `null` sans lever). Un pipeline GL rencontrera ses propres
pièges équivalents, à redécouvrir un par un.
*Coût estimé* : 3 à 4 sessions, dont une entièrement consacrée à `type-slam` (texte + découpe +
calques).

**(b) Faire passer les scènes live par l'interface `Renderer`.** Un seul moteur de rendu pour tout
le produit.
*Pour* : élégance réelle — les scènes live hériteraient gratuitement des lots 1-3 et de tout lot
futur ; une seule chaîne de post à maintenir.
*Contre* : exige les sept extensions d'interface ci-dessus, donc quatorze implémentations (deux
backends), et transforme `Renderer` en une API Canvas 2D généraliste — l'inverse exact du choix
d'ADR-002, dont l'étroitesse est ce qui a permis d'écrire un second backend en un lot. Les scènes
live sont par ailleurs conçues autour de primitives que `Renderer` ne veut pas exposer (lecture
arbitraire de la trame précédente pour `slice-displace`). Le `FrameBudget` live et le
`QualityGovernor` fichier devraient aussi fusionner ou cohabiter, ce que ni l'un ni l'autre
n'anticipe.
*Coût estimé* : 2 à 3 sessions, plus une dette d'architecture permanente.

**(c) Ne rien faire dans ce lot — et mesurer d'abord.**
*Pour, et c'est le fait qui change tout* : **le mode direct MANUEL profite déjà de WebGL2 depuis le
lot 3.** Quand un contrôle du panneau est touché en session directe, `liveManualOverride` s'active,
le système à 6 scènes est mis en pause (`liveVisualPanel.setPaused(true)`), et c'est le VRAI moteur
fichier qui dessine — via `liveStepContextBridge`, `scene` et `renderer`, donc en WebGL2 HDR.
ADR-013 le disait déjà : « le mode direct manuel, là où Aaron vit ». Le seul chemin resté en
Canvas 2D est le système AUTOMATIQUE à 6 scènes.
*Contre* : deux chemins de rendu coexistent durablement, avec deux gouverneurs de qualité et deux
« looks » (le mode automatique n'a pas le tone mapping du lot 2).
*Coût* : nul.

**Recommandation motivée : (c) maintenant, avec un critère de bascule chiffré vers (a).** Réécrire
3 410 lignes et remettre en jeu 130 tests pour un problème qui n'a pas encore été mesuré serait
exactement l'erreur qu'ADR-002 avait évitée en écrivant Canvas 2D d'abord. (b) est rejeté sur le
fond, pas sur le coût : il ferait payer à l'interface `Renderer` — et donc aux deux backends, et à
l'export — la dette de six scènes écrites contre Canvas 2D.

**Critère de bascule, fixé À L'AVANCE comme ADR-002 l'a fait :**

> Si, sur la machine d'Aaron, en session directe réelle (Beat Studio connecté, fenêtre au premier
> plan), le HUD montre `FrameBudget` **stabilisé au niveau 1 ou 0** — c'est-à-dire le mode live
> tournant sans feedback, ou sans grain ni seconde échelle de bloom — alors l'option (a) est
> ouverte, et par les scènes les plus coûteuses d'abord.
> Si le niveau reste à 2 ou 3, le portage n'a pas d'objet : le compositeur tient le budget, et
> l'effort va ailleurs (SESSION E, visuels mélodie/accords, priorité n° 3 d'Aaron).

**Conséquences si (c) est retenu.**

- Le pipeline live reste en Canvas 2D et garde ses contraintes documentées.
- L'écart de « look » entre mode automatique et mode manuel devient un fait assumé, à consigner :
  le mode manuel a le tone mapping HDR, l'automatique non.
- La mesure ci-dessus devient une question à poser en session live, pas une tâche de fond.

**Conséquences si (a) est retenu plus tard.**

- Le portage se fait scène par scène derrière un drapeau, comme les lots 1-3, jamais d'un bloc ;
  `FrameBudget` reste l'arbitre et son ordre de dégradation est conservé tel quel.
- `type-slam` est traitée en DERNIER : c'est elle qui porte texte, découpe, calques et
  transformation arbitraire — les quatre capacités les plus coûteuses en GL.
- Les tests `liveTruth` (ADR-012, en production) doivent rester verts SANS modification : le
  portage ne touche que le rendu, jamais l'horloge.

**Note de numérotation.** `docs/20` (SESSION E) réservait « ADR-014 » au chantier mélodie/accords.
Les ADR sont numérotés dans l'ordre de RÉDACTION (001…013) ; celui-ci est donc l'ADR-014, et le
chantier mélodie/accords deviendra l'**ADR-015**. `docs/20` est corrigé en conséquence.

---

## ADR-015 — Visuels mélodie/accords : la couleur suit l'harmonie, par le cercle des quintes

**Contexte.** Priorité n° 3 du classement d'Aaron (12 août 2026), après le canal de vérité
(ADR-012) et le rendu GPU (ADR-013). Le verrou « notes/mélodie/accords » de `CLAUDE.md` est **LEVÉ
pour ce chantier** par la validation de `docs/20` par Aaron le 13 août 2026 ; les autres verrous
(mobile, i18n, lyrics, 4K, rendu serveur) tiennent.

Tout est déjà dimensionné pour, et c'est ce qui rend ce chantier peu coûteux :
- le canal de vérité **transporte déjà l'inconnu sans casser** — `TruthChannel.ingest` compte puis
  ignore un `kind` non reconnu (règle 3 de doc 12) ; ajouter des payloads n'est pas une rupture de
  contrat, c'est l'usage prévu ;
- Beat Studio sait déjà convertir ses notes et ses accords : la conversion existe dans l'export
  PMDI statique (`cell.notes` → `NOTES[nm]` → `_midiFreqToNoteNumber` ; accords via
  `pat.dna.chords[barIdx%4]` + `_chordNoteNamesToPitchClasses` + `_detectChordName`) ;
- le visualizer a déjà l'outillage couleur : `core/color/oklch.ts` (dont `rgbToOklch`) et surtout
  `PaletteBook`, qui pré-calcule des variantes de teinte **structurellement bornées**.

**La contrainte qui commande tout le reste.** `render/Palette.ts` (§3.5, §6.3) interdit
explicitement « la rotation de teinte pilotée par l'index d'un élément (`hue = f(i)`) ou par le
temps parcourant le cercle chromatique — c'est la signature de l'amateurisme », et borne toute
modulation temps réel à `hueModulation` (8 à 24° selon la palette, plafond dur 40°). Un chantier
« la couleur tourne avec la musique » passe donc à un cheveu de l'interdit. Il en est sauvé par une
distinction de fond : ici la teinte est fonction de **l'HARMONIE**, pas de l'index ni de l'horloge.
Retirer l'audio supprime l'effet — c'est le critère §6.1. Mais la BORNE, elle, reste due.

**Options pour la correspondance fondamentale → teinte.**

**(a) Linéaire par classe de hauteur** (`pc / 12 × amplitude`). Rejetée : elle rend Do et Si
visuellement voisins alors qu'ils sont harmoniquement éloignés, et Do et Sol éloignés alors qu'ils
sont les plus proches parents qui soient. Pour un produit dont le différenciateur est « le visuel
CONNAÎT la musique », c'est exactement l'erreur à ne pas commettre.

**(b) Par le CERCLE DES QUINTES, relatif à un centre tonal.** Retenue. La distance signée en
quintes entre l'accord courant et le centre tonal du morceau vit dans `[-6, +5]` ; elle est
proportionnelle à l'écart harmonique perçu. Le centre tonal est le premier accord annoncé après un
`reset` : le morceau se colore donc à sa teinte de palette au repos, et ne s'en écarte QUE lorsqu'il
module. La discontinuité inévitable — comprimer un cercle de 12 sur un arc borné en casse forcément
la continuité quelque part — tombe sur le triton, c'est-à-dire précisément l'accord le plus
lointain : le saut visuel y est musicalement juste, pas un artefact.

**(c) Teinte absolue par tonalité** (Do = rouge, etc., à la Scriabine). Rejetée : elle détruirait
l'identité des 8 palettes, qui sont un choix de direction artistique, pas un canevas neutre.

**Décision.**

1. **Payloads** `{kind:'note', midi, dur, velocity, track}` et `{kind:'chord', root, quality, dur}`
   sur l'enveloppe existante `{pmdiLive:'1.0', tHost, payload}` — mêmes formes que `NoteEvent` /
   `ChordEvent` de doc 12. Validés à la réception comme toute entrée non fiable ; un champ
   manquant ou hors bornes fait rejeter le message, jamais lever.
2. **Correspondance (b)**, isolée dans un module PUR (`tonalHue.ts`), donc testable sans navigateur
   — même traitement que `bloomMath`, `strokeGeometry` ou `hdrMath`.
3. **La borne de §3.5 est tenue par PARTAGE DE BUDGET, pas par superposition.** Le décalage
   d'accord et la modulation par élément puisent dans la MÊME enveloppe `hueModulation` : ce que
   l'accord consomme est retiré à `hexModulated`. L'excursion totale d'un élément reste donc
   `≤ hueModulation` à tout instant, exactement comme avant ce chantier. C'est ce qui permet
   d'affirmer que l'invariant reste STRUCTUREL et non déclaratif — et c'est vérifié par test.
4. **Fondu sur frontière de mesure**, jamais de saut : le décalage glisse vers sa cible, et la
   frontière de mesure est le seul instant où une nouvelle cible est prise.
5. **Périmètre du lot 1 : le pipeline live AUTOMATIQUE** (`PaletteBook`), où l'architecture le
   supporte nativement — les scènes lisent `frame.palette` et héritent du décalage sans qu'une
   seule d'entre elles soit réécrite (« effet global, aucune scène à réécrire »).

**Ce que le lot 1 ne couvre PAS, et pourquoi — mesuré.** Le moteur FICHIER (donc le mode direct
MANUEL, où Aaron passe beaucoup de temps) ne reçoit pas l'effet. Raison architecturale, pas
d'oubli : ses couches capturent la palette dans `Layer.init()`, si bien que changer la palette
impose un `scene.init()`, qui **recrée tous les sprites** (`createSprite`). À la frontière de
mesure, cela allouerait à ~0,6 Hz en pleine boucle de rendu — contraire à la règle « zéro
allocation dans la boucle » de docs/10. Rendre l'harmonie visible dans le moteur fichier demande
donc un mécanisme distinct (une couleur résolue par frame plutôt que capturée à l'init) : c'est un
lot à part entière, à ouvrir seulement si le verdict d'Aaron sur le lot 1 le justifie.

**Découpage.**

1. **Lot 1 (celui-ci)** — réception `note`/`chord`, correspondance par quintes, décalage de teinte
   borné et fondu, câblage dans le pipeline live. Banc synthétique étendu. **Inerte tant que Beat
   Studio n'émet pas** : aucun accord n'arrive, le décalage reste nul, le rendu est identique à
   avant — même discipline que le lot 1 d'ADR-012.
2. **Lot 2 — l'émetteur Beat Studio.** Émission depuis `_pmdiLiveSchedule`, même motif que
   `_pmdiLiveEmitHit`, pistes piano/bells, derrière un flag `_PMDI_LIVE_NOTES_V1` à `false` par
   défaut, hunks additifs (règles du dépôt hôte : sortie byte-identique flag éteint). C'est ce lot
   qui rend le chantier VISIBLE.
3. **Lot 3 — la scène vitrine qui VOIT la mélodie** : les notes dessinent une géométrie
   (constellation, arcs), hauteur → position, vélocité → taille, en respectant §6.1 — retirer
   l'audio ne doit pas la rendre identique à un analyseur.

**Conséquences.**
- `TruthChannel` gagne deux familles de payloads et un anneau d'accords ; les tests `liveTruth`
  existants doivent rester verts **sans modification** (ADR-012 est en production).
- Le décalage de teinte est déterministe (fonction des accords annoncés et du temps), donc la Loi 1
  est intacte : aucun tirage nouveau.
- Une palette monochrome (`graphite`, `hueModulation` 8°) ne montrera qu'un effet ténu. C'est
  voulu : la palette reste le choix artistique dominant, l'harmonie la module.
- Critère de succès, non fermable par une mesure : **le verdict d'Aaron sur un de SES beats.**
  C'est le différenciateur produit — il doit se VOIR.
