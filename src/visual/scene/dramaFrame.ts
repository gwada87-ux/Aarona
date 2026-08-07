/**
 * Point d'application UNIQUE de la dramaturgie (chantier 3,
 * docs/17_PHASE2_VISUELS.md §6.2 et §6.4).
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * `ui/App.ts` (preview) et `export/ExportPipeline.ts` (export) contiennent deux
 * boucles d'images indépendantes qui font la même chose. À l'Étape 25, les
 * macros de couche avaient été branchées dans la première et oubliées dans la
 * seconde : pendant plusieurs étapes, l'export ne produisait pas la même image
 * que l'aperçu, et personne ne l'a vu. L'Étape 26 a corrigé le trou en
 * extrayant `applyLayerMacrosToScene`, appelée des deux côtés.
 *
 * La dramaturgie présente exactement le même risque, en pire : un morceau
 * exporté sans elle serait plat de bout en bout, ce qui ne saute pas aux yeux
 * sur une vignette. D'où ces deux fonctions, qui remplacent chacune trois
 * lignes recopiées et donnent un seul endroit à changer.
 *
 * Emplacement : `visual/`, seule couche autorisée à importer à la fois
 * `render/` (l'interface `Renderer`) et `behaviour/` (les signaux). `behaviour/`
 * ne peut pas appliquer la caméra lui-même, la règle de dépendance lui
 * interdisant `render/`.
 */

import type { Color, Renderer } from '../../render/Renderer';
import type { Viewport } from '../../render/Viewport';
import { StepContextBuilder, type StepContext } from '../../music/StepContext';
import type { MusicTimeline } from '../../music/MusicTimeline';
import { BehaviourEngine } from '../../behaviour/BehaviourEngine';
import type { MappingSchema } from '../../behaviour/mapping/MappingSchema';
import { VisualDirector } from '../../behaviour/VisualDirector';
import { FIXED_DT } from '../../core/time/FixedStep';
import { isOverlayLayer, type BlendMode } from './Layer';
import type { Scene } from './Scene';

/**
 * Cadrage fixe venant de l'appelant, indépendant de la dramaturgie.
 *
 * Type STRUCTUREL et non `StyleVariant` : une variante est une notion de
 * preset, et `visual/` n'a pas le droit d'importer `presets/` — ce que
 * `architecture.test.ts` a refusé sur une première version. La contrainte a
 * produit une meilleure signature : ce module n'a besoin que d'un décalage et
 * d'une échelle, pas de savoir d'où ils viennent.
 */
export interface Framing {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly zoom: number;
}

/**
 * Automatisation résolue à l'instant courant (§7.3, chantier 10 lot D).
 *
 * Quatre nombres déjà évalués, pas les courbes : ce module n'a pas à savoir
 * qu'il existe des images-clés, et `Automation` vit dans `core/` justement pour
 * n'être lu que par ceux qui en ont besoin. Les valeurs NEUTRES sont 1 et 0,
 * de sorte que l'absence d'automatisation soit un no-op exact.
 */
export interface AutomationFrame {
  /** Multiplie l'amplitude et le niveau du budget de dramaturgie. 1 = neutre. */
  readonly intensity: number;
  readonly cameraX: number;
  readonly cameraY: number;
  /** Multiplie le zoom. 1 = neutre. */
  readonly cameraZoom: number;
}

export const NEUTRAL_AUTOMATION: AutomationFrame = Object.freeze({
  intensity: 1,
  cameraX: 0,
  cameraY: 0,
  cameraZoom: 1,
});

/**
 * Un pas de simulation, dramaturgie comprise.
 *
 * L'ordre compte : le budget est calculé AVANT la modulation, et la modulation
 * avant que la scène ne voie quoi que ce soit. Une couche ne sait rien de la
 * dramaturgie — elle réagit aux signaux, qui arrivent déjà dosés.
 */
export function stepSceneWithDrama(
  scene: Scene,
  behaviour: BehaviourEngine,
  director: VisualDirector,
  step: StepContext,
  automation: AutomationFrame = NEUTRAL_AUTOMATION,
): void {
  const budget = director.update(step);
  // L'automatisation est le DERNIER étage, après le preset, les macros et la
  // dramaturgie (§7.3 : « même position que les surcharges utilisateur de
  // `resolve.ts` »). Elle multiplie l'amplitude du budget plutôt que les signaux
  // un par un : `modulate` applique déjà `amplitude` à tout ce qui est une
  // frappe, et refaire ce dosage ici en dupliquerait la table - avec la
  // certitude qu'une des deux copies oublierait un signal au prochain ajout.
  const scaled =
    automation.intensity === 1
      ? budget
      : { ...budget, amplitude: budget.amplitude * automation.intensity, level: budget.level * automation.intensity };
  scene.update(step, director.modulate(behaviour.update(step), scaled));
}

