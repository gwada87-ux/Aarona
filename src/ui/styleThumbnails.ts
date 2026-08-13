/**
 * Vignettes de style (docs/17_PHASE2_VISUELS.md §10.1, chantier 10, lot A).
 *
 * §10.1 : « Des vignettes de style, pas une liste déroulante. »
 *
 * DE VRAIES IMAGES DU MOTEUR, PAS DES PICTOGRAMMES
 * ------------------------------------------------
 * Chaque vignette est rendue par le moteur lui-même : la vraie scène, le vrai
 * `Canvas2DRenderer`, la vraie palette du projet. Dessiner huit pictogrammes à
 * la main aurait été dix fois moins cher et faux dès la première retouche d'un
 * style — une vignette qui ment sur ce qu'elle montre est pire qu'une liste
 * déroulante honnête.
 *
 * L'autre bénéfice est immédiat : les vignettes suivent la PALETTE courante.
 * Choisir un style, c'est choisir une géométrie ; la voir dans ses propres
 * couleurs évite d'avoir à l'appliquer pour savoir de quoi il s'agit.
 *
 * POURQUOI UNE TIMELINE SYNTHÉTIQUE
 * ---------------------------------
 * Une scène ne se dessine pas sans `StepContext`, et il n'y a pas de morceau
 * chargé au démarrage. `buildDemoDoc` en fabrique un — le même que le bouton
 * « Charger une démo », donc déjà validé par `validatePmdi` et déjà porteur de
 * kicks, de snares et de sections.
 *
 * LE COÛT, ET COMMENT IL EST TENU
 * -------------------------------
 * Une scène doit être SIMULÉE avant d'être belle : les particules partent d'un
 * pool vide, le feedback d'un canvas noir. On avance donc `WARMUP_STEPS` pas de
 * simulation, dont les `DRAW_TAIL` derniers sont aussi dessinés — sans cette
 * queue, `field` et les styles à traînée rendraient une vignette vide.
 *
 * Trois garde-fous : le pool de particules est réduit au minimum, la vignette
 * fait 160 x 90, et le rendu n'a lieu QUE si le groupe « Visuel » est ouvert.
 * Mesure au navigateur dans le journal du chantier 10.
 */

import { Canvas2DRenderer } from '../render/canvas2d/Canvas2DRenderer';
import { createViewport } from '../render/Viewport';
import { buildMusicTimeline } from '../music/MusicTimeline';
import { StepContextBuilder } from '../music/StepContext';
import { BehaviourEngine } from '../behaviour/BehaviourEngine';
import { defaultMapping } from '../behaviour/mapping/defaults';
import { VisualDirector } from '../behaviour/VisualDirector';
import { stepSceneWithDrama } from '../visual/scene/dramaFrame';
import type { Scene } from '../visual/scene/Scene';
import type { Palette } from '../visual/palette/Palette';
import { FIXED_DT } from '../core/time/FixedStep';
import { buildDemoDoc } from './demoDoc';

/** Largeur de la vignette en pixels. La hauteur en découle par le rapport 16:9. */
export const THUMB_WIDTH = 160;
export const THUMB_HEIGHT = 90;

/**
 * Pas de simulation avant la capture, à 1/120 s. 240 pas = deux secondes de
 * musique : assez pour que les pools se remplissent et que deux mesures soient
 * passées, pas assez pour coûter.
 */
const WARMUP_STEPS = 240;
/** Images RÉELLEMENT dessinées, à la fin de la chauffe. Le feedback en a besoin. */
const DRAW_TAIL = 24;
/** Pool de particules minimal : une vignette de 160 px n'en montre pas davantage. */
const THUMB_PARTICLES = 200;
/** Durée du morceau synthétique, en secondes. Deux mesures suffisent largement. */
const DEMO_SEC = 12;
/**
 * Instant de DÉPART de la simulation, en secondes.
 *
 * Pas zéro : le début d'un morceau est une intro, et une vignette prise là
 * montre un cadre presque vide. `StepContext` étant une fonction pure de `t`
 * (Loi 1), démarrer à quatre secondes ne coûte rien - c'est le même nombre de
 * pas, simplement pris plus loin.
 */
const START_SEC = 4;

/**
 * Timeline synthétique partagée par les huit vignettes, construite une seule
 * fois. La reconstruire par style multiplierait par huit une validation PMDI
 * qui ne dépend d'aucun d'eux.
 */
let sharedTimeline: ReturnType<typeof buildMusicTimeline> | null = null;

function timeline(): ReturnType<typeof buildMusicTimeline> {
  if (!sharedTimeline) sharedTimeline = buildMusicTimeline(buildDemoDoc(DEMO_SEC));
  return sharedTimeline;
}

/**
 * Dessine dans `canvas` un aperçu du style produit par `factory`.
 *
 * Fonction PURE du couple (fabrique, palette, graine) : deux appels identiques
 * donnent le même pixel, comme le reste du moteur (Loi 1). La graine est celle
 * du projet, pour que la vignette montre la variante réellement active.
 */
export function renderStyleThumbnail(
  canvas: HTMLCanvasElement,
  factory: (maxParticles?: number, feedbackEnabled?: boolean) => Scene,
  palette: Palette,
  projectSeed: number,
): void {
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;

  // Canvas 2D DÉLIBÉRÉMENT, même depuis la bascule WebGL2 du lot 3
  // (ADR-013). Deux raisons, la première est décisive : un navigateur borne
  // le nombre de contextes WebGL vivants (~16) et tue le plus ancien au-delà.
  // Les huit vignettes sont redessinées à chaque changement de palette ou de
  // graine ; en WebGL2 elles consommeraient huit contextes par passe et
  // finiraient par faire perdre le sien à l'APERÇU. Ensuite, une vignette de
  // 160×90 ne montre ni halo étendu ni haute lumière : le « look » HDR du
  // lot 2 n'y est pas lisible, elle n'a donc rien à y gagner.
  const renderer = new Canvas2DRenderer(canvas);
  const viewport = createViewport(THUMB_WIDTH / THUMB_HEIGHT);
  const scene: Scene = factory(THUMB_PARTICLES, true);
  scene.init({ renderer, palette, cover: null });

  const tl = timeline();
  const stepper = new StepContextBuilder(tl, projectSeed);
  const behaviour = new BehaviourEngine(tl, defaultMapping);
  const director = new VisualDirector(tl);

  let t = START_SEC;
  for (let i = 0; i < WARMUP_STEPS; i++) {
    t += FIXED_DT;
    stepSceneWithDrama(scene, behaviour, director, stepper.build(t));
    // Les dernières images sont AUSSI dessinées : une couche à feedback part
    // d'un canvas noir et n'a de traînée qu'après plusieurs captures.
    if (i >= WARMUP_STEPS - DRAW_TAIL) {
      renderer.beginFrame(viewport);
      renderer.clear(palette.bg[1]);
      scene.draw(renderer, viewport);
      renderer.endFrame();
    }
  }

  scene.dispose();
}
