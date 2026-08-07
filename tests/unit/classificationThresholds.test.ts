import { describe, expect, it } from 'vitest';
import { classifyOnset, DEFAULT_CLASSIFICATION_THRESHOLDS } from '../../src/analysis/classify';
import { resolvePreset } from '../../src/presets/resolve';
import { PRESET_CATALOG } from '../../src/presets/index';
import { CLASSIFICATION_FIELDS, validatePreset } from '../../src/presets/schema';
import { importTrack } from '../../src/ui/pipeline';
import type { OnsetDescriptor, PmdiDocument } from '../../src/music/pmdi';

/**
 * Audit des seuils de classification, demandé après celui des familles de
 * mapping. Troisième round de la même famille de défaut : des NOMS et des
 * réglages écrits en JSON, que rien ne confronte au moteur à l'exécution.
 */

function erreurs(p: unknown): string {
  const r = validatePreset(p);
  return r.ok ? '' : r.errors.join(' | ');
}

const base = () => JSON.parse(JSON.stringify(PRESET_CATALOG[0]!));

const onset = (o: Partial<OnsetDescriptor>): OnsetDescriptor =>
  ({
    t: 1, strength: 1, centroid: 300, flatness: 0.2, decay30: 0.15, decaySaturated: false,
    microOnsets: 1, e: [0.35, 0.3, 0.15, 0.1, 0.05, 0.05], ...o,
  }) as OnsetDescriptor;

describe('CLASSIFICATION_FIELDS reste d\'accord avec le moteur', () => {
  it('liste exactement les champs de DEFAULT_CLASSIFICATION_THRESHOLDS', () => {
    // La liste est recopiée à la main dans `schema.ts` — délibérément, pour
    // qu'un champ retiré du défaut soit SIGNALÉ plutôt que silencieusement
    // oublié par la validation. Ce test est le prix de ce choix.
    const reel = DEFAULT_CLASSIFICATION_THRESHOLDS as unknown as Record<string, Record<string, number>>;
    expect(Object.keys(CLASSIFICATION_FIELDS).sort()).toEqual(Object.keys(reel).sort());
    for (const famille of Object.keys(reel)) {
      expect([...CLASSIFICATION_FIELDS[famille]!].sort(), famille).toEqual(Object.keys(reel[famille]!).sort());
    }
  });
});

describe('validatePreset — les noms de seuils doivent exister', () => {
  it('rejette une famille inconnue', () => {
    const p = base();
    p.classification = { kik: { bassRatio: 0.6 } };
    expect(erreurs(p)).toContain('classification.kik');
  });

  it('rejette un champ mal orthographié, en citant les champs attendus', () => {
    // Le cas silencieux : `mergeClassification` fait `{ ...base.kick, ...ovr }`,
    // donc `bassRation` s'ajoute à l'objet, n'est lu par personne, et
    // `bassRatio` garde sa valeur par défaut. Sans un mot.
    const p = base();
    p.classification = { kick: { bassRation: 0.6 } };
    const e = erreurs(p);
    expect(e).toContain('classification.kick.bassRation');
    expect(e).toContain('bassRatio');
  });

  it('rejette une valeur non numérique', () => {
    const p = base();
    p.classification = { kick: { bassRatio: 'beaucoup' } };
    expect(erreurs(p)).toContain('nombre fini');
  });

  it("n'impose AUCUNE borne aux valeurs", () => {
    // docs/05 §4 : « points de départ à calibrer sur le corpus ». Un
    // `maxCentroid` de 180 Hz pour un kick techno est aussi légitime que 250 ;
    // trancher ici serait s'arroger un jugement confié à la calibration.
    const p = base();
    p.classification = { kick: { maxCentroid: 40, bassRatio: 0.99 }, perc: { minCentroid: 20000 } };
    expect(validatePreset(p).ok).toBe(true);
  });

  it('les onze presets du catalogue passent', () => {
    for (const preset of PRESET_CATALOG) {
      expect(validatePreset(preset).ok, `${preset.id} : ${erreurs(preset)}`).toBe(true);
    }
  });
});

describe('les surcharges déclarées CHANGENT réellement une classification', () => {
  it('les seuils de drill refusent un grave que les défauts acceptent', () => {
    // Sans quoi tout le reste serait cosmétique. `drill` durcit
    // `kick.bassRatio` 0,55 -> 0,64 et `kick.maxCentroid` 250 -> 200.
    const graveLimite = onset({ centroid: 240, e: [0.32, 0.26, 0.18, 0.12, 0.07, 0.05] });
    const drill = resolvePreset(PRESET_CATALOG.find((p) => p.id === 'drill')!).classification;
    expect(classifyOnset(graveLimite, DEFAULT_CLASSIFICATION_THRESHOLDS)?.type).toBe('KICK');
    expect(classifyOnset(graveLimite, drill)?.type ?? 'aucun').not.toBe('KICK');
  });

  it('un preset SANS bloc classification résout exactement les défauts', () => {
    const sans = PRESET_CATALOG.find((p) => !p.classification);
    expect(sans, 'le catalogue doit contenir au moins un preset sans surcharge').toBeDefined();
    expect(resolvePreset(sans!).classification).toEqual(DEFAULT_CLASSIFICATION_THRESHOLDS);
  });
});

