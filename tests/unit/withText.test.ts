/**
 * Couche de texte et sa composition (docs/17_PHASE2_VISUELS.md §9.3 et §7.6,
 * chantier 8).
 *
 * Deux choses sont vérifiées ici, et la seconde est celle qui a déjà manqué
 * deux fois dans ce projet : que le texte atteigne l'APERÇU **et** l'EXPORT.
 * C'est le piège de l'Étape 25 pour les macros de couche, puis du chantier 7
 * pour la pochette — un défaut qui ne se voit sur aucune vignette, puisque
 * l'aperçu, lui, est correct.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MACRO_NAMES, STYLE_IDS, type PresetMacros, type StyleId } from '../../src/presets/schema';
import { applyLayerMacrosToScene } from '../../src/presets/layerMacros';
import { withText } from '../../src/visual/scene/withText';
import { withCover } from '../../src/visual/scene/withCover';
import { applyLayerBlends, framingFor } from '../../src/visual/scene/dramaFrame';
import type { Scene } from '../../src/visual/scene/Scene';
import { createPulseStyle } from '../../src/visual/styles/pulse/createPulseStyle';
import { createFieldStyle } from '../../src/visual/styles/field/createFieldStyle';
import { createSpectrumProStyle } from '../../src/visual/styles/spectrum-pro/createSpectrumProStyle';
import { createMonolithStyle } from '../../src/visual/styles/monolith/createMonolithStyle';
import { createIsoPulseStyle } from '../../src/visual/styles/iso-pulse/createIsoPulseStyle';
import { createChambreStyle } from '../../src/visual/styles/chambre/createChambreStyle';
import { createEclatsStyle } from '../../src/visual/styles/eclats/createEclatsStyle';
import { createAuroreStyle } from '../../src/visual/styles/aurore/createAuroreStyle';
import { defaultPalette } from '../../src/visual/palette/Palette';
import {
  normaliseTextConfig,
  textStructureKey,
  TEXT_ANIMATION_LABELS,
  type TextAnimationId,
  type TextConfig,
} from '../../src/visual/text/textConfig';
import { FakeRenderer, testViewport } from './testSupport/FakeRenderer';
import { makeSignals, makeStepBuilder } from './testSupport/stepContextFixture';

const FACTORIES: Readonly<Record<StyleId, () => Scene>> = {
  pulse: createPulseStyle,
  field: createFieldStyle,
  'spectrum-pro': createSpectrumProStyle,
  monolith: createMonolithStyle,
  'iso-pulse': createIsoPulseStyle,
  chambre: createChambreStyle,
  eclats: createEclatsStyle,
  aurore: createAuroreStyle,
};

const TEXTE = normaliseTextConfig({ text: 'MEL VEL', everyBars: 4, durationBars: 2 });

/**
 * Dessine la couche à une position en MESURES. 120 BPM en 4/4 : une mesure vaut
 * deux secondes, donc `bars` mesures valent `bars * 2` secondes.
 */
function drawAt(config: TextConfig, bars: number, signals = makeSignals()): FakeRenderer {
  const scene = withText(createPulseStyle(), config);
  const renderer = new FakeRenderer();
  scene.init({ renderer, palette: defaultPalette });
  const layer = scene.layers[scene.layers.length - 1]!;
  layer.update(makeStepBuilder().build(bars * 2), signals);
  const out = new FakeRenderer();
  layer.draw(out, testViewport);
  return out;
}

function spriteCalls(r: FakeRenderer): Extract<FakeRenderer['calls'][number], { type: 'drawSprite' }>[] {
  return r.calls.filter((c): c is Extract<typeof c, { type: 'drawSprite' }> => c.type === 'drawSprite');
}

/** Empreinte : positions, échelles et alphas de tous les sprites posés. */
function fingerprint(r: FakeRenderer): string {
  return spriteCalls(r)
    .map((c) => c.transforms.map((t) => `${t.x.toFixed(4)},${t.y.toFixed(4)},${t.scale.toFixed(4)},${t.alpha.toFixed(4)}`).join(';'))
    .join('|');
}

