# 02 — ARCHITECTURE

## Principe directeur

> Le moteur visuel est une **fonction pure** qui prend un instant musical et rend une image.
> Tout le reste du système existe pour lui fournir cet instant, quelle que soit sa provenance.

```
image = render( StepContext(t) )
```

Deux corollaires portent toute l'architecture :

1. **Déterminisme** — même `t`, même image. Preview, scrub et export partagent le même code et
   produisent le même résultat. C'est ce qui rend l'export possible.
2. **Indifférence à la source** — un `StepContext` construit depuis un MP3 analysé et un
   `StepContext` construit depuis les données PULSAR sont du même type. Le visuel ne fait pas la
   différence.

## Vue en couches

```
╔═══════════════════════════════════════════════════════════════════════╗
║  SOURCES                                                              ║
║   FileSource (MP3/WAV/OGG/FLAC)          PmdiFileSource (Mode B)      ║
║   PmdiLiveSource (V3)                                               ║
╚═══════════════════════════╤═══════════════════════════════════════════╝
                            │
╔═══════════════════════════▼═══════════════════════════════════════════╗
║  ANALYSIS  (Web Worker · hors-ligne · Mode A uniquement)              ║
║   decode → STFT → features → onsets → tempo → beats → downbeats       ║
║          → descripteurs d'onsets → bassline → structure               ║
║   Sortie : document PMDI                                              ║
╚═══════════════════════════╤═══════════════════════════════════════════╝
                            │
╔═══════════════════════════▼═══════════════════════════════════════════╗
║  MUSIC  — SOURCE DE VÉRITÉ                                            ║
║   MusicTimeline  (immuable, indexée par le temps)                     ║
║     eventsBetween(t0,t1)  featureAt(t,id)  sectionAt(t)               ║
║     beatPhaseAt(t)  barPhaseAt(t)  tempoAt(t)                         ║
╚═══════════════════════════╤═══════════════════════════════════════════╝
                            │
      Transport ───────────▶│◀─────────── RealtimeProbe (preview seule)
      (horloge unique)      │
                            ▼
                   ┌─────────────────┐
                   │  StepContext   │  état musical immuable à l'instant t
                   └────────┬────────┘
                            ▼
╔═══════════════════════════════════════════════════════════════════════╗
║  BEHAVIOUR                                                            ║
║   musique → signaux visuels normalisés (0..1), amortis, sans unité    ║
║   impulses · envelopes · continuous · trends                          ║
╚═══════════════════════════╤═══════════════════════════════════════════╝
                            ▼
╔═══════════════════════════════════════════════════════════════════════╗
║  VISUAL                                                               ║
║   Scene = liste ordonnée de Layers · Composer · Palette · Viewport    ║
╚═══════════════════════════╤═══════════════════════════════════════════╝
                            ▼
╔═══════════════════════════════════════════════════════════════════════╗
║  RENDER                                                               ║
║   Renderer (interface) → Canvas2DRenderer  [ WebGL2Renderer en V2 ]   ║
║   FlashLimiter (dernier étage, non contournable)                      ║
╚═══════════════════════════╤═══════════════════════════════════════════╝
                            ▼
              PreviewSink              ExportSink
              (rAF, temps réel)        (frame par frame, hors temps réel)
```

## Règles de dépendance

Vérifiées par un test d'architecture automatisé (`tests/unit/architecture.test.ts`), qui parcourt
les imports et échoue si une règle est violée.

| Couche | Peut importer | Ne peut jamais importer |
|---|---|---|
| `core/` | rien | tout le reste |
| `audio/` | `core` | `visual`, `analysis`, `ui` |
| `analysis/` | `core`, `music/pmdi` | `visual`, `audio`, `ui`, **`presets`** |
| `music/` | `core` | `visual`, `audio`, `analysis`, `ui` |
| `behaviour/` | `core`, `music` | `visual`, `render`, `audio` |
| `visual/` | `core`, `behaviour`, `music` (types), `render` (interface) | `audio`, `analysis`, `ui` |
| `render/` | `core` | tout domaine métier |
| `export/` | tout sauf `ui` | `ui` |
| `ui/` | tout | — |

Le point important : **`visual/` ne connaît pas l'existence de l'audio.** C'est ce qui rend le
moteur testable sans son et interchangeable entre Mode A et Mode B.

