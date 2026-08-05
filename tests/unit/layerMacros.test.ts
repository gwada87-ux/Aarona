/**
 * Tests de `presets/layerMacros.ts::applyLayerMacrosToScene()` — Étape 34.
 * Fonction extraite à l'Étape 26 (point de vérité partagé preview/export
 * pour les 6 macros de couche), jamais testée directement jusqu'ici — seule
 * la CONSOMMATION en aval de `layer.params` était couverte (spectrumBars
 * .test.ts, pulseRings.test.ts, etc.), pas le ROUTAGE par préfixe
 * `<styleId>.<layerId>.<paramKey>` lui-même.
 *
 * `FakeLayer` minimal (pas `testSupport/`, spécifique à ce fichier) :
 * `applyLayerMacrosToScene` ne lit que `scene.layers` (`.id`) et écrit
 * `.params` — les autres méthodes du contrat `Layer` restent des no-op.
 */
import { describe, expect, it } from 'vitest';
import { applyLayerMacrosToScene, LAYER_MACRO_CURVES } from '../../src/presets/layerMacros';
import { Scene } from '../../src/visual/scene/Scene';
import type { Layer, LayerKind } from '../../src/visual/scene/Layer';
import { MACRO_NAMES } from '../../src/presets/schema';
import type { MacroName, PresetMacros, StyleId } from '../../src/presets/schema';

class FakeLayer implements Layer {
  readonly kind: LayerKind = 'geometry';
  readonly needsDrawPriming = false;
  params: Layer['params'] = {};
  constructor(readonly id: string) {}
  init(): void {}
  update(): void {}
  draw(): void {}
  reset(): void {}
  dispose(): void {}
}

function neutralMacros(overrides: Partial<PresetMacros> = {}): PresetMacros {
  const macros = {} as Record<MacroName, number>;
  for (const name of MACRO_NAMES) macros[name] = 0.5;
  return { ...macros, ...overrides } as PresetMacros;
}

function fieldScene(): { scene: Scene; particleField: FakeLayer; perspectiveGrid: FakeLayer } {
  const particleField = new FakeLayer('particleField');
  const perspectiveGrid = new FakeLayer('perspectiveGrid');
  return { scene: new Scene([particleField, perspectiveGrid]), particleField, perspectiveGrid };
}

