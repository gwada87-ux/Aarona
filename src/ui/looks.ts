/**
 * « Looks » — les modèles en un clic (docs/17_PHASE2_VISUELS.md §7.7,
 * chantier 10 lot C).
 *
 * §7.7 : « Un preset PULSAR ne décrit aujourd'hui que la réaction et les
 * couleurs. Un Look regrouperait tout ce qui fait une identité : style +
 * variante de cadrage + palette + mise en page du texte + assignations de LFO +
 * modes de fusion + réglages de bloom. »
 *
 * CE QU'UN LOOK CONTIENT — ET CE QU'IL NE CONTIENT PAS
 * ----------------------------------------------------
 * Il contient le style, les huit macros, la palette, le texte, le câblage
 * (assignations de LFO comprises : ce sont quatre lignes du `mapping`) et la
 * composition des couches. La liste de §7.7 est couverte à deux exceptions
 * près, toutes deux DÉLIBÉRÉES :
 *
 * - **La variante de cadrage et les modes de fusion n'y sont pas**, parce
 *   qu'ils ne sont pas des réglages : `variantFor(styleId, projectSeed)` les
 *   DÉRIVE de la graine (§7.10). Les figer dans un Look reviendrait à figer la
 *   graine, donc à casser « Nouvelle variante » — le bouton le moins cher et le
 *   plus rentable du projet (§7.9). Appliquer un Look garde la graine courante
 *   et laisse la variante suivre.
 * - **La pochette n'y est pas.** C'est l'image d'un morceau, pas une identité
 *   réutilisable ; la transporter d'un projet à l'autre n'aurait aucun sens.
 *
 * OÙ ILS SONT RANGÉS
 * ------------------
 * Dans le magasin `settings` d'IndexedDB, sous une clé de `AppSettings` — dont
 * la signature est déjà `[key: string]: unknown`. Aucun magasin nouveau, donc
 * aucune montée de `DB_VERSION`, pour la raison écrite au lot B. Les Looks sont
 * une préférence d'application et non une donnée de projet : ils survivent au
 * projet et s'appliquent à n'importe quel autre, ce qui est tout leur intérêt.
 */

import type { AppSettings } from '../project/storage/db';
import type { PresetMacros, PresetMapping, PresetPaletteConfig, StyleId } from '../presets/schema';
import type { TextConfig } from '../visual/text/textConfig';
import type { LayerComposition } from '../visual/scene/composeLayers';

/** Clé dans `AppSettings`. */
const LOOKS_KEY = 'looks';
/** Plafond, pour qu'une liste déroulante reste une liste déroulante. */
export const MAX_LOOKS = 24;

export interface Look {
  readonly name: string;
  readonly styleId: StyleId;
  readonly macros: PresetMacros;
  /** Identifiant du catalogue, config complète, ou `null` = celle du preset. */
  readonly palette: string | PresetPaletteConfig | null;
  readonly text: TextConfig | null;
  readonly textSize: number;
  readonly mapping: PresetMapping | null;
  readonly layers: { readonly enabled: LayerComposition; readonly order: readonly string[] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lit les Looks enregistrés.
 *
 * Filtre tout ce qui n'a pas au moins un nom et un style : le magasin est un
 * sac de clés libres, et un `looks` écrit par une version future ou abîmé ne
 * doit pas faire disparaître la liste entière.
 */
export function readLooks(settings: AppSettings): Look[] {
  const raw = settings[LOOKS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter((l): l is Look => isRecord(l) && typeof l.name === 'string' && typeof l.styleId === 'string');
}

/**
 * Range un Look, en remplaçant celui de même nom.
 *
 * Par le NOM et non par un identifiant : « enregistrer sous un nom déjà pris »
 * doit écraser, comme dans n'importe quel logiciel. Le plus ancien saute quand
 * le plafond est atteint.
 */
export function writeLook(settings: AppSettings, look: Look): AppSettings {
  const existing = readLooks(settings).filter((l) => l.name !== look.name);
  const next = [...existing, look].slice(-MAX_LOOKS);
  return { ...settings, [LOOKS_KEY]: next };
}

export function removeLook(settings: AppSettings, name: string): AppSettings {
  return { ...settings, [LOOKS_KEY]: readLooks(settings).filter((l) => l.name !== name) };
}
