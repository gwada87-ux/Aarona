# 10 — PERFORMANCE

## Machine de référence

Toutes les cibles chiffrées de ce document sont mesurées sur :

```
Portable milieu de gamme 2021 · CPU 4 cœurs · GPU intégré · 16 Go
Chrome stable · écran 1080p 60 Hz · alimentation secteur
```

Une machine plus modeste doit rester **utilisable** grâce au `QualityGovernor`, pas exclue.

## Budget par image (60 fps → 16,6 ms)

| Étape | Cible | Plafond dur |
|---|---|---|
| Transport + sonde | 0,5 ms | 1,0 ms |
| `StepContext` | 0,5 ms | 1,0 ms |
| `BehaviourEngine` | 1,0 ms | 1,5 ms |
| `Scene.update` | 3,0 ms | 4,5 ms |
| `Scene.draw` | 9,0 ms | 11,0 ms |
| `FlashLimiter` | 1,0 ms | 1,5 ms |
| Présentation + stats | 1,0 ms | 1,5 ms |
| **Total** | **16,0 ms** | **marge 0,6 ms** |

Un budget consommé à 96 % peut sembler tendu. C'est volontaire : un budget confortable produit du
code paresseux, et la marge réelle vient du `QualityGovernor`.

---

## Les quatre niveaux de qualité

| | LOW | MEDIUM | HIGH | ULTRA |
|---|---|---|---|---|
| Particules | 400 | 1 200 | 2 500 | 5 000 |
| Bloom | ✗ | 1/8, 1 passe | 1/4, 2 passes | 1/2, 2 passes |
| Feedback | ✗ | ✗ | ✓ | ✓ |
| Décalage chromatique | ✗ | ✗ | ✓ | ✓ |
| Résolution interne | 0,6× | 0,8× | 1,0× | 1,0× |
| Bandes de spectre | 32 | 48 | 64 | 96 |
| Pas de simulation | **1/120** | **1/120** | **1/120** | **1/120** |

**Point de vigilance sur le déterminisme.** Ce tableau fait varier bien plus que la charge : le pas
de simulation, le nombre de particules, le feedback, la résolution interne et le nombre de bandes
changent le **contenu de l'image**, pas seulement son coût. Deux règles en découlent, et elles ne sont
pas optionnelles :

1. **Le pas de simulation ne varie JAMAIS.** Il vaut 1/120 s à tous les niveaux de qualité, y
   compris LOW. Le faire varier casserait `stepIndex = round(t · 120)`, donc la reproductibilité du
   PRNG, donc le test golden. Le gain de performance qu'on en tirerait est marginal ; le coût en
   déterminisme est total. Sur machine modeste, on réduit les particules et les effets, pas le pas.
2. **L'export fige le niveau de qualité** à celui choisi dans son dialogue (HIGH par défaut) et
   **désactive le QualityGovernor** pour toute sa durée.

Sans la seconde règle, un gouverneur ayant rétrogradé la preview en LOW pendant qu'on lance un export
en HIGH produit une vidéo qui n'a plus rien à voir avec ce qui était affiché — et le test
d'équivalence preview/export échoue de plusieurs dizaines de pour cent.

**Le nombre de particules est défini à trois endroits.** Ordre de résolution imposé :
`preset.layers.particles.count` → modulé par la macro `density` → **plafonné** par le niveau de
qualité. Le plafond est le seul étage autorisé à varier en preview.

---

## QualityGovernor

```ts
class QualityGovernor {
  // fenêtre glissante de 90 images
  // p95 > 20 ms pendant 2 s consécutives  → descendre d'un niveau
  // p95 < 12 ms pendant 8 s consécutives  → remonter d'un niveau (une seule fois par minute)
  // le niveau choisi manuellement par l'utilisateur n'est jamais remonté automatiquement
}
```

Choix des seuils :

- **p95 et non moyenne** — une saccade toutes les 20 images est perçue comme un défaut alors que la
  moyenne reste bonne ;
- **descente rapide (2 s), remontée lente (8 s)** — l'oscillation entre deux niveaux est plus
  désagréable qu'un niveau légèrement trop bas ;
- **remontée bridée à une fois par minute** — évite le va-et-vient sur une charge fluctuante.

Chaque changement automatique est annoncé discrètement dans l'UI. Un utilisateur qui voit son rendu
se simplifier sans explication conclut à un bug.

---

## Règles d'écriture non négociables

### Zéro allocation dans la boucle de rendu

