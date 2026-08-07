/**
 * Camera 2D virtuelle commune (§3.6).
 *
 * Toutes les scenes partagent cette camera. Consequence directe et voulue :
 * **le shake sur kick est une MODULATION de la camera, pas un effet separe**.
 * Un shake implemente scene par scene se cumulerait avec les repositionnements
 * du director et donnerait un cadre qui ne se stabilise jamais.
 *
 * Les cibles sont exprimees en FRACTIONS DU CADRE, jamais en pixels : le rendu
 * doit etre lisible en 21:9 comme en 9:16. La conversion en pixels n'a lieu
 * qu'au moment d'appliquer la transformation.
 *
 * Classe pure : le temps est un parametre.
 */

import type { Viewport } from '../scenes/types';

/** Amortissement critique : la camera rejoint sa cible sans osciller. */
function approach(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / Math.max(tau, 1e-3)));
}

export class Camera {
  /** Decalage horizontal, en fraction de la largeur. 0 = centre. */
  private x = 0;
  private y = 0;
  private scale = 1;
  private rotation = 0;

  private targetX = 0;
  private targetY = 0;
  private targetScale = 1;
  private targetRotation = 0;

  private shakeAmount = 0;
  private shakePhase = 0;

  constructor(
    /** Constante de temps des repositionnements, en secondes. */
    private readonly moveTau = 0.35,
    /** Constante de temps de retour du shake, en secondes. */
    private readonly shakeTau = 0.12,
  ) {}

  /**
   * Cible de cadrage. Appelee par le director sur frontiere de mesure ou de
   * phrase - jamais au milieu de nulle part (§4.3).
   *
   * @param x        fraction de largeur, [-0.5, 0.5].
   * @param y        fraction de hauteur.
   * @param scale    1 = plan large, > 1 = gros plan.
   * @param rotation radians. Faible par construction : au-dela de ~0,1 rad le
   *                 cadre paraissait « casse » plutot que compose.
   */
  setTarget(x: number, y: number, scale: number, rotation: number): void {
    this.targetX = x;
    this.targetY = y;
    this.targetScale = Math.max(0.2, scale);
    this.targetRotation = Math.max(-0.12, Math.min(0.12, rotation));
  }

  /** Impulsion de shake, 0-1. Une nouvelle impulsion REMPLACE, elle ne s'ajoute pas (§2.7.2). */
  impulse(amount: number): void {
    const a = amount < 0 ? 0 : amount > 1 ? 1 : amount;
    if (a > this.shakeAmount) this.shakeAmount = a;
  }

  update(dt: number): void {
    this.x = approach(this.x, this.targetX, dt, this.moveTau);
    this.y = approach(this.y, this.targetY, dt, this.moveTau);
    this.scale = approach(this.scale, this.targetScale, dt, this.moveTau);
    this.rotation = approach(this.rotation, this.targetRotation, dt, this.moveTau);
    this.shakeAmount *= Math.exp(-dt / this.shakeTau);
    if (this.shakeAmount < 1e-4) this.shakeAmount = 0;
    // Frequence de shake fixe et rapide : liee au temps ecoule, pas a un
    // `Math.random()` par trame, pour que deux trames rapprochees ne sautent
    // pas d'un extreme a l'autre.
    this.shakePhase += dt * 47;
  }

  /**
   * Applique la transformation. `amplitudeDivider` vient de
   * `prefers-reduced-motion` : il divise le shake, pas le cadrage.
   */
  apply(ctx: CanvasRenderingContext2D, view: Viewport, amplitudeDivider: number): void {
    const shake = this.shakeAmount / Math.max(1, amplitudeDivider);
    // Amplitude en fraction du PETIT COTE : un shake de 1 % doit avoir le meme
    // poids visuel en 21:9 et en 9:16.
    const amp = shake * view.min * 0.018;
    const sx = Math.sin(this.shakePhase) * amp;
    const sy = Math.cos(this.shakePhase * 1.37) * amp;
    const cx = view.w / 2;
    const cy = view.h / 2;
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    const s = this.scale * (1 + shake * 0.012);
    ctx.setTransform(
      cos * s,
      sin * s,
      -sin * s,
      cos * s,
      cx + this.x * view.w + sx,
      cy + this.y * view.h + sy,
    );
    // L'origine est desormais au centre du cadre : les scenes travaillent en
    // coordonnees centrees, comme la Loi 4 du mode fichier.
  }

  /** Etat courant, pour le HUD. */
  get state(): { x: number; y: number; scale: number; rotation: number; shake: number } {
    return { x: this.x, y: this.y, scale: this.scale, rotation: this.rotation, shake: this.shakeAmount };
  }

  reset(): void {
    this.x = 0;
    this.y = 0;
    this.scale = 1;
    this.rotation = 0;
    this.targetX = 0;
    this.targetY = 0;
    this.targetScale = 1;
    this.targetRotation = 0;
    this.shakeAmount = 0;
    this.shakePhase = 0;
  }
}
