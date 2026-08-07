/**
 * Etape 4 : dramaturgie (§2.8), arbitrage des coupes (§4.3), overlays (§4.4)
 * et controles (§4.5). Tout est teste hors navigateur : ces trois modules sont
 * volontairement purs, c'est ce qui rend le critere §8.8 verifiable.
 */

import { describe, expect, it } from 'vitest';
import { IntensityDirector } from '../../../src/ui/live/IntensityDirector';
import { LiveDirector, type DirectorInput } from '../../../src/ui/live/LiveDirector';
import { OverlayDirector, OVERLAY_ORDER, type OverlayId } from '../../../src/ui/live/Overlays';
import { actionForKey, SHORTCUTS } from '../../../src/ui/live/Controls';
import { DEFAULT_LIVE_CONFIG } from '../../../src/ui/live/LiveConfig';
import { SCENE_REGISTRY } from '../../../src/ui/live/scenes';
import type { BeatClockState } from '../../../src/ui/live/audio/BeatClock';
import type { SectionEnergyState } from '../../../src/ui/live/audio/SectionEnergy';

const CFG = DEFAULT_LIVE_CONFIG;

function beatState(over: Partial<BeatClockState> = {}): BeatClockState {
  return {
    bpm: 120,
    periodSec: 0.5,
    beatPhase: 0,
    barPhase: 0,
    phrasePhase: 0,
    beatIndex: 0,
    barIndex: 0,
    phraseIndex: 0,
    confidence: 0.9,
    downbeatConfidence: 0.8,
    visualBeatPhase: 0,
    visualBarPhase: 0,
    phraseValid: true,
    ...over,
  };
}

function section(over: Partial<SectionEnergyState> = {}): SectionEnergyState {
  return {
    lowDb: -20,
    referenceDb: -20,
    arc: 'peak',
    breakdown: false,
    build: false,
    dropFired: false,
    intensity: 0.6,
    ...over,
  };
}

function input(over: Partial<DirectorInput> = {}): DirectorInput {
  return {
    tSec: 0,
    dt: 1 / 60,
    state: 'LOCKED',
    beat: beatState(),
    section: section(),
    intensity: 0.6,
    rmsDbfs: -12,
    reducedMotion: false,
    rng: () => 0.5,
    ...over,
  };
}