describe('applyLayerMacrosToScene — routage par préfixe', () => {
  it("assigne à chaque couche UNIQUEMENT les clés sous son propre préfixe <styleId>.<layerId>.", () => {
    const { scene, particleField, perspectiveGrid } = fieldScene();
    applyLayerMacrosToScene(scene, neutralMacros(), 'field');

    expect(particleField.params).toHaveProperty('spawnCountMul');
    expect(particleField.params).toHaveProperty('driftSpeed');
    expect(particleField.params).not.toHaveProperty('rows'); // appartient à perspectiveGrid, pas particleField

    expect(perspectiveGrid.params).toHaveProperty('rows');
    expect(perspectiveGrid.params).toHaveProperty('perspective');
    expect(perspectiveGrid.params).not.toHaveProperty('spawnCountMul');
  });

  it("le préfixe est retiré de la clé assignée (pas 'field.particleField.spawnCountMul' littéral)", () => {
    const { scene, particleField } = fieldScene();
    applyLayerMacrosToScene(scene, neutralMacros(), 'field');
    expect(Object.keys(particleField.params)).not.toContain('field.particleField.spawnCountMul');
    expect(particleField.params.spawnCountMul).toBeTypeOf('number');
  });

  it("une couche dont l'id ne correspond à AUCUNE entrée de la table reçoit params = {} (pas undefined, pas les anciennes valeurs)", () => {
    const unknownLayer = new FakeLayer('coucheInconnue');
    unknownLayer.params = { ancienneValeur: 42 }; // état résiduel d'un appel précédent
    const scene = new Scene([unknownLayer]);

    applyLayerMacrosToScene(scene, neutralMacros(), 'field');

    expect(unknownLayer.params).toEqual({});
  });

  it("un même styleId.layerId reçoit les clés de PLUSIEURS macros différentes (spectrumBars : density + movement + smoothness)", () => {
    const spectrumBars = new FakeLayer('spectrumBars');
    const scene = new Scene([spectrumBars]);

    applyLayerMacrosToScene(scene, neutralMacros(), 'spectrum-pro');

    expect(spectrumBars.params).toHaveProperty('gap'); // density
    expect(spectrumBars.params).toHaveProperty('riseTau'); // movement
    expect(spectrumBars.params).toHaveProperty('fallTau'); // smoothness
  });

  it("un layerId identique sous un AUTRE styleId n'est pas contaminé (isolation par style)", () => {
    // 'pulseRings' n'existe que sous 'pulse.' dans LAYER_MACRO_CURVES — sous 'field.', aucune entrée ne doit matcher.
    const pulseRingsUnderField = new FakeLayer('pulseRings');
    const scene = new Scene([pulseRingsUnderField]);

    applyLayerMacrosToScene(scene, neutralMacros(), 'field');

    expect(pulseRingsUnderField.params).toEqual({});
  });

  it("style 'pulse' : depth (Profondeur) n'a AUCUNE entrée déclarée pour pulse (absence volontaire, docs) — aucune couche n'obtient de paramètre de profondeur", () => {
    const centralGlow = new FakeLayer('centralGlow');
    const scene = new Scene([centralGlow]);
    applyLayerMacrosToScene(scene, neutralMacros({ depth: 1 }), 'pulse');

    // centralGlow reçoit bien glow.*, mais rien qui proviendrait d'une entrée depth.* pulse (il n'y en a aucune).
    const depthPaths = Object.keys(LAYER_MACRO_CURVES.depth ?? {}).filter((p) => p.startsWith('pulse.'));
    expect(depthPaths).toEqual([]);
  });
});

describe('applyLayerMacrosToScene — valeurs aux extrêmes (at0/at1)', () => {
  it('macro à 0 : chemin réel field.particleField.spawnCountMul vaut at0 (0,4)', () => {
    const { scene, particleField } = fieldScene();
    applyLayerMacrosToScene(scene, neutralMacros({ density: 0 }), 'field');
    expect(particleField.params.spawnCountMul).toBeCloseTo(0.4, 10);
  });

  it('macro à 1 : chemin réel field.particleField.spawnCountMul vaut at1 (1,4)', () => {
    const { scene, particleField } = fieldScene();
    applyLayerMacrosToScene(scene, neutralMacros({ density: 1 }), 'field');
    expect(particleField.params.spawnCountMul).toBeCloseTo(1.4, 10);
  });

  it("chemin réel pulse.pulseRings.maxActiveRings : at0=2 à density=0, at1=8 à density=1", () => {
    const pulseRings = new FakeLayer('pulseRings');
    const scene = new Scene([pulseRings]);

    applyLayerMacrosToScene(scene, neutralMacros({ density: 0 }), 'pulse');
    expect(pulseRings.params.maxActiveRings).toBeCloseTo(2, 10);

    applyLayerMacrosToScene(scene, neutralMacros({ density: 1 }), 'pulse');
    expect(pulseRings.params.maxActiveRings).toBeCloseTo(8, 10);
  });
});

describe('applyLayerMacrosToScene — remplace ENTIÈREMENT params à chaque appel', () => {
  it('deux appels successifs avec des macros différentes : la seconde valeur remplace la première, pas de fusion', () => {
    const { scene, particleField } = fieldScene();

    applyLayerMacrosToScene(scene, neutralMacros({ density: 0 }), 'field');
    const first = particleField.params.spawnCountMul;

    applyLayerMacrosToScene(scene, neutralMacros({ density: 1 }), 'field');
    const second = particleField.params.spawnCountMul;

    expect(first).not.toBe(second);
    expect(second).toBeCloseTo(1.4, 10);
  });

  it("scene.layers vide : ne lève pas, ne fait rien", () => {
    const scene = new Scene([]);
    expect(() => applyLayerMacrosToScene(scene, neutralMacros(), 'field')).not.toThrow();
  });
});
