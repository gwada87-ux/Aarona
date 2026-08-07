/**
 * Boucle de feedback / trainees (§3.3).
 *
 * Quatre points ou une implementation naive casse :
 *
 * 1. **PING-PONG obligatoire.** Un `drawImage` d'un canvas sur lui-meme force
 *    un copy-on-write de la texture entiere, et devient carrement indefini des
 *    qu'on dessine des sous-regions qui se recouvrent - ce que fera
 *    `slice-displace` en etape 3.
 * 2. **Decroissance NORMALISEE PAR dt.** Un `globalAlpha` fixe de 0,88 donne
 *    des trainees deux fois plus longues sur un ecran 120 Hz. La constante de
 *    temps, elle, est une propriete du rendu voulu, pas du materiel.
 * 3. **ANTI-DIVERGENCE.** Feedback multiplicatif plus injection additive
 *    donne un etat stationnaire de `injection / (1 - k)`, soit x8,3 avec
 *    k = 0,88 : tout ce qui depasse 0,12 sature en blanc en moins d'une
 *    seconde. L'injection DOIT etre ponderee par `(1 - k)`.
 * 4. **PLANCHER 8 BITS.** Une decroissance purement multiplicative reste
 *    bloquee a 1-4/255 : `floor(4 * 0.88) = 3`, `floor(3 * 0.88) = 2`... et le
 *    residu que le bloom additif re-amplifie en voile gris permanent. D'ou la
 *    soustraction constante en `'difference'`.
 *
 * MUST §3.1 : la boucle de feedback ne reinjecte JAMAIS le bloom ni le post.
 * Ce sont des branches en LECTURE SEULE. Sinon emballement lumineux et ecran
 * blanc en quelques secondes.
 */

import type { LiveRenderConfig } from '../LiveConfig';
import { Layer, resetCompositing, type LayerStack } from './LayerStack';

/**
 * Facteur de decroissance par trame. Fonction pure, testee : c'est elle qui
 * porte l'independance au framerate.
 *
 * `k = exp(-dt / tau)`, borne a `[kMin, kMax]`. Au-dela de 0,95 l'image ne se
 * vide plus.
 */
export function feedbackDecay(dtSec: number, tauSec: number, kMin: number, kMax: number): number {
  const dtClamped = Math.min(Math.max(dtSec, 0), 0.05);
  const k = Math.exp(-dtClamped / Math.max(tauSec, 0.02));
  return k < kMin ? kMin : k > kMax ? kMax : k;
}

/**
 * Constante de temps modulee par la phase de mesure - la « respiration » de
 * §3.3. Le feedback se vide un peu plus vite au debut de la mesure et retient
 * un peu plus en fin de mesure : c'est ce qui donne au trainage une pulsation
 * musicale plutot qu'un flou constant.
 */
export function breathingTau(tauBase: number, barPhase: number, breath: number): number {
  return tauBase * (1 + breath * Math.cos(2 * Math.PI * barPhase));
}

export class Feedback {
  private front: Layer | null = null;
  private back: Layer | null = null;
  private w = 0;
  private h = 0;

  constructor(
    private readonly config: LiveRenderConfig,
    private readonly stack: LayerStack,
  ) {}

  /** Buffer LISIBLE par les scenes qui parlent de « la frame precedente » (§3.1). */
  get readable(): Layer | null {
    return this.front;
  }

  get width(): number {
    return this.w;
  }

  get height(): number {
    return this.h;
  }

  /** Alloue ou redimensionne. Retourne `false` si le plafond memoire est atteint. */
  resize(w: number, h: number): boolean {
    const a = this.stack.acquire('feedbackA', w, h);
    const b = this.stack.acquire('feedbackB', w, h);
    if (!a || !b) return false;
    const changed = this.w !== a.width || this.h !== a.height;
    this.front = this.front ?? a;
    this.back = this.back ?? b;
    this.w = a.width;
    this.h = a.height;
    // Le redimensionnement a vide les deux bitmaps : sans effacement explicite
    // le premier composite lirait un buffer opaque non initialise.
    if (changed) this.clear();
    return true;
  }

  /**
   * Fait avancer la boucle d'une trame et retourne le buffer a lire.
   *
   * @param scene   calque de scene de cette trame.
   * @param reducedFeedbackKMax plafond abaisse en `prefers-reduced-motion`.
   */
  advance(scene: Layer, dt: number, barPhase: number, reducedFeedbackKMax: number | null): Layer | null {
    const front = this.front;
    const back = this.back;
    if (!front || !back) return null;

    const tau = breathingTau(this.config.feedbackTauSec, barPhase, this.config.feedbackBreath);
    const kMax = reducedFeedbackKMax ?? this.config.feedbackKMax;
    const k = feedbackDecay(dt, tau, this.config.feedbackKMin, kMax);

    const ctx = back.ctx;
    const zoom = this.config.feedbackZoom;
    const cx = this.w / 2;
    const cy = this.h / 2;

    // 1. Report de l'ancien contenu, attenue et legerement zoome.
    ctx.globalCompositeOperation = 'copy';
    ctx.globalAlpha = k;
    ctx.imageSmoothingEnabled = true;
    ctx.setTransform(zoom, 0, 0, zoom, cx * (1 - zoom), cy * (1 - zoom));
    ctx.drawImage(front.canvas as CanvasImageSource, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 2. Injection ponderee par (1 - k) : c'est ce facteur qui empeche
    //    l'etat stationnaire de diverger.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (1 - k) * this.config.feedbackSceneGain;
    ctx.drawImage(scene.canvas as CanvasImageSource, 0, 0);

    // 3. Plancher 8 bits.
    ctx.globalCompositeOperation = 'difference';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#010101';
    ctx.fillRect(0, 0, this.w, this.h);
    resetCompositing(ctx);

    this.front = back;
    this.back = front;
    return this.front;
  }

  /**
   * Vidage SEC. A appeler sur chaque coupe de scene et sur `visibilitychange`
   * (§3.3) : un fondu laisserait un fantome de la scene precedente pendant
   * plusieurs secondes.
   */
  clear(): void {
    for (const layer of [this.front, this.back]) {
      if (!layer) continue;
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      layer.ctx.globalCompositeOperation = 'source-over';
      layer.ctx.globalAlpha = 1;
      layer.ctx.clearRect(0, 0, layer.width, layer.height);
    }
  }

  dispose(): void {
    this.stack.release('feedbackA');
    this.stack.release('feedbackB');
    this.front = null;
    this.back = null;
    this.w = 0;
    this.h = 0;
  }
}
