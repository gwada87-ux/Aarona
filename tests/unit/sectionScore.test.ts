/**
 * Partition de plans (blueprint §F3, chantier P0 n°3). Le test qui porte le
 * chantier est celui de la MÉMOIRE : quand la section A revient, son plan
 * revient avec elle. C'est ce qui fait qu'une vidéo se lit comme composée et
 * non comme tirée au sort.
 */
import { describe, expect, it } from 'vitest';
import { NEUTRAL_SHOT, SECTION_STAGING_V1, SHOTS, buildSectionScore } from '../../src/behaviour/SectionScore';
import { VisualDirector } from '../../src/behaviour/VisualDirector';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { StepContextBuilder } from '../../src/music/StepContext';
import type { MusicEvent, PmdiDocument, Section } from '../../src/music/pmdi';

const BPM = 120;
const BAR = 2; // 4/4 a 120 BPM

/** Temps forts toutes les 2 s, plus un motif de base. */
function doc(sections: Section[], duree = 120): PmdiDocument {
  const events: MusicEvent[] = [];
  for (let beat = 0; beat * 0.5 < duree; beat++) {
    const t = beat * 0.5;
    if (beat % 4 === 0) events.push({ t, type: 'DOWNBEAT', intensity: 1, confidence: 0.95 });
    events.push({ t, type: 'KICK', intensity: 0.8, confidence: 0.9 });
  }
  events.sort((a, b) => a.t - b.t);
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test', createdAt: '2026-01-01T00:00:00Z' },
    audio: { duration: duree, sampleRate: 48000, channels: 2 },
    tempo: { global: BPM, confidence: 1, map: [{ t: 0, bpm: BPM }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events,
    sections,
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}

/** Structure couplet/refrain/couplet : A, B, A. */
function abaSections(): Section[] {
  return [
    { t: 0, dur: 30, energy: 0.35, letter: 'A', confidence: 1 },
    { t: 30, dur: 30, energy: 0.85, letter: 'B', confidence: 1 },
    { t: 60, dur: 30, energy: 0.35, letter: 'A', confidence: 1 },
    { t: 90, dur: 30, energy: 0.85, letter: 'C', confidence: 1 },
  ];
}

function score(sections: Section[], duree = 120) {
  return buildSectionScore(buildMusicTimeline(doc(sections, duree)));
}

describe('SectionScore — la mémoire de mise en scène', () => {
  it('A et B ont des plans DIFFÉRENTS', () => {
    const s = score(abaSections());
    expect(s.shotAt(10).index).not.toBe(s.shotAt(40).index);
  });

  it('quand A revient, son plan revient avec elle', () => {
    // Le coeur du chantier. C'est aussi ce qui renverse le choix precedent,
    // ou l'instant de debut entrait dans le calcul et faisait qu'un refrain
    // revenu ne ressemblait jamais au precedent.
    const s = score(abaSections());
    const premierA = s.shotAt(10);
    const secondA = s.shotAt(70);
    expect(secondA.index).toBe(premierA.index);
    expect(secondA.offsetX).toBe(premierA.offsetX);
    expect(secondA.zoom).toBe(premierA.zoom);
  });

  it('une troisième identité obtient un troisième plan', () => {
    const s = score(abaSections());
    const plans = [s.shotAt(10).index, s.shotAt(40).index, s.shotAt(100).index];
    expect(new Set(plans).size).toBe(3);
    expect(s.distinctShots).toBe(3);
  });

  it('la première section entendue garde le cadre franc, même si l\'analyse la nomme « B »', () => {
    const s = score([
      { t: 0, dur: 30, energy: 0.5, letter: 'B', confidence: 1 },
      { t: 30, dur: 30, energy: 0.5, letter: 'A', confidence: 1 },
    ]);
    expect(s.shotAt(10)).toBe(NEUTRAL_SHOT);
    expect(s.shotAt(10).offsetX).toBe(0);
    expect(s.shotAt(10).zoom).toBe(1);
  });

  it('sans lettre de répétition, chaque section a son propre plan', () => {
    const s = score([
      { t: 0, dur: 30, energy: 0.5, confidence: 1 },
      { t: 30, dur: 30, energy: 0.5, confidence: 1 },
      { t: 60, dur: 30, energy: 0.5, confidence: 1 },
    ]);
    expect(s.distinctShots).toBe(3);
    expect(s.shotAt(10).index).not.toBe(s.shotAt(40).index);
  });

  it('au-delà de quatre identités, la table de plans se rejoue en boucle', () => {
    const sections: Section[] = Array.from({ length: 6 }, (_, i) => ({
      t: i * 20, dur: 20, energy: 0.5, letter: String.fromCharCode(65 + i), confidence: 1,
    }));
    const s = score(sections);
    expect(s.distinctShots).toBe(6);
    expect(s.shotAt(5).index).toBe(s.shotAt(85).index); // 5e identite -> plan 0
    expect(SHOTS.length).toBe(4);
  });
});

describe('SectionScore — coupes quantifiées', () => {
  it('une frontière à contretemps est ramenée sur le temps fort le plus proche', () => {
    // Temps forts toutes les 2 s. Frontiere a 30,4 -> ramenee a 30,0.
    const s = score([
      { t: 0, dur: 30.4, energy: 0.4, letter: 'A', confidence: 1 },
      { t: 30.4, dur: 30, energy: 0.8, letter: 'B', confidence: 1 },
    ]);
    expect(s.cuts[1]!.t).toBeCloseTo(30, 6);
  });

  it('...et vers l\'AVANT quand le temps fort suivant est plus proche', () => {
    const s = score([
      { t: 0, dur: 31.7, energy: 0.4, letter: 'A', confidence: 1 },
      { t: 31.7, dur: 30, energy: 0.8, letter: 'B', confidence: 1 },
    ]);
    expect(s.cuts[1]!.t).toBeCloseTo(32, 6);
  });

  it('la coupe est FRANCHE : le plan change d\'un pas de simulation à l\'autre', () => {
    const s = score(abaSections());
    const avant = s.shotAt(30 - 1 / 120);
    const apres = s.shotAt(30);
    expect(apres.index).not.toBe(avant.index);
  });

  it('sans temps fort dans la timeline, la frontière brute est gardée telle quelle', () => {
    // Mieux vaut une coupe non quantifiee qu'une coupe deplacee au hasard.
    const sansGrille: PmdiDocument = { ...doc(abaSections()), events: [] };
    const s = buildSectionScore(buildMusicTimeline(sansGrille));
    expect(s.cuts[1]!.t).toBeCloseTo(30, 6);
  });

  it('un morceau sans section du tout rend le plan neutre partout', () => {
    const s = score([]);
    expect(s.distinctShots).toBe(0);
    expect(s.shotAt(0)).toBe(NEUTRAL_SHOT);
    expect(s.shotAt(75)).toBe(NEUTRAL_SHOT);
  });
});

describe('SectionScore — bornes et Loi 1', () => {
  it('aucun plan ne dépasse le geste déjà en service (0,055 de décalage, 1,07 de zoom)', () => {
    // Ce chantier change QUELLE section recoit quel decalage, pas la force du
    // geste : `REFRAME` vaut 0,05 dans `VisualDirector` depuis le chantier 3
    // de la phase 2.
    for (const shot of SHOTS) {
      expect(Math.abs(shot.offsetX)).toBeLessThanOrEqual(0.055);
      expect(Math.abs(shot.offsetY)).toBeLessThanOrEqual(0.055);
      expect(shot.zoom).toBeGreaterThanOrEqual(1);
      expect(shot.zoom).toBeLessThanOrEqual(1.07);
    }
  });

  it('même instant → même plan, quel que soit le chemin', () => {
    const s = score(abaSections());
    for (const t of [0, 15, 29.9, 30, 61, 95]) expect(s.shotAt(t)).toBe(s.shotAt(t));
    const s2 = score(abaSections());
    for (const t of [0, 15, 29.9, 30, 61, 95]) expect(s2.shotAt(t).index).toBe(s.shotAt(t).index);
  });
});

describe('VisualDirector — la partition passe bien dans le budget', () => {
  function director(sections: Section[]) {
    const timeline = buildMusicTimeline(doc(sections));
    return { d: new VisualDirector(timeline), b: new StepContextBuilder(timeline, 1) };
  }

  it('le zoom du plan se MULTIPLIE à celui de la dramaturgie, jamais additionné', () => {
    const { d, b } = director(abaSections());
    const t = 40; // section B, hors montee : la poussee de dramaturgie est nulle
    const budget = d.update(b.build(t));
    const shot = d.shotAt(t)!;
    expect(budget.cameraZoom).toBeCloseTo(shot.zoom, 9);
  });

  it('le décalage du plan est bien dans la caméra, et la dérive lente s\'y ajoute', () => {
    const { d, b } = director(abaSections());
    const t = 40;
    const budget = d.update(b.build(t));
    const shot = d.shotAt(t)!;
    // La derive lente vaut au plus DRIFT_CALM (0,035) : le decalage total reste
    // a portee du plan, sans jamais l'annuler.
    expect(Math.abs(budget.cameraX - shot.offsetX)).toBeLessThanOrEqual(0.036);
  });

  it('le zoom reste dans les bornes du Renderer sur tout le morceau, partition comprise', () => {
    const { d, b } = director(abaSections());
    for (let t = 0; t < 120; t += 1 / 30) {
      const z = d.update(b.build(t)).cameraZoom;
      expect(z, `zoom à ${t.toFixed(2)}`).toBeGreaterThanOrEqual(1);
      expect(z, `zoom à ${t.toFixed(2)}`).toBeLessThanOrEqual(2);
    }
  });

  it('drapeau éteint : aucun plan, et le budget retombe sur l\'ancien recadrage', () => {
    const { d } = director(abaSections());
    if (SECTION_STAGING_V1) {
      expect(d.shotAt(10)).not.toBeNull();
    } else {
      expect(d.shotAt(10)).toBeNull();
    }
  });
});
