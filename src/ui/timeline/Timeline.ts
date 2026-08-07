/**
 * Timeline — frise de lecture (docs/00a Étape 14/P12 : "la frise de
 * lecture"). Canvas 2D DIRECT, pas via `render/Renderer` : cette abstraction
 * sert le moteur visuel musique→image (docs/02), la timeline est un élément
 * de CHROME d'interface, une préoccupation séparée — comme `FlashLimiter`
 * qui dessine aussi directement sur son canvas.
 *
 * Couleurs volontairement NEUTRES, indépendantes de la palette du preset
 * actif : la timeline doit rester lisible quel que soit le preset choisi,
 * ce n'est pas un élément du rendu musical.
 *
 * Non couvert par un test automatisé (canvas) — voir `timelineLayout.ts`
 * pour les maths pures qui, elles, le sont. Vérifiée au navigateur.
 */
import type { WaveformPeaks } from '../../analysis/waveformPeaks';
import type { Section } from '../../music/pmdi';
import { SECTION_ENERGY_HIGH_MIN, SECTION_ENERGY_LOW_MAX } from '../../analysis/structure';
import { layoutSections, layoutTicks, resampleWaveformPeaks, xToTime } from './timelineLayout';

export interface TimelineData {
  readonly duration: number;
  readonly waveformPeaks: WaveformPeaks | null;
  readonly downbeats: readonly number[];
  readonly sections: readonly Section[];
}

export type SeekKind = 'scrub' | 'release';

/**
 * Piste d'automatisation dessinée par-dessus la frise (docs/17 §7.3, chantier
 * 10 lot D).
 *
 * `points` en coordonnées MÉTIER — secondes et valeur 0..1 — pas en pixels : la
 * frise se redimensionne, et convertir à l'affichage plutôt qu'au stockage
 * évite d'avoir à tout reconvertir à chaque `resize`.
 */
export interface TimelineAutomation {
  readonly label: string;
  readonly points: readonly { readonly t: number; readonly value: number }[];
}

export interface TimelineOptions {
  readonly canvas: HTMLCanvasElement;
  readonly onSeek: (t: number, kind: SeekKind) => void;
  /**
   * Clic sur la frise avec l'automatisation active. `remove` est vrai sur un
   * clic droit ou avec Alt — poser et retirer par le même geste modifié plutôt
   * que par un mode à basculer, qu'il faudrait ensuite penser à quitter.
   */
  readonly onAutomationPoint?: (t: number, value: number, remove: boolean) => void;
}

function sectionColor(section: Section): string {
  if (section.energy < SECTION_ENERGY_LOW_MAX) return 'rgba(90, 110, 140, 0.25)';
  if (section.energy > SECTION_ENERGY_HIGH_MIN) return 'rgba(220, 130, 90, 0.30)';
  return 'rgba(140, 140, 150, 0.20)';
}

export class Timeline {
  private readonly ctx: CanvasRenderingContext2D;
  private data: TimelineData = { duration: 0, waveformPeaks: null, downbeats: [], sections: [] };
  private playheadT = 0;
  private dragging = false;
  /** Piste affichee, ou `null` si l'automatisation n'est pas en cours d'edition. */
  private automation: TimelineAutomation | null = null;

