# 09 — EXPORT

> C'est le plus gros risque technique du projet. Il est traité en **phase 0**, pas en phase 12.

## Comparaison des stratégies

| Critère | A. `MediaRecorder` | B. **WebCodecs + Mediabunny** | C. `ffmpeg.wasm` | D. Rendu serveur |
|---|---|---|---|---|
| Déterminisme | ❌ temps réel imposé | ✅ image par image | ✅ | ✅ |
| Images perdues sous charge | ❌ oui | ✅ aucune | ✅ | ✅ |
| Vitesse | 1× maximum | **0,5× à 3×** selon machine | 0,1–0,3× | dépend |
| Contrôle du débit | approximatif | ✅ précis | ✅ | ✅ |
| Conteneur / codec | WebM/VP9 (MP4 sur Safari) | **MP4/H.264, AV1** | tout | tout |
| Poids ajouté | 0 | **≈ 40 ko** (arbre secoué) | ≈ 30 **Mo** | 0 |
| Couverture navigateur | ~98 % | **~92 %** | ~95 % | 100 % |
| Licence | native | **MPL-2.0** ✅ | ⚠️ **GPL** avec x264 | — |
| Fonctionnement local | ✅ | ✅ | ✅ | ❌ contredit le principe |

### Décision (ADR-005)

**B en principal, A en repli dégradé.**

- **B** est la seule option qui satisfait à la fois le déterminisme, la qualité, le poids et la
  licence. WebCodecs est disponible sur Chrome/Edge 94+, Firefox 130+ et Safari 26+, soit environ
  92 % du parc. Mediabunny (MPL-2.0) gère le multiplexage MP4/WebM sans dépendance transitive.
- **C est écarté sur la licence autant que sur le poids.** Les builds `ffmpeg.wasm` incluant x264
  sont sous GPL, ce qui contaminerait un produit propriétaire. Les builds LGPL n'ont pas les codecs
  utiles. 30 Mo de WASM pour un encodage 5 fois plus lent qu'un encodeur matériel n'est de toute
  façon pas défendable.
- **D contredit le principe « 100 % local »** et introduit un coût d'infrastructure par export.
  Conservé comme option V3 pour les rendus 4K longs, jamais comme chemin par défaut.
- **A** reste implémenté derrière la même interface, avec un avertissement explicite dans l'UI :
  « Votre navigateur ne prend pas en charge l'export haute qualité. Le rendu sera effectué en temps
  réel et peut présenter des images perdues. » Mieux qu'un blocage, à condition de ne pas mentir sur
  la qualité.

---

## Le pipeline déterministe

```
ExportPipeline.run(config)
  │
  ├─ 1. préparation
  │      canvas hors écran à la résolution cible (indépendant du canvas de preview)
  │      scene.reset(0) · behaviour.reset(0)
  │      RealtimeProbe désactivée
  │
  │      ⚠️ NIVEAU DE QUALITÉ FIGÉ pour toute la durée de l'export, à la valeur
  │         choisie dans le dialogue d'export (HIGH par défaut).
  │         Le QualityGovernor est DÉSACTIVÉ pendant l'export.
  │         Sans cette règle : si le gouverneur a rétrogradé la preview en LOW
  │         (400 particules, sans feedback) et que l'export tourne en HIGH
  │         (2 500 particules avec traînées), le test « ≤ 2 % de différence
  │         pixel » échoue de plusieurs dizaines de pour cent.
  │
  │      ⚠️ CHAÎNE DE RÉSOLUTION DU NOMBRE DE PARTICULES, ordre imposé :
  │           preset.layers.particles.count
  │             → modulé par la macro `density`
  │               → PLAFONNÉ par le niveau de qualité
  │         Le plafond est le seul étage autorisé à varier en preview.
  │
  ├─ 2. boucle ASYNCHRONE sur les images   f = 0 … N−1
  │      t = f / fps                              ← aucune horloge réelle
  │      simulation à pas fixe 1/120 s jusqu'à t
  │         (mêmes sous-pas, mêmes stepIndex, mêmes graines qu'en preview)
  │      scene.draw() · flashLimiter.apply()
  │      const frame = new VideoFrame(canvas, { timestamp: f * 1e6 / fps })
  │      try { encoder.encode(frame) } finally { frame.close() }
  │
  │      CONTRE-PRESSION : si encoder.encodeQueueSize > 8,
  │         await une Promise résolue par encoder.ondequeue
  │         (il n'existe aucune primitive d'attente directe sur encodeQueueSize)
  │
  │      YIELD à chaque image, via MessageChannel ou scheduler.yield()
  │         ❌ PAS setTimeout : bridé à 1 appel/seconde en onglet d'arrière-plan
  │         ❌ PAS de boucle for synchrone : les callbacks `output` de VideoEncoder
  │            sont des tâches de la boucle d'événements ; sans yield elles ne
  │            s'exécutent jamais, la file explose, la progression est figée et
  │            l'annulation n'est jamais traitée
  │
  │      annulation : vérifiée à chaque image
  │      progression : émise toutes les 15 images
  │
  ├─ 3. piste audio
  │      si (conteneur = MP4 et source = AAC) → remux direct, sans perte, instantané
  │      sinon → AudioEncoder AAC depuis l'AudioBuffer décodé
  │
  ├─ 4. multiplexage → Blob MP4
  └─ 5. téléchargement local (aucun upload)
```

