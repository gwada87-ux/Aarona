import { describe, expect, it } from 'vitest';
import { validatePmdi } from '../../src/music/validatePmdi';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { StepContextBuilder } from '../../src/music/StepContext';
import { BehaviourEngine } from '../../src/behaviour/BehaviourEngine';
import { defaultMapping } from '../../src/behaviour/mapping/defaults';
import type { MappingSchema } from '../../src/behaviour/mapping/MappingSchema';
import type { PmdiDocument } from '../../src/music/pmdi';

function doc(): PmdiDocument {
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: 20, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [
      { t: 0.5, type: 'KICK', intensity: 0.8, confidence: 0.9 },
      { t: 1.0, type: 'SNARE', intensity: 0.6, confidence: 0.9 },
      { t: 2.0, type: 'DROP', intensity: 1, confidence: 0.7 },
    ],
    features: [
      { id: 'energy', hz: 1, t0: 0, data: Array(21).fill(0.7) },
      { id: 'band.sub', hz: 1, t0: 0, data: Array(21).fill(0.3) },
      { id: 'centroid', hz: 1, t0: 0, data: Array(21).fill(0.6) },
    ],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}

function buildTimeline() {
  const document = doc();
  expect(validatePmdi(document).ok).toBe(true);
  return buildMusicTimeline(document);
}

describe('BehaviourEngine — câblage par défaut, bout en bout', () => {
  it('impact réagit au KICK, gain appliqué, puis décroît', () => {
    // step.dt vaut TOUJOURS FIXED_DT (1/120) quel que soit l'écart entre deux
    // `t` successifs (docs/02 §StepContext) : pour observer une décroissance
    // réaliste, il faut avancer sous-pas par sous-pas, pas sauter le `t`.
    const timeline = buildTimeline();
    const stepper = new StepContextBuilder(timeline, 1);
    const engine = new BehaviourEngine(timeline, defaultMapping);
    const dt = 1 / 120;

    const before = engine.update(stepper.build(0.5 - dt));
    expect(before.impact).toBe(0);

    let signals = engine.update(stepper.build(0.5)); // KICK intensity=0.8, gain=1.0
    expect(signals.impact).toBeCloseTo(0.8, 6);

    // 0,12s n'est pas un multiple exact de 1/120s (0,12*120=14,4) : la dernière
    // itération dépasse légèrement — tolérance élargie, la valeur analytique
    // exacte est déjà couverte par impulse.test.ts.
    for (let t = 0.5 + dt; t <= 0.5 + 0.12 + 1e-9; t += dt) signals = engine.update(stepper.build(t));
    expect(signals.impact).toBeCloseTo(0.4, 1); // une demi-vie (decay=0.12s) plus tard
  });

  it('accent réagit à SNARE (et CLAP), pas à KICK', () => {
    const timeline = buildTimeline();
    const stepper = new StepContextBuilder(timeline, 1);
    const engine = new BehaviourEngine(timeline, defaultMapping);

    const atKick = engine.update(stepper.build(0.5));
    const atSnare = engine.update(stepper.build(1.0));
    expect(atKick.accent).toBe(0);
    expect(atSnare.accent).toBeCloseTo(0.6 * 0.85, 6); // intensity * gain
  });

  it('drive/weight/brightness convergent vers la valeur constante des FeatureTracks', () => {
    const timeline = buildTimeline();
    const stepper = new StepContextBuilder(timeline, 1);
    const engine = new BehaviourEngine(timeline, defaultMapping);

    let signals = engine.update(stepper.build(0));
    for (let t = 1 / 120; t <= 5; t += 1 / 120) signals = engine.update(stepper.build(t));

    expect(signals.drive).toBeCloseTo(0.7, 2);
    expect(signals.weight).toBeCloseTo(0.3, 2);
    expect(signals.brightness).toBeCloseTo(0.6, 2);
  });

  it('tension monte vers le DROP à mesure qu\'il approche (anticipation)', () => {
    const timeline = buildTimeline();
    const stepper = new StepContextBuilder(timeline, 1);
    const engine = new BehaviourEngine(timeline, defaultMapping);

    const far = engine.update(stepper.build(0)); // dropIn = 2.0 > window (4.0)... en fait dans la fenêtre
    const near = engine.update(stepper.build(1.9)); // dropIn = 0.1, proche
    expect(near.tension).toBeGreaterThan(far.tension);
    expect(near.tension).toBeGreaterThan(0.9);
  });

  it('pulse/barPulse sont des fonctions directes de beat.phase/bar.phase, hors table de câblage', () => {
    const timeline = buildTimeline();
    const stepper = new StepContextBuilder(timeline, 1);
    const engine = new BehaviourEngine(timeline, defaultMapping);

    const step = stepper.build(0); // beat.phase = 0, bar.phase = 0
    const signals = engine.update(step);
    expect(signals.pulse).toBeCloseTo(0.5, 10); // sin(0) remis à l'échelle 0..1 = 0.5
    expect(signals.barPulse).toBeCloseTo(0.5, 10);
  });
});

describe('BehaviourEngine — reset(t) (docs/02 §Seek)', () => {
  it('Impulse retombe à 0, Continuous saute à sa valeur d\'équilibre au nouveau t', () => {
    const timeline = buildTimeline();
    const stepper = new StepContextBuilder(timeline, 1);
    const engine = new BehaviourEngine(timeline, defaultMapping);

    engine.update(stepper.build(0.5)); // déclenche impact
    engine.reset(10); // seek loin de tout événement, feature constante à 0.7/0.3/0.6

    const afterReset = engine.update(stepper.build(10));
    expect(afterReset.impact).toBe(0); // rien n'a tiré au sous-pas du reset lui-même
    expect(afterReset.drive).toBeCloseTo(0.7, 6); // saut direct, pas de rampe depuis 0
    expect(afterReset.weight).toBeCloseTo(0.3, 6);
  });
});