## Les cinq objets qui structurent tout

### 1. `Transport` — l'horloge unique

Seul objet du système autorisé à lire une horloge réelle. Il expose `t` (secondes depuis le début du
morceau) et `dt`. En preview, `t` est dérivé de l'horloge audio avec compensation de latence de
sortie. En export, `t = frame / fps`. **Tout le reste du système ne connaît que le `t` reçu.**

```ts
interface Transport {
  readonly t: number;
  readonly dt: number;
  readonly playing: boolean;
  play(): void; pause(): void; seek(t: number): void;
}
```

### 2. `MusicTimeline` — la source de vérité, immuable

Structure indexée par le temps, construite une fois, jamais mutée. Toutes les requêtes sont en
`O(log n)` par recherche binaire. Extrait de l'interface — **la surface complète est spécifiée dans
`06_EVENT_SYSTEM.md`**.

```ts
interface MusicTimeline {
  readonly duration: number;
  readonly confidence: GlobalConfidence;      // tempo, grille, classification
  eventsBetween(t0: number, t1: number): readonly MusicEvent[];
  eventsOfTypeBetween(type: EventType, t0: number, t1: number): readonly MusicEvent[];
  featureAt(t: number, id: FeatureId): number;      // interpolation linéaire
  sectionAt(t: number): Section | null;
  tempoAt(t: number): number;
  beatPhaseAt(t: number): number;   // 0..1 dans le temps
  barPhaseAt(t: number): number;    // 0..1 dans la mesure
  nextEventOfType(type: EventType, t: number): MusicEvent | null;   // anticipation
}
```

`nextEventOfType` est ce qui permet aux **anticipations** — un buildup visuel qui monte vers un drop
situé 4 secondes plus loin. Impossible avec un bus push. C'est une des raisons de ce choix.

### 3. `StepContext` — l'état musical à un pas de simulation

⚠️ **Construit une fois par SOUS-PAS de simulation (1/120 s), jamais une fois par image.**

C'est un point qu'il est facile de rater et qui casse tout le déterminisme. Si les événements sont
collectés par image alors que la physique avance par sous-pas, un kick est appliqué au premier
sous-pas de l'image qui le contient : erreur allant jusqu'à 16,6 ms à 60 fps et **33 ms à 30 fps**.
Un export en 30 fps ne reproduirait alors pas une preview en 60 fps — exactement ce que le pas fixe
était censé garantir. De plus, `Impulse.fire()` utilisant `max`, deux hats tombant dans la même image
en écraseraient un.

```ts
interface StepContext {
  readonly t: number;                       // temps du sous-pas
  readonly dt: number;                      // TOUJOURS 1/120
  readonly stepIndex: number;               // round(t * 120) — entier, indépendant du fps
  readonly fired: readonly MusicEvent[];    // événements traversés PAR CE SOUS-PAS
  readonly bands: Readonly<Record<BandId, number>>;   // 0..1, lissés
  readonly energy: number;
  readonly beat: { phase: number; index: number; confidence: number };
  readonly bar:  { phase: number; index: number };
  readonly section: Section | null;
  readonly regime: "event" | "continuous";
  readonly rng: Rng;                        // seed = hash(projectSeed, stepIndex)
  readonly timeline: MusicTimeline;         // lecture seule, pour l'anticipation
}
```

**La graine du PRNG.** `seed = hash(projectSeed, stepIndex)` et rien d'autre. Trois erreurs à éviter,
qui se ressemblent et n'ont pas les mêmes conséquences :

| ❌ Erreur | Conséquence |
|---|---|
| `reseed(floor(t * 1000))` | dépend du fps (16, 33, 50… à 60 fps ; 33, 66… à 30 fps) → preview ≠ export |
| `reseed(projectSeed)` une seule fois au départ | le flux dépend du nombre de tirages consommés depuis le début → un seek casse tout |
| oublier `projectSeed` dans le hachage | la graine du projet n'a aucun effet, le bouton « Nouvelle variante » ne change rien |

`stepIndex` est un entier dérivé du temps musical, indépendant du fps et du nombre d'images rendues.
C'est la seule formulation qui satisfasse à la fois le seek, le changement de fps et la variante.

### 4. `Layer` — l'unité visuelle composable

