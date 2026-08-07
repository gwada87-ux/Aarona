import { describe, expect, it } from 'vitest';
import { ANTICIPATION_CURVES, Anticipation, type AnticipationCurve } from '../../src/behaviour/signals/Anticipation';
import { PRESET_CATALOG } from '../../src/presets/index';
import { validatePreset } from '../../src/presets/schema';
import type { MusicTimeline } from '../../src/music/MusicTimeline';

/**
 * Défaut signalé par Aaron : « quand je clique sur un preset du visualizer,
 * l'image ne change pas ».
 *
 * Mesuré au navigateur, onze presets un par un : quatre — `lofi`, `rnb`,
 * `afro`, `ambient` — levaient `TypeError: CURVES[this.curve] is not a
 * function` et leur écart d'image valait EXACTEMENT 0. Les sept autres
 * changeaient normalement (0,054 à 0,225).
 *
 * Pourquoi rien ne l'avait vu : les noms de courbes vivaient dans un type
 * TypeScript, effacé à la compilation, tandis que les presets sont du JSON lu
 * à l'exécution et introduit dans le typage par un `as`. Les deux ne pouvaient
 * pas se rencontrer. Ces tests les font se rencontrer.
 */

/** Timeline minimale : seul `timeToNext` est lu par `Anticipation`. */
function timelineAvecProchain(dans: number): MusicTimeline {
  return { timeToNext: () => dans } as unknown as MusicTimeline;
}

describe('courbes d\'anticipation — le catalogue RÉEL contre le moteur RÉEL', () => {
  it('chaque courbe déclarée par un preset existe dans le moteur', () => {
    // LE test qui manquait. Il échoue sur les quatre presets d'avant le
    // correctif, et c'est tout ce qu'il avait à faire.
    for (const preset of PRESET_CATALOG) {
      for (const [signal, entree] of Object.entries(preset.mapping ?? {})) {
        const curve = (entree as { curve?: string }).curve;
        if (curve === undefined) continue;
        expect(ANTICIPATION_CURVES, `${preset.id}.mapping.${signal}.curve = "${curve}"`).toContain(curve);
      }
    }
  });

  it('chaque preset du catalogue passe la validation', () => {
    for (const preset of PRESET_CATALOG) {
      const r = validatePreset(preset);
      expect(r.ok, `${preset.id} : ${r.ok ? '' : r.errors.join(' / ')}`).toBe(true);
    }
  });

  it('les quatre presets autrefois cassés sont bien dans le catalogue', () => {
    // Sans ça, le test précédent passerait tout aussi bien si quelqu'un les
    // retirait du catalogue — ce qui serait une régression déguisée en succès.
    for (const id of ['lofi', 'rnb', 'afro', 'ambient']) {
      expect(PRESET_CATALOG.map((p) => p.id)).toContain(id);
    }
  });
});

describe('Anticipation — chaque courbe nommée est calculable', () => {
  it('les trois courbes rendent une valeur finie dans [0,1]', () => {
    for (const courbe of ANTICIPATION_CURVES) {
      for (const dans of [0, 0.5, 1, 1.5, 2]) {
        const v = new Anticipation(2, courbe).valueFrom(timelineAvecProchain(dans), 'DROP', 0);
        expect(Number.isFinite(v), `${courbe} à ${dans} s`).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('les trois courbes montent quand l\'événement approche', () => {
    for (const courbe of ANTICIPATION_CURVES) {
      const a = new Anticipation(2, courbe);
      const loin = a.valueFrom(timelineAvecProchain(1.8), 'DROP', 0);
      const proche = a.valueFrom(timelineAvecProchain(0.2), 'DROP', 0);
      expect(proche, `${courbe} doit monter`).toBeGreaterThan(loin);
    }
  });

  it('une courbe INCONNUE se replie sur linear au lieu de tuer le rendu', () => {
    // Le durcissement : une donnée fausse ne doit pas arrêter la boucle. C'est
    // ce comportement-là qui manquait le plus — l'utilisateur n'a pas vu une
    // erreur, il a vu une image figée, sans le moindre indice.
    const inconnue = new Anticipation(2, 'easeOutBounce' as AnticipationCurve);
    const lineaire = new Anticipation(2, 'linear');
    expect(() => inconnue.valueFrom(timelineAvecProchain(1), 'DROP', 0)).not.toThrow();
    expect(inconnue.valueFrom(timelineAvecProchain(1), 'DROP', 0))
      .toBe(lineaire.valueFrom(timelineAvecProchain(1), 'DROP', 0));
  });
});

describe('validatePreset — le nom de courbe est refusé à l\'entrée', () => {
  const base = () => JSON.parse(JSON.stringify(PRESET_CATALOG[0]!));

  it('rejette une courbe qui n\'existe pas, en la nommant', () => {
    const p = base();
    p.mapping.tension = { from: 'anticipate:DROP', window: 3, curve: 'easeOutBounce' };
    const r = validatePreset(p);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('mapping.tension.curve');
  });

  it('accepte les trois courbes du moteur', () => {
    for (const courbe of ANTICIPATION_CURVES) {
      const p = base();
      p.mapping.tension = { from: 'anticipate:DROP', window: 3, curve: courbe };
      expect(validatePreset(p).ok, `${courbe} refusée à tort`).toBe(true);
    }
  });

  it('laisse passer une entrée sans `curve` — le champ est optionnel', () => {
    const p = base();
    p.mapping.tension = { from: 'anticipate:DROP', window: 3 };
    expect(validatePreset(p).ok).toBe(true);
  });
});
