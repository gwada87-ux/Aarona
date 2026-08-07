/**
 * Preset — format JSON pur, versionné (docs/08_PRESETS.md §"Structure").
 * Configure le câblage musique→signaux (behaviour/mapping), la classification
 * des onsets (analysis/classify), la palette (visual/palette) et les 8
 * macro-contrôles. « Un preset n'exécute jamais de code » (docs/08) : ce
 * fichier ne fait qu'énoncer la forme des données, `validatePreset` la
 * vérifie — même principe que `music/pmdi.ts` / `validatePmdi.ts`.
 */
import type { MappingEntry } from '../behaviour/mapping/MappingSchema';
import type {
  ClapThresholds,
  HatThresholds,
  KickThresholds,
  PercThresholds,
  SnareLikeThresholds,
} from '../analysis/classify';

export const PRESET_SCHEMA_VERSION = 1;

/**
 * `monolith` et `iso-pulse` ajoutés au chantier 5 de la phase 2 — les styles 4
 * et 5 des « styles 4 à 12 » que `docs/00b` §4 réservait à l'après-MVP.
 */
export const STYLE_IDS = ['pulse', 'field', 'spectrum-pro', 'monolith', 'iso-pulse'] as const;
export type StyleId = (typeof STYLE_IDS)[number];

/**
 * Libellés d'affichage des styles. Ils vivent ICI, à côté de `STYLE_IDS`, et
 * non dans le HTML : jusqu'au chantier 1 de la phase 2, les options du
 * `<select>` de style étaient écrites en dur dans `index.html`, si bien
 * qu'ajouter un style obligeait à modifier TROIS fichiers sans qu'aucun test ne
 * signale l'oubli du troisième. `Record<StyleId, string>` force désormais le
 * compilateur à réclamer le libellé dès qu'un identifiant est ajouté.
 *
 * Un libellé est une donnée d'interface dans un module de presets, ce qui se
 * discute — mais le faire vivre ailleurs, c'est accepter qu'il dérive.
 */
export const STYLE_LABELS: Readonly<Record<StyleId, string>> = Object.freeze({
  pulse: 'Pulse',
  field: 'Field',
  'spectrum-pro': 'Spectrum Pro',
  monolith: 'Monolith',
  'iso-pulse': 'Iso Pulse',
});

/**
 * Signaux réellement lus par `BehaviourEngine.update()`
 * (`src/behaviour/BehaviourEngine.ts`) — `pulse`/`barPulse` en sont
 * volontairement absents : ce sont des fonctions directes de
 * `beat.phase`/`bar.phase`, jamais pilotées par la table de câblage. Un
 * preset qui inventerait un autre nom de signal serait silencieusement
 * ignoré par `BehaviourEngine` ; ce type fermé l'empêche dès le typage.
 */
export const SIGNAL_NAMES = ['impact', 'subImpact', 'accent', 'tick', 'sectionShift', 'drive', 'weight', 'brightness', 'tension'] as const;
export type SignalName = (typeof SIGNAL_NAMES)[number];

/** Diff partiel sur `MappingSchema` — seules les entrées à recâbler sont présentes, le reste hérite de `defaultMapping`. */
export type PresetMapping = Partial<Record<SignalName, MappingEntry>>;

export interface PresetGenreHint {
  readonly tempoHint: readonly [number, number];
  /** ×2/÷2 plausible pour ce genre (docs/05 §1 "Le piège ×2/÷2") — élargit le test de correspondance de tempo. */
  readonly doubleTimeHint?: boolean;
  /**
   * 0..1 — 1 = profil grave dominant (Trap, Drill), 0 = profil médium
   * dominant (Lofi, R&B) : docs/08 §"Adaptation automatique", étape 2.
   * Continu plutôt que binaire : House n'est rangé dans aucun des deux pôles
   * par la documentation — une valeur intermédiaire l'exprime honnêtement
   * plutôt que de trancher un cas non spécifié.
   */
  readonly subDominance: number;
  /**
   * 0..1 — densité relative d'onsets attendue (docs/08, étape 3). Valeur
   * RELATIVE entre les 5 presets du MVP, auto-choisie : aucun genre
   * réellement "dense" au sens de docs/05 (Jersey, Hyperpop) n'existe avant
   * la V2, donc aucune donnée chiffrée n'est disponible pour la calibrer.
   */
  readonly onsetDensity: number;
  /** docs/08, étape 4 : "propose d'office un preset à régime continu (Lofi, R&B)" si confiance de grille < 0,6. */
  readonly continuousRegimePreference: boolean;
}