  constructor(private readonly options: TimelineOptions) {
    const ctx = options.canvas.getContext('2d');
    if (!ctx) throw new Error('Timeline : contexte 2D indisponible');
    this.ctx = ctx;

    options.canvas.addEventListener('pointerdown', this.onPointerDown);
    // Le menu contextuel du navigateur volerait le clic droit, qui sert ici a
    // retirer un point.
    options.canvas.addEventListener('contextmenu', this.onContextMenu);
    options.canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  setData(data: TimelineData): void {
    this.data = data;
    this.draw();
  }

  /** Montre ou cache la piste d'automatisation. `null` = frise nue, comportement d'avant le lot D. */
  setAutomation(automation: TimelineAutomation | null): void {
    this.automation = automation;
    this.draw();
  }

  setPlayhead(t: number): void {
    this.playheadT = t;
    this.draw();
  }

  resize(): void {
    const { canvas } = this.options;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.draw();
  }

  dispose(): void {
    this.options.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.options.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.options.canvas.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  private xFromClientX(clientX: number): number {
    const rect = this.options.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return (clientX - rect.left) * dpr;
  }

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.automation) event.preventDefault();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    // Avec une piste active, le clic POSE un point au lieu de deplacer la tete
    // de lecture : sinon il faudrait viser une bande de quelques pixels pour
    // editer, et chercher ou cliquer pour naviguer.
    if (this.automation && this.options.onAutomationPoint) {
      const rect = this.options.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const t = xToTime(this.xFromClientX(event.clientX), this.data.duration, this.options.canvas.width);
      const y = (event.clientY - rect.top) * dpr;
      // Haut du cadre = 1, bas = 0. L'inverse serait contre-intuitif pour une
      // courbe d'intensite.
      const value = Math.min(1, Math.max(0, 1 - y / this.options.canvas.height));
      this.options.onAutomationPoint(t, value, event.button === 2 || event.altKey);
      event.preventDefault();
      return;
    }
    this.dragging = true;
    this.options.canvas.setPointerCapture(event.pointerId);
    this.seekFromClientX(event.clientX, 'scrub');
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.seekFromClientX(event.clientX, 'scrub');
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.seekFromClientX(event.clientX, 'release');
  };

  private seekFromClientX(clientX: number, kind: SeekKind): void {
    if (this.data.duration <= 0) return;
    const x = this.xFromClientX(clientX);
    const t = xToTime(x, this.data.duration, this.options.canvas.width);
    this.options.onSeek(t, kind);
  }

  private draw(): void {
    const { canvas } = this.options;
    const { width, height } = canvas;
    const { duration, waveformPeaks, downbeats, sections } = this.data;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);
    if (duration <= 0 || width <= 0 || height <= 0) return;

    for (const rect of layoutSections(sections, duration, width)) {
      ctx.fillStyle = sectionColor(rect.section);
      ctx.fillRect(rect.x, 0, rect.width, height);
    }

    if (waveformPeaks) {
      const resampled = resampleWaveformPeaks(waveformPeaks, width);
      const midY = height / 2;
      ctx.strokeStyle = 'rgba(200, 205, 215, 0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < resampled.min.length; x++) {
        const yTop = midY - resampled.max[x]! * midY;
        const yBottom = midY - resampled.min[x]! * midY;
        ctx.moveTo(x + 0.5, yTop);
        ctx.lineTo(x + 0.5, yBottom);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const x of layoutTicks(downbeats, duration, width)) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
    }
    ctx.stroke();

    if (this.automation) this.drawAutomation(ctx, width, height, duration);

    const playheadX = (this.playheadT / duration) * width;
    ctx.strokeStyle = '#ff2e63';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();
  }

  /**
   * Courbe d'automatisation par-dessus la frise (§7.3).
   *
   * Un VOILE sombre est posé d'abord : sans lui, une courbe blanche sur une
   * forme d'onde blanche est illisible, et c'est justement quand on édite qu'il
   * faut voir la courbe plutôt que le signal.
   *
   * Segments tenus aux extrémités, comme `valueAt` : ce qui est dessiné doit
   * être ce qui est joué, y compris avant le premier point et après le dernier.
   */
  private drawAutomation(ctx: CanvasRenderingContext2D, width: number, height: number, duration: number): void {
    const lane = this.automation;
    if (!lane) return;
    ctx.fillStyle = 'rgba(8, 9, 12, 0.55)';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(232, 232, 236, 0.75)';
    ctx.font = `${Math.round(height * 0.16)}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(lane.label, 6, 4);

    if (lane.points.length === 0) return;
    const x = (t: number): number => (t / duration) * width;
    const y = (v: number): number => (1 - v) * height;

    ctx.strokeStyle = '#7b4cff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y(lane.points[0]!.value));
    for (const p of lane.points) ctx.lineTo(x(p.t), y(p.value));
    ctx.lineTo(width, y(lane.points[lane.points.length - 1]!.value));
    ctx.stroke();

    ctx.fillStyle = '#e8e8ec';
    for (const p of lane.points) {
      ctx.beginPath();
      ctx.arc(x(p.t), y(p.value), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
