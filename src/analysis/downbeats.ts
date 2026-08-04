/**
 * Downbeats — analysis/downbeats (docs/05_MUSIC_INTELLIGENCE.md §3).
 * Hypothèse MVP : mesure à 4 temps. Le kick est typiquement sur le 1 — mais
 * pas toujours (Drill, Jersey) : c'est précisément là que la confiance doit
 * refléter l'incertitude plutôt que de trancher à tort.
 *
 * Les trois pistes d'entrée sont déjà normalisées 0..1 (analysis/normalize.ts,
 * par percentile sur tout le morceau) : cette fonction ne fait que combiner,
 * elle ne renormalise pas. Une piste très majoritairement à 0 (silence entre
 * les rares beats) ferait sinon chuter le p95 dans le bruit et écraserait la
 * distinction entre temps forts et temps faibles.
 */
export interface DownbeatInput {
  readonly beatFrameIndices: readonly number[]; // indices de trame de chaque beat, dans l'ordre temporel
  readonly bassEnergyTrack: Float32Array | Float64Array; // normalizeTrack(bands.bandEnergyTracks(...).bass)
  readonly onsetStrengthTrack: Float32Array | Float64Array; // normalizeTrack(tempo.computeGlobalOdfPositive(...))
  readonly noveltyTrack: Float32Array | Float64Array; // normalizeTrack(stft.spectralFlux(frames))
}

export interface DownbeatResult {
  readonly phase: number; // 0..3 — index (mod 4) du premier beat qui est un downbeat
  readonly confidence: number;
}

/**
 * `score(φ) = Σ [0,55·énergie_bass + 0,25·force_onset + 0,20·nouveauté_spectrale]`
 * pour tous les beats ≡ φ (mod 4). `confiance = (meilleur − deuxième) / meilleur`
 * (docs/05 l.123-129). Fiabilité réelle 70-85% — la confiance le reflète, pas
 * une certitude affichée à tort.
 */
export function detectDownbeat(input: DownbeatInput): DownbeatResult {
  const { beatFrameIndices, bassEnergyTrack, onsetStrengthTrack, noveltyTrack } = input;
  if (beatFrameIndices.length === 0) return { phase: 0, confidence: 0 };

  const scores = [0, 0, 0, 0];
  for (let b = 0; b < beatFrameIndices.length; b++) {
    const phase = b % 4;
    const frame = beatFrameIndices[b]!;
    const bass = bassEnergyTrack[frame] ?? 0;
    const onset = onsetStrengthTrack[frame] ?? 0;
    const novelty = noveltyTrack[frame] ?? 0;
    scores[phase]! += 0.55 * bass + 0.25 * onset + 0.2 * novelty;
  }

  let bestPhase = 0;
  let bestScore = -Infinity;
  let secondScore = -Infinity;
  for (let p = 0; p < 4; p++) {
    const s = scores[p]!;
    if (s > bestScore) {
      secondScore = bestScore;
      bestScore = s;
      bestPhase = p;
    } else if (s > secondScore) {
      secondScore = s;
    }
  }

  const confidence = bestScore > 0 ? Math.max(0, Math.min(1, (bestScore - Math.max(0, secondScore)) / bestScore)) : 0;
  return { phase: bestPhase, confidence };
}
