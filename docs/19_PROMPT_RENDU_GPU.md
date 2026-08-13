# PULSAR_VISUALIZER_v2 — Chantier RENDU GPU (ADR-013), lot 1 : parité SDR

Projet : `C:\Users\gwada\Downloads\PULSAR_VISUALIZER_v2`
Propriétaire : Aaron. Réponses en **français**, concises, sans remplissage.

> Ce document est le prompt d'ouverture du chantier. **L'autorité est
> `docs/15_ADR.md`, ADR-013** — mandat d'Aaron du 13 août 2026, verrou WebGL2
> levé, architecture et critères figés là-bas. Lis l'ADR-013 en entier AVANT
> d'ouvrir un fichier de code. Lis aussi `CLAUDE.md` (racine du projet) et
> `docs/JOURNAL.md` (entrées du 13 août : le canal de vérité ADR-012 est en
> production, ne le casse pas).

---

## 1. CE QUE LE LOT 1 LIVRE — et rien d'autre

Un `WebGL2Renderer` qui implémente **intégralement** l'interface `Renderer`
(`src/render/Renderer.ts`, 17 opérations), derrière un opt-in, avec repli
automatique vers `Canvas2DRenderer`. SDR : la lumière linéaire, le vrai bloom
HDR et le tone mapping sont le **lot 2** — n'anticipe pas.

Inventaire des 17 opérations et pièges connus (de l'ADR-013) :

| Opération | Implémentation attendue |
|---|---|
| `beginFrame`/`endFrame` | FBO de frame, blit final vers le canvas |
| `setBlendMode` | `normal`/`additive`/`screen`/`multiply` en blending fixe ; **`overlay`/`difference` par calque intermédiaire + shader** (inexprimables en fixed-function) |
| `clear`, `fillCircle`, `strokeCircle` | quads SDF ou géométrie, batchés |
| `strokePath` (lineWidth, closed) | extrusion en triangle strip, joints corrects |
| `fillPath` | polygones des styles = convexes ou en éventail (barres de Spectrum) — trianguler simple, VÉRIFIER sur les 8 styles avant de sophistiquer |
| `fillRadialGradient` | quad plein écran + shader |
| `createSprite`/`drawSprite` | rasterisation OffscreenCanvas 2D **inchangée** → texture GL, quads instanciés additifs |
| `applyShake`/`applyCamera` | matrice de transformation ; `drawFeedback` insensible à la caméra (ADR-011, la raison est documentée dans `Renderer.ts`) |
| `drawFeedback`/`captureFeedback` | ping-pong de textures FBO |
| `setBloomConfig`/`setChromaticAberration`/`setInternalResolutionScale` | post SDR en shader, mêmes réglages observables qu'en 2D |

Sélection du backend : paramètre d'URL `?renderer=webgl2` OU champ de config —
un seul point de décision, dans `ui/` (seule couche qui a le droit de choisir).
Canvas 2D reste le défaut. Contexte perdu (`webglcontextlost`) => repli 2D à la
frame suivante, sans exception, sans écran noir.

## 2. RÈGLES QUI NE BOUGENT PAS

- Les cinq Lois (CLAUDE.md §ARCHITECTURE). Loi 1 : aucun aléa, aucun
  `performance.now()` — un shader n'a pas le droit au temps réel non plus.
- `render/` n'importe que `core/` (test d'architecture).
- Aucune dépendance npm : shaders en chaînes dans le source.
- Édits chirurgicaux ; `Canvas2DRenderer` n'est PAS touché.
- Le portique ne descend jamais : typecheck 0, ≥ 1207 tests, arch verte.
- Protocole de réponse de CLAUDE.md (OBJECTIF / FICHIERS / IMPLÉMENTATION /
  VÉRIFICATION collée / CRITÈRES / LIMITES).

## 3. VÉRIFICATION — la méthode qui marche ici

`docs/18_PHASE3_JUGEMENT.md` §10 est la référence (serveur sur **5174**,
`window.__pulsarDebug`, sonde pixels). **Adaptation WebGL obligatoire** :
`getImageData` ne lit pas un canvas WebGL — la sonde dessine d'abord le canvas
GL dans un canvas 2D intermédiaire (`drawImage`), dans la MÊME tâche que le
rendu (ou contexte créé avec `preserveDrawingBuffer:true`, à trancher et
consigner au JOURNAL).

Livrable de vérification du lot 1 : le tableau des 8 styles, WebGL2 vs
Canvas 2D, colonnes luminance moyenne / couverture / luminance max — critère
ADR-013 : ±25 %, zéro erreur console, signatures distinctes. Plus
`exportDeterminism` et le golden export verts (même backend).

## 4. CE QUI EST HORS PÉRIMÈTRE DU LOT 1

HDR/linéaire/tone mapping (lot 2). Bascule par défaut (lot 3). Pipeline live
6 scènes (lot 4, ADR séparé). Toute extension de l'interface `Renderer`
(interdite sans nouvel ADR). Le canal de vérité ADR-012 (en production — les
tests `liveTruth` doivent rester verts sans modification).

## 5. ORDRE DE TRAVAIL SUGGÉRÉ

1. Squelette : contexte, FBO, blit, `clear` — un style s'affiche en aplat.
2. Sprites instanciés (c'est 80 % des pixels de `Field`/`Pulse`).
3. Primitives (cercles, chemins, gradient), puis modes de fusion simples.
4. `overlay`/`difference` par calque. Feedback ping-pong. Caméra/shake.
5. Post SDR (bloom cascade GL, aberration, échelle interne).
6. Sonde comparative 8 styles, tableau, JOURNAL, livraison.

À la fin : rapport court dans `docs/JOURNAL.md`, commit, push (le déploiement
Pages est automatique — le drapeau opt-in protège la production).
