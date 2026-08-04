import { describe, expect, it } from 'vitest';
import { suggestPreset } from '../../src/presets/suggest';
import type { MusicEvent, PmdiDocument } from '../../src/music/pmdi';
import type { Preset } from '../../src/presets/schema';

function preset(id: string, overrides: Partial<Preset['genre']> = {}, style: Preset['style'] = 'pulse'): Preset {
  return {
    id,
    version: 1,
    name: id,
    genre: { tempoHint: [100, 140], subDominance: 0.5, onsetDensity: 0.5, continuousRegimePreference: false, ...overrides },
    style,
    palette: {
      bg: ['#000000', '#111111'],
      primary: '#ff0000',
      secondary: '#00ff00',
      accent: '#0000ff',
      glow: '#ffff00',
      contrast: 0.5,
      drift: { lowEnergy: '#111111', highEnergy: '#ff0000' },
    },
    macros: { energy: 0.5, reactivity: 0.5, density: 0.5, movement: 0.5, depth: 0.5, glow: 0.5, chaos: 0.5, smoothness: 0.5 },
    safety: { reducedFlashing: false },
  };
}

function doc(overrides: Partial<PmdiDocument> = {}): PmdiDocument {
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test', createdAt: '2026-01-01T00:00:00Z' },
    audio: { duration: 60, sampleRate: 44100, channels: 2 },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
    ...overrides,
  };
}

function bandFeature(id: string, value: number) {
  return { id, hz: 1, t0: 0, data: [value, value, value] };
}

describe('suggestPreset — étape 1 : correspondance de tempo', () => {
  it('choisit le preset dont la plage de tempo contient le tempo détecté, à profil/densité identiques', () => {
    const slow = preset('slow', { tempoHint: [60, 90] });
    const fast = preset('fast', { tempoHint: [138, 150] });
    const result = suggestPreset(doc({ tempo: { global: 70, confidence: 1, map: [{ t: 0, bpm: 70 }] } }), [slow, fast]);
    expect(result?.preset.id).toBe('slow');
  });

  it('doubleTimeHint élargit la correspondance au double/à la moitié du tempo détecté (docs/05 §1)', () => {
    const trapLike = preset('trap-like', { tempoHint: [60, 90], doubleTimeHint: true });
    const other = preset('other', { tempoHint: [200, 240] });
    // 140 BPM détecté, mais 140/2=70 tombe dans [60,90] grâce à doubleTimeHint.
    const result = suggestPreset(doc({ tempo: { global: 140, confidence: 1, map: [{ t: 0, bpm: 140 }] } }), [trapLike, other]);
    expect(result?.preset.id).toBe('trap-like');
  });
});

describe('suggestPreset — étape 2 : profil spectral', () => {
  it('un profil grave dominant favorise le preset au subDominance élevé', () => {
    const subHeavy = preset('sub-heavy', { subDominance: 0.9 });
    const midHeavy = preset('mid-heavy', { subDominance: 0.1 });
    const document = doc({
      features: [bandFeature('band.sub', 0.9), bandFeature('band.bass', 0.9), bandFeature('band.himid', 0.05), bandFeature('band.high', 0.05)],
    });
    const result = suggestPreset(document, [subHeavy, midHeavy]);
    expect(result?.preset.id).toBe('sub-heavy');
  });
});

describe('suggestPreset — étape 3 : densité d\'onsets', () => {
  it('une forte densité d\'événements ponctuels favorise le preset au onsetDensity le plus proche', () => {
    const dense = preset('dense', { onsetDensity: 0.9 });
    const sparse = preset('sparse', { onsetDensity: 0.1 });
    const events: MusicEvent[] = Array.from({ length: 400 }, (_, i) => ({ t: i * 0.1, type: 'HAT', intensity: 0.5, confidence: 0.8 }));
    const document = doc({ events, audio: { duration: 60, sampleRate: 44100, channels: 2 } }); // ~6,7 onsets/s
    const result = suggestPreset(document, [dense, sparse]);
    expect(result?.preset.id).toBe('dense');
  });

  it("les événements de DURÉE (DROP/BUILDUP/BREAK/SILENCE) ne comptent pas comme des onsets ponctuels", () => {
    const events: MusicEvent[] = [{ t: 5, type: 'BUILDUP', intensity: 0.9, confidence: 0.7, dur: 3 }];
    const document = doc({ events });
    const only = preset('only', { onsetDensity: 0 });
    const result = suggestPreset(document, [only]);
    // tempo/profil neutres par construction (valeurs par défaut identiques doc/preset) : si le
    // BUILDUP polluait la densité mesurée, le score tomberait sous 1.
    expect(result?.score).toBeCloseTo(1, 5);
  });
});

describe('suggestPreset — étape 4 : confiance de grille basse → régime continu', () => {
  it("restreint aux presets à régime continu même si un autre matcherait mieux sur tempo/profil", () => {
    const perfectMatchButEvent = preset('event-regime', { tempoHint: [119, 121], subDominance: 0.5, onsetDensity: 0.5 });
    const continuousFallback = preset('continuous-regime', { tempoHint: [10, 20], subDominance: 0, onsetDensity: 0, continuousRegimePreference: true });
    const document = doc({ confidence: { tempo: 1, grid: 0.3, classification: 1, structure: 1 } });
    const result = suggestPreset(document, [perfectMatchButEvent, continuousFallback]);
    expect(result?.preset.id).toBe('continuous-regime');
  });

  it('sans preset à régime continu dans le catalogue, retombe sur le meilleur score du catalogue entier', () => {
    const onlyEventRegime = preset('event-only', { tempoHint: [119, 121] });
    const document = doc({ confidence: { tempo: 1, grid: 0.1, classification: 1, structure: 1 } });
    const result = suggestPreset(document, [onlyEventRegime]);
    expect(result?.preset.id).toBe('event-only');
  });
});

describe('suggestPreset — cas limites', () => {
  it('catalogue vide → null', () => {
    expect(suggestPreset(doc(), [])).toBeNull();
  });

  it('le motif de la suggestion mentionne explicitement "suggéré d\'après l\'analyse" (docs/08)', () => {
    const result = suggestPreset(doc(), [preset('p')]);
    expect(result?.reason).toContain("suggéré d'après l'analyse");
  });
});