C'est la première cause de saccade sur ce type d'application. Un passage du ramasse-miettes coûte
8 à 30 ms — deux images perdues, systématiquement au mauvais moment.

```
❌  const p = { x, y, vx, vy };  particles.push(p);
❌  ctx.fillStyle = `rgba(${r},${g},${b},${a})`;      ← allocation de chaîne par appel
❌  arr.map(...).filter(...)                          ← deux tableaux par image
❌  { ...state, value }                                ← objet par image

✅  Float32Array parallèles, pool fixe, index libres
✅  chaînes de couleur pré-calculées, ou cache indexé
✅  boucles for classiques sur les chemins chauds
✅  mutation d'objets pré-alloués
```

Le `StepContext` est l'exception assumée : un objet par **sous-pas**, réutilisé par mutation interne
plutôt que recréé. C'est 120 objets par seconde, soit un coût négligeable pour un gain de clarté
important.

### Canvas 2D

```
❌  ctx.shadowBlur                        → sprite pré-rendu additif
❌  ctx.save()/restore() en boucle serrée → transformations manuelles
❌  ctx.arc() par particule               → drawImage d'un atlas
❌  ctx.getImageData() par image          → sous-échantillonnage 32×18 pour le FlashLimiter
❌  gradient recréé par image             → mis en cache, invalidé au changement de palette
```

### Découpage du travail

| Travail | Où | Pourquoi |
|---|---|---|
| Analyse audio | Worker | 8 s de calcul bloquerait tout |
| Décodage audio | thread principal | `decodeAudioData` y est déjà asynchrone |
| Pics de waveform | Worker | traite le même tampon, déjà transféré |
| Rendu de preview | thread principal | Canvas 2D visible ; `OffscreenCanvas` en V2 |
| Rendu d'export | thread principal (V1), Worker (V2) | libère l'onglet pendant un long export |

---

## Le moniteur de performance

Toujours collecté (coût < 0,1 ms), affiché à la demande.

```
FPS       58,2   (p50 16,1 ms · p95 19,4 ms · p99 24,8 ms)
Rendu     9,4 ms   ██████████░░░░░
Update    2,8 ms   ███░░░░░░░░░░░░
Particules  2 486 / 2 500
Couches   7 actives
Mémoire   248 Mo JS heap
Qualité   HIGH   (auto)
Sync      +4,2 ms   ✅
```

La ligne **Sync** est la plus importante du panneau et devrait rester visible même hors mode debug,
au moins pendant le développement : c'est la mesure directe de la promesse du produit.

---

## Optimisations décidées à l'avance

| Technique | Gain estimé | Quand |
|---|---|---|
| Sprites pré-rendus pour le glow | ×6 sur les particules | dès le départ |
| Bloom à 1/4 de résolution | ×16 sur le post-traitement | dès le départ |
| Rééchantillonnage à 22 kHz pour l'analyse | ×2 sur l'analyse | dès le départ |
| `Float32Array` pour les particules | ×3, plus de saccades GC | dès le départ |
| Culling hors safe area | ×1,2 à ×2 selon la scène | phase 12 |
| Fond statique mis en cache | ×1,3 sur les scènes à fond fixe | phase 12 |
| `OffscreenCanvas` en Worker | thread principal libéré | V2 |
| `WebGL2Renderer` | ×5 à ×10 sur les particules | V2, sous critère chiffré |

---

## Cas de charge à tester explicitement

| Cas | Attendu |
|---|---|
| Morceau de 10 min | analyse ≤ 20 s, mémoire ≤ 700 Mo |
| Hyperpop très dense (≈ 40 onsets/s) | pas d'explosion du nombre de particules ; limite par image |
| Redimensionnement continu de la fenêtre | pas de réallocation par image (débounce 150 ms) |
| Changement de preset en lecture | ≤ 1 image perdue, transition lissée |
| Scrub rapide sur la timeline | ≤ 40 ms par saut (fenêtre de priming réduite à 0,15 s), aucune fuite |
| Onglet en arrière-plan 5 min puis retour | resynchronisation immédiate, aucune salve d'événements |
| Export pendant lecture d'une autre application audio | aucun impact (l'export ne dépend pas de l'audio en direct) |
| 2 heures d'utilisation continue | mémoire stable (pas de dérive) |

Le dernier cas est le plus révélateur : une fuite de 2 Mo par minute est invisible en démo et rend le
produit inutilisable en session de travail réelle.