**Implémenté à l'Étape 10/P8** (`src/export/`) — écarts par rapport au pseudocode ci-dessus,
documentés en détail dans `docs/JOURNAL.md` :
- Pas de `VideoFrame`/`VideoEncoder` bas niveau ni de `encodeQueueSize`/`ondequeue` manuels :
  `CanvasSource.add()`/`AudioBufferSource.add()` de **Mediabunny** renvoient déjà une Promise qui
  respecte la contre-pression en interne (confirmé en lisant `spike-export/main.js`, le spike
  jetable de l'Étape 1). `await` suffit.
- L'annulation est vérifiée à chaque image comme prévu, mais via un `AbortSignal` standard
  (`AbortController`), pas un flag maison.
- Audio TOUJOURS réencodé via `AudioBufferSource` (branche « sinon » ci-dessus) : le remux direct
  sans perte (branche « MP4 + AAC ») n'est pas implémenté, faute de capacité de démuxage dans ce
  lot — `AudioEngine` fournit déjà un `AudioBuffer` décodé, qui couvre tous les formats d'entrée
  uniformément, au prix de ne pas être maximal pour le cas MP4/AAC pur.

### Pourquoi ce pipeline garantit l'identité preview/export

| Source de non-déterminisme | Neutralisation |
|---|---|
| `Math.random()` | interdit — PRNG seedé, reseedé sur `t` |
| Horloge réelle | `t = f / fps`, jamais `performance.now()` |
| Pas de temps variable | pas fixe 1/120 s avec accumulateur |
| `AnalyserNode` | désactivé, remplacé par les `FeatureTracks` à `t` |
| Ordre d'exécution des couches | ordre du tableau, déterministe |
| Ordre d'itération d'un `Map` | interdit dans les boucles de rendu |
| Résolution différente | composition en unités normalisées |

La seule différence subsistante — la contribution de la sonde temps réel en preview — est bornée à
25 % et vérifiée par le test golden (`11_TESTING.md`).

---

## Formats de sortie

| Nom | Résolution | Ratio | Destination |
|---|---|---|---|
| YouTube | 1920 × 1080 | 16:9 | YouTube, site |
| YouTube 4K *(V2)* | 3840 × 2160 | 16:9 | |
| Shorts / TikTok / Reels | 1080 × 1920 | 9:16 | vertical |
| Post carré | 1080 × 1080 | 1:1 | fil Instagram |
| Gratuit | 1280 × 720 | 16:9 | version sans licence (watermark) |
| Aperçu | 854 × 480 | 16:9 | rendu rapide de contrôle |

Réglages : 30 ou 60 fps · débit **8 / 12 / 20 Mb/s** · H.264 High profile (compatibilité maximale) ·
AV1 proposé si `VideoEncoder.isConfigSupported()` le confirme, avec mention explicite de sa moindre
compatibilité.

**Le changement de format ne demande aucune adaptation du style** : c'est le bénéfice direct de la
composition en unités normalisées et des modes de recadrage déclarés par couche (`07_VISUAL_ENGINE`).

---

## Performance et budget

Sur la machine de référence, pour 60 s de 1080p60 (3 600 images) :

```
simulation (2 sous-pas)  ≈  4,5 ms/image  →  16 s
dessin de la scène       ≈  9,0 ms/image  →  32 s
FlashLimiter (1 img/2)   ≈  0,5 ms/image  →   2 s   ← readback synchrone, non recouvrable
encodage matériel        ≈  4,0 ms/image  →  14 s   (parallélisé, largement recouvert)
multiplexage + E/S                        →   4 s
──────────────────────────────────────────────────
total                                     ≈  55 à 75 s       cible ≤ 120 s ✅
```

Le premier calcul de ce document ne comptait que la ligne `Scene.draw` du budget par image et
oubliait la simulation, ce qui sous-estimait de 20 secondes. Le coût réel du readback du FlashLimiter
doit par ailleurs être **mesuré dès le spike P0**, car il n'est recouvert par rien dans une boucle
sans `rAF`.

L'export est donc **plus rapide que le temps réel**, ce que `MediaRecorder` ne peut structurellement
pas offrir. Un morceau de 3 minutes s'exporte en 2 à 3 minutes plutôt qu'en 3 minutes plus les
images perdues.

### Sur machine modeste

Un export de 5 minutes en 1080p60 sur un portable d'entrée de gamme peut prendre 8 à 12 minutes.
Mesures prévues :

- estimation affichée **avant** de lancer, calculée sur un banc de 30 images ;
- progression avec temps restant et annulation immédiate ;
- suggestion automatique de 30 fps quand l'estimation dépasse 10 minutes ;
- `Worker` + `OffscreenCanvas` en V2 pour libérer le thread principal (l'onglet reste utilisable).

---

## Repli `MediaRecorder`

```
Détection : tester la VIDÉO **et** l'AUDIO, séparément
   typeof VideoEncoder === 'undefined'
   || !(await VideoEncoder.isConfigSupported(videoCfg)).supported
   || !(await AudioEncoder.isConfigSupported(audioCfg)).supported

⚠️ Firefox 130+ expose VideoEncoder, mais l'encodage H.264 y dépend de la plateforme
   et AudioEncoder AAC n'y est pas disponible. Le chemin nominal MP4/H.264/AAC n'est
   donc PAS garanti sur Firefox, alors que VideoEncoder existe.
   → Repli PARTIEL prévu : WebCodecs pour la vidéo + piste audio muxée depuis les
     octets sources sans réencodage, quand le conteneur l'autorise.
     C'est le meilleur des deux et cela évite de basculer tout l'export en mode dégradé
     pour un seul codec audio manquant.

Repli :  canvas.captureStream(fps) → MediaRecorder
         lecture en temps réel, obligatoire
         conteneur WebM/VP9 (ou MP4/H.264 sur Safari selon la version)
         audio : piste de l'élément média, capturée en direct

**Implémenté à l'Étape 10/P8** (`src/export/encoders/MediaRecorderFallback.ts`) : le repli
PARTIEL Firefox décrit ci-dessus n'est PAS implémenté — faute de capacité de remux audio (voir
plus haut), un navigateur avec vidéo WebCodecs mais sans `AudioEncoder` AAC bascule sur le repli
`MediaRecorder` COMPLET, pas le chemin partiel optimal. `detectExportPath()` teste donc les deux
en bloc (`canEncodeVideo` ET `canEncodeAudio`, via Mediabunny), pas séparément avec un chemin
intermédiaire. Par ailleurs, `MediaRecorder` étant structurellement temps réel (`captureStream`)
et `ExportPipeline` déterministe (`t = f/fps`), les deux chemins ne partagent PAS une interface
par-image : `FrameEncoder` (`ExportPipeline`, `MediabunnyEncoder`) et `runRealtimeCapture`
(`MediaRecorderFallback`) sont deux fonctions distinctes, unifiées seulement au niveau du résultat
(`{blob, elapsedMs, totalFrames}`) — voir `docs/JOURNAL.md`, Étape 10, pour le raisonnement complet.

Message UI, sans euphémisme :
  « Export en mode compatible : le rendu s'effectue en temps réel et certaines images
    peuvent être perdues sur une machine chargée. Pour une qualité optimale, utilisez
    Chrome, Edge, Firefox 130+ ou Safari 26+. »
```

---

## Watermark et modèle commercial (ADR-006)

Le watermark est appliqué **dans le pipeline de rendu**, avant l'encodage — pas superposé après.
Il est donc présent dans l'export sans traitement séparé.

Il faut être lucide : dans une application 100 % locale, un utilisateur déterminé peut le retirer.
Ce n'est pas un échec de conception, c'est une conséquence directe du principe « aucun serveur »,
qui est lui-même un argument de vente majeur (confidentialité, vitesse, pas d'abonnement
d'infrastructure).

Position retenue :

- version gratuite : watermark discret en bas à droite, export limité à 720p ;
- version payante : clé de licence, aucun watermark, jusqu'à 4K ;
- vérification de licence locale, contrôle en ligne optionnel et non bloquant ;
- pas d'obfuscation agressive : elle gêne les utilisateurs honnêtes et ne retient pas les autres.

**Implémenté à l'Étape 10/P8** (`src/export/watermark.ts`) : uniquement le MÉCANISME de dessin — un
point plein + un anneau, en bas-droite dans la safe area, sans typographie (`Renderer.drawText`
reste différé, aucune couche `Text` avant P12). Gardé par un simple booléen `watermarked` fourni
par l'appelant. La logique commerciale (clé de licence, plafond 720p en gratuit) n'existe pas
encore — c'est un chantier UI/P16, hors périmètre de ce lot.

Ce compromis est celui de la majorité des outils créatifs indépendants qui réussissent. Le
contournement existe et reste marginal ; la friction imposée aux clients payants, elle, se paierait
immédiatement.

---

## Points de vigilance

| Risque | Mitigation |
|---|---|
| `VideoFrame` non libérée → fuite mémoire massive | `close()` systématique en `finally`, testé |
| File d'encodage saturée | contre-pression sur `encodeQueueSize` |
| Onglet en arrière-plan ralenti | pipeline non lié à `rAF` ; avertissement affiché |
| Décalage audio/vidéo dans le conteneur | horodatages calculés depuis `f/fps`, jamais accumulés |
| Blob > 2 Go | découpage en segments ou passage par File System Access API |
| Profil H.264 non supporté | `isConfigSupported()` avec repli sur Baseline |
| Utilisateur qui ferme l'onglet en cours d'export | `beforeunload` avec confirmation |
