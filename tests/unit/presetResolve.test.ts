import { describe, expect, it } from 'vitest';
import { resolvePreset } from '../../src/presets/resolve';
import { DEFAULT_CLASSIFICATION_THRESHOLDS } from '../../src/analysis/classify';
import { defaultMapping } from '../../src/behaviour/mapping/defaults';
import { hexToColor } from '../../src/visual/palette/Palette';
import type { ImpulseMappingEntry } from '../../src/behaviour/mapping/MappingSchema';
import type { Preset, PresetMacros } from '../../src/presets/schema';

function neutralMacros(overrides: Partial<PresetMacros> = {}): PresetMacros {
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

function testPreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: 'test-preset',
    version: 1,
    name: 'Test',
    genre: { tempoHint: [100, 140], subDominance: 0.5, onsetDensity: 0.5, continuousRegimePreference: false },
    style: 'pulse',
    palette: {
      bg: ['#000000', '#111111'],
      primary: '#ff0000',
      secondary: '#00ff00',
      accent: '#0000ff',
      glow: '#ffff00',
      contrast: 0.5,
      drift: { lowEnergy: '#111111', highEnergy: '#ff0000' },
    },
    macros: neutralMacros(),
    safety: { reducedFlashing: false },
    ...overrides,
  };
}

describe('resolvePreset — mapping', () => {
  it('un signal jamais ciblé par une courbe de macro ni par le preset hérite de defaultMapping tel quel', () => {
    const result = resolvePreset(testPreset());
    expect(result.mapping.tension).toEqual(defaultMapping.tension);
  });

  it("un override de preset est repris tel quel quand aucune courbe de macro ne touche ses champs", () => {
    const preset = testPreset({ mapping: { tick: { from: ['KICK'], gain: 0.9, decay: 0.5 } } });
    const result = resolvePreset(preset, { macroCurves: {} }); // isole du câblage macro
    expect(result.mapping.tick).toEqual({ from: ['KICK'], gain: 0.9, decay: 0.5 });
  });

  it('une courbe de macro écrase la valeur héritée sur le chemin numérique qu\'elle cible', () => {
    const result = resolvePreset(testPreset({ macros: neutralMacros({ energy: 1 }) }));
    expect((result.mapping.impact as ImpulseMappingEntry).gain).toBeCloseTo(1.3, 10); // at1 de "mapping.impact.gain" (macros.ts)
  });

  it("les surcharges utilisateur (diff) s'appliquent en dernier et gagnent sur le preset ET les courbes de macro", () => {
    const preset = testPreset({
      mapping: { tick: { from: ['HAT'], gain: 0.4, decay: 0.05 } },
      macros: neutralMacros({ energy: 1 }),
    });
    const result = resolvePreset(preset, {
      userMappingOverrides: { tick: { from: ['KICK'], gain: 0.05, decay: 0.05 } },
    });
    expect(result.mapping.tick).toEqual({ from: ['KICK'], gain: 0.05, decay: 0.05 });
  });

  it('ne mute jamais le preset passé en entrée (fonction pure)', () => {
    const preset = testPreset({ mapping: { tick: { from: ['HAT'], gain: 0.4, decay: 0.05 } } });
    const mappingRef = preset.mapping;
    resolvePreset(preset);
    expect(preset.mapping).toBe(mappingRef);
    expect(preset.mapping!.tick).toEqual({ from: ['HAT'], gain: 0.4, decay: 0.05 });
  });
});

describe('resolvePreset — classification', () => {
  it("un override partiel ne touche que le champ précisé, le reste (même règle, autres règles) hérite des valeurs par défaut", () => {
    const result = resolvePreset(testPreset({ classification: { kick: { bassRatio: 0.7 } } }));
    expect(result.classification.kick.bassRatio).toBe(0.7);
    expect(result.classification.kick.maxCentroid).toBe(DEFAULT_CLASSIFICATION_THRESHOLDS.kick.maxCentroid);
    expect(result.classification.snare).toEqual(DEFAULT_CLASSIFICATION_THRESHOLDS.snare);
    expect(result.classification.hat).toEqual(DEFAULT_CLASSIFICATION_THRESHOLDS.hat);
  });
});

describe('resolvePreset — palette', () => {
  it('construit une Palette runtime dont les couleurs correspondent au JSON du preset', () => {
    const result = resolvePreset(testPreset());
    expect(result.palette.primary).toEqual(hexToColor('#ff0000'));
    expect(result.palette.id).toBe('test-preset');
  });

  it('temperature(0)/(1) retombe sur drift.lowEnergy/highEnergy', () => {
    const result = resolvePreset(testPreset());
    expect(result.palette.temperature(0)).toEqual(hexToColor('#111111'));
    expect(result.palette.temperature(1)).toEqual(hexToColor('#ff0000'));
  });
});

describe('resolvePreset — sortie gelée', () => {
  it('le preset résolu est immuable (Object.freeze de premier niveau)', () => {
    const result = resolvePreset(testPreset());
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.mapping)).toBe(true);
  });
});
