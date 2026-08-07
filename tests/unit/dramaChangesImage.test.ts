/**
 * Critère 12 de docs/17_PHASE2_VISUELS.md §12 — chantier 3.
 *
 * « Sur un morceau complet, l'intro, la montée, le drop et le breakdown donnent
 * des images visiblement différentes. »
 *
 * `visualDirector.test.ts` vérifie le BUDGET ; celui-ci vérifie l'IMAGE. La
 * distinction n'est pas cosmétique : un budget parfaitement calculé qui
 * n'atteindrait pas les couches serait exactement le défaut diagnostiqué au
 * chantier 2 pour les six signaux jetés. On monte donc les trois styles réels
 * et on compare ce qu'ils dessinent.
 *
 * Vérifie aussi que l'export voit la même dramaturgie que la preview — les deux
 * boucles d'images sont distinctes, et l'Étape 25 a déjà montré qu'elles savent
 * diverger en silence.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BehaviourEngine } from '../../src/behaviour/BehaviourEngine';
import { VisualDirector } from '../../src/behaviour/VisualDirector';
import { defaultMapping } from '../../src/behaviour/mapping/defaults';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { StepContextBuilder } from '../../src/music/StepContext';
import { validatePmdi } from '../../src/music/validatePmdi';
import type { MusicEvent, PmdiDocument, Section } from '../../src/music/pmdi';
import { createFieldStyle } from '../../src/visual/styles/field/createFieldStyle';
import { createPulseStyle } from '../../src/visual/styles/pulse/createPulseStyle';
import { createSpectrumProStyle } from '../../src/visual/styles/spectrum-pro/createSpectrumProStyle';
import { defaultPalette } from '../../src/visual/palette/Palette';
import type { Scene } from '../../src/visual/scene/Scene';
import { openFrameWithCamera, stepSceneWithDrama } from '../../src/visual/scene/dramaFrame';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';

const BPM = 120;
const DURATION = 64;

const SECTIONS: readonly Section[] = [
  { t: 0, dur: 8, energy: 0.15, letter: 'I', confidence: 0.9 },
  { t: 8, dur: 16, energy: 0.7, letter: 'A', confidence: 0.9 },
  { t: 24, dur: 16, energy: 1.0, letter: 'B', confidence: 0.9 },
  { t: 40, dur: 8, energy: 0.1, letter: 'C', confidence: 0.9 },
  { t: 48, dur: 16, energy: 1.0, letter: 'B', confidence: 0.9 },
];

function doc(): PmdiDocument {
  const events: MusicEvent[] = [];
  for (let beat = 0; beat * 0.5 < DURATION; beat++) {
    const t = beat * 0.5;
    events.push({ t, type: 'KICK', intensity: 0.9, confidence: 0.95 });
    if (beat % 2 === 1) events.push({ t, type: 'SNARE', intensity: 0.8, confidence: 0.9 });
    events.push({ t, type: 'HAT', intensity: 0.5, confidence: 0.85 });
  }
  events.push({ t: 24, type: 'DROP', intensity: 1, confidence: 0.95 });
  events.sort((a, b) => a.t - b.t);
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: DURATION, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: BPM, confidence: 1, map: [{ t: 0, bpm: BPM }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    sections: SECTIONS.map((s) => ({ ...s })),
    events,
    features: [{ id: 'energy', hz: 5, t0: 0, data: Array.from({ length: DURATION * 5 }, () => 0.6) }],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}

function r(x: number): string {
  return x.toFixed(4);
}

/**
 * Simule le morceau depuis le début jusqu'à `untilT`, puis relève une empreinte
 * de l'image.
 *
 * On repart TOUJOURS de zéro : les couches à état (particules, feedback,
 * chapeaux de pics) doivent avoir vécu la même histoire pour que la comparaison
 * porte sur le moment et non sur le chemin.
 */
