import { describe, expect, it } from 'vitest';
import {
  AGX_MAT,
  AGX_MAT_INV,
  BLOOM_THRESHOLD_LINEAR,
  PULSAR_SHOULDER_PIVOT,
  acesToneMap,
  agxContrast,
  agxToneMap,
  bloomLevelCount,
  linearToSrgb,
  pulsarToneMap,
  srgbToLinear,
} from '../../src/render/webgl2/hdrMath';

/**
 * Miroir TypeScript des shaders HDR (ADR-013, lot 2) — mêmes garanties que
 * `bloomMath`/`chromaticMath` : la référence pure quand un chiffre de la
 * sonde surprend.
 */

describe('sRGB exact (hdrMath)', () => {
  it('aller-retour identité à 1e-7 près sur toute la plage', () => {
    for (let i = 0; i <= 100; i++) {
      const c = i / 100;
      expect(linearToSrgb(srgbToLinear(c))).toBeCloseTo(c, 7);
    }
  });

  it('valeurs pivots de la spécification', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 10);
    // Le seuil 200/255 du bloom SDR converti — la constante du bright-pass.
    expect(BLOOM_THRESHOLD_LINEAR).toBeCloseTo(srgbToLinear(200 / 255), 12);
    expect(BLOOM_THRESHOLD_LINEAR).toBeGreaterThan(0.57);
    expect(BLOOM_THRESHOLD_LINEAR).toBeLessThan(0.59);
  });
});

describe('ACES (Narkowicz)', () => {
  it('monotone croissante et bornée [0,1]', () => {
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const y = acesToneMap(i / 20); // 0..10 linéaire
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      prev = y;
    }
  });

  it('valeurs connues : blanc sRGB à ~0,80, zéro à 0', () => {
    expect(acesToneMap(0)).toBe(0);
    expect(acesToneMap(1)).toBeCloseTo(0.8037, 3);
    // L'énergie additive au-delà de 1 continue de monter (plus d'écrêtage dur).
    expect(acesToneMap(2)).toBeGreaterThan(acesToneMap(1));
  });
});

describe('AgX (ajustement minimal)', () => {
  it('les matrices sont bien inverses (M·M⁻¹ ≈ I)', () => {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let k = 0; k < 3; k++) {
          // colonne-majeure : M[ligne, colonne] = tab[colonne*3 + ligne]
          sum += AGX_MAT[k * 3 + r]! * AGX_MAT_INV[c * 3 + k]!;
        }
        expect(sum).toBeCloseTo(r === c ? 1 : 0, 6);
      }
    }
  });

  it('polynôme de contraste : ~0 en 0, ~1 en 1', () => {
    expect(agxContrast(0)).toBeCloseTo(0, 2);
    expect(agxContrast(1)).toBeCloseTo(1, 1);
  });

  it('chaîne complète : bornée, monotone sur les gris, neutre sur les gris', () => {
    let prev = -1;
    for (let i = 0; i <= 40; i++) {
      const x = i / 10; // 0..4 linéaire
      const [r, g, b] = agxToneMap([x, x, x]);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      // Un gris d'entrée reste un gris en sortie — à la précision des
      // constantes PUBLIÉES de l'ajustement minimal : leurs sommes de lignes
      // ne valent 1 qu'à ~1e-4 près, l'axe neutre dévie d'autant.
      expect(g).toBeCloseTo(r, 3);
      expect(b).toBeCloseTo(r, 3);
      expect(r).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = r;
    }
  });
});

describe('pulsar (épaule seule — la courbe retenue à la mesure)', () => {
  it('IDENTITÉ stricte sous le pivot : le contenu SDR traverse intact', () => {
    for (let i = 0; i <= 80; i++) {
      const x = (i / 100) * PULSAR_SHOULDER_PIVOT; // 0..pivot
      expect(pulsarToneMap(x)).toBe(x);
    }
  });

  it('continue et de dérivée ~1 au pivot (pas de cassure visible)', () => {
    const p = PULSAR_SHOULDER_PIVOT;
    const eps = 1e-6;
    expect(pulsarToneMap(p)).toBeCloseTo(p, 12);
    const slope = (pulsarToneMap(p + eps) - pulsarToneMap(p)) / eps;
    expect(slope).toBeCloseTo(1, 4);
  });

  it("monotone, bornée par 1, et l'énergie > 1 continue de monter (plus d'écrêtage dur)", () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const y = pulsarToneMap(i / 10); // 0..10
      expect(y).toBeGreaterThanOrEqual(prev);
      // Asymptote 1 : jamais dépassée ; l'exponentielle SATURE à 1 en
      // flottant au-delà de x ≈ 8, d'où <= et non <.
      expect(y).toBeLessThanOrEqual(1);
      prev = y;
    }
    expect(pulsarToneMap(2)).toBeGreaterThan(pulsarToneMap(1));
    expect(pulsarToneMap(1)).toBeGreaterThan(0.92); // le blanc sRGB reste quasi blanc
  });
});

describe('bloomLevelCount', () => {
  it('passes + 2 niveaux quand la place le permet, borné par des niveaux >= 8 px', () => {
    expect(bloomLevelCount(2, 480, 270)).toBe(4);
    expect(bloomLevelCount(1, 480, 270)).toBe(3);
    // Base minuscule : la pyramide s'arrête avant 8 px.
    expect(bloomLevelCount(2, 16, 16)).toBe(2);
    expect(bloomLevelCount(2, 8, 8)).toBe(1);
  });
});
