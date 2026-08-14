/**
 * Normalisation des frappes par morceau (14/08/2026). Defaut signale par
 * Aaron : « le kick n'est pas tellement visible » sur un beat importe de Beat
 * Studio, compare a un beat venu d'ailleurs. Un export compresse sort ses
 * kicks a 0,51 la ou un morceau dynamique tape a 0,95, et tout le moteur
 * reagissait sur une echelle ABSOLUE.
 */
import { describe, expect, it } from 'vitest';
import {
  IMPULSE_NORMALISE_V1,
  NORMALISE_MAX,
  NORMALISE_MIN,
  NORMALISE_TARGET,
  normalisationFor,
} from '../../src/behaviour/impulseNormalisation';
import { BehaviourEngine } from '../../src/behaviour/BehaviourEngine';
import { defaultMapping } from '../../src/behaviour/mapping/defaults';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { StepContextBuilder } from '../../src/music/StepContext';
import type { MusicEvent, PmdiDocument } from '../../src/music/pmdi';

function doc(intensites: number[], type = 'KICK'): PmdiDocument {
  const events: MusicEvent[] = intensites.map((intensity, i) => ({
    t: i * 0.44, type, intensity, confidence: 0.9,
  }));
  return {
    pmdi: '1.0', source: { kind: 'analysis', generator: 'test', createdAt: '2026-01-01T00:00:00Z' },
    audio: { duration: Math.max(1, intensites.length * 0.44 + 1), sampleRate: 48000, channels: 2 },
    tempo: { global: 136, confidence: 1, map: [{ t: 0, bpm: 136 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] }, events,
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}
const tl = (d: PmdiDocument) => buildMusicTimeline(d);
const memeValeur = (v: number, n = 16) => new Array<number>(n).fill(v);

describe('normalisationFor — elle ne peut que MONTER', () => {
  it('un morceau deja dynamique n\'est pas touche : facteur exactement 1', () => {
    expect(normalisationFor(tl(doc(memeValeur(0.95))), ['KICK'])).toBe(1);
  });

  it('...et un morceau au-dela de la cible non plus : jamais d\'attenuation', () => {
    expect(normalisationFor(tl(doc(memeValeur(1.0))), ['KICK'])).toBe(NORMALISE_MIN);
  });

  it('un morceau compresse est releve jusqu\'a la cible', () => {
    const f = normalisationFor(tl(doc(memeValeur(0.51))), ['KICK']);
    expect(f).toBeCloseTo(NORMALISE_TARGET / 0.51, 6);
    expect(0.51 * f).toBeCloseTo(NORMALISE_TARGET, 6);
  });

  it('le relevement est PLAFONNE : un morceau sans frappe nette n\'est pas invente', () => {
    expect(normalisationFor(tl(doc(memeValeur(0.05))), ['KICK'])).toBe(NORMALISE_MAX);
  });
});

describe('normalisationFor — robustesse', () => {
  it('un echantillon trop maigre ne suffit pas a fixer une echelle', () => {
    expect(normalisationFor(tl(doc([0.4, 0.4, 0.4])), ['KICK'])).toBe(1);
  });

  it('une frappe aberrante isolee ne dicte PAS l\'echelle du morceau', () => {
    // 15 frappes a 0,50 et une seule a 1,0 : le 90e centile reste bas, donc le
    // morceau est bien releve. Avec un MAXIMUM au lieu d'un centile, cette
    // unique valeur aurait annule toute correction.
    const avecAberrante = normalisationFor(tl(doc([...memeValeur(0.5, 15), 1.0])), ['KICK']);
    expect(avecAberrante).toBeGreaterThan(1.5);
  });

  it('aucun evenement du type demande : facteur 1', () => {
    expect(normalisationFor(tl(doc(memeValeur(0.5))), ['SNARE'])).toBe(1);
    expect(normalisationFor(tl(doc(memeValeur(0.5))), [])).toBe(1);
  });

  it('les intensites nulles sont ignorees plutot que de tirer l\'echelle vers le bas', () => {
    const sansZeros = normalisationFor(tl(doc(memeValeur(0.6))), ['KICK']);
    const avecZeros = normalisationFor(tl(doc([...memeValeur(0.6), ...memeValeur(0, 8)])), ['KICK']);
    expect(avecZeros).toBeCloseTo(sansZeros, 6);
  });
});

describe('BehaviourEngine — la normalisation atteint bien le signal', () => {
  function impactMax(d: PmdiDocument): number {
    const timeline = buildMusicTimeline(d);
    const stepper = new StepContextBuilder(timeline, 1);
    const moteur = new BehaviourEngine(timeline, defaultMapping);
    let max = 0;
    for (let t = 0; t < d.audio.duration; t += 1 / 120) max = Math.max(max, moteur.update(stepper.build(t)).impact);
    return max;
  }

  it('un beat compresse atteint enfin le niveau d\'un beat dynamique', () => {
    if (!IMPULSE_NORMALISE_V1) return;
    const compresse = impactMax(doc(memeValeur(0.51)));
    expect(compresse, 'sans correction il plafonnerait a 0,51').toBeGreaterThan(0.85);
  });

  it('le seuil de la secousse d\'ecran (0,7) devient atteignable', () => {
    if (!IMPULSE_NORMALISE_V1) return;
    expect(impactMax(doc(memeValeur(0.51)))).toBeGreaterThan(0.7);
  });

  it('un morceau deja dynamique rend EXACTEMENT la meme chose qu\'avant', () => {
    // La promesse de surete : facteur 1, donc multiplication neutre.
    const d = doc(memeValeur(0.95));
    const moteur = new BehaviourEngine(buildMusicTimeline(d), defaultMapping);
    expect(moteur.normalisationOf('impact')).toBe(1);
    expect(impactMax(d)).toBeCloseTo(0.95, 6);
  });

  it('chaque signal a SA normalisation : le charley ne suit pas le kick', () => {
    if (!IMPULSE_NORMALISE_V1) return;
    const events: MusicEvent[] = [];
    for (let i = 0; i < 16; i++) {
      events.push({ t: i * 0.44, type: 'KICK', intensity: 0.5, confidence: 0.9 });
      events.push({ t: i * 0.44, type: 'HAT', intensity: 0.95, confidence: 0.9 });
    }
    const d = { ...doc([]), events, audio: { duration: 10, sampleRate: 48000, channels: 2 } };
    const moteur = new BehaviourEngine(buildMusicTimeline(d), defaultMapping);
    expect(moteur.normalisationOf('impact'), 'le kick est faible, il monte').toBeGreaterThan(1.5);
    expect(moteur.normalisationOf('tick'), 'le charley est deja fort, il ne bouge pas').toBe(1);
  });
});
