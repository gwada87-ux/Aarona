/**
 * FlashLimiter — dernier étage du pipeline de rendu, non contournable
 * (docs/07_VISUAL_ENGINE.md §"FlashLimiter"). Borne la variation de
 * luminance moyenne : repère WCAG 2.3.1, 3 flashs/seconde maximum.
 */

export interface FlashLimiterConfig {
  readonly deltaThreshold: number;
  readonly maxTransitionsPerSecond: number;
}

/** Tableau des seuils de docs/07. */
export const NORMAL_MODE: FlashLimiterConfig = Object.freeze({ deltaThreshold: 0.45, maxTransitionsPerSecond: 3 });
export const REDUCED_FLASHING_MODE: FlashLimiterConfig = Object.freeze({
  deltaThreshold: 0.18,
  maxTransitionsPerSecond: 2,
});

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Cœur pur, testable sans canvas : décide si une transition de luminance
 * est autorisée, en comptant les transitions autorisées dans la dernière
 * seconde de TEMPS MUSICAL (`t`, jamais un compte d'images — sinon un
 * export 30 fps et une preview 60 fps ne limiteraient pas la même chose).
 *
 * « Interpole vers L(t_precedent) » (docs/07) : aucune fraction n'est
 * spécifiée ; retenu ici comme un saut complet vers la valeur précédente
 * (le choix le plus conservateur, cohérent avec l'objectif de sécurité).
 */
export class FlashRateGate {
  private readonly recentTransitionTimes: number[] = [];

  constructor(private readonly config: FlashLimiterConfig) {}

  /** Retourne la luminance à utiliser réellement : `luminance` si autorisée, `previousLuminance` sinon. */
  evaluate(t: number, luminance: number, previousLuminance: number): number {
    const delta = Math.abs(luminance - previousLuminance);
    if (delta <= this.config.deltaThreshold) return luminance;

    this.prune(t);
    if (this.recentTransitionTimes.length < this.config.maxTransitionsPerSecond) {
      this.recentTransitionTimes.push(t);
      return luminance;
    }
    return previousLuminance;
  }

  private prune(t: number): void {
    // Taille bornée par maxTransitionsPerSecond (2-3) : shift() en O(n) est
    // négligeable ici, ce n'est pas un chemin chaud par particule.
    while (this.recentTransitionTimes.length > 0 && t - this.recentTransitionTimes[0]! > 1.0) {
      this.recentTransitionTimes.shift();
    }
  }

  reset(): void {
    this.recentTransitionTimes.length = 0;
  }
}

const SAMPLE_WIDTH = 32;
const SAMPLE_HEIGHT = 18;

/**
 * Couplage canvas : mesure (downsample 32×18 + `getImageData`), applique le
 * clampage via un survoile uniforme. Non testable automatiquement (comme
 * `Canvas2DRenderer`) — vérifié manuellement au navigateur.
 *
 * `needsDrawPriming = true` (docs/02 §Layer) : après un seek, `reset()` ne
 * tente PAS de mesurer (rien de nouveau n'est encore dessiné) — il remet
 * l'état à neutre et laisse le rattrapage par sous-pas rappeler `apply()`
 * plusieurs fois avant la frame réelle, exactement comme `EventDispatcher`
 * se corrige lui-même (docs/06).
 *
 * Accepte `OffscreenCanvas` depuis l'Étape 10/P8 (canvas d'export, voir
 * `Canvas2DRenderer`).
 */
export class FlashLimiter {
  readonly needsDrawPriming = true;
  /** Nombre de frames clampées depuis la construction (ou le dernier `reset`) — pour le panneau de debug. */
  clampedCount = 0;
  private readonly gate: FlashRateGate;
  private readonly sampleCanvas: OffscreenCanvas;
  private readonly sampleCtx: OffscreenCanvasRenderingContext2D;
  private previousLuminance = 0.5;
  private frameParity = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    private config: FlashLimiterConfig = NORMAL_MODE,
  ) {
    this.gate = new FlashRateGate(config);
    this.sampleCanvas = new OffscreenCanvas(SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const ctx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('FlashLimiter: contexte 2D hors écran indisponible');
    this.sampleCtx = ctx;
  }

  setReducedFlashing(reduced: boolean): void {
    this.config = reduced ? REDUCED_FLASHING_MODE : NORMAL_MODE;
  }

  /** `t` : temps musical de la frame (docs/07 — jamais un compte d'images). */
  apply(t: number): void {
    // "Une image sur deux" (docs/07 §"Coût réel") : mesurer impose un flush
    // synchrone du pipeline 2D (drawImage + getImageData), coûteux dans la
    // boucle d'export serrée. Le seuil étant en flashs/seconde et non par
    // image, sauter une mesure sur deux ne change pas la protection.
    this.frameParity ^= 1;
    const luminance = this.frameParity === 0 ? this.previousLuminance : this.measureLuminance();

    const allowed = this.gate.evaluate(t, luminance, this.previousLuminance);
    if (allowed !== luminance) {
      this.dimTowards(allowed, luminance);
      this.clampedCount++;
    }
    this.previousLuminance = allowed;
  }

  private measureLuminance(): number {
    this.sampleCtx.drawImage(this.canvas, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const { data } = this.sampleCtx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    let sum = 0;
    const pixelCount = SAMPLE_WIDTH * SAMPLE_HEIGHT;
    for (let i = 0; i < pixelCount; i++) {
      const o = i * 4;
      // Luma perceptuelle (Rec. 709) — choix standard, non spécifié par docs/07.
      sum += (0.2126 * data[o]! + 0.7152 * data[o + 1]! + 0.0722 * data[o + 2]!) / 255;
    }
    return sum / pixelCount;
  }

  /**
   * Approximation documentée : un survoile uniforme (noir pour assombrir,
   * blanc pour éclaircir) déplace la luminance MOYENNE de façon prévisible
   * (`cible = actuelle·(1-a)` ou `cible = actuelle·(1-a) + a`), sans
   * préserver le contraste local pixel par pixel. Acceptable : ce clampage
   * ne s'engage que sur des transitions déjà extrêmes et rares par
   * construction (rate-gate à 2-3/s).
   */
  private dimTowards(target: number, current: number): void {
    // Même remarque que Canvas2DRenderer : l'union HTMLCanvasElement|OffscreenCanvas
    // perd la surcharge précise de `getContext('2d')`.
    const ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return;
    if (target < current) {
      const alpha = clamp01(1 - target / Math.max(current, 1e-6));
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    } else {
      const alpha = clamp01((target - current) / Math.max(1 - current, 1e-6));
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    }
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  reset(_t: number): void {
    this.gate.reset();
    this.previousLuminance = 0.5;
    this.frameParity = 0;
  }
}
