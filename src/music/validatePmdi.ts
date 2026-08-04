/**
 * Validateur du contrat PMDI v1.0 (docs/12_INTEGRATION_PULSAR.md §"Validation").
 * Prend un `unknown` (jamais un `PmdiDocument` déjà supposé valide — c'est justement
 * ce que cette fonction établit) et rapporte erreurs/avertissements selon le tableau
 * de la spec, sans jamais lancer d'exception : un document malformé produit
 * `{ ok: false, errors, warnings }`, jamais un throw.
 */

const SUPPORTED_MAJOR = 1;
const SUPPORTED_MINOR = 0;

/** Exemples cités par la spec (doc 12, ligne 122) — non exhaustif, extensible sans MAJEUR. */
const KNOWN_FEATURE_ID_PATTERN = /^(energy|centroid|flatness|band\..+)$/;

/** Vocabulaire de base observé dans les exemples de la spec — un type hors de cette liste
 * n'est PAS une erreur (principe #3 : tolérance à l'inconnu), seulement un avertissement. */
const KNOWN_EVENT_TYPES = new Set([
  'KICK', 'SNARE', 'CLAP', 'HAT_CLOSED', 'HAT_OPEN', 'PERC', 'BASS', 'FX', 'VOCAL',
  'MELODY', 'CHORD', 'BEAT', 'DOWNBEAT',
]);

const EXT_WARNING_BYTES = 50_000; // "champ ext volumineux" — seuil pragmatique, pas normatif dans la spec

