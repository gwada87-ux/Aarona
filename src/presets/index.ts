/**
 * Catalogue des 5 presets du MVP (docs/08_PRESETS.md §"Les 5 presets du
 * MVP") — chargés depuis leur JSON et validés au chargement du module
 * (`validatePreset`, même exigence que "validé par schéma" de docs/08) :
 * un preset mal formé fait échouer l'import plutôt que de circuler
 * silencieusement jusqu'à `resolvePreset`.
 */
import trapDarkJson from './genres/trap-dark.json';
import drillJson from './genres/drill.json';
import houseJson from './genres/house.json';
import lofiJson from './genres/lofi.json';
import rnbJson from './genres/rnb.json';
import { validatePreset, type Preset } from './schema';

function loadPreset(json: unknown, filename: string): Preset {
  const result = validatePreset(json);
  if (!result.ok) throw new Error(`preset invalide (${filename}) : ${result.errors.join('; ')}`);
  return result.preset;
}

export const PRESET_CATALOG: readonly Preset[] = [
  loadPreset(trapDarkJson, 'trap-dark.json'),
  loadPreset(drillJson, 'drill.json'),
  loadPreset(houseJson, 'house.json'),
  loadPreset(lofiJson, 'lofi.json'),
  loadPreset(rnbJson, 'rnb.json'),
];

export * from './schema';
export * from './resolve';
export * from './macros';
export * from './suggest';
export { buildPalette } from './palette';