function imageAt(makeScene: () => Scene, untilT: number): string {
  const d = doc();
  const v = validatePmdi(d);
  if (!v.ok) throw new Error(v.errors.join('; '));
  const timeline = buildMusicTimeline(d);
  const builder = new StepContextBuilder(timeline, 1);
  const behaviour = new BehaviourEngine(timeline, defaultMapping);
  const director = new VisualDirector(timeline);
  const scene = makeScene();
  const renderer = new FakeRenderer();
  scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });

  const dt = 1 / 120;
  let start = 0;
  for (let t = 0; t <= untilT + 1e-9; t += dt) {
    stepSceneWithDrama(scene, behaviour, director, builder.build(t));
    start = renderer.calls.length;
    openFrameWithCamera(renderer, testViewport, defaultPalette.bg[1], director);
    scene.draw(renderer, testViewport);
  }

  const out: string[] = [];
  for (const call of renderer.calls.slice(start)) {
    switch (call.type) {
      case 'applyShake':
        out.push(`cam ${r(call.dx)} ${r(call.dy)}`);
        break;
      case 'strokeCircle':
        out.push(`sc ${r(call.radius)} ${r(call.lineWidth)} ${r(call.color.a)}`);
        break;
      case 'fillRadialGradient':
        out.push(`rg ${r(call.outerRadius)} ${r(call.inner.r)} ${r(call.inner.g)} ${r(call.inner.b)}`);
        break;
      case 'strokePath':
        out.push(`sp ${r(call.lineWidth)} ${r(call.ys[0] ?? 0)} ${r(call.ys[7] ?? 0)}`);
        break;
      case 'fillPath':
        out.push(`fp ${r(call.ys[0] ?? 0)} ${r(call.ys[2] ?? 0)}`);
        break;
      case 'drawSprite': {
        const t0 = call.transforms[0];
        out.push(`ds ${call.count} ${r(t0?.x ?? 0)} ${r(t0?.y ?? 0)} ${r(t0?.scale ?? 0)} ${r(t0?.alpha ?? 0)}`);
        break;
      }
      case 'drawFeedback':
        out.push(`fb ${r(call.scale)} ${r(call.alpha)}`);
        break;
      default:
        break;
    }
  }
  return out.join('|');
}

const STYLES: ReadonlyArray<[string, () => Scene]> = [
  ['pulse', createPulseStyle],
  ['field', createFieldStyle],
  ['spectrum-pro', createSpectrumProStyle],
];

/** Les quatre moments du livrable, plus un refrain pour servir de repère. */
const MOMENTS: ReadonlyArray<[string, number]> = [
  ['intro', 3],
  ['montée', 23.6],
  ['drop', 24.4],
  ['refrain', 33],
  ['breakdown', 44],
];

describe('critère 12 — les moments du morceau donnent des images distinctes', () => {
  for (const [style, make] of STYLES) {
    it(`${style} : les cinq moments sont tous différents`, () => {
      const vues = new Map<string, string>();
      for (const [nom, t] of MOMENTS) vues.set(nom, imageAt(make, t));
      const uniques = new Set(vues.values());
      const doublons = [...vues.keys()].filter(
        (a, i, all) => all.findIndex((b) => vues.get(b) === vues.get(a)) !== i,
      );
      expect(uniques.size, `moments identiques : ${doublons.join(', ') || '—'}`).toBe(MOMENTS.length);
    });
  }

  it('la même seconde donne toujours la même image (Loi 1)', () => {
    // Contrôle indispensable : sans lui, le test ci-dessus passerait même si
    // l'image variait au hasard d'une exécution à l'autre.
    for (const [style, make] of STYLES) {
      expect(imageAt(make, 33), style).toBe(imageAt(make, 33));
    }
  });
});

describe('un seul point d\'application pour la preview et pour l\'export', () => {
  it('les deux boucles passent par `dramaFrame`, aucune ne module les signaux elle-même', () => {
    // Le piège de l'Étape 25 : les macros de couche avaient été branchées dans
    // la preview et oubliées dans l'export, et personne ne l'a vu pendant
    // plusieurs étapes. Un morceau exporté sans dramaturgie serait plat de bout
    // en bout — invisible sur une vignette.
    for (const fichier of ['src/ui/App.ts', 'src/export/ExportPipeline.ts']) {
      const code = readFileSync(join(process.cwd(), fichier), 'utf-8');
      expect(code, `${fichier} doit avancer la scène par le point commun`).toContain('stepSceneWithDrama(');
      expect(code, `${fichier} doit ouvrir l'image par le point commun`).toContain('openFrameWithCamera(');
      // Un appel direct signifierait que cette boucle contourne le director.
      expect(code, `${fichier} appelle encore scene.update() directement`).not.toMatch(/scene\.update\(/);
    }
  });
});
