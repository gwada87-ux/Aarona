# JOURNAL

## Étape 1 — P0 : prototype d'export vidéo

Risque testé : produire un MP4 depuis le navigateur (docs/09_EXPORT.md, ADR-005).
Résultat : **validé**. `spike-export/` (jetable) encode 300 images 1920×1080 en H.264 via
`CanvasSource` de Mediabunny 1.52.3 (MPL-2.0), synthétise 5 s d'audio AAC mono via
`AudioBufferSource`, mux en MP4 via `Output`/`Mp4OutputFormat`/`BufferTarget`. Rendu piloté
uniquement par `t = f/60`, aucune horloge réelle. Exécuté dans le navigateur du pane Claude :
blob 872,8 Ko, `video.duration` 5,013 s, 1920×1080 confirmés par lecture du `<video>`,
contenu non vide vérifié par échantillonnage de pixels à t=2,5 s. Encodage : 4,87 s pour 5 s
de contenu. Repli `MediaRecorder` (A) non testé dans ce spike — hors périmètre P0.
Prochaine étape (00a) : Étape 2, spike de détection de beats.

## Étape 2 — P1 : outil d'annotation + prototype de détection

Fait et vérifié : `spike-analysis/stft.mjs` (FFT radix-2 validée vs DFT naïve), test de Dirac
vert (5/5, `node spike-analysis/dirac-test.mjs`) — a révélé et corrigé un vrai bug (le pic du
flux spectral est en avance sur le pic d'énergie ; ancrage sur l'énergie avant affinage ±6ms).
`dsp.mjs` : détection multi-onsets + tempo par autocorrélation, 4/4 vert sur clic 120 BPM
(erreur 0,000 ms, confiance 0,929) et cas d'ambiguïté d'octave 70 BPM+hats. `tools/annotate/`
opérationnel, testé en simulant un fichier audio (comptes, downbeat⊂beat, undo, BPM auto,
correction de latence, garde anti-frappe-dans-un-champ — tout conforme).
Fait mais non vérifié : rien sur audio réel — tout le DSP est validé sur signaux synthétiques.
Limites connues : pleine bande uniquement (pas les 6 sous-bandes de docs/04 §Étape 2, prévues
P4) ; pas de test navigateur réel de `tools/annotate/` par un humain.
Bloque la suite : **3 morceaux réels annotés à la main**, à fournir par Aaron — je ne peux ni
générer ni télécharger de musique. Sans eux, la vérité terrain (docs/11 §Annotation) n'existe pas.

## Étape 3 — P2 : fondations

Fait et vérifié : TypeScript strict (`noUncheckedIndexedAccess`) + Vite + Vitest configurés.
`core/` : `mulberry32`/`hash` (RNG seedé, Loi 1), `FixedStep` (pas fixe 1/120s, reliquat
reporté), `TypedEmitter`, `clamp`/`lerp`. `render/` : `Renderer` (interface minimale),
`Viewport` (espace normalisé, aucun pixel exposé), `Canvas2DRenderer`.
`tests/unit/architecture.test.ts` parse les imports de `src/` via l'API TypeScript et encode les
9 couches de docs/02 — testé positif et négatif : un import `render→audio` temporaire le fait
échouer (preuve collée dans la session), retiré ensuite. `npx tsc --noEmit` : 0 erreur.
`npx vitest run` : 14/14. Cercle normalisé vérifié en 16:9/9:16/1:1 par échantillonnage de
pixels réel dans le navigateur (`npm run dev`), pas seulement par le calcul.
Fait mais non vérifié : `Canvas2DRenderer` non couvert par un test automatisé (nécessiterait un
canvas mocké), seulement vérifié manuellement au navigateur. Restrictions fines
`analysis→music/pmdi` et `visual→music` (types uniquement) pas encore encodées dans le test
d'architecture — ces dossiers n'existent pas encore.
Limites connues : `rgba()` recalculée à chaque appel dans `Canvas2DRenderer` (interdit en
boucle particules, à revoir P7/P9). 2 vulnérabilités npm transitives (vite/vitest), non
traitées. `typescript` fixé en 5.7 (la 7.0.2 tout juste sortie casse sa propre résolution de
module en `moduleResolution: "Bundler"`). Pas de CI (pas de remote git).
Bloque la suite : rien. Prochaine étape (00a) : Étape 4, moteur audio et Transport (P3).
