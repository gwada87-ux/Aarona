# 06 — SYSTÈME D'ÉVÉNEMENTS

## La correction centrale : timeline requêtable, pas bus push

Le brief initial décrivait un **MUSIC EVENT BUS** alimenté par le moteur audio et écouté par le
moteur visuel. Ce modèle *push* échoue sur trois exigences posées par le même brief :

| Exigence | Pourquoi un bus push échoue |
|---|---|
| `seek` | Le bus a déjà émis les événements passés. Revenir en arrière exige de rejouer l'historique. |
| Scrub de la timeline | À chaque mouvement de souris, il faudrait rembobiner tout le flux. |
| Export hors temps réel | Le rendu avance à 0,3× ou 3× la vitesse réelle ; le bus, lui, est cadencé par l'audio. |
| Anticipation | Un bus ne peut pas répondre à « quand est le prochain drop ? ». Impossible de construire une tension. |

**La source de vérité n'est pas un flux, c'est une structure indexée par le temps.**

```
        ┌──────────────────────────────────────────┐
        │            MusicTimeline                 │   immuable · O(log n)
        │  events[] triés  +  index par type       │
        │  featureTracks   +  sections  +  tempoMap│
        └──────────────────┬───────────────────────┘
                           │  requêtes
                           ▼
        ┌──────────────────────────────────────────┐
        │            EventDispatcher               │   consommateur, pas producteur
        │  window(tPrev, t) → événements traversés │
        └──────────────────┬───────────────────────┘
                           ▼
                     StepContext.fired[]
```

Le « bus » existe toujours, mais il est **en aval** et sans état durable : il compare deux instants et
émet la différence. C'est ce qui rend preview, scrub et export rigoureusement identiques.

---

## Vocabulaire d'événements

Fermé et versionné. Un type inconnu doit être **ignoré sans erreur** (compatibilité ascendante avec
les futures versions de PULSAR).

### Grille rythmique
| Type | Sens | Charge utile notable |
|---|---|---|
| `BEAT` | pulsation | `meta.indexInBar` (0–3) |
| `DOWNBEAT` | premier temps de la mesure | `meta.barIndex` |
| `BAR` | début de mesure | |
| `PHRASE` | début de phrase (4 ou 8 mesures) | `meta.bars` |

### Percussions
| Type | Sens |
|---|---|
| `KICK` | grosse caisse |
| `SNARE` | caisse claire |
| `CLAP` | clap |
| `HAT` | hi-hat (fermé ou ouvert, `meta.open`) |
| `PERC` | percussion non classée |
| `SUB_HIT` | attaque de 808 / sub |

### Macro-structure
| Type | Sens | Particularité |
|---|---|---|
| `SECTION` | changement de section | `meta.label`, `meta.letter`, `meta.energy` |
| `DROP` | rupture montante majeure | |
| `BUILDUP` | montée | **porte une `dur`** |
| `BREAK` | chute d'activité | **porte une `dur`** |
| `ENERGY_UP` / `ENERGY_DOWN` | variation notable | |
| `SILENCE` | coupure | **porte une `dur`** |

### Mode B uniquement (ignorés proprement en Mode A)
| Type | Sens |
|---|---|
| `NOTE_ON` / `NOTE_OFF` | note mélodique ou de basse |
| `CHORD` | changement d'accord |
| `PATTERN_CHANGE` | changement de motif dans PULSAR |
| `AUTOMATION` | point d'automation d'un paramètre |

---

## Structure d'un événement

```ts
interface MusicEvent {
  readonly t: number;              // secondes depuis le début de l'audio — référence absolue
  readonly type: EventType;
  readonly intensity: number;      // 0..1  — « à quel point »
  readonly confidence: number;     // 0..1  — « à quel point on en est sûr »
  readonly dur?: number;           // secondes, pour les événements à durée
  readonly band?: BandId;
  readonly source?: string;        // Mode B : nom de la piste PULSAR d'origine
  readonly meta?: Readonly<Record<string, number | string | boolean>>;
}
```

`intensity` et `confidence` sont **deux dimensions distinctes** et il ne faut jamais les confondre :

- un kick très fort mais ambigu → `intensity 0.95`, `confidence 0.55` → grand effet, mais atténué ;
- un hat discret parfaitement identifié → `intensity 0.20`, `confidence 0.98` → petit effet, net.

Le `BehaviourEngine` applique systématiquement :

```ts
effet = intensity × rampe(confidence)

rampe(c) =  0                      si c < 0.60      ← sous ce seuil, contribution
                                                      au régime continu uniquement
            (c − 0.60) / 0.25      si 0.60 ≤ c < 0.85
            1                      si c ≥ 0.85
```