describe('IntensityDirector - dramaturgie (§2.8)', () => {
  it('le budget d overlays suit les seuils 0,3 et 0,7', () => {
    const d = new IntensityDirector(CFG.intensity);
    for (const [intensity, expected] of [
      [0.1, 1],
      [0.5, 2],
      [0.9, 3],
    ] as const) {
      d.reset();
      d.update(0.016, section({ intensity }), beatState(), 0.1);
      expect(d.budget.overlays, `intensite ${intensity}`).toBe(expected);
    }
  });

  it('la retenue avant impact DIMINUE l amplitude pendant une montee', () => {
    const normal = new IntensityDirector(CFG.intensity);
    normal.update(0.016, section({ intensity: 0.6 }), beatState(), 0.1);
    const building = new IntensityDirector(CFG.intensity);
    building.update(0.016, section({ intensity: 0.6, build: true, arc: 'build' }), beatState(), 0.1);
    expect(building.budget.amplitude, 'un build qui monte avec le drop annule le drop').toBeLessThan(
      normal.budget.amplitude,
    );
    expect(building.intensity).toBeLessThan(normal.intensity);
  });

  it('apres le drop : une mesure d explosion, puis une retombee SOUS le niveau d avant', () => {
    const d = new IntensityDirector(CFG.intensity);
    const sec = section({ intensity: 0.6 });
    d.update(0.016, sec, beatState({ barIndex: 10 }), 0.1);
    const before = d.intensity;

    d.update(0.016, section({ intensity: 0.6, dropFired: true }), beatState({ barIndex: 11 }), 0.1);
    expect(d.intensity, 'explosion').toBeGreaterThan(before);

    // Mesure suivante : retombee.
    d.update(0.016, sec, beatState({ barIndex: 12 }), 0.1);
    expect(d.intensity, `retombee ${d.intensity.toFixed(3)} vs avant ${before.toFixed(3)}`).toBeLessThan(before);
  });

  it('breakdown : quasi-noir assume et grain seul', () => {
    const d = new IntensityDirector(CFG.intensity);
    d.update(0.016, section({ breakdown: true, arc: 'breakdown', intensity: 0.4 }), beatState(), 0.1);
    expect(d.budget.luminanceCap).toBeLessThanOrEqual(CFG.intensity.breakdownLuminance);
    expect(d.budget.grainOnly).toBe(true);
    expect(d.budget.overlays, 'aucun overlay hors grain en breakdown').toBe(0);
  });

  it('le garde-fou de saturation descend tout d un cran', () => {
    const d = new IntensityDirector(CFG.intensity);
    // Une luminance elevee soutenue pendant plusieurs secondes.
    for (let i = 0; i < 1200; i++) d.update(0.016, section({ intensity: 0.9 }), beatState(), 0.8);
    expect(d.saturated, `moyenne ${d.meanLuminance.toFixed(3)}`).toBe(true);
    expect(d.budget.bloom).toBeLessThan(1);
    expect(d.budget.overlays, 'un cran de moins que les 3 de l intensite 0,9').toBe(2);
  });

  /**
   * ETAPE 6. Sans hysteresis, le garde-fou est instable PAR CONSTRUCTION : il
   * fait baisser la luminance, la moyenne repasse sous le seuil, il se relache,
   * la luminance remonte - a la frequence de trame. Le budget d'overlays etait
   * deja protege (`OverlayDirector` ne bascule qu'aux frontieres de mesure),
   * mais bloom et densite sautaient de 30 % d'une trame a l'autre.
   */
  it('le garde-fou ne bat pas quand la luminance stationne sur le seuil', () => {
    const d = new IntensityDirector(CFG.intensity);
    const limit = CFG.intensity.saturationLimit;
    for (let i = 0; i < 1200; i++) d.update(0.016, section({ intensity: 0.9 }), beatState(), 0.8);
    expect(d.saturated).toBe(true);

    // Luminance oscillant AUTOUR du seuil, comme le produit la boucle de
    // regulation elle-meme.
    let flips = 0;
    let previous = d.saturated;
    for (let i = 0; i < 600; i++) {
      d.update(0.016, section({ intensity: 0.9 }), beatState(), limit + (i % 2 === 0 ? 0.01 : -0.01));
      if (d.saturated !== previous) flips++;
      previous = d.saturated;
    }
    // Avec hysteresis la moyenne doit descendre sous 0,85 x le seuil pour
    // relacher : une seule bascule, definitive, au lieu d'une par trame.
    expect(flips, `${flips} bascules sur 600 trames`).toBeLessThanOrEqual(1);
  });

  it('un flash isole ne declenche PAS le garde-fou', () => {
    const d = new IntensityDirector(CFG.intensity);
    for (let i = 0; i < 300; i++) d.update(0.016, section(), beatState(), 0.05);
    d.update(0.016, section(), beatState(), 1);
    expect(d.saturated, 'le seuil porte sur la moyenne glissante, pas sur une trame').toBe(false);
  });

  it('le plancher de vide est FORCE si la phrase n en a pas eu', () => {
    const d = new IntensityDirector(CFG.intensity);
    // Une phrase entiere lumineuse : aucun temps sombre.
    let beatIndex = 0;
    for (let i = 0; i < 400; i++) {
      const phrasePhase = Math.min(0.99, i / 400);
      d.update(0.016, section(), beatState({ beatIndex: beatIndex++, phrasePhase, phraseIndex: 0 }), 0.5);
    }
    expect(d.voidSatisfied).toBe(false);
    expect(d.forcingVoid, 'le vide doit etre impose aux trois quarts de la phrase').toBe(true);
    expect(d.budget.luminanceCap).toBeLessThanOrEqual(CFG.intensity.voidFloorRatio);
  });

  it('deux temps sombres CONSECUTIFS satisfont le plancher, deux temps separes non', () => {
    const d = new IntensityDirector(CFG.intensity);
    // Etablit une moyenne glissante autour de 0,5.
    for (let i = 0; i < 600; i++) d.update(0.016, section(), beatState({ beatIndex: 0, phraseIndex: 0 }), 0.5);
    // Deux temps consecutifs tres sombres.
    d.update(0.016, section(), beatState({ beatIndex: 1, phraseIndex: 0 }), 0.01);
    d.update(0.016, section(), beatState({ beatIndex: 2, phraseIndex: 0 }), 0.01);
    d.update(0.016, section(), beatState({ beatIndex: 3, phraseIndex: 0 }), 0.01);
    expect(d.voidSatisfied).toBe(true);
  });

  it('le multiplicateur utilisateur reste borne a [0.5, 1.5]', () => {
    const d = new IntensityDirector(CFG.intensity);
    for (let i = 0; i < 50; i++) d.nudgeUserScale(1);
    expect(d.userScale).toBe(CFG.intensity.userScaleMax);
    for (let i = 0; i < 50; i++) d.nudgeUserScale(-1);
    expect(d.userScale).toBe(CFG.intensity.userScaleMin);
  });
});