```ts
interface Layer {
  readonly id: string;
  readonly kind: LayerKind;
  readonly needsDrawPriming: boolean;   // true si l'état dépend d'images précédentes
  params: LayerParams;
  init(ctx: LayerInitContext): void;
  update(s: StepContext, signals: VisualSignals): void;   // état, jamais de dessin
  draw(r: Renderer, viewport: Viewport): void;            // dessin, jamais de calcul d'état
  reset(t: number): void;                                 // appelé sur seek
  dispose(): void;
}
```

`needsDrawPriming` distingue **deux natures d'état** que le rattrapage après seek ne traite pas de la
même façon :

- **état de simulation** (positions de particules, enveloppes, phases) — reconstruit par des appels
  successifs à `update()`. C'est le cas général, `needsDrawPriming = false` ;
- **état de framebuffer** (le feedback du style `Field` redessine l'image précédente ; le
  `FlashLimiter` compare à la luminance de l'image précédente) — **ne peut pas** être reconstruit par
  `update()` seul, puisqu'il dépend de ce qui a été *dessiné*. Ces couches déclarent
  `needsDrawPriming = true` et sont primées par des `draw()` complets, à résolution réduite, sur la
  fenêtre de rattrapage.

Sans cette distinction, le buffer de feedback est vide après chaque seek et le test golden « mêmes
images rendues dans un ordre différent » est mathématiquement impossible à passer — le signal
d'alerte du risque T1 serait déclenché par la conception elle-même, pas par un bug.

La séparation `update` / `draw` est obligatoire : en export, `update` peut être appelé plusieurs fois
(rattrapage à pas fixe) pour un seul `draw`.

`reset(t)` est ce qui rend le seek correct : chaque couche sait revenir à un état cohérent pour un
instant donné.

### 5. `Renderer` — l'abstraction de dessin

Interface volontairement étroite : environ 15 opérations. Cette étroitesse est le prix à payer pour
qu'un backend WebGL2 puisse être ajouté en V2 sans réécrire les couches.

```ts
interface Renderer {
  beginFrame(vp: Viewport): void;
  clear(color: Color): void;
  pushLayer(blend: BlendMode, alpha: number): void;   // rendu hors écran
  popLayer(): void;
  fillRect(...): void; fillCircle(...): void; strokePath(...): void;
  drawSprite(sprite: SpriteHandle, transforms: Transform[]): void;   // instancié
  drawText(...): void;
  createSprite(draw: (ctx: OffscreenCanvasRenderingContext2D) => void, size: number): SpriteHandle;
  endFrame(): void;
}
```

`drawSprite` accepte un **tableau de transformations** plutôt qu'un appel par objet : c'est ce qui
permet d'écrire une couche de 3 000 particules une seule fois et de la faire tourner aussi bien sur
le backend Canvas 2D (boucle `drawImage`) que sur un futur backend WebGL2 (un seul appel instancié).

**Réalisé à l'Étape 9/P7** (ce croquis était illustratif) : `strokeCircle`, `strokePath` (tableaux
typés parallèles, zéro allocation), `fillRadialGradient`, `createSprite`/`drawSprite` et
`applyShake` (décalage global — voir `07_VISUAL_ENGINE.md` §"Table de câblage" et
`docs/JOURNAL.md` Étape 9 pour le raisonnement complet). `pushLayer`/`popLayer` et `drawText`
restent différés : aucune couche du style `Pulse` n'en a besoin — premiers vrais besoins
respectivement en P9 (`Field`, feedback) et P12 (couche `Text`). `fillRect` n'a pas été ajouté non
plus : sans consommateur (le fond de `Pulse` est un dégradé radial, pas un rectangle).

**Complété à l'Étape 11/P9** (`Field`/`Spectrum Pro`) : `fillPath` (polygone plein, tableaux
typés — les barres de `Spectrum Pro` ; `fillRect` seul n'aurait pas suffi non plus, remplacé par
ce primitif plus général). `drawSprite` prend désormais un `count` séparé (comme `strokePath`) :
le pool de 2500 particules de `Field` pré-alloue son tableau de transformations et le mute en
place, un `.slice()` par image aurait été une allocation. `strokePath` prend un `closed: boolean`
(la ligne d'onde plate de `Spectrum Pro` ne doit pas se refermer, contrairement au cercle de
`Pulse`). `pushLayer`/`popLayer` restent différés : le besoin concret rencontré (le feedback de
`Field`) s'est avéré plus spécifique — voir `drawFeedback`/`captureFeedback`, ajoutées à sa place
(`docs/JOURNAL.md`, Étape 11).

