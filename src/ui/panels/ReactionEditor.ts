/**
 * Éditeur de réaction — « quel instrument fait quoi » (docs/17_PHASE2_VISUELS.md
 * §7.11, chantier 10 lot C).
 *
 * §7.11 : « Le bloc `mapping` est la chose la plus puissante du format de
 * preset, et il n'est éditable qu'en JSON brut. » Il l'était encore : le seul
 * accès passait par `PresetEditorDialog`, un `<textarea>` de JSON validé par
 * schéma. Autant dire par personne.
 *
 * UNE LIGNE PAR SIGNAL, PAS PAR INSTRUMENT
 * ----------------------------------------
 * La maquette de §7.11 met l'instrument à gauche (« Caisse claire → révélation »).
 * Le modèle de PULSAR est l'inverse : c'est le SIGNAL qui est la clé, et
 * l'instrument n'est qu'une de ses propriétés (`impact: { from: ['KICK'] }`).
 *
 * Suivre la maquette littéralement aurait demandé d'inverser la table à
 * l'affichage puis de la réinverser à l'écriture — avec une question sans
 * réponse à chaque fois qu'un instrument alimente deux signaux, ou aucun. La
 * ligne est donc le signal, et l'instrument un menu SUR la ligne : la lecture
 * « le kick pilote la frappe, à telle force, avec tel retour » y est la même,
 * et l'écriture ne peut pas produire d'état impossible.
 *
 * QUATRE FAMILLES, QUATRE JEUX DE CONTRÔLES
 * -----------------------------------------
 * `MappingSchema` déduit la famille de la FORME de `from`. L'éditeur suit la
 * même règle plutôt que d'ajouter un discriminant : impulsion (instruments,
 * gain, retour), continu (descripteur, montée, descente), anticipation
 * (fenêtre, courbe), LFO (forme d'onde, période, phase).
 *
 * L'ÉDITEUR NE CHANGE PAS DE FAMILLE
 * ----------------------------------
 * On peut recâbler `impact` du kick vers le snare, pas le transformer en LFO.
 * La famille d'un signal est une propriété du MOTEUR, pas du preset :
 * `BehaviourEngine` construit un `Impulse` ou une `Continuous` selon elle, et
 * les couches lisent `signals.impact` en attendant une enveloppe de frappe. La
 * permuter donnerait un signal syntaxiquement valide et visuellement absurde.
 */

import {
  isContinuousEntry,
  isImpulseEntry,
  isLfoEntry,
  lfoWaveform,
  type MappingEntry,
  type MappingSchema,
} from '../../behaviour/mapping/MappingSchema';
import { LFO_NAMES, SIGNAL_NAMES, type LfoName, type PresetMapping, type SignalName } from '../../presets/schema';

/**
 * Libellé de chaque signal, côté EFFET — c'est ce que §7.11 met dans sa
 * colonne de droite. Un `Record` complet : ajouter un signal sans le nommer ne
 * compile pas.
 */
const SIGNAL_LABELS: Readonly<Record<SignalName, string>> = Object.freeze({
  impact: 'Frappe',
  subImpact: 'Grave',
  accent: 'Accent',
  tick: 'Scintillement',
  sectionShift: 'Changement de section',
  drive: 'Intensité',
  weight: 'Poids',
  brightness: 'Brillance',
  tension: 'Tension',
});

const LFO_LABELS: Readonly<Record<LfoName, string>> = Object.freeze({
  lfoA: 'LFO 1',
  lfoB: 'LFO 2',
  lfoC: 'LFO 3',
  lfoD: 'LFO 4',
});

/**
 * Combinaisons d'instruments proposées.
 *
 * Un menu de combinaisons plutôt que sept cases à cocher par ligne : à cinq
 * lignes d'impulsion, les cases feraient trente-cinq contrôles dans une colonne
 * de 340 px. La liste couvre tous les câblages des onze presets du chantier 9,
 * et l'éditeur JSON reste là pour un cas qui n'y serait pas.
 */
