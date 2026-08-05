import type { Project } from '../../../src/project/Project';

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    format: 'pvproj',
    version: 1,
    meta: {
      id: 'test-id',
      name: 'Projet de test',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      app: 'pulsar-visualizer@test',
    },
    audio: {
      ref: { kind: 'file', name: 'track.mp3', size: 12345, hash: 'abc123' },
      title: 'Titre',
      artist: 'Artiste',
      duration: 180,
    },
    music: { mode: 'analysis', analysisProfile: 'balanced', cacheKey: 'cache-key-1' },
    visual: { presetId: 'trap-dark', presetVersion: 1, overrides: { 'macros.glow': 0.85 } },
    export: { format: '16:9', resolution: [1920, 1080], fps: 30, bitrateMbps: 12, codec: 'h264' },
    prefs: { reducedFlashing: false, quality: 'auto', debugOverlay: false },
    seed: 1847362910,
    ...overrides,
  };
}
