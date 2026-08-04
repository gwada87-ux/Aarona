# 11 — STRATÉGIE DE TESTS

## Principe

> Un critère non mesuré est un critère non tenu.

Trois choses sont difficiles à tester sur ce produit, et ce sont précisément les trois qui décident
de sa qualité :

1. **la précision de la détection** — nécessite une vérité terrain ;
2. **le déterminisme du rendu** — nécessite des rendus de référence ;
3. **la beauté** — non automatisable, mais encadrable par une revue.

Le reste (moteur audio, timeline, format projet, encodage) relève du test unitaire classique.

---

## Niveau 1 — Tests unitaires (Vitest)

| Domaine | Ce qui est vérifié |
|---|---|
| `core/rng` | même graine → même séquence ; `reseed` reproductible |
| `core/time` | accumulateur à pas fixe : nombre de pas exact pour un `dt` donné, y compris irrégulier |
| `analysis/fft` | comparaison à une DFT naïve sur des signaux connus (impulsion, sinus, bruit) |
| `analysis/stft` | nombre de trames, alignement temporel, reconstruction du fenêtrage |
| `analysis/onset` | signal synthétique à onsets connus → positions à ± 6 ms |
| `analysis/tempo` | clic à 120 BPM exact → 120 ± 0,5, confiance > 0,9 |
| `analysis/tempo` (ambiguïté) | motif Trap synthétique à 70 BPM avec hats en 1/16 → doit retourner 70, pas 140 |
| `music/timeline` | `eventsBetween` aux bornes, tableaux vides, `nextEventOfType` en fin de morceau |
| `music/pmdi` | document valide accepté ; type d'événement inconnu ignoré sans erreur ; version future rejetée proprement |
| `behaviour/impulse` | décroissance identique à 30, 60 et 144 fps pour la même durée écoulée |
| `visual/viewport` | mêmes proportions en 16:9, 9:16 et 1:1 |
| `visual/flashlimiter` | séquence à 10 flashs/s → sortie conforme à ≤ 3 flashs/s |
| `project/migrate` | v1 → v2 sans perte ; version inconnue → erreur explicite |
| **architecture** | analyse des imports : aucune violation des règles de dépendance (`02_ARCHITECTURE`) |

Le test d'architecture est le moins spectaculaire et le plus rentable : il empêche la dérive
silencieuse qui transforme une architecture propre en plat de nouilles au bout de six mois.

---

## Niveau 2 — Vérité terrain de détection

### Corpus

22 extraits de 60 secondes, 2 par genre (Trap, Drill, R&B, Afrobeat, Boom Bap, Lofi, Jersey, House,
Hyperpop) plus 4 cas limites :

```
edge-01  morceau très calme, sans percussion nette      → doit basculer en régime continu
edge-02  très forte dynamique (silence → drop massif)
edge-03  volume très faible (−28 LUFS)                  → la normalisation doit compenser
edge-04  extrêmement dense (Hyperpop, ~40 onsets/s)
```

