/**
 * Couverture des signaux visuels — chantier 2 de la phase 2
 * (docs/17_PHASE2_VISUELS.md §5.1, §6.1, critères 6 et 11).
 *
 * LE DÉFAUT QUE CE FICHIER EMPÊCHE DE REVENIR
 * -------------------------------------------
 * Avant ce chantier, `BehaviourEngine` produisait onze signaux et les couches
 * n'en lisaient que cinq. `accent` (caisse claire), `tick` (charley),
 * `subImpact`, `sectionShift`, `tension` (anticipation du drop), `barPulse` et
 * `pulse` étaient calculés à chaque pas puis jetés.
 *
 * Conséquence : le bloc `mapping`, qui est ce qui distingue le plus les presets
 * entre eux, n'atteignait jamais l'image pour plus de la moitié de ses entrées.
 * `trap-dark.json` déclarait une réaction à la caisse claire ; rien ne
 * réagissait à la caisse claire. C'est la cause première du « les presets ne
 * changent rien ».
 *
 * Le défaut était invisible : aucun test ne pouvait échouer, puisqu'un signal
 * ignoré ne casse rien. D'où ce fichier, qui lit le CODE SOURCE des couches.
 * Une analyse statique est le seul moyen d'affirmer « ce signal atteint au
 * moins une couche » sans instancier un canvas.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defaultMapping } from '../../src/behaviour/mapping/defaults';
import { resolve } from '../../src/behaviour/mapping/resolve';
import type { StyleId } from '../../src/presets/schema';

const LAYERS_ROOT = join(process.cwd(), 'src', 'visual', 'layers');

/**
 * Noms de `VisualSignals`. Écrits en dur plutôt que dérivés du type : le type
 * disparaît à la compilation, et une valeur d'exemple laisserait passer un
 * signal ajouté puis oublié — exactement le scénario à empêcher.
 */
const SIGNALS = [
  'impact',
  'subImpact',
  'accent',
  'tick',
  'sectionShift',
  'drive',
  'weight',
  'brightness',
  'tension',
  'pulse',
  'barPulse',
  'lfoA',
  'lfoB',
  'lfoC',
  'lfoD',
] as const;

function listLayerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listLayerFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Retire les commentaires avant de chercher les usages.
 *
 * Ce n'est pas une précaution théorique : `PerspectiveGrid` contient la phrase
 * « PAS `signals.pulse` » dans sa docstring, et une recherche naïve comptait
 * donc `pulse` comme consommé alors qu'aucune couche ne le lisait. Le premier
 * relevé de ce chantier annonçait six signaux morts ; il y en avait sept.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

interface LayerSource {
  readonly name: string;
  readonly code: string;
}

function loadLayers(): LayerSource[] {
  return listLayerFiles(LAYERS_ROOT).map((file) => ({
    name: relative(LAYERS_ROOT, file).replace(/\\/g, '/'),
    code: stripComments(readFileSync(file, 'utf-8')),
  }));
}

describe('couverture des signaux visuels (§6.1)', () => {
  const layers = loadLayers();

  it('chaque signal de VisualSignals est lu par au moins une couche', () => {
    const orphans: string[] = [];
    for (const signal of SIGNALS) {
      const pattern = new RegExp(`signals\\.${signal}\\b`);
      if (!layers.some((l) => pattern.test(l.code))) orphans.push(signal);
    }
    expect(
      orphans,
      `signaux calculés à chaque pas et jetés : ${orphans.join(', ')} — ` +
        'un signal que personne ne lit rend inopérante la partie du `mapping` qui le configure',
    ).toEqual([]);
  });

  it('chacun des trois styles réagit à au moins quatre signaux distincts', () => {
    // Un style qui n'en lit qu'un ou deux est sourd au preset, même si le
    // moteur, lui, calcule tout. `spectrum-pro` était dans ce cas : ses trois
    // couches ne lisaient RIEN.
    // `Record<StyleId, …>` : un style ajouté sans entrée ici ferait échouer la
    // COMPILATION. Avec `Record<string, …>`, `monolith` et `iso-pulse` auraient
    // été ajoutés au chantier 5 sans jamais passer sous ce contrôle.
    const styles: Readonly<Record<StyleId, readonly string[]>> = {
      pulse: ['background/RadialBackground.ts', 'geometry/PulseRings.ts', 'waveform/CircularWaveform.ts', 'glow/CentralGlow.ts', 'postfx/ScreenShake.ts'],
      field: ['background/DeepVignette.ts', 'field/PerspectiveGrid.ts', 'particles/ParticleField.ts', 'postfx/FrameFeedback.ts'],
      'spectrum-pro': ['background/AnimatedDuotone.ts', 'spectrum/SpectrumBars.ts', 'waveform/FlatWaveform.ts'],
      monolith: ['background/DeepVignette.ts', 'geometry/MonolithMass.ts'],
      'iso-pulse': ['postfx/FrameFeedback.ts', 'background/AnimatedDuotone.ts', 'field/IsoGrid.ts'],
    };

    for (const [style, files] of Object.entries(styles)) {
      const code = files
        .map((f) => {
          const layer = layers.find((l) => l.name === f);
          expect(layer, `couche introuvable : ${f} — la table de ce test a divergé du code`).toBeDefined();
          return layer!.code;
        })
        .join('\n');
      const read = SIGNALS.filter((s) => new RegExp(`signals\\.${s}\\b`).test(code));
      expect(read.length, `style ${style} ne lit que : ${read.join(', ') || 'rien'}`).toBeGreaterThanOrEqual(4);
    }
  });
});

describe('table de câblage par défaut', () => {
  it('déclare une entrée pour chaque signal produit par une table (§5.1)', () => {
    // `pulse`/`barPulse` sont des fonctions directes de la phase, sans entrée
    // de câblage — voir l'en-tête de `defaults.ts`. Tous les autres doivent en
    // avoir une, sinon le signal vaut 0 en permanence et la couche qui le lit
    // est morte sans que rien ne le dise.
    const wired = resolve(defaultMapping);
    const configurable = SIGNALS.filter((s) => s !== 'pulse' && s !== 'barPulse');
    const missing = configurable.filter(
      (s) => !wired.impulses.has(s) && !wired.continuous.has(s) && !wired.anticipations.has(s) && !wired.lfos.has(s),
    );
    expect(missing, `signaux sans entrée par défaut : ${missing.join(', ')}`).toEqual([]);
  });

  it('les quatre LFO ont des périodes distinctes', () => {
    // Des périodes multiples les unes des autres se réaligneraient
    // périodiquement, et les quatre mouvements se liraient comme un seul.
    const lfos = [...resolve(defaultMapping).lfos.values()];
    expect(lfos).toHaveLength(4);
    expect(new Set(lfos.map((l) => l.bars)).size, 'deux LFO partagent la même période').toBe(4);
  });
});