describe('withText — composition sur les huit styles', () => {
  it('ajoute la couche de texte EN DERNIER, quel que soit le style', () => {
    for (const id of STYLE_IDS) {
      const base = FACTORIES[id]();
      const avec = withText(base, TEXTE);
      expect(avec.layers.length, id).toBe(base.layers.length + 1);
      expect(avec.layers[avec.layers.length - 1]!.id, `${id} : le texte n'est pas la dernière couche`).toBe('text');
    }
  });

  it('rend la scène TELLE QUELLE sur un texte vide', () => {
    // Pas de couche inerte : le coût serait nul à l'image, mais le panneau debug
    // afficherait une couche `text` sur un projet qui n'en a pas.
    for (const id of STYLE_IDS) {
      const base = FACTORIES[id]();
      expect(withText(base, normaliseTextConfig({ text: '   ' })), id).toBe(base);
    }
  });

  it('n\'ajoute jamais deux fois la couche', () => {
    const once = withText(createPulseStyle(), TEXTE);
    expect(withText(once, TEXTE).layers.length).toBe(once.layers.length);
  });

  it('préserve `usesFeedback` du style d\'origine', () => {
    for (const id of STYLE_IDS) {
      const base = FACTORIES[id]();
      expect(withText(base, TEXTE).usesFeedback, id).toBe(base.usesFeedback);
    }
  });

  it('passe AU-DESSUS de la pochette quand les deux sont actifs', () => {
    // Un titre à moitié caché derrière une pochette ne se lit plus, alors qu'une
    // pochette partiellement recouverte reste une pochette.
    const scene = withText(withCover(createPulseStyle(), true), TEXTE);
    const ids = scene.layers.map((l) => l.id);
    expect(ids.indexOf('text')).toBeGreaterThan(ids.indexOf('coverArt'));
    expect(ids[ids.length - 1]).toBe('text');
  });
});

describe('TextLayer — ce qu\'elle dessine', () => {
  // Mesure 3,9 : fin du cycle de quatre mesures, animation TERMINÉE, texte posé.
  // À la mesure 4,0 exactement l'animation redémarre et le texte est invisible -
  // ce qui est correct, mais ne dit rien sur le nombre de sprites.
  it('pose UN sprite par glyphe, espaces exclus', () => {
    // « MEL VEL » : sept caractères, six glyphes - l'espace n'en produit pas.
    const calls = spriteCalls(drawAt(TEXTE, 3.9));
    expect(calls.length).toBe(6);
  });

  it('MUTUALISE les sprites entre glyphes identiques', () => {
    // « MEL VEL » : six glyphes, quatre caractères distincts (M, E, L, V).
    const calls = spriteCalls(drawAt(TEXTE, 3.9));
    expect(new Set(calls.map((c) => c.sprite)).size).toBe(4);
  });

  it('déclare la fusion NORMALE, pas additive', () => {
    // Du texte additif sur un fond clair s'éclaircit jusqu'au blanc : illisible.
    const scene = withText(createPulseStyle(), TEXTE);
    expect(scene.layers[scene.layers.length - 1]!.blend).toBe('normal');
  });

  it('ne dessine RIEN sur un texte vide', () => {
    const scene = withText(createPulseStyle(), TEXTE);
    const layer = scene.layers[scene.layers.length - 1]!;
    layer.params = { opacity: 0 };
    const renderer = new FakeRenderer();
    scene.init({ renderer, palette: defaultPalette });
    const out = new FakeRenderer();
    layer.draw(out, testViewport);
    expect(out.calls.length).toBe(0);
  });
});

describe('l\'animation est calée sur la GRILLE MUSICALE (§7.6)', () => {
  it('l\'image change entre le début et la fin de l\'animation', () => {
    // Le critère 11 de §12 appliqué au texte : une option qui ne change pas
    // l'image est une option morte.
    expect(fingerprint(drawAt(TEXTE, 0.2))).not.toBe(fingerprint(drawAt(TEXTE, 4)));
  });

  it('REJOUE toutes les `everyBars` mesures', () => {
    // Mesure 0,2 et mesure 4,2 sont au même point du cycle de 4 mesures :
    // l'image doit y être IDENTIQUE, sans quoi la période n'est pas tenue.
    expect(fingerprint(drawAt(TEXTE, 0.2))).toBe(fingerprint(drawAt(TEXTE, 4.2)));
    expect(fingerprint(drawAt(TEXTE, 0.2))).not.toBe(fingerprint(drawAt(TEXTE, 1.2)));
  });

  it('`everyBars: 0` ne joue QU\'UNE FOIS, au début', () => {
    const unique = normaliseTextConfig({ text: 'MEL VEL', everyBars: 0, durationBars: 2 });
    expect(fingerprint(drawAt(unique, 4)), 'le texte rejoue alors qu\'il ne devait jouer qu\'une fois').toBe(
      fingerprint(drawAt(unique, 40)),
    );
    expect(fingerprint(drawAt(unique, 0.2))).not.toBe(fingerprint(drawAt(unique, 4)));
  });

  it('les SEPT animations produisent des images distinctes à mi-course', () => {
    const ids = Object.keys(TEXT_ANIMATION_LABELS) as TextAnimationId[];
    const empreintes = ids.map((animation) =>
      fingerprint(drawAt(normaliseTextConfig({ text: 'MEL VEL', animation, everyBars: 4, durationBars: 2 }), 1)),
    );
    expect(new Set(empreintes).size, 'deux animations rendent exactement la même image').toBe(ids.length);
  });

  it('toutes les animations CONVERGENT vers la même image posée', () => {
    // Une fois l'animation finie, le texte doit être au même endroit quelle que
    // soit la manière dont il y est arrivé.
    const ids = Object.keys(TEXT_ANIMATION_LABELS) as TextAnimationId[];
    const posé = ids.map((animation) =>
      fingerprint(drawAt(normaliseTextConfig({ text: 'MEL VEL', animation, everyBars: 4, durationBars: 2 }), 3.9)),
    );
    expect(new Set(posé).size).toBe(1);
  });
});

