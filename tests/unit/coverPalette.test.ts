/**
 * Pochette : quantification, palette extraite, garantie de contraste
 * (docs/17_PHASE2_VISUELS.md §7.5, §9.2 — chantier 7).
 *
 * CE QUI REND CES TESTS PARTICULIERS
 * ----------------------------------
 * Une palette écrite à la main est relue par un humain avant d'être livrée ;
 * une palette EXTRAITE ne l'est jamais. Elle doit donc être correcte pour toute
 * image, y compris les cas dégénérés que personne ne pense à essayer : une
 * pochette entièrement noire, entièrement blanche, monochrome, transparente,
 * ou d'un seul pixel. Chacun de ces cas a son test ici, parce que chacun a une
 * réponse différente dans le code.
 *
 * §7.5 fixe la conduite à tenir et elle est vérifiée explicitement plus bas :
 * « corrige la luminance plutôt que de refuser ». AUCUNE image ne doit produire
 * une erreur.
 */

import { describe, expect, it } from 'vitest';
import { quantize } from '../../src/visual/palette/quantize';
import { paletteFromCover } from '../../src/visual/palette/coverPalette';
import { contrastRatio, ensureContrast, MIN_CONTRAST, relativeLuminance } from '../../src/visual/palette/contrast';
import type { Color } from '../../src/render/Renderer';

/** Construit une image RGBA à partir d'une fonction de pixel. */
function image(width: number, height: number, at: (i: number) => [number, number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const [r, g, b, a] = at(i);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
  }
  return out;
}

const OPAQUE = (rgb: [number, number, number]): [number, number, number, number] => [rgb[0], rgb[1], rgb[2], 255];

describe('quantize — coupe médiane', () => {
  it('sépare deux masses de couleur bien distinctes', () => {
    // Moitié rouge, moitié bleue. Les deux doivent ressortir.
    const img = image(64, 64, (i) => OPAQUE(i % 64 < 32 ? [220, 30, 30] : [30, 40, 220]));
    const colors = quantize(img, 4);
    expect(colors.length).toBeGreaterThanOrEqual(2);
    const hasRed = colors.some((c) => c.r > 150 && c.b < 100);
    const hasBlue = colors.some((c) => c.b > 150 && c.r < 100);
    expect(hasRed, 'rouge non extrait').toBe(true);
    expect(hasBlue, 'bleu non extrait').toBe(true);
  });

  it('ISOLE un petit accent vif sur un fond sombre', () => {
    // Le cas qui décide du choix d'algorithme : 98 % de noir, 2 % de rouge vif.
    // Un k-moyennes converge vers les masses et rendrait cinq nuances de noir.
    // La coupe médiane divise selon l'ÉTENDUE, donc elle isole le rouge dès la
    // première passe. C'est exactement la pochette typique — sombre, avec un
    // logo — et c'est l'accent qu'on veut en tirer.
    const img = image(64, 64, (i) => OPAQUE(i < 80 ? [235, 40, 60] : [8, 8, 12]));
    const colors = quantize(img, 8);
    const accent = colors.find((c) => c.r > 150);
    expect(accent, 'le petit accent vif a été noyé dans la dominante').toBeDefined();
  });

  it('trie de la couleur la plus peuplée à la moins peuplée', () => {
    const img = image(64, 64, (i) => OPAQUE(i < 3500 ? [10, 10, 10] : [240, 240, 240]));
    const colors = quantize(img, 2);
    expect(colors[0]!.r, 'la dominante doit venir en premier').toBeLessThan(colors[1]!.r);
  });

  it('IGNORE les pixels transparents', () => {
    // Un PNG à fond transparent porte souvent du noir sous l'alpha nul. Le
    // compter donnerait une dominante noire absente de l'image visible.
    const img = image(32, 32, (i) => (i < 900 ? [0, 0, 0, 0] : [200, 120, 40, 255]));
    const colors = quantize(img, 4);
    expect(colors.length).toBeGreaterThan(0);
    for (const c of colors) {
      expect(c.r + c.g + c.b, 'une couleur issue de pixels transparents est ressortie').toBeGreaterThan(100);
    }
  });

  it('résiste aux cas dégénérés', () => {
    expect(quantize(new Uint8ClampedArray(0), 8)).toEqual([]);
    expect(quantize(image(8, 8, () => [0, 0, 0, 0]), 8), 'entièrement transparente').toEqual([]);
    // Un seul pixel, et une image d'une seule couleur : pas d'exception, pas de
    // boucle infinie sur une boîte qu'on ne peut plus couper.
    expect(quantize(image(1, 1, () => OPAQUE([100, 100, 100])), 8).length).toBe(1);
    expect(quantize(image(16, 16, () => OPAQUE([70, 80, 90])), 8).length).toBeGreaterThan(0);
  });

  it('est DÉTERMINISTE : aucun tirage, donc rien à re-semer (Loi 1)', () => {
    const img = image(64, 64, (i) => OPAQUE([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256]));
    expect(quantize(img, 8)).toEqual(quantize(img, 8));
  });
});