export interface ClassificationOverrides {
  readonly kick?: Partial<KickThresholds>;
  readonly snare?: Partial<SnareLikeThresholds>;
  readonly clap?: Partial<ClapThresholds>;
  readonly hat?: Partial<HatThresholds>;
  readonly perc?: Partial<PercThresholds>;
}

export interface PresetPaletteConfig {
  readonly bg: readonly [string, string];
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
  readonly glow: string;
  readonly contrast: number;
  readonly drift: { readonly lowEnergy: string; readonly highEnergy: string };
}

export const MACRO_NAMES = ['energy', 'reactivity', 'density', 'movement', 'depth', 'glow', 'chaos', 'smoothness'] as const;
export type MacroName = (typeof MACRO_NAMES)[number];
export type PresetMacros = Readonly<Record<MacroName, number>>;

export interface PresetSafety {
  readonly reducedFlashing: boolean;
}

/**
 * `layers` RETIRÉ au chantier 1 de la phase 2 (docs/17_PHASE2_VISUELS.md §9.1).
 *
 * Il était déclaré, recopié par `resolvePreset`, et lu par PERSONNE — ni
 * `ui/App.ts`, ni `export/ExportPipeline.ts`. Trois raisons de le retirer
 * plutôt que de le brancher :
 *
 * 1. Ses clés ne désignent aucune couche réelle. `trap-dark.json` écrivait
 *    `particles` / `field` / `postfx`, alors que les identifiants sont
 *    `particleField` / `perspectiveGrid` / `frameFeedback` / `screenShake`. Le
 *    brancher aurait exigé d'inventer une table de correspondance qui n'a jamais
 *    existé, donc de deviner l'intention.
 * 2. Il entrait en collision avec `presets/layerMacros.ts`, qui écrit déjà
 *    `field.perspectiveGrid.rows` — le bloc annonçait `rows: 24` pour le même
 *    paramètre. Deux mécanismes sur un même chemin, le dernier écrit gagne, en
 *    silence : exactement le piège que l'en-tête de `layerMacros.ts` documente.
 * 3. Un seul preset sur cinq l'utilisait.
 *
 * Le besoin qu'il aurait servi — des valeurs ABSOLUES par preset, là où les
 * macros n'offrent qu'une courbe partagée — est réel, et c'est le compositeur
 * de couches (docs/17 §7.7, chantier 10) qui y répondra, avec des identifiants
 * de couche vérifiés.
 *
 * Les valeurs qui étaient déclarées sont consignées dans docs/JOURNAL.md pour
 * que l'intention ne soit pas perdue.
 *
 * `validatePreset` ignore les champs inconnus : un `.pvproj` ou un preset
 * utilisateur qui porte encore un bloc `layers` reste valide, il est simplement
 * sans effet — comme il l'était déjà.
 */
export interface Preset {
  readonly id: string;
  readonly version: number;
  readonly name: string;
  readonly genre: PresetGenreHint;
  readonly style: StyleId;
  readonly mapping?: PresetMapping;
  readonly classification?: ClassificationOverrides;
  readonly palette: PresetPaletteConfig;
  readonly macros: PresetMacros;
  readonly safety: PresetSafety;
}

