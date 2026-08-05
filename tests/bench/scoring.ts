/**
 * Métriques d'évaluation de détection — docs/11_TESTING.md §"Niveau 2 —
 * Vérité terrain de détection" §"Métrique". Outillage de TEST uniquement
 * (jamais importé par `src/`) : pas de corpus annoté réel disponible pour
 * l'instant (docs/JOURNAL.md, bloqueur inchangé depuis l'Étape 2), mais la
 * mécanique de notation elle-même est indépendante d'un corpus précis et
 * vérifiable dès aujourd'hui avec des listes d'événements synthétiques —
 * prête à consommer un vrai corpus dès qu'il existera.
 */

export interface FMeasureResult {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly fMeasure: number;
}

/**
 * F-mesure à tolérance fixe (docs/11 : ±70 ms pour les beats/onsets).
 * Appariement GLOUTON par plus proche voisin non encore apparié — une
 * simplification assumée par rapport à l'appariement optimal (algorithme
 * hongrois) qu'utilisent des bancs académiques comme mir_eval : suffisant
 * pour des événements rythmiques peu denses (deux détections à quelques ms
 * l'une de l'autre n'arrivent pas en pratique sur ce type de signal), et
 * bien plus simple à auditer à la main.
 *
 * Convention pour les ensembles vides : précision/rappel/F-mesure valent 0
 * si le dénominateur correspondant est nul (évite un NaN silencieux) —
 * délibérément PAS 1, pour ne jamais laisser « rien détecté, rien à
 * détecter » se lire comme un succès sans y regarder de plus près.
 */
export function scoreEvents(detectedTimes: readonly number[], truthTimes: readonly number[], toleranceSec: number): FMeasureResult {
  const sortedDetected = [...detectedTimes].sort((a, b) => a - b);
  const sortedTruth = [...truthTimes].sort((a, b) => a - b);
  const usedDetected = new Set<number>();

  let truePositives = 0;
  for (const truthTime of sortedTruth) {
    let bestIndex = -1;
    let bestDist = Infinity;
    for (let i = 0; i < sortedDetected.length; i++) {
      if (usedDetected.has(i)) continue;
      const dist = Math.abs(sortedDetected[i]! - truthTime);
      if (dist <= toleranceSec && dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) {
      usedDetected.add(bestIndex);
      truePositives++;
    }
  }

  const falsePositives = sortedDetected.length - truePositives;
  const falseNegatives = sortedTruth.length - truePositives;
  const precision = truePositives + falsePositives > 0 ? truePositives / (truePositives + falsePositives) : 0;
  const recall = truePositives + falseNegatives > 0 ? truePositives / (truePositives + falseNegatives) : 0;
  const fMeasure = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { truePositives, falsePositives, falseNegatives, precision, recall, fMeasure };
}

/** Critère "Tempo (± 2 %)" de docs/11 — pas/octave-équivalence : géré en amont par `estimateTempo`, pas ici. */
export function isTempoAccurate(detectedBpm: number, truthBpm: number, tolerance = 0.02): boolean {
  if (truthBpm <= 0) return false;
  return Math.abs(detectedBpm - truthBpm) / truthBpm <= tolerance;
}
