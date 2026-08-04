import type { Renderer, SpriteHandle, SpriteTransform } from '../../../render/Renderer';
import type { Viewport } from '../../../render/Viewport';
import type { StepContext } from '../../../music/StepContext';
import type { VisualSignals } from '../../../behaviour/BehaviourEngine';
import type { Rng } from '../../../core/rng/mulberry32';
import type { Layer, LayerInitContext, LayerKind, LayerParams } from '../../scene/Layer';
import type { Color } from '../../../render/Renderer';

// docs/10_PERFORMANCE.md, niveau HIGH (pas de QualityGovernor avant P14 : valeur fixe pour l'instant).
const POOL_SIZE = 2500;
const SPRITE_SIZE = 48;

const DRIFT_Y = 0.012; // dérive constante — choix : lente, vers le haut (poussière/braises), non spécifié par docs/07
const BASE_PULL = 0.15; // attraction centrale, modulée par `weight`
const CONVERGE_PULL = 0.6; // attraction pendant un BUILDUP actif
const CONVERGE_SPEED_MUL = 1.6;
const DRAG_PER_SEC = 0.6;

/**
 * Particles du style Field (docs/07) : « 2500 particules, pool fixe » avec
 * des forces (dérive + attraction centrale modulée par `weight`) et des
 * réactions par type d'événement. Zéro allocation en boucle de rendu
 * (docs/10_PERFORMANCE.md) : Float32Array parallèles pour l'état, tableau
 * de `SpriteTransform` PRÉ-ALLOUÉ et MUTÉ en place pour `drawSprite`
 * (voir Renderer.ts — `drawSprite` prend un `count` depuis cette étape
 * précisément pour permettre ce pattern).
 *
 * Allocation par un CURSEUR circulaire, pas une recherche d'emplacement
 * libre : coût constant, comportement délibéré si le pool est plein (les
 * particules les plus anciennes sont recyclées en premier — invisible en
 * pratique, la durée de vie maximale est de l'ordre de la seconde).
 */
export class ParticleField implements Layer {
  readonly id = 'particleField';
  readonly kind: LayerKind = 'particles';
  readonly needsDrawPriming = false;
  params: LayerParams = {};

  private sprite!: SpriteHandle;
  private accentColor: Color = { r: 255, g: 255, b: 255, a: 1 };

  private readonly x = new Float32Array(POOL_SIZE);
  private readonly y = new Float32Array(POOL_SIZE);
  private readonly vx = new Float32Array(POOL_SIZE);
  private readonly vy = new Float32Array(POOL_SIZE);
  private readonly life = new Float32Array(POOL_SIZE); // <= 0 : emplacement mort/libre
  private readonly maxLife = new Float32Array(POOL_SIZE);
  private readonly size = new Float32Array(POOL_SIZE);
  private cursor = 0;
  private liveCount = 0;

  private readonly transforms: SpriteTransform[] = Array.from({ length: POOL_SIZE }, () => ({
    x: 0,
    y: 0,
    scale: 0,
    alpha: 0,
  }));

  private convergeUntil = 0;