Sources : productions personnelles, musique sous licence libre, et **beats générés par PULSAR**
(pour lesquels la vérité terrain est exacte et gratuite — un avantage direct de l'écosystème).

### Annotation

Un outil interne (`tools/annotate/`) permet de taper les beats au clavier pendant la lecture, avec
correction de la latence d'entrée et alignement manuel fin. Les sections sont marquées à la main.

```
fixtures/
  trap-01.mp3
  trap-01.truth.json     { bpm, beats[], downbeats[], kicks[], snares[], sections[] }
```

### Métrique — F-mesure standard MIREX

```
tolérance ± 70 ms
précision = VP / (VP + FP)
rappel    = VP / (VP + FN)
F         = 2 · P · R / (P + R)
```

| Cible | Seuil MVP |
|---|---|
| Tempo (± 2 %) | **≥ 0,90** de réussite sur le corpus |
| Beats | **F ≥ 0,85** |
| Downbeats | **F ≥ 0,70** |
| Kicks | **F ≥ 0,80** |
| Snares | **F ≥ 0,70** |
| Hats | **F ≥ 0,65** |
| Frontières de sections (± 2 s) | **F ≥ 0,60** |

Ces seuils sont volontairement atteignables. Une F-mesure de 0,85 sur les beats correspond à l'état
de l'art des méthodes sans apprentissage — annoncer 0,95 serait un mensonge à soi-même.

Le banc s'exécute en une commande et produit un tableau par genre. **Aucune modification du moteur
d'analyse n'est fusionnée sans avoir fait tourner ce banc.** C'est ce qui empêche la régression
classique : « j'ai amélioré la détection en Trap » qui détruit le Lofi.

---

## Niveau 3 — Tests de rendu (golden)

### Déterminisme

```
1. rendu de 24 images à des t précis (0,0 · 3,7 · 12,48 · 45,2 · 88,9 s)
   chaque rendu part d'un reset complet + priming à 0,5 s / pas de 1/120 s
   (les couches needsDrawPriming sont primées par des draw() réels)
2. hachage de chaque image (PNG puis SHA-256)
3. second rendu, dans un ordre différent, avec des dt de frame différents
4. les hachages doivent être identiques
```

Le priming complet à l'étape 1 est **indispensable** : sans lui, les couches à état de framebuffer
(feedback, FlashLimiter) donneraient un résultat dépendant de l'ordre des rendus, et ce test serait
mathématiquement impossible à passer — le risque T1 se déclencherait par conception et non par bug.

Ce test échoue immédiatement dès qu'un `Math.random()` non seedé ou une dépendance à `Date.now()`
se glisse dans le moteur. C'est le filet de sécurité de la Loi 1.

### Équivalence preview / export

```
1. rendu de l'image à t = 12,48 s par le pipeline de preview
2. rendu de la même image par le pipeline d'export
3. différence pixel moyenne  ≤ 2 %   (la sonde temps réel introduit un écart borné)
4. différence pixel maximale ≤ 12 %  sur moins de 1 % des pixels
```

### Non-régression visuelle

Rendus de référence pour chaque style × chaque preset × 4 instants. Une différence supérieure à 1 %
échoue le test avec une image de comparaison. Les images de référence sont mises à jour
explicitement, jamais automatiquement — sinon le test ne teste plus rien.

---

## Niveau 4 — Tests de performance

Exécutés en CI sur machine fixe, avec seuils sur le p95 :

```
bench:render     scène Field, HIGH, 1080p, 600 images   → p95 ≤ 11 ms
bench:analysis   morceau de 4 min                        → ≤ 8 s
bench:export     60 s de 1080p60                         → ≤ 120 s
bench:memory     10 min chargé + 2 min de lecture        → pic ≤ 700 Mo
bench:leak       30 cycles charger/décharger             → dérive ≤ 5 Mo
```

Une régression de plus de 15 % sur un banc bloque la fusion. Le seuil est mis à 15 % et non 5 % pour
absorber le bruit des machines de CI sans neutraliser l'alerte.

---

## Niveau 5 — Tests manuels et compatibilité

### Matrice navigateurs

| Navigateur | Preview | Export WebCodecs | Export repli |
|---|---|---|---|
| Chrome / Edge 94+ | ✅ | ✅ | — |
| Firefox 130+ | ✅ | ⚠️ **à valider par `isConfigSupported`** — H.264 dépendant de la plateforme, AAC absent | repli partiel |
| Safari 26+ | ✅ | ✅ | — |
| Safari 16.4 – 18.7 | ✅ | ⚠️ partiel — tester au cas par cas | ✅ |
| Navigateurs antérieurs | ✅ | ❌ | ✅ |

**À l'import également.** Safari ne décode pas Ogg Vorbis via `decodeAudioData` : un `.ogg` y échoue
avec une `EncodingError`. Un test de décodabilité doit être fait à l'import, avec un message explicite
par format et par navigateur, plutôt qu'un échec silencieux.

| Format | Chrome/Edge | Firefox | Safari |
|---|---|---|---|
| MP3 | ✅ | ✅ | ✅ |
| WAV | ✅ | ✅ | ✅ |
| FLAC | ✅ | ✅ | ✅ |
| OGG Vorbis | ✅ | ✅ | ❌ |
| M4A / AAC | ✅ | ✅ | ✅ |

### Scénarios manuels obligatoires avant livraison

```
□ Import → lecture → export, sans toucher à rien
□ Seek pendant la lecture, en avant et en arrière, 20 fois de suite
□ Scrub rapide et continu sur la timeline pendant 30 secondes
□ Changement de preset en cours de lecture
□ Pause pendant 30 s puis reprise → la sync doit être exacte
□ Redimensionnement de la fenêtre pendant la lecture
□ Plein écran, entrée et sortie
□ Export annulé à 50 % → aucune fuite, l'interface reste utilisable
□ Import d'un fichier corrompu → message clair, aucun plantage
□ Import d'un fichier de 15 min → refus explicite avec la raison
□ Deux onglets ouverts simultanément
□ Lecture avec un casque Bluetooth → vérifier la compensation de latence
```

Le dernier point mérite d'être souligné : un casque Bluetooth ajoute typiquement 100 à 200 ms de
latence de sortie. Sans compensation d'`outputLatency`, la synchronisation — argument central du
produit — s'effondre sur la moitié des utilisateurs.

---

## Ce qui n'est pas automatisable

La qualité esthétique. Elle est encadrée par une **revue visuelle** avec une grille explicite :

```
□ Chaque effet a-t-il une relation identifiable avec la musique ?
□ Un observateur peut-il deviner où est le kick sans entendre le son ?
□ Les transitions de section sont-elles perceptibles sans être brutales ?
□ Le rendu est-il beau en pause, sur une image fixe ?
□ Y a-t-il un moment mort de plus de 4 secondes ?
□ La palette reste-t-elle cohérente sur toute la durée ?
□ Le rendu tient-il en 9:16 sans recadrage manuel ?
```

Le deuxième point est le meilleur test de synchronisation qui existe, et il ne coûte rien : couper le
son et regarder. Si le kick est invisible, le moteur ne fait pas son travail.
