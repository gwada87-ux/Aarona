# 20 — FEUILLE DE ROUTE DES SESSIONS

État au 13 août 2026, à la clôture de l'ADR-012 (canal de vérité en
production, vérifié de bout en bout). Ce document contient TOUT ce qu'il faut
pour lancer chaque session suivante sans rien redemander : la phrase
d'ouverture à taper, ce que la session doit lire, ce qu'elle livre, et ses
critères. **Une session = un lot. Ne pas enchaîner deux lots sans validation
d'Aaron entre les deux.**

Classement validé par Aaron (12 août 2026) : 1. canal de vérité ✅ fait ·
2. rendu GPU ✅ lots 1-3 livrés le 13 août (SESSIONS A-B-C), lot 4 = ADR-014
écrit, décision en attente · 3. visuels mélodie/accords ← prochaine session
utile (SESSION E).

---

## Règles permanentes — TOUTES les sessions

1. Lire `CLAUDE.md` (racine), puis les références listées pour la session.
2. **Le portique ne descend jamais** : `npm run typecheck` 0 erreur,
   `npm test` ≥ 1207 tests verts, `npm run test:arch` vert, build OK.
   Sorties réelles collées, jamais résumées.
3. **L'ADR-012 est en production, intouchable** : `src/ui/live/truth/`,
   le mode vérité de `BeatClock`, les tests `liveTruth` — aucun ne se modifie
   sans nécessité démontrée, aucun ne se supprime.
4. Toute décision structurante = un ADR dans `docs/15_ADR.md` AVANT le code.
   Les verrous encore en place (mobile, i18n, lyrics, 4K, rendu serveur) ne se
   lèvent que par ADR portant un mandat d'Aaron.
5. Rapport court dans `docs/JOURNAL.md` en fin de lot, commit, push (le
   déploiement GitHub Pages est automatique ; les drapeaux opt-in protègent
   la production).
