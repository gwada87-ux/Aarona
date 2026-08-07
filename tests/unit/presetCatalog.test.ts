import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PRESET_CATALOG } from '../../src/presets/index';
import { resolvePreset } from '../../src/presets/resolve';
import { buildPalette } from '../../src/presets/palette';
import { contrastRatio } from '../../src/visual/palette/contrast';
import { MACRO_NAMES, STYLE_IDS, STYLE_LABELS, validatePreset } from '../../src/presets/schema';
import trapDarkJson from '../../src/presets/genres/trap-dark.json';
import drillJson from '../../src/presets/genres/drill.json';
import houseJson from '../../src/presets/genres/house.json';
import lofiJson from '../../src/presets/genres/lofi.json';
import rnbJson from '../../src/presets/genres/rnb.json';
import technoJson from '../../src/presets/genres/techno.json';
import dubstepJson from '../../src/presets/genres/dubstep.json';
import edmJson from '../../src/presets/genres/edm.json';
import phonkJson from '../../src/presets/genres/phonk.json';
import afroJson from '../../src/presets/genres/afro.json';
import ambientJson from '../../src/presets/genres/ambient.json';

describe('PRESET_CATALOG — les 11 presets de genre (docs/17 §9.4, chantier 9)', () => {
  it('contient exactement les 11 presets attendus', () => {
    expect(PRESET_CATALOG.map((p) => p.id).sort()).toEqual(
      ['trap-dark', 'drill', 'house', 'lofi', 'rnb', 'techno', 'dubstep', 'edm', 'phonk', 'afro', 'ambient'].sort(),
    );
  });

  it('CHAQUE STYLE a au moins un preset', () => {
    // C'est la troisieme cause du grief d'origine : cinq presets ne pointaient
    // que sur TROIS styles, donc deux presets sur cinq rendaient la meme
    // geometrie a la palette pres. Sans ce test, ajouter un style au chantier
    // suivant le laisserait de nouveau inatteignable par le selecteur de preset.
    const couverts = new Set(PRESET_CATALOG.map((p) => p.style));
    for (const id of STYLE_IDS) {
      expect(couverts.has(id), `aucun preset ne pointe sur le style ${id}`).toBe(true);
    }
  });

  it('chaque preset declare les TREIZE entrees cablables', () => {
    // Une entree omise retombe sur `defaultMapping`, donc rend deux presets
    // identiques sur ce signal - ce que §9.4 refuse explicitement.
    const attendues = [
      'impact', 'subImpact', 'accent', 'tick', 'sectionShift',
      'drive', 'weight', 'brightness', 'tension',
      'lfoA', 'lfoB', 'lfoC', 'lfoD',
    ];
    for (const preset of PRESET_CATALOG) {
      for (const signal of attendues) {
        expect(preset.mapping?.[signal as keyof typeof preset.mapping], `${preset.id}.mapping.${signal}`).toBeDefined();
      }
    }
  });

  it('aucun preset ne partage le cablage d\'un autre', () => {
    const empreintes = PRESET_CATALOG.map((p) => JSON.stringify(p.mapping));
    expect(new Set(empreintes).size, 'deux presets ont exactement le meme cablage').toBe(PRESET_CATALOG.length);
  });

  it('les presets qui partagent un style ont des palettes DIFFERENTES', () => {
    // Onze presets pour huit styles : trois styles en portent deux. S'ils
    // avaient aussi la meme palette, ils seraient indiscernables a l'oeil.
    const parStyle = new Map<string, string[]>();
    for (const p of PRESET_CATALOG) {
      const l = parStyle.get(p.style) ?? [];
      l.push(JSON.stringify(p.palette));
      parStyle.set(p.style, l);
    }
    for (const [style, palettes] of parStyle) {
      expect(new Set(palettes).size, `deux presets du style ${style} ont la meme palette`).toBe(palettes.length);
    }
  });

  it('chaque preset declare son intention de BLOOM (§6.5)', () => {
    for (const preset of PRESET_CATALOG) {
      expect(preset.bloom, `${preset.id}.bloom`).toBeDefined();
      expect(preset.bloom!.passes, `${preset.id}.bloom.passes`).toBeGreaterThanOrEqual(0);
      expect(preset.bloom!.passes, `${preset.id}.bloom.passes`).toBeLessThanOrEqual(3);
    }
    // ...et toutes les valeurs ne sont pas identiques, sinon le champ ne sert a
    // rien et le curseur Glow module la meme chose partout.
    expect(new Set(PRESET_CATALOG.map((p) => p.bloom!.passes)).size).toBeGreaterThan(1);
  });

  it('chaque palette de preset tient le rapport de 4:1 (§9.2, critere 10)', () => {
    for (const preset of PRESET_CATALOG) {
      const pal = buildPalette(preset.id, preset.palette);
      const plusIntense = [pal.primary, pal.secondary, pal.accent, pal.glow].reduce((m, c) =>
        contrastRatio(c, pal.bg[1]) > contrastRatio(m, pal.bg[1]) ? c : m,
      );
      expect(contrastRatio(plusIntense, pal.bg[1]), `${preset.id} : fond contre couleur la plus intense`).toBeGreaterThanOrEqual(4);
    }
  });

  it('chaque preset a un style valide et une plage de tempo croissante', () => {
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

  it('index.html ne code plus aucun style en dur', () => {
    // Chantier 10 : la liste deroulante est devenue une grille de VIGNETTES
    // (docs/17 §10.1). La garde ne change pas de nature - le HTML ne doit
    // contenir NI option NI libelle de style - seul le conteneur change.
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf-8');
    const grid = html.match(/<div id="style-grid"[^>]*>([\s\S]*?)<\/div>/);
    expect(grid, 'le conteneur <div id="style-grid"> a disparu de index.html').not.toBeNull();
    expect(grid?.[1]?.trim(), 'la grille doit être peuplée par AdvancedPanel, pas écrite dans le HTML').toBe('');
    for (const id of STYLE_IDS) {
      expect(html, `le style ${id} est écrit en dur dans index.html`).not.toContain(STYLE_LABELS[id]);
    }
  });
});

describe('validatePreset — sur les 11 fichiers JSON bruts (avant import typé)', () => {
  const files: Array<[string, unknown]> = [
    ['trap-dark.json', trapDarkJson],
    ['drill.json', drillJson],
    ['house.json', houseJson],
    ['lofi.json', lofiJson],
    ['rnb.json', rnbJson],
    ['techno.json', technoJson],
    ['dubstep.json', dubstepJson],
    ['edm.json', edmJson],
    ['phonk.json', phonkJson],
    ['afro.json', afroJson],
    ['ambient.json', ambientJson],
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
