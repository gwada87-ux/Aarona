# 04 — MOTEUR D'ANALYSE AUDIO

> Ce document couvre le traitement du signal *bas niveau* : de l'échantillon à la courbe de features.
> L'interprétation musicale (tempo, beats, sections) est traitée dans `05_MUSIC_INTELLIGENCE.md`.

## Décisions fondatrices

### Pourquoi hors-ligne et pas `AnalyserNode`

`AnalyserNode` a trois limites structurelles qui le disqualifient pour de la détection événementielle :

1. **Pas d'horodatage.** Il donne « le spectre maintenant », sans référence temporelle exploitable.
   On ne peut pas en tirer `{ t: 12.48 }`.
2. **Lissage imposé.** `smoothingTimeConstant` écrase précisément les transitoires qu'on cherche.
   Le mettre à 0 rend le signal instable sans le rendre horodaté.
3. **Relevé cadencé sur `rAF`.** Le nœud écrase son tampon interne en continu ; seul le moment où
   on le lit dépend du rafraîchissement écran. Un ralentissement de rendu fait donc *rater* des
   événements, définitivement.

Le fichier est intégralement connu avant lecture. Il n'y a donc aucune raison de deviner en direct
ce qu'on peut mesurer précisément à l'avance.

→ **L'analyse hors-ligne en Worker est le chemin unique pour tout ce qui est événementiel.**
`AnalyserNode` survit sous le nom de `RealtimeProbe`, avec un rôle strictement décoratif : ajouter du
micro-mouvement continu entre deux trames d'analyse en preview. Elle est **désactivée en export**.

### Pourquoi un DSP écrit maison

