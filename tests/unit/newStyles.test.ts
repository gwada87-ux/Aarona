/**
 * `monolith` et `iso-pulse` — chantier 5 (docs/17_PHASE2_VISUELS.md §8).
 *
 * Livrable annoncé : « 60 s par style sans erreur console ni croissance
 * mémoire, `Scene.draw` et `Scene.update` mesurés et collés ». Ce fichier
 * couvre la partie automatisable — 60 s de simulation à pas fixe, invariants de
 * §8, et un relevé de temps consigné dans le journal. Ce qu'il ne couvre pas :
 * l'aspect réel des pixels, qui reste à juger à l'œil.
 */

import { describe, expect, it } from 'vitest';
import { BehaviourEngine } from '../../src/behaviour/BehaviourEngine';
import { VisualDirector } from '../../src/behaviour/VisualDirector';
import { defaultMapping } from '../../src/behaviour/mapping/defaults';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { StepContextBuilder } from '../../src/music/StepContext';
import { validatePmdi } from '../../src/music/validatePmdi';
import type { MusicEvent, PmdiDocument } from '../../src/music/pmdi';
import { createIsoPulseStyle } from '../../src/visual/styles/iso-pulse/createIsoPulseStyle';
import { createChambreStyle } from '../../src/visual/styles/chambre/createChambreStyle';
import { createEclatsStyle } from '../../src/visual/styles/eclats/createEclatsStyle';
import { createAuroreStyle } from '../../src/visual/styles/aurore/createAuroreStyle';
import { createMonolithStyle } from '../../src/visual/styles/monolith/createMonolithStyle';
import { defaultPalette } from '../../src/visual/palette/Palette';
import type { Scene } from '../../src/visual/scene/Scene';
import { stepSceneWithDrama } from '../../src/visual/scene/dramaFrame';
import { createViewport } from '../../src/render/Viewport';
import { safeAreaFor } from '../../src/render/safeArea';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';

const DURATION = 60;

function doc(): PmdiDocument {
  const events: MusicEvent[] = [];
  for (let beat = 0; beat * 0.5 < DURATION; beat++) {
    const t = beat * 0.5;
    events.push({ t, type: 'KICK', intensity: 0.9, confidence: 0.95 });
    if (beat % 2 === 1) events.push({ t, type: 'SNARE', intensity: 0.8, confidence: 0.9 });
    events.push({ t, type: 'HAT', intensity: 0.5, confidence: 0.85 });
    events.push({ t: t + 0.25, type: 'HAT', intensity: 0.45, confidence: 0.85 });
  }
  events.push({ t: 32, type: 'DROP', intensity: 1, confidence: 0.95 });
  events.sort((a, b) => a.t - b.t);
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: DURATION, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    sections: [
      { t: 0, dur: 16, energy: 0.3, letter: 'A', confidence: 0.9 },
      { t: 16, dur: 16, energy: 0.8, letter: 'B', confidence: 0.9 },
      { t: 32, dur: 28, energy: 1, letter: 'C', confidence: 0.9 },
    ],
    events,
    features: [{ id: 'energy', hz: 5, t0: 0, data: Array.from({ length: DURATION * 5 }, (_, i) => 0.3 + 0.5 * ((i % 10) / 10)) }],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}

const STYLES: ReadonlyArray<[string, () => Scene]> = [
  ['monolith', createMonolithStyle],
  ['iso-pulse', createIsoPulseStyle],
  ['chambre', createChambreStyle],
  ['eclats', createEclatsStyle],
  ['aurore', createAuroreStyle],
];

interface RunResult {
  readonly updateMs: number;
  readonly drawMs: number;
  readonly frames: number;
  readonly calls: number;
}

/** 60 s de simulation à pas fixe, rendues à 60 images par seconde. */
function run(makeScene: () => Scene, viewportAspect = 16 / 9, safeW = 1920, safeH = 1080): RunResult {
  const d = doc();
  const v = validatePmdi(d);
  if (!v.ok) throw new Error(v.errors.join('; '));
  const timeline = buildMusicTimeline(d);
  const builder = new StepContextBuilder(timeline, 7);
  const behaviour = new BehaviourEngine(timeline, defaultMapping);
  const director = new VisualDirector(timeline);
  const scene = makeScene();
  const renderer = new FakeRenderer();
  scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
  const viewport = createViewport(viewportAspect, safeAreaFor(safeW, safeH));

  const dt = 1 / 120;
  const total = Math.round(DURATION / dt);
  let updateMs = 0;
  let drawMs = 0;
  let frames = 0;

  for (let s = 0; s < total; s++) {
    const t0 = performance.now();
    stepSceneWithDrama(scene, behaviour, director, builder.build(s * dt));
    updateMs += performance.now() - t0;
    // Une image sur deux : 120 pas de simulation, 60 images par seconde.
    if (s % 2 !== 0) continue;
    const t1 = performance.now();
    scene.draw(renderer, viewport);
    drawMs += performance.now() - t1;
    frames++;
  }
  return { updateMs, drawMs, frames, calls: renderer.calls.length };
}