describe('contraste WCAG', () => {
  it('les repères connus sont justes', () => {
    const white: Color = { r: 255, g: 255, b: 255, a: 1 };
    const black: Color = { r: 0, g: 0, b: 0, a: 1 };
    expect(relativeLuminance(white)).toBeCloseTo(1, 5);
    expect(relativeLuminance(black)).toBeCloseTo(0, 5);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 1);
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5);
  });

  it('ensureContrast éclaircit sur fond sombre et assombrit sur fond clair', () => {
    const darkBg: Color = { r: 12, g: 12, b: 16, a: 1 };
    const lightBg: Color = { r: 240, g: 240, b: 240, a: 1 };
    // Deux couleurs qui ÉCHOUENT réellement sur leur fond respectif. Une
    // première version prenait un gris moyen pour les deux : sur fond clair il
    // atteignait déjà 8,9:1, donc `ensureContrast` le rendait tel quel — le
    // test échouait alors que le code avait raison.
    const tooDarkForDark: Color = { r: 30, g: 30, b: 36, a: 1 };
    const tooLightForLight: Color = { r: 205, g: 205, b: 210, a: 1 };

    const onDark = ensureContrast(tooDarkForDark, darkBg);
    const onLight = ensureContrast(tooLightForLight, lightBg);
    expect(relativeLuminance(onDark), 'doit s\'éclaircir sur fond sombre').toBeGreaterThan(
      relativeLuminance(tooDarkForDark),
    );
    expect(relativeLuminance(onLight), 'doit s\'assombrir sur fond clair').toBeLessThan(
      relativeLuminance(tooLightForLight),
    );
    expect(contrastRatio(onDark, darkBg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrastRatio(onLight, lightBg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });

  it('ne touche PAS une couleur qui satisfait déjà le seuil', () => {
    const bg: Color = { r: 10, g: 10, b: 12, a: 1 };
    const bright: Color = { r: 250, g: 245, b: 240, a: 1 };
    expect(ensureContrast(bright, bg)).toBe(bright);
  });

  it('rend le meilleur effort quand le seuil est inatteignable', () => {
    // Un gris moyen n'atteint 4:1 ni avec du blanc ni avec du noir. Il faut
    // rendre quelque chose d'utilisable, pas lever ni boucler.
    const grey: Color = { r: 128, g: 128, b: 128, a: 1 };
    const out = ensureContrast({ r: 130, g: 130, b: 130, a: 1 }, grey);
    expect(Number.isFinite(out.r)).toBe(true);
    expect(out.r).toBeGreaterThanOrEqual(0);
    expect(out.r).toBeLessThanOrEqual(255);
  });
});

describe('paletteFromCover — aucune image ne doit être refusée (§7.5)', () => {
  const cases: ReadonlyArray<[string, Color[]]> = [
    ['pochette sombre typique', [
      { r: 12, g: 10, b: 18, a: 1 },
      { r: 40, g: 30, b: 60, a: 1 },
      { r: 220, g: 60, b: 90, a: 1 },
    ]],
    ['pochette claire', [
      { r: 240, g: 235, b: 225, a: 1 },
      { r: 200, g: 180, b: 140, a: 1 },
      { r: 90, g: 120, b: 200, a: 1 },
    ]],
    ['entièrement noire', [{ r: 0, g: 0, b: 0, a: 1 }]],
    ['entièrement blanche', [{ r: 255, g: 255, b: 255, a: 1 }]],
    ['monochrome grise', [
      { r: 90, g: 90, b: 90, a: 1 },
      { r: 140, g: 140, b: 140, a: 1 },
    ]],
    ['aucune couleur', []],
  ];

  for (const [nom, dominant] of cases) {
    it(`${nom} : produit une palette valide et lisible`, () => {
      const { palette, contrast } = paletteFromCover(dominant);

      // Toutes les composantes sont des couleurs réelles.
      for (const [key, c] of [
        ['bg[0]', palette.bg[0]],
        ['bg[1]', palette.bg[1]],
        ['primary', palette.primary],
        ['secondary', palette.secondary],
        ['accent', palette.accent],
        ['glow', palette.glow],
      ] as const) {
        for (const ch of [c.r, c.g, c.b] as const) {
          expect(Number.isFinite(ch), `${nom}/${key}`).toBe(true);
          expect(ch, `${nom}/${key}`).toBeGreaterThanOrEqual(0);
          expect(ch, `${nom}/${key}`).toBeLessThanOrEqual(255);
        }
      }

      // GARANTIE DE §9.2 : au moins 4:1 entre le fond et la couleur la plus
      // intense. C'est le critère que la palette extraite doit tenir sans
      // qu'aucun humain ne la relise.
      expect(contrast, `${nom} : contraste mesuré ${contrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrastRatio(palette.bg[1], palette.accent)).toBeGreaterThanOrEqual(MIN_CONTRAST * 0.95);

      // Le fond reste SOMBRE, y compris pour une pochette blanche : un fond
      // clair rendrait tout le reste du moteur illisible.
      expect(relativeLuminance(palette.bg[0]), `${nom} : fond trop clair`).toBeLessThan(0.12);

      // `temperature` est bornée aux deux extrémités et hors domaine.
      for (const e of [-1, 0, 0.5, 1, 2]) {
        const t = palette.temperature(e);
        expect(Number.isFinite(t.r), `${nom} : temperature(${e})`).toBe(true);
      }
    });
  }

  it('signale une image monochrome au lieu de la traiter comme colorée', () => {
    const gris = paletteFromCover([{ r: 100, g: 100, b: 100, a: 1 }]);
    const colore = paletteFromCover([
      { r: 20, g: 20, b: 30, a: 1 },
      { r: 230, g: 80, b: 40, a: 1 },
    ]);
    expect(gris.monochrome, 'gris uni non détecté').toBe(true);
    expect(colore.monochrome, 'image colorée signalée à tort comme monochrome').toBe(false);
  });

  it('l\'accent vient de la couleur la plus CHROMATIQUE, pas de la 2e plus peuplée', () => {
    // Sur une pochette sombre, le second rang de population est encore un gris.
    // C'est le logo vif qu'on veut, même s'il n'occupe que 2 % de l'image.
    const { palette } = paletteFromCover([
      { r: 10, g: 10, b: 12, a: 1 },
      { r: 45, g: 45, b: 48, a: 1 },
      { r: 240, g: 70, b: 30, a: 1 },
    ]);
    expect(palette.accent.r, 'accent terne : la couleur vive a été ignorée').toBeGreaterThan(palette.accent.b + 40);
  });

  it('est déterministe : mêmes couleurs, même palette (Loi 1)', () => {
    const dominant: Color[] = [
      { r: 18, g: 22, b: 40, a: 1 },
      { r: 120, g: 90, b: 60, a: 1 },
      { r: 200, g: 210, b: 80, a: 1 },
    ];
    const a = paletteFromCover(dominant, 'x');
    const b = paletteFromCover(dominant, 'x');
    expect(JSON.stringify({ ...a.palette, temperature: undefined })).toBe(
      JSON.stringify({ ...b.palette, temperature: undefined }),
    );
    expect(a.contrast).toBe(b.contrast);
  });
});
