import { describe, expect, it } from 'vitest';
import { buildMusicTimeline } from '../../src/music/MusicTimeline';
import { buildDemoDoc } from '../../src/ui/demoDoc';
import { BehaviourEngine } from '../../src/behaviour/BehaviourEngine';
import { StepContextBuilder } from '../../src/music/StepContext';
import { defaultMapping } from '../../src/behaviour/mapping/defaults';
import { PRESET_CATALOG } from '../../src/presets/index';
import { validatePreset } from '../../src/presets/schema';
import { LFO_WAVEFORMS } from '../../src/behaviour/signals/Lfo';
import type { PmdiDocument } from '../../src/music/pmdi';

/**
 * Audit des quatre familles de `MappingSchema`, demandé après le correctif des
 * courbes d'anticipation. Même famille de défaut : un NOM écrit dans du JSON
 * qui doit désigner quelque chose d'existant à l'exécution.
 */

function erreurs(p: unknown): string {
  const r = validatePreset(p);
  return r.ok ? '' : r.errors.join(' | ');
}

const base = () => JSON.parse(JSON.stringify(PRESET_CATALOG[0]!));

/** Maximum atteint par chaque signal sur toute la durée. */
function maximaSignaux(doc: PmdiDocument, secondes: number): Record<string, number> {
  const timeline = buildMusicTimeline(doc);
  const engine = new BehaviourEngine(timeline, defaultMapping);
  const stepper = new StepContextBuilder(timeline, 1);
  const max: Record<string, number> = {};
  for (let t = 0; t < secondes; t += 1 / 120) {
    const s = engine.update(stepper.build(t)) as unknown as Record<string, number>;
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === 'number') max[k] = Math.max(max[k] ?? 0, v);
    }
  }
  return max;
}

describe('sectionShift — le signal était MORT sur tout document', () => {
  it('atteint sa pleine valeur sur la démo', () => {
    // Mesuré avant correctif : 0,0000 sur 60 s. `sectionShift` est câblé sur
    // `from: ['SECTION']` depuis le MVP, dans `defaults.ts`, dans les onze
    // presets et dans l'éditeur de réaction — et RIEN n'a jamais produit un
    // événement `SECTION`. `structure.ts` n'émet aucun événement : il remplit
    // le tableau `sections`, que `finalize.ts` qualifie lui-même de « concept
    // différent ».
    expect(maximaSignaux(buildDemoDoc(60), 60).sectionShift).toBeGreaterThan(0.5);
  });

  it("ne se déclenche PAS à t=0 : le début n'est pas un changement de section", () => {
    const doc = buildDemoDoc(60);
    const derives = buildMusicTimeline(doc).eventsOfTypeBetween('SECTION', -1, 60);
    expect(derives.length, 'trois sections -> deux frontières').toBe(2);
    expect(Math.min(...derives.map((e) => e.t)), 'aucune frontière à 0').toBeGreaterThan(0);
  });

  it('recopie la confiance de la section (Loi 3)', () => {
    for (const e of buildMusicTimeline(buildDemoDoc(60)).eventsOfTypeBetween('SECTION', -1, 60)) {
      expect(e.confidence).toBe(1); // la démo déclare `confidence: 1`
    }
  });

  it("laisse le DOCUMENT faire autorité s'il porte déjà des SECTION", () => {
    // Le jour où l'analyse en produira, la dérivation doit s'effacer plutôt que
    // de doubler chaque frontière.
    const doc = buildDemoDoc(60);
    const avec: PmdiDocument = {
      ...doc,
      events: [...doc.events, { t: 12, type: 'SECTION', intensity: 0.4, confidence: 0.5 }],
    };
    const trouves = buildMusicTimeline(avec).eventsOfTypeBetween('SECTION', -1, 60);
    expect(trouves.length).toBe(1);
    expect(trouves[0]!.t).toBe(12);
  });

  it('un document SANS section ne produit rien, et ne casse pas', () => {
    const doc = { ...buildDemoDoc(60), sections: [] };
    expect(buildMusicTimeline(doc).eventsOfTypeBetween('SECTION', -1, 60)).toEqual([]);
    expect(() => maximaSignaux(doc, 5)).not.toThrow();
  });
});

