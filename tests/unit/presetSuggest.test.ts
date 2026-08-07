import { describe, expect, it } from 'vitest';
import { suggestPreset } from '../../src/presets/suggest';
import type { MusicEvent, PmdiDocument } from '../../src/music/pmdi';
import type { Preset } from '../../src/presets/schema';
import { PRESET_CATALOG } from '../../src/presets/index';
import { buildDemoDoc } from '../../src/ui/demoDoc';

/** Document dont le profil mesure EXACTEMENT (bpm, sub, densite). */
function docPourProfil(bpm: number, sub: number, densite: number): PmdiDocument {
  const duree = 120;
  const n = Math.max(1, Math.round(densite * 16 * duree));
  const events: MusicEvent[] = Array.from({ length: n }, (_, i) => ({
    t: (i / n) * duree, type: 'KICK', intensity: 0.8, confidence: 0.9,
  }));
  const plat = (v: number) => ({ hz: 1, t0: 0, data: new Array<number>(duree).fill(Math.max(0, v)) });
  return doc({
    audio: { duration: duree, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: bpm, confidence: 1, map: [{ t: 0, bpm }] },
    events,
    features: [
      { id: 'band.sub', ...plat(sub / 2) },
      { id: 'band.bass', ...plat(sub / 2) },
      { id: 'band.himid', ...plat((1 - sub) / 2) },
      { id: 'band.high', ...plat((1 - sub) / 2) },
    ],
  });
}

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
    // 900 onsets sur 60 s = 15/s. Le compte a été relevé de 400 quand la
    // référence de normalisation est passée de 8 à 16 onsets/s (recalibrage
    // post-phase 2) : 6,7/s valait 0,83 sur l'ancienne échelle et n'en vaut plus
    // que 0,42 sur la nouvelle, donc « dense » ne l'était plus. C'est le montage
    // du test qui était calé sur l'ancienne constante, pas l'intention.
    const events: MusicEvent[] = Array.from({ length: 900 }, (_, i) => ({ t: i * (60 / 900), type: 'HAT', intensity: 0.5, confidence: 0.8 }));
    const document = doc({ events, audio: { duration: 60, sampleRate: 44100, channels: 2 } }); // 15 onsets/s
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

/**
 * Recalibrage post-phase 2. Le catalogue est passé de cinq presets à onze au
 * chantier 9, et la constante de normalisation de la densité datait des cinq.
 */
describe('suggestPreset — calibrage sur le VRAI catalogue', () => {
  it('chaque preset se retrouve LUI-MÊME depuis son profil déclaré', () => {
    // Le test qui compte : si le profil qu'un preset déclare ne le retrouve
    // pas, la suggestion est fausse par construction, quel que soit le reste.
    // Onze sur onze au moment du recalibrage.
    for (const p of PRESET_CATALOG) {
      const bpm = (p.genre.tempoHint[0] + p.genre.tempoHint[1]) / 2;
      const result = suggestPreset(docPourProfil(bpm, p.genre.subDominance, p.genre.onsetDensity), PRESET_CATALOG);
      expect(result?.preset.id, `${p.id} ne se retrouve pas`).toBe(p.id);
    }
  });

  it('un motif ORDINAIRE ne sature plus le critère de densité', () => {
    // Ce qui a tranché le recalibrage : la piste de démonstration - kick à la
    // noire, caisse aux temps 2 et 4, charley à la croche, 120 BPM - produit
    // 7,55 onsets/s. Avec l'ancienne référence de 8, elle valait 0,94 : le
    // critère était au plafond dès le motif le plus banal et ne discriminait
    // plus rien au-dessus.
    const demo = buildDemoDoc(60);
    const ponctuels = demo.events.filter((e) => e.dur === undefined).length;
    const parSeconde = ponctuels / demo.audio.duration;
    expect(parSeconde).toBeGreaterThan(6);
    expect(parSeconde / 16, 'un motif ordinaire doit rester au milieu de l\'échelle').toBeLessThan(0.6);
  });

  it('le SECOND candidat est nommé quand il est aussi plausible', () => {
    // docs/08 : « un bon point de départ », pas de la classification de genre.
    // Deux presets à 0,001 près, c'est un choix arbitraire déguisé en verdict.
    const a = preset('a', { tempoHint: [120, 130], subDominance: 0.5, onsetDensity: 0.5 });
    const b = preset('b', { tempoHint: [120, 130], subDominance: 0.52, onsetDensity: 0.5 });
    const result = suggestPreset(docPourProfil(125, 0.5, 0.5), [a, b]);
    expect(result?.runnerUp?.id, 'le second devrait être nommé').toBe('b');
    expect(result?.reason).toContain('conviendrait aussi');
  });

  it('...et TU sur une suggestion nette', () => {
    // Le nommer quand la suggestion est franche ferait douter sans raison.
    const proche = preset('proche', { tempoHint: [120, 130], subDominance: 0.5, onsetDensity: 0.5 });
    const loin = preset('loin', { tempoHint: [40, 50], subDominance: 0.05, onsetDensity: 0.95 });
    const result = suggestPreset(docPourProfil(125, 0.5, 0.5), [proche, loin]);
    expect(result?.preset.id).toBe('proche');
    expect(result?.runnerUp).toBeNull();
    expect(result?.reason).not.toContain('conviendrait aussi');
  });

  it('un catalogue d\'UN SEUL preset n\'a pas de second', () => {
    expect(suggestPreset(doc(), [preset('seul')])?.runnerUp).toBeNull();
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
