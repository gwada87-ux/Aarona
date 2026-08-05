/**
 * Migration de version — project/migrate (docs/13_PROJECT_FORMAT.md
 * §"Migration de version"). Reprend le pseudocode du document quasiment mot
 * pour mot.
 *
 * Règles (docs/13) : une migration ne perd jamais de données (les champs
 * inconnus survivent dans `ext`) ; chaque migration a un test unitaire avec
 * un projet réel de la version précédente ; un fichier plus récent que
 * `CURRENT_PROJECT_VERSION` est refusé explicitement, jamais lu à moitié.
 */
import { CURRENT_PROJECT_VERSION, ProjectError, validateProject, type Project } from './Project';

type Migration = (p: Record<string, unknown>) => Record<string, unknown>;

/**
 * Vide pour l'instant : `CURRENT_PROJECT_VERSION` vaut 1, la toute première
 * version du format — il n'existe encore rien d'antérieur depuis quoi
 * migrer. La première entrée réelle sera `2: (p) => ({ ...p, version: 2,
 * /* transformation *\/ })` le jour où le format évolue (docs/13, exemple).
 */
const MIGRATIONS: Record<number, Migration> = {};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function migrate(raw: unknown): Project {
  if (!isRecord(raw)) throw new ProjectError('FORMAT_UNKNOWN', 'le projet doit être un objet JSON');
  if (raw.format !== 'pvproj') throw new ProjectError('FORMAT_UNKNOWN', `format inconnu : ${JSON.stringify(raw.format)}`);

  const version = raw.version;
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    throw new ProjectError('FORMAT_UNKNOWN', '"version" absente ou invalide');
  }
  if (version > CURRENT_PROJECT_VERSION) {
    throw new ProjectError('VERSION_TOO_RECENT', `version ${version} plus récente que celle supportée (${CURRENT_PROJECT_VERSION})`);
  }

  let p: Record<string, unknown> = raw;
  for (let v = version; v < CURRENT_PROJECT_VERSION; v++) {
    const step = MIGRATIONS[v + 1];
    if (!step) throw new ProjectError('FORMAT_UNKNOWN', `migration manquante de la version ${v} vers ${v + 1}`);
    p = step(p);
  }

  const result = validateProject(p);
  if (!result.ok) throw new ProjectError('INVALID_SHAPE', result.errors.join('; '));
  return result.project;
}
