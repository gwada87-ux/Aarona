/**
 * Chantier 4 (docs/17_PHASE2_VISUELS.md §7.2, §7.4, §7.9, §7.10).
 *
 * Quatre mécanismes, un fil conducteur : la GRAINE choisit une variante, la
 * variante décale le cadrage et pose des modes de fusion, et la zone sûre borne
 * ce qui a le droit de porter du sens. Le tout doit rester déterministe (Loi 1)
 * et identique entre l'aperçu et l'export.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STYLE_VARIANTS, variantFor } from '../../src/presets/styleVariants';
import { STYLE_IDS, type StyleId } from '../../src/presets/schema';
import { safeAreaFor, safeRect, NO_SAFE_AREA } from '../../src/render/safeArea';
import { applyLayerBlends } from '../../src/visual/scene/dramaFrame';
import { createFieldStyle } from '../../src/visual/styles/field/createFieldStyle';
import { createPulseStyle } from '../../src/visual/styles/pulse/createPulseStyle';
import { createSpectrumProStyle } from '../../src/visual/styles/spectrum-pro/createSpectrumProStyle';
import { createMonolithStyle } from '../../src/visual/styles/monolith/createMonolithStyle';
import { createIsoPulseStyle } from '../../src/visual/styles/iso-pulse/createIsoPulseStyle';
import { defaultPalette } from '../../src/visual/palette/Palette';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';

describe('variantes de cadrage (§7.10)', () => {
  it('chaque style expose 2 à 3 variantes', () => {
    for (const id of STYLE_IDS) {
      const list = STYLE_VARIANTS[id];
      expect(list.length, `${id}`).toBeGreaterThanOrEqual(2);
      expect(list.length, `${id}`).toBeLessThanOrEqual(3);
    }
  });

  it('au plus une variante sur trois est centrée, et chacune a un nom distinct', () => {
    // Règle de composition de §8 : un visuel dont tout le point d'intérêt est
    // au milieu du cadre est la signature la plus reconnaissable d'un rendu
    // automatique.
    for (const id of STYLE_IDS) {
      const list = STYLE_VARIANTS[id];
      const centrees = list.filter((v) => v.offsetX === 0 && v.offsetY === 0);
      expect(centrees.length, `${id} : ${centrees.length} variantes centrées sur ${list.length}`).toBeLessThanOrEqual(
        Math.ceil(list.length / 3),
      );
      expect(new Set(list.map((v) => v.name)).size, `${id} : noms en double`).toBe(list.length);
    }
  });

  it('chaque style a au moins une variante hors centre, près d\'un tiers', () => {
    for (const id of STYLE_IDS) {
      const horsCentre = STYLE_VARIANTS[id].filter((v) => Math.hypot(v.offsetX, v.offsetY) >= 0.1);
      expect(horsCentre.length, `${id} n'a aucune variante décentrée`).toBeGreaterThan(0);
    }
  });

  it('aucun zoom sous 1 : sous 1 le cadrage découvrirait les bords (ADR-011)', () => {
    for (const id of STYLE_IDS) {
      for (const v of STYLE_VARIANTS[id]) {
        expect(v.zoom, `${id}/${v.name}`).toBeGreaterThanOrEqual(1);
        expect(v.zoom, `${id}/${v.name}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('les modes de fusion ne visent que des couches EXISTANTES', () => {
    // Une faute de frappe dans un identifiant de couche ne produit aucune
    // erreur : le mode est simplement ignoré, en silence. C'est exactement le
    // genre de panne que ce chantier existe pour empêcher de revenir.
    // `Record<StyleId, …>` et non `Record<string, …>` : un style ajouté sans
    // entrée ici ferait échouer la COMPILATION, au lieu de passer le test avec
    // un `undefined` silencieux — ce qui est exactement ce qui vient d'arriver
    // en ajoutant `monolith` et `iso-pulse`.
    const couches: Readonly<Record<StyleId, readonly string[]>> = {
      pulse: createPulseStyle().layers.map((l) => l.id),
      field: createFieldStyle().layers.map((l) => l.id),
      'spectrum-pro': createSpectrumProStyle().layers.map((l) => l.id),
      monolith: createMonolithStyle().layers.map((l) => l.id),
      'iso-pulse': createIsoPulseStyle().layers.map((l) => l.id),
    };
    for (const id of STYLE_IDS) {
      for (const v of STYLE_VARIANTS[id]) {
        for (const cible of Object.keys(v.blend ?? {})) {
          expect(couches[id], `${id}/${v.name} vise une couche inconnue : ${cible}`).toContain(cible);
        }
      }
    }
  });
});

describe('graine et variante (§7.9)', () => {
  it('la même graine redonne toujours la même variante (Loi 1)', () => {
    for (const id of STYLE_IDS) {
      for (const seed of [0, 1, 42, 999983, 0xffffffff]) {
        expect(variantFor(id, seed), `${id}/${seed}`).toBe(variantFor(id, seed));
      }
    }
  });

  it('relancer la graine finit par changer de variante', () => {
    // Si ce test échoue, le bouton « Nouvelle variante » ne change que les
    // tirages internes des couches et laisse le cadrage identique — c'est-à-dire
    // l'essentiel de ce que l'utilisateur regarde.
    for (const id of STYLE_IDS) {
      const vues = new Set<string>();
      for (let seed = 0; seed < 200; seed++) vues.add(variantFor(id, seed).name);
      expect(vues.size, `${id} : une seule variante atteinte sur 200 graines`).toBe(STYLE_VARIANTS[id].length);
    }
  });
});

describe('modes de fusion par couche (§7.2)', () => {
  it('Scene.draw pose le mode avant la couche et le RETIRE après', () => {
    const scene = createPulseStyle();
    scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    applyLayerBlends(scene, { circularWaveform: 'screen' });

    const r = new FakeRenderer();
    scene.draw(r, testViewport);
    const poses = r.calls.filter((c) => c.type === 'setBlendMode');
    expect(poses.map((c) => (c as { mode: string | null }).mode)).toEqual(['screen', null]);
  });

  it('sans mode déclaré, AUCUN appel : le chemin par défaut est inchangé', () => {
    const scene = createFieldStyle();
    scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    applyLayerBlends(scene, undefined);

    const r = new FakeRenderer();
    scene.draw(r, testViewport);
    expect(r.calls.some((c) => c.type === 'setBlendMode')).toBe(false);
  });

  it('changer de variante EFFACE les modes de la précédente', () => {
    // Sans la remise à `undefined`, le style dériverait à chaque relance de
    // graine : les modes s'accumuleraient au lieu de se remplacer.
    const scene = createPulseStyle();
    scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
    applyLayerBlends(scene, { circularWaveform: 'screen' });
    applyLayerBlends(scene, { centralGlow: 'multiply' });

    const restants = scene.layers.filter((l) => l.blend !== undefined).map((l) => `${l.id}=${l.blend}`);
    expect(restants).toEqual(['centralGlow=multiply']);
  });
});

describe('zones sûres des formats sociaux (§7.4)', () => {
  it('les formats paysage et carré n\'ont aucune zone recouverte', () => {
    expect(safeAreaFor(1920, 1080)).toEqual(NO_SAFE_AREA);
    expect(safeAreaFor(1080, 1080)).toEqual(NO_SAFE_AREA);
  });

  it('le format vertical réserve le bas et la droite', () => {
    const safe = safeAreaFor(1080, 1920);
    expect(safe.bottom, 'légende et boutons').toBeGreaterThan(0.2);
    expect(safe.right, 'colonne d\'actions').toBeGreaterThan(0.1);
    expect(safe.left, 'rien à gauche').toBe(0);
  });

  it('le rectangle sûr reste à l\'intérieur du cadre, dans les deux orientations', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
    ] as const) {
      const aspect = w / h;
      const r = safeRect(aspect, safeAreaFor(w, h));
      const halfW = aspect >= 1 ? aspect / 2 : 0.5;
      const halfH = aspect >= 1 ? 0.5 : 1 / (2 * aspect);
      expect(r.left, `${w}x${h}`).toBeGreaterThanOrEqual(-halfW - 1e-9);
      expect(r.right, `${w}x${h}`).toBeLessThanOrEqual(halfW + 1e-9);
      expect(r.bottom, `${w}x${h}`).toBeGreaterThanOrEqual(-halfH - 1e-9);
      expect(r.top, `${w}x${h}`).toBeLessThanOrEqual(halfH + 1e-9);
      expect(r.right, 'rectangle non dégénéré').toBeGreaterThan(r.left);
      expect(r.top, 'rectangle non dégénéré').toBeGreaterThan(r.bottom);
    }
  });

  it('la cible d\'export renseigne réellement la zone sûre', () => {
    // `Viewport.safe` était déclaré et jamais rempli. Ce test lit le code plutôt
    // que d'instancier un OffscreenCanvas, indisponible sous Node.
    const code = readFileSync(join(process.cwd(), 'src/export/createOffscreenExportTarget.ts'), 'utf-8');
    expect(code, 'createViewport doit recevoir une zone sûre').toMatch(/createViewport\([^)]*safeAreaFor/);
  });
});
