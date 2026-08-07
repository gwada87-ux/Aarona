/**
 * Correction manuelle de l'analyse (docs/17_PHASE2_VISUELS.md §7.8, chantier 10
 * lot E).
 *
 * « L'analyse se trompera parfois [...] Loi 3 le rend d'autant plus utile : les
 * morceaux à faible confiance sont exactement ceux qu'il faut pouvoir
 * rattraper. »
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MANUAL_DROP_TYPE,
  NO_CORRECTIONS,
  addDrop,
  applyCorrections,
  isNeutral,
  moveSectionStart,
  normaliseCorrections,
  removeDropNear,
} from '../../src/music/corrections';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { buildDemoDoc } from '../../src/ui/demoDoc';

const doc = buildDemoDoc(30);

describe('applyCorrections — fonction pure', () => {
  it('rend le document TEL QUEL quand il n\'y a rien à corriger', () => {
    // Identite d'objet : le cas courant ne doit pas recopier un document de
    // plusieurs megaoctets a chaque chargement.
    expect(applyCorrections(doc, NO_CORRECTIONS)).toBe(doc);
    expect(isNeutral(NO_CORRECTIONS)).toBe(true);
  });

  it('ne MUTE jamais le document d\'origine', () => {
    const avant = JSON.stringify(doc);
    applyCorrections(doc, { ...NO_CORRECTIONS, gridOffsetSec: 0.25, drops: [4] });
    expect(JSON.stringify(doc)).toBe(avant);
  });

  it('deux applications identiques donnent le même résultat', () => {
    const c = { ...NO_CORRECTIONS, gridOffsetSec: 0.1, drops: [3, 9] };
    expect(JSON.stringify(applyCorrections(doc, c))).toBe(JSON.stringify(applyCorrections(doc, c)));
  });
});

describe('décalage de la grille', () => {
  it('décale les temps, PAS les événements', () => {
    // Quand la grille est fausse, ce sont les temps qui tombent a cote : les
    // onsets viennent du signal audio et sont, eux, a leur place.
    const decale = applyCorrections(doc, { ...NO_CORRECTIONS, gridOffsetSec: 0.2 });
    expect(decale.tempo.map[0]!.t).toBeCloseTo(doc.tempo.map[0]!.t + 0.2, 6);
    expect(decale.events.length).toBe(doc.events.length);
    expect(decale.events[0]!.t).toBe(doc.events[0]!.t);
  });

  it('la phase de temps se décale VRAIMENT dans la timeline', () => {
    // C'est ce qui compte : un decalage qui ne bougerait pas `beatPhaseAt`
    // serait un curseur de plus qui ne change rien.
    const base = buildMusicTimeline(doc);
    const decale = buildMusicTimeline(applyCorrections(doc, { ...NO_CORRECTIONS, gridOffsetSec: 0.25 }));
    const t = 8;
    expect(decale.beatPhaseAt(t)).not.toBeCloseTo(base.beatPhaseAt(t), 3);
    // Et le decalage est bien celui demande : la phase a t+0,25 sur la grille
    // decalee vaut celle a t sur la grille d'origine.
    expect(decale.beatPhaseAt(t + 0.25)).toBeCloseTo(base.beatPhaseAt(t), 5);
  });

  it('ne renvoie jamais un instant négatif', () => {
    const decale = applyCorrections(doc, { ...NO_CORRECTIONS, gridOffsetSec: -5 });
    for (const p of decale.tempo.map) expect(p.t).toBeGreaterThanOrEqual(0);
    for (const p of decale.meter.map) expect(p.t).toBeGreaterThanOrEqual(0);
  });
});

describe('drops marqués à la main', () => {
  it('ajoute un ÉVÉNEMENT ordinaire, que `anticipate:DROP` trouve', () => {
    // Aucun code de signal a toucher : `tension` monte devant un drop manuel
    // exactement comme devant un drop detecte.
    // La demo porte deja des DROP detectes : le drop manuel s'ajoute a eux et
    // devient INDISCERNABLE, ce qui est exactement le but - aucun code de
    // signal a toucher, `tension` monte devant lui comme devant les autres.
    const avant = doc.events.filter((e) => e.type === MANUAL_DROP_TYPE).length;
    const corrige = applyCorrections(doc, addDrop(NO_CORRECTIONS, 12.5));
    const drops = corrige.events.filter((e) => e.type === MANUAL_DROP_TYPE);
    expect(drops.length).toBe(avant + 1);
    const manuel = drops.find((e) => e.t === 12.5);
    expect(manuel, 'le drop marqué doit être dans le document').toBeDefined();
    expect(manuel!.confidence, 'un humain l\'a posé : rien n\'est plus certain').toBe(1);
    expect(buildMusicTimeline(corrige).nextEventOfType(MANUAL_DROP_TYPE, 12.4)?.t).toBe(12.5);
  });

  it('les événements restent TRIÉS après insertion', () => {
    const corrige = applyCorrections(doc, { ...NO_CORRECTIONS, drops: [1, 15, 7] });
    for (let i = 1; i < corrige.events.length; i++) {
      expect(corrige.events[i]!.t).toBeGreaterThanOrEqual(corrige.events[i - 1]!.t);
    }
  });

  it('remarquer au même endroit REMPLACE, retirer enlève', () => {
    let c = addDrop(NO_CORRECTIONS, 10);
    c = addDrop(c, 10.1);
    expect(c.drops).toEqual([10.1]);
    expect(removeDropNear(c, 10.2).drops).toEqual([]);
    expect(removeDropNear(c, 30).drops, 'un clic loin de tout ne retire rien').toEqual([10.1]);
  });
});

describe('frontière de section déplacée', () => {
  it('déplace la section demandée et RETRIE', () => {
    // Deplacer une frontiere peut la faire passer devant la precedente, et tout
    // ce qui lit `sections()` suppose l'ordre chronologique.
    const sections = doc.sections ?? [];
    expect(sections.length, 'la démo doit avoir des sections').toBeGreaterThan(2);
    const corrige = applyCorrections(doc, moveSectionStart(NO_CORRECTIONS, 2, 0.5));
    const t = (corrige.sections ?? []).map((s) => s.t);
    expect(t).toEqual([...t].sort((a, b) => a - b));
    expect(t).toContain(0.5);
  });

  it('la timeline voit la nouvelle frontière', () => {
    const sections = doc.sections ?? [];
    const cible = sections[1]!;
    const nouveau = cible.t + 3;
    const tl = buildMusicTimeline(applyCorrections(doc, moveSectionStart(NO_CORRECTIONS, 1, nouveau)));
    expect(tl.sections().some((s) => Math.abs(s.t - nouveau) < 1e-9)).toBe(true);
  });
});

describe('normaliseCorrections — un projet abîmé ne bloque pas l\'ouverture', () => {
  it('écarte ce qui n\'a pas de forme', () => {
    const c = normaliseCorrections({
      gridOffsetSec: 'beaucoup',
      drops: [3, 'x', NaN, 1],
      sectionStarts: { 0: 2, '-1': 5, deux: 3, 1: 'x' },
    });
    expect(c.gridOffsetSec).toBe(0);
    expect(c.drops).toEqual([1, 3]);
    expect(c.sectionStarts).toEqual({ 0: 2 });
  });

  it('rend le neutre sur n\'importe quoi', () => {
    expect(normaliseCorrections(undefined)).toEqual(NO_CORRECTIONS);
    expect(normaliseCorrections('x')).toEqual(NO_CORRECTIONS);
  });
});

describe('les corrections atteignent le moteur, et l\'export d\'image fixe existe', () => {
  const app = readFileSync(join(process.cwd(), 'src/ui/App.ts'), 'utf-8');

  it('la timeline est construite depuis le document CORRIGÉ', () => {
    // Rien en aval ne sait qu'une correction existe : ni les signaux, ni les
    // couches, ni l'export. C'etait la seule facon d'eviter un « et si c'est
    // corrige ? » a chaque lecture de la grille.
    expect(app).toContain('const corrected = applyCorrections(doc, corrections)');
    expect(app).toContain('currentTimeline = buildMusicTimeline(corrected)');
  });

  it('le document BRUT est conservé, pour pouvoir annuler', () => {
    // On ne peut pas retirer un decalage de grille d'un document auquel on l'a
    // deja applique sans accumuler les arrondis.
    expect(app).toContain('rawDoc = doc;');
    expect(app).toContain('applyDocCore(rawDoc, lastWaveformPeaks, true)');
  });

  it('les corrections sont enregistrées dans `music`, pas dans `visual`', () => {
    expect(app).toContain('corrections: corrections as unknown as Record<string, unknown>');
    expect(app).toContain('normaliseCorrections(project.music.corrections)');
  });

  it('l\'image fixe partage la fabrique de scène de la VIDÉO', () => {
    // Deux fabriques auraient diverge, et l'image fixe aurait fini par ne plus
    // ressembler a la video du meme projet.
    expect(app).toContain('function buildExportScene()');
    expect(app).toContain('getStyleFactory: () => buildExportScene');
    expect(app).toContain('const scene = buildExportScene();');
  });

  it('l\'export en boucle PRÉ-ROULE la fin avant la première image', () => {
    // §7.12 le demande, et previent que ce ne sera pas tenable partout. Ce que
    // ca fait : la scene demarre dans l'etat ou elle finit, donc la couture ne
    // se voit plus. Ce que ca NE fait PAS : rendre la derniere image identique a
    // la premiere - les signaux viennent de la musique, et la musique de la
    // derniere seconde n'est pas celle de la premiere.
    const pipeline = readFileSync(join(process.cwd(), 'src/export/ExportPipeline.ts'), 'utf-8');
    expect(pipeline).toContain('LOOP_PREROLL_SEC');
    expect(pipeline).toMatch(/if \(config\.loop === true\)/);
    expect(pipeline, 'le pré-roll doit précéder la première image').toMatch(/LOOP_PREROLL_SEC[\s\S]{0,400}let simT = 0;/);
    const dialog = readFileSync(join(process.cwd(), 'src/ui/dialogs/ExportDialog.ts'), 'utf-8');
    expect(dialog).toContain('loop: this.loopCheckbox.checked');
  });

  it('l\'image fixe SIMULE avant de dessiner', () => {
    // Un `scene.draw` sur une scene fraiche rendrait un cadre vide : pools de
    // particules a zero, feedback noir.
    expect(app).toContain('STILL_PREROLL_SEC');
    expect(app).toMatch(/for \(let t = start; t < simT; t \+= FIXED_DT\)/);
  });
});
