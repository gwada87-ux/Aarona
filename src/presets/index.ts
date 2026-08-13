/**
 * Catalogue des 11 presets de genre — chargés depuis leur JSON et validés au
 * chargement du module (`validatePreset`, même exigence que "validé par schéma"
 * de docs/08) : un preset mal formé fait échouer l'import plutôt que de circuler
 * silencieusement jusqu'à `resolvePreset`.
 *
 * ONZE, ET CHAQUE STYLE EN A AU MOINS UN (chantier 9, docs/17 §9.4)
 * -----------------------------------------------------------------
 * Le MVP en livrait cinq, et ils ne pointaient que sur TROIS styles : `pulse`
 * deux fois, `field` deux fois, `spectrum-pro` une fois. C'est la troisième
 * cause du grief d'origine d'Aaron - « les presets sont inutilisables, ça ne
 * change rien » : deux presets sur cinq rendaient la même géométrie, à la
 * palette près.
 *
 * Les cinq d'origine sont donc REDIRIGÉS vers cinq styles distincts, et les six
 * presets 6 à 11 de docs/00b §4 sont ajoutés. Les huit styles sont couverts, et
 * un test le vérifie. Onze presets pour huit styles : trois styles en portent
 * deux, avec des câblages et des palettes sans rapport - `eclats` sert `drill`
 * et `phonk`, `iso-pulse` sert `house` et `afro`, `aurore` sert `rnb` et
 * `ambient`.
 *
 * Chaque preset déclare les TREIZE entrées câblables, y compris ses quatre LFO.
 * En omettre une la ferait retomber sur `defaultMapping`, donc rendrait deux
 * presets identiques sur ce signal.
 */
import trapDarkJson from './genres/trap-dark.json';
import drillJson from './genres/drill.json';
import houseJson from './genres/house.json';
import lofiJson from './genres/lofi.json';
import rnbJson from './genres/rnb.json';
import technoJson from './genres/techno.json';
import dubstepJson from './genres/dubstep.json';
import edmJson from './genres/edm.json';
import phonkJson from './genres/phonk.json';
import afroJson from './genres/afro.json';
import ambientJson from './genres/ambient.json';
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
  loadPreset(technoJson, 'techno.json'),
  loadPreset(dubstepJson, 'dubstep.json'),
  loadPreset(edmJson, 'edm.json'),
  loadPreset(phonkJson, 'phonk.json'),
  loadPreset(afroJson, 'afro.json'),
  loadPreset(ambientJson, 'ambient.json'),
];

export * from './schema';
export * from './resolve';
export * from './macros';
export * from './suggest';
export * from './visualDna';
export { buildPalette } from './palette';
export { PALETTE_CATALOGUE, cataloguePaletteById, type CataloguePalette } from './paletteCatalogue';
export { DEFAULT_PRESET_BLOOM, MAX_BLOOM_PASSES, resolveBloom } from './bloom';
