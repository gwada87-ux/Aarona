/**
 * Mise en page du texte (docs/17_PHASE2_VISUELS.md §9.3, chantier 8).
 *
 * Le test central est celui de la Loi 4 : les mêmes coordonnées normalisées
 * doivent tomber dans la zone sûre en 16:9, 9:16 ET 1:1, SANS une seule ligne
 * conditionnelle sur le format. C'est aussi ce qui distingue cette couche des
 * précédentes — elle est la seule, avec la pochette, à porter de l'information,
 * donc la seule dont une sortie de cadre est une perte sèche.
 */

import { describe, expect, it } from 'vitest';
import { safeAreaFor, safeRect, NO_SAFE_AREA } from '../../src/render/safeArea';
import { MAX_GLYPHS } from '../../src/visual/text/textConfig';
import { layoutInto, planText, type TextPlan } from '../../src/visual/text/textLayout';
import type { TextLayoutId } from '../../src/visual/text/textConfig';

/** Avance uniforme : la mesure réelle appartient au navigateur, pas à ce test. */
const ADVANCE = 0.62;

function advancesFor(plan: TextPlan): Float32Array {
  return new Float32Array(plan.glyphs.length).fill(ADVANCE);
}

function run(
  text: string,
  layout: TextLayoutId,
  aspect: number,
  safe = NO_SAFE_AREA,
  sizeScale = 1,
  tracking = 0.02,
): { plan: TextPlan; xs: Float32Array; ys: Float32Array; fontNorm: number; count: number } {
  const plan = planText(text, 'upper');
  const xs = new Float32Array(plan.glyphs.length);
  const ys = new Float32Array(plan.glyphs.length);
  const res = layoutInto(plan, advancesFor(plan), 0.3, { layout, aspect, safe, sizeScale, tracking }, xs, ys);
  return { plan, xs, ys, ...res };
}

describe('planText — découpage', () => {
  it('ignore les espaces mais compte les mots', () => {
    const plan = planText('MEL VEL BASE', 'upper');
    // Aucun glyphe pour un espace : un sprite vide serait un `drawImage` par
    // image pour rien.
    expect(plan.glyphs.map((g) => g.char).join('')).toBe('MELVELBASE');
    expect(plan.wordCount).toBe(3);
    expect(plan.lineCount).toBe(1);
  });

  it('coupe les mots aux fins de ligne', () => {
    // Sans cette coupure, le dernier mot d'une ligne et le premier de la
    // suivante entreraient ENSEMBLE dans l'animation mot par mot.
    const plan = planText('UN\nDEUX', 'upper');
    expect(plan.lineCount).toBe(2);
    expect(plan.wordCount).toBe(2);
    expect(plan.glyphs.find((g) => g.lineIndex === 1)!.wordIndex).toBe(1);
  });

  it('applique la casse', () => {
    expect(planText('Titre', 'upper').glyphs.map((g) => g.char).join('')).toBe('TITRE');
    expect(planText('Titre', 'lower').glyphs.map((g) => g.char).join('')).toBe('titre');
    expect(planText('Titre', 'none').glyphs.map((g) => g.char).join('')).toBe('Titre');
  });

  it('tronque au-delà de MAX_GLYPHS et le SIGNALE', () => {
    // Tronquer en silence donnerait un texte amputé sans explication ; c'est
    // l'interface qui doit le dire.
    const plan = planText('X'.repeat(MAX_GLYPHS + 20), 'none');
    expect(plan.glyphs.length).toBe(MAX_GLYPHS);
    expect(plan.truncated).toBe(true);
    expect(planText('COURT', 'none').truncated).toBe(false);
  });

  it('rend un plan VIDE sur un texte vide, sans lever', () => {
    const plan = planText('', 'upper');
    expect(plan.glyphs.length).toBe(0);
    const res = layoutInto(plan, new Float32Array(0), 0.3, {
      layout: 'center',
      aspect: 1,
      safe: NO_SAFE_AREA,
      sizeScale: 1,
      tracking: 0,
    }, new Float32Array(0), new Float32Array(0));
    expect(res.count).toBe(0);
  });
});

