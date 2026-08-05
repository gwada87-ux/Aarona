import { describe, expect, it } from 'vitest';
import { PerfMonitor } from '../../src/perf/PerfMonitor';

function fill(monitor: PerfMonitor, n: number, sample: { frameTimeMs: number; updateMs: number; renderMs: number }): void {
  for (let i = 0; i < n; i++) monitor.recordFrame(sample);
}

describe('PerfMonitor — état initial', () => {
  it('renvoie un instantané neutre avant toute image enregistrée', () => {
    const monitor = new PerfMonitor();
    const snap = monitor.snapshot();
    expect(snap).toEqual({ fps: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0, updateMs: 0, renderMs: 0, sampleCount: 0 });
  });
});

describe('PerfMonitor — fenêtre glissante', () => {
  it("reflète l'instantané même avec moins de 90 images (pas de seuil de remplissage, contrairement à QualityGovernor)", () => {
    const monitor = new PerfMonitor();
    fill(monitor, 10, { frameTimeMs: 16, updateMs: 3, renderMs: 9 });
    const snap = monitor.snapshot();
    expect(snap.sampleCount).toBe(10);
    expect(snap.p50Ms).toBe(16);
  });

  it('plafonne à 90 échantillons et évince les plus anciens (tampon circulaire)', () => {
    const monitor = new PerfMonitor();
    fill(monitor, 200, { frameTimeMs: 5, updateMs: 1, renderMs: 3 });
    const snap = monitor.snapshot();
    expect(snap.sampleCount).toBe(90);
    expect(snap.p50Ms).toBe(5);
  });
});

describe('PerfMonitor — statistiques', () => {
  it('le FPS (moyenne) et p50 (médiane) divergent en présence d\'une image lente isolée', () => {
    const monitor = new PerfMonitor();
    fill(monitor, 89, { frameTimeMs: 10, updateMs: 2, renderMs: 6 });
    monitor.recordFrame({ frameTimeMs: 100, updateMs: 2, renderMs: 6 });

    const snap = monitor.snapshot();
    // moyenne = (89*10 + 100) / 90 = 11 ms -> fps = 1000/11
    expect(snap.fps).toBeCloseTo(1000 / 11, 5);
    // médiane des 90 valeurs (89x10 + 1x100) reste 10 : un seul outlier ne déplace pas le centre.
    expect(snap.p50Ms).toBe(10);
    expect(snap.fps).not.toBeCloseTo(1000 / snap.p50Ms, 1); // les deux mesures divergent bien, par construction
  });

  it("p99 capte l'image lente isolée alors que p95 y reste insensible sur cette distribution", () => {
    const monitor = new PerfMonitor();
    fill(monitor, 89, { frameTimeMs: 10, updateMs: 2, renderMs: 6 });
    monitor.recordFrame({ frameTimeMs: 50, updateMs: 2, renderMs: 6 });

    const snap = monitor.snapshot();
    expect(snap.p95Ms).toBe(10);
    expect(snap.p99Ms).toBeGreaterThan(10);
  });

  it("Update/Rendu sont la médiane de leurs échantillons respectifs, indépendante du temps d'image total", () => {
    const monitor = new PerfMonitor();
    fill(monitor, 90, { frameTimeMs: 16.6, updateMs: 2.8, renderMs: 9.4 });

    const snap = monitor.snapshot();
    expect(snap.updateMs).toBeCloseTo(2.8, 5);
    expect(snap.renderMs).toBeCloseTo(9.4, 5);
  });
});
