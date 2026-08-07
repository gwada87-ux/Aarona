/**
 * Critere §8.8, verifie sur signal synthetique et sans navigateur :
 *
 *   « Sur 10 min de signal synthetique, le journal du director montre >= 10
 *     changements de scene, aucune repetition avant 3 changements, et 100 %
 *     des changements sur une frontiere declaree par `BeatClock` QUAND
 *     `confidence >= 0.55` (assertion dans le journal, pas a l'oeil). »
 *
 * Ce test est separe des autres parce qu'il est lent : dix minutes d'audio
 * analysees trame par trame, avec deux FFT reelles par trame.
 */

import { describe, expect, it } from 'vitest';
import { breakdownDrop, clickTrack, concat } from '../../../src/ui/live/testing/SyntheticAudio';
import { createEngine, runEngine } from '../../../src/ui/live/testing/runEngine';
import { IntensityDirector } from '../../../src/ui/live/IntensityDirector';
import { LiveDirector, type SceneChange } from '../../../src/ui/live/LiveDirector';
import { OverlayDirector } from '../../../src/ui/live/Overlays';
import { DEFAULT_LIVE_CONFIG } from '../../../src/ui/live/LiveConfig';
import { SCENE_REGISTRY } from '../../../src/ui/live/scenes';

const CFG = DEFAULT_LIVE_CONFIG;

/** PRNG seede : le meme signal doit produire le meme deroule. */
function seededRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000000) / 1000000;
  };
}

describe('Director sur 10 minutes (§8.8)', () => {
  it('journal conforme : assez de coupes, aucune repetition immediate, toutes sur une frontiere', () => {
    // Dix minutes, deux tempos et des breakdowns/drops : de quoi exercer les
    // trois voies d'arbitrage (drop, plafond, frontiere de phrase).
    const signal = concat(
      clickTrack(128, 180),
      breakdownDrop(128),
      clickTrack(140, 180),
      breakdownDrop(140),
      clickTrack(128, 155),
    );
    expect(signal.durationSec, `duree ${signal.durationSec.toFixed(0)} s`).toBeGreaterThanOrEqual(600);

    const engine = createEngine(signal);
    const director = new LiveDirector(CFG.director);
    const intensity = new IntensityDirector(CFG.intensity);
    const overlays = new OverlayDirector(CFG.director);
    const rng = seededRng(0x9e3779b9);

    /** Journal complet - `director.log` est borne a 5 entrees pour le HUD. */
    const changes: SceneChange[] = [];
    let overlayMax = 0;
    let luminance = 0.1;

    runEngine(engine, signal, {
      onFrame: ({ engine: e }) => {
        // Luminance simulee : le pipeline n'existe pas ici. Une valeur qui
        // suit l'intensite suffit a exercer le garde-fou et le plancher de
        // vide sans dependre du rendu.
        luminance += (e.section.intensity * 0.35 - luminance) * 0.05;
        intensity.update(e.dt, e.section, e.beat, luminance);
        const decision = director.update({
          tSec: e.tSec,
          dt: e.dt,
          state: e.state,
          beat: e.beat,
          section: e.section,
          intensity: intensity.intensity,
          rmsDbfs: e.features.rmsDbfs,
          reducedMotion: false,
          rng,
        });
        if (decision) {
          const entry = director.log[0];
          if (entry) changes.push(entry);
        }
        overlays.update(e.beat, intensity.budget, intensity.intensity, decision?.entry.id ?? '', false, rng);
        overlayMax = Math.max(overlayMax, overlays.count);
      },
    });

    // --- 1. Assez de coupes -------------------------------------------------
    // La premiere entree est l'installation initiale, pas un changement.
    const cuts = changes.filter((c) => c.reason !== 'init');
    expect(cuts.length, `${cuts.length} changements sur ${signal.durationSec.toFixed(0)} s`).toBeGreaterThanOrEqual(10);

    // --- 2. Anti-repetition -------------------------------------------------
    // §4.3 demande 3 autres scenes avant un retour ; avec 3 scenes au registre,
    // la fenetre est plafonnee a 2 (voir `LiveDirector.score`). Ce qui reste
    // verifiable sans ambiguite : jamais deux fois de suite la meme.
    const window = Math.min(CFG.director.antiRepeat, SCENE_REGISTRY.length - 1);
    for (let i = 1; i < changes.length; i++) {
      const recent = changes.slice(Math.max(0, i - window), i).map((c) => c.to);
      expect(recent.includes(changes[i]!.to), `repetition a l index ${i} : ${changes[i]!.to} deja dans ${recent.join(',')}`).toBe(
        false,
      );
    }

    // --- 3. 100 % sur une frontiere quand la confiance le permet ------------
    const confident = cuts.filter((c) => c.downbeatConfidence >= 0 && c.boundary !== 'immediate');
    for (const c of confident) {
      expect(['phrase', 'deux-mesures', 'mesure', 'downbeat'], `coupe ${c.to} sur ${c.boundary}`).toContain(c.boundary);
    }
    // Les seules coupes hors grille autorisees sont celles du mode degrade.
    for (const c of cuts) {
      if (c.boundary === 'immediate') {
        expect(['degraded-trough', 'degraded-timer', 'manual', 'panic'], `coupe immediate ${c.reason}`).toContain(
          c.reason,
        );
      }
    }

    // --- 4. Espacement minimal ---------------------------------------------
    // Aucune contrainte ne survit a un drop SAUF celle-ci (§4.3).
    for (let i = 1; i < cuts.length; i++) {
      const gap = cuts[i]!.tSec - cuts[i - 1]!.tSec;
      // 4 mesures a 140 BPM = 6,9 s. On verifie en secondes, avec la marge du
      // tempo le plus rapide du signal.
      expect(gap, `coupes a ${gap.toFixed(1)} s d'ecart`).toBeGreaterThan(6);
    }

    // --- 5. Budget d'overlays jamais depasse --------------------------------
    expect(overlayMax, `maximum observe ${overlayMax}`).toBeLessThanOrEqual(3);
  }, 600000);
});
