/**
 * Variantes de cadrage (docs/17_PHASE2_VISUELS.md §7.10, chantier 4).
 *
 * POURQUOI DES VARIANTES PLUTÔT QUE DE NOUVEAUX STYLES
 * ---------------------------------------------------
 * Trois variantes sur huit styles font vingt-quatre images différentes pour le
 * coût de quelques constantes. C'est le meilleur rapport du catalogue, et le
 * mode live le fait déjà pour ses six scènes.
 *
 * OÙ ELLES VIVENT, ET POURQUOI PAS DANS LES COUCHES
 * ------------------------------------------------
 * Une variante ne touche AUCUNE couche. Deux raisons :
 *
 * 1. `applyLayerMacrosToScene` REMPLACE `layer.params` en entier à chaque
 *    résolution de preset. Tout réglage de variante qui passerait par `params`
 *    serait écrasé au prochain glissement de macro — silencieusement.
 * 2. Une variante est un point de vue, pas une géométrie. La caméra (ADR-011)
 *    et le mode de fusion (§7.2) suffisent à en exprimer l'essentiel, et ils
 *    s'appliquent uniformément à tous les styles, y compris ceux des chantiers
 *    5 et 6 qui n'existent pas encore.
 *
 * LE ZOOM NE DESCEND JAMAIS SOUS 1
 * --------------------------------
 * Le `Renderer` le borne à [1, 2] (ADR-011) : sous 1 le cadrage découvrirait
 * les bords. « Plan large » est donc la valeur par défaut et « plan rapproché »
 * un zoom supérieur — l'inverse de la formulation habituelle, mais la seule
 * réalisable sans repenser tous les fonds.
 *
 * POURQUOI DANS `presets/` ET NON DANS `visual/`
 * ---------------------------------------------
 * Première version écrite dans `visual/styles/`, refusée par
 * `architecture.test.ts` : `visual/` n'a pas le droit d'importer `presets/`, or
 * une variante est indexée par identifiant de STYLE, qui est une notion de
 * preset. Le test avait raison sur le fond — `visual/` dessine, il n'a pas à
 * savoir quels styles le catalogue expose. Déplacé ici, à côté de
 * `layerMacros.ts`, qui fait exactement le même travail de traduction
 * « réglage de preset → configuration de rendu ».
 */

import { hash } from '../core/rng/hash';
import type { BlendMode } from '../visual/scene/Layer';
import type { StyleId } from './schema';

export interface StyleVariant {
  /** Nom lisible, affiché au HUD et dans les rapports. */
  readonly name: string;
  /** Décalage du point d'intérêt, en coordonnées normalisées (Loi 4). */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Rapprochement. 1 = plan large (défaut). */
  readonly zoom: number;
  /** Modes de fusion par identifiant de couche. Absent = comportement historique. */
  readonly blend?: Readonly<Record<string, BlendMode>>;
}

/**
 * Deux à trois variantes par style. Règle de composition de §8, tenue ici :
 * **au plus une variante sur trois est centrée**, et chaque style expose au
 * moins une variante dont le point d'intérêt tombe hors centre, près d'un
 * point fort du tiers (±0,17 en unités normalisées).
 */
