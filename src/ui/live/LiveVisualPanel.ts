import { FlashLimiter } from '../../visual/safety/FlashLimiter';
import type { LiveAudioSource } from '../../audio/LiveAudioSource';
import { LiveAnalysisEngine } from './audio/LiveAnalysisEngine';
import { DebugHud } from './DebugHud';
import { mergeLiveConfig, type LiveConfig, type LiveConfigPatch } from './LiveConfig';

/**
 * Etape 53 (hors roadmap) : rendu du mode "live" - deliberement SEPARE du
 * moteur StepContext/BehaviourEngine/Scene (Loi 1, docs/00b : rendu = fonction
 * pure du temps musical, incompatible avec un flux dont la fin n'est pas
 * connue). Son propre `<canvas>`, sa propre boucle `requestAnimationFrame`,
 * un rendu 2D volontairement simple (pas via `Renderer`/`Canvas2DRenderer`,
 * dont le contrat sert le moteur a timeline precalculee). Le mode fichier
 * (`#canvas`) n'est jamais touche par cette classe.
 *
 * ETAPE 1 de la refonte live : le panneau devient un orchestrateur mince.
 * Toute l'analyse (grille 50 Hz, onsets, tempo, horloge musicale, machine a
 * etats) est dans `audio/`, testee sans navigateur. Le RENDU n'est pas encore
 * refait : il reste le mandala de 32 barres, simplement alimente par les
 * features au lieu des octets bruts de l'AnalyserNode. Les scenes, le
 * pipeline de post et le director arrivent aux etapes suivantes.
 */
