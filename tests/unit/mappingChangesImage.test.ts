/**
 * Critère 11 de docs/17_PHASE2_VISUELS.md §12 — chantier 2.
 *
 * « Changer le `mapping` d'un preset change visiblement l'image. »
 *
 * C'est LE critère qui répond à la plainte d'origine d'Aaron : « les presets
 * sont inutilisables, ça ne change rien ». Il devait être atteint dès le
 * chantier 2, avant l'écriture du moindre style nouveau — livrer cinq styles
 * par-dessus un moteur qui jette la moitié de ses signaux aurait été bâtir sur
 * du sable.
 *
 * Ce que le test fait : monte les trois styles réels, les pilote sur une
 * séquence d'événements identique avec deux tables de câblage différentes, et
 * compare les appels de rendu enregistrés. Aucun canvas, aucun navigateur —
 * `Renderer` est une interface, `FakeRenderer` enregistre au lieu de dessiner.
 */

import { describe, expect, it } from 'vitest';
import { BehaviourEngine } from '../../src/behaviour/BehaviourEngine';
import { defaultMapping } from '../../src/behaviour/mapping/defaults';
import type { MappingSchema } from '../../src/behaviour/mapping/MappingSchema';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { StepContextBuilder } from '../../src/music/StepContext';
import { validatePmdi } from '../../src/music/validatePmdi';
import type { MusicEvent, PmdiDocument } from '../../src/music/pmdi';
import { createFieldStyle } from '../../src/visual/styles/field/createFieldStyle';
import { createPulseStyle } from '../../src/visual/styles/pulse/createPulseStyle';
import { createSpectrumProStyle } from '../../src/visual/styles/spectrum-pro/createSpectrumProStyle';
import { defaultPalette } from '../../src/visual/palette/Palette';
import type { Scene } from '../../src/visual/scene/Scene';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';

const DURATION = 8;
const STEP = 1 / 120;

/** Batterie dense : kick à la noire, caisse claire sur 2 et 4, charley à la croche. */
function document(): PmdiDocument {
  const events: MusicEvent[] = [];
  for (let beat = 0; beat * 0.5 < DURATION; beat++) {
    const t = beat * 0.5;
    events.push({ t, type: 'KICK', intensity: 0.9, confidence: 0.95 });
    if (beat % 2 === 1) events.push({ t, type: 'SNARE', intensity: 0.8, confidence: 0.9 });
    events.push({ t, type: 'HAT', intensity: 0.5, confidence: 0.85 });
    events.push({ t: t + 0.25, type: 'HAT', intensity: 0.45, confidence: 0.85 });
  }
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: DURATION, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events,
    features: [{ id: 'energy', hz: 5, t0: 0, data: Array.from({ length: DURATION * 5 }, (_, i) => 0.3 + 0.4 * ((i % 8) / 8)) }],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}

/**
 * Rend `frames` images et retourne une empreinte des appels de rendu.
 *
 * L'empreinte inclut la GÉOMÉTRIE (rayons, épaisseurs, alphas, positions), pas
 * seulement le nombre d'appels : deux mappings peuvent produire autant de
 * traits et une image totalement différente.
 */
