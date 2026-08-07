/**
 * Dramaturgie — chantier 3 (docs/17_PHASE2_VISUELS.md §6.2, §6.4, critère 12).
 *
 * Livrable annoncé : « sur un morceau complet, montrer que l'intro, la montée,
 * le drop et le breakdown produisent des images distinctes ». Un test le
 * démontre mieux qu'une capture, parce qu'il continuera de le démontrer dans
 * six mois.
 *
 * Ce qui est vérifié en priorité, avant même l'esthétique : que la dramaturgie
 * respecte la Loi 1. `IntensityDirector`, son équivalent du mode live, accumule
 * de l'état par image ; celui-ci ne le peut pas, sinon l'export cesserait de
 * reproduire la preview.
 */

import { describe, expect, it } from 'vitest';
import { VisualDirector, type DramaArc } from '../../src/behaviour/VisualDirector';
import { BehaviourEngine } from '../../src/behaviour/BehaviourEngine';
import { defaultMapping } from '../../src/behaviour/mapping/defaults';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { StepContextBuilder } from '../../src/music/StepContext';
import { validatePmdi } from '../../src/music/validatePmdi';
import type { MusicEvent, PmdiDocument, Section } from '../../src/music/pmdi';

const BPM = 120;
const BAR = (60 / BPM) * 4; // 2 s
const DURATION = 64;

/**
 * Morceau complet et structuré : intro calme, montée, drop, refrain, breakdown,
 * refrain repris (même lettre que le premier — c'est ce qui teste la variation
 * par lettre de section).
 */
const SECTIONS: readonly Section[] = [
  { t: 0, dur: 8, energy: 0.15, letter: 'I', confidence: 0.9 },
  { t: 8, dur: 8, energy: 0.55, letter: 'A', confidence: 0.9 },
  { t: 16, dur: 8, energy: 0.75, letter: 'B', confidence: 0.9 }, // montée, drop à 24
  { t: 24, dur: 16, energy: 1.0, letter: 'C', confidence: 0.9 }, // refrain
  { t: 40, dur: 8, energy: 0.12, letter: 'D', confidence: 0.9 }, // breakdown
  { t: 48, dur: 16, energy: 1.0, letter: 'C', confidence: 0.9 }, // refrain repris
];

