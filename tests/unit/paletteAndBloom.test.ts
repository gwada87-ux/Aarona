/**
 * Couleurs et bloom par preset (docs/17_PHASE2_VISUELS.md §9.2 et §6.5,
 * chantier 9).
 *
 * Deux réglages qui étaient offerts au choix sans rien changer : la macro Glow
 * n'atteignait pas le bloom, et la dérive de température n'était lue qu'à ses
 * deux bornes. C'est le même diagnostic que §5, appliqué aux couleurs.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PALETTE_CATALOGUE, cataloguePaletteById } from '../../src/presets/paletteCatalogue';
import { DEFAULT_PRESET_BLOOM, MAX_BLOOM_PASSES, resolveBloom } from '../../src/presets/bloom';
import { buildPalette } from '../../src/presets/palette';
import { contrastRatio } from '../../src/visual/palette/contrast';
import { rgbToOklch } from '../../src/core/color/oklch';

const HAUT = { enabled: true, resolutionScale: 1 / 4, passes: 2 };
const ULTRA = { enabled: true, resolutionScale: 1 / 2, passes: 2 };
const BAS = { enabled: false, resolutionScale: 1, passes: 0 };

describe('resolveBloom — le preset propose, la qualité plafonne', () => {
  it('le niveau `low` coupe le bloom, quoi que veuille le preset', () => {
    // Un plafond est un veto : le niveau bas existe parce que la machine ne
    // suit pas, aucune intention artistique ne doit pouvoir le rallumer.
    expect(resolveBloom({ enabled: true, passes: 3 }, 1, BAS).enabled).toBe(false);
  });

  it('un preset MAT reste mat au niveau le plus haut', () => {
    // C'est le defaut corrige : avant, `ultra` imposait ses deux passes a tout
    // le monde, et un preset volontairement sec sortait aussi flou qu'un autre.
    expect(resolveBloom({ enabled: false, passes: 3 }, 1, ULTRA).enabled).toBe(false);
  });

  it('la macro Glow MODULE les passes autour de l\'intention du preset', () => {
    const mat = { enabled: true, passes: 1 };
    const dense = { enabled: true, passes: 3 };
    // A 0,5 - valeur neutre - le preset est rendu tel qu'il se decrit.
    expect(resolveBloom(mat, 0.5, ULTRA).passes).toBe(1);
    // Au minimum, le curseur doit pouvoir aller jusqu'a eteindre un preset mat :
    // sans bas de course, il n'y a pas de reglage.
    expect(resolveBloom(mat, 0, ULTRA).enabled).toBe(false);
    // Et un preset dense reste plus flou qu'un preset mat a reglage egal.
    expect(resolveBloom(dense, 0.5, ULTRA).passes).toBeGreaterThan(resolveBloom(mat, 0.5, ULTRA).passes);
  });

  it('ne dépasse jamais le plafond de passes du niveau', () => {
    expect(resolveBloom({ enabled: true, passes: 3 }, 1, HAUT).passes).toBeLessThanOrEqual(HAUT.passes);
    expect(resolveBloom({ enabled: true, passes: 3 }, 1, ULTRA).passes).toBeLessThanOrEqual(MAX_BLOOM_PASSES);
  });

  it('`resolutionScale` reste TOUJOURS celui du plafond', () => {
    // C'est un reglage de cout, pas d'intention : un preset n'a rien a en dire.
    expect(resolveBloom({ enabled: true, passes: 2 }, 1, HAUT).resolutionScale).toBe(HAUT.resolutionScale);
    expect(resolveBloom(undefined, 0, HAUT).resolutionScale).toBe(HAUT.resolutionScale);
  });

  it('un preset sans `bloom` garde le comportement d\'avant le chantier', () => {
    expect(resolveBloom(undefined, 0.5, ULTRA)).toEqual(resolveBloom(DEFAULT_PRESET_BLOOM, 0.5, ULTRA));
  });
});

describe('le bloom atteint l\'APERÇU et l\'EXPORT', () => {
  it('les deux chemins passent par `resolveBloom`', () => {
    // Sans la ligne cote export, un preset mat sortirait en video avec le halo
    // maximal du niveau HIGH : l'apercu et le fichier ne se ressembleraient plus.
    const app = readFileSync(join(process.cwd(), 'src/ui/App.ts'), 'utf-8');
    expect(app).toContain('resolveBloom(');
    const pipeline = readFileSync(join(process.cwd(), 'src/export/ExportPipeline.ts'), 'utf-8');
    expect(pipeline).toContain('resolveBloom(');
    const dialog = readFileSync(join(process.cwd(), 'src/ui/dialogs/ExportDialog.ts'), 'utf-8');
    expect(dialog, 'le dialogue doit transmettre l\'intention de bloom').toContain('getBloom()');
  });
});

describe('catalogue de palettes (§9.2)', () => {
  it('contient les huit familles du mode live', () => {
    // §9.2 : « Regarde-les avant d'en inventer. » Elles ont tourne en direct sur
    // du son reel ; en inventer huit autres aurait produit, au mieux, les memes.
    expect(PALETTE_CATALOGUE.map((p) => p.id)).toEqual([
      'nocturne', 'glacier', 'ember', 'amber', 'cyan-magenta', 'lime-violet', 'graphite', 'pulsar',
    ]);
  });

  it('chaque palette tient le rapport de 4:1 contre son fond', () => {
    for (const p of PALETTE_CATALOGUE) {
      const pal = buildPalette(p.id, p.config);
      const plusIntense = [pal.primary, pal.secondary, pal.accent, pal.glow].reduce((m, c) =>
        contrastRatio(c, pal.bg[1]) > contrastRatio(m, pal.bg[1]) ? c : m,
      );
      expect(contrastRatio(plusIntense, pal.bg[1]), `${p.id}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('l\'ACCENT lui-même tient 4:1 — il porte de l\'information', () => {
    // `lime-violet` echouait a 3,81:1 avec la clarte du mode live : le fond du
    // mode fichier est plus sombre, et un accent marque une frappe, donc il doit
    // tenir le seuil pour lui-meme et pas via la primaire.
    for (const p of PALETTE_CATALOGUE) {
      const pal = buildPalette(p.id, p.config);
      expect(contrastRatio(pal.accent, pal.bg[1]), `${p.id} : accent contre fond`).toBeGreaterThanOrEqual(4);
    }
  });

  it('le fond sombre du dégradé est plus sombre que le fond', () => {
    for (const p of PALETTE_CATALOGUE) {
      const pal = buildPalette(p.id, p.config);
      const l0 = rgbToOklch({ r: pal.bg[0].r / 255, g: pal.bg[0].g / 255, b: pal.bg[0].b / 255 }).l;
      const l1 = rgbToOklch({ r: pal.bg[1].r / 255, g: pal.bg[1].g / 255, b: pal.bg[1].b / 255 }).l;
      expect(l0, `${p.id} : bg[0] doit être le plus sombre`).toBeLessThan(l1);
    }
  });

  it('aucune palette n\'est monochrome par accident', () => {
    // `graphite` l'est par CHOIX ; les sept autres doivent avoir un ecart de
    // teinte reel entre primaire et accent, sinon la palette ne se lit pas.
    for (const p of PALETTE_CATALOGUE) {
      if (p.id === 'graphite') continue;
      const pal = buildPalette(p.id, p.config);
      const hp = rgbToOklch({ r: pal.primary.r / 255, g: pal.primary.g / 255, b: pal.primary.b / 255 }).h;
      const ha = rgbToOklch({ r: pal.accent.r / 255, g: pal.accent.g / 255, b: pal.accent.b / 255 }).h;
      const ecart = Math.min(Math.abs(hp - ha), 360 - Math.abs(hp - ha));
      expect(ecart, `${p.id} : primaire et accent trop proches en teinte`).toBeGreaterThan(20);
    }
  });

  it('`cataloguePaletteById` retrouve, et rend `null` sur inconnu', () => {
    expect(cataloguePaletteById('pulsar')?.id).toBe('pulsar');
    expect(cataloguePaletteById('inexistante')).toBeNull();
  });
});