describe('Loi 4 — la zone sûre est tenue dans les trois formats', () => {
  const FORMATS: readonly { readonly name: string; readonly w: number; readonly h: number }[] = [
    { name: '16:9', w: 1920, h: 1080 },
    { name: '9:16', w: 1080, h: 1920 },
    { name: '1:1', w: 1080, h: 1080 },
  ];
  // `oversize` est exclue VOLONTAIREMENT : §9.3 la décrit comme « très gros
  // débordant du cadre ». La faire tenir dans la zone sûre lui retirerait son
  // objet. Un test dédié vérifie qu'elle déborde bel et bien.
  const LAYOUTS: readonly Exclude<TextLayoutId, 'oversize'>[] = ['center', 'lower-third', 'diagonal', 'third'];

  const TEXTS = ['LIVE', 'MELVELBASE', 'DEUX MOTS\nSUR DEUX LIGNES'];

  for (const format of FORMATS) {
    for (const layout of LAYOUTS) {
      for (const text of TEXTS) {
        it(`${format.name} / ${layout} / "${text.replace('\n', ' | ')}"`, () => {
          const aspect = format.w / format.h;
          const safe = safeAreaFor(format.w, format.h);
          const { plan, xs, ys, fontNorm, count } = run(text, layout, aspect, safe);
          const frame = safeRect(aspect, safe);
          expect(count).toBeGreaterThan(0);
          expect(fontNorm).toBeGreaterThan(0);

          for (let i = 0; i < count; i++) {
            // Boîte d'em du glyphe, pas seulement son centre : un centre dans le
            // cadre avec la moitié du glyphe dehors resterait illisible.
            const halfW = (ADVANCE * fontNorm) / 2;
            const halfH = fontNorm / 2;
            const label = `${plan.glyphs[i]!.char} (${i})`;
            expect(xs[i]! - halfW, `${label} sort à gauche`).toBeGreaterThanOrEqual(frame.left - 1e-6);
            expect(xs[i]! + halfW, `${label} sort à droite`).toBeLessThanOrEqual(frame.right + 1e-6);
            expect(ys[i]! - halfH, `${label} sort en bas`).toBeGreaterThanOrEqual(frame.bottom - 1e-6);
            expect(ys[i]! + halfH, `${label} sort en haut`).toBeLessThanOrEqual(frame.top + 1e-6);
          }
        });
      }
    }
  }

  it('`oversize` DÉBORDE, c\'est son objet', () => {
    const aspect = 16 / 9;
    const { xs, fontNorm, count } = run('OVERSIZE', 'oversize', aspect);
    const frame = safeRect(aspect, NO_SAFE_AREA);
    let widest = 0;
    for (let i = 0; i < count; i++) widest = Math.max(widest, Math.abs(xs[i]!) + (ADVANCE * fontNorm) / 2);
    expect(widest).toBeGreaterThan(frame.right);
  });
});

describe('les cinq mises en page produisent des positions DIFFÉRENTES', () => {
  // Le grief d'origine d'Aaron - « les presets ne changent rien » - vaut pour
  // tout ce qui est offert au choix : une mise en page qui ne déplace rien est
  // une option morte de plus.
  it('aucune paire de mises en page ne donne la même position', () => {
    const layouts: TextLayoutId[] = ['center', 'lower-third', 'diagonal', 'oversize', 'third'];
    const signatures = layouts.map((layout) => {
      const { xs, ys, fontNorm } = run('DEUX MOTS', layout, 16 / 9, safeAreaFor(1920, 1080));
      return `${fontNorm.toFixed(4)}|${Array.from(xs).map((v) => v.toFixed(4)).join(',')}|${Array.from(ys)
        .map((v) => v.toFixed(4))
        .join(',')}`;
    });
    expect(new Set(signatures).size, 'deux mises en page rendent exactement la même image').toBe(layouts.length);
  });

  it('`diagonal` décale chaque ligne vers la droite', () => {
    const { plan, xs, count } = run('UN\nDEUX\nTROIS', 'diagonal', 16 / 9);
    const firstOfLine = [0, 1, 2].map((l) => {
      for (let i = 0; i < count; i++) if (plan.glyphs[i]!.lineIndex === l) return xs[i]!;
      return NaN;
    });
    expect(firstOfLine[1]!).toBeGreaterThan(firstOfLine[0]!);
    expect(firstOfLine[2]!).toBeGreaterThan(firstOfLine[1]!);
  });
});

describe('les réglages continus agissent', () => {
  it('`tracking` élargit le texte — c\'est le canal de `tension`', () => {
    const serré = run('TENSION', 'center', 16 / 9, NO_SAFE_AREA, 1, 0);
    const large = run('TENSION', 'center', 16 / 9, NO_SAFE_AREA, 1, 0.13);
    const spanOf = (r: ReturnType<typeof run>): number => r.xs[r.count - 1]! - r.xs[0]!;
    expect(spanOf(large)).toBeGreaterThan(spanOf(serré));
  });

  it('`sizeScale` agrandit la police', () => {
    expect(run('GROS', 'center', 16 / 9, NO_SAFE_AREA, 1.4).fontNorm).toBeGreaterThan(
      run('GROS', 'center', 16 / 9, NO_SAFE_AREA, 1).fontNorm,
    );
  });

  it('le plafond de HAUTEUR rétrécit un texte de plusieurs lignes', () => {
    // Sans lui, cinq lignes courtes seraient dimensionnées sur leur largeur et
    // sortiraient du cadre par le haut et par le bas.
    const une = run('AB', 'center', 16 / 9);
    const cinq = run('AB\nAB\nAB\nAB\nAB', 'center', 16 / 9);
    expect(cinq.fontNorm).toBeLessThan(une.fontNorm);
  });
});
