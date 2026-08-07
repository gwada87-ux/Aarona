/**
 * Composition de la pochette (docs/17_PHASE2_VISUELS.md §7.5, chantier 7).
 *
 * La pochette n'appartient à aucun style : elle s'ajoute par-dessus celui qu'on
 * a choisi. Ce fichier vérifie que la composition est correcte pour les HUIT
 * styles, et surtout que l'aperçu et l'export la posent tous les deux — le
 * piège de l'Étape 25, où les macros de couche avaient été branchées d'un seul
 * côté sans que personne le voie pendant plusieurs étapes.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STYLE_IDS, type StyleId } from '../../src/presets/schema';
import { withCover } from '../../src/visual/scene/withCover';
import type { Scene } from '../../src/visual/scene/Scene';
import { createPulseStyle } from '../../src/visual/styles/pulse/createPulseStyle';
import { createFieldStyle } from '../../src/visual/styles/field/createFieldStyle';
import { createSpectrumProStyle } from '../../src/visual/styles/spectrum-pro/createSpectrumProStyle';
import { createMonolithStyle } from '../../src/visual/styles/monolith/createMonolithStyle';
import { createIsoPulseStyle } from '../../src/visual/styles/iso-pulse/createIsoPulseStyle';
import { createChambreStyle } from '../../src/visual/styles/chambre/createChambreStyle';
import { createEclatsStyle } from '../../src/visual/styles/eclats/createEclatsStyle';
import { createAuroreStyle } from '../../src/visual/styles/aurore/createAuroreStyle';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';

const FACTORIES: Readonly<Record<StyleId, () => Scene>> = {
  pulse: createPulseStyle,
  field: createFieldStyle,
  'spectrum-pro': createSpectrumProStyle,
  monolith: createMonolithStyle,
  'iso-pulse': createIsoPulseStyle,
  chambre: createChambreStyle,
  eclats: createEclatsStyle,
  aurore: createAuroreStyle,
};

describe('withCover — composition sur les huit styles', () => {
  it('ajoute la couche pochette EN DERNIER, quel que soit le style', () => {
    // En dernier, donc dessinée par-dessus : une pochette à moitié cachée par
    // des particules ne remplit plus sa fonction, qui est d'être lisible.
    for (const id of STYLE_IDS) {
      const base = FACTORIES[id]();
      const avec = withCover(base, true);
      expect(avec.layers.length, id).toBe(base.layers.length + 1);
      expect(avec.layers[avec.layers.length - 1]!.id, `${id} : la pochette n'est pas la dernière couche`).toBe('coverArt');
    }
  });

  it('sans pochette, rend la scène TELLE QUELLE', () => {
    for (const id of STYLE_IDS) {
      const base = FACTORIES[id]();
      expect(withCover(base, false), id).toBe(base);
    }
  });

  it('n\'ajoute jamais deux fois la couche', () => {
    // `applyActiveConfiguration` est rappelée à chaque changement de preset, de
    // palette ou de macro. Sans cette garde, la pile de couches grossirait à
    // chaque interaction.
    const once = withCover(createPulseStyle(), true);
    expect(withCover(once, true).layers.length).toBe(once.layers.length);
  });

  it('préserve `usesFeedback` du style d\'origine', () => {
    // Une scène recomposée qui perdrait son feedback perdrait ses traînées, et
    // le symptôme — « le style a changé d'aspect quand j'ai mis une pochette » —
    // ne pointerait pas vers cette fonction.
    for (const id of STYLE_IDS) {
      const base = FACTORIES[id]();
      expect(withCover(base, true).usesFeedback, id).toBe(base.usesFeedback);
    }
  });
});

describe('CoverArt — comportement sans image', () => {
  it('reste INERTE quand aucune pochette n\'est fournie', () => {
    // Un rectangle de remplacement serait pire que rien : il occuperait le
    // centre du cadre sans porter la moindre information.
    const scene = withCover(createPulseStyle(), true);
    scene.init({ renderer: new FakeRenderer(), palette: defaultPalette, cover: null });

    const avecCouche = new FakeRenderer();
    scene.draw(avecCouche, testViewport);

    const sansCouche = new FakeRenderer();
    const nue = createPulseStyle();
    nue.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    nue.draw(sansCouche, testViewport);

    expect(avecCouche.calls.length, 'la couche dessine alors qu\'elle n\'a pas d\'image').toBe(sansCouche.calls.length);
  });
});

describe('la pochette atteint l\'APERÇU et l\'EXPORT', () => {
  it('les deux chemins composent la scène avec `withCover`', () => {
    // Sans cette vérification, l'export produirait la même image MOINS la
    // pochette, et le défaut ne se verrait sur aucune vignette.
    const app = readFileSync(join(process.cwd(), 'src/ui/App.ts'), 'utf-8');
    const occurrences = app.match(/withCover\(/g) ?? [];
    expect(
      occurrences.length,
      'App.ts doit appeler withCover DEUX fois : la boucle d\'aperçu et la fabrique passée à l\'export',
    ).toBeGreaterThanOrEqual(2);

    const dialog = readFileSync(join(process.cwd(), 'src/ui/dialogs/ExportDialog.ts'), 'utf-8');
    expect(dialog, 'le dialogue d\'export doit transmettre la pochette').toContain('getCover()');

    const pipeline = readFileSync(join(process.cwd(), 'src/export/ExportPipeline.ts'), 'utf-8');
    expect(pipeline, 'le pipeline doit passer la pochette à scene.init').toMatch(/scene\.init\([^)]*cover/);
  });
});
