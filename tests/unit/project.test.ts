import { describe, expect, it } from 'vitest';
import { validateProject } from '../../src/project/Project';
import { makeProject } from './testSupport/projectFixture';

describe('validateProject', () => {
  it('accepte un projet bien formé', () => {
    const result = validateProject(makeProject());
    expect(result.ok).toBe(true);
  });

  it('rejette une valeur qui n\'est pas un objet', () => {
    expect(validateProject(null).ok).toBe(false);
    expect(validateProject('pvproj').ok).toBe(false);
  });

  it('rejette un format différent de "pvproj"', () => {
    const result = validateProject({ ...makeProject(), format: 'autre' });
    expect(result.ok).toBe(false);
  });

  it('rejette l\'absence de meta.id/name', () => {
    const project = makeProject();
    const broken = { ...project, meta: { ...project.meta, id: '', name: undefined } };
    const result = validateProject(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('meta.id'))).toBe(true);
      expect(result.errors.some((e) => e.includes('meta.name'))).toBe(true);
    }
  });

  it('exige music.pmdi en mode "pmdi" (non reproductible depuis l\'audio, docs/13)', () => {
    const project = makeProject({ music: { mode: 'pmdi' } });
    const result = validateProject(project);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('music.pmdi'))).toBe(true);
  });

  it('accepte le mode "pmdi" quand un document PMDI minimal est présent', () => {
    const project = makeProject({
      music: {
        mode: 'pmdi',
        pmdi: {
          pmdi: '1.0',
          source: { kind: 'pulsar', generator: 'test', createdAt: '2026-01-01T00:00:00Z' },
          audio: { duration: 10, sampleRate: 44100, channels: 2 },
          tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
          meter: { map: [{ t: 0, num: 4, den: 4 }] },
          events: [],
          confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
        },
      },
    });
    expect(validateProject(project).ok).toBe(true);
  });

  it('rejette export.fps hors de {30, 60}', () => {
    const project = makeProject();
    const broken = { ...project, export: { ...project.export, fps: 24 } };
    expect(validateProject(broken).ok).toBe(false);
  });

  it('tolère un champ ext inconnu (principe de tolérance à l\'inconnu)', () => {
    const project = makeProject({ ext: { futureField: 'valeur inconnue' } });
    const result = validateProject(project);
    expect(result.ok).toBe(true);
  });
});