  init(ctx: LayerInitContext): void {
    this.accentColor = ctx.palette.accent;
    const color = this.accentColor;
    this.sprite = ctx.renderer.createSprite((offCtx) => {
      const gradient = offCtx.createRadialGradient(
        SPRITE_SIZE / 2,
        SPRITE_SIZE / 2,
        0,
        SPRITE_SIZE / 2,
        SPRITE_SIZE / 2,
        SPRITE_SIZE / 2,
      );
      gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, 1)`);
      gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
      offCtx.fillStyle = gradient;
      offCtx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    }, SPRITE_SIZE);
  }

  private spawn(px: number, py: number, pvx: number, pvy: number, lifeSec: number, particleSize: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % POOL_SIZE;
    this.x[i] = px;
    this.y[i] = py;
    this.vx[i] = pvx;
    this.vy[i] = pvy;
    this.life[i] = lifeSec;
    this.maxLife[i] = lifeSec;
    this.size[i] = particleSize;
  }

  private spawnBurst(rng: Rng, count: number, intensity: number, fromRadius: number): void {
    for (let n = 0; n < count; n++) {
      const angle = rng.next() * Math.PI * 2;
      const speed = (0.35 + 0.65 * intensity) * (0.6 + rng.next() * 0.5);
      const r = fromRadius * rng.next();
      this.spawn(
        Math.cos(angle) * r,
        Math.sin(angle) * r,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        0.7 + rng.next() * 0.4,
        0.01 + rng.next() * 0.012,
      );
    }
  }

  private spawnFine(rng: Rng, count: number): void {
    for (let n = 0; n < count; n++) {
      const angle = rng.next() * Math.PI * 2;
      const speed = 0.15 + rng.next() * 0.2;
      this.spawn(0, 0, Math.cos(angle) * speed, Math.sin(angle) * speed, 0.25 + rng.next() * 0.15, 0.004 + rng.next() * 0.004);
    }
  }

  private spawnRing(rng: Rng, count: number): void {
    const r0 = 0.04;
    for (let n = 0; n < count; n++) {
      const angle = (n / count) * Math.PI * 2 + rng.next() * 0.05;
      const speed = 0.5 + rng.next() * 0.15;
      this.spawn(
        Math.cos(angle) * r0,
        Math.sin(angle) * r0,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        0.45 + rng.next() * 0.1,
        0.007,
      );
    }
  }

  update(step: StepContext, signals: VisualSignals): void {
    for (const event of step.fired) {
      if (event.type === 'KICK') this.spawnBurst(step.rng, 120, event.intensity, 0.02);
      else if (event.type === 'HAT') this.spawnFine(step.rng, 20);
      else if (event.type === 'SNARE') this.spawnRing(step.rng, 60);
      else if (event.type === 'DROP') {
        this.spawnBurst(step.rng, 400, 1, 0.03);
        this.convergeUntil = 0; // l'explosion du DROP met fin à toute convergence en cours
      } else if (event.type === 'BUILDUP' && event.dur !== undefined) {
        this.convergeUntil = event.t + event.dur;
      }
    }

    const converging = step.t < this.convergeUntil;
    const pull = (converging ? CONVERGE_PULL : BASE_PULL) * signals.weight;
    const speedMul = converging ? CONVERGE_SPEED_MUL : 1;
    const dt = step.dt;
    const drag = Math.max(0, 1 - DRAG_PER_SEC * dt);

    let live = 0;
    for (let i = 0; i < POOL_SIZE; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) continue;
      live++;

      const dist = Math.hypot(this.x[i]!, this.y[i]!) || 1e-6;
      this.vx[i]! += (-this.x[i]! / dist) * pull * dt;
      this.vy[i]! += (-this.y[i]! / dist) * pull * dt;
      this.vy[i]! += DRIFT_Y * dt;
      this.vx[i]! *= drag;
      this.vy[i]! *= drag;

      this.x[i]! += this.vx[i]! * dt * speedMul;
      this.y[i]! += this.vy[i]! * dt * speedMul;
    }
    this.liveCount = live;
  }

  draw(renderer: Renderer, _viewport: Viewport): void {
    let written = 0;
    for (let i = 0; i < POOL_SIZE && written < this.liveCount; i++) {
      if (this.life[i]! <= 0) continue;
      const lifeFrac = this.life[i]! / this.maxLife[i]!;
      const speed = Math.hypot(this.vx[i]!, this.vy[i]!);
      const t = this.transforms[written]!;
      t.x = this.x[i]!;
      t.y = this.y[i]!;
      t.scale = this.size[i]! * (1 + speed * 0.6);
      t.alpha = lifeFrac * 0.85;
      written++;
    }
    if (written > 0) renderer.drawSprite(this.sprite, this.transforms, written);
  }

  reset(_t: number): void {
    // Les particules vivantes au moment d'un seek ne sont pas reconstituées
    // (même principe que les anneaux secondaires de Pulse, docs/JOURNAL.md
    // Étape 9) : elles réapparaîtront naturellement aux prochains
    // événements rencontrés pendant le rattrapage.
    this.life.fill(0);
    this.liveCount = 0;
    this.convergeUntil = 0;
  }

  dispose(): void {}
}