export type ValidationResult =
  | { ok: true; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isConfidence(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

/**
 * Vérifie la compatibilité de version selon docs/12 §"Compatibilité et versionnement" :
 * MAJEUR doit être exactement celui supporté (1) ; MINEUR supérieur au nôtre est accepté
 * avec avertissement (champs inconnus ignorés) ; tout écart de MAJEUR est un rejet.
 */
function checkVersion(pmdi: unknown, errors: string[], warnings: string[]): void {
  if (typeof pmdi !== 'string' || !/^\d+\.\d+$/.test(pmdi)) {
    errors.push(`champ "pmdi" absent ou mal formé (attendu "MAJEUR.MINEUR") : ${JSON.stringify(pmdi)}`);
    return;
  }
  const [majorStr, minorStr] = pmdi.split('.');
  const major = Number(majorStr);
  const minor = Number(minorStr);
  if (major !== SUPPORTED_MAJOR) {
    errors.push(`version PMDI majeure incompatible : "${pmdi}" (lecteur supporte MAJEUR=${SUPPORTED_MAJOR})`);
    return;
  }
  if (minor > SUPPORTED_MINOR) {
    warnings.push(
      `version PMDI mineure supérieure à celle supportée ("${pmdi}" > ${SUPPORTED_MAJOR}.${SUPPORTED_MINOR}) — champs inconnus ignorés`,
    );
  }
}

function checkT(t: unknown, duration: number, where: string, errors: string[]): void {
  if (!isFiniteNumber(t)) {
    errors.push(`${where}.t manquant ou non numérique : ${JSON.stringify(t)}`);
    return;
  }
  if (t < 0) errors.push(`${where}.t négatif : ${t}`);
  if (Number.isFinite(duration) && t > duration) {
    errors.push(`${where}.t (${t}) dépasse audio.duration (${duration})`);
  }
}

function checkConfidence(confidence: unknown, where: string, errors: string[]): void {
  if (!isConfidence(confidence)) {
    errors.push(`${where}.confidence hors de [0,1] ou non numérique : ${JSON.stringify(confidence)}`);
  }
}

export function validatePmdi(doc: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(doc)) {
    return { ok: false, errors: ['document PMDI absent ou non-objet'], warnings };
  }

  checkVersion(doc['pmdi'], errors, warnings);

  const audio = doc['audio'];
  let duration = NaN;
  if (!isRecord(audio) || !isFiniteNumber(audio['duration'])) {
    errors.push('audio.duration manquant');
  } else {
    duration = audio['duration'];
  }

  const sourceKind = isRecord(doc['source']) ? doc['source']['kind'] : undefined;
  const isAnalysisSource = sourceKind === 'analysis';

  const tempo = doc['tempo'];
  if (isRecord(tempo)) {
    checkConfidence(tempo['confidence'], 'tempo', errors);
    const map = tempo['map'];
    if (Array.isArray(map)) {
      map.forEach((point, i) => {
        if (isRecord(point)) checkT(point['t'], duration, `tempo.map[${i}]`, errors);
      });
    }
  }

  const meter = doc['meter'];
  if (isRecord(meter) && Array.isArray(meter['map'])) {
    meter['map'].forEach((point, i) => {
      if (isRecord(point)) checkT(point['t'], duration, `meter.map[${i}]`, errors);
    });
  }

  const events = doc['events'];
  if (!Array.isArray(events)) {
    errors.push('events manquant ou non-tableau');
  } else {
    let lastT = -Infinity;
    let sorted = true;
    events.forEach((event, i) => {
      const where = `events[${i}]`;
      if (!isRecord(event)) {
        errors.push(`${where} n'est pas un objet`);
        return;
      }
      checkT(event['t'], duration, where, errors);
      checkConfidence(event['confidence'], where, errors);
      if (isAnalysisSource && event['confidence'] === 1) {
        warnings.push(`${where}.confidence === 1.0 en source.kind === "analysis" (suspect)`);
      }
      const type = event['type'];
      if (typeof type === 'string' && !KNOWN_EVENT_TYPES.has(type)) {
        warnings.push(`${where}.type inconnu : "${type}" (ignoré silencieusement par un lecteur strict)`);
      }
      const t = event['t'];
      if (isFiniteNumber(t)) {
        if (t < lastT) sorted = false;
        lastT = t;
      }
    });
    if (!sorted) errors.push('events non trié par t croissant');
  }

  const features = doc['features'];
  if (Array.isArray(features)) {
    features.forEach((track, i) => {
      if (!isRecord(track)) return;
      const id = track['id'];
      if (typeof id === 'string' && !KNOWN_FEATURE_ID_PATTERN.test(id)) {
        warnings.push(`features[${i}].id inconnu : "${id}"`);
      }
    });
  }

  const sections = doc['sections'];
  if (Array.isArray(sections)) {
    sections.forEach((section, i) => {
      if (!isRecord(section)) return;
      checkT(section['t'], duration, `sections[${i}]`, errors);
      checkConfidence(section['confidence'], `sections[${i}]`, errors);
    });
  }

  const notes = doc['notes'];
  if (Array.isArray(notes)) {
    notes.forEach((note, i) => {
      if (!isRecord(note)) return;
      checkT(note['t'], duration, `notes[${i}]`, errors);
      checkConfidence(note['confidence'], `notes[${i}]`, errors);
    });
  }

  const chords = doc['chords'];
  if (Array.isArray(chords)) {
    chords.forEach((chord, i) => {
      if (!isRecord(chord)) return;
      checkT(chord['t'], duration, `chords[${i}]`, errors);
      checkConfidence(chord['confidence'], `chords[${i}]`, errors);
    });
  }

  const confidence = doc['confidence'];
  if (!isRecord(confidence)) {
    errors.push('confidence (synthèse globale) manquant');
  } else {
    (['tempo', 'grid', 'classification', 'structure'] as const).forEach((key) => {
      checkConfidence(confidence[key], `confidence.${key}`, errors);
    });
  }

  const ext = doc['ext'];
  if (ext !== undefined) {
    const size = JSON.stringify(ext).length;
    if (size > EXT_WARNING_BYTES) {
      warnings.push(`ext volumineux (~${size} octets sérialisés)`);
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, warnings };
}