const SOURCE_COMBOS: readonly { readonly value: string; readonly label: string }[] = Object.freeze([
  { value: 'KICK', label: 'Kick' },
  { value: 'SNARE', label: 'Caisse claire' },
  { value: 'CLAP', label: 'Clap' },
  { value: 'SNARE,CLAP', label: 'Caisse claire + clap' },
  { value: 'CLAP,SNARE', label: 'Clap + caisse claire' },
  { value: 'HAT', label: 'Charley' },
  { value: 'PERC', label: 'Percussion' },
  { value: 'HAT,PERC', label: 'Charley + percussion' },
  { value: 'PERC,SNARE', label: 'Percussion + caisse claire' },
  { value: 'PERC,CLAP', label: 'Percussion + clap' },
  { value: 'SUB_HIT', label: 'Sub' },
  { value: 'SECTION', label: 'Frontière de section' },
]);

const FEATURES: readonly { readonly value: string; readonly label: string }[] = Object.freeze([
  { value: 'energy', label: 'Énergie' },
  { value: 'band.sub', label: 'Bande sub' },
  { value: 'centroid', label: 'Centroïde (brillance)' },
]);

const CURVES: readonly string[] = Object.freeze(['linear', 'easeInQuad', 'easeInOutSine']);
const WAVEFORMS: readonly { readonly value: string; readonly label: string }[] = Object.freeze([
  { value: 'sine', label: 'Sinus' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'saw', label: 'Dent de scie' },
  { value: 'square', label: 'Carré' },
  { value: 'random', label: 'Aléatoire' },
]);

export interface ReactionEditorCallbacks {
  /** Appelée à chaque modification, avec le diff COMPLET des lignes touchées. */
  readonly onChange: (mapping: PresetMapping) => void;
}

export class ReactionEditor {
  private readonly container: HTMLElement;
  private readonly onChange: (mapping: PresetMapping) => void;
  /** Diff courant. Une ligne n'y entre qu'une fois touchée — c'est ce qui en fait un diff. */
  private overrides: PresetMapping = {};
  /** Câblage résolu affiché, pour repartir des valeurs réelles à chaque édition. */
  private resolved: MappingSchema = {};
  private readonly rows = new Map<string, HTMLElement>();
  private building = false;

  constructor(container: HTMLElement, callbacks: ReactionEditorCallbacks) {
    this.container = container;
    this.onChange = callbacks.onChange;
  }

  /** Diff courant, à enregistrer dans le projet. */
  get mapping(): PresetMapping {
    return this.overrides;
  }

  /** Repart d'un diff enregistré (projet restauré). Ne notifie pas. */
  setMapping(mapping: PresetMapping | null): void {
    this.overrides = mapping ? { ...mapping } : {};
  }

  /** Remet toutes les lignes au câblage du preset. */
  reset(): void {
    this.overrides = {};
    this.onChange(this.overrides);
  }

  /**
   * Reconstruit l'affichage depuis le câblage RÉSOLU (preset + macros + diff).
   *
   * Depuis le résolu et non depuis le diff : une ligne jamais touchée doit
   * montrer ce que le preset lui donne, pas un champ vide. C'est aussi ce qui
   * fait que changer de preset rafraîchit visiblement l'éditeur.
   */
  render(resolved: MappingSchema): void {
    this.resolved = resolved;
    this.building = true;
    this.container.replaceChildren();
    this.rows.clear();
    for (const name of SIGNAL_NAMES) this.buildRow(name, resolved[name]);
    for (const name of LFO_NAMES) this.buildRow(name, resolved[name]);
    this.building = false;
  }

