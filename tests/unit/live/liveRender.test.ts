/**
 * Etape 2 : criteres §8.11 (palettes et conversion OKLCH) et invariants de
 * §3.1, §3.3 et §3.7 qui sont verifiables sans canvas.
 *
 * Ce qui n'est PAS teste ici est le couplage canvas lui-meme (bright pass,
 * cascade de flou, aberration, overlay) : `vitest` tourne en environnement
 * `node`, sans DOM. Meme situation que `Canvas2DRenderer` et `FlashLimiter`
 * du mode fichier, verifies au navigateur. La partie MATHEMATIQUE de chacun
 * de ces modules est en revanche extraite et testee.
 */

import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  hexToRgb,
  mixOklch,
  oklchToHex,
  oklchToRgb,
  rgbToOklch,
  type Oklch,
} from '../../../src/core/color/oklch';
import {
  MAX_HUE_MODULATION,
  PALETTES,
  PALETTE_ROLES,
  PaletteBook,
  paletteContrast,
} from '../../../src/ui/live/render/Palette';
import { FrameBudget, QUALITY_PROFILES } from '../../../src/ui/live/render/FrameBudget';
import { LayerBudget } from '../../../src/ui/live/render/LayerStack';
import { breathingTau, feedbackDecay } from '../../../src/ui/live/render/Feedback';
import { DEFAULT_LIVE_CONFIG } from '../../../src/ui/live/LiveConfig';

/**
 * Six valeurs de reference publiees pour Oklab/OKLCH (Ottosson). Ce sont les
 * primaires et secondaires sRGB, dont les coordonnees OKLCH sont connues :
 * elles verifient les DEUX matrices et la courbe de transfert, pas seulement
 * un aller-retour qui pourrait etre auto-coherent en etant faux.
 */
const REFERENCES: readonly { hex: string; oklch: Oklch }[] = [
  { hex: '#000000', oklch: { l: 0, c: 0, h: 0 } },
  { hex: '#ffffff', oklch: { l: 1, c: 0, h: 0 } },
  { hex: '#ff0000', oklch: { l: 0.62796, c: 0.25768, h: 29.234 } },
  { hex: '#00ff00', oklch: { l: 0.86644, c: 0.29483, h: 142.495 } },
  { hex: '#0000ff', oklch: { l: 0.45201, c: 0.31321, h: 264.052 } },
  { hex: '#808080', oklch: { l: 0.59987, c: 0, h: 0 } },
];

describe('OKLCH (§3.5)', () => {
  it('sRGB -> OKLCH sur les 6 valeurs de reference', () => {
    for (const ref of REFERENCES) {
      const rgb = hexToRgb(ref.hex);
      expect(rgb, ref.hex).not.toBeNull();
      const got = rgbToOklch(rgb!);
      expect(got.l, `${ref.hex} L`).toBeCloseTo(ref.oklch.l, 3);
      expect(got.c, `${ref.hex} C`).toBeCloseTo(ref.oklch.c, 3);
      if (ref.oklch.c > 0.01) expect(got.h, `${ref.hex} H`).toBeCloseTo(ref.oklch.h, 1);
    }
  });

  it('OKLCH -> sRGB reconstruit exactement les memes codes', () => {
    for (const ref of REFERENCES) {
      expect(oklchToHex(ref.oklch), ref.hex).toBe(ref.hex);
    }
  });

  it('aller-retour stable a 1/255 pres sur des couleurs quelconques', () => {
    const samples = ['#123456', '#8f7cff', '#ff9060', '#0b0b12', '#60ffc0', '#c0392b'];
    for (const hex of samples) {
      const rgb = hexToRgb(hex);
      expect(rgb).not.toBeNull();
      expect(oklchToHex(rgbToOklch(rgb!)), hex).toBe(hex);
    }
  });

  it('l interpolation de teinte prend le chemin le plus court', () => {
    // 350 -> 10 doit passer par 0, pas par 180 : sans ca un fondu
    // violet -> orange traverserait le vert.
    const mid = mixOklch({ l: 0.6, c: 0.2, h: 350 }, { l: 0.6, c: 0.2, h: 10 }, 0.5);
    expect(mid.h).toBeCloseTo(0, 6);
  });
});