6. Vérification navigateur : la méthode qui marche est
   `docs/18_PHASE3_JUGEMENT.md` §10 (serveur sur 5174, `__pulsarDebug`,
   sonde pixels — jamais de capture d'écran du volet).
7. Fichiers Beat Studio : le fichier canonique est
   `C:\Users\gwada\Downloads\Beat_Studio_CDJ_MOBILE_alpha22.html`
   (= alpha21 + nommage d'accord V2, flag `_CHORD_DETECT_V2` ; alpha21 =
   alpha20 + notes/accords en direct, flag `_PMDI_LIVE_NOTES_V1`).
   Format `text/x-dc` : édition DIRECTE par
   remplacement de chaîne exact — `bundle.py` ne concerne QUE la lignée
   `v16_*`, ne pas l'appliquer ici. Voir « Maintenance » en fin de document
   si la lignée a avancé.

---

## SESSION A — Rendu GPU, lot 1 : parité SDR

**Phrase d'ouverture :**
> Lance le lot 1 du rendu GPU : lis `docs/19_PROMPT_RENDU_GPU.md` puis
> l'ADR-013 dans `docs/15_ADR.md`, et exécute.

Références : doc 19 (prompt complet du lot), ADR-013 (architecture figée).
Livrable : `WebGL2Renderer` intégral derrière l'opt-in `?renderer=webgl2`,
repli auto Canvas 2D, tableau comparatif des 8 styles à la sonde.
Critères : ±25 % luminance/couverture vs Canvas 2D, zéro erreur console,
`exportDeterminism` + golden export verts, portique intact.

## SESSION B — Rendu GPU, lot 2 : HDR et le « look »

**Phrase d'ouverture :**
> Lance le lot 2 du rendu GPU (ADR-013) : pipeline HDR linéaire et tone
> mapping dans `WebGL2Renderer`. Lis l'ADR-013 et le rapport du lot 1 dans
> `docs/JOURNAL.md` avant d'ouvrir un fichier.

Périmètre : composition en RGBA16F **linéaire** (conversion sRGB→linéaire à
l'entrée des couleurs, l'additif cesse d'écrêter au blanc 8 bits) ; bloom à
SEUIL physique par bright-pass + chaîne MIP gaussienne (remplace la cascade
de downscale) ; tone mapping filmique en sortie (courbe exacte — AgX ou
approximation ACES — tranchée À LA MESURE sur les 8 styles, consignée au
JOURNAL) ; aberration chromatique et échelle interne portées en shader.
Uniquement dans le backend WebGL2 : `Canvas2DRenderer` ne bouge pas.
Livrable : captures avant/après par style (méthode sonde + export PNG du
canvas), mesures, et la liste des réglages exposés.
Critères : scène de référence ADR-002 (`Field`, HIGH, 2500 particules,
bloom) à 60 fps p95 en 1080p fenêtre au premier plan ; aucun style ne sature
(luminance moyenne < 0,55) ; verdict d'Aaron À L'ŒIL avant de passer au lot 3.

## SESSION C — Rendu GPU, lot 3 : bascule par défaut

**Phrase d'ouverture :**
> Lance le lot 3 du rendu GPU (ADR-013) : bascule WebGL2 par défaut avec
> repli Canvas 2D. Lis l'ADR-013 et les rapports des lots 1-2 au JOURNAL.

Périmètre : WebGL2 devient le défaut quand disponible ; Canvas 2D en repli
silencieux (WebGL2 absent, contexte perdu, ou `?renderer=canvas2d` forcé) ;
golden export re-mesuré sur le backend par défaut ; `docs/10_PERFORMANCE.md`
mis à jour (budgets re-mesurés) ; `QualityGovernor`/`qualityLevels` re-étalonnés
si les mesures le justifient (proposer avant de toucher).
Critères : tour complet import→export sur les deux backends, zéro régression
du portique, et le critère produit de `01_VISION.md` : « le rendu est jugé
pro sur comparaison à l'aveugle » — c'est Aaron qui juge.

## SESSION D (optionnelle) — Rendu GPU, lot 4 : pipeline live en GPU

**Phrase d'ouverture :**
> Écris l'ADR du portage GPU du pipeline live (6 scènes), options et coûts,
> puis attends ma validation avant toute ligne de code.

Le pipeline live (`src/ui/live/render/`) n'a PAS d'interface de rendu
abstraite : c'est une réécriture, pas un backend — l'ADR doit comparer
(a) réécrire LayerStack/Bloom/Feedback/PostFX sur WebGL2, (b) faire passer
les scènes live par l'interface `Renderer`, (c) ne rien faire (le mode
direct manuel profite déjà du GPU via les styles). Décision d'Aaron sur ADR.

**ÉTAT : ADR-014 ÉCRIT le 13 août 2026, décision en attente.** Périmètre
mesuré (≈ 3 410 lignes, 130 tests live), écart d'interface relevé scène par
scène (7 capacités absentes de `Renderer`, dont 4 pour la seule `type-slam`),
recommandation (c) assortie d'un **critère de bascule chiffré** vers (a).
Aucune ligne de code écrite, conformément au mandat ci-dessus. **La décision
tient à UNE mesure de dix secondes** : en session directe réelle, le niveau
`FrameBudget` affiché par le HUD (`D`). Stabilisé à 1 ou 0 ⇒ (a) s'ouvre ;
à 2 ou 3 ⇒ le portage n'a pas d'objet, l'effort va en SESSION E.

## SESSION E — Visuels mélodie/accords (priorité n°3)

**Phrase d'ouverture :**
> Lance le chantier mélodie/accords : écris d'abord l'ADR-015 d'après la
> section SESSION E de `docs/20_FEUILLE_DE_ROUTE_SESSIONS.md`, puis exécute
> son lot 1.

Le verrou « notes/mélodie/accords » est LEVÉ pour ce chantier par la
validation de ce document par Aaron (13 août 2026) — l'ADR-015 le consigne.
(Numéro corrigé : les ADR sont numérotés dans l'ordre de rédaction, et
l'ADR-014 est celui du portage GPU du pipeline live, écrit en SESSION D.)
Tout est déjà dimensionné pour :

- **Le canal transporte déjà l'inconnu sans casser** : `TruthChannel.ingest`
  ignore proprement les kinds inconnus. Ajouter les payloads
  `{kind:'note', midi, dur, velocity, track}` et
  `{kind:'chord', root, quality, dur}` (mêmes formes que `NoteEvent`/
  `ChordEvent` de doc 12).
- **Côté Beat Studio** (fichier canonique alpha20) : émission depuis
  `_pmdiLiveSchedule`, même motif que `_pmdiLiveEmitHit`, pistes piano/bells —
  la conversion existe déjà dans l'export PMDI statique (lot 2 du 4 août) :
  `cell.notes` → `NOTES[nm]` → `_midiFreqToNoteNumber`, accords via
  `pat.dna.chords[barIdx%4]` + `_chordNoteNamesToPitchClasses` +
  `_detectChordName`. Nouveau flag `_PMDI_LIVE_NOTES_V1`, hunks additifs.
- **Côté visualizer, lot 1 du chantier** : la fondamentale de l'accord pilote
  la ROTATION DE TEINTE de la palette en OKLCH (`core/color/oklch.ts` existe,
  la modulation de teinte bornée existe dans `render/Palette.ts`) — 12
  fondamentales → 12 décalages de teinte, bornés, fondu sur frontière de
  mesure. Effet global, aucune scène à réécrire.
- **Lot 2 du chantier** : une scène vitrine qui VOIT la mélodie (les notes
  dessinent une géométrie — constellation/arcs — hauteur→position, vélocité→
  taille, en respectant §6.1 : retirer l'audio ne doit pas la rendre
  identique à un analyseur).
Critères : banc synthétique étendu (notes/accords annoncés, tir vérifié comme
`liveTruth` le fait pour les frappes), et le verdict à l'œil d'Aaron sur un
de SES beats — c'est le différenciateur produit, il doit se VOIR.

## SESSION F (petite) — Scène vitrine de l'anticipation

**Phrase d'ouverture :**
> Lance la scène vitrine de l'anticipation (ADR-012) : expose l'avance
> d'annonce du canal de vérité à UNE scène qui pré-arme ses impacts, et
> livre la scène avec son test.

Règle déjà actée : pas d'API sans consommateur — l'exposition (`nextOnsetIn`
ou équivalent) se livre DANS le même lot que la scène qui s'en sert.
Candidat : pré-armement de l'onde de choc de `mandala-32` ou des anneaux de
`laser-tunnel` ~2 trames avant l'instant visuel du kick annoncé.

---

## MAINTENANCE COURANTE — à savoir dans toute session

- **Lignée Beat Studio.** Si la lignée alpha a avancé sans partir d'alpha20,
  le canal PMDI n'y est pas. Re-port : 7 hunks additifs + gated, ancrages :
  bloc de flags après `_PMDI_NOTES_V1` · `this._vizPc=pc;` (DataChannel avant
  `createOffer`) · première ligne de `_teardownVisualizerLive(){` · fin de
  `exportPmdi` (méthodes `_pmdiLive*`) · ligne `_WEBMIDI_V1` dans
  `schedulerTick` (hook). Modèle : diff entre `alpha19.html` et `alpha20.html`.
  Vérification : extraire le bloc `<script type="text/x-dc">` et
  `node --check` (les blocs `<script>` ordinaires ne contiennent PAS l'appli).
- **Déploiement.** Chaque push sur `main` redéploie GitHub Pages (~90 s).
  Vérifier le bundle servi : le nom `assets/index-*.js` change, et le
  contenu se sonde par `curl | grep <marqueur>`. L'iframe de Beat Studio
  peut garder l'ancien `index.html` en cache ~10 min : ouvrir
  `https://gwada87-ux.github.io/Aarona` dans un onglet + Ctrl+F5.
- **Diagnostic live.** HUD touche `D`, ligne `verite` : `AUCUN MESSAGE` =
  mauvais fichier Beat Studio ou iframe périmée · `acquisition paires n` =
  aligneur en cours (8 requises) · `ACTIF` = vérité aux commandes
  (`conf 1.00` attendu au-dessus). `?` = aide raccourcis.
- **Calibration fine (un jour, 10 min)** : la mire touche `C` + film 240 fps
  pour poser `userTrimMs` (procédure : `src/ui/live/NOTES.md`, étape 6).
- **Chantiers phase 3 encore ouverts** (indépendants, `docs/18` §6) : le
  verdict du vrai morceau (chantier 1 — vaut aussi pour les beats via le
  pont), les extrêmes de luminance `chambre`/`eclats`, la dette §5.5.

## CE QU'IL FAUT REFUSER — rappel (14_ROADMAP + jugement du 12 août)

Plus de styles/scènes avant le rendu GPU (la 9e scène Canvas 2D n'améliore
rien). Les stems (inutiles pour l'usage Beat Studio). Mobile, cloud, IA
générative, lyrics : verrous inchangés.