export class LiveVisualPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly flashLimiter: FlashLimiter;
  private readonly container: HTMLElement;

  private config: LiveConfig = mergeLiveConfig();
  private engine: LiveAnalysisEngine | null = null;
  private hud: DebugHud | null = null;
  private source: LiveAudioSource | null = null;
  private audioContext: AudioContext | null = null;

  private rafId: number | null = null;
  /**
   * Incremente a chaque `stop()`. La callback rAF verifie la generation en
   * tete : une trame peut etre EN VOL au moment ou `cancelAnimationFrame` est
   * appele, et elle dessinerait alors sur un moteur deja libere.
   */
  private generation = 0;
  private resizeObserver: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;
  private pendingW = 0;
  private pendingH = 0;
  private lastFrameStamp = 0;
  private frameMs = 16.7;
  private hiddenAt = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'live-canvas';
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none';
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('LiveVisualPanel: contexte 2D indisponible');
    this.ctx2d = ctx;
    // FlashLimiter DEDIE, separe de celui du mode fichier - celui-ci tourne sur
    // le temps reel (pas de temps musical en direct), l'autre sur `simT` :
    // les melanger ferait cohabiter deux notions de temps dans une seule
    // fenetre glissante d'une seconde.
    this.flashLimiter = new FlashLimiter(this.canvas);
  }

  /**
   * @param source source live DEJA branchee (`attachAnalysis` appele).
   * @param patch  surcharge de configuration, fusionnee sur les defauts.
   */
  start(source: LiveAudioSource, patch?: LiveConfigPatch): void {
    this.stop();
    this.config = mergeLiveConfig(patch);
    this.source = source;
    const sampleRate = source.getSampleRate();
    if (sampleRate <= 0) {
      // `attachAnalysis` n'a pas ete appele : rien a analyser, on ne demarre
      // pas de boucle qui ne pourrait rien afficher.
      this.source = null;
      return;
    }
    this.engine = new LiveAnalysisEngine(this.config, sampleRate, source.fftSizeOnset, source.fftSizeBands);
    this.hud = new DebugHud(this.config);

    this.canvas.style.display = 'block';
    this.measure();
    this.applyPendingSize();

    // `getBoundingClientRect()` par trame force un reflow a chaque image
    // (interdit §6.6). Le ResizeObserver ne fait que STOCKER la taille ; la
    // reallocation a lieu en tete de trame.
    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(this.canvas);
    // `ResizeObserver` ne se declenche PAS sur un changement de DPR : il faut
    // une media query dediee, rearmee a chaque declenchement.
    this.watchDpr();

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    const generation = this.generation;
    const frame = (stamp: number): void => {
      if (generation !== this.generation) return;
      this.tick(stamp);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  /** Idempotent : appelable deux fois de suite sans effet de bord. */
  stop(): void {
    this.generation++;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.dprQuery) {
      this.dprQuery.removeEventListener('change', this.onDprChange);
      this.dprQuery = null;
    }
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    this.engine?.reset();
    this.engine = null;
    this.hud = null;
    this.source = null;
    this.audioContext = null;
    this.flashLimiter.reset(0);
    this.canvas.style.display = 'none';
  }

  get active(): boolean {
    return this.rafId !== null;
  }

  /**
   * Contexte audio, pour lire `currentTime` et `getOutputTimestamp()` (§2.5).
   * A appeler APRES `start()` : celui-ci commence par `stop()`, qui relache la
   * reference - le contexte appartient a l'appelant, pas au panneau. Sans
   * contexte, la boucle tourne mais n'alimente pas le moteur d'analyse.
   */
  attachAudioContext(ctx: AudioContext): void {
    this.audioContext = ctx;
  }

  /** Etat courant du moteur - expose pour la verification Playwright. */
  get engineState(): string {
    return this.engine?.state ?? 'STOPPED';
  }

  get bpm(): number {
    return this.engine?.beat.bpm ?? 0;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.engine || !this.hud) return;
    if (event.key === 'd' || event.key === 'D') {
      this.hud.toggle();
      event.preventDefault();
      return;
    }
    if (this.hud.handleKey(event.key, this.engine)) event.preventDefault();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.hiddenAt = performance.now();
      return;
    }
    // Aucun rattrapage au retour d'onglet : `dt` est deja clampe, et au-dela
    // d'une seconde l'etat accumule ne decrit plus rien de reel.
    const hiddenSec = this.hiddenAt > 0 ? (performance.now() - this.hiddenAt) / 1000 : 0;
    this.hiddenAt = 0;
    this.engine?.onVisible(hiddenSec);
    this.lastFrameStamp = 0;
  };

  private watchDpr(): void {
    const dpr = window.devicePixelRatio || 1;
    this.dprQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  private readonly onDprChange = (): void => {
    if (this.dprQuery) this.dprQuery.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
    this.measure();
    this.watchDpr();
  };

  private measure(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.pendingW = Math.round(rect.width * dpr);
    this.pendingH = Math.round(rect.height * dpr);
  }

  /**
   * Ecrire `canvas.width` reinitialise TOUT l'etat du contexte et vide le
   * bitmap : on ne le fait qu'en cas de changement reel, et jamais sur une
   * taille nulle (un element `display:none` ferait lever `InvalidStateError`
   * a `drawImage`).
   */
  private applyPendingSize(): void {
    if (this.pendingW <= 0 || this.pendingH <= 0) return;
    if (this.canvas.width === this.pendingW && this.canvas.height === this.pendingH) return;
    this.canvas.width = this.pendingW;
    this.canvas.height = this.pendingH;
    this.ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx2d.imageSmoothingEnabled = true;
    this.ctx2d.filter = 'none';
    this.ctx2d.globalAlpha = 1;
    this.ctx2d.globalCompositeOperation = 'source-over';
  }

  private tick(stamp: number): void {
    const engine = this.engine;
    const source = this.source;
    if (!engine || !source) return;
    this.applyPendingSize();
    if (this.canvas.width <= 0 || this.canvas.height <= 0) return;

    // MUST §3.7 : le temps de trame se mesure sur les horodatages de rAF, pas
    // avec un `performance.now()` autour du code de rendu - le travail Canvas
    // 2D est soumis de facon asynchrone.
    if (this.lastFrameStamp > 0) {
      const delta = stamp - this.lastFrameStamp;
      if (delta > 0 && delta < 500) this.frameMs = this.frameMs + 0.1 * (delta - this.frameMs);
    }
    this.lastFrameStamp = stamp;

    const freqOnsetDb = source.getFloatFrequencyData();
    const freqBandsDb = source.getFloatBandsFrequencyData();
    const timeDomain = source.getFloatTimeDomainData();
    const ctx = this.audioContext;
    if (freqOnsetDb && freqBandsDb && timeDomain && ctx) {
      engine.step({
        tAudio: ctx.currentTime,
        freqOnsetDb,
        freqBandsDb,
        timeDomain,
        audioAheadMs: audioAheadMs(ctx, this.config.sync.fallbackOutputLatencySec),
        frameIntervalSec: this.frameMs / 1000,
      });
    }

    this.draw(engine);

    if (this.hud) {
      this.hud.frameMs = this.frameMs;
      this.hud.flashClamped = this.flashLimiter.clampedCount;
      this.hud.draw(this.ctx2d, engine, window.devicePixelRatio || 1);
    }
  }

  private draw(engine: LiveAnalysisEngine): void {
    const { width, height } = this.canvas;
    const ctx = this.ctx2d;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const bands = engine.features.bandsNorm;
    const energy = engine.features.rmsNorm;
    const cx = width / 2;
    const cy = height / 2;
    const baseRadius = Math.min(width, height) * 0.22 * (1 + energy * 0.25);

    const barCount = bands.length;
    const maxBarLen = Math.min(width, height) * 0.28;
    ctx.lineWidth = Math.max(1, (Math.min(width, height) / barCount) * 0.6);
    for (let i = 0; i < barCount; i++) {
      const level = bands[i] ?? 0;
      const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
      const len = level * maxBarLen;
      const x0 = cx + Math.cos(angle) * baseRadius;
      const y0 = cy + Math.sin(angle) * baseRadius;
      const x1 = cx + Math.cos(angle) * (baseRadius + len);
      const y1 = cy + Math.sin(angle) * (baseRadius + len);
      const hue = 260 - level * 140; // violet -> rose/orange sur les pics, coherent avec la palette par defaut du mode fichier
      ctx.strokeStyle = `hsl(${hue} 85% ${45 + level * 25}%)`;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
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

    // `FlashLimiter` attend un temps en secondes ; en direct il n'y a pas de
    // temps musical au sens du mode fichier, on lui passe l'horloge AUDIO.
    this.flashLimiter.apply(engine.tSec);
  }
}

/**
 * `(currentTime - getOutputTimestamp().contextTime) * 1000` : de combien
 * l'analyse est EN AVANCE sur l'oreille. Voir la convention dans `BeatClock`.
 * `baseLatency` seul (2,9 a 11,6 ms) ne suffit pas - c'est `outputLatency` qui
 * porte la latence materielle, et Safari ne l'expose pas.
 */
function audioAheadMs(ctx: AudioContext, fallbackOutputLatencySec: number): number {
  const ts = ctx.getOutputTimestamp?.();
  if (ts && typeof ts.contextTime === 'number' && ts.contextTime > 0) {
    return (ctx.currentTime - ts.contextTime) * 1000;
  }
  const output = typeof ctx.outputLatency === 'number' ? ctx.outputLatency : fallbackOutputLatencySec;
  return (ctx.baseLatency + output) * 1000;
}