describe('validatePreset — les noms qui doivent exister', () => {
  it('rejette un `from` dont le préfixe n\'appartient à aucune famille', () => {
    // Le défaut SILENCIEUX : `resolve()` n'a aucun `else`, donc une entrée
    // inconnue disparaît de la table résolue sans un mot, et le signal reste
    // à zéro pour toujours.
    const p = base();
    p.mapping.drive = { from: 'featuer:energy', rise: 0.1, fall: 0.5 };
    expect(erreurs(p)).toContain('mapping.drive.from');
  });

  it('rejette une onde de LFO inconnue, en la nommant', () => {
    const p = base();
    p.mapping.lfoA = { from: 'lfo:trianlge', bars: 2 };
    const e = erreurs(p);
    expect(e).toContain('trianlge');
    expect(e).toContain('triangle'); // la liste attendue est citée
  });

  it('rejette un tableau d\'impulsion vide', () => {
    const p = base();
    p.mapping.impact = { from: [], gain: 1, decay: 0.1 };
    expect(erreurs(p)).toContain('tableau vide');
  });

  it('accepte les cinq ondes du moteur', () => {
    for (const onde of LFO_WAVEFORMS) {
      const p = base();
      p.mapping.lfoA = { from: `lfo:${onde}`, bars: 2 };
      expect(validatePreset(p).ok, `${onde} refusée à tort`).toBe(true);
    }
  });

  it("n'impose AUCUN vocabulaire aux types d'événements", () => {
    // docs/04 principe #3 : `EventType` est une chaîne libre, un type inconnu
    // est ignoré. On contrôle la forme, jamais le vocabulaire — sinon un
    // document d'analyse plus riche serait rejeté à tort.
    const p = base();
    p.mapping.impact = { from: ['KICK', 'UN_TYPE_FUTUR'], gain: 1, decay: 0.1 };
    expect(validatePreset(p).ok).toBe(true);
  });

  it('les onze presets du catalogue passent', () => {
    for (const preset of PRESET_CATALOG) {
      expect(validatePreset(preset).ok, `${preset.id} : ${erreurs(preset)}`).toBe(true);
    }
  });
});

describe('audit — les autres noms cités par les presets existent', () => {
  it('toutes les ondes de LFO citées sont connues du moteur', () => {
    for (const p of PRESET_CATALOG) {
      for (const [signal, e] of Object.entries(p.mapping ?? {})) {
        const from = (e as { from?: unknown }).from;
        if (typeof from !== 'string' || !from.startsWith('lfo:')) continue;
        expect(LFO_WAVEFORMS, `${p.id}.${signal}`).toContain(from.slice(4));
      }
    }
  });

  it("toutes les features citées sont produites par l'analyse", () => {
    // `AnalysisPipeline` émet energy, rms, centroid, flatness, rolloff85,
    // band.* et spectrum.*. Une feature absente ne casse rien — `featureAt`
    // rend 0 — mais le signal serait mort en silence, comme sectionShift.
    const PRODUITES = ['energy', 'rms', 'centroid', 'flatness', 'rolloff85'];
    for (const p of PRESET_CATALOG) {
      for (const [signal, e] of Object.entries(p.mapping ?? {})) {
        const from = (e as { from?: unknown }).from;
        if (typeof from !== 'string' || !from.startsWith('feature:')) continue;
        const id = from.slice('feature:'.length);
        const connue = PRODUITES.includes(id) || id.startsWith('band.') || id.startsWith('spectrum.');
        expect(connue, `${p.id}.${signal} cite "${id}"`).toBe(true);
      }
    }
  });
});
