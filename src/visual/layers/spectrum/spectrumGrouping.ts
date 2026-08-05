/**
 * Regroupement du spectre fin (`StepContext.spectrum`, résolution MAX,
 * `SPECTRUM_BAND_COUNT` valeurs) en `barCount` barres — Étape 25. Fonction
 * PURE, séparée de `SpectrumBars.ts` pour rester testable en Node, même
 * principe que `bloomMath.ts`/`chromaticMath.ts`.
 *
 * Découpage par index (pas par Hz) : `fine` est déjà en échelle log-espacée
 * uniforme (voir `analysis/spectrumBands.ts`), donc regrouper des tranches
 * CONTIGUËS d'index égales revient à regrouper des tranches égales en
 * log(Hz) — pas besoin de refaire le calcul log ici.
 */

/**
 * Moyenne `fine` en `barCount` groupes contigus de taille quasi-égale
 * (frontières par `floor(i·N/barCount)`, comme un histogramme classique —
 * chaque bin de `fine` appartient à EXACTEMENT un groupe, aucun perdu).
 * `barCount` borné à `[1, fine.length]` : jamais plus de groupes que de bins
 * source, jamais moins d'un groupe.
 */
export function groupBinsIntoBars(fine: Float32Array, barCount: number): Float32Array {
  const total = fine.length;
  const n = Math.max(1, Math.min(total, Math.round(barCount)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.floor((i * total) / n);
    const hi = Math.floor(((i + 1) * total) / n);
    let sum = 0;
    for (let k = lo; k < hi; k++) sum += fine[k]!;
    out[i] = sum / (hi - lo);
  }
  return out;
}