export const STYLE_VARIANTS: Readonly<Record<StyleId, readonly StyleVariant[]>> = Object.freeze({
  pulse: Object.freeze([
    { name: 'centré', offsetX: 0, offsetY: 0, zoom: 1 },
    // Les anneaux poussés vers la gauche laissent respirer la droite du cadre.
    { name: 'tiers gauche', offsetX: 0.17, offsetY: -0.05, zoom: 1.12 },
    // `screen` sur la forme d'onde : elle éclaircit sans saturer comme
    // l'additif, ce qui la garde lisible par-dessus le halo central.
    {
      name: 'rapproché haut',
      offsetX: -0.12,
      offsetY: 0.14,
      zoom: 1.22,
      blend: Object.freeze({ circularWaveform: 'screen' as BlendMode }),
    },
  ]),
  field: Object.freeze([
    { name: 'plan large', offsetX: 0, offsetY: 0, zoom: 1 },
    // Point de fuite décentré : le champ file en diagonale au lieu de converger
    // au milieu de l'écran.
    { name: 'fuite basse', offsetX: -0.15, offsetY: -0.17, zoom: 1.15 },
  ]),
  monolith: Object.freeze([
    // Aucune variante centrée : la masse est déjà décentrée dans la couche, et
    // la recentrer par la caméra annulerait le cadrage voulu.
    { name: 'contre-plongée', offsetX: 0.1, offsetY: -0.12, zoom: 1.1 },
    { name: 'de face, serré', offsetX: 0.14, offsetY: 0.02, zoom: 1.28 },
  ]),
  'iso-pulse': Object.freeze([
    { name: 'plan large', offsetX: 0, offsetY: 0, zoom: 1 },
    // Grille poussée en bas : la moitié haute reste libre, ce qu'un habillage
    // de titre demande.
    { name: 'grille basse', offsetX: 0, offsetY: -0.14, zoom: 1.16 },
    // `screen` sur la grille : elle éclaircit le duotone sans le saturer comme
    // le ferait l'additif sur une trame aussi dense.
    {
      name: 'diagonale',
      offsetX: -0.17,
      offsetY: 0.06,
      zoom: 1.2,
      blend: Object.freeze({ isoGrid: 'screen' as BlendMode }),
    },
  ]),
  chambre: Object.freeze([
    // Aucun rapprochement fort : serrer le cadre sur un style dont le sujet est
    // l'espace vide entre les poussières le viderait de son intérêt.
    { name: 'faisceau large', offsetX: 0.08, offsetY: 0, zoom: 1 },
    { name: 'contre-jour', offsetX: -0.15, offsetY: 0.1, zoom: 1.12 },
  ]),
  eclats: Object.freeze([
    { name: 'plein cadre', offsetX: 0, offsetY: 0, zoom: 1 },
    // Recentrage sur le point d'impact, qui est décalé dans la couche.
    { name: 'sur l\'impact', offsetX: -0.14, offsetY: 0.08, zoom: 1.3 },
    // `difference` NON retenu ici malgré la tentation : il produit des sauts de
    // luminance que le `FlashLimiter` écrêterait en permanence sur un break à
    // 174 BPM, et le critère 13 n'a pas encore pu être mesuré (voir journal).
    { name: 'décentré bas', offsetX: 0.16, offsetY: -0.12, zoom: 1.18 },
  ]),
  aurore: Object.freeze([
    { name: 'horizon', offsetX: 0, offsetY: 0, zoom: 1 },
    { name: 'rubans hauts', offsetX: -0.1, offsetY: -0.17, zoom: 1.14 },
  ]),
  'spectrum-pro': Object.freeze([
    { name: 'plan large', offsetX: 0, offsetY: 0, zoom: 1 },
    // Barres poussées en bas de cadre : la moitié haute reste vide, ce qui est
    // exactement ce qu'un habillage de titre demande.
    {
      name: 'barres basses',
      offsetX: 0,
      offsetY: -0.17,
      zoom: 1.18,
      blend: Object.freeze({ flatWaveform: 'screen' as BlendMode }),
    },
  ]),
});

/**
 * Variante retenue pour un style et une graine de projet.
 *
 * Dérivée de la GRAINE, donc changée par le bouton « relancer » (§7.9) : c'est
 * ce qui donne une variation immédiate sur le même style, le même preset et la
 * même musique. Déterministe (Loi 1) : la même graine redonne la même variante,
 * en preview comme à l'export.
 *
 * Le sel `1` distingue ce tirage de ceux du `StepContext`, qui utilisent
 * l'index de sous-pas — sans lui, la variante suivrait la première image.
 */
export function variantFor(styleId: StyleId, projectSeed: number): StyleVariant {
  const list = STYLE_VARIANTS[styleId];
  const index = hash(projectSeed, 1) % list.length;
  return list[index]!;
}