describe('la couche RÉAGIT à la musique', () => {
  it('`tension` écarte les lettres', () => {
    const calme = drawAt(TEXTE, 3.9, makeSignals({ tension: 0 }));
    const tendu = drawAt(TEXTE, 3.9, makeSignals({ tension: 1 }));
    const spanOf = (r: FakeRenderer): number => {
      const xs = spriteCalls(r).map((c) => c.transforms[0]!.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spanOf(tendu)).toBeGreaterThan(spanOf(calme));
  });

  it('`impact` agrandit le texte, très peu', () => {
    const scaleOf = (r: FakeRenderer): number => spriteCalls(r)[0]!.transforms[0]!.scale;
    const repos = scaleOf(drawAt(TEXTE, 3.9, makeSignals({ impact: 0 })));
    const frappe = scaleOf(drawAt(TEXTE, 3.9, makeSignals({ impact: 1 })));
    expect(frappe).toBeGreaterThan(repos);
    // Un titre qui pompe est illisible : la borne haute compte plus que l'effet.
    expect(frappe / repos).toBeLessThan(1.05);
  });
});

describe('les cinq mises en page et les réglages changent l\'image', () => {
  it('chaque mise en page place le texte ailleurs', () => {
    const layouts = ['center', 'lower-third', 'diagonal', 'oversize', 'third'] as const;
    const empreintes = layouts.map((layout) =>
      fingerprint(drawAt(normaliseTextConfig({ text: 'MEL VEL', layout, animation: 'none' }), 3.9)),
    );
    expect(new Set(empreintes).size).toBe(layouts.length);
  });

  it('la clé structurelle distingue ce qui exige une reconstruction', () => {
    // `ui/App.ts` s'en sert pour décider s'il reconstruit la scène. Une clé
    // insensible à un champ laisserait des sprites périmés à l'écran.
    const base = normaliseTextConfig({ text: 'A' });
    expect(textStructureKey(base)).toBe(textStructureKey(normaliseTextConfig({ text: 'A' })));
    // Le texte est du champ LIBRE : avec un simple separateur, une saisie
    // pourrait fabriquer la cle d'une AUTRE configuration et la scene ne serait
    // pas reconstruite.
    expect(textStructureKey(normaliseTextConfig({ text: 'A center word' }))).not.toBe(
      textStructureKey(normaliseTextConfig({ text: 'A', layout: 'center', animation: 'word' })),
    );
    for (const patch of [
      { text: 'B' },
      { layout: 'third' as const },
      { animation: 'slice' as const },
      { family: 'mono' as const },
      { weight: 400 as const },
      { textCase: 'lower' as const },
      { color: 'accent' as const },
      { everyBars: 8 },
      { durationBars: 2 },
    ]) {
      expect(textStructureKey(normaliseTextConfig({ text: 'A', ...patch })), JSON.stringify(patch)).not.toBe(
        textStructureKey(base),
      );
    }
  });

  it('`durationBars` ne dépasse jamais `everyBars`', () => {
    // Sinon l'animation redémarrerait avant sa fin et le texte ne serait jamais
    // entièrement posé.
    const c = normaliseTextConfig({ text: 'A', everyBars: 4, durationBars: 99 });
    expect(c.durationBars).toBeLessThan(c.everyBars);
  });
});

describe('les couches d\'habillage survivent aux balayages indexés par STYLE', () => {
  // Deux fonctions parcourent TOUTES les couches et ecrasent leurs champs a
  // partir de tables indexees par style. La pochette et le texte n'appartenant a
  // aucun style, ils n'y figurent jamais - et se faisaient donc remettre a vide.
  it('`applyLayerBlends` ne casse pas la fusion NORMALE du texte', () => {
    // Sans l'exclusion, le texte redeviendrait additif au premier mouvement de
    // curseur de macro, et un titre additif sur fond clair vire au blanc.
    const scene = withText(withCover(createPulseStyle(), true), TEXTE);
    applyLayerBlends(scene, { centralGlow: 'screen' });
    const texte = scene.layers.find((l) => l.id === 'text')!;
    expect(texte.blend, 'la fusion declaree par la couche a ete ecrasee').toBe('normal');
    expect(scene.layers.find((l) => l.id === 'centralGlow')!.blend).toBe('screen');
  });

  it('`applyLayerMacrosToScene` ne vide pas les `params` du texte', () => {
    const scene = withText(createPulseStyle(), TEXTE);
    const texte = scene.layers.find((l) => l.id === 'text')!;
    texte.params = { size: 1.3, opacity: 0.8 };
    const macros = Object.fromEntries(MACRO_NAMES.map((n) => [n, 0.5])) as PresetMacros;
    applyLayerMacrosToScene(scene, macros, 'pulse');
    expect(texte.params, 'les reglages propres du texte ont ete effaces').toEqual({ size: 1.3, opacity: 0.8 });
  });
});

describe('le cadrage de variante est NEUTRALISÉ par un habillage', () => {
  // Mesure au navigateur : un titre centre a sa taille par defaut etait COUPE au
  // bord droit sur la majorite des graines, le centre du texte allant de -20 a
  // +125 px sur un cadre de 893 selon la variante tiree.
  const variante = { name: 'tiers gauche', offsetX: 0.17, offsetY: -0.05, zoom: 1.12 };

  it('une scène nue garde son cadrage', () => {
    expect(framingFor(createPulseStyle(), variante)).toBe(variante);
  });

  it('une scène avec TEXTE repasse au cadrage neutre', () => {
    expect(framingFor(withText(createPulseStyle(), TEXTE), variante)).toBeUndefined();
  });

  it('une scène avec POCHETTE aussi', () => {
    // Meme raison : une pochette a moitie hors cadre ne remplit plus sa
    // fonction. La regle porte sur les habillages, pas sur le texte seul.
    expect(framingFor(withCover(createPulseStyle(), true), variante)).toBeUndefined();
  });
});

describe('le texte atteint l\'APERÇU et l\'EXPORT', () => {
  it('les deux chemins composent la scène avec `withText`', () => {
    const app = readFileSync(join(process.cwd(), 'src/ui/App.ts'), 'utf-8');
    const occurrences = app.match(/withText\(/g) ?? [];
    expect(
      occurrences.length,
      'App.ts doit appeler withText DEUX fois : la boucle d\'aperçu et la fabrique passée à l\'export',
    ).toBeGreaterThanOrEqual(2);
  });

  it('le MÊME champ alimente le mode live (§9.3)', () => {
    // §9.3 : « `LiveConfig.content.slamText` existe [...] mais aucune interface
    // ne l'expose. Expose-le. » Un seul champ, deux moteurs : deux champs
    // separes auraient demande de choisir lequel fait foi.
    const app = readFileSync(join(process.cwd(), 'src/ui/App.ts'), 'utf-8');
    expect(app, 'le texte saisi n\'atteint pas le mode live').toContain('setSlamText(slamLinesFromText(');
    const panel = readFileSync(join(process.cwd(), 'src/ui/live/LiveVisualPanel.ts'), 'utf-8');
    expect(panel, 'le panneau live n\'expose pas setSlamText').toMatch(/setSlamText\(lines: readonly string\[\]\)/);
    const pipeline = readFileSync(join(process.cwd(), 'src/ui/live/render/LivePipeline.ts'), 'utf-8');
    // `sceneInited` remis a faux : sans ca, `TypeSlamScene.init` ne relirait
    // jamais la configuration et le texte ne changerait qu'au prochain
    // changement de scene.
    expect(pipeline).toMatch(/setSlamText\([\s\S]*?sceneInited = false/);
  });

  it('les deux chemins neutralisent le cadrage de la même façon', () => {
    // Sans cette ligne cote export, la video decadrerait le titre exactement
    // comme l'apercu le faisait avant ce chantier - et le defaut ne se verrait
    // sur aucune vignette.
    const app = readFileSync(join(process.cwd(), 'src/ui/App.ts'), 'utf-8');
    expect(app).toContain('framingFor(scene, currentVariant)');
    const pipeline = readFileSync(join(process.cwd(), 'src/export/ExportPipeline.ts'), 'utf-8');
    expect(pipeline).toContain('framingFor(scene, variant)');
  });
});
