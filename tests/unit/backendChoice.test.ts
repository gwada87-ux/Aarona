import { describe, expect, it } from 'vitest';
import { chooseBackend, parseRendererOverride } from '../../src/render/backendChoice';

/**
 * La décision de bascule d'ADR-013 lot 3 — la seule partie testable en Node
 * (le reste demande un contexte réel, vérifié au navigateur). Ce test EST la
 * règle produit : WebGL2 par défaut, Canvas 2D en repli, jamais d'échec.
 */

describe('parseRendererOverride', () => {
  it('reconnaît les deux backends explicites', () => {
    expect(parseRendererOverride('webgl2')).toBe('webgl2');
    expect(parseRendererOverride('canvas2d')).toBe('canvas2d');
  });

  it('ignore toute autre valeur (= automatique)', () => {
    for (const value of [null, undefined, '', 'webgl', 'WEBGL2', 'gpu', 'true']) {
      expect(parseRendererOverride(value)).toBeUndefined();
    }
  });
});

describe('chooseBackend (ADR-013 lot 3)', () => {
  it('WebGL2 est le DÉFAUT quand il est disponible', () => {
    expect(chooseBackend(undefined, true)).toBe('webgl2');
  });

  it('Canvas 2D en repli quand WebGL2 est absent', () => {
    expect(chooseBackend(undefined, false)).toBe('canvas2d');
  });

  it('`?renderer=canvas2d` force le backend historique même si WebGL2 est là', () => {
    expect(chooseBackend('canvas2d', true)).toBe('canvas2d');
  });

  it('`?renderer=webgl2` ne peut PAS forcer un WebGL2 absent — le repli prime toujours', () => {
    // Une capacité absente ne doit jamais arrêter le rendu : forcer ici ne
    // donnerait pas une erreur utile, seulement un écran noir.
    expect(chooseBackend('webgl2', false)).toBe('canvas2d');
    expect(chooseBackend('webgl2', true)).toBe('webgl2');
  });

  it('ne retourne jamais autre chose que les deux backends connus', () => {
    for (const override of ['webgl2', 'canvas2d', undefined] as const) {
      for (const available of [true, false]) {
        expect(['webgl2', 'canvas2d']).toContain(chooseBackend(override, available));
      }
    }
  });
});
