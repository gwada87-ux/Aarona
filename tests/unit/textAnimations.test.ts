/**
 * Bibliothèque d'animations de texte (docs/17_PHASE2_VISUELS.md §7.6, chantier
 * 8).
 *
 * Les six animations demandées par §7.6 plus `none`, vérifiées sur ce qui les
 * distingue les unes des autres. Une animation qui n'anime rien serait une
 * option morte de plus — c'est le grief d'origine d'Aaron sur les presets, et il
 * vaut ici tout autant.
 */

import { describe, expect, it } from 'vitest';
import { TEXT_ANIMATION_LABELS, type TextAnimationId } from '../../src/visual/text/textConfig';
import {
  chromaSplit,
  createGlyphMotion,
  createStripMotion,
  evaluateGlyph,
  evaluateStrip,
  typewriterCursor,
  usesChroma,
  usesStrips,
} from '../../src/visual/text/textAnimations';

/**
 * Table `Record<TextAnimationId, …>` DÉLIBÉRÉE : ajouter une animation sans
 * l'inscrire ici ne compile pas. Même garde que `STYLE_LABELS` pour les styles.
 */
const ANIMATIONS = Object.keys(TEXT_ANIMATION_LABELS) as TextAnimationId[];

const STRIPS = 3;

describe('l\'invariant : à `progress === 1`, tout revient à l\'identité', () => {
  // Un décalage résiduel donnerait un texte légèrement de travers en
  // permanence, sans que rien ne bouge à l'écran pour l'expliquer - et le
  // symptôme serait attribué à la mise en page, pas à l'animation.
  it.each(ANIMATIONS)('%s : glyphe à l\'identité', (id) => {
    const m = createGlyphMotion();
    for (const order of [0, 3, 9]) {
      evaluateGlyph(id, 1, order, 10, order % 3, 3, m);
      expect({ ...m }, `${id} laisse un résidu sur le glyphe ${order}`).toEqual({ dx: 0, dy: 0, scale: 1, alpha: 1 });
    }
  });

  it.each(ANIMATIONS)('%s : tranche à l\'identité', (id) => {
    const s = createStripMotion();
    for (let k = 0; k < STRIPS; k++) {
      evaluateStrip(id, 1, k, STRIPS, s);
      expect({ ...s }, `${id} laisse un résidu sur la tranche ${k}`).toEqual({ dx: 0, dy: 0, alpha: 1 });
    }
  });

  it('aucun écart chromatique une fois posé', () => {
    for (const id of ANIMATIONS) expect(chromaSplit(id, 1), id).toBe(0);
  });
});

describe('chaque animation fait QUELQUE CHOSE au départ', () => {
  it('toutes sauf `none` s\'écartent de l\'identité à mi-course', () => {
    for (const id of ANIMATIONS) {
      const m = createGlyphMotion();
      const s = createStripMotion();
      let bouge = false;
      for (const p of [0, 0.25, 0.5, 0.75]) {
        for (const order of [0, 5, 9]) {
          evaluateGlyph(id, p, order, 10, order % 3, 3, m);
          if (m.dx !== 0 || m.dy !== 0 || m.scale !== 1 || m.alpha !== 1) bouge = true;
        }
        for (let k = 0; k < STRIPS; k++) {
          evaluateStrip(id, p, k, STRIPS, s);
          if (s.dx !== 0 || s.dy !== 0 || s.alpha !== 1) bouge = true;
        }
        if (chromaSplit(id, p) > 0) bouge = true;
      }
      expect(bouge, `${id} ne fait rien : option morte`).toBe(id !== 'none');
    }
  });
});

describe('`word` — entrée mot par mot', () => {
  it('le premier mot est en avance sur le dernier', () => {
    const premier = createGlyphMotion();
    const dernier = createGlyphMotion();
    evaluateGlyph('word', 0.35, 0, 12, 0, 4, premier);
    evaluateGlyph('word', 0.35, 11, 12, 3, 4, dernier);
    expect(premier.alpha).toBeGreaterThan(dernier.alpha);
  });

  it('le dernier mot est POSÉ avant la fin de la fenêtre', () => {
    // Sans réserve en fin de fenêtre, le dernier mot arriverait pile à
    // `progress = 1`, c'est-à-dire sans jamais être vu en mouvement.
    const m = createGlyphMotion();
    evaluateGlyph('word', 0.999, 11, 12, 3, 4, m);
    expect(m.alpha).toBeGreaterThan(0.98);
  });

  it('les glyphes d\'un MÊME mot bougent ensemble', () => {
    const a = createGlyphMotion();
    const b = createGlyphMotion();
    evaluateGlyph('word', 0.4, 0, 12, 1, 4, a);
    evaluateGlyph('word', 0.4, 5, 12, 1, 4, b);
    expect(a.alpha).toBe(b.alpha);
    expect(a.dy).toBe(b.dy);
  });
});

