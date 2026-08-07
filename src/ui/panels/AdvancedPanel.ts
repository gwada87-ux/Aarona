/**
 * Panneau Avancé (docs/08_PRESETS.md §"Deux niveaux d'interface") : les 8
 * macro-contrôles, le choix de style, et le réglage de sécurité — 15 % des
 * utilisateurs. « Le câblage » et « les réglages par couche » du tableau de
 * docs/08 ne sont pas exposés ici : c'est exactement ce que couvre l'éditeur
 * JSON du preset (docs/08 : « remplace le mode Expert du brief initial »),
 * ouvert depuis ce panneau plutôt que dupliqué en contrôles.
 */
import { MACRO_NAMES, STYLE_IDS, STYLE_LABELS, type MacroName, type PresetMacros, type StyleId } from '../../presets/schema';
import { QUALITY_LEVELS, type QualityLevel } from '../../perf/qualityLevels';

const MACRO_LABELS: Readonly<Record<MacroName, string>> = {
  energy: 'Énergie',
  reactivity: 'Réactivité',
  density: 'Densité',
  movement: 'Mouvement',
  depth: 'Profondeur',
  glow: 'Glow',
  chaos: 'Chaos',
  smoothness: 'Douceur',
};

/**
 * Macros SANS EFFET pour un style donné, par style. Les 8 macros sont toutes
 * câblées depuis l'Étape 20, mais `presets/layerMacros.ts` n'a aucune entrée
 * `pulse.*` pour `depth` : le style est délibérément plat/2D, il n'y a rien à
 * quoi accrocher une sensation de profondeur.
 *
 * Jusqu'au chantier 1 de la phase 2, ce cas n'était signalé nulle part dans
 * l'interface. Le fichier portait bien un mécanisme d'avertissement — un badge
 * `⚠` et une infobulle — mais il testait `WIRED_MACROS = new Set(MACRO_NAMES)`,
 * donc un ensemble contenant TOUTES les macros : la condition était
 * constamment vraie et l'avertissement inatteignable. L'utilisateur voyait un
 * curseur Profondeur parfaitement normal qui ne faisait rien.
 *
 * L'avertissement dépend maintenant du STYLE COURANT, ce qui est la seule
 * forme utile : une macro peut agir dans un style et pas dans un autre.
 */
const INERT_MACROS: Readonly<Record<StyleId, readonly MacroName[]>> = Object.freeze({
  pulse: Object.freeze(['depth'] as const),
  field: Object.freeze([] as const),
  'spectrum-pro': Object.freeze([] as const),
  // Styles du chantier 5. Quatre macros sur six sont câblées ; les deux autres
  // n'ont pas de paramètre auquel s'accrocher sans dénaturer le style :
  // `monolith` n'a ni densité (une seule masse) ni lissage (rien ne se lisse,
  // c'est le principe), `iso-pulse` n'a pas de chaos — l'origine des ondes est
  // déjà hachée — ni de lissage, la maille étant rigide par construction.
  monolith: Object.freeze(['density', 'smoothness'] as const),
  'iso-pulse': Object.freeze(['chaos', 'smoothness'] as const),
  // Styles du chantier 6. Même discipline : on déclare inerte plutôt que de
  // câbler de force une macro sur un paramètre qui trahirait le style.
  // `chambre` n'a pas de chaos — rien n'y est brusque, c'est sa définition — ni
  // de profondeur, la scène étant volontairement plate. `eclats` n'a pas de
  // densité (la partition est figée à l'initialisation) ni de lissage (il se
  // casse, il ne s'adoucit pas). `aurore` n'a ni chaos ni profondeur : le bruit
  // simplex porte déjà l'irrégularité, et les rubans sont un aplat superposé.
  chambre: Object.freeze(['chaos', 'depth'] as const),
  eclats: Object.freeze(['density', 'smoothness'] as const),
  aurore: Object.freeze(['chaos', 'depth'] as const),
});

export interface AdvancedPanelCallbacks {
  readonly onStyleSelect: (styleId: StyleId) => void;
  readonly onMacroChange: (name: MacroName, value: number) => void;
  readonly onReducedFlashingChange: (reduced: boolean) => void;
  /** Choix manuel d'un niveau de qualité (docs/10_PERFORMANCE.md) — devient le nouveau plafond du `QualityGovernor`. */
  readonly onQualitySelect: (level: QualityLevel) => void;
}