export type ValidationResult = { ok: true; preset: Preset; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function isUnitInterval(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function checkPalette(palette: unknown, errors: string[]): void {
  if (!isRecord(palette)) {
    errors.push('champ "palette" absent ou mal formé');
    return;
  }
  const bg = palette.bg;
  if (!Array.isArray(bg) || bg.length !== 2 || !isHexColor(bg[0]) || !isHexColor(bg[1])) {
    errors.push('"palette.bg" doit être une paire de couleurs hexadécimales [#RRGGBB, #RRGGBB]');
  }
  for (const key of ['primary', 'secondary', 'accent', 'glow'] as const) {
    if (!isHexColor(palette[key])) errors.push(`"palette.${key}" doit être une couleur hexadécimale #RRGGBB`);
  }
  if (!isUnitInterval(palette.contrast)) errors.push('"palette.contrast" doit être dans [0,1]');
  const drift = palette.drift;
  if (!isRecord(drift) || !isHexColor(drift.lowEnergy) || !isHexColor(drift.highEnergy)) {
    errors.push('"palette.drift" doit contenir "lowEnergy" et "highEnergy" en couleurs hexadécimales');
  }
}

function checkMacros(macros: unknown, errors: string[]): void {
  if (!isRecord(macros)) {
    errors.push('champ "macros" absent ou mal formé');
    return;
  }
  for (const name of MACRO_NAMES) {
    if (!isUnitInterval(macros[name])) errors.push(`"macros.${name}" doit être dans [0,1]`);
  }
}

function checkGenre(genre: unknown, errors: string[]): void {
  if (!isRecord(genre)) {
    errors.push('champ "genre" absent ou mal formé');
    return;
  }
  const hint = genre.tempoHint;
  if (!Array.isArray(hint) || hint.length !== 2 || !isFiniteNumber(hint[0]) || !isFiniteNumber(hint[1]) || hint[0] > hint[1]) {
    errors.push('"genre.tempoHint" doit être une paire [min, max] croissante en BPM');
  }
  if (!isUnitInterval(genre.subDominance)) errors.push('"genre.subDominance" doit être dans [0,1]');
  if (!isUnitInterval(genre.onsetDensity)) errors.push('"genre.onsetDensity" doit être dans [0,1]');
  if (typeof genre.continuousRegimePreference !== 'boolean') errors.push('"genre.continuousRegimePreference" doit être un booléen');
}

/**
 * Vérifie la forme structurelle d'un preset (jamais un `Preset` déjà supposé
 * valide — c'est justement ce que cette fonction établit), sans jamais
 * lancer d'exception : un preset malformé produit `{ ok: false, errors }`.
 * Ne vérifie PAS la sémantique du câblage (`mapping`) ni des seuils de
 * classification — ces sous-objets sont des diffs partiels dont chaque champ
 * est optionnel par construction ; seuls les champs présents à la racine du
 * preset (identité, genre, palette, macros, safety) sont contrôlés.
 */
export function validatePreset(value: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(value)) {
    return { ok: false, errors: ['le preset doit être un objet JSON'], warnings };
  }

  if (typeof value.id !== 'string' || value.id.length === 0) errors.push('"id" absent ou vide');
  if (!isFiniteNumber(value.version)) errors.push('"version" doit être un nombre');
  if (typeof value.name !== 'string' || value.name.length === 0) errors.push('"name" absent ou vide');
  if (!STYLE_IDS.includes(value.style as StyleId)) errors.push(`"style" doit être l'un de ${STYLE_IDS.join(', ')}`);
  if (!isRecord(value.safety) || typeof value.safety.reducedFlashing !== 'boolean') {
    errors.push('"safety.reducedFlashing" doit être un booléen');
  }
  checkGenre(value.genre, errors);
  checkPalette(value.palette, errors);
  checkMacros(value.macros, errors);

  if (value.version !== PRESET_SCHEMA_VERSION) {
    warnings.push(`version de schéma ${String(value.version)} différente de celle supportée (${PRESET_SCHEMA_VERSION})`);
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return { ok: true, preset: value as unknown as Preset, warnings };
}
