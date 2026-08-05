/**
 * Collecte des statistiques de performance — perf/PerfMonitor
 * (docs/10_PERFORMANCE.md §"Le moniteur de performance") :
 *
 *   "Toujours collecté (coût < 0,1 ms), affiché à la demande."
 *
 *   FPS       58,2   (p50 16,1 ms · p95 19,4 ms · p99 24,8 ms)
 *   Rendu     9,4 ms
 *   Update    2,8 ms
 *
 * Ne couvre QUE la partie « chronométrage d'image » de cette section : FPS,
 * p50/p95/p99 du temps d'image total, et la répartition Update/Rendu — ce
 * sont des statistiques pures calculables à partir de nombres fournis par
 * l'appelant, donc testables unitairement sans navigateur (voir discipline
 * de testabilité du projet). Les autres lignes du panneau debug de docs/10
 * (Particules, Couches, Mémoire, Qualité, Sync) dépendent d'un état déjà
 * détenu ailleurs (ParticleField, QualityGovernor, `performance.memory`) et
 * seront assemblées directement dans `ui/App.ts` (Étape 16/P14, tâche
 * câblage) plutôt que dupliquées ici.
 *
 * Fenêtre glissante de 90 images — même taille que `QualityGovernor` (non
 * imposée explicitement par docs/10 pour ce module, mais choisie par
 * cohérence : les deux couvrent la même fenêtre temporelle d'environ 1,5 s
 * à 60 fps, donc "Qualité" et "FPS/p95" affichés côte à côte dans le panneau
 * debug décrivent la même période).
 *
 * **Zéro allocation par image** (docs/10 §"Règles d'écriture non
 * négociables", et cette section précise elle-même que son propre coût doit
 * rester < 0,1 ms) : tampon circulaire sur `Float32Array` de taille fixe,
 * écriture par index — pas de `push`/`shift` sur tableau JS. Le calcul des
 * percentiles (qui alloue, via `percentile()`) n'a lieu que dans
 * `snapshot()`, appelée à la demande d'affichage et non à chaque image.
 */
import { median, percentile } from '../core/math/percentile';

const WINDOW_SIZE = 90;

export interface PerfFrameSample {
  readonly frameTimeMs: number;
  readonly updateMs: number;
  readonly renderMs: number;
}

export interface PerfSnapshot {
  /**
   * Moyenne sur la fenêtre (`1000 / temps d'image moyen`), délibérément
   * DISTINCTE de `p50Ms` : docs/10 montre "FPS 58,2 (p50 16,1 ms …)" où
   * 1000/58,2 ≈ 17,2 ms ≠ 16,1 ms — la moyenne est plus sensible aux images
   * lentes isolées que la médiane, ce qui est précisément l'écart que le
   * panneau veut donner à voir (un chiffre "vécu" à côté d'un chiffre
   * "typique").
   */
  readonly fps: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  /** Médiane sur la fenêtre — statistique robuste, cohérente avec le choix p95 du `QualityGovernor`. */
  readonly updateMs: number;
  readonly renderMs: number;
  readonly sampleCount: number;
}

const EMPTY_SNAPSHOT: PerfSnapshot = Object.freeze({
  fps: 0,
  p50Ms: 0,
  p95Ms: 0,
  p99Ms: 0,
  updateMs: 0,
  renderMs: 0,
  sampleCount: 0,
});

/** Tampon circulaire à taille fixe — écrit par index, jamais de `push`/`shift`. */
class RingBuffer {
  private readonly buf: Float32Array;
  private cursor = 0;
  private filled = 0;

  constructor(size: number) {
    this.buf = new Float32Array(size);
  }

  push(value: number): void {
    this.buf[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.buf.length;
    if (this.filled < this.buf.length) this.filled++;
  }

  /** Vue sur les valeurs remplies (ordre non garanti — sans importance pour des statistiques). */
  values(): Float32Array {
    return this.filled < this.buf.length ? this.buf.subarray(0, this.filled) : this.buf;
  }

  get count(): number {
    return this.filled;
  }
}

export class PerfMonitor {
  private readonly frameTimes = new RingBuffer(WINDOW_SIZE);
  private readonly updateTimes = new RingBuffer(WINDOW_SIZE);
  private readonly renderTimes = new RingBuffer(WINDOW_SIZE);

  recordFrame(sample: PerfFrameSample): void {
    this.frameTimes.push(sample.frameTimeMs);
    this.updateTimes.push(sample.updateMs);
    this.renderTimes.push(sample.renderMs);
  }

  /** Calcule l'instantané courant — coût non négligeable (tri), à appeler seulement à l'affichage. */
  snapshot(): PerfSnapshot {
    const count = this.frameTimes.count;
    if (count === 0) return EMPTY_SNAPSHOT;

    const frames = this.frameTimes.values();
    let sum = 0;
    for (let i = 0; i < frames.length; i++) sum += frames[i]!;
    const meanFrameMs = sum / frames.length;

    return {
      fps: meanFrameMs > 0 ? 1000 / meanFrameMs : 0,
      p50Ms: percentile(frames, 0.5),
      p95Ms: percentile(frames, 0.95),
      p99Ms: percentile(frames, 0.99),
      updateMs: median(this.updateTimes.values()),
      renderMs: median(this.renderTimes.values()),
      sampleCount: count,
    };
  }
}