/**
 * Ouverture d'image, caméra comprise.
 *
 * La caméra est posée APRÈS `clear` et AVANT le dessin : `applyShake` est un
 * décalage global qui n'affecte que ce qui vient ensuite. Poser la caméra avant
 * le `clear` décalerait le fond lui-même et laisserait une bande non peinte au
 * bord du cadre.
 *
 * Elle se compose avec le `ScreenShake` du style `pulse`, qui appelle
 * `applyShake` depuis sa couche : les deux transformations s'additionnent, ce
 * qui est le comportement voulu — la secousse est une modulation du cadrage,
 * pas un cadrage concurrent.
 */
/**
 * AMORCE une scène fraîche à l'instant `atSec`.
 *
 * LE DÉFAUT CORRIGÉ
 * -----------------
 * Une scène qui vient d'être construite est VIDE : pools de particules à zéro,
 * traînée noire, enveloppes au repos. Ses couches ne se remplissent que dans
 * `update()`, appelé uniquement quand le transport joue. Changer de style, de
 * palette ou de composition **en pause** laissait donc l'aperçu noir jusqu'à ce
 * qu'on relance la lecture.
 *
 * Mesuré au navigateur, style `pulse` en pause : 2 828 pixels clairs avant le
 * changement de style, **0 après**, 2 828 au retour au style d'origine, et
 * 10 858 après deux secondes de lecture. Le défaut est antérieur à la phase 2 —
 * il valait déjà pour le sélecteur de style — mais le compositeur de couches et
 * l'automatisation du chantier 10 le rendent visible en permanence.
 *
 * POURQUOI DES MOTEURS JETABLES
 * -----------------------------
 * `BehaviourEngine` est STATEFUL : ses enveloppes avancent de `step.dt` à chaque
 * `update`. Amorcer avec le moteur VIVANT ferait avancer ses enveloppes sans que
 * le temps avance — un accroc à la Loi 1, et c'est la raison pour laquelle ce
 * correctif avait été repoussé au chantier 10 lot C.
 *
 * Ici tout est jetable : un `StepContextBuilder`, un `BehaviourEngine` et un
 * `VisualDirector` neufs rejouent les deux dernières secondes, puis sont
 * abandonnés. Le moteur vivant n'est pas touché, et comme les deux partent de la
 * même graine et de la même table de câblage, ils s'accordent à `atSec`. La Loi 1
 * tient : l'état amorcé est une fonction pure de `atSec` et de la graine.
 *
 * C'est déjà le remède des vignettes de style (§10.1) et de l'export d'image
 * fixe (§7.12) — troisième usage, donc extrait ici.
 *
 * CE QUE L'AMORÇAGE NE FAIT PAS
 * -----------------------------
 * Il ne DESSINE pas : une couche à feedback repart donc d'un canevas noir et
 * reconstruit sa traînée sur les images suivantes. Délibéré — dessiner
 * demanderait un `Renderer` et un `Viewport`, et la boucle d'aperçu redessine de
 * toute façon dès l'image suivante.
 *
 * @returns le `VisualDirector` utilisé, dont le budget est celui de `atSec`.
 *   Un appelant qui va DESSINER juste après en a besoin : `openFrameWithCamera`
 *   lit `director.budget`, et un director neuf rendrait une caméra neutre — la
 *   dramaturgie disparaîtrait de l'image. Le rendre coûte une ligne et supprime
 *   la seule façon de se tromper ici.
 */
export function primeScene(
  scene: Scene,
  timeline: MusicTimeline,
  projectSeed: number,
  mapping: MappingSchema,
  atSec: number,
  automationAt: (t: number) => AutomationFrame = () => NEUTRAL_AUTOMATION,
  seconds: number = PRIME_SECONDS,
): VisualDirector {
  const stepper = new StepContextBuilder(timeline, projectSeed);
  const behaviour = new BehaviourEngine(timeline, mapping);
  const director = new VisualDirector(timeline);
  for (let t = Math.max(0, atSec - seconds); t < atSec; t += FIXED_DT) {
    stepSceneWithDrama(scene, behaviour, director, stepper.build(t), automationAt(t));
  }
  return director;
}

/** Secondes de simulation rejouées pour amorcer une scène. */
export const PRIME_SECONDS = 2;

