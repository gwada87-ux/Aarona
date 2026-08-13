/**
 * Choix du backend de rendu (ADR-013, lot 3 — la bascule). Fonctions PURES,
 * sans canvas ni contexte : c'est la seule partie de la décision qui se teste
 * en Node, et c'est celle qui porte la règle produit.
 *
 * La règle, en une phrase : **WebGL2 quand il est disponible, Canvas 2D
 * sinon, et jamais d'échec.** Une capacité absente ne doit pas arrêter le
 * rendu (même esprit que la Loi 3) — c'est pourquoi `chooseBackend` ne peut
 * PAS retourner `webgl2` quand il n'est pas disponible, y compris si
 * l'utilisateur l'a explicitement demandé par l'URL : forcer un backend
 * absent ne donnerait pas une erreur utile, seulement un écran noir.
 */

export type RendererBackend = 'webgl2' | 'canvas2d';

/** Choix explicite de l'utilisateur (`?renderer=`) ; `undefined` = automatique. */
export type RendererOverride = RendererBackend | undefined;

/** Lit le paramètre d'URL `renderer`. Toute valeur inconnue est ignorée (= automatique). */
export function parseRendererOverride(value: string | null | undefined): RendererOverride {
  return value === 'webgl2' || value === 'canvas2d' ? value : undefined;
}

/**
 * `webgl2Available` : la capacité est-elle présente dans cet environnement ?
 * Sonde bon marché (voir `isWebGL2Available`) — la construction réelle peut
 * malgré tout échouer (pilote sur liste noire), d'où le `try` de
 * `createRenderer`. Les deux protections sont nécessaires : celle-ci évite de
 * tenter l'impossible, l'autre rattrape l'imprévu.
 */
export function chooseBackend(override: RendererOverride, webgl2Available: boolean): RendererBackend {
  if (override === 'canvas2d') return 'canvas2d';
  return webgl2Available ? 'webgl2' : 'canvas2d';
}

/**
 * Sonde de capacité SANS créer de contexte : un contexte WebGL occupe un des
 * ~16 emplacements du navigateur, et en créer un juste pour poser la question
 * coûterait précisément la ressource qu'on cherche à préserver (voir
 * `WebGL2Renderer.dispose`).
 */
export function isWebGL2Available(): boolean {
  return typeof WebGL2RenderingContext !== 'undefined';
}
