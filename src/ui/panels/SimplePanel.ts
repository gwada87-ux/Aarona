/**
 * Panneau Simple (docs/08_PRESETS.md §"Deux niveaux d'interface") : preset +
 * palette + 3 macros (Énergie, Densité, Glow) + format d'export — 85 % des
 * utilisateurs. Densité/Glow affichées mais honnêtement annoncées comme
 * sans effet visuel pour l'instant (docs/JOURNAL.md, Étape 13/P11 : seules
 * `energy`/`reactivity` sont câblées) — le HTML statique (index.html) porte
 * déjà l'avertissement, ce module ne fait qu'y raccorder le comportement.
 */
import type { Palette } from '../../visual/palette/Palette';
import type { Preset, PresetMacros } from '../../presets/schema';
import type { SuggestResult } from '../../presets/suggest';

export interface SimplePanelCallbacks {
  readonly onPresetSelect: (presetId: string | null) => void;
  readonly onMacroChange: (name: 'energy' | 'density' | 'glow', value: number) => void;
  readonly onExportFormatChange: (formatId: string) => void;
}

function colorToCss(color: { r: number; g: number; b: number }): string {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
}

export class SimplePanel {
  private readonly presetSelect = document.querySelector<HTMLSelectElement>('#preset-select')!;
  private readonly suggestionEl = document.querySelector<HTMLElement>('#preset-suggestion')!;
  private readonly paletteSwatch = document.querySelector<HTMLElement>('#palette-swatch')!;
  private readonly energyInput = document.querySelector<HTMLInputElement>('#macro-energy-simple')!;
  private readonly densityInput = document.querySelector<HTMLInputElement>('#macro-density-simple')!;
  private readonly glowInput = document.querySelector<HTMLInputElement>('#macro-glow-simple')!;
  private readonly exportFormatSelect = document.querySelector<HTMLSelectElement>('#export-format-simple')!;

  constructor(callbacks: SimplePanelCallbacks) {
    this.presetSelect.addEventListener('change', () => callbacks.onPresetSelect(this.presetSelect.value || null));
    this.energyInput.addEventListener('input', () => callbacks.onMacroChange('energy', Number(this.energyInput.value)));
    this.densityInput.addEventListener('input', () => callbacks.onMacroChange('density', Number(this.densityInput.value)));
    this.glowInput.addEventListener('input', () => callbacks.onMacroChange('glow', Number(this.glowInput.value)));
    this.exportFormatSelect.addEventListener('change', () => callbacks.onExportFormatChange(this.exportFormatSelect.value));
  }

  setPresetCatalog(presets: readonly Preset[]): void {
    for (const preset of presets) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      this.presetSelect.appendChild(option);
    }
  }

  selectPreset(presetId: string | null): void {
    this.presetSelect.value = presetId ?? '';
  }

  setSuggestion(suggestion: SuggestResult | null): void {
    this.suggestionEl.textContent = suggestion ? `${suggestion.reason} → ${suggestion.preset.name}` : '';
  }

  setPalette(palette: Palette): void {
    this.paletteSwatch.replaceChildren();
    for (const color of [palette.bg[0], palette.bg[1], palette.primary, palette.secondary, palette.accent, palette.glow]) {
      const span = document.createElement('span');
      span.style.background = colorToCss(color);
      this.paletteSwatch.appendChild(span);
    }
  }

  setMacros(macros: Pick<PresetMacros, 'energy' | 'density' | 'glow'>): void {
    this.energyInput.value = String(macros.energy);
    this.densityInput.value = String(macros.density);
    this.glowInput.value = String(macros.glow);
  }

  setExportFormat(formatId: string): void {
    this.exportFormatSelect.value = formatId;
  }
}