export class AdvancedPanel {
  private readonly styleSelect = document.querySelector<HTMLSelectElement>('#style-select')!;
  private readonly macroGrid = document.querySelector<HTMLElement>('#macro-grid-advanced')!;
  private readonly reducedFlashingCheckbox = document.querySelector<HTMLInputElement>('#reduced-flashing')!;
  private readonly qualitySelect = document.querySelector<HTMLSelectElement>('#quality-select')!;
  private readonly macroInputs = new Map<MacroName, HTMLInputElement>();
  private readonly macroLabels = new Map<MacroName, HTMLLabelElement>();
  /** Nœud texte du libellé, muté en place par `refreshInertMarks`. */
  private readonly macroCaptions = new Map<MacroName, Text>();
  private currentStyle: StyleId = STYLE_IDS[0];

  constructor(callbacks: AdvancedPanelCallbacks) {
    // Catalogue de styles construit depuis `STYLE_IDS`, plus écrit en dur dans
    // `index.html` : ajouter un style ne demande donc plus de toucher au HTML.
    for (const id of STYLE_IDS) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = STYLE_LABELS[id];
      this.styleSelect.appendChild(option);
    }
    this.styleSelect.value = this.currentStyle;

    this.styleSelect.addEventListener('change', () => {
      this.currentStyle = this.styleSelect.value as StyleId;
      this.refreshInertMarks();
      callbacks.onStyleSelect(this.currentStyle);
    });
    this.reducedFlashingCheckbox.addEventListener('change', () => callbacks.onReducedFlashingChange(this.reducedFlashingCheckbox.checked));
    this.qualitySelect.addEventListener('change', () => callbacks.onQualitySelect(this.qualitySelect.value as QualityLevel));

    for (const name of MACRO_NAMES) {
      const label = document.createElement('label');
      const caption = document.createTextNode(MACRO_LABELS[name]);
      label.appendChild(caption);

      const row = document.createElement('div');
      row.className = 'macro-row';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.01';
      input.addEventListener('input', () => callbacks.onMacroChange(name, Number(input.value)));
      this.macroInputs.set(name, input);
      this.macroLabels.set(name, label);
      this.macroCaptions.set(name, caption);

      row.appendChild(input);
      label.appendChild(row);
      this.macroGrid.appendChild(label);
    }
    this.refreshInertMarks();
  }

  /**
   * Marque les macros sans effet DANS LE STYLE COURANT. Le curseur reste
   * manœuvrable à dessein : sa valeur est enregistrée dans le preset et
   * reprendra son effet dès qu'un style qui l'exploite sera choisi. Le griser
   * ferait croire qu'il est cassé.
   */
  private refreshInertMarks(): void {
    const inert = INERT_MACROS[this.currentStyle];
    for (const name of MACRO_NAMES) {
      const label = this.macroLabels.get(name);
      const input = this.macroInputs.get(name);
      const caption = this.macroCaptions.get(name);
      if (!label || !input || !caption) continue;
      const isInert = inert.includes(name);
      // Nœud texte DÉDIÉ, muté en place. Retirer `childNodes[0]` serait faux :
      // au premier appel le premier enfant est la ligne du curseur, pas un
      // texte — on supprimerait le curseur lui-même.
      caption.nodeValue = MACRO_LABELS[name] + (isInert ? ' ⚠' : '');
      input.title = isInert ? `sans effet en style ${STYLE_LABELS[this.currentStyle]}` : '';
    }
  }

  selectStyle(styleId: StyleId): void {
    if (!STYLE_IDS.includes(styleId)) return;
    this.styleSelect.value = styleId;
    this.currentStyle = styleId;
    this.refreshInertMarks();
  }

  setMacros(macros: PresetMacros): void {
    for (const name of MACRO_NAMES) {
      const input = this.macroInputs.get(name);
      if (input) input.value = String(macros[name]);
    }
  }

  setReducedFlashing(reduced: boolean): void {
    this.reducedFlashingCheckbox.checked = reduced;
  }

  /** Reflète dans le sélecteur un niveau atteint automatiquement (`QualityGovernor`) ou restauré depuis un projet. */
  selectQuality(level: QualityLevel): void {
    if (QUALITY_LEVELS.includes(level)) this.qualitySelect.value = level;
  }
}
