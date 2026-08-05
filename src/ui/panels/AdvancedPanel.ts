/**
 * Panneau Avancé (docs/08_PRESETS.md §"Deux niveaux d'interface") : les 8
 * macro-contrôles, le choix de style, et le réglage de sécurité — 15 % des
 * utilisateurs. « Le câblage » et « les réglages par couche » du tableau de
 * docs/08 ne sont pas exposés ici : c'est exactement ce que couvre l'éditeur
 * JSON du preset (docs/08 : « remplace le mode Expert du brief initial »),
 * ouvert depuis ce panneau plutôt que dupliqué en contrôles.
 */
import { MACRO_NAMES, STYLE_IDS, type MacroName, type PresetMacros, type StyleId } from '../../presets/schema';
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

/** Seules ces deux macros ont un effet câblé aujourd'hui (docs/JOURNAL.md, Étape 13/P11). */
const WIRED_MACROS = new Set<MacroName>(['energy', 'reactivity']);

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

  constructor(callbacks: AdvancedPanelCallbacks) {
    this.styleSelect.addEventListener('change', () => callbacks.onStyleSelect(this.styleSelect.value as StyleId));
    this.reducedFlashingCheckbox.addEventListener('change', () => callbacks.onReducedFlashingChange(this.reducedFlashingCheckbox.checked));
    this.qualitySelect.addEventListener('change', () => callbacks.onQualitySelect(this.qualitySelect.value as QualityLevel));

    for (const name of MACRO_NAMES) {
      const label = document.createElement('label');
      const wired = WIRED_MACROS.has(name);
      label.textContent = MACRO_LABELS[name] + (wired ? '' : ' ⚠');

      const row = document.createElement('div');
      row.className = 'macro-row';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.01';
      input.title = wired ? '' : "sans effet visuel pour l'instant — à venir";
      input.addEventListener('input', () => callbacks.onMacroChange(name, Number(input.value)));
      this.macroInputs.set(name, input);

      row.appendChild(input);
      label.appendChild(row);
      this.macroGrid.appendChild(label);
    }
  }

  selectStyle(styleId: StyleId): void {
    if (STYLE_IDS.includes(styleId)) this.styleSelect.value = styleId;
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