describe('`typewriter` — machine à écrire', () => {
  it('révèle les glyphes DANS L\'ORDRE', () => {
    const m = createGlyphMotion();
    const alphas: number[] = [];
    for (let i = 0; i < 8; i++) {
      evaluateGlyph('typewriter', 0.5, i, 8, 0, 1, m);
      alphas.push(m.alpha);
    }
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i]!, `le glyphe ${i} apparaît avant le ${i - 1}`).toBeLessThanOrEqual(alphas[i - 1]!);
    }
    expect(alphas[0]).toBe(1);
    expect(alphas[7]).toBe(0);
  });

  it('l\'apparition est FRANCHE, pas un fondu long', () => {
    // Un fondu long ferait lire « les lettres s'estompent », pas « on tape ».
    const m = createGlyphMotion();
    evaluateGlyph('typewriter', 0.5, 4, 8, 0, 1, m);
    const debut = m.alpha;
    evaluateGlyph('typewriter', 0.5 + 1 / 8, 4, 8, 0, 1, m);
    expect(debut).toBeLessThan(1);
    expect(m.alpha).toBe(1);
  });

  it('le curseur suit la frappe et DISPARAÎT une fois posé', () => {
    expect(typewriterCursor('typewriter', 0, 8)).toBe(0);
    expect(typewriterCursor('typewriter', 0.5, 8)).toBe(4);
    expect(typewriterCursor('typewriter', 1, 8), 'le curseur survit à la fin de la frappe').toBe(-1);
    expect(typewriterCursor('word', 0.5, 8), 'curseur affiché hors machine à écrire').toBe(-1);
    expect(typewriterCursor('typewriter', 0.5, 0)).toBe(-1);
  });
});

describe('`reveal` — révélation par masque', () => {
  it('la tranche CENTRALE ouvre, les extrêmes suivent', () => {
    const centre = createStripMotion();
    const bord = createStripMotion();
    evaluateStrip('reveal', 0.3, 1, STRIPS, centre);
    evaluateStrip('reveal', 0.3, 0, STRIPS, bord);
    expect(centre.alpha).toBeGreaterThan(bord.alpha);
  });

  it('chaque tranche vient de SON côté', () => {
    const haut = createStripMotion();
    const bas = createStripMotion();
    evaluateStrip('reveal', 0.2, 0, STRIPS, haut);
    evaluateStrip('reveal', 0.2, 2, STRIPS, bas);
    expect(Math.sign(haut.dy)).toBe(-Math.sign(bas.dy));
    // La tranche centrale n'a pas de côté : elle ne se déplace pas. Amplitude
    // plutôt que valeur signée, le produit par une distance nulle donnant `-0`
    // pour la moitié basse - numériquement égal à zéro, mais distinct pour
    // `Object.is`, sur lequel `toBe` s'appuie.
    const milieu = createStripMotion();
    evaluateStrip('reveal', 0.2, 1, STRIPS, milieu);
    expect(Math.abs(milieu.dy)).toBe(0);
  });

  it('le GLYPHE ne bouge pas : c\'est la tranche qui porte le geste', () => {
    // Si les deux bougeaient, ils se composeraient et la bande cesserait de
    // paraître fixe pendant qu'elle s'ouvre.
    const m = createGlyphMotion();
    evaluateGlyph('reveal', 0.3, 2, 8, 0, 1, m);
    expect({ ...m }).toEqual({ dx: 0, dy: 0, scale: 1, alpha: 1 });
  });
});

describe('`slice` — découpe en tranches', () => {
  it('les tranches partent en sens ALTERNÉ', () => {
    const s = createStripMotion();
    const signes: number[] = [];
    for (let k = 0; k < STRIPS; k++) {
      evaluateStrip('slice', 0.05, k, STRIPS, s);
      signes.push(Math.sign(s.dx));
    }
    expect(signes).toEqual([1, -1, 1]);
  });

  it('les tranches CONVERGENT au fil de l\'avancement', () => {
    const s = createStripMotion();
    evaluateStrip('slice', 0.1, 0, STRIPS, s);
    const tot = Math.abs(s.dx);
    evaluateStrip('slice', 0.7, 0, STRIPS, s);
    expect(Math.abs(s.dx)).toBeLessThan(tot);
  });
});

describe('`scale` et `rgb`', () => {
  it('`scale` part PETIT et dépasse avant de se poser', () => {
    const m = createGlyphMotion();
    evaluateGlyph('scale', 0, 0, 4, 0, 1, m);
    expect(m.scale).toBeLessThan(0.5);
    let maxScale = 0;
    for (let p = 0; p <= 1; p += 0.02) {
      evaluateGlyph('scale', p, 0, 4, 0, 1, m);
      maxScale = Math.max(maxScale, m.scale);
    }
    expect(maxScale, 'aucun dépassement : le mot « dépassement » est dans le nom').toBeGreaterThan(1);
  });

  it('`rgb` écarte ses copies puis les referme', () => {
    expect(chromaSplit('rgb', 0)).toBeGreaterThan(0.1);
    expect(chromaSplit('rgb', 0.5)).toBeLessThan(chromaSplit('rgb', 0));
    expect(chromaSplit('rgb', 1)).toBe(0);
    expect(chromaSplit('word', 0), 'écart chromatique hors décalage RVB').toBe(0);
  });
});

describe('les ressources ne sont construites que pour qui en a besoin', () => {
  it('seules `reveal` et `slice` demandent les tranches', () => {
    // Trois sprites par glyphe au lieu d'un : les construire pour les cinq
    // autres animations serait payer la mémoire d'un effet qu'elles n'utilisent
    // pas.
    const avec = ANIMATIONS.filter(usesStrips);
    expect(avec.sort()).toEqual(['reveal', 'slice']);
  });

  it('seule `rgb` demande les copies colorées', () => {
    expect(ANIMATIONS.filter(usesChroma)).toEqual(['rgb']);
  });
});