describe('nouveaux styles — 60 s de simulation (§9.5)', () => {
  for (const [name, make] of STYLES) {
    it(`${name} : 60 s sans exception, et il dessine réellement`, () => {
      const r = run(make);
      expect(r.frames, 'images rendues').toBe(3600);
      // Un style qui n'émettrait aucun appel passerait le test « sans
      // exception » sans rien montrer. Le seuil est bas à dessein : il vérifie
      // que ça dessine, pas combien.
      expect(r.calls, `${name} n'a émis que ${r.calls} appels de rendu`).toBeGreaterThan(3600);
      // eslint-disable-next-line no-console -- relevé consigné dans docs/JOURNAL.md
      console.log(
        `MESURE ${name.padEnd(10)} update ${(r.updateMs / 7200).toFixed(4)} ms/pas · ` +
          `draw ${(r.drawMs / r.frames).toFixed(4)} ms/image · ${r.calls} appels`,
      );
    });
  }

  it('les deux styles tiennent dans les trois formats, sans code conditionnel (Loi 4)', () => {
    // 16:9, 9:16 et 1:1. Un style qui suppose le paysage produit en portrait
    // des coordonnées hors cadre, ou pire, un `NaN` qui se propage en silence.
    for (const [name, make] of STYLES) {
      for (const [aspect, w, h] of [
        [16 / 9, 1920, 1080],
        [9 / 16, 1080, 1920],
        [1, 1080, 1080],
      ] as const) {
        const scene = make();
        const renderer = new FakeRenderer();
        scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
        const timeline = buildMusicTimeline(doc());
        const builder = new StepContextBuilder(timeline, 3);
        const behaviour = new BehaviourEngine(timeline, defaultMapping);
        const director = new VisualDirector(timeline);
        const viewport = createViewport(aspect, safeAreaFor(w, h));
        for (let s = 0; s < 400; s++) stepSceneWithDrama(scene, behaviour, director, builder.build(s / 120));
        scene.draw(renderer, viewport);

        for (const call of renderer.calls) {
          for (const [k, val] of Object.entries(call)) {
            if (typeof val === 'number') {
              expect(Number.isFinite(val), `${name} ${aspect}: ${call.type}.${k} = ${val}`).toBe(true);
            }
          }
        }
      }
    }
  });
});

describe('nouveaux styles — invariants de §8', () => {
  it('restent regardables SANS AUCUN onset (Loi 3)', () => {
    // « Un morceau non analysable doit rester beau. » Un style qui ne dessine
    // rien sans frappes est inutilisable en régime continu, c'est-à-dire
    // précisément sur les morceaux que l'analyse comprend mal.
    const muet: PmdiDocument = { ...doc(), events: [] };
    const v = validatePmdi(muet);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const timeline = buildMusicTimeline(muet);

    for (const [name, make] of STYLES) {
      const builder = new StepContextBuilder(timeline, 5);
      const behaviour = new BehaviourEngine(timeline, defaultMapping);
      const director = new VisualDirector(timeline);
      const scene = make();
      const renderer = new FakeRenderer();
      scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
      for (let s = 0; s < 600; s++) stepSceneWithDrama(scene, behaviour, director, builder.build(s / 120));
      scene.draw(renderer, testViewport);
      // Seuil à 2, et pas plus : `chambre` n'émet légitimement que trois
      // primitives — le fond, le faisceau et le lot de poussières. Un seuil
      // arbitrairement haut punirait un style volontairement dépouillé au lieu
      // de détecter un style muet, qui est ce qu'on cherche.
      const dessins = renderer.calls.filter((c) => c.type !== 'captureFeedback' && c.type !== 'setBlendMode');
      expect(dessins.length, `${name} ne dessine rien sans onset`).toBeGreaterThanOrEqual(2);
    }
  });

  it('la même graine redonne la même image (Loi 1)', () => {
    const empreinte = (make: () => Scene): string => {
      const timeline = buildMusicTimeline(doc());
      const builder = new StepContextBuilder(timeline, 11);
      const behaviour = new BehaviourEngine(timeline, defaultMapping);
      const director = new VisualDirector(timeline);
      const scene = make();
      const renderer = new FakeRenderer();
      scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });
      for (let s = 0; s < 1200; s++) stepSceneWithDrama(scene, behaviour, director, builder.build(s / 120));
      scene.draw(renderer, testViewport);
      return renderer.calls
        .map((c) => Object.values(c).filter((x) => typeof x === 'number').map((x) => (x as number).toFixed(5)).join(','))
        .join('|');
    };
    for (const [name, make] of STYLES) {
      expect(empreinte(make), name).toBe(empreinte(make));
    }
  });
});
