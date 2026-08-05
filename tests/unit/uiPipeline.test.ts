import { describe, expect, it } from 'vitest';
import { importTrack, type AnalyzeFnOptions } from '../../src/ui/pipeline';
import { DEFAULT_CLASSIFICATION_THRESHOLDS } from '../../src/analysis/classify';
import type { AnalysisProgressStage, AnalysisResult } from '../../src/analysis/AnalysisPipeline';
import type { OnsetDescriptor, PmdiDocument } from '../../src/music/pmdi';

function fakeAudioBuffer(durationSec: number, sampleRate = 22050): AudioBuffer {
  const length = Math.round(durationSec * sampleRate);
  return {
    numberOfChannels: 1,
    length,
    sampleRate,
    getChannelData: () => new Float32Array(length),
  } as unknown as AudioBuffer;
}

function fakePartialDoc(durationSec: number, onsetDescriptors: OnsetDescriptor[] = []): PmdiDocument {
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'fake@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: durationSec, sampleRate: 22050, channels: 1, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 0.8, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    grid: { beats: [], downbeats: [] },
    events: [],
    confidence: { tempo: 0.8, grid: 0.8, classification: 0, structure: 0 },
    ...(onsetDescriptors.length > 0 ? { ext: { onsetDescriptors } } : {}),
  };
}

function fakeResult(durationSec: number, onsetDescriptors: OnsetDescriptor[] = []): AnalysisResult {
  return {
    pmdi: fakePartialDoc(durationSec, onsetDescriptors),
    waveformPeaks: { min: new Float32Array(4), max: new Float32Array(4), bucketCount: 4 },
  };
}

describe('importTrack — orchestration', () => {
  it('démixe le buffer et transmet signal/sampleRate à analyze()', async () => {
    const calls: AnalyzeFnOptions[] = [];
    const analyze = async (opts: AnalyzeFnOptions) => {
      calls.push(opts);
      return fakeResult(10);
    };

    await importTrack({ audioBuffer: fakeAudioBuffer(10, 22050), analyze });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.sampleRate).toBe(22050);
    expect(calls[0]!.signal.length).toBe(Math.round(10 * 22050));
  });

  it('applique finalizePmdi (sections/events peuplés) puis construit une MusicTimeline utilisable', async () => {
    const result = await importTrack({
      audioBuffer: fakeAudioBuffer(10),
      analyze: async () => fakeResult(10),
    });

    expect(result.doc.sections).toBeDefined();
    expect(result.timeline.duration).toBe(10);
  });

  it('suggère un preset du catalogue (5 presets livrés en P11, jamais vide)', async () => {
    const result = await importTrack({
      audioBuffer: fakeAudioBuffer(10),
      analyze: async () => fakeResult(10),
    });
    expect(result.suggestion).not.toBeNull();
    expect(result.suggestion!.reason).toContain("suggéré d'après l'analyse");
  });

  it('transmet la progression rapportée par analyze() à onProgress', async () => {
    const seen: Array<[number, AnalysisProgressStage]> = [];
    await importTrack({
      audioBuffer: fakeAudioBuffer(10),
      analyze: async (opts) => {
        opts.onProgress?.(0.5, 'stft');
        opts.onProgress?.(1, 'bassContour');
        return fakeResult(10);
      },
      onProgress: (fraction, stage) => seen.push([fraction, stage]),
    });
    expect(seen).toEqual([
      [0.5, 'stft'],
      [1, 'bassContour'],
    ]);
  });

  it('applique les seuils de classification fournis (surcharge réellement transmise à finalizePmdi)', async () => {
    // Bassiness 0,58 : passe le seuil par défaut (0,55) mais pas une surcharge plus stricte (0,62) —
    // même onset que dans docs/05/classify.test.ts.
    const descriptor: OnsetDescriptor = {
      t: 1,
      band: 'bass',
      strength: 0.9,
      e: [0.3, 0.28, 0.1, 0.1, 0.11, 0.11],
      centroid: 150,
      flatness: 0,
      decay30: 0.1,
      decaySaturated: false,
    };

    const withDefault = await importTrack({
      audioBuffer: fakeAudioBuffer(10),
      analyze: async () => fakeResult(10, [descriptor]),
    });
    expect(withDefault.doc.events.some((e) => e.type === 'KICK')).toBe(true);

    const stricter = { ...DEFAULT_CLASSIFICATION_THRESHOLDS, kick: { ...DEFAULT_CLASSIFICATION_THRESHOLDS.kick, bassRatio: 0.62 } };
    const withOverride = await importTrack({
      audioBuffer: fakeAudioBuffer(10),
      analyze: async () => fakeResult(10, [descriptor]),
      classification: stricter,
    });
    expect(withOverride.doc.events.some((e) => e.type === 'KICK')).toBe(false);
  });
});
