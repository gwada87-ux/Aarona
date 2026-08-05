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

export interface TimelineOptions {
  readonly canvas: HTMLCanvasElement;
  readonly onSeek: (t: number, kind: SeekKind) => void;
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

  constructor(private readonly options: TimelineOptions) {
    const ctx = options.canvas.getContext('2d');
    if (!ctx) throw new Error('Timeline : contexte 2D indisponible');
    this.ctx = ctx;

    options.canvas.addEventListener('pointerdown', this.onPointerDown);
    options.canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  setData(data: TimelineData): void {
    this.data = data;
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
    this.options.canvas.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  private xFromClientX(clientX: number): number {
    const rect = this.options.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return (clientX - rect.left) * dpr;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
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

    const playheadX = (this.playheadT / duration) * width;
    ctx.strokeStyle = '#ff2e63';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();
  }
}