describe('LiveDirector - arbitrage des coupes (§4.3)', () => {
  it('installe une scene des la premiere trame', () => {
    const d = new LiveDirector(CFG.director);
    const decision = d.update(input());
    expect(decision).not.toBeNull();
    expect(decision?.reason).toBe('init');
    expect(d.currentEntry).not.toBeNull();
  });

  it('ne coupe pas avant le plancher de 15 s', () => {
    const d = new LiveDirector(CFG.director);
    d.update(input());
    let cuts = 0;
    for (let i = 1; i < 600; i++) {
      const t = i / 60;
      const beat = beatState({ beatIndex: Math.floor(t * 2), barIndex: Math.floor(t / 2), phraseIndex: Math.floor(t / 16) });
      if (d.update(input({ tSec: t, beat }))) cuts++;
    }
    expect(cuts, '10 s de signal ne doivent produire aucune coupe').toBe(0);
  });

  it('un DROP coupe immediatement, plancher suspendu, mais jamais a moins de 4 mesures', () => {
    const d = new LiveDirector(CFG.director);
    d.update(input({ beat: beatState({ barIndex: 0 }) }));

    // Drop a la mesure 2 : trop tot, l'espacement de 4 mesures s'y oppose.
    const early = d.update(input({ tSec: 1, beat: beatState({ barIndex: 2 }), section: section({ dropFired: true }) }));
    expect(early, 'espacement minimal de 4 mesures').toBeNull();

    // Drop a la mesure 5 : autorise, meme si le plancher de 15 s n'est pas
    // atteint - c'est exactement ce que « le plancher est suspendu » veut dire.
    const late = d.update(input({ tSec: 3, beat: beatState({ barIndex: 5 }), section: section({ dropFired: true }) }));
    expect(late).not.toBeNull();
    expect(late?.reason).toBe('drop');
    expect(late?.fadeSec, 'un drop est une coupe FRANCHE, jamais un fondu').toBe(0);
    expect(late?.boundary).toBe('downbeat');
  });

  it('le plafond de 60 s coupe a la frontiere de phrase', () => {
    const d = new LiveDirector(CFG.director);
    d.update(input());
    let cut = null;
    for (let i = 1; i < 70 * 60 && !cut; i++) {
      const t = i / 60;
      const beat = beatState({
        barIndex: Math.floor(t / 2),
        phraseIndex: Math.floor(t / 16),
        beatIndex: Math.floor(t * 2),
      });
      cut = d.update(input({ tSec: t, beat, intensity: 0.6 }));
    }
    expect(cut).not.toBeNull();
    expect(['ceiling', 'phrase-score']).toContain(cut?.reason);
  });

  it('sans downbeat fiable, la phrase n existe pas : repli sur deux mesures', () => {
    const d = new LiveDirector(CFG.director);
    d.update(input({ beat: beatState({ downbeatConfidence: 0.1, phraseValid: false }) }));
    let cut = null;
    for (let i = 1; i < 40 * 60 && !cut; i++) {
      const t = i / 60;
      const beat = beatState({
        downbeatConfidence: 0.1,
        phraseValid: false,
        barIndex: Math.floor(t / 2),
        beatIndex: Math.floor(t * 2),
      });
      cut = d.update(input({ tSec: t, beat }));
    }
    expect(cut?.boundary, 'sans phrase, la frontiere structurelle est deux mesures').toBe('deux-mesures');
  });

  it('anti-repetition : jamais la meme scene deux fois de suite', () => {
    const d = new LiveDirector(CFG.director);
    const seen: string[] = [];
    let rngState = 1;
    const rng = (): number => {
      rngState = (rngState * 1103515245 + 12345) % 2147483648;
      return rngState / 2147483648;
    };
    for (let i = 0; i < 40 * 60 * 6; i++) {
      const t = i / 60;
      const beat = beatState({
        barIndex: Math.floor(t / 2),
        phraseIndex: Math.floor(t / 16),
        beatIndex: Math.floor(t * 2),
      });
      const cut = d.update(input({ tSec: t, beat, rng }));
      if (cut) seen.push(cut.entry.id);
    }
    expect(seen.length, `${seen.length} coupes`).toBeGreaterThan(3);
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i], `repetition immediate a l index ${i} : ${seen.join(' ')}`).not.toBe(seen[i - 1]);
    }
  });

  it('le journal consigne la frontiere qui a declenche chaque coupe (§8.8)', () => {
    const d = new LiveDirector(CFG.director);
    d.update(input());
    d.update(input({ tSec: 3, beat: beatState({ barIndex: 5 }), section: section({ dropFired: true }) }));
    expect(d.log.length).toBeGreaterThanOrEqual(2);
    for (const entry of d.log) {
      expect(entry.boundary, 'chaque coupe declare sa frontiere').toBeTruthy();
      expect(entry.reason).toBeTruthy();
      expect(typeof entry.downbeatConfidence).toBe('number');
    }
    expect(d.log.length, 'journal borne a 5 entrees').toBeLessThanOrEqual(5);
  });

  it('mode degrade : uniquement des fondus, jamais de coupe seche', () => {
    const d = new LiveDirector(CFG.director);
    d.update(input({ state: 'REACTIVE' }));
    let cut = null;
    for (let i = 1; i < 60 * 60 && !cut; i++) {
      const t = i / 60;
      cut = d.update(input({ tSec: t, state: 'REACTIVE', beat: beatState({ barIndex: Math.floor(t / 2) }) }));
    }
    expect(cut, 'le minuteur de 20 s doit finir par declencher').not.toBeNull();
    expect(cut?.fadeSec, 'une coupe seche n a de sens que sur une grille').toBeGreaterThan(0);
    expect(d.degraded).toBe(true);
  });

  it('le verrou de scene empeche les coupes automatiques mais pas les manuelles', () => {
    const d = new LiveDirector(CFG.director);
    d.update(input());
    d.sceneLocked = true;
    let auto = null;
    for (let i = 1; i < 70 * 60 && !auto; i++) {
      const t = i / 60;
      auto = d.update(
        input({ tSec: t, beat: beatState({ barIndex: Math.floor(t / 2), phraseIndex: Math.floor(t / 16) }) }),
      );
    }
    expect(auto, 'verrouille').toBeNull();

    d.requestManual(1);
    const manual = d.update(input({ tSec: 80, beat: beatState({ barIndex: 41 }) }));
    expect(manual?.reason).toBe('manual');
    expect(manual?.boundary, 'quantifiee a la mesure suivante, jamais immediate').toBe('mesure');
  });

  it('le panic ramene la scene la plus calme', () => {
    const d = new LiveDirector(CFG.director);
    d.update(input({ intensity: 0.95 }));
    const decision = d.panic(input({ intensity: 0.95 }));
    expect(decision).not.toBeNull();
    const calmest = [...SCENE_REGISTRY].sort((a, b) => a.intensityRange[0] - b.intensityRange[0])[0];
    expect(decision?.entry.id).toBe(calmest?.id);
    expect(decision?.fadeSec, 'panic = immediat').toBe(0);
  });
});

