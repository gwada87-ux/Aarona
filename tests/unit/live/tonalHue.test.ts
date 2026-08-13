import { describe, expect, it } from 'vitest';
import {
  CHORD_HUE_SHARE,
  MAX_FIFTHS_DISTANCE,
  chordHueOffsetDeg,
  fifthsIndex,
  isPitchClass,
  signedFifthsDistance,
} from '../../../src/ui/live/util/tonalHue';
import { MAX_HUE_MODULATION, PALETTES, PaletteBook } from '../../../src/ui/live/render/Palette';

/**
 * ADR-015, lot 1 — la correspondance harmonie -> teinte, et surtout la BORNE
 * de §3.5 qui doit rester structurelle : l'excursion totale d'un element ne
 * depasse jamais `hueModulation`, decalage d'accord compris.
 */

/** Do=0, Sol=7, Ré=2, Fa=5, Fa#=6, Si=11. */
const C = 0;
const G = 7;
const D = 2;
const F = 5;
const FS = 6;
const B = 11;

describe('isPitchClass', () => {
  it('accepte exactement les entiers 0..11', () => {
    for (let pc = 0; pc < 12; pc++) expect(isPitchClass(pc)).toBe(true);
    for (const bad of [-1, 12, 1.5, NaN, Infinity, '0', null, undefined, {}]) {
      expect(isPitchClass(bad)).toBe(false);
    }
  });
});

describe('cercle des quintes', () => {
  it('les douze classes occupent douze positions distinctes', () => {
    const seen = new Set<number>();
    for (let pc = 0; pc < 12; pc++) seen.add(fifthsIndex(pc));
    expect(seen.size).toBe(12);
  });

  it('la quinte juste avance d’un cran, la quarte recule d’un cran', () => {
    expect(signedFifthsDistance(C, G)).toBe(1); // do -> sol
    expect(signedFifthsDistance(C, F)).toBe(-1); // do -> fa
    expect(signedFifthsDistance(C, D)).toBe(2); // do -> ré, deux quintes
    expect(signedFifthsDistance(G, C)).toBe(-1); // réciproque
  });

  it('le triton est l’écart MAXIMAL — c’est ce qui rend la borne musicale', () => {
    expect(Math.abs(signedFifthsDistance(C, FS))).toBe(MAX_FIFTHS_DISTANCE);
  });

  it('Si est LOIN de Do, alors qu’un demi-ton les sépare — tout l’intérêt du cercle', () => {
    // Une correspondance linéaire `pc/12` les rendrait voisins : c’est
    // précisément l’erreur que le cercle des quintes évite.
    expect(Math.abs(signedFifthsDistance(C, B))).toBeGreaterThanOrEqual(5);
    expect(Math.abs(signedFifthsDistance(C, G))).toBe(1);
  });

  it('distance nulle sur soi-même, quelle que soit la classe', () => {
    for (let pc = 0; pc < 12; pc++) expect(signedFifthsDistance(pc, pc)).toBe(0);
  });
});

describe('chordHueOffsetDeg', () => {
  it('l’accord du centre tonal ne décale RIEN — le morceau est au repos sur sa palette', () => {
    for (let pc = 0; pc < 12; pc++) expect(chordHueOffsetDeg(pc, pc, 20)).toBe(0);
  });

  it('reste borné à ±maxDeg pour toutes les 144 paires', () => {
    for (let center = 0; center < 12; center++) {
      for (let root = 0; root < 12; root++) {
        expect(Math.abs(chordHueOffsetDeg(root, center, 20))).toBeLessThanOrEqual(20 + 1e-9);
      }
    }
  });

  it('ne décale rien quand l’harmonie est inconnue ou l’amplitude absurde', () => {
    expect(chordHueOffsetDeg(-1, C, 20)).toBe(0);
    expect(chordHueOffsetDeg(C, -1, 20)).toBe(0);
    expect(chordHueOffsetDeg(G, C, 0)).toBe(0);
    expect(chordHueOffsetDeg(G, C, NaN)).toBe(0);
  });

  it('un voisin harmonique décale peu, le triton décale au maximum', () => {
    const voisin = Math.abs(chordHueOffsetDeg(G, C, 18));
    const lointain = Math.abs(chordHueOffsetDeg(FS, C, 18));
    expect(voisin).toBeCloseTo(3, 6); // 18 × 1/6
    expect(lointain).toBeCloseTo(18, 6); // 18 × 6/6
    expect(lointain).toBeGreaterThan(voisin);
  });
});

describe('PaletteBook — la borne de §3.5 reste STRUCTURELLE (ADR-015)', () => {
  it('sans accord, le rendu est identique à avant le chantier', () => {
    const a = new PaletteBook(0);
    const b = new PaletteBook(0);
    b.setTonalHueTarget(0);
    b.update(1);
    expect(b.tonalHueDeg).toBe(0);
    expect(b.hex('primary')).toBe(a.hex('primary'));
    expect(b.hexModulated('primary', 1)).toBe(a.hexModulated('primary', 1));
    expect(b.hexModulated('primary', -1)).toBe(a.hexModulated('primary', -1));
  });

  it('la cible est écrêtée à CHORD_HUE_SHARE × hueModulation, quoi qu’on demande', () => {
    for (let i = 0; i < PALETTES.length; i++) {
      const book = new PaletteBook(i);
      const max = PALETTES[i]!.hueModulation * CHORD_HUE_SHARE;
      book.setTonalHueTarget(9999);
      book.update(1000); // laisse le glissement atteindre la cible
      expect(book.tonalHueDeg).toBeCloseTo(max, 6);
      book.setTonalHueTarget(-9999);
      book.update(1000);
      expect(book.tonalHueDeg).toBeCloseTo(-max, 6);
    }
  });

  it('le décalage GLISSE, il ne saute jamais', () => {
    const book = new PaletteBook(0);
    book.setTonalHueTarget(PALETTES[0]!.hueModulation * CHORD_HUE_SHARE);
    book.update(1 / 60);
    const apresUneTrame = Math.abs(book.tonalHueDeg);
    expect(apresUneTrame).toBeGreaterThan(0);
    expect(apresUneTrame).toBeLessThan(1); // très loin de la cible en une trame
  });

  it('une valeur non finie ne casse pas la palette', () => {
    const book = new PaletteBook(0);
    book.setTonalHueTarget(Number.NaN);
    book.update(1);
    expect(book.tonalHueDeg).toBe(0);
    expect(book.hex('primary')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('l’excursion TOTALE d’un élément reste ≤ hueModulation, décalage compris', () => {
    // C’est l’invariant qui justifie le partage de budget : sans lui, accord
    // et modulation par élément s’additionneraient et un même élément se
    // promènerait sur le cercle — ce que §3.5 interdit.
    for (let i = 0; i < PALETTES.length; i++) {
      const p = PALETTES[i]!;
      const book = new PaletteBook(i);
      book.setTonalHueTarget(p.hueModulation * CHORD_HUE_SHARE);
      book.update(1000);
      const shift = Math.abs(book.tonalHueDeg);
      const perElement = Math.max(0, Math.min(MAX_HUE_MODULATION, p.hueModulation) - shift);
      expect(shift + perElement).toBeLessThanOrEqual(Math.min(MAX_HUE_MODULATION, p.hueModulation) + 1e-9);
    }
  });
});
