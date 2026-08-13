import { describe, expect, it } from 'vitest';
import { MITER_LIMIT, buildStrokeStrip, strokeStripCapacity } from '../../src/render/webgl2/strokeGeometry';

/**
 * Extrusion des traits du backend WebGL2 (ADR-013, lot 1) — la partie PURE
 * du renderer GL, testable en Node comme `bloomMath`/`chromaticMath`.
 * Conventions dans l'en-tête de `strokeGeometry.ts` : deux sommets par point
 * (`p ± m·s`), mitre écrêtée à `MITER_LIMIT × demi-largeur`, chemin fermé
 * refermé en répétant la première paire.
 */

function strip(points: readonly [number, number][], halfWidth: number, closed: boolean): { vertices: number; out: Float32Array } {
  const xs = new Float32Array(points.map((p) => p[0]));
  const ys = new Float32Array(points.map((p) => p[1]));
  const out = new Float32Array(strokeStripCapacity(points.length));
  const vertices = buildStrokeStrip(xs, ys, points.length, halfWidth, closed, out);
  return { vertices, out };
}

describe('buildStrokeStrip (render/webgl2)', () => {
  it('refuse moins de 2 points', () => {
    const { vertices } = strip([[0, 0]], 5, false);
    expect(vertices).toBe(0);
  });

  it('segment horizontal : un rectangle de la bonne épaisseur', () => {
    const { vertices, out } = strip(
      [
        [0, 0],
        [10, 0],
      ],
      5,
      false,
    );
    expect(vertices).toBe(4);
    // Normale de (1,0) : (0,1) — v0 = p0 + n·h, v1 = p0 − n·h, puis pareil en p1.
    expect(Array.from(out.subarray(0, 8))).toEqual([0, 5, 0, -5, 10, 5, 10, -5]);
  });

  it('coin à angle droit : mitre en h·√2 sur la bissectrice', () => {
    const h = 4;
    const { vertices, out } = strip(
      [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
      h,
      false,
    );
    expect(vertices).toBe(6);
    // Sommet du milieu : n0 = (0,1), n1 = (−1,0), bissectrice (−√2/2, √2/2),
    // longueur h/cos(45°) = h√2 → paires (10−h, h) et (10+h, −h).
    expect(out[4]).toBeCloseTo(10 - h, 6);
    expect(out[5]).toBeCloseTo(h, 6);
    expect(out[6]).toBeCloseTo(10 + h, 6);
    expect(out[7]).toBeCloseTo(-h, 6);
  });

  it('chemin fermé : la première paire est répétée en fin de bande', () => {
    const { vertices, out } = strip(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      2,
      true,
    );
    expect(vertices).toBe(10); // 4 points × 2 + paire de fermeture
    expect(out[16]).toBe(out[0]);
    expect(out[17]).toBe(out[1]);
    expect(out[18]).toBe(out[2]);
    expect(out[19]).toBe(out[3]);
    // Chaque sommet reste dans le carré élargi de la mitre d'angle droit (h√2).
    const reach = 2 * Math.SQRT2 + 1e-9;
    for (let i = 0; i < vertices; i++) {
      expect(out[i * 2]!).toBeGreaterThanOrEqual(0 - reach);
      expect(out[i * 2]!).toBeLessThanOrEqual(10 + reach);
    }
  });

  it('angle très fermé : la mitre est écrêtée à MITER_LIMIT × demi-largeur', () => {
    const h = 3;
    const { vertices, out } = strip(
      [
        [0, 0],
        [100, 0],
        [0, 1], // quasi demi-tour : mitre théorique >> limite
      ],
      h,
      false,
    );
    expect(vertices).toBe(6);
    const mx = out[4]! - 100;
    const my = out[5]! - 0;
    // Tolérance relative : `out` est un Float32Array, l'écrêtage exact en
    // float64 se stocke arrondi au float32 le plus proche.
    expect(Math.hypot(mx, my)).toBeLessThanOrEqual(h * MITER_LIMIT * (1 + 1e-6));
  });

  it('demi-tour exact : retombe sur la normale du segment (pas de NaN)', () => {
    const { vertices, out } = strip(
      [
        [0, 0],
        [10, 0],
        [0, 0],
      ],
      5,
      false,
    );
    expect(vertices).toBe(6);
    for (let i = 0; i < vertices * 2; i++) {
      expect(Number.isFinite(out[i]!)).toBe(true);
    }
    // Normale du premier segment : (0,1) → la paire du milieu reste à ±h en y.
    expect(out[4]).toBeCloseTo(10, 6);
    expect(Math.abs(out[5]!)).toBeCloseTo(5, 6);
  });

  it('points confondus consécutifs : le doublon est sauté, le rectangle reste', () => {
    const { vertices, out } = strip(
      [
        [0, 0],
        [0, 0],
        [10, 0],
      ],
      5,
      false,
    );
    // Le premier point n'a aucun segment non nul autour de lui : il est
    // ignoré, la bande est celle du segment simple (0,0)->(10,0).
    expect(vertices).toBe(4);
    expect(Array.from(out.subarray(0, 8))).toEqual([0, 5, 0, -5, 10, 5, 10, -5]);
  });

  it('strokeStripCapacity borne bien la sortie', () => {
    for (const [count, closed] of [
      [2, false],
      [7, true],
      [64, true],
    ] as const) {
      const pts: [number, number][] = [];
      for (let i = 0; i < count; i++) pts.push([Math.cos(i) * 50, Math.sin(i) * 50]);
      const { vertices } = strip(pts, 3, closed);
      expect(vertices * 2).toBeLessThanOrEqual(strokeStripCapacity(count));
    }
  });
});