/**
 * Le défaut principal : ces seuils n'atteignaient JAMAIS l'analyse.
 * `App.ts` n'a jamais passé `classification` à `importTrack`, donc
 * `finalizePmdi` retombait toujours sur les défauts — huit presets sur onze
 * déclaraient un bloc qui ne servait à rien.
 */
describe("importTrack applique les seuils du preset SUGGÉRÉ", () => {
  /**
   * Onsets graves LIMITES : acceptés comme KICK par les seuils par défaut
   * (`bassRatio` 0,55 / `maxCentroid` 250), refusés par ceux de `drill`
   * (0,64 / 200). C'est tout l'objet du test — si les seuils du preset ne sont
   * pas appliqués, on comptera 40 kicks au lieu de 0.
   */
  const descripteurs: OnsetDescriptor[] = Array.from({ length: 240 }, (_, i) =>
    onset({ t: i * 0.25, centroid: 240, e: [0.32, 0.26, 0.18, 0.12, 0.07, 0.05] }),
  );

  /**
   * Profil taillé pour que `drill` soit suggéré — c'est indispensable :
   * `drill` est l'un des huit presets à surcharger la classification, et une
   * première version de ce test tombait sur `rnb`, qui n'en surcharge aucune,
   * si bien qu'il ne prouvait rien. Tempo 144 dans [138,150], grave dominant
   * (subDominance 0,85) et 4 onsets/s pour une densité de 0,25... la
   * suggestion est VÉRIFIÉE explicitement ci-dessous plutôt que supposée.
   */
  const plat = (v: number) => ({ hz: 1, t0: 0, data: new Array(60).fill(v) });
  const partiel = {
    pmdi: '1.0',
    source: { kind: 'analysis' as const, generator: 'test', createdAt: '2026-01-01T00:00:00Z' },
    audio: { duration: 60, sampleRate: 48000, channels: 2 },
    tempo: { global: 144, confidence: 1, map: [{ t: 0, bpm: 144 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
    features: [
      { id: 'energy', hz: 1, t0: 0, data: new Array(60).fill(0.5) },
      { id: 'band.sub', ...plat(0.43) },
      { id: 'band.bass', ...plat(0.42) },
      { id: 'band.himid', ...plat(0.08) },
      { id: 'band.high', ...plat(0.07) },
    ],
    ext: { onsetDescriptors: descripteurs },
  } as unknown as PmdiDocument;

  const audioBuffer = {
    numberOfChannels: 1,
    length: 60 * 48000,
    sampleRate: 48000,
    getChannelData: () => new Float32Array(60 * 48000),
  } as unknown as AudioBuffer;

  it('le preset suggéré par ce montage surcharge bien la classification', async () => {
    // Sans cette garantie, le test suivant se dérobe en silence.
    const r = await importTrack({
      audioBuffer,
      analyze: async () => ({ pmdi: partiel, waveformPeaks: { hz: 1, min: [], max: [] } }) as never,
    });
    expect(r.suggestion?.preset.classification, `suggéré : ${r.suggestion?.preset.id}`).toBeDefined();
  });

  it('le document rendu est classé avec les seuils du preset, PAS les défauts', async () => {
    const r = await importTrack({
      audioBuffer,
      analyze: async () => ({ pmdi: partiel, waveformPeaks: { hz: 1, min: [], max: [] } }) as never,
    });
    const seuils = resolvePreset(r.suggestion!.preset).classification;
    const avecPreset = descripteurs.filter((d) => classifyOnset(d, seuils) !== null).length;
    const avecDefauts = descripteurs.filter((d) => classifyOnset(d, DEFAULT_CLASSIFICATION_THRESHOLDS) !== null).length;

    // Le montage n'a d'intérêt que si les deux comptes diffèrent.
    expect(avecPreset, 'montage inutile : les deux jeux de seuils donnent le même compte').not.toBe(avecDefauts);

    const classes = r.doc.events.filter((e) => ['KICK', 'SNARE', 'CLAP', 'HAT', 'PERC', 'SUB_HIT'].includes(e.type)).length;
    expect(classes).toBe(avecPreset);
  });

  it("l'appelant garde la main : des seuils explicites ne sont pas écrasés", async () => {
    // `App.ts` ne s'en sert pas, mais l'API le permet et un test de régression
    // vaut mieux qu'une intention.
    const impose = { ...DEFAULT_CLASSIFICATION_THRESHOLDS, kick: { bassRatio: 0.99, maxCentroid: 10, maxDecay30: 0.01 } };
    const r = await importTrack({
      audioBuffer,
      classification: impose as never,
      analyze: async () => ({ pmdi: partiel, waveformPeaks: { hz: 1, min: [], max: [] } }) as never,
    });
    expect(r.doc.events.filter((e) => e.type === 'KICK').length, 'seuils impossibles -> aucun kick').toBe(0);
  });
});