| Bibliothèque | Licence | Verdict |
|---|---|---|
| Essentia.js | **AGPL-3.0** (licence commerciale payante auprès de l'UPF) | ❌ contaminerait le produit |
| aubio (portages WASM) | GPL-3.0 | ❌ |
| `web-audio-beat-detector` | MIT | ⚠️ tempo uniquement, pas d'onsets typés, pas de confiance |
| `realtime-bpm-analyzer` | MIT | ⚠️ tempo temps réel, hors de notre modèle hors-ligne |

Aucune option permissive ne couvre le besoin. Et surtout : **la qualité de détection est le cœur de
valeur du produit.** La déléguer à une boîte noire, c'est déléguer l'avantage concurrentiel.

Le périmètre à écrire est parfaitement borné : FFT réelle, fenêtrage, bandes, flux spectral, seuil
adaptatif, autocorrélation, beat-tracking par programmation dynamique, matrice d'auto-similarité.
**Environ 900 lignes**, chacune comprise et testable.

---

## Chaîne de traitement

### Étape 0 — Préparation

```
AudioBuffer stéréo (44,1 ou 48 kHz)
   │
   ├─ mono = (L + R) / 2                     ← la détection rythmique n'a pas besoin du stéréo
   ├─ conservation de (L − R) pour la largeur stéréo   (V2)
   └─ rééchantillonnage → 22 050 Hz
```

**Pourquoi 22 050 Hz.** Le contenu utile pour la détection percussive plafonne autour de 11 kHz
(Nyquist = 11 025 Hz pour un échantillonnage à 22 050 Hz). Un hi-hat a l'essentiel de son énergie entre 6 et 11 kHz. Rééchantillonner
divise par deux le coût de toutes les étapes suivantes sans perte mesurable de qualité de détection.
Rééchantillonnage par filtre polyphase court, pas par décimation brute (qui replierait le spectre).

### Étape 1 — STFT

| Paramètre | Valeur | Justification |
|---|---|---|
| Fenêtre | **Hann, 1024 échantillons** (46,4 ms) | compromis classique ; assez court pour les transitoires, assez long pour séparer les graves |
| Hop | **128 échantillons** (5,8 ms) | résolution temporelle bien sous le budget de sync de 20 ms |
| Trames/s | **172** | |
| FFT | réelle, radix-2, taille 1024 | une FFT complexe sur signal réel gaspille la moitié du calcul |
| Sortie | magnitudes, 513 bins, résolution 21,5 Hz | |

Coût pour 4 minutes : 41 000 trames × FFT 1024 ≈ **1,5 à 2,5 s** dans un Worker. Acceptable.

Un recouvrement de 87,5 % (hop 128 sur fenêtre 1024) est volontairement généreux : c'est ce qui
donne des onsets précis. Le surcoût est absorbé par le rééchantillonnage à 22 kHz.

### ⚠️ Convention d'horodatage — à écrire avant la première ligne de DSP

C'est l'erreur la plus coûteuse possible sur ce moteur, parce qu'elle est **invisible** : tout marche,
tout est simplement décalé.

```
t_trame(i) = (i · hop + fenetre/2) / sr_analyse  −  retardGroupeResampler
```

- Le pic de flux spectral d'un transitoire apparaît quand celui-ci traverse le **centre** de la
  fenêtre. Horodater au bord gauche place **tous** les onsets 23,2 ms trop tôt (512 / 22 050).
  L'affinage à ±6 ms de l'étape 4 ne peut pas rattraper un biais systématique de 23 ms, et le budget
  de synchronisation total n'est que de 20 ms.
- Le filtre polyphase du rééchantillonnage (48 000 → 22 050, ratio 147/320) introduit son propre
  retard de groupe, égal à la moitié de la longueur du filtre. Il doit être **mesuré une fois** et
  soustrait, pas ignoré.

**Test unitaire obligatoire, écrit avant le reste :** une impulsion de Dirac placée à `t = 3,000 s`
dans un signal de silence doit produire un onset détecté à `3,000 s ± 2 ms`. Ce test échoue sur les
deux conventions fausses et sur un retard de groupe non compensé. Aucun autre travail DSP ne commence
avant qu'il ne passe.

### Étape 2 — Bandes d'énergie

```
sub      20 –   60 Hz    sub-basse, 808 profondes
bass     60 –  120 Hz    corps du kick
lowmid  120 –  400 Hz    corps du snare, basses médiums
mid     400 – 2000 Hz    voix, mélodies
himid  2000 – 6000 Hz    attaque du snare, présence
high   6000 – 11000 Hz   hats, cymbales, air
```

Ces frontières ne sont pas arbitraires : elles suivent la répartition réelle des éléments d'un beat
en Trap / Drill / House. La séparation `sub` / `bass` est ce qui permet de distinguer une 808 tenue
d'un kick percussif — distinction essentielle sur nos genres cibles.

Chaque bande est sommée en énergie (magnitude²), puis convertie en dB, puis normalisée par percentile
(voir Étape 5).

### Étape 3 — Features par trame

| Feature | Formule | Usage visuel |
|---|---|---|
| `rms` | √(moyenne des carrés) | énergie perçue |
| `peak` | max(\|x\|) sur la fenêtre | détection de saturation |
| `energy` | somme des magnitudes² | pilote `drive` |
| `centroid` | Σ(f·m) / Σm | pilote `brightness` — un morceau « brillant » aura des visuels plus clairs |
| `flatness` | moyenne géométrique / moyenne arithmétique | distingue bruit (hats, crashs) et tonal (basse, voix) — clé de la classification |
| `flux[band]` | Σ max(0, mₜ − mₜ₋₁) par bande | **base de toute la détection d'onsets** |
| `rolloff85` | fréquence sous laquelle se trouve 85 % de l'énergie | complément de brillance |

Le **flux spectral demi-redressé** est le cœur : on ne compte que les *augmentations* de magnitude,
car un onset est une apparition d'énergie, jamais une disparition. C'est ce détail qui fait la
différence entre un détecteur qui marche et un détecteur qui déclenche sur les fins de notes.

### Étape 4 — Détection d'onsets

Pour chaque bande, indépendamment :

```
0. NORMALISATION PRÉALABLE de l'ODF de la bande par son p95 sur tout le morceau
      → ODF sans dimension, dans 0..~1, indépendante du niveau de mastering
      (possible uniquement parce que l'analyse est hors-ligne — voir Étape 5)
1. lissage sur 3 trames
2. seuil adaptatif :
      seuil[i] = δ + λ · médiane( ODF[i−W … i+W] )
      W = 0,15 s (26 trames)   δ = 0,03 (plancher, en unités d'ODF normalisée)   λ ≈ 1,6
   la médiane (et non la moyenne) rend le seuil insensible aux pics eux-mêmes
3. sélection de pics : maximum local strict, au-dessus du seuil
4. période réfractaire par bande :
      sub/bass 60 ms · lowmid 50 ms · mid 45 ms · himid 40 ms · high 25 ms
   (un hat peut être doublé à 25 ms ; un kick, non)
5. force = (ODF − seuil) / max(seuil, δ), écrasée par tanh → 0..1
6. affinage temporel : recherche du maximum de l'enveloppe brute
   dans une fenêtre de ±6 ms autour de la trame détectée
```

Deux points qui produisent des `NaN` silencieux s'ils sont omis :

- **L'étape 0 doit précéder le seuillage.** Un « plancher absolu » sur une ODF en magnitude brute n'a
  aucun sens : il dépend du niveau de mastering, ce qui est précisément le problème que la
  normalisation résout. La passe globale est disponible puisqu'on travaille hors-ligne.
- **`max(seuil, δ)` au dénominateur.** Sur un passage silencieux (`edge-03` du corpus, −28 LUFS), le
  seuil tend vers zéro et `(ODF − seuil) / seuil` retourne `Infinity`, puis `NaN` propagé jusque dans
  `intensity` et de là dans le rendu.

L'étape 6 est ce qui ramène la précision de 5,8 ms (résolution du hop) à environ **2 ms**. Sur un
budget de sync de 20 ms, ce n'est pas superflu : c'est ce qui fait qu'un impact visuel « colle » au
lieu de « suivre ».

### Étape 5 — Normalisation

Un morceau masterisé à −6 LUFS et un enregistrement à −24 LUFS doivent produire les mêmes visuels.
Toute normalisation par valeur absolue est donc exclue.

```
Pour chaque piste de features :
   p05 = 5ᵉ percentile   p95 = 95ᵉ percentile   (sur tout le morceau)
   normalisé = clamp( (x − p05) / (p95 − p05), 0, 1 )
```

Les percentiles plutôt que min/max : un unique crash de cymbale ou un blanc au début ne doivent pas
écraser toute l'échelle. On accepte de saturer 5 % des trames en haut et en bas — ce qui est
exactement le comportement souhaité visuellement (les vrais pics doivent taper au maximum).

**Une nuance importante** : cette normalisation globale est calculée sur l'ensemble du morceau, ce
qui n'est possible que grâce à l'analyse hors-ligne. C'est un avantage direct et invisible du
choix architectural : un morceau qui monte progressivement conserve sa dynamique relative, au lieu
d'être aplati par un AGC temps réel.

### Étape 6 — Contour de basse

```
passe-bas Butterworth ordre 4 à 200 Hz
→ autocorrélation par fenêtre de 2048 échantillons, hop 512
→ f0 dans la plage 27,5 – 200 Hz (A0 – G3)
→ confiance = hauteur du pic d'autocorrélation normalisée
→ segmentation en notes : f0 stable (± 40 cents) pendant ≥ 80 ms
```

Sortie : des segments `{ t, dur, midi, confidence }`. Honnêtement, la fiabilité est de 60 à 80 % sur
un mix dense (la basse est masquée par le kick). C'est **suffisant pour piloter un mouvement lent
et une couleur**, insuffisant pour afficher des noms de notes. Le produit ne prétendra jamais faire
la seconde chose en Mode A.

---

## Mode temps réel (`RealtimeProbe`)

Périmètre volontairement minuscule.

```ts
class RealtimeProbe {
  // AnalyserNode, fftSize 2048, smoothingTimeConstant 0.6
  sample(): { bands: Record<BandId, number>; rms: number } | null;
  // null en export, ou si aucune source n'est connectée
}
```

Sa contribution est **pondérée à 25 % maximum** dans le `StepContext`, les 75 % restants venant des
`FeatureTracks` hors-ligne. Ce ratio est ce qui garantit que la preview et l'export se ressemblent :
la sonde ajoute de la vie, elle ne décide de rien.

En export, sa contribution est remplacée par la valeur des `FeatureTracks` à `t` — mathématiquement
équivalente, puisque la sonde mesure la même chose avec plus de bruit. L'écart résiduel est vérifié
par le test golden (`11_TESTING.md`).

---

## Configuration du coût CPU

Trois profils, sélectionnables (automatiquement par défaut selon la durée) :

| Profil | Hop | Résampl. | Structure | Temps pour 4 min |
|---|---|---|---|---|
| `fast` | 256 | 22,05 kHz | désactivée | ≈ 5,5 s |
| `balanced` (défaut) | 128 | 22,05 kHz | activée | ≈ 8 s |
| `precise` | 64 | 44,1 kHz | activée + affinage | ≈ 25 s |

(Décodage inclus, soit ≈ 2,5 s incompressibles dans les trois cas.)

`precise` n'apporte un gain mesurable que sur les morceaux à percussion complexe (Jersey, Hyperpop,
breakbeat). Il est proposé, jamais imposé.

---

## Ce que ce moteur ne fait pas, et ne fera pas en Mode A

- Séparation de sources (isoler la piste de batterie).
- Transcription polyphonique (notes, accords, mélodie).
- Reconnaissance de tonalité fiable sur un mix dense.
- Identification d'instruments au-delà des familles percussives.

Ces informations existent **exactement** en Mode B. Les approximer en Mode A produirait des visuels
qui réagissent à des fantômes — le pire résultat possible pour un produit dont l'argument est la
synchronisation.
