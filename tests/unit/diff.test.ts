import { describe, expect, it } from 'vitest';
import { applyPresetDiff, computePresetDiff } from '../../src/project/diff';

describe('computePresetDiff', () => {
  it('détecte une différence sur un champ de premier niveau', () => {
    const diff = computePresetDiff({ energy: 0.5 }, { energy: 0.9 });
    expect(diff).toEqual({ energy: 0.9 });
  });

  it('détecte une différence imbriquée avec un chemin pointé ("layers.particles.count")', () => {
    const base = { layers: { particles: { count: 2500 } } };
    const modified = { layers: { particles: { count: 3200 } } };
    const diff = computePresetDiff(base, modified);
    expect(diff).toEqual({ 'layers.particles.count': 3200 });
  });

  it('ne produit rien pour deux objets identiques', () => {
    const base = { macros: { glow: 0.7 }, style: 'field' };
    expect(computePresetDiff(base, { ...base })).toEqual({});
  });

  it('ignore les valeurs de type tableau (hors du type PresetDiff, docs/13)', () => {
    const base = { palette: { bg: ['#000000', '#111111'] } };
    const modified = { palette: { bg: ['#222222', '#333333'] } };
    const diff = computePresetDiff(base, modified);
    expect(diff).toEqual({});
  });

  it('un champ absent de la base est reporté (nouvelle valeur)', () => {
    const diff = computePresetDiff({}, { macros: { glow: 0.85 } });
    expect(diff).toEqual({ 'macros.glow': 0.85 });
  });

  it('combine plusieurs différences à des profondeurs différentes', () => {
    const base = { macros: { glow: 0.5, chaos: 0.2 }, layers: { particles: { count: 2500 } } };
    const modified = { macros: { glow: 0.85, chaos: 0.2 }, layers: { particles: { count: 3200 } } };
    const diff = computePresetDiff(base, modified);
    expect(diff).toEqual({ 'macros.glow': 0.85, 'layers.particles.count': 3200 });
  });
});

describe('applyPresetDiff', () => {
  it('applique une valeur de premier niveau', () => {
    const result = applyPresetDiff({ energy: 0.5 }, { energy: 0.9 });
    expect(result).toEqual({ energy: 0.9 });
  });

  it('crée les objets intermédiaires manquants pour un chemin imbriqué', () => {
    const result = applyPresetDiff({}, { 'layers.particles.count': 3200 });
    expect(result).toEqual({ layers: { particles: { count: 3200 } } });
  });

  it('ne mute jamais la base passée en entrée', () => {
    const base = { macros: { glow: 0.5 } };
    applyPresetDiff(base, { 'macros.glow': 0.9 });
    expect(base.macros.glow).toBe(0.5);
  });

  it('round-trip avec computePresetDiff : appliquer le diff calculé restitue la version modifiée', () => {
    const base = { macros: { glow: 0.5, chaos: 0.2 }, style: 'pulse' };
    const modified = { macros: { glow: 0.85, chaos: 0.2 }, style: 'pulse' };
    const diff = computePresetDiff(base, modified);
    const result = applyPresetDiff(base, diff);
    expect(result).toEqual(modified);
  });
});
