/**
 * Rééchantillonnage — analysis/resample (docs/04_AUDIO_ANALYSIS.md Étape 0).
 * "Rééchantillonnage par filtre polyphase court, pas par décimation brute (qui
 * replierait le spectre)." Implémenté par interpolation par sinc fenêtrée
 * (Blackman), noyau CENTRÉ sur la position fractionnaire cible : construction
 * non causale, possible uniquement parce que l'analyse est hors-ligne avec le
 * signal entier disponible. Contrairement à un filtre polyphase causal
 * (streaming), ce noyau centré n'introduit AUCUN retard de groupe — pas besoin
 * de le mesurer puis le soustraire (docs/04 l.90-92) : il est nul par
 * construction, la fenêtre étant symétrique autour de chaque position cible.
 */

export interface ResampleResult {
  readonly signal: Float64Array;
  readonly groupDelaySec: number; // 0 par construction, voir note ci-dessus
}

/** Demi-largeur du noyau en périodes de la fréquence de coupure — filtre court. */
const KERNEL_HALF_PERIODS = 8;

function sinc(x: number): number {
  if (x === 0) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

/** Fenêtre de Blackman sur u ∈ [-1, 1], nulle au-delà. */
function blackman(u: number): number {
  if (u <= -1 || u >= 1) return 0;
  return 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u);
}

export function resample(signal: Float64Array, sourceRate: number, targetRate: number): ResampleResult {
  if (sourceRate === targetRate) {
    return { signal: signal.slice(), groupDelaySec: 0 };
  }

  const ratio = targetRate / sourceRate;
  const cutoff = Math.min(1, ratio); // anti-repliement : Nyquist du plus petit taux
  const support = KERNEL_HALF_PERIODS / cutoff; // demi-largeur en échantillons SOURCE

  const nIn = signal.length;
  const outLength = Math.max(0, Math.round(nIn * ratio));
  const out = new Float64Array(outLength);

  for (let nOut = 0; nOut < outLength; nOut++) {
    const tIn = nOut / ratio; // position fractionnaire dans le signal source
    const lo = Math.max(0, Math.ceil(tIn - support));
    const hi = Math.min(nIn - 1, Math.floor(tIn + support));
    let acc = 0;
    for (let k = lo; k <= hi; k++) {
      const d = tIn - k;
      const w = blackman(d / support);
      acc += signal[k]! * sinc(cutoff * d) * cutoff * w;
    }
    out[nOut] = acc;
  }

  return { signal: out, groupDelaySec: 0 };
}