describe('BehaviourEngine — setMapping() (Étape 28, corrige la limite de l\'Étape 14/P12)', () => {
  it('préserve la valeur en cours d\'un Impulse en décroissance (pas de saut à 0)', () => {
    const timeline = buildTimeline();
    const stepper = new StepContextBuilder(timeline, 1);
    const engine = new BehaviourEngine(timeline, defaultMapping);
    const dt = 1 / 120;

    engine.update(stepper.build(0.5)); // KICK, impact = 0.8
    let signals = engine.update(stepper.build(0.5 + dt)); // début de décroissance
    const beforeSwap = signals.impact;
    expect(beforeSwap).toBeGreaterThan(0);
    expect(beforeSwap).toBeLessThan(0.8); // déjà entamé la décroissance

    // recâblage en cours de route (ex. glissement du macro energy) : même table, juste rejouée.
    engine.setMapping(defaultMapping);
    signals = engine.update(stepper.build(0.5 + 2 * dt));

    // sans setMapping() (donc avec l'ancien `new BehaviourEngine(...)`), impact retomberait à 0 —
    // ici il continue sa décroissance normale depuis beforeSwap, pas depuis 0.
    expect(signals.impact).toBeGreaterThan(0);
    expect(signals.impact).toBeLessThan(beforeSwap);
    expect(signals.impact).toBeGreaterThan(beforeSwap * 0.5); // une seule sous-étape de décroissance, pas un saut
  });

  it('préserve la valeur en cours d\'un Continuous (pas de saut vers 0 avant reconvergence)', () => {
    const timeline = buildTimeline();
    const stepper = new StepContextBuilder(timeline, 1);
    const engine = new BehaviourEngine(timeline, defaultMapping);

    let signals = engine.update(stepper.build(0));
    for (let t = 1 / 120; t <= 2; t += 1 / 120) signals = engine.update(stepper.build(t));
    const beforeSwap = signals.drive;
    expect(beforeSwap).toBeGreaterThan(0); // déjà monté depuis 0 vers ~0.7

    engine.setMapping(defaultMapping);
    signals = engine.update(stepper.build(2 + 1 / 120));

    expect(signals.drive).toBeCloseTo(beforeSwap, 2); // pas de retour à 0, juste la suite de la convergence
  });

  it('un signal absent du nouveau mapping perd son état ; un signal nouveau démarre neutre', () => {
    const timeline = buildTimeline();
    const stepper = new StepContextBuilder(timeline, 1);
    const engine = new BehaviourEngine(timeline, defaultMapping);

    engine.update(stepper.build(0.5)); // impact tiré
    const mappingSansImpact: MappingSchema = { ...defaultMapping };
    delete (mappingSansImpact as Record<string, unknown>).impact;
    engine.setMapping(mappingSansImpact);

    const signals = engine.update(stepper.build(0.5 + 1 / 120));
    expect(signals.impact).toBe(0); // plus de primitive impact -> impulseValue() retombe sur le défaut 0
  });

  it('les NOUVEAUX paramètres (decay) du mapping recâblé s\'appliquent immédiatement, pas les anciens', () => {
    const timeline = buildTimeline();
    const stepper = new StepContextBuilder(timeline, 1);
    const engine = new BehaviourEngine(timeline, defaultMapping);

    engine.update(stepper.build(0.5)); // impact = 0.8, decay par défaut (0.12s)
    const mappingDecayLong: MappingSchema = { ...defaultMapping, impact: { from: ['KICK', 'CLAP'], gain: 1.0, decay: 5 } };
    engine.setMapping(mappingDecayLong);

    let signals = engine.update(stepper.build(0.5 + 1 / 120));
    const justAfterSwap = signals.impact;
    for (let t = 0.5 + 2 / 120; t <= 0.5 + 0.12; t += 1 / 120) signals = engine.update(stepper.build(t));
    // decay=5s : après 0,12s la perte est minime, très différente de la demi-vie du mapping d'origine.
    expect(signals.impact).toBeCloseTo(justAfterSwap, 1);
  });
});

describe('BehaviourEngine — table de câblage recâblable sans recompilation', () => {
  it('un preset qui nourrit impact depuis SNARE au lieu de KICK change le comportement, même code', () => {
    const timeline = buildTimeline();
    const rbMapping: MappingSchema = { ...defaultMapping, impact: { from: ['SNARE'], gain: 1.0, decay: 0.12 } };

    const defaultEngine = new BehaviourEngine(timeline, defaultMapping);
    const rbEngine = new BehaviourEngine(timeline, rbMapping);
    const defaultStepper = new StepContextBuilder(timeline, 1);
    const rbStepper = new StepContextBuilder(timeline, 1);

    const defaultAtKick = defaultEngine.update(defaultStepper.build(0.5));
    const rbAtKick = rbEngine.update(rbStepper.build(0.5));
    expect(defaultAtKick.impact).toBeGreaterThan(0); // câblage par défaut : impact réagit au KICK
    expect(rbAtKick.impact).toBe(0); // câblage R&B : impact ignore le KICK

    const rbAtSnare = rbEngine.update(rbStepper.build(1.0));
    expect(rbAtSnare.impact).toBeCloseTo(0.6, 6); // et réagit au SNARE
  });
});