/**
 * Cadrage de variante EFFECTIF pour cette scene (chantier 8).
 *
 * MESURE QUI A IMPOSE CETTE FONCTION
 * ----------------------------------
 * Au navigateur, un titre centre a sa taille par defaut etait COUPE au bord
 * droit du cadre sur la majorite des graines. Le decalage mesure du centre du
 * texte allait de -20 a +125 px sur un cadre de 893, et il suivait la graine :
 * c'est la variante qui deplacait tout, pas la mise en page.
 *
 * Le calcul le confirme. `STYLE_VARIANTS` va jusqu'a 0,17 de decalage et 1,30 de
 * zoom ; avec la derive de la dramaturgie par-dessus, la demi-largeur encore
 * visible tombe a (0,889 - 0,22) / 1,45 = 0,46, alors qu'un titre centre en
 * occupe 0,71. Un tiers du titre sort du cadre.
 *
 * LA REGLE
 * --------
 * Le cadrage de variante decrit un STYLE. Les habillages n'appartiennent a aucun
 * style (`withCover`, `withText`) : une scene qui en porte un garde donc le
 * cadrage NEUTRE. La camera de la dramaturgie, elle, reste - elle est dix fois
 * plus discrete (0,085 de derive, 1,12 de zoom au maximum) et c'est le morceau
 * qui la dicte, pas la graine. Un titre doit suivre le morceau, pas un tirage.
 *
 * Le remede n'est pas de rapetisser le texte : il faudrait le ramener a 55 % de
 * la largeur du cadre pour survivre au pire cadrage, ce qui reviendrait a
 * supprimer le titre plein cadre pour parer un cas de bord.
 */
export function framingFor(scene: Scene, framing: Framing | undefined): Framing | undefined {
  if (!framing) return undefined;
  return scene.layers.some(isOverlayLayer) ? undefined : framing;
}

export function openFrameWithCamera(
  renderer: Renderer,
  viewport: Viewport,
  clearColor: Color,
  director: VisualDirector,
  framing?: Framing,
  automation: AutomationFrame = NEUTRAL_AUTOMATION,
): void {
  renderer.beginFrame(viewport);
  renderer.clear(clearColor);
  const { cameraX, cameraY, cameraZoom } = director.budget;
  // La variante décale le point d'intérêt et rapproche ; la dramaturgie ajoute
  // sa dérive et sa poussée par-dessus. Les deux se COMPOSENT : la variante
  // dit d'où on regarde, la dramaturgie ce que le morceau fait au cadre.
  //
  // Les zooms se multiplient plutôt que de s'additionner — deux rapprochements
  // successifs sont un produit d'échelles, pas une somme. Le `Renderer` borne
  // le résultat à [1, 2] de toute façon (ADR-011).
  //
  // L'automatisation s'ajoute au bout de la même chaîne (§7.3, lot D) : la
  // variante dit d'où on regarde, la dramaturgie ce que le morceau fait au
  // cadre, l'automatisation ce que l'utilisateur a décidé à cet instant précis.
  // Elle est la dernière parce qu'elle est la plus explicite des trois.
  const dx = cameraX + (framing?.offsetX ?? 0) + automation.cameraX;
  const dy = cameraY + (framing?.offsetY ?? 0) + automation.cameraY;
  const zoom = cameraZoom * (framing?.zoom ?? 1) * automation.cameraZoom;
  if (dx !== 0 || dy !== 0 || zoom !== 1) renderer.applyCamera(dx, dy, zoom);
}

/**
 * Applique les modes de fusion d'une variante aux couches concernées (§7.2,
 * §7.10). À appeler une fois, après la construction de la scène — pas par
 * image : un mode de fusion est une propriété de couche, pas un état de trame.
 *
 * Remet explicitement à `undefined` les couches que la variante ne mentionne
 * pas. Sans ça, changer de variante laisserait en place les modes de la
 * précédente, et le style dériverait à chaque relance de graine.
 *
 * LES COUCHES D'HABILLAGE SONT EXCLUES (chantier 8). Une variante decrit un
 * STYLE ; la pochette et le texte n'appartiennent a aucun style, donc aucune
 * variante ne les mentionne, donc cette remise a `undefined` les frapperait
 * toutes les deux. Pour le texte, la consequence est nette : il declare
 * `blend = 'normal'` pour rester lisible, et sans cette exclusion il
 * redeviendrait additif au premier `applyLayerMacros()` - c'est-a-dire au
 * premier mouvement de curseur.
 */
export function applyLayerBlends(scene: Scene, blend: Readonly<Record<string, BlendMode>> | undefined): void {
  for (const layer of scene.layers) {
    if (isOverlayLayer(layer)) continue;
    layer.blend = blend?.[layer.id];
  }
}
