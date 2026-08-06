import { computeLogSpacedBinRanges } from '../../analysis/spectrumBands';
import { FlashLimiter } from '../../visual/safety/FlashLimiter';
import type { LiveAudioSource } from '../../audio/LiveAudioSource';

const BAND_COUNT = 32;

/**
 * Étape 53 (hors roadmap) : rendu du mode "live" — délibérément SÉPARÉ du
 * moteur StepContext/BehaviourEngine/Scene (Loi 1, docs/00b : rendu = fonction
 * pure du temps musical, incompatible avec un flux dont la fin n'est pas
 * connue). Son propre `<canvas>`, sa propre boucle `requestAnimationFrame`,
 * un rendu 2D volontairement simple (pas via `Renderer`/`Canvas2DRenderer`,
 * dont le contrat sert le moteur à timeline précalculée). Le mode fichier
 * (`#canvas`) n'est jamais touché par cette classe.
 */
export class LiveVisualPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly flashLimiter: FlashLimiter;
  private ranges: readonly { lo: number; hi: number }[] = [];
  private source: LiveAudioSource | null = null;
  private rafId: number | null = null;
  private startedAtMs: number | null = null;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'live-canvas';
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none';
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('LiveVisualPanel: contexte 2D indisponible');
    this.ctx2d = ctx;
    // FlashLimiter DÉDIÉ, séparé de celui du mode fichier — celui-ci tourne sur
    // le temps réel (pas de temps musical en direct), l'autre sur `simT` :
    // les mélanger ferait cohabiter deux notions de temps dans une seule
    // fenêtre glissante d'une seconde.
    this.flashLimiter = new FlashLimiter(this.canvas);
  }

  start(source: LiveAudioSource, sampleRate: number, fftSize: number): void {
    this.stop();
    this.source = source;
    this.ranges = computeLogSpacedBinRanges(BAND_COUNT, sampleRate, fftSize);
    this.resize();
    this.canvas.style.display = 'block';
    this.startedAtMs = performance.now();
    const frame = (): void => {
      this.draw();
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.canvas.style.display = 'none';
    this.source = null;
    this.startedAtMs = null;
  }

  get active(): boolean {
    return this.rafId !== null;
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  private draw(): void {
    if (!this.source || this.startedAtMs === null) return;
    this.resize();
    const { width, height } = this.canvas;
    const ctx = this.ctx2d;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const freq = this.source.getFrequencyData();
    const energy = this.source.getEnergy();
    const cx = width / 2;
    const cy = height / 2;
    const baseRadius = Math.min(width, height) * 0.22 * (1 + energy * 0.25);

    if (freq && this.ranges.length > 0) {
      const barCount = this.ranges.length;
      const maxBarLen = Math.min(width, height) * 0.28;
      for (let i = 0; i < barCount; i++) {
        const range = this.ranges[i]!;
        let sum = 0;
        let n = 0;
        for (let b = range.lo; b <= range.hi && b < freq.length; b++) {
          sum += freq[b] ?? 0;
          n++;
        }
        const level = n > 0 ? sum / n / 255 : 0;
        const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
        const len = level * maxBarLen;
        const x0 = cx + Math.cos(angle) * baseRadius;
        const y0 = cy + Math.sin(angle) * baseRadius;
        const x1 = cx + Math.cos(angle) * (baseRadius + len);
        const y1 = cy + Math.sin(angle) * (baseRadius + len);
        const hue = 260 - level * 140; // violet -> rose/orange sur les pics, cohérent avec la palette par défaut du mode fichier
        ctx.strokeStyle = `hsl(${hue} 85% ${45 + level * 25}%)`;
        ctx.lineWidth = Math.max(1, (Math.min(width, height) / barCount) * 0.6);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }

    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(180,140,255,${0.4 + energy * 0.4})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${Math.max(10, height * 0.03)}px "IBM Plex Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('● EN DIRECT', 12, 10);

    const tSec = (performance.now() - this.startedAtMs) / 1000;
    this.flashLimiter.apply(tSec);
  }
}