function doc(): PmdiDocument {
  const events: MusicEvent[] = [];
  for (let beat = 0; beat * 0.5 < DURATION; beat++) {
    events.push({ t: beat * 0.5, type: 'KICK', intensity: 0.9, confidence: 0.95 });
    if (beat % 2 === 1) events.push({ t: beat * 0.5, type: 'SNARE', intensity: 0.8, confidence: 0.9 });
  }
  events.push({ t: 24, type: 'DROP', intensity: 1, confidence: 0.95 });
  // `validatePmdi` exige un tri strict par `t` : le DROP est ajouté après la
  // boucle, donc hors ordre.
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

function harness() {
  const d = doc();
  const v = validatePmdi(d);
  if (!v.ok) throw new Error(v.errors.join('; '));
  const timeline = buildMusicTimeline(d);
  return {
    timeline,
    builder: new StepContextBuilder(timeline, 1),
    director: new VisualDirector(timeline),
  };
}

function at(t: number) {
  const h = harness();
  return { budget: h.director.update(h.builder.build(t)), director: h.director, harness: h };
}

describe('VisualDirector — Loi 1 : aucun état accumulé', () => {
  it('la même seconde donne le même budget, quel que soit le chemin pour y arriver', () => {
    // Le cœur de la Loi 1. Un director qui compterait les mesures depuis le
    // drop donnerait un résultat différent selon qu'on a lu depuis le début ou
    // sauté directement — et l'export cesserait de reproduire la preview.
    const cible = 26.4;
    const direct = at(cible).budget;

    const h = harness();
    for (let t = 0; t < cible; t += 1 / 120) h.director.update(h.builder.build(t));
    const parLecture = h.director.update(h.builder.build(cible));

    const hRecul = harness();
    for (const t of [50, 3, 44, 12, cible]) hRecul.director.update(hRecul.builder.build(t));
    const parSauts = hRecul.director.budget;

    for (const champ of ['amplitude', 'level', 'cameraX', 'cameraY', 'arc'] as const) {
      expect(parLecture[champ], `lecture continue, ${champ}`).toEqual(direct[champ]);
      expect(parSauts[champ], `sauts arrière, ${champ}`).toEqual(direct[champ]);
    }
  });

  it('les valeurs restent bornées sur tout le morceau', () => {
    const h = harness();
    for (let t = 0; t < DURATION; t += 1 / 60) {
      const b = h.director.update(h.builder.build(t));
      expect(b.amplitude, `amplitude à ${t}`).toBeGreaterThanOrEqual(0);
      expect(b.amplitude, `amplitude à ${t}`).toBeLessThanOrEqual(1);
      expect(b.level, `level à ${t}`).toBeGreaterThan(0);
      expect(b.level, `level à ${t}`).toBeLessThanOrEqual(1);
      expect(Math.abs(b.cameraX), `cameraX à ${t}`).toBeLessThan(0.2);
      expect(Math.abs(b.cameraY), `cameraY à ${t}`).toBeLessThan(0.2);
    }
  });
});

describe('VisualDirector — les quatre moments sont distincts (critère 12)', () => {
  it('intro, montée, drop et breakdown produisent des budgets différents', () => {
    const moments: ReadonlyArray<[string, number, DramaArc]> = [
      ['intro', 2, 'intro'],
      ['montée', 23.5, 'build'],
      ['drop', 24.5, 'drop'],
      ['breakdown', 44, 'breakdown'],
    ];
    const vus = new Map<string, string>();
    for (const [nom, t, arcAttendu] of moments) {
      const b = at(t).budget;
      expect(b.arc, `${nom} à t=${t}`).toBe(arcAttendu);
      vus.set(nom, `${b.amplitude.toFixed(3)}/${b.level.toFixed(3)}`);
    }
    expect(new Set(vus.values()).size, `budgets identiques : ${[...vus].map(([k, v]) => k + '=' + v).join(' ')}`).toBe(4);
  });

  it('le breakdown est bien plus sombre que le refrain', () => {
    const refrain = at(30).budget;
    const breakdown = at(44).budget;
    expect(breakdown.level).toBeLessThan(refrain.level * 0.5);
  });

  it('une INTRO n\'est pas un breakdown, même à énergie identique', () => {
    // Les deux sections du fixture ont une énergie voisine (0,15 et 0,12) et
    // doivent pourtant donner deux images différentes : une intro prépare, un
    // breakdown effondre. Sans cette distinction, un morceau démarrerait sur
    // un quasi-noir.
    const intro = at(3).budget;
    const breakdown = at(44).budget;
    expect(intro.arc).toBe('intro');
    expect(breakdown.arc).toBe('breakdown');
    expect(intro.level, 'une intro doit rester lisible').toBeGreaterThan(breakdown.level * 1.5);
  });
});

describe('VisualDirector — retenue avant l\'impact (§6.2)', () => {
  it('l\'amplitude DIMINUE à l\'approche du drop, au lieu de monter', () => {
    // Contre-intuitif et c'est le point : si tout monte avec le drop, le drop
    // n'a plus de contraste à franchir.
    const loin = at(24 - 4 * BAR).budget.amplitude;
    const proche = at(24 - 1.5 * BAR).budget.amplitude;
    const juste = at(24 - 0.1 * BAR).budget.amplitude;
    expect(proche).toBeLessThan(loin);
    expect(juste).toBeLessThan(proche);
    expect(juste, 'la retenue ne doit pas éteindre l\'image').toBeGreaterThan(0.3);
  });

  it('la caméra se FIGE en même temps que la retenue', () => {
    // À défaut de pouvoir pousser — le `Renderer` n'expose pas de zoom — c'est
    // l'immobilisation du cadre qui porte la tension.
    const h = harness();
    const bouge = (t: number): number => {
      const a = h.director.update(h.builder.build(t));
      const x0 = a.cameraX;
      const y0 = a.cameraY;
      const b = h.director.update(h.builder.build(t + 0.25));
      return Math.hypot(b.cameraX - x0, b.cameraY - y0);
    };
    expect(bouge(24 - 0.2 * BAR)).toBeLessThan(bouge(24 - 5 * BAR));
  });
});

describe('VisualDirector — après le drop (§6.2)', () => {
  it('une mesure d\'explosion, puis une retombée SOUS le niveau d\'avant', () => {
    const avant = at(24 - 0.05).budget.level;
    const explosion = at(24 + 0.5 * BAR).budget;
    const retombee = at(24 + 1.5 * BAR).budget;

    expect(explosion.arc).toBe('drop');
    expect(explosion.level, 'explosion à plein niveau').toBe(1);
    expect(retombee.arc).toBe('fallout');
    expect(retombee.level, 'l\'impact se mesure à la chute qui suit').toBeLessThan(avant);
  });

  it('la retombée remonte progressivement, elle ne saute pas', () => {
    const points = [1.1, 1.5, 2.0, 2.5, 2.9].map((k) => at(24 + k * BAR).budget.level);
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!, `remontée non monotone à l'étape ${i}`).toBeGreaterThanOrEqual(points[i - 1]! - 1e-9);
    }
  });

  it('le niveau reste SOUS celui d\'avant le drop pendant TOUTE la fenêtre', () => {
    // Défaut trouvé en relevant les chiffres, pas en lisant le code : avec une
    // courbe ease-out, le niveau était remonté à 0,99 dès 2,5 mesures après le
    // drop, alors qu'il valait 0,865 avant — la règle « pendant 2 mesures »
    // n'était donc tenue que sur la première moitié de la fenêtre.
    const avant = at(24 - 0.05).budget.level;
    for (let k = 1.05; k < 3; k += 0.05) {
      const b = at(24 + k * BAR).budget;
      expect(b.arc, `à +${k.toFixed(2)} mesure`).toBe('fallout');
      expect(b.level, `niveau à +${k.toFixed(2)} mesure`).toBeLessThan(avant);
    }
  });
});

