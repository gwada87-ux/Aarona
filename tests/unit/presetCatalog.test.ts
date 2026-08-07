import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRESET_CATALOG } from '../../src/presets/index';
import { resolvePreset } from '../../src/presets/resolve';
import { MACRO_NAMES, STYLE_IDS, STYLE_LABELS, validatePreset } from '../../src/presets/schema';
import trapDarkJson from '../../src/presets/genres/trap-dark.json';
import drillJson from '../../src/presets/genres/drill.json';
import houseJson from '../../src/presets/genres/house.json';
import lofiJson from '../../src/presets/genres/lofi.json';
import rnbJson from '../../src/presets/genres/rnb.json';

describe('PRESET_CATALOG — les 5 presets du MVP (docs/08_PRESETS.md)', () => {
  it('contient exactement les 5 presets attendus', () => {
    expect(PRESET_CATALOG.map((p) => p.id).sort()).toEqual(['drill', 'house', 'lofi', 'rnb', 'trap-dark'].sort());
  });

  it('chaque preset a un style parmi les 3 valides et une plage de tempo croissante', () => {
    for (const preset of PRESET_CATALOG) {
      expect(STYLE_IDS).toContain(preset.style);
      expect(preset.genre.tempoHint[0]).toBeLessThanOrEqual(preset.genre.tempoHint[1]);
    }
  });

  it('chaque preset définit les 8 macros dans [0,1]', () => {
    for (const preset of PRESET_CATALOG) {
      for (const name of MACRO_NAMES) {
        expect(preset.macros[name], `${preset.id}.macros.${name}`).toBeGreaterThanOrEqual(0);
        expect(preset.macros[name], `${preset.id}.macros.${name}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('chaque preset se résout sans exception', () => {
    for (const preset of PRESET_CATALOG) {
      expect(() => resolvePreset(preset)).not.toThrow();
    }
  });

  it('Lofi et R&B sont bien marqués à régime continu (docs/08 §"Adaptation automatique", étape 4)', () => {
    const lofi = PRESET_CATALOG.find((p) => p.id === 'lofi')!;
    const rnb = PRESET_CATALOG.find((p) => p.id === 'rnb')!;
    expect(lofi.genre.continuousRegimePreference).toBe(true);
    expect(rnb.genre.continuousRegimePreference).toBe(true);
  });

  it('R&B recâble bien impact sur SNARE/CLAP plutôt que KICK (docs/08 : "le snare mène, pas le kick")', () => {
    const rnb = PRESET_CATALOG.find((p) => p.id === 'rnb')!;
    expect(rnb.mapping?.impact?.from).toEqual(['SNARE', 'CLAP']);
  });

  it('Drill remonte bassRatio et abaisse maxDecay30 (docs/08 : faux positifs sur les 808 glissantes)', () => {
    const drill = PRESET_CATALOG.find((p) => p.id === 'drill')!;
    expect(drill.classification?.kick?.bassRatio).toBeGreaterThan(0.55); // > défaut docs/05
    expect(drill.classification?.kick?.maxDecay30).toBeLessThan(0.22); // < défaut docs/05
  });
});

/**
 * Chantier 1 de la phase 2 (docs/17_PHASE2_VISUELS.md §10.1).
 *
 * Le catalogue de styles était écrit en dur dans `index.html` : ajouter un
 * style demandait de modifier `schema.ts`, `App.ts` ET le HTML, sans qu'aucun
 * test ne signale l'oubli du troisième. Ces deux tests ferment la porte.
 */
describe('catalogue de styles — source unique', () => {
  it('chaque STYLE_ID a un libellé, et aucun libellé n\'est orphelin', () => {
    // `Record<StyleId, string>` fait déjà échouer la compilation sur un
    // identifiant sans libellé ; ce test attrape le cas inverse, qu'aucun type
    // ne couvre : un libellé resté en place après le retrait d'un style.
    expect(Object.keys(STYLE_LABELS).sort()).toEqual([...STYLE_IDS].sort());
    for (const id of STYLE_IDS) {
      expect(STYLE_LABELS[id]?.trim(), `libellé de ${id}`).toBeTruthy();
    }
  });

  it('index.html ne code plus aucune option de style en dur', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf-8');
    const select = html.match(/<select id="style-select"[^>]*>([\s\S]*?)<\/select>/);
    expect(select, 'le <select id="style-select"> a disparu de index.html').not.toBeNull();
    expect(
      select?.[1],
      'les options doivent être peuplées par AdvancedPanel depuis STYLE_IDS, pas écrites dans le HTML',
    ).not.toMatch(/<option/i);
  });
});

describe('validatePreset — sur les 5 fichiers JSON bruts (avant import typé)', () => {
  const files: Array<[string, unknown]> = [
    ['trap-dark.json', trapDarkJson],
    ['drill.json', drillJson],
    ['house.json', houseJson],
    ['lofi.json', lofiJson],
    ['rnb.json', rnbJson],
  ];

  for (const [name, json] of files) {
    it(`${name} est un preset structurellement valide`, () => {
      const result = validatePreset(json);
      expect(result.ok, !result.ok ? result.errors.join('; ') : undefined).toBe(true);
    });
  }
});

describe('validatePreset — rejets', () => {
  it('rejette une valeur qui n\'est pas un objet', () => {
    expect(validatePreset(null).ok).toBe(false);
    expect(validatePreset('trap-dark').ok).toBe(false);
  });

  it('rejette un style inconnu et une macro hors [0,1], en rapportant les deux erreurs à la fois', () => {
    const result = validatePreset({
      id: 'x',
      version: 1,
      name: 'X',
      style: 'not-a-style',
      genre: { tempoHint: [100, 140], subDominance: 0.5, onsetDensity: 0.5, continuousRegimePreference: false },
      palette: {
        bg: ['#000000', '#111111'],
        primary: '#ff0000',
        secondary: '#00ff00',
        accent: '#0000ff',
        glow: '#ffff00',
        contrast: 0.5,
        drift: { lowEnergy: '#111111', highEnergy: '#ff0000' },
      },
      macros: { energy: 1.5, reactivity: 0.5, density: 0.5, movement: 0.5, depth: 0.5, glow: 0.5, chaos: 0.5, smoothness: 0.5 },
      safety: { reducedFlashing: false },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('style'))).toBe(true);
      expect(result.errors.some((e) => e.includes('macros.energy'))).toBe(true);
    }
  });
});