  private buildRow(name: string, entry: MappingEntry | undefined): void {
    if (!entry) return;
    const row = document.createElement('div');
    row.className = 'reaction-row';
    row.dataset.signal = name;

    const title = document.createElement('span');
    title.className = 'reaction-name';
    title.textContent = (SIGNAL_LABELS as Record<string, string>)[name] ?? (LFO_LABELS as Record<string, string>)[name] ?? name;
    // Une ligne modifiée par l'utilisateur est marquée : sans ça, rien ne
    // distingue « c'est le preset qui veut ça » de « j'ai bougé ce curseur ».
    if (this.overrides[name as SignalName]) title.classList.add('modifie');
    row.appendChild(title);

    if (isImpulseEntry(entry)) {
      row.appendChild(this.select(name, 'from', SOURCE_COMBOS, entry.from.join(',')));
      row.appendChild(this.range(name, 'gain', 'force', 0, 1, 0.05, entry.gain));
      row.appendChild(this.range(name, 'decay', 'retour', 0.02, 2, 0.01, entry.decay, 's'));
    } else if (isContinuousEntry(entry)) {
      row.appendChild(this.select(name, 'from', FEATURES, entry.from.slice('feature:'.length)));
      row.appendChild(this.range(name, 'rise', 'montée', 0.02, 1.5, 0.01, entry.rise, 's'));
      row.appendChild(this.range(name, 'fall', 'descente', 0.05, 3, 0.05, entry.fall, 's'));
    } else if (isLfoEntry(entry)) {
      row.appendChild(this.select(name, 'from', WAVEFORMS, lfoWaveform(entry)));
      row.appendChild(this.range(name, 'bars', 'période', 0.25, 16, 0.25, entry.bars, ' mes.'));
      row.appendChild(this.range(name, 'phase', 'phase', 0, 1, 0.05, entry.phase ?? 0));
    } else {
      row.appendChild(this.select(name, 'curve', CURVES.map((c) => ({ value: c, label: c })), entry.curve));
      row.appendChild(this.range(name, 'window', 'fenêtre', 1, 24, 0.5, entry.window, 's'));
    }

    this.rows.set(name, row);
    this.container.appendChild(row);
  }

  private select(
    signal: string,
    field: string,
    options: readonly { readonly value: string; readonly label: string }[],
    current: string,
  ): HTMLElement {
    const select = document.createElement('select');
    select.className = 'reaction-source';
    for (const o of options) {
      const option = document.createElement('option');
      option.value = o.value;
      option.textContent = o.label;
      option.selected = o.value === current;
      select.appendChild(option);
    }
    // Une valeur du preset absente de la liste ne doit pas être écrasée en
    // silence : on l'ajoute plutôt que de laisser le menu afficher autre chose
    // que ce qui est réellement câblé.
    if (!options.some((o) => o.value === current)) {
      const option = document.createElement('option');
      option.value = current;
      option.textContent = `${current} (du preset)`;
      option.selected = true;
      select.insertBefore(option, select.firstChild);
    }
    select.addEventListener('change', () => this.edit(signal, field, select.value));
    return select;
  }

  private range(
    signal: string,
    field: string,
    label: string,
    min: number,
    max: number,
    step: number,
    current: number,
    unit = '',
  ): HTMLElement {
    const wrap = document.createElement('label');
    wrap.className = 'reaction-field';
    const caption = document.createElement('span');
    const value = document.createElement('b');
    value.textContent = `${current}${unit}`;
    caption.append(`${label} `, value);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(current);
    input.addEventListener('input', () => {
      value.textContent = `${input.value}${unit}`;
      this.edit(signal, field, Number(input.value));
    });
    wrap.append(caption, input);
    return wrap;
  }

  /**
   * Écrit un champ dans le diff.
   *
   * L'entrée est reconstruite ENTIÈRE depuis le câblage résolu, jamais fusionnée
   * par-dessus l'ancien diff : une entrée de `MappingSchema` est un objet dont
   * la famille se lit sur `from`, et un `{...ancien, from: 'feature:energy'}`
   * appliqué à une entrée d'impulsion donnerait un objet portant à la fois
   * `gain`/`decay` et un `from` continu — syntaxiquement valide, silencieusement
   * faux.
   */
  private edit(signal: string, field: string, value: string | number): void {
    if (this.building) return;
    const base = this.overrides[signal as SignalName] ?? this.resolved[signal];
    if (!base) return;

    let next: MappingEntry;
    if (field === 'from') {
      if (isImpulseEntry(base)) next = { ...base, from: String(value).split(',') };
      else if (isContinuousEntry(base)) next = { ...base, from: `feature:${String(value)}` };
      else if (isLfoEntry(base)) next = { ...base, from: `lfo:${String(value)}` as typeof base.from };
      else return;
    } else {
      next = { ...base, [field]: value } as MappingEntry;
    }

    this.overrides = { ...this.overrides, [signal]: next };
    this.rows.get(signal)?.querySelector('.reaction-name')?.classList.add('modifie');
    this.onChange(this.overrides);
  }
}