describe('Palettes (§3.5, §8.11)', () => {
  it('exactement 8 palettes', () => {
    expect(PALETTES.length).toBe(8);
  });

  it('composition imposee : 2 froides, 2 chaudes, 2 bichromies, 1 monochrome, 1 heritage', () => {
    const count = (tag: string): number => PALETTES.filter((p) => p.tags.includes(tag as never)).length;
    expect(count('cold'), 'froides').toBeGreaterThanOrEqual(2);
    expect(count('warm'), 'chaudes').toBeGreaterThanOrEqual(2);
    expect(count('duotone'), 'bichromies').toBeGreaterThanOrEqual(2);
    expect(count('mono'), 'monochrome').toBe(1);
    expect(count('heritage'), 'continuite mode fichier').toBe(1);
  });

  it('rapport de luminance >= 4:1 entre fond et highlight', () => {
    for (const p of PALETTES) {
      const ratio = paletteContrast(p);
      expect(ratio, `${p.id} : ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4);
    }
  });

  it('le fond n est jamais un noir pur', () => {
    for (const p of PALETTES) {
      const bg = p.roles.background;
      expect(bg.l, `${p.id} clarte`).toBeGreaterThan(0.05);
      expect(bg.c, `${p.id} chroma - un fond neutre perd sa teinte dans les basses lumieres`).toBeGreaterThan(0.005);
      expect(oklchToHex(bg), p.id).not.toBe('#000000');
    }
  });

  it('la modulation de teinte declaree ne depasse jamais 40 degres', () => {
    for (const p of PALETTES) {
      expect(p.hueModulation, p.id).toBeLessThanOrEqual(MAX_HUE_MODULATION);
      expect(p.hueModulation, p.id).toBeGreaterThan(0);
    }
  });

  it('les 5 roles existent et sont ordonnes du plus sombre au plus clair', () => {
    for (const p of PALETTES) {
      for (const role of PALETTE_ROLES) expect(p.roles[role], `${p.id}.${role}`).toBeDefined();
      expect(p.roles.background.l, `${p.id} fond < secondaire`).toBeLessThan(p.roles.secondary.l);
      expect(p.roles.highlight.l, `${p.id} highlight > accent`).toBeGreaterThan(p.roles.accent.l);
    }
  });

  it('PaletteBook borne la modulation quoi qu on lui demande', () => {
    const book = new PaletteBook(0);
    const base = book.oklch('primary');
    // Une demande a +10 doit donner exactement la meme couleur qu a +1.
    expect(book.hexModulated('primary', 10)).toBe(book.hexModulated('primary', 1));
    const extreme = hexToRgb(book.hexModulated('primary', 1));
    expect(extreme).not.toBeNull();
    const shifted = rgbToOklch(extreme!);
    let delta = Math.abs(shifted.h - base.h);
    if (delta > 180) delta = 360 - delta;
    expect(delta, `deviation observee ${delta.toFixed(1)} deg`).toBeLessThanOrEqual(MAX_HUE_MODULATION + 1);
  });

  it('le fondu de palette part de la couleur AFFICHEE, pas de la cible', () => {
    const book = new PaletteBook(0);
    book.crossfadeTo(3, 1);
    book.update(0.5);
    const halfway = book.hex('primary');
    // Interrompre a mi-parcours ne doit pas produire de saut : le nouveau
    // fondu repart d'ou on en etait.
    book.crossfadeTo(5, 1);
    expect(book.hex('primary')).toBe(halfway);
  });

  it('gradientStops fournit au moins 4 arrets', () => {
    const book = new PaletteBook(0);
    const out: string[] = [];
    const stops = book.gradientStops('secondary', 'accent', out);
    expect(stops.length).toBeGreaterThanOrEqual(4);
    expect(new Set(stops).size, 'des arrets tous identiques donneraient une bande plate').toBeGreaterThan(1);
  });
});

describe('FrameBudget (§3.7)', () => {
  const perf = DEFAULT_LIVE_CONFIG.perf;

  function feed(budget: FrameBudget, count: number, deltaMs: number, from = 0): number {
    let t = from;
    for (let i = 0; i < count; i++) {
      t += deltaMs;
      budget.sample(t);
    }
    return t;
  }

  it('estime la periode de reference au lieu de supposer 16,7 ms', () => {
    for (const period of [16.7, 8.33, 6.94, 33.3]) {
      const budget = new FrameBudget(perf);
      feed(budget, perf.calibrationFrames + 2, period);
      expect(budget.calibrated).toBe(true);
      expect(budget.referencePeriodMs, `${period} ms`).toBeCloseTo(period, 1);
    }
  });

  it('descend d un niveau quand 8 trames sur 12 depassent 1,5 x la periode', () => {
    const budget = new FrameBudget(perf);
    let t = feed(budget, perf.calibrationFrames + 2, 16.7);
    expect(budget.level).toBe(3);
    t = feed(budget, perf.windowFrames, 16.7 * 2, t);
    expect(budget.level, 'une seule descente par fenetre').toBe(2);
  });

  /**
   * §8.10, seconde phrase : « Si une scene depasse 16,6 ms, `FrameBudget` doit
   * demontrer une descente a un niveau tenable en < 1 s (test automatise). »
   *
   * Les tests voisins verifient le MECANISME de descente (la regle 8 trames sur
   * 12) ; celui-ci verifie la GARANTIE TEMPORELLE, qui est ce que le critere
   * demande reellement. La difference n'est pas theorique : la calibration
   * consomme `calibrationFrames` trames avant que la moindre descente soit
   * possible, et une scene qui part deja lente au demarrage pourrait tenir plus
   * d'une seconde a 30 ms sans que le mecanisme soit en faute.
   *
   * « Tenable » = le niveau atteint tourne sous 16,6 ms. On le simule en
   * appliquant a chaque niveau le gain de la table de `QUALITY_PROFILES` : une
   * scene a 33 ms au niveau 3 tourne a 33 x (cout relatif du niveau).
   *
   * QUANTIFICATION VSYNC - sans elle le test est faux. Une premiere version
   * alimentait `sample()` avec le cout CPU brut et concluait qu'une scene a
   * 20 ms ne declenchait jamais de descente, la zone morte allant jusqu'a 1,5 x
   * la periode. Mais `sample()` recoit des horodatages de `requestAnimationFrame`,
   * pas des couts CPU : sur un ecran a 60 Hz ils sont QUANTIFIES en multiples de
   * 16,7 ms. Une scene a 20 ms ne produit jamais de trame a 20 ms, elle rate son
   * vsync et presente a 33,4. Le seuil de 1,5 x attrape donc exactement les
   * trames manquees, et l'echec initial etait un artefact du simulateur.
   */
  it('descend a un niveau tenable en moins d une seconde (§8.10)', () => {
    // Cout relatif mesure de chaque niveau, du plus lourd au plus leger.
    // Volontairement PESSIMISTE : si la descente suffit avec ces gains, elle
    // suffit avec les gains reels, qui sont meilleurs.
    const relativeCost = [0.35, 0.55, 0.78, 1];
    const VSYNC = 16.7;
    const present = (costMs: number): number => Math.max(1, Math.ceil(costMs / VSYNC)) * VSYNC;

    for (const slowMs of [20, 25, 33.4, 50]) {
      const budget = new FrameBudget(perf);
      // Calibration a 60 fps : la machine est saine, c'est la SCENE qui coute.
      let t = feed(budget, perf.calibrationFrames + 2, VSYNC);
      expect(budget.level).toBe(3);

      const start = t;
      let settledAt = -1;
      for (let i = 0; i < 600 && settledAt < 0; i++) {
        t += present(slowMs * relativeCost[budget.level]!);
        budget.sample(t);
        if (slowMs * relativeCost[budget.level]! <= 16.6) settledAt = t - start;
      }

      const reachable = slowMs * relativeCost[0]! <= 16.6;
      if (!reachable) {
        // 50 ms au niveau 3 fait encore 17,5 ms au niveau 0 : aucun niveau
        // n'est tenable, et le critere ne peut pas l'exiger. On verifie alors
        // que le budget est bien descendu jusqu'en bas, et vite.
        expect(budget.level, `${slowMs} ms : descente incomplete`).toBe(0);
        continue;
      }
      expect(settledAt, `${slowMs} ms : jamais redescendu sous 16,6 ms`).toBeGreaterThan(0);
      expect(settledAt, `${slowMs} ms : stabilise en ${Math.round(settledAt)} ms`).toBeLessThan(1000);
    }
  });

  it('remonte apres 90 trames rapides consecutives, jamais avant', () => {
    const budget = new FrameBudget(perf);
    let t = feed(budget, perf.calibrationFrames + 2, 16.7);
    t = feed(budget, perf.windowFrames, 40, t);
    expect(budget.level).toBe(2);
    // On compte les trames rapides EFFECTIVEMENT prises en compte, plutot que
    // de supposer combien le delai anti-rebond en absorbe : c'est le seuil de
    // 90 qu'on veut verifier, pas l'arithmetique du test.
    let framesToRise = -1;
    for (let i = 1; i <= 500 && framesToRise < 0; i++) {
      t += 10;
      const before = budget.level;
      budget.sample(t);
      if (budget.level !== before) framesToRise = i;
    }
    expect(framesToRise, 'remontee jamais declenchee').toBeGreaterThan(0);
    expect(budget.level).toBe(3);
    // Au minimum les 90 trames du compteur ; au plus ces 90 trames plus le
    // delai anti-rebond de 500 ms (50 trames a 10 ms) qui les precede. La
    // borne basse est ce qui compte : elle interdit une remontee prematuree.
    expect(framesToRise, `remontee au bout de ${framesToRise} trames`).toBeGreaterThanOrEqual(perf.goodFrames);
    expect(framesToRise).toBeLessThanOrEqual(perf.goodFrames + perf.qualityCooldownMs / 10);
  });

  it('la zone morte empeche toute oscillation', () => {
    const budget = new FrameBudget(perf);
    // 20 ms : au-dessus de 0,8 x 16,7 = 13,4 et en dessous de 1,5 x 16,7 = 25.
    let t = feed(budget, perf.calibrationFrames + 2, 16.7);
    t = feed(budget, 400, 20, t);
    expect(budget.level, 'aucun changement dans la zone morte').toBe(3);
  });

  it('une trame aberrante - retour d onglet, GC - ne degrade pas la qualite', () => {
    const budget = new FrameBudget(perf);
    let t = feed(budget, perf.calibrationFrames + 2, 16.7);
    for (let i = 0; i < perf.windowFrames; i++) {
      t += 2000;
      budget.sample(t);
    }
    expect(budget.level).toBe(3);
  });

  it('le gel suspend l adaptation', () => {
    const budget = new FrameBudget(perf);
    let t = feed(budget, perf.calibrationFrames + 2, 16.7);
    budget.freeze(t, 10000);
    t = feed(budget, perf.windowFrames * 3, 40, t);
    expect(budget.level, 'gele pendant une transition ou un resize').toBe(3);
  });

  it('les 4 profils degradent dans l ordre impose par §3.7', () => {
    expect(QUALITY_PROFILES.length).toBe(4);
    // aberration -> scanlines -> 2e echelle de bloom -> grain -> feedback
    expect(QUALITY_PROFILES[3]?.aberration).toBe(true);
    expect(QUALITY_PROFILES[2]?.aberration).toBe(false);
    expect(QUALITY_PROFILES[2]?.scanlines).toBe(false);
    expect(QUALITY_PROFILES[2]?.grain).toBe(true);
    expect(QUALITY_PROFILES[1]?.grain).toBe(false);
    expect(QUALITY_PROFILES[1]?.bloomScales).toBeLessThan(QUALITY_PROFILES[2]?.bloomScales ?? 0);
    expect(QUALITY_PROFILES[1]?.feedback).toBe(true);
    expect(QUALITY_PROFILES[0]?.feedback).toBe(false);
    // Budget de passes plein ecran : 10 / 6 / 3 / 3.
    expect(QUALITY_PROFILES[3]?.fullscreenBudget).toBe(10);
    expect(QUALITY_PROFILES[2]?.fullscreenBudget).toBe(6);
    expect(QUALITY_PROFILES[1]?.fullscreenBudget).toBe(3);
    // Plafonds de particules de §3.7.
    expect(QUALITY_PROFILES.map((p) => p.particleCap)).toEqual([600, 1500, 3000, 6000]);
  });
});

describe('Inventaire memoire des calques (§3.1)', () => {
  it('refuse de depasser le plafond', () => {
    const budget = new LayerBudget(120 * 1024 * 1024);
    // 1920 x 1080 x 4 = 8,29 Mo par calque plein cadre ; 120 Mo en tiennent 15.
    // Le pipeline en utilise 8 au maximum : la marge est reelle, mais un
    // ecran 4K a DPR 2 sans plafond de bitmap en demanderait 4 fois plus.
    let allocated = 0;
    while (budget.reserve(1920, 1080)) allocated++;
    expect(allocated, `${allocated} calques 1080p tiennent dans 120 Mo`).toBe(15);
    expect(budget.megabytes).toBeLessThanOrEqual(120);
    expect(budget.fits(1920, 1080)).toBe(false);
  });

  it('la liberation rend la place', () => {
    const budget = new LayerBudget(16 * 1024 * 1024);
    expect(budget.reserve(1024, 1024)).toBe(true);
    expect(budget.megabytes).toBeCloseTo(4, 5);
    budget.release(1024, 1024);
    expect(budget.megabytes).toBe(0);
  });
});

describe('Decroissance du feedback (§3.3)', () => {
  const r = DEFAULT_LIVE_CONFIG.render;

  it('la duree des trainees ne depend PAS du framerate', () => {
    // Un ecran 120 Hz fait deux fois plus de trames : pour une meme duree
    // reelle, le produit des facteurs doit etre le meme.
    const at60 = feedbackDecay(1 / 60, r.feedbackTauSec, r.feedbackKMin, r.feedbackKMax);
    const at120 = feedbackDecay(1 / 120, r.feedbackTauSec, r.feedbackKMin, r.feedbackKMax);
    expect(at120 * at120, `60 Hz ${at60.toFixed(4)} vs 120 Hz au carre`).toBeCloseTo(at60, 4);
  });

  it('reste borne dans [0.80, 0.94]', () => {
    for (const dt of [0.001, 1 / 240, 1 / 120, 1 / 60, 1 / 30, 0.5]) {
      const k = feedbackDecay(dt, r.feedbackTauSec, r.feedbackKMin, r.feedbackKMax);
      expect(k, `dt=${dt}`).toBeGreaterThanOrEqual(r.feedbackKMin);
      expect(k, `dt=${dt}`).toBeLessThanOrEqual(r.feedbackKMax);
    }
  });

  it('le plafond de mouvement reduit est plus bas que le plafond normal', () => {
    const normal = feedbackDecay(1 / 240, r.feedbackTauSec, r.feedbackKMin, r.feedbackKMax);
    const reduced = feedbackDecay(
      1 / 240,
      r.feedbackTauSec,
      r.feedbackKMin,
      DEFAULT_LIVE_CONFIG.safety.reducedFeedbackKMax,
    );
    expect(reduced).toBeLessThan(normal);
  });

  it('la respiration module tau autour de sa valeur de base sans jamais l annuler', () => {
    for (let phase = 0; phase < 1; phase += 0.05) {
      const tau = breathingTau(r.feedbackTauSec, phase, r.feedbackBreath);
      expect(tau, `barPhase=${phase.toFixed(2)}`).toBeGreaterThan(0);
    }
    expect(breathingTau(r.feedbackTauSec, 0, r.feedbackBreath)).toBeGreaterThan(
      breathingTau(r.feedbackTauSec, 0.5, r.feedbackBreath),
    );
  });
});

describe('Anti-divergence du feedback (§3.3)', () => {
  it('l injection ponderee par (1-k) converge, une injection constante diverge', () => {
    const r = DEFAULT_LIVE_CONFIG.render;
    const k = feedbackDecay(1 / 60, r.feedbackTauSec, r.feedbackKMin, r.feedbackKMax);
    const injection = 0.2;

    // Sans ponderation : etat stationnaire = injection / (1 - k).
    let naive = 0;
    for (let i = 0; i < 600; i++) naive = naive * k + injection;
    expect(naive, `sature a ${naive.toFixed(2)}, soit x${(1 / (1 - k)).toFixed(1)}`).toBeGreaterThan(1);

    // Avec ponderation : etat stationnaire = injection, quelle que soit k.
    let bounded = 0;
    for (let i = 0; i < 600; i++) bounded = bounded * k + (1 - k) * injection;
    expect(bounded).toBeCloseTo(injection, 6);
  });
});
