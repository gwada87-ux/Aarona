/**
 * `prefers-reduced-motion` — charge de mouvement déclarée par style, et liste
 * des styles autorisés sous cette préférence (docs/17 §12, critère 14 : « la
 * liste des styles autorisés reste non vide et aucun d'eux ne stroboscope »).
 *
 * ## Pourquoi une déclaration, et pas une mesure à l'exécution
 *
 * Mesurer le mouvement au vol demanderait de lire le canevas image par image —
 * un `getImageData` par trame, exactement ce que docs/10 interdit. La charge est
 * donc DÉCLARÉE ici, à partir d'une mesure faite une fois, et le tableau est
 * typé `Record<StyleId, …>` pour que le compilateur réclame une décision dès
 * qu'un style est ajouté. Même raison que `STYLE_LABELS` dans `schema.ts` :
 * une donnée par style qui vit ailleurs est une donnée qui dérive.
 *
 * ## Les chiffres, et comment ils ont été obtenus
 *
 * Piste de démonstration, 180 images pilotées une par une après 60 images de
 * chauffe, `prefers-reduced-motion` simulé actif. Deux instruments, tous deux
 * validés par un témoin (image identique -> 0 ; noir vers blanc -> 1) :
 *
 * - **Écart de luminance** : copie exacte de `FlashLimiter.measureLuminance`
 *   (32x18, luma Rec. 709), différence image à image. C'est la définition du
 *   clignotement que le projet applique déjà.
 * - **Mouvement** : différence absolue moyenne par composante sur 64x36. La
 *   luminance moyenne est AVEUGLE au mouvement — `eclats` peut fracasser
 *   l'image sans déplacer sa moyenne d'un pouce. Il fallait les deux.
 *
 * | style          | écart lum. max | mouvement p95 | mouvement max |
 * |----------------|----------------|---------------|---------------|
 * | `chambre`      | 0,0022         | **0,0022**    | 0,0061        |
 * | `monolith`     | 0,0202         | 0,0097        | 0,0325        |
 * | `aurore`       | 0,0022         | 0,0106        | 0,0390        |
 * | `spectrum-pro` | 0,0118         | 0,0119        | 0,0212        |
 * | `iso-pulse`    | 0,0064         | 0,0149        | 0,0190        |
 * | `pulse`        | 0,0063         | 0,0155        | 0,0271        |
 * | `field`        | 0,0037         | 0,0179        | 0,0431        |
 * | `eclats`       | 0,0344         | **0,0392**    | 0,0818        |
 *
 * **Aucun style ne clignote** : le plus agité, `eclats`, plafonne à 0,0344
 * d'écart de luminance, soit **cinq fois sous le seuil de 0,18** de
 * `REDUCED_FLASHING_MODE`, et le plus calme est quatre-vingts fois dessous.
 * Le critère 14 est donc satisfait sur sa seconde moitié par la mesure, pas par
 * une exclusion.
 *
 * Le MOUVEMENT, lui, varie d'un facteur **dix-huit** entre `chambre` (0,0022) et
 * `eclats` (0,0392), et c'est là que se joue `prefers-reduced-motion` : la
 * préférence porte sur le mouvement, pas sur le flash. Les deux seuils retenus
 * tombent dans les deux vrais écarts de la série — `chambre` est quatre fois
 * plus calme que le suivant, `eclats` deux fois plus agité que le précédent.
 * Ce ne sont pas des valeurs rondes choisies d'avance, ce sont les trous.
 *
 * ## Ce que la mesure NE dit pas
 *
 * Tout ceci est relevé sur la piste de démonstration, qui est douce. Le chantier
 * 6 redoutait `eclats` sur un morceau à breaks rapides, et ce cas n'a jamais été
 * mesuré. La classification ci-dessous est donc un plancher de prudence, pas un
 * classement définitif.
 */
import { STYLE_IDS, type StyleId } from './schema';

/**
 * Charge de mouvement d'un style, telle que mesurée.
 *
 * - `calme` — utilisable sans réserve. `docs/17` §9 le dit déjà de `chambre` :
 *   « Doit passer `prefers-reduced-motion` sans modification. » La mesure, faite
 *   sans regarder cette phrase, le désigne effectivement comme le plus calme des
 *   huit, et de loin. C'est le seul recoupement indépendant dont je dispose sur
 *   ce fichier.
 * - `modere` — mouvement ordinaire. Autorisé : rien ne justifie de retirer six
 *   styles sur huit à un utilisateur sur la foi d'une seule piste.
 * - `agite` — mouvement soutenu. NON proposé d'office sous la préférence, mais
 *   jamais retiré du choix manuel (voir `REDUCED_MOTION_STYLES`).
 */
export type MotionLoad = 'calme' | 'modere' | 'agite';

/**
 * `Record<StyleId, MotionLoad>` : ajouter un style ne compilera pas tant que sa
 * charge de mouvement n'aura pas été décidée. C'est le seul garde-fou qui
 * survive à l'oubli.
 */
export const STYLE_MOTION_LOAD: Readonly<Record<StyleId, MotionLoad>> = Object.freeze({
  chambre: 'calme',
  monolith: 'modere',
  aurore: 'modere',
  'spectrum-pro': 'modere',
  'iso-pulse': 'modere',
  pulse: 'modere',
  field: 'modere',
  eclats: 'agite',
});

/**
 * Styles proposés d'office quand `prefers-reduced-motion` est actif.
 *
 * **Autorisé ne veut pas dire imposé.** Cette liste sert à ce que
 * l'application CHOISIT pour l'utilisateur — la suggestion de preset à
 * l'import. Un utilisateur qui clique lui-même sur `eclats` l'obtient, avec sa
 * préférence système active : c'est son geste, et le lui refuser serait décider
 * à sa place ce qu'il peut regarder.
 *
 * Dérivée de `STYLE_MOTION_LOAD` plutôt qu'écrite à la main : deux listes qui
 * disent la même chose finissent toujours par se contredire.
 */
export const REDUCED_MOTION_STYLES: readonly StyleId[] = Object.freeze(
  STYLE_IDS.filter((id) => STYLE_MOTION_LOAD[id] !== 'agite'),
);

/** Le style le plus calme mesuré — le repli quand rien d'autre ne convient. */
export const CALMEST_STYLE: StyleId = 'chambre';

export function isReducedMotionSafe(id: StyleId): boolean {
  return STYLE_MOTION_LOAD[id] !== 'agite';
}

/**
 * Style à retenir quand l'APPLICATION choisit à la place de l'utilisateur.
 *
 * Sans préférence active, ou si le style visé est déjà autorisé, il est rendu
 * tel quel — la préférence ne doit rien changer au cas ordinaire. Sinon, repli
 * sur le plus calme mesuré.
 */
export function pickReducedMotionStyle(preferred: StyleId, reducedMotion: boolean): StyleId {
  if (!reducedMotion || isReducedMotionSafe(preferred)) return preferred;
  return CALMEST_STYLE;
}