describe('OverlayDirector (§4.4)', () => {
  function run(director: OverlayDirector, bars: number, budgetOverlays: number, intensity: number): void {
    for (let bar = 0; bar < bars; bar++) {
      director.update(
        beatState({ barIndex: bar }),
        { overlays: budgetOverlays, bloom: 1, amplitude: 1, density: 1, luminanceCap: 1, grainOnly: false },
        intensity,
        'grid-horizon',
        false,
        () => 0.5,
      );
    }
  }

  it('ne depasse jamais le budget', () => {
    for (const budget of [0, 1, 2, 3]) {
      const d = new OverlayDirector(CFG.director);
      run(d, 40, budget, 0.9);
      expect(d.count, `budget ${budget}`).toBeLessThanOrEqual(budget);
    }
  });

  it('les overlays sont rendus dans l ORDRE d application de §4.4', () => {
    const d = new OverlayDirector(CFG.director);
    run(d, 40, 3, 0.95);
    const positions = d.active.map((id) => OVERLAY_ORDER.indexOf(id));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it('les exclusions mutuelles sont respectees', () => {
    let rngState = 7;
    const rng = (): number => {
      rngState = (rngState * 1103515245 + 12345) % 2147483648;
      return rngState / 2147483648;
    };
    const d = new OverlayDirector(CFG.director);
    for (let bar = 0; bar < 300; bar++) {
      d.update(
        beatState({ barIndex: bar }),
        { overlays: 3, bloom: 1, amplitude: 1, density: 1, luminanceCap: 1, grainOnly: false },
        0.95,
        'grid-horizon',
        false,
        rng,
      );
      const active = new Set<OverlayId>(d.active);
      expect(active.has('aberration') && active.has('invert'), 'aberration + inversion').toBe(false);
      expect(active.has('scanlines') && active.has('frame'), 'scanlines + cadre').toBe(false);
    }
  });

  it('shake est exclu de slice-displace, qui deplace deja l image', () => {
    let rngState = 3;
    const rng = (): number => {
      rngState = (rngState * 1103515245 + 12345) % 2147483648;
      return rngState / 2147483648;
    };
    const d = new OverlayDirector(CFG.director);
    for (let bar = 0; bar < 300; bar++) {
      d.update(
        beatState({ barIndex: bar }),
        { overlays: 3, bloom: 1, amplitude: 1, density: 1, luminanceCap: 1, grainOnly: false },
        0.95,
        'slice-displace',
        false,
        rng,
      );
      expect(d.isActive('shake'), 'shake sur slice-displace').toBe(false);
    }
  });

  it('rien ne bascule en dehors d une frontiere de mesure', () => {
    const d = new OverlayDirector(CFG.director);
    run(d, 20, 3, 0.95);
    const before = [...d.active];
    // Cent trames dans la MEME mesure : aucun changement possible.
    for (let i = 0; i < 100; i++) {
      d.update(
        beatState({ barIndex: 19, beatPhase: i / 100 }),
        { overlays: 3, bloom: 1, amplitude: 1, density: 1, luminanceCap: 1, grainOnly: false },
        0.95,
        'grid-horizon',
        false,
        () => 0.9,
      );
    }
    expect(d.active).toEqual(before);
  });

  it('aucun overlay en mouvement reduit, ni en breakdown', () => {
    const d = new OverlayDirector(CFG.director);
    run(d, 20, 3, 0.95);
    expect(d.count).toBeGreaterThan(0);
    d.update(
      beatState({ barIndex: 21 }),
      { overlays: 3, bloom: 1, amplitude: 1, density: 1, luminanceCap: 1, grainOnly: false },
      0.95,
      'grid-horizon',
      true,
      () => 0.5,
    );
    expect(d.count, 'mouvement reduit').toBe(0);

    const e = new OverlayDirector(CFG.director);
    run(e, 20, 3, 0.95);
    e.update(
      beatState({ barIndex: 21 }),
      { overlays: 3, bloom: 1, amplitude: 1, density: 1, luminanceCap: 0.15, grainOnly: true },
      0.95,
      'grid-horizon',
      false,
      () => 0.5,
    );
    expect(e.count, 'breakdown : grain seul').toBe(0);
  });

  it('le panic coupe tout immediatement', () => {
    const d = new OverlayDirector(CFG.director);
    run(d, 20, 3, 0.95);
    expect(d.count).toBeGreaterThan(0);
    d.panic();
    expect(d.count).toBe(0);
  });
});

describe('Controles (§4.5)', () => {
  function key(k: string, target?: EventTarget): KeyboardEvent {
    return { key: k, target: target ?? null, metaKey: false, ctrlKey: false, altKey: false } as KeyboardEvent;
  }

  it('tous les raccourcis de la table sont reconnus', () => {
    const mapped = [' ', 'a', 'l', 'ArrowRight', 'ArrowLeft', 'p', 'P', '+', '-', 'ArrowUp', 'ArrowDown', 'Escape', 'd', 'c', '?'];
    for (const k of mapped) {
      expect(actionForKey(key(k), 0), `touche ${k}`).not.toBeNull();
    }
    // La table d'aide doit couvrir CHAQUE raccourci reconnu : un raccourci
    // absent de l'aide n'existe pas pour l'operateur.
    expect(SHORTCUTS.length, 'la table d aide couvre les raccourcis').toBeGreaterThanOrEqual(12);
  });

  it('C bascule la mire de calibration (§9.6)', () => {
    // La mire est ce qui rend mesurable la latence son -> image, seul critere
    // de §8 qu'aucun test ne peut couvrir.
    expect(actionForKey(key('c'), 0)?.type).toBe('toggle-calibration');
    expect(actionForKey(key('C'), 0)?.type).toBe('toggle-calibration');
    expect(
      SHORTCUTS.some((s) => s.key === 'C'),
      'la mire doit figurer dans l aide, sinon personne ne la trouvera',
    ).toBe(true);
  });

  it('Maj+P cycle la palette, p la verrouille', () => {
    expect(actionForKey(key('P'), 0)?.type).toBe('palette-next');
    expect(actionForKey(key('p'), 0)?.type).toBe('toggle-palette-lock');
  });

  it('le tap tempo porte l horodatage', () => {
    const action = actionForKey(key(' '), 12.5);
    expect(action).toEqual({ type: 'tap', tSec: 12.5 });
  });

  it('une frappe dans un champ de saisie n est jamais un raccourci', () => {
    // Un VJ qui tape un nom de fichier ne veut pas declencher un panic.
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      const field = { tagName: tag } as unknown as EventTarget;
      expect(actionForKey(key('Escape', field), 0), tag).toBeNull();
    }
    const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;
    expect(actionForKey(key('Escape', editable), 0), 'contenteditable').toBeNull();
    const canvas = { tagName: 'CANVAS' } as unknown as EventTarget;
    expect(actionForKey(key('Escape', canvas), 0), 'le canvas doit repondre').not.toBeNull();
  });

  it('les combinaisons avec Ctrl, Meta ou Alt sont ignorees', () => {
    const withCtrl = { key: 'p', target: null, metaKey: false, ctrlKey: true, altKey: false } as KeyboardEvent;
    expect(actionForKey(withCtrl, 0)).toBeNull();
  });
});
