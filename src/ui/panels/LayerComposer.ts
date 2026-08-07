/**
 * Compositeur de couches — l'interface (docs/17_PHASE2_VISUELS.md §7.7,
 * chantier 10 lot C). La logique est dans `visual/scene/composeLayers.ts`.
 *
 * Une ligne par couche du style courant : une case pour l'activer, deux flèches
 * pour la déplacer. Rien de plus — un glisser-déposer aurait demandé de gérer
 * le pointeur, le clavier et le lecteur d'écran à la main, pour un gain nul sur
 * une liste de six éléments.
 *
 * LES COUCHES VERROUILLÉES LE DISENT
 * ----------------------------------
 * `mustDrawFirst` empêche déjà l'ordre invalide côté moteur. Si l'interface se
 * contentait de le corriger en silence, l'utilisateur verrait sa flèche ne rien
 * faire et conclurait que le bouton est cassé. La ligne est donc marquée d'un
 * cadenas et ses flèches sont désactivées : la contrainte se lit avant d'être
 * rencontrée.
 */

import type { Layer } from '../../visual/scene/Layer';
import type { LayerComposition } from '../../visual/scene/composeLayers';

/**
 * Nom lisible par couche. Les identifiants (`perspectiveGrid`, `centralGlow`)
 * sont ceux du code ; les montrer tels quels ferait de ce panneau une fenêtre
 * sur l'implémentation. Une couche absente de la table retombe sur son
 * identifiant plutôt que de disparaître.
 */
const LAYER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  background: 'Fond',
  animatedDuotone: 'Fond bichrome',
  deepVignette: 'Vignettage',
  auroraRibbons: 'Rubans',
  isoGrid: 'Maille isométrique',
  perspectiveGrid: 'Grille en perspective',
  monolithMass: 'Masse',
  pulseRings: 'Anneaux',
  shatterCells: 'Éclats',
  centralGlow: 'Halo central',
  dustChamber: 'Poussière',
  particleField: 'Particules',
  frameFeedback: 'Traînée',
  screenShake: 'Secousse',
  spectrumBars: 'Barres de spectre',
  circularWaveform: 'Onde circulaire',
  flatWaveform: 'Onde plate',
});

export interface LayerComposerCallbacks {
  readonly onToggle: (layerId: string, enabled: boolean) => void;
  /** `delta` vaut -1 (monter) ou +1 (descendre). */
  readonly onMove: (layerId: string, delta: number) => void;
}

export class LayerComposer {
  private readonly container: HTMLElement;
  private readonly callbacks: LayerComposerCallbacks;

  constructor(container: HTMLElement, callbacks: LayerComposerCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  /**
   * Reconstruit la liste depuis les couches RÉELLEMENT composées — pas depuis
   * la fabrique du style : l'utilisateur doit voir l'ordre qui est dessiné,
   * correction de `mustDrawFirst` comprise.
   */
  render(layers: readonly Layer[], enabled: LayerComposition, disabled: readonly string[]): void {
    this.container.replaceChildren();
    const total = layers.length;
    layers.forEach((layer, index) => {
      // La flèche « monter » est aussi désactivée quand la couche AU-DESSUS est
      // verrouillée : sans ça, le clic échangerait les deux et `composeLayers`
      // remettrait aussitôt la verrouillée en tête. Le bouton ne ferait rien, ce
      // qui se lit comme un bouton cassé.
      const bloqueEnHaut = index === 0 || layers[index - 1]?.mustDrawFirst === true;
      this.container.appendChild(this.row(layer, index, total, enabled[layer.id] !== false, bloqueEnHaut));
    });
    // Les couches retirées disparaîtraient de la liste — donc de toute
    // possibilité de les rallumer. Elles restent, grisées, à la fin.
    for (const id of disabled) {
      this.container.appendChild(this.disabledRow(id));
    }
  }

  private row(layer: Layer, index: number, total: number, isEnabled: boolean, bloqueEnHaut: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'layer-row';
    row.dataset.layerId = layer.id;

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = isEnabled;
    check.addEventListener('change', () => this.callbacks.onToggle(layer.id, check.checked));

    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = LAYER_LABELS[layer.id] ?? layer.id;

    const up = this.arrow('▲', 'Monter', () => this.callbacks.onMove(layer.id, -1));
    const down = this.arrow('▼', 'Descendre', () => this.callbacks.onMove(layer.id, 1));

    if (layer.mustDrawFirst === true) {
      row.classList.add('verrouille');
      name.textContent += ' 🔒';
      up.disabled = true;
      down.disabled = true;
      up.title = down.title = 'Cette couche agit sur tout ce qui est dessiné après elle : elle reste en tête.';
    } else {
      up.disabled = bloqueEnHaut;
      down.disabled = index === total - 1;
    }

    row.append(check, name, up, down);
    return row;
  }

  private disabledRow(id: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'layer-row retiree';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = false;
    check.addEventListener('change', () => this.callbacks.onToggle(id, true));
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = LAYER_LABELS[id] ?? id;
    row.append(check, name);
    return row;
  }

  private arrow(glyph: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'layer-arrow';
    button.textContent = glyph;
    button.title = title;
    button.addEventListener('click', onClick);
    return button;
  }
}
