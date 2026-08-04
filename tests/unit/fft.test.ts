import { describe, expect, it } from 'vitest';
import { fft, hannWindow, realSpectrumMagnitudes } from '../../src/analysis/fft';

/** DFT naïve — référence indépendante, docs/11_TESTING.md §analysis/fft. */
function naiveDftComplex(signal: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const n = signal.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sumRe = 0;
    let sumIm = 0;
    for (let t = 0; t < n; t++) {
      const ang = (-2 * Math.PI * k * t) / n;
      sumRe += signal[t]! * Math.cos(ang);
      sumIm += signal[t]! * Math.sin(ang);
    }
    re[k] = sumRe;
    im[k] = sumIm;
  }
  return { re, im };
}

function naiveRealMagnitudes(signal: ArrayLike<number>): Float64Array {
  const { re, im } = naiveDftComplex(signal);
  const half = signal.length >> 1;
  const out = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) out[k] = Math.hypot(re[k]!, im[k]!);
  return out;
}

describe('analysis/fft — fft() complexe vs DFT naïve', () => {
  it('impulsion → spectre plat', () => {
    const n = 8;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    re[0] = 1;
    fft(re, im);
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(1, 9);
      expect(im[k]).toBeCloseTo(0, 9);
    }
  });

  it('sinus + cosinus (16 points) == DFT naïve à 1e-9 près', () => {
    const n = 16;
    const signal = Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 3 * i) / n) + 0.3 * Math.cos((2 * Math.PI * 5 * i) / n));
    const re = Float64Array.from(signal);
    const im = new Float64Array(n);
    fft(re, im);
    const ref = naiveDftComplex(signal);
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(ref.re[k]!, 9);
      expect(im[k]).toBeCloseTo(ref.im[k]!, 9);
    }
  });

  it('bruit (64 points) == DFT naïve à 1e-7 près', () => {
    const n = 64;
    let seed = 42;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 2 - 1;
    };
    const signal = Array.from({ length: n }, () => rand());
    const re = Float64Array.from(signal);
    const im = new Float64Array(n);
    fft(re, im);
    const ref = naiveDftComplex(signal);
    for (let k = 0; k < n; k++) {
      expect(re[k]).toBeCloseTo(ref.re[k]!, 7);
      expect(im[k]).toBeCloseTo(ref.im[k]!, 7);
    }
  });
});

describe('analysis/fft — realSpectrumMagnitudes() vs DFT naïve', () => {
  it('impulsion (N=1024) → magnitude constante == 1', () => {
    const n = 1024;
    const signal = new Float64Array(n);
    signal[0] = 1;
    const mags = realSpectrumMagnitudes(signal);
    expect(mags.length).toBe(n / 2 + 1);
    for (let k = 0; k <= n / 2; k++) {
      expect(mags[k]).toBeCloseTo(1, 9);
    }
  });

  it('sinus pur (N=64) == DFT naïve à 1e-9 près', () => {
    const n = 64;
    const signal = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * 7 * i) / n));
    const mags = realSpectrumMagnitudes(signal);
    const ref = naiveRealMagnitudes(signal);
    for (let k = 0; k <= n / 2; k++) {
      expect(mags[k]).toBeCloseTo(ref[k]!, 9);
    }
  });

  it('bruit fenêtré Hann (N=1024) == DFT naïve à 1e-6 près', () => {
    const n = 1024;
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff) * 2 - 1;
    };
    const window = hannWindow(n);
    const signal = Float64Array.from({ length: n }, (_, i) => rand() * window[i]!);
    const mags = realSpectrumMagnitudes(signal);
    const ref = naiveRealMagnitudes(signal);
    for (let k = 0; k <= n / 2; k += 17) {
      expect(mags[k]).toBeCloseTo(ref[k]!, 6);
    }
  });
});

describe('analysis/fft — hannWindow()', () => {
  it('vaut 0 aux bords, 1 au centre', () => {
    const w = hannWindow(1025);
    expect(w[0]).toBeCloseTo(0, 9);
    expect(w[1024]).toBeCloseTo(0, 9);
    expect(w[512]).toBeCloseTo(1, 9);
  });
});