---

## Interface de la timeline

```ts
interface MusicTimeline {
  readonly duration: number;
  readonly confidence: GlobalConfidence;

  // requêtes ponctuelles
  eventsBetween(t0: number, t1: number): readonly MusicEvent[];
  eventsOfTypeBetween(type: EventType, t0: number, t1: number): readonly MusicEvent[];

  // anticipation — ce qu'un bus push ne peut pas faire
  nextEventOfType(type: EventType, t: number): MusicEvent | null;
  prevEventOfType(type: EventType, t: number): MusicEvent | null;
  timeToNext(type: EventType, t: number): number;    // +Infinity si aucun

  // courbes continues
  featureAt(t: number, id: FeatureId): number;       // interpolation linéaire
  featureSlope(t: number, id: FeatureId, window: number): number;

  // grille
  tempoAt(t: number): number;
  beatPhaseAt(t: number): number;    // 0..1 dans le temps courant
  barPhaseAt(t: number): number;     // 0..1 dans la mesure courante
  beatIndexAt(t: number): number;

  // structure
  sectionAt(t: number): Section | null;
  sections(): readonly Section[];
}
```

### Implémentation des index

```
events[]                    tableau unique, trié par t
byType: Map<EventType, Int32Array>   indices dans events[], triés
```

`eventsBetween` = deux recherches binaires + une tranche. `nextEventOfType` = une recherche binaire
dans l'index de type. Pour 2 500 événements, chaque requête coûte moins d'une microseconde.

**Immuabilité.** La timeline est construite une fois puis gelée. Aucun code en aval ne peut la
modifier. C'est cette garantie qui rend le déterminisme démontrable plutôt qu'espéré.

---

## Le dispatcher

⚠️ **Le dispatcher est interrogé une fois par SOUS-PAS de simulation (1/120 s), pas une fois par
image.** Interroger par image appliquerait tous les événements de l'image au premier sous-pas :
jusqu'à 16,6 ms d'erreur à 60 fps, 33 ms à 30 fps, et une divergence entre une preview 60 fps et un
export 30 fps.

```ts
class EventDispatcher {
  private tPrev = 0;

  /** Appelé une fois par sous-pas, avec la borne haute du sous-pas. tPrev est interne. */
  collect(t: number): readonly MusicEvent[] {
    if (t < this.tPrev) {                 // seek arrière
      this.tPrev = t;
      return EMPTY;                        // aucun événement rejoué : c'est reset() qui gère
    }
    if (t - this.tPrev > MAX_WINDOW) {    // seek avant, ou reprise après onglet en arrière-plan
      this.tPrev = t - MAX_WINDOW;         // on ne déverse pas 100 événements d'un coup
    }
    const out = this.timeline.eventsBetween(this.tPrev, t);
    this.tPrev = t;
    return out;
  }
}
```

`MAX_WINDOW = 0,25 s`. Sans ce garde-fou, un basculement d'onglet de 3 secondes produirait une salve
d'une trentaine d'événements sur une seule frame — et jusqu'à 120 sur un morceau très dense — visuellement, une explosion parasite. Avec lui, on perd
quelques événements pendant une interruption, ce qui est strictement invisible.

Le dispatcher **n'a pas d'abonnés**. Il retourne une valeur. Aucun `EventEmitter`, aucun callback,
aucun ordre d'exécution implicite entre couches. Le `StepContext` transporte le résultat.

---

## Où le pattern observateur reste légitime

Un `EventEmitter` typé subsiste dans `core/bus/`, mais **uniquement pour les événements applicatifs**,
jamais musicaux :

```
analysis:progress · analysis:done · analysis:failed
project:loaded · project:dirty
export:progress · export:done · export:failed
preset:changed · quality:downgraded
```

Ceux-là sont asynchrones, non déterministes et sans rapport avec le temps musical. Les mélanger avec
les événements musicaux serait précisément l'erreur d'architecture que ce document corrige.

---

## Anticipation : l'usage qui justifie tout ce chapitre

```ts
// Dans une couche visuelle : construire une tension vers le prochain drop
const dropIn = frame.timeline.timeToNext("DROP", frame.t);
const tension = dropIn < 4 ? 1 - dropIn / 4 : 0;
// → convergence progressive des particules, montée du glow, resserrement du cadrage
```

Aucune architecture push ne permet cette ligne. C'est pourtant l'effet qui distingue un visualizer
qui *réagit* d'un visualizer qui *accompagne* — et le second se vend, pas le premier.
