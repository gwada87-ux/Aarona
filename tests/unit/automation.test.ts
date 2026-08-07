/**
 * Automatisation par images-clés (docs/17_PHASE2_VISUELS.md §7.3, chantier 10
 * lot D).
 *
 * §7.3 : « `render(t)` est déjà une fonction pure de `t` (Loi 1). Une courbe
 * d'automatisation EST littéralement `f(t)`. » Ces tests vérifient d'abord
 * cela : mêmes entrées, même sortie, sans le moindre état de lecture.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_POINTS_PER_LANE,
  addPoint,
  automationValue,
  clearLane,
  hasLane,
  normaliseAutomation,
  removePointNear,
  valueAt,
  type AutomationLane,
} from '../../src/core/automation/Automation';
import { NEUTRAL_AUTOMATION } from '../../src/visual/scene/dramaFrame';

const lane = (points: readonly { t: number; value: number }[]): AutomationLane => ({ target: 'intensity', points });

describe('valueAt — interpolation linéaire', () => {
  it('interpole entre deux points', () => {
    const l = lane([{ t: 0, value: 0 }, { t: 10, value: 1 }]);
    expect(valueAt(l, 0)).toBe(0);
    expect(valueAt(l, 5)).toBeCloseTo(0.5, 6);
    expect(valueAt(l, 10)).toBe(1);
  });

  it('TIENT aux extrémités, sans extrapoler', () => {
    // Extrapoler la pente donnerait des valeurs hors bornes en fin de morceau,
    // sur une automatisation dont l'utilisateur n'a rien demande au-dela.
    const l = lane([{ t: 4, value: 0.25 }, { t: 8, value: 0.75 }]);
    expect(valueAt(l, 0)).toBe(0.25);
    expect(valueAt(l, -100)).toBe(0.25);
    expect(valueAt(l, 999)).toBe(0.75);
  });

  it('un seul point donne une constante', () => {
    const l = lane([{ t: 5, value: 0.42 }]);
    expect(valueAt(l, 0)).toBe(0.42);
    expect(valueAt(l, 5)).toBe(0.42);
    expect(valueAt(l, 60)).toBe(0.42);
  });

  it('une piste vide rend `null`, pas zéro', () => {
    // Zero serait une VALEUR : une piste sans point ne doit rien imposer, elle
    // doit laisser le repli de l'appelant s'appliquer.
    expect(valueAt(lane([]), 3)).toBeNull();
    expect(automationValue([], 'intensity', 3, 0.8)).toBe(0.8);
  });

  it('deux points au même instant font une MARCHE', () => {
    // Le seul comportement qui ne divise pas par zero, et il est utile : « ici,
    // coupe tout » de SS7.3 est exactement une marche.
    const l = lane([{ t: 0, value: 1 }, { t: 5, value: 1 }, { t: 5, value: 0 }, { t: 9, value: 0 }]);
    expect(valueAt(l, 4.99)).toBeCloseTo(1, 3);
    expect(valueAt(l, 5)).toBe(0);
    expect(valueAt(l, 7)).toBe(0);
  });

  it('la dichotomie donne le même résultat qu\'un parcours naïf', () => {
    const points = Array.from({ length: 50 }, (_, i) => ({ t: i * 1.7, value: (i % 7) / 6 }));
    const l = lane(points);
    const naif = (t: number): number => {
      if (t <= points[0]!.t) return points[0]!.value;
      const last = points[points.length - 1]!;
      if (t >= last.t) return last.value;
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        if (t >= a.t && t <= b.t) return a.value + (b.value - a.value) * ((t - a.t) / (b.t - a.t));
      }
      return last.value;
    };
    for (let t = -3; t < 90; t += 0.37) expect(valueAt(l, t)).toBeCloseTo(naif(t), 9);
  });

  it('est une fonction PURE du temps (Loi 1)', () => {
    const l = lane([{ t: 0, value: 0 }, { t: 10, value: 1 }]);
    // Meme t, meme valeur, quel que soit l'ordre des appels : aucune position
    // courante, rien a reinitialiser sur un seek.
    const avant = valueAt(l, 3.3);
    valueAt(l, 9);
    valueAt(l, 0.1);
    expect(valueAt(l, 3.3)).toBe(avant);
  });
});

describe('édition des points', () => {
  it('ajoute, trie et crée la piste au besoin', () => {
    let a = addPoint([], 'intensity', { t: 8, value: 0.5 });
    a = addPoint(a, 'intensity', { t: 2, value: 0.1 });
    expect(a[0]!.points.map((p) => p.t)).toEqual([2, 8]);
  });

  it('REMPLACE un point trop proche au lieu d\'en empiler un second', () => {
    // Sans ca, cliquer deux fois au meme endroit poserait deux points a des
    // instants presque identiques, et la courbe y ferait une marche non voulue.
    let a = addPoint([], 'intensity', { t: 5, value: 0.2 });
    a = addPoint(a, 'intensity', { t: 5.05, value: 0.9 });
    expect(a[0]!.points.length).toBe(1);
    expect(a[0]!.points[0]!.value).toBe(0.9);
  });

  it('retire un point, et RETIRE la piste devenue vide', () => {
    // Une piste sans point ne fait rien, et la laisser ferait croire a
    // l'interface qu'une cible est automatisee.
    const a = addPoint([], 'intensity', { t: 5, value: 0.2 });
    expect(removePointNear(a, 'intensity', 5.02)).toEqual([]);
    expect(removePointNear(a, 'intensity', 40), 'un clic loin de tout ne doit rien retirer').toBe(a);
  });

  it('plafonne le nombre de points', () => {
    let a: ReturnType<typeof addPoint> = [];
    for (let i = 0; i < MAX_POINTS_PER_LANE + 10; i++) a = addPoint(a, 'intensity', { t: i, value: 0.5 });
    expect(a[0]!.points.length).toBe(MAX_POINTS_PER_LANE);
  });

  it('`clearLane` et `hasLane`', () => {
    const a = addPoint([], 'macro:glow', { t: 1, value: 0.5 });
    expect(hasLane(a, 'macro:glow')).toBe(true);
    expect(hasLane(a, 'intensity')).toBe(false);
    expect(clearLane(a, 'macro:glow')).toEqual([]);
  });
});

describe('normaliseAutomation — un projet abîmé ne fait pas échouer l\'ouverture', () => {
  it('TRIE les points, ce dont dépend la dichotomie', () => {
    const a = normaliseAutomation([{ target: 'intensity', points: [{ t: 9, value: 1 }, { t: 2, value: 0 }] }]);
    expect(a[0]!.points.map((p) => p.t)).toEqual([2, 9]);
  });

  it('écarte ce qui n\'a pas de forme, garde le reste', () => {
    const a = normaliseAutomation([
      { target: 'intensity', points: [{ t: 1, value: 0.5 }, { t: NaN, value: 1 }, { t: 2 }] },
      { target: '', points: [{ t: 1, value: 1 }] },
      { target: 'vide', points: [] },
      { points: [{ t: 1, value: 1 }] },
      null,
      'texte',
    ]);
    expect(a.length).toBe(1);
    expect(a[0]!.points).toEqual([{ t: 1, value: 0.5 }]);
  });

  it('rend un tableau vide sur n\'importe quoi', () => {
    expect(normaliseAutomation(undefined)).toEqual([]);
    expect(normaliseAutomation({ target: 'x' })).toEqual([]);
  });
});

describe('l\'absence d\'automatisation est un NO-OP exact', () => {
  it('les valeurs neutres sont 1 et 0', () => {
    // C'est ce qui garantit qu'un projet sans image-cle rend exactement la meme
    // image qu'avant ce lot, ligne pour ligne.
    expect(NEUTRAL_AUTOMATION).toEqual({ intensity: 1, cameraX: 0, cameraY: 0, cameraZoom: 1 });
  });
});

describe('l\'automatisation atteint l\'APERÇU et l\'EXPORT', () => {
  const app = readFileSync(join(process.cwd(), 'src/ui/App.ts'), 'utf-8');
  const pipeline = readFileSync(join(process.cwd(), 'src/export/ExportPipeline.ts'), 'utf-8');

  it('les deux boucles évaluent les courbes', () => {
    // Sans la ligne cote export, la video ignorerait toutes les images-cles :
    // meme piege de l'Etape 25 que pour la pochette, le texte et les couches.
    expect(app).toContain('stepSceneWithDrama(scene, behaviourEngine, visualDirector, step, automationAt(simT))');
    expect(pipeline).toContain('stepSceneWithDrama(scene, behaviourEngine, director, stepper.build(simT), evaluate(simT))');
    expect(app).toContain('framingFor(scene, currentVariant), automationAt(simT)');
    expect(pipeline).toContain('director, framing, evaluate(targetT)');
    expect(readFileSync(join(process.cwd(), 'src/ui/dialogs/ExportDialog.ts'), 'utf-8')).toContain('getAutomation()');
  });

  it('les macros automatisées sont revues par IMAGE, pas par sous-pas', () => {
    // Elles remplacent `layer.params` en entier, donc allouent un objet par
    // couche : les recalculer a 120 Hz serait exactement ce que docs/10
    // proscrit.
    expect(app).toContain('if (steps > 0) refreshAutomatedMacros(simT);');
    expect(app).toContain('MACRO_EPSILON');
    expect(pipeline).toContain('if (automatedMacroNames.length > 0)');
  });

  it('les courbes sont enregistrées dans le projet', () => {
    expect(app).toContain('automation: automation as unknown as readonly Record<string, unknown>[]');
    expect(app).toContain('automation = normaliseAutomation(project.visual.automation)');
  });
});
