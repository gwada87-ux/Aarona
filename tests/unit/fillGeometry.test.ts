import { describe, expect, it } from 'vitest';
import { triangleIndexCapacity, triangulatePolygon } from '../../src/render/webgl2/fillGeometry';

/**
 * Triangulation de `fillPath` du backend WebGL2 (ADR-013, lot 1). Le critère
 * central est l'AIRE : la somme des aires des triangles émis doit égaler
 * l'aire (shoelace) du polygone — c'est exactement ce que l'éventail naïf
 * violait sur les rubans concaves d'`aurore` (il remplissait le creux de
 * l'onde en plus du ruban).
 */

function poly(points: readonly [number, number][]): Float32Array {
  const pts = new Float32Array(points.length * 2);
  points.forEach(([x, y], i) => {
    pts[i * 2] = x;
    pts[i * 2 + 1] = y;
  });
  return pts;
}

function shoelace(points: readonly [number, number][]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[(i + 1) % points.length]!;
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

function triangulatedArea(pts: Float32Array, indices: Uint16Array, indexCount: number): number {
  let area = 0;
  for (let i = 0; i < indexCount; i += 3) {
    const a = indices[i]! * 2;
    const b = indices[i + 1]! * 2;
    const c = indices[i + 2]! * 2;
    area += Math.abs(
      (pts[b]! - pts[a]!) * (pts[c + 1]! - pts[a + 1]!) - (pts[b + 1]! - pts[a + 1]!) * (pts[c]! - pts[a]!),
    ) / 2;
  }
  return area;
}

function check(points: readonly [number, number][]): { area: number; expected: number; indexCount: number } {
  const pts = poly(points);
  const out = new Uint16Array(triangleIndexCapacity(points.length));
  const indexCount = triangulatePolygon(pts, points.length, out);
  return { area: triangulatedArea(pts, out, indexCount), expected: shoelace(points), indexCount };
}

describe('triangulatePolygon (render/webgl2)', () => {
  it('refuse moins de 3 points', () => {
    const out = new Uint16Array(3);
    expect(triangulatePolygon(poly([[0, 0], [1, 0]]), 2, out)).toBe(0);
  });

  it('rectangle (convexe) : 2 triangles, aire exacte', () => {
    const { area, expected, indexCount } = check([[0, 0], [4, 0], [4, 2], [0, 2]]);
    expect(indexCount).toBe(6);
    expect(area).toBeCloseTo(expected, 6);
  });

  it('parcours HORAIRE : même aire (le sens est normalisé)', () => {
    const { area, expected } = check([[0, 2], [4, 2], [4, 0], [0, 0]]);
    expect(area).toBeCloseTo(expected, 6);
  });

  it('polygone concave en L : aire exacte (le creux reste vide)', () => {
    const { area, expected, indexCount } = check([[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]]);
    expect(indexCount).toBe(4 * 3);
    expect(area).toBeCloseTo(expected, 6);
  });

  it('ruban ondulé type aurore (aller-retour concave) : aire exacte', () => {
    // La forme qui a cassé l'éventail : bord haut gauche->droite, bord bas
    // droite->gauche, médiane sinusoïdale, demi-épaisseur effilée aux bouts.
    const N = 40;
    const top: [number, number][] = [];
    const bottom: [number, number][] = [];
    for (let p = 0; p < N; p++) {
      const u = p / (N - 1);
      const mid = Math.sin(u * Math.PI * 3) * 0.16;
      const half = 0.06 * Math.sin(u * Math.PI);
      top.push([u * 2 - 1, mid + half]);
      bottom.unshift([u * 2 - 1, mid - half]);
    }
    const ribbon = [...top, ...bottom];
    const { area, expected } = check(ribbon);
    // L'éventail naïf donnait plusieurs FOIS l'aire attendue ; la découpe
    // d'oreilles doit la retrouver à ~1 % près (extrémités dégénérées où la
    // demi-épaisseur s'annule : quelques triangles plats tolérés).
    expect(area).toBeGreaterThan(expected * 0.99);
    expect(area).toBeLessThan(expected * 1.01);
  });

  it('chaîne colinéaire : ne boucle pas, aire exacte', () => {
    const { area, expected } = check([[0, 0], [1, 0], [2, 0], [3, 0], [3, 1], [0, 1]]);
    expect(area).toBeCloseTo(expected, 6);
  });
});
