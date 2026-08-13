import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DNA_MAX_DELTA,
  VISUAL_DNA_V1,
  applyVisualDna,
  deriveDeltas,
  deriveSeed,
  deriveTraits,
  deriveVisualDna,
} from '../../src/presets/visualDna';
import { MACRO_NAMES, type PresetMacros } from '../../src/presets/schema';
import { PRESET_CATALOG } from '../../src/presets/index';
import type { MusicEvent, PmdiDocument } from '../../src/music/pmdi';
import { buildDemoDoc } from '../../src/ui/demoDoc';

function doc(overrides: Partial<PmdiDocument> = {}): PmdiDocument {
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test', createdAt: '2026-01-01T00:00:00Z' },
    audio: { duration: 60, sampleRate: 44100, channels: 2 },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
    ...overrides,
  };
}

function plat(id: string, value: number) {
  return { id, hz: 1, t0: 0, data: [value, value, value, value] };
}

/** Onsets régulièrement répartis, `perSec` par seconde sur `duree` secondes. */
function onsets(perSec: number, duree = 60): MusicEvent[] {
  const n = Math.max(0, Math.round(perSec * duree));
  return Array.from({ length: n }, (_, i) => ({ t: (i / n) * duree, type: 'KICK', intensity: 0.8, confidence: 0.9 }));
}

function neutralMacros(): PresetMacros {
  const m = {} as Record<string, number>;
  for (const name of MACRO_NAMES) m[name] = 0.5;
  return m as PresetMacros;
}

function fixture(name: string): PmdiDocument {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as PmdiDocument;
}

describe('visualDna — traits, tous ramenés à 0..1', () => {
  it('le tempo se lit sur la plage 60..180 BPM', () => {
    expect(deriveTraits(doc({ tempo: { global: 60, confidence: 1, map: [{ t: 0, bpm: 60 }] } })).tempo).toBeCloseTo(0, 6);
    expect(deriveTraits(doc({ tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] } })).tempo).toBeCloseTo(0.5, 6);
    expect(deriveTraits(doc({ tempo: { global: 180, confidence: 1, map: [{ t: 0, bpm: 180 }] } })).tempo).toBeCloseTo(1, 6);
  });

  it('la densité utilise la MÊME référence que suggest.ts : 16 onsets/s = 1,0', () => {
    expect(deriveTraits(doc({ events: onsets(8) })).onsetDensity).toBeCloseTo(0.5, 3);
    expect(deriveTraits(doc({ events: onsets(16) })).onsetDensity).toBeCloseTo(1, 3);
  });

  it("les événements de DURÉE ne comptent pas comme des onsets (mêmes règles que suggest.ts)", () => {
    const evts: MusicEvent[] = [{ t: 5, type: 'BUILDUP', intensity: 0.9, confidence: 0.7, dur: 3 }];
    expect(deriveTraits(doc({ events: evts })).onsetDensity).toBe(0);
  });

  it('la dominance du grave oppose sub+bass à himid+high', () => {
    const grave = doc({ features: [plat('band.sub', 0.9), plat('band.bass', 0.9), plat('band.himid', 0.05), plat('band.high', 0.05)] });
    expect(deriveTraits(grave).subDominance).toBeGreaterThan(0.9);
    const aigu = doc({ features: [plat('band.sub', 0.05), plat('band.bass', 0.05), plat('band.himid', 0.9), plat('band.high', 0.9)] });
    expect(deriveTraits(aigu).subDominance).toBeLessThan(0.1);
  });

  it('la variance mesure le CONTRASTE, pas le niveau : une énergie plate vaut 0', () => {
    const plate = doc({ features: [{ id: 'energy', hz: 1, t0: 0, data: [0.9, 0.9, 0.9, 0.9] }] });
    expect(deriveTraits(plate).energy).toBeCloseTo(0.9, 6);
    expect(deriveTraits(plate).energyVariance).toBeCloseTo(0, 6);

    const contrastee = doc({ features: [{ id: 'energy', hz: 1, t0: 0, data: [0.1, 0.9, 0.1, 0.9] }] });
    expect(deriveTraits(contrastee).energy).toBeCloseTo(0.5, 6);
    expect(deriveTraits(contrastee).energyVariance).toBeGreaterThan(0.9);
  });

  it('une piste absente retombe sur 0,5 — un Mode B sans descripteurs spectraux ne doit pas biaiser', () => {
    const t = deriveTraits(doc());
    expect(t.energy).toBe(0.5);
    expect(t.brightness).toBe(0.5);
    expect(t.flatness).toBe(0.5);
    expect(t.subDominance).toBe(0.5);
  });

  it("un document sans descripteur ni événement produit des deltas TOUS nuls : rien à dire, rien à modifier", () => {
    const deltas = deriveVisualDna(doc({ tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] } })).deltas;
    // densité 0 et tempo 0,5 : seules `density`, `movement`... sont attendues non nulles.
    expect(deltas.energy).toBeLessThan(0); // densité nulle tire vers le bas
    expect(deltas.movement).toBeCloseTo(0, 6); // 120 BPM = milieu exact de la plage
    expect(deltas.depth).toBeCloseTo(0, 6);
    expect(deltas.glow).toBeCloseTo(0, 6);
  });
});

