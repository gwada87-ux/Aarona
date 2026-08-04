import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validatePmdi } from '../../src/music/validatePmdi';
import type { PmdiDocument } from '../../src/music/pmdi';

function minimalValidDoc(): PmdiDocument {
  return {
    pmdi: '1.0',
    source: { kind: 'pulsar', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: 4, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 140, confidence: 1, map: [{ t: 0, bpm: 140 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [
      { t: 0, type: 'KICK', intensity: 0.9, confidence: 1 },
      { t: 1, type: 'SNARE', intensity: 0.7, confidence: 1 },
    ],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}

describe('validatePmdi — document minimal valide', () => {
  it('accepte un document conforme, sans avertissement', () => {
    const result = validatePmdi(minimalValidDoc());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });
});

describe('validatePmdi — erreurs (docs/12_INTEGRATION_PULSAR.md §Validation)', () => {
  it('rejette un document non-objet', () => {
    const result = validatePmdi(null);
    expect(result.ok).toBe(false);
  });

  it('rejette pmdi absent', () => {
    const doc: Record<string, unknown> = { ...minimalValidDoc() };
    delete doc['pmdi'];
    const result = validatePmdi(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('pmdi'))).toBe(true);
  });

  it('rejette un MAJEUR incompatible', () => {
    const result = validatePmdi({ ...minimalValidDoc(), pmdi: '2.0' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('majeure incompatible'))).toBe(true);
  });

  it('rejette audio.duration manquant', () => {
    const doc = minimalValidDoc();
    // @ts-expect-error -- test volontaire d'un document malformé
    doc.audio = { sampleRate: 48000, channels: 2 };
    const result = validatePmdi(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('audio.duration'))).toBe(true);
  });

  it('rejette un t négatif', () => {
    const doc = minimalValidDoc();
    doc.events = [{ t: -0.5, type: 'KICK', intensity: 0.5, confidence: 1 }];
    const result = validatePmdi(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('négatif'))).toBe(true);
  });

  it('rejette un t supérieur à audio.duration', () => {
    const doc = minimalValidDoc();
    doc.events = [{ t: 999, type: 'KICK', intensity: 0.5, confidence: 1 }];
    const result = validatePmdi(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('dépasse audio.duration'))).toBe(true);
  });

  it('rejette une confidence hors [0,1]', () => {
    const doc = minimalValidDoc();
    doc.events = [{ t: 0, type: 'KICK', intensity: 0.5, confidence: 1.5 }];
    const result = validatePmdi(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('confidence'))).toBe(true);
  });

  it('rejette events non trié par t croissant', () => {
    const doc = minimalValidDoc();
    doc.events = [
      { t: 2, type: 'KICK', intensity: 0.5, confidence: 1 },
      { t: 1, type: 'SNARE', intensity: 0.5, confidence: 1 },
    ];
    const result = validatePmdi(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('non trié'))).toBe(true);
  });
});

describe('validatePmdi — avertissements', () => {
  it('avertit sur un type d\'événement inconnu, sans rejeter le document', () => {
    const doc = minimalValidDoc();
    doc.events = [{ t: 0, type: 'GLISSANDO_LASER', intensity: 0.5, confidence: 1 }];
    const result = validatePmdi(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.some((w) => w.includes('GLISSANDO_LASER'))).toBe(true);
  });

  it('avertit sur une piste de features inconnue', () => {
    const doc = minimalValidDoc();
    doc.features = [{ id: 'mystere', hz: 100, t0: 0, data: [0, 1] }];
    const result = validatePmdi(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.some((w) => w.includes('mystere'))).toBe(true);
  });

  it('n\'avertit pas sur une piste de features connue ("band.sub")', () => {
    const doc = minimalValidDoc();
    doc.features = [{ id: 'band.sub', hz: 100, t0: 0, data: [0, 1] }];
    const result = validatePmdi(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  it('avertit sur confidence 1.0 en source.kind "analysis" (suspect)', () => {
    const doc = minimalValidDoc();
    doc.source = { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' };
    const result = validatePmdi(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.some((w) => w.includes('analysis'))).toBe(true);
  });

  it('avertit sur MINEUR supérieur, sans rejeter', () => {
    const result = validatePmdi({ ...minimalValidDoc(), pmdi: '1.7' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings.some((w) => w.includes('mineure supérieure'))).toBe(true);
  });
});

describe('validatePmdi — fixture réelle Beat Studio CDJ (Mode B)', () => {
  it('valide le .pmdi.json exporté par Beat Studio CDJ v18 MELVELBASE (squelette rythmique)', () => {
    const path = join(process.cwd(), 'tests/fixtures/beat-studio-cdj-v18-melvelbase.pmdi.json');
    const doc = JSON.parse(readFileSync(path, 'utf-8'));
    const result = validatePmdi(doc);
    expect(result.ok, JSON.stringify(!result.ok ? result.errors : [])).toBe(true);
  });

  it('valide le .pmdi.json exporté par Beat Studio CDJ v18 MELVELBASE (lot 2 : notes + accords piano/bells)', () => {
    const path = join(process.cwd(), 'tests/fixtures/beat-studio-cdj-v18-melvelbase-notes.pmdi.json');
    const doc = JSON.parse(readFileSync(path, 'utf-8'));
    const result = validatePmdi(doc);
    expect(result.ok, JSON.stringify(!result.ok ? result.errors : [])).toBe(true);

    // Assertions ciblées sur le contenu, pas seulement sur ok:true — ce fixture doit
    // réellement démontrer notes[] et chords[], pas juste passer par défaut faute de contenu.
    expect(Array.isArray(doc.notes)).toBe(true);
    expect(doc.notes.length).toBeGreaterThan(0);
    expect(Array.isArray(doc.chords)).toBe(true);
    expect(doc.chords.length).toBeGreaterThan(0);
    for (const note of doc.notes) {
      expect(note.midi).toBeGreaterThanOrEqual(0);
      expect(note.midi).toBeLessThanOrEqual(127);
      expect(note.t).toBeGreaterThanOrEqual(0);
    }
    for (const chord of doc.chords) {
      expect(chord.root).toBeGreaterThanOrEqual(0);
      expect(chord.root).toBeLessThanOrEqual(11);
    }
  });
});
