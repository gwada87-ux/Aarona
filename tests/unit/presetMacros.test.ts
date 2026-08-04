import { describe, expect, it } from 'vitest';
import { applyMacroCurves, WIRED_MACRO_CURVES, type MacroCurveTable } from '../../src/presets/macros';
import type { PresetMacros } from '../../src/presets/schema';

function macros(overrides: Partial<PresetMacros> = {}): PresetMacros {
  return {
    energy: 0.5,
    reactivity: 0.5,
    density: 0.5,
    movement: 0.5,
    depth: 0.5,
    glow: 0.5,
    chaos: 0.5,
    smoothness: 0.5,
    ...overrides,
  };
}

describe('applyMacroCurves', () => {
  it('at 0, chaque chemin vaut exactement at0 ; à 1, exactement at1 (linéaire par défaut)', () => {
    const low = applyMacroCurves(macros({ energy: 0 }));
    const high = applyMacroCurves(macros({ energy: 1 }));
    expect(low['mapping.impact.gain']).toBeCloseTo(0.3, 10);
    expect(high['mapping.impact.gain']).toBeCloseTo(1.3, 10);
    expect(low['mapping.tick.gain']).toBeCloseTo(0.2, 10);
    expect(high['mapping.tick.gain']).toBeCloseTo(1.0, 10);
  });

  it('interpole linéairement au milieu de la course pour un chemin sans courbe déclarée', () => {
    const mid = applyMacroCurves(macros({ energy: 0.5 }));
    // mapping.subImpact.gain: at0=0.3, at1=1.3 → milieu = 0.8
    expect(mid['mapping.subImpact.gain']).toBeCloseTo(0.8, 10);
  });

  it('applique la courbe easeOut (non linéaire) au chemin qui la déclare (docs/08, exemple reactivity)', () => {
    const mid = applyMacroCurves(macros({ reactivity: 0.5 }));
    const linearMidpoint = 0.3 + (0.06 - 0.3) * 0.5; // 0.18, valeur qu'on obtiendrait SANS easeOut
    // easeOut(0.5) = 1 - 0.5² = 0.75 : à mi-course, on est déjà aux 3/4 du trajet vers at1.
    const expected = 0.3 + (0.06 - 0.3) * 0.75;
    expect(mid['mapping.impact.decay']).toBeCloseTo(expected, 10);
    expect(mid['mapping.impact.decay']).not.toBeCloseTo(linearMidpoint, 2);
  });

  it("clampe une valeur de macro hors [0,1] plutôt que d'extrapoler au-delà de at0/at1", () => {
    const beyond = applyMacroCurves(macros({ energy: 1.5 }));
    const negative = applyMacroCurves(macros({ energy: -0.5 }));
    expect(beyond['mapping.impact.gain']).toBeCloseTo(1.3, 10);
    expect(negative['mapping.impact.gain']).toBeCloseTo(0.3, 10);
  });

  it("chaque macro cablée (energy, reactivity) a un effet perceptible sur toute sa course : at0 ≠ at1 pour tous ses chemins", () => {
    for (const [macroName, curves] of Object.entries(WIRED_MACRO_CURVES)) {
      expect(curves, `macro "${macroName}" sans chemin câblé`).toBeTruthy();
      for (const [path, point] of Object.entries(curves!)) {
        expect(point.at0, `${macroName} → ${path} : at0 === at1, aucun effet`).not.toBe(point.at1);
      }
    }
  });

  it("une macro sans entrée dans la table ne produit aucun chemin (densité/mouvement/profondeur/glow/chaos/douceur — voir macros.ts)", () => {
    const restricted: MacroCurveTable = { energy: WIRED_MACRO_CURVES.energy };
    const result = applyMacroCurves(macros({ reactivity: 1 }), restricted);
    expect(Object.keys(result).some((p) => p.startsWith('mapping.impact.decay'))).toBe(false);
  });

  it('deux macros ciblant des chemins disjoints produisent l\'union de leurs overrides', () => {
    const result = applyMacroCurves(macros({ energy: 1, reactivity: 0 }));
    expect(result['mapping.impact.gain']).toBeCloseTo(1.3, 10); // energy=1
    expect(result['mapping.impact.decay']).toBeCloseTo(0.3, 10); // reactivity=0, easeOut(0)=0
  });
});