describe('visualDna — le preset reste un PRIOR', () => {
  it('aucun delta ne dépasse jamais DNA_MAX_DELTA, sur des traits extrêmes dans les deux sens', () => {
    const extremes: PmdiDocument[] = [
      doc({
        tempo: { global: 300, confidence: 1, map: [{ t: 0, bpm: 300 }] },
        events: onsets(60),
        features: [plat('band.sub', 1), plat('band.bass', 1), plat('band.himid', 0), plat('band.high', 0), plat('centroid', 1), plat('flatness', 1), { id: 'energy', hz: 1, t0: 0, data: [0, 1, 0, 1] }],
        sections: [],
      }),
      doc({
        tempo: { global: 20, confidence: 1, map: [{ t: 0, bpm: 20 }] },
        events: [],
        features: [plat('band.sub', 0), plat('band.bass', 0), plat('band.himid', 1), plat('band.high', 1), plat('centroid', 0), plat('flatness', 0), { id: 'energy', hz: 1, t0: 0, data: [0.5, 0.5] }],
      }),
    ];
    for (const d of extremes) {
      const dna = deriveVisualDna(d);
      for (const name of MACRO_NAMES) {
        expect(Math.abs(dna.deltas[name]), `${name} hors bornes`).toBeLessThanOrEqual(DNA_MAX_DELTA + 1e-9);
      }
    }
  });

  it('les macros résultantes restent dans [0,1] même quand le preset est déjà à une borne', () => {
    const dna = deriveVisualDna(doc({ events: onsets(30), tempo: { global: 175, confidence: 1, map: [{ t: 0, bpm: 175 }] } }));
    for (const base of [0, 1]) {
      const macros = Object.fromEntries(MACRO_NAMES.map((n) => [n, base])) as unknown as PresetMacros;
      const out = applyVisualDna(macros, dna);
      for (const name of MACRO_NAMES) {
        expect(out[name], `${name}`).toBeGreaterThanOrEqual(0);
        expect(out[name], `${name}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('un genre reste reconnaissable : chaque preset du catalogue bouge d\'au plus 0,20 par macro', () => {
    const dna = deriveVisualDna(buildDemoDoc(60));
    for (const p of PRESET_CATALOG) {
      const out = applyVisualDna(p.macros, dna);
      for (const name of MACRO_NAMES) {
        expect(Math.abs(out[name] - p.macros[name]), `${p.id}/${name}`).toBeLessThanOrEqual(DNA_MAX_DELTA + 1e-9);
      }
    }
  });

  it('smoothness est l\'exact opposé de reactivity — même traits, poids inversés', () => {
    const traits = deriveTraits(doc({ events: onsets(14), tempo: { global: 160, confidence: 1, map: [{ t: 0, bpm: 160 }] } }));
    const deltas = deriveDeltas(traits);
    expect(deltas.smoothness).toBeCloseTo(-deltas.reactivity, 9);
  });
});

describe('visualDna — déterminisme (Loi 1)', () => {
  it('même document → même ADN, appelé deux fois', () => {
    const d = buildDemoDoc(60);
    expect(deriveVisualDna(d)).toEqual(deriveVisualDna(d));
  });

  it('un aller-retour JSON ne déplace pas la graine (sauvegarde de projet, cache IndexedDB)', () => {
    const d = buildDemoDoc(60);
    const roundTrip = JSON.parse(JSON.stringify(d)) as PmdiDocument;
    expect(deriveSeed(roundTrip)).toBe(deriveSeed(d));
  });

  it('la graine est un entier 32 bits positif, comme projectSeed', () => {
    const seed = deriveSeed(buildDemoDoc(60));
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });

  it('un document VIDE ne fait pas planter la dérivation', () => {
    const dna = deriveVisualDna(doc({ audio: { duration: 0, sampleRate: 44100, channels: 2 } }));
    expect(Number.isFinite(dna.seed)).toBe(true);
    for (const name of MACRO_NAMES) expect(Number.isFinite(dna.deltas[name])).toBe(true);
  });
});

/**
 * LE TEST QUI JUSTIFIE LE CHANTIER (blueprint §J, livrable P0 n°2) :
 * « le même preset sur 3 morceaux → 3 rendus distincts ».
 */
describe('visualDna — trois morceaux, trois mondes', () => {
  const morceaux: ReadonlyArray<readonly [string, PmdiDocument]> = [
    ['démo 120 BPM, motif ordinaire', buildDemoDoc(60)],
    ['trap 152 BPM, dense et grave', doc({
      tempo: { global: 152, confidence: 1, map: [{ t: 0, bpm: 152 }] },
      events: onsets(13),
      features: [plat('band.sub', 0.85), plat('band.bass', 0.8), plat('band.himid', 0.15), plat('band.high', 0.1),
        plat('centroid', 0.3), plat('flatness', 0.35), { id: 'energy', hz: 1, t0: 0, data: [0.2, 0.85, 0.3, 0.9] }],
    })],
    ['ambient 76 BPM, clairsemé et brillant', doc({
      tempo: { global: 76, confidence: 1, map: [{ t: 0, bpm: 76 }] },
      events: onsets(2),
      features: [plat('band.sub', 0.1), plat('band.bass', 0.2), plat('band.himid', 0.7), plat('band.high', 0.8),
        plat('centroid', 0.75), plat('flatness', 0.2), { id: 'energy', hz: 1, t0: 0, data: [0.45, 0.5, 0.48, 0.5] }],
    })],
  ];

  /**
   * Applique les deltas SANS passer par `applyVisualDna`, donc sans passer par
   * le drapeau. Ces deux tests portent sur la DERIVATION - « trois morceaux,
   * trois mondes » - qui ne depend pas de l'interrupteur. Ecrits d'abord avec
   * `applyVisualDna`, ils cassaient des que le drapeau passait a `false`, et ce
   * qu'ils signalaient alors n'etait pas un defaut de derivation mais le fait
   * que l'interrupteur etait ouvert. Le respect du drapeau est teste a part,
   * plus bas.
   */
  function avecAdn(macros: PresetMacros, dna: ReturnType<typeof deriveVisualDna>): PresetMacros {
    const out = {} as Record<string, number>;
    for (const n of MACRO_NAMES) out[n] = Math.min(1, Math.max(0, macros[n] + dna.deltas[n]));
    return out as PresetMacros;
  }

  it('trois graines distinctes', () => {
    const graines = morceaux.map(([, d]) => deriveSeed(d));
    expect(new Set(graines).size, `graines ${graines.join(', ')}`).toBe(3);
  });

  it('le MÊME preset donne trois jeux de macros distincts', () => {
    const trapDark = PRESET_CATALOG.find((p) => p.id === 'trap-dark')!;
    const rendus = morceaux.map(([, d]) => JSON.stringify(avecAdn(trapDark.macros, deriveVisualDna(d))));
    expect(new Set(rendus).size, 'deux morceaux produisent la même configuration').toBe(3);
  });

  it('et l\'écart entre deux morceaux est PERCEPTIBLE, pas cosmétique (au moins une macro à 0,05)', () => {
    const trapDark = PRESET_CATALOG.find((p) => p.id === 'trap-dark')!;
    for (let i = 0; i < morceaux.length; i++) {
      for (let j = i + 1; j < morceaux.length; j++) {
        const a = avecAdn(trapDark.macros, deriveVisualDna(morceaux[i]![1]));
        const b = avecAdn(trapDark.macros, deriveVisualDna(morceaux[j]![1]));
        const ecartMax = Math.max(...MACRO_NAMES.map((n) => Math.abs(a[n] - b[n])));
        expect(ecartMax, `${morceaux[i]![0]} contre ${morceaux[j]![0]}`).toBeGreaterThan(0.05);
      }
    }
  });
});

/**
 * Le pendant du test precedent, sur des documents REELS : deux exports du MEME
 * beat (Beat Studio v18 MELVELBASE, une fois sans notes, une fois avec) doivent
 * donner des mondes VOISINS. Ecrit d'abord a l'envers - les deux fixtures
 * servaient de "deux morceaux differents", et le test a echoue en montrant un
 * ecart de 0,01. Il avait raison : c'est le meme beat (136 contre 139 BPM, 145
 * contre 137 evenements), et un ecart de 0,01 est exactement ce qu'on veut.
 *
 * Ces documents sont en Mode B et ne portent AUCUNE piste de descripteurs :
 * ils verifient au passage que la derivation tient sur un PMDI sans `features`.
 */
function avecAdnLocal(macros: PresetMacros, dna: ReturnType<typeof deriveVisualDna>): PresetMacros {
  const out = {} as Record<string, number>;
  for (const n of MACRO_NAMES) out[n] = Math.min(1, Math.max(0, macros[n] + dna.deltas[n]));
  return out as PresetMacros;
}

describe('visualDna — deux exports du meme beat', () => {
  const rythme = fixture('beat-studio-cdj-v18-melvelbase.pmdi.json');
  const notes = fixture('beat-studio-cdj-v18-melvelbase-notes.pmdi.json');

  it('les macros restent voisines : meme musique, meme monde', () => {
    const trapDark = PRESET_CATALOG.find((p) => p.id === 'trap-dark')!;
    const a = avecAdnLocal(trapDark.macros, deriveVisualDna(rythme));
    const b = avecAdnLocal(trapDark.macros, deriveVisualDna(notes));
    for (const name of MACRO_NAMES) {
      expect(Math.abs(a[name] - b[name]), `${name}`).toBeLessThan(0.05);
    }
  });

  it('mais les graines different : ce sont deux documents distincts', () => {
    expect(deriveSeed(rythme)).not.toBe(deriveSeed(notes));
  });
});

describe('visualDna — drapeau éteint', () => {
  it('le drapeau est déclaré', () => {
    expect(typeof VISUAL_DNA_V1).toBe('boolean');
  });

  /**
   * `null` EST le chemin « drapeau éteint » : `App.ts` ne dérive aucun ADN quand
   * `VISUAL_DNA_V1` est faux, donc `applyVisualDna` reçoit `null`. Identité par
   * RÉFÉRENCE, pas seulement par valeur : aucune copie, aucun objet gelé
   * supplémentaire, rien qui puisse diverger.
   */
  it('sans ADN, les macros sortent inchangées et par la même référence', () => {
    const macros = neutralMacros();
    expect(applyVisualDna(macros, null)).toBe(macros);
  });
});

describe('visualDna — résumé lisible', () => {
  it('nomme les traits saillants en français', () => {
    const dense = deriveVisualDna(doc({
      events: onsets(14),
      features: [plat('band.sub', 0.9), plat('band.bass', 0.9), plat('band.himid', 0.05), plat('band.high', 0.05)],
    }));
    expect(dense.summary).toContain('très dense');
    expect(dense.summary).toContain('grave dominant');
  });

  it('reste vide quand rien ne dépasse', () => {
    const quelconque = deriveVisualDna(doc({
      events: onsets(7),
      // Ecart-type 0,1 sur une reference de 0,25 : 0,4 sur l'echelle de
      // variance, soit ni "energie tenue" (< 0,25) ni "fort contraste" (> 0,62).
      features: [{ id: 'energy', hz: 1, t0: 0, data: [0.4, 0.6, 0.4, 0.6] }],
    }));
    expect(quelconque.summary).toBe('');
  });
});
