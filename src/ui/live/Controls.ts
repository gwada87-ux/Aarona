/**
 * Controles utilisateur (§4.5).
 *
 * « C'est ce qui separe un moteur VJ d'une demo - et le seul recours quand la
 * detection echoue. » Le tap tempo n'est pas un gadget : sur de la batterie
 * acoustique, du tempo libre ou un morceau sans kick, c'est la seule chose qui
 * remette une grille sous le visuel.
 *
 * Les reglages persistants sont dans `localStorage` sous une seule cle. Les
 * verrous et le tap tempo ne le sont PAS : ce sont des etats de session, et
 * retrouver une scene verrouillee au demarrage suivant serait une surprise
 * desagreable.
 *
 * Ce module ne connait ni le rendu ni l'analyse : il traduit des touches en
 * intentions, que le panneau applique.
 */

const STORAGE_KEY = 'live-visual-controls';

export type ControlAction =
  | { readonly type: 'tap'; readonly tSec: number }
  | { readonly type: 'auto-tempo' }
  | { readonly type: 'toggle-scene-lock' }
  | { readonly type: 'scene-step'; readonly direction: number }
  | { readonly type: 'toggle-palette-lock' }
  | { readonly type: 'palette-next' }
  | { readonly type: 'intensity'; readonly direction: number }
  | { readonly type: 'panic' }
  | { readonly type: 'toggle-help' }
  | { readonly type: 'toggle-hud' }
  | { readonly type: 'sync-trim'; readonly direction: number };

/** Reglages persistes. Volontairement minimal : ce qu'on veut retrouver, rien de plus. */
export interface PersistedControls {
  readonly userScale: number;
  readonly userTrimMs: number;
  readonly hudVisible: boolean;
}

const DEFAULTS: PersistedControls = { userScale: 1, userTrimMs: 0, hudVisible: false };

/** Table des raccourcis, source unique du panneau d'aide et de NOTES.md. */
export const SHORTCUTS: readonly { readonly key: string; readonly label: string }[] = Object.freeze([
  { key: 'Espace', label: 'tap tempo - 4 frappes imposent BPM et phase' },
  { key: 'A', label: 'retour au tempo automatique' },
  { key: 'L', label: 'verrou de scene - seules les variantes changent' },
  { key: 'fleches gauche/droite', label: 'scene precedente / suivante, a la mesure suivante' },
  { key: 'P', label: 'verrou de palette' },
  { key: 'Maj+P', label: 'palette suivante' },
  { key: '+ / -', label: 'intensite globale, 0,5 a 1,5' },
  { key: 'fleches haut/bas', label: 'reglage de synchro (userTrimMs)' },
  { key: 'Echap', label: 'panic - scene d attente, tous overlays coupes' },
  { key: 'D', label: 'HUD de debug' },
  { key: '?', label: 'cette aide' },
]);

/**
 * Traduit un evenement clavier en action. Retourne `null` si la touche n'est
 * pas un raccourci, ou si la frappe vise un champ de saisie - un VJ qui tape
 * un nom de fichier ne veut pas declencher un panic.
 */
export function actionForKey(event: KeyboardEvent, tSec: number): ControlAction | null {
  if (isTextEntry(event.target)) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;

  switch (event.key) {
    case ' ':
    case 'Spacebar':
      return { type: 'tap', tSec };
    case 'a':
    case 'A':
      return { type: 'auto-tempo' };
    case 'l':
    case 'L':
      return { type: 'toggle-scene-lock' };
    case 'ArrowRight':
      return { type: 'scene-step', direction: 1 };
    case 'ArrowLeft':
      return { type: 'scene-step', direction: -1 };
    case 'p':
      return { type: 'toggle-palette-lock' };
    case 'P':
      // Maj+P : palette suivante. `event.key` porte deja la casse.
      return { type: 'palette-next' };
    case '+':
    case '=':
      return { type: 'intensity', direction: 1 };
    case '-':
    case '_':
      return { type: 'intensity', direction: -1 };
    case 'ArrowUp':
      return { type: 'sync-trim', direction: 1 };
    case 'ArrowDown':
      return { type: 'sync-trim', direction: -1 };
    case 'Escape':
      return { type: 'panic' };
    case 'd':
    case 'D':
      return { type: 'toggle-hud' };
    case '?':
      return { type: 'toggle-help' };
    default:
      return null;
  }
}

/**
 * La frappe vise-t-elle un champ de saisie ? Un VJ qui tape un nom de fichier
 * ne veut pas declencher un panic.
 *
 * Le test porte sur `tagName` et non sur `instanceof HTMLInputElement` :
 * l'operateur `instanceof` LEVE si le global n'existe pas, ce qui rend la
 * fonction inutilisable partout ou il n'y a pas de DOM - a commencer par ses
 * propres tests. Une regle de securite qu'on ne peut pas tester n'en est pas
 * une.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el.isContentEditable === true;
}

/** Lecture tolerante : un `localStorage` corrompu ne doit pas empecher de demarrer. */
export function loadControls(): PersistedControls {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULTS;
    const record = parsed as Record<string, unknown>;
    return {
      userScale: typeof record.userScale === 'number' ? record.userScale : DEFAULTS.userScale,
      userTrimMs: typeof record.userTrimMs === 'number' ? record.userTrimMs : DEFAULTS.userTrimMs,
      hudVisible: typeof record.hudVisible === 'boolean' ? record.hudVisible : DEFAULTS.hudVisible,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveControls(value: PersistedControls): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Mode navigation privee, quota plein : le mode live doit continuer de
    // fonctionner sans persistance plutot que de lever.
  }
}
