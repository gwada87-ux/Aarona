/**
 * Éditeur JSON du preset (docs/08_PRESETS.md §"Deux niveaux d'interface" :
 * « un éditeur JSON du preset, avec validation par schéma et rechargement à
 * chaud »). Coût de développement annoncé « quelques heures » — exactement
 * ce que ce module livre : un `<textarea>`, `validatePreset()`, et un
 * `onApply` déclenché seulement si le JSON est structurellement valide.
 */
import { validatePreset, type Preset } from '../../presets/schema';

export interface PresetEditorCallbacks {
  readonly onApply: (preset: Preset) => void;
}

export class PresetEditorDialog {
  private readonly dialog = document.querySelector<HTMLDialogElement>('#preset-editor-dialog')!;
  private readonly textarea = document.querySelector<HTMLTextAreaElement>('#preset-json')!;
  private readonly errorsEl = document.querySelector<HTMLElement>('#preset-json-errors')!;
  private readonly closeBtn = document.querySelector<HTMLButtonElement>('#btn-preset-editor-close')!;
  private readonly validateBtn = document.querySelector<HTMLButtonElement>('#btn-preset-editor-validate')!;
  private readonly applyBtn = document.querySelector<HTMLButtonElement>('#btn-preset-editor-apply')!;

  constructor(private readonly callbacks: PresetEditorCallbacks) {
    this.closeBtn.addEventListener('click', () => this.dialog.close());
    this.validateBtn.addEventListener('click', () => this.validateCurrent());
    this.applyBtn.addEventListener('click', () => this.applyCurrent());
  }

  open(preset: Preset): void {
    this.textarea.value = JSON.stringify(preset, null, 2);
    this.errorsEl.textContent = '';
    this.dialog.showModal();
  }

  private parseCurrent(): unknown | null {
    try {
      return JSON.parse(this.textarea.value);
    } catch (err) {
      this.errorsEl.textContent = `JSON invalide : ${err instanceof Error ? err.message : String(err)}`;
      return null;
    }
  }

  private validateCurrent(): Preset | null {
    const json = this.parseCurrent();
    if (json === null) return null;
    const result = validatePreset(json);
    if (!result.ok) {
      this.errorsEl.textContent = result.errors.join('\n');
      return null;
    }
    this.errorsEl.textContent = result.warnings.length > 0 ? `Avertissements :\n${result.warnings.join('\n')}` : 'Valide.';
    return result.preset;
  }

  private applyCurrent(): void {
    const preset = this.validateCurrent();
    if (!preset) return;
    this.callbacks.onApply(preset);
    this.dialog.close();
  }
}
