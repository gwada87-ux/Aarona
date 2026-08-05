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

function gcd(a: number, b: number): number {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
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

  /**
   * Les taux d'échantillonnage sont des ENTIERS : `step = sourceRate/targetRate` est donc une
   * fraction EXACTE `stepNum/stepDen` (réduite par pgcd). La position fractionnaire dans le
   * signal source (`tIn - floor(tIn)`) ne prend donc que `stepDen` valeurs distinctes, qui
   * reviennent périodiquement au fil de `nOut` — et le noyau (sinc fenêtré, `sin`/`cos`) ne
   * dépend QUE de cette fraction, jamais de `nOut` directement.
   *
   * Précalculer le noyau une fois par phase plutôt qu'à chaque échantillon de sortie élimine la
   * quasi-totalité des appels trigonométriques (mesuré : ~6,6 s sur un signal de 4 min avant ce
   * correctif — docs/JOURNAL.md, Étape 17/P15 puis Étape 19). Résultat NUMÉRIQUE inchangé : les
   * indices source hors du support d'origine (`[lo,hi]` de l'ancienne version) ont un poids
   * `blackman()` exactement nul par construction — les inclure ou non dans la somme ne change
   * rien (0 + x = x, sans perte de précision), seule la façon d'obtenir les poids change.
   */
  const g = gcd(sourceRate, targetRate);
  const stepNum = sourceRate / g;
  const stepDen = targetRate / g;
  const kernelHalfWidth = Math.ceil(support);
  const kernelWidth = 2 * kernelHalfWidth + 1;

  const kernels = new Float64Array(stepDen * kernelWidth);
  for (let phase = 0; phase < stepDen; phase++) {
    const frac = phase / stepDen;
    const base = phase * kernelWidth;
    for (let j = -kernelHalfWidth; j <= kernelHalfWidth; j++) {
      const d = frac - j; // tIn - k, pour k = floor(tIn) + j
      const w = blackman(d / support);
      kernels[base + j + kernelHalfWidth] = sinc(cutoff * d) * cutoff * w;
    }
  }

  let q = 0; // floor(tIn) pour l'échantillon de sortie courant
  let phaseAcc = 0; // (nOut * stepNum) mod stepDen
  for (let nOut = 0; nOut < outLength; nOut++) {
    const base = phaseAcc * kernelWidth;
    let acc = 0;
    for (let j = -kernelHalfWidth; j <= kernelHalfWidth; j++) {
      const k = q + j;
      if (k < 0 || k >= nIn) continue;
      acc += signal[k]! * kernels[base + j + kernelHalfWidth]!;
    }
    out[nOut] = acc;

    phaseAcc += stepNum;
    while (phaseAcc >= stepDen) {
      phaseAcc -= stepDen;
      q++;
    }
  }

  return { signal: out, groupDelaySec: 0 };
}
