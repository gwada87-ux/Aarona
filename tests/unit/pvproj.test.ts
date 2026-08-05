import { describe, expect, it } from 'vitest';
import { PvprojFormatError, readPvproj, writePvproj } from '../../src/project/pvproj';
import { ProjectError, CURRENT_PROJECT_VERSION } from '../../src/project/Project';
import { readZip, writeZip } from '../../src/project/zip';
import { makeProject } from './testSupport/projectFixture';

const thumbnail = Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]);

describe('writePvproj / readPvproj — sauvegarde "Légère" (par défaut)', () => {
  it('restitue le projet et la vignette, sans pmdi ni audio embarqués', () => {
    const project = makeProject();
    const archive = writePvproj({ project, thumbnail });
    const result = readPvproj(archive);

    expect(result.project).toEqual(project);
    expect(Array.from(result.thumbnail!)).toEqual(Array.from(thumbnail));
    expect(result.pmdi).toBeNull();
    expect(result.audio).toBeNull();
  });
});

describe('writePvproj / readPvproj — mode "pmdi" (Mode B, non reproductible depuis l\'audio)', () => {
  const pmdi = {
    pmdi: '1.0',
    source: { kind: 'pulsar' as const, generator: 'test', createdAt: '2026-01-01T00:00:00Z' },
    audio: { duration: 10, sampleRate: 44100, channels: 2 },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };

  it('embarque et restitue le document PMDI, remis à sa place dans project.music.pmdi', () => {
    const project = makeProject({ music: { mode: 'pmdi', pmdi } });
    const archive = writePvproj({ project, thumbnail });
    const result = readPvproj(archive);
    expect(result.pmdi).toEqual(pmdi);
    expect(result.project.music.pmdi).toEqual(pmdi);
  });

  it('project.json n\'embarque PAS de copie du PMDI (extrait dans sa propre entrée, docs/13)', () => {
    const project = makeProject({ music: { mode: 'pmdi', pmdi } });
    const archive = writePvproj({ project, thumbnail });
    const entries = readZip(archive);
    const projectEntry = entries.find((e) => e.name === 'project.json')!;
    const pmdiEntry = entries.find((e) => e.name === 'music.pmdi.json')!;
    expect(pmdiEntry).toBeDefined();
    const projectJson = JSON.parse(new TextDecoder().decode(projectEntry.data));
    expect(projectJson.music.pmdi).toBeUndefined();
  });
});

describe('writePvproj / readPvproj — sauvegarde "Complète" (audio embarqué)', () => {
  it('embarque et restitue le nom et les octets du fichier audio', () => {
    const project = makeProject();
    const audioData = Uint8Array.from({ length: 64 }, (_, i) => i);
    const archive = writePvproj({ project, thumbnail, audio: { filename: 'morceau.mp3', data: audioData } });
    const result = readPvproj(archive);
    expect(result.audio!.filename).toBe('morceau.mp3');
    expect(Array.from(result.audio!.data)).toEqual(Array.from(audioData));
  });
});

describe('readPvproj — rejets', () => {
  it('rejette une archive sans project.json', () => {
    const archive = writeZip([{ name: 'thumbnail.jpg', data: thumbnail }]);
    expect(() => readPvproj(archive)).toThrow(PvprojFormatError);
  });

  it('rejette une archive corrompue (pas un ZIP)', () => {
    const garbage = Uint8Array.from([9, 9, 9, 9, 9, 9, 9, 9]);
    expect(() => readPvproj(garbage)).toThrow(PvprojFormatError);
  });

  it('rejette un project.json de version trop récente — jamais une lecture partielle (docs/13)', () => {
    const tooRecent = { ...makeProject(), version: CURRENT_PROJECT_VERSION + 1 };
    const archive = writeZip([
      { name: 'project.json', data: new TextEncoder().encode(JSON.stringify(tooRecent)) },
      { name: 'thumbnail.jpg', data: thumbnail },
    ]);
    expect(() => readPvproj(archive)).toThrow(ProjectError);
  });
});