## Traitement du `seek` — le cas qui casse tout le monde

```
seek(t)
  1. Transport.seek(t)                  → l'horloge saute
  2. scene.reset(t) · behaviour.reset(t)
        les enveloppes et amortissements repartent à leur valeur d'équilibre
        pour ce t, pas à zéro
  3. rattrapage : N sous-pas de 1/120 s depuis  max(t − PRIME_WINDOW, 0)
        à chaque sous-pas : rng.reseed(hash(projectSeed, stepIndex))
                            dispatcher.collect(tSousPas)
                            behaviour.update() · scene.update()
        pour les couches needsDrawPriming : scene.draw() à résolution réduite (0,4×)
  4. render(t) à résolution pleine
```

**Deux fenêtres de rattrapage, et c'est nécessaire :**

| Contexte | `PRIME_WINDOW` | Sous-pas | Coût |
|---|---|---|---|
| Seek relâché (clic sur la timeline) | **0,5 s** | 60 | ≈ 90 ms — acceptable, ponctuel |
| Scrub continu (glissement de souris) | **0,15 s** | 18 | ≈ 28 ms — tient le budget de 40 ms/saut |
| Test golden | 0,5 s, à 1/120 strict | 60 | déterministe, non contraint par le temps |

Le rattrapage évite le « saut mort » : sans lui, un champ de particules apparaît figé pendant une
demi-seconde. Mais 60 sous-pas coûtent environ 90 ms, ce qui est incompatible avec le budget de scrub
de 40 ms fixé dans `10_PERFORMANCE.md` — d'où la fenêtre réduite pendant un glissement, où l'exactitude
de l'inertie importe peu puisque l'image change en permanence.

Le priming à fenêtre courte n'est **pas** bit-exact vis-à-vis d'une lecture continue. C'est assumé et
documenté : le test golden, lui, prime toujours à 0,5 s / 1/120 s.

## Comment le Mode B se branchera (sans rien changer)

```
Mode A :  fichier → AnalysisPipeline (Worker) → document PMDI → MusicTimeline
Mode B :  PULSAR  →                             document PMDI → MusicTimeline
Mode C :  PULSAR live → événements planifiés   → MusicTimeline mutable à fenêtre glissante  (V3)
```

Le seul point de contact est le document PMDI (voir `12_INTEGRATION_PULSAR.md`). Tout ce qui est en
aval de `MusicTimeline` est déjà commun.

## Décisions d'architecture (ADR)

Résumées ici, détaillées dans `15_ADR.md`.

| ADR | Décision | Motif principal |
|---|---|---|
| 001 | TypeScript strict + Vite, sans framework UI | Le contrat PMDI et le format projet doivent être typés ; l'UI est un panneau de contrôles, pas une application à état complexe |
| 002 | Canvas 2D, `Renderer` abstrait, WebGL2 en V2 sous critère chiffré | Suffisant avec les bonnes techniques ; évite un mois de plomberie GPU avant le premier pixel |
| 003 | Analyse hors-ligne en Worker, DSP maison | `AnalyserNode` ne peut pas horodater ; les bibliothèques de référence sont AGPL |
| 004 | `MusicTimeline` requêtable plutôt que bus push | Seek, scrub, export et anticipation |
| 005 | WebCodecs + Mediabunny, `MediaRecorder` en repli | Déterminisme et qualité ; ~92 % de couverture navigateur |
| 006 | Local pur, licence par clé, watermark honnête | Cohérent avec « aucun serveur » ; l'inviolabilité est illusoire côté client |
| 007 | Licences MIT/BSD/Apache-2.0/MPL-2.0 exclusivement | AGPL d'Essentia et GPL de x264 contamineraient le produit |
| 008 | IndexedDB + fichier `.pvproj` versionné | Persistance locale et échange de projet |
| 009 | PMDI v1.0, tolérant à l'inconnu | Permet à PULSAR d'évoluer sans casser le visualizer |
| 010 | `FlashLimiter` intégré au pipeline de rendu | Sécurité photosensible (WCAG 2.3.1), protection juridique et argument produit |