function fingerprint(makeScene: () => Scene, mapping: MappingSchema, frames = 240): string {
  const doc = document();
  const validated = validatePmdi(doc);
  if (!validated.ok) throw new Error(validated.errors.join('; '));
  const timeline = buildMusicTimeline(doc);
  const builder = new StepContextBuilder(timeline, 1);
  const behaviour = new BehaviourEngine(timeline, mapping);
  const scene = makeScene();
  const renderer = new FakeRenderer();
  scene.init({ renderer: new FakeRenderer(), palette: defaultPalette });

  const out: string[] = [];
  // UN SEUL renderer pour toute la séquence, et on dessine CHAQUE image.
  //
  // Deux raisons, la seconde m'a coûté un faux diagnostic. D'abord le feedback
  // s'accumule d'une image à l'autre, comme en vrai. Ensuite et surtout,
  // `FakeRenderer.drawFeedback` est volontairement inerte tant qu'aucune
  // `captureFeedback` n'a eu lieu — fidèle à `Canvas2DRenderer`. Un renderer
  // neuf par image ne capturait donc JAMAIS le feedback, et l'empreinte du
  // style `field` semblait insensible au kick alors qu'elle ne l'était pas.
  for (let f = 0; f < frames; f++) {
    const step = builder.build(f * STEP);
    scene.update(step, behaviour.update(step));
    const start = renderer.calls.length;
    scene.draw(renderer, testViewport);
    // Une image sur douze suffit : l'empreinte reste sensible sans relever 240
    // images complètes.
    if (f % 12 !== 0) continue;
    for (const call of renderer.calls.slice(start)) {
      switch (call.type) {
        case 'strokeCircle':
          out.push(`sc ${r(call.radius)} ${r(call.lineWidth)} ${r(call.color.a)}`);
          break;
        case 'fillRadialGradient':
          out.push(`rg ${r(call.outerRadius)} ${r(call.inner.r)} ${r(call.inner.g)} ${r(call.inner.b)}`);
          break;
        case 'strokePath':
          out.push(`sp ${r(call.lineWidth)} ${r(call.xs[0] ?? 0)} ${r(call.ys[0] ?? 0)} ${r(call.ys[7] ?? 0)}`);
          break;
        case 'fillPath':
          out.push(`fp ${r(call.xs[0] ?? 0)} ${r(call.ys[0] ?? 0)} ${r(call.ys[2] ?? 0)}`);
          break;
        case 'drawSprite': {
          // La POSITION compte autant que la taille : le charley accélère les
          // particules et les LFO font dériver le halo, deux effets qui ne
          // touchent ni `scale` ni `alpha`. Une première version de cette
          // empreinte les ignorait et concluait à tort que `field` ne réagissait
          // pas au charley.
          const t0 = call.transforms[0];
          const tn = call.transforms[Math.min(call.count - 1, call.transforms.length - 1)];
          out.push(
            `ds ${call.count} ${r(t0?.x ?? 0)} ${r(t0?.y ?? 0)} ${r(t0?.scale ?? 0)} ${r(t0?.alpha ?? 0)} ${r(tn?.x ?? 0)} ${r(tn?.y ?? 0)}`,
          );
          break;
        }
        case 'drawFeedback':
          // L'ÉCHELLE autant que l'alpha : le kick agit sur la première, et
          // l'omettre faisait conclure à tort que `field` ignorait `impact`.
          out.push(`fb ${r(call.scale)} ${r(call.alpha)}`);
          break;
        case 'applyShake':
          out.push(`sk ${r(call.dx)} ${r(call.dy)}`);
          break;
        default:
          break;
      }
    }
  }
  return out.join('|');
}

function r(x: number): string {
  return x.toFixed(4);
}

const STYLES: ReadonlyArray<[string, () => Scene]> = [
  ['pulse', createPulseStyle],
  ['field', createFieldStyle],
  ['spectrum-pro', createSpectrumProStyle],
];

describe('critère 11 — le mapping atteint réellement l\'image', () => {
  it('un mapping identique produit une image identique (Loi 1)', () => {
    // Contrôle indispensable : sans lui, les tests suivants passeraient même si
    // l'image variait au hasard d'une exécution à l'autre.
    for (const [name, make] of STYLES) {
      expect(fingerprint(make, defaultMapping), name).toBe(fingerprint(make, defaultMapping));
    }
  });

  it('couper la CAISSE CLAIRE change l\'image des trois styles', () => {
    const muted: MappingSchema = { ...defaultMapping, accent: { from: ['SNARE', 'CLAP'], gain: 0, decay: 0.18 } };
    for (const [name, make] of STYLES) {
      expect(
        fingerprint(make, muted),
        `${name} ne réagit pas à la caisse claire — c'était le défaut d'origine`,
      ).not.toBe(fingerprint(make, defaultMapping));
    }
  });

  it('couper le CHARLEY change l\'image des trois styles', () => {
    const muted: MappingSchema = { ...defaultMapping, tick: { from: ['HAT', 'PERC'], gain: 0, decay: 0.06 } };
    for (const [name, make] of STYLES) {
      expect(fingerprint(make, muted), `${name} ne réagit pas au charley`).not.toBe(fingerprint(make, defaultMapping));
    }
  });

  it('changer la décroissance du KICK change l\'image', () => {
    // Le gain reste identique : seule la FORME de l'enveloppe bouge. C'est le
    // réglage le plus fin du mapping ; s'il passe, les plus grossiers passent.
    const slow: MappingSchema = { ...defaultMapping, impact: { from: ['KICK'], gain: 1, decay: 0.6 } };
    for (const [name, make] of STYLES) {
      expect(fingerprint(make, slow), name).not.toBe(fingerprint(make, defaultMapping));
    }
  });

  it('changer un LFO change l\'image sans toucher à un seul événement', () => {
    // Les LFO ne dépendent d'aucune frappe : ils prouvent que l'image vit même
    // entre les événements, ce qu'aucune autre famille de signal ne peut faire.
    const other: MappingSchema = {
      ...defaultMapping,
      lfoA: { from: 'lfo:square', bars: 0.75 },
      lfoB: { from: 'lfo:saw', bars: 3, phase: 0.1 },
      lfoC: { from: 'lfo:triangle', bars: 5 },
      lfoD: { from: 'lfo:random', bars: 1.5 },
    };
    for (const [name, make] of STYLES) {
      expect(fingerprint(make, other), name).not.toBe(fingerprint(make, defaultMapping));
    }
  });
});