describe('VisualDirector — vide, sections et régime', () => {
  it('la demi-mesure avant une frontière de section retombe', () => {
    // Sans respiration, il n'y a pas d'accent.
    const plein = at(30).budget;
    const vide = at(40 - 0.2).budget;
    expect(vide.arc).toBe('void');
    expect(vide.level).toBeLessThan(plein.level);
  });

  it('deux sections de LETTRES différentes sont cadrées différemment', () => {
    const a = at(10).budget; // lettre A
    const b = at(18).budget; // lettre B
    expect(Math.hypot(a.cameraX - b.cameraX, a.cameraY - b.cameraY)).toBeGreaterThan(0.01);
  });

  it('le recadrage ne change pas AU MILIEU d\'une section', () => {
    // Le cadrage doit être constant sur toute une section : c'est ce qui
    // garantit qu'il ne bascule jamais au milieu d'une mesure. Seule la dérive
    // lente, continue, subsiste.
    const h = harness();
    const cadrages = [26, 30, 34, 38].map((t) => {
      const b = h.director.update(h.builder.build(t));
      return { x: b.cameraX, y: b.cameraY };
    });
    // Écart maximal entre deux instants de la même section : borné par la seule
    // dérive, donc petit. Un recadrage vaudrait 0,05.
    for (const c of cadrages) {
      expect(Math.abs(c.x - cadrages[0]!.x)).toBeLessThan(0.05);
    }
  });

  it('en régime CONTINU, la dramaturgie événementielle se retire (Loi 3)', () => {
    // Grille peu fiable : poser un drop à côté de la musique est pire que ne
    // rien poser du tout.
    const h = harness();
    const evenementiel = h.director.update({ ...h.builder.build(23.5), regime: 'event' });
    const arcEvent = evenementiel.arc;
    const continu = h.director.update({ ...h.builder.build(23.5), regime: 'continuous' });
    expect(arcEvent).toBe('build');
    expect(continu.arc).toBe('sustain');
    expect(continu.amplitude).toBe(1);
  });
});

describe('VisualDirector — modulation des signaux', () => {
  it('dose les réactions, mais JAMAIS les horloges ni l\'anticipation', () => {
    const h = harness();
    const engine = new BehaviourEngine(h.timeline, defaultMapping);
    const step = h.builder.build(24.5);
    const bruts = engine.update(step);
    const budget = h.director.update(step);
    const doses = h.director.modulate(bruts, { ...budget, amplitude: 0.5, level: 0.5 });

    expect(doses.impact).toBeCloseTo(bruts.impact * 0.5, 9);
    expect(doses.accent).toBeCloseTo(bruts.accent * 0.5, 9);
    expect(doses.drive).toBeCloseTo(bruts.drive * 0.5, 9);
    // Les horloges gardent leur amplitude : les atténuer ferait RALENTIR le
    // mouvement au lieu de le calmer, ce qui se lit comme une erreur de tempo.
    expect(doses.pulse).toBe(bruts.pulse);
    expect(doses.barPulse).toBe(bruts.barPulse);
    expect(doses.lfoA).toBe(bruts.lfoA);
    // `tension` EST la montée : la réduire pendant la retenue effacerait le
    // signal qui décrit exactement ce moment.
    expect(doses.tension).toBe(bruts.tension);
  });

  it('n\'alloue pas : le même objet est réutilisé d\'un pas à l\'autre', () => {
    const h = harness();
    const engine = new BehaviourEngine(h.timeline, defaultMapping);
    const s1 = h.builder.build(10);
    const s2 = h.builder.build(10.5);
    const a = h.director.modulate(engine.update(s1), h.director.update(s1));
    const b = h.director.modulate(engine.update(s2), h.director.update(s2));
    expect(a).toBe(b);
  });
});
