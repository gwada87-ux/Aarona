/**
 * Compositeur de couches, éditeur de réaction et « Looks » (docs/17
 * §7.7 et §7.11, chantier 10 lot C).
 *
 * Le test qui compte est celui de l'ORDRE : §7.7 prévient que « l'ordre des
 * couches n'est pas cosmétique » et demande que l'éditeur empêche les ordres
 * invalides. Une couche de secousse descendue dans la pile ne casse rien de
 * visible — elle cesse simplement d'agir sur la moitié du décor, ce qui se lit
 * comme « le style a perdu sa secousse » et n'oriente vers rien.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeLayers } from '../../src/visual/scene/composeLayers';
import { createPulseStyle } from '../../src/visual/styles/pulse/createPulseStyle';
import { createFieldStyle } from '../../src/visual/styles/field/createFieldStyle';
import { withCover } from '../../src/visual/scene/withCover';
import { withText } from '../../src/visual/scene/withText';
import { normaliseTextConfig } from '../../src/visual/text/textConfig';
import { MAX_LOOKS, readLooks, removeLook, writeLook, type Look } from '../../src/ui/looks';
import { LFO_NAMES, SIGNAL_NAMES } from '../../src/presets/schema';
import { defaultMapping } from '../../src/behaviour/mapping/defaults';

const app = readFileSync(join(process.cwd(), 'src/ui/App.ts'), 'utf-8');

describe('composeLayers — activer et désactiver', () => {
  it('retire une couche et le signale', () => {
    const base = createPulseStyle();
    const r = composeLayers(base, { centralGlow: false });
    expect(r.scene.layers.map((l) => l.id)).not.toContain('centralGlow');
    expect(r.scene.layers.length).toBe(base.layers.length - 1);
    expect(r.disabled).toEqual(['centralGlow']);
  });

  it('une composition VIDE rend la scène telle quelle, sans la recopier', () => {
    // Identite d'objet : le cas courant - aucune composition - ne doit rien
    // couter, et surtout ne pas invalider la scene a chaque appel.
    const base = createPulseStyle();
    expect(composeLayers(base, {}).scene).toBe(base);
  });

  it('une couche absente de la table reste ACTIVE', () => {
    const base = createPulseStyle();
    expect(composeLayers(base, { pulseRings: true }).scene.layers.length).toBe(base.layers.length);
  });

  it('`usesFeedback` suit la couche de traînée', () => {
    // Capturer le composite a chaque image couterait un `drawImage` plein ecran
    // pour un buffer que plus personne ne lit.
    const field = createFieldStyle(400, true);
    expect(field.usesFeedback).toBe(true);
    expect(composeLayers(field, { frameFeedback: false }).scene.usesFeedback).toBe(false);
  });
});

describe('composeLayers — l\'ordre invalide est EMPÊCHÉ (§7.7)', () => {
  it('une couche `mustDrawFirst` remonte en tête, quoi qu\'on demande', () => {
    const base = createPulseStyle();
    const verrouillees = base.layers.filter((l) => l.mustDrawFirst === true).map((l) => l.id);
    expect(verrouillees.length, 'le style pulse doit avoir au moins une couche verrouillée').toBeGreaterThan(0);

    // Ordre demande : exactement l'inverse de celui de la fabrique.
    const inverse = [...base.layers].reverse().map((l) => l.id);
    const r = composeLayers(base, {}, inverse);
    expect(r.scene.layers[0]!.mustDrawFirst).toBe(true);
    expect(r.reordered, 'la correction doit être signalée à l\'interface').toBe(true);
  });

  it('un ordre VALIDE est appliqué tel quel, sans correction', () => {
    const base = createPulseStyle();
    const libres = base.layers.filter((l) => l.mustDrawFirst !== true).map((l) => l.id);
    const verrouillees = base.layers.filter((l) => l.mustDrawFirst === true).map((l) => l.id);
    const voulu = [...verrouillees, ...libres.slice().reverse()];
    const r = composeLayers(base, {}, voulu);
    expect(r.scene.layers.map((l) => l.id)).toEqual(voulu);
    expect(r.reordered).toBe(false);
  });

  it('une couche citée mais absente de la scène est ignorée', () => {
    // La composition d'un projet peut venir d'un AUTRE style.
    const base = createPulseStyle();
    const r = composeLayers(base, {}, ['spectrumBars', 'auroraRibbons']);
    expect(r.scene.layers.length).toBe(base.layers.length);
  });

  it('les couches non citées gardent leur ordre relatif', () => {
    const base = createPulseStyle();
    const dernier = base.layers[base.layers.length - 1]!.id;
    const r = composeLayers(base, {}, [dernier]);
    const ids = r.scene.layers.map((l) => l.id);
    const libres = ids.filter((id) => base.layers.find((l) => l.id === id)?.mustDrawFirst !== true);
    expect(libres[0]).toBe(dernier);
  });
});

describe('les habillages passent APRÈS la composition', () => {
  it('la pochette et le texte restent en fin de pile', () => {
    // Les faire passer par le compositeur permettrait de les glisser sous le
    // decor, ou de les desactiver depuis deux endroits differents.
    const composed = composeLayers(createPulseStyle(), { centralGlow: false }).scene;
    const scene = withText(withCover(composed, true), normaliseTextConfig({ text: 'A' }));
    const ids = scene.layers.map((l) => l.id);
    expect(ids[ids.length - 2]).toBe('coverArt');
    expect(ids[ids.length - 1]).toBe('text');
    expect(ids).not.toContain('centralGlow');
  });
});

describe('le compositeur atteint l\'APERÇU et l\'EXPORT', () => {
  it('les deux chemins appellent `composeLayers`', () => {
    // Sans la ligne cote export, la video rendrait les couches desactivees.
    // Meme piege de l'Etape 25 que pour la pochette et le texte.
    expect((app.match(/composeLayers\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('la composition est enregistrée dans le projet', () => {
    expect(app).toContain('layers: { enabled: layerEnabled, order: layerOrder }');
    expect(app).toContain('layerEnabled = project.visual.layers?.enabled ?? {}');
  });
});

describe('éditeur de réaction (§7.11)', () => {
  const editor = readFileSync(join(process.cwd(), 'src/ui/panels/ReactionEditor.ts'), 'utf-8');

  it('les treize signaux ont un libellé', () => {
    // `Record<SignalName, string>` fait deja echouer la compilation sur un
    // manque ; ce test attrape le cas ou un signal serait ajoute sans ligne.
    for (const name of [...SIGNAL_NAMES, ...LFO_NAMES]) {
      expect(editor, `libellé manquant pour ${name}`).toContain(`${name}:`);
    }
  });

  it('les quatre LFO sont enfin typés', () => {
    // Les onze presets du chantier 9 les declarent tous, et aucune de ces cles
    // n'etait couverte par un type : elles passaient par le `as` de
    // `validatePreset`.
    expect(LFO_NAMES).toEqual(['lfoA', 'lfoB', 'lfoC', 'lfoD']);
    for (const name of LFO_NAMES) expect(defaultMapping[name]).toBeDefined();
  });

  it('le diff est branché sur le DERNIER étage de `resolvePreset`', () => {
    // `userMappingOverrides` etait declare depuis docs/08 et utilise par
    // personne.
    expect(app).toContain('userMappingOverrides: mappingOverride ?? undefined');
  });

  it('le câblage édité est enregistré hors de `overrides`', () => {
    // `overrides` est un diff chemin -> PRIMITIVE : il ne peut pas porter le
    // tableau `from`, et `computePresetDiff` l'ignore deliberement.
    expect(app).toContain('mapping: mappingOverride as Readonly<Record<string, unknown>>');
  });
});

describe('« Looks » (§7.7)', () => {
  const look = (name: string): Look => ({
    name,
    styleId: 'pulse',
    macros: { energy: 0.5, reactivity: 0.5, density: 0.5, movement: 0.5, depth: 0.5, glow: 0.5, chaos: 0.5, smoothness: 0.5 },
    palette: 'ember',
    text: normaliseTextConfig({ text: 'A' }),
    textSize: 1,
    mapping: null,
    layers: { enabled: {}, order: [] },
  });

  it('enregistre, relit et supprime', () => {
    let settings = writeLook({}, look('nuit'));
    expect(readLooks(settings).map((l) => l.name)).toEqual(['nuit']);
    settings = writeLook(settings, look('jour'));
    expect(readLooks(settings).map((l) => l.name)).toEqual(['nuit', 'jour']);
    settings = removeLook(settings, 'nuit');
    expect(readLooks(settings).map((l) => l.name)).toEqual(['jour']);
  });

  it('un nom déjà pris ÉCRASE', () => {
    const settings = writeLook(writeLook({}, look('nuit')), { ...look('nuit'), styleId: 'aurore' });
    const relus = readLooks(settings);
    expect(relus.length).toBe(1);
    expect(relus[0]!.styleId).toBe('aurore');
  });

  it('plafonne, en évinçant le plus ancien', () => {
    let settings = {};
    for (let i = 0; i < MAX_LOOKS + 3; i++) settings = writeLook(settings, look(`look-${i}`));
    const relus = readLooks(settings);
    expect(relus.length).toBe(MAX_LOOKS);
    expect(relus[0]!.name).toBe('look-3');
  });

  it('ignore une entrée abîmée sans perdre les autres', () => {
    // Le magasin `settings` est un sac de cles libres : un `looks` ecrit par une
    // version future ne doit pas faire disparaitre la liste entiere.
    const settings = { looks: [look('bon'), { name: 'sans style' }, null, 'texte'] };
    expect(readLooks(settings).map((l) => l.name)).toEqual(['bon']);
    expect(readLooks({ looks: 'pas un tableau' })).toEqual([]);
    expect(readLooks({})).toEqual([]);
  });

  it('ne fige NI la graine NI la variante de cadrage', () => {
    // Les figer casserait « Nouvelle variante » (§7.9), le bouton le moins cher
    // et le plus rentable du projet.
    const clefs = Object.keys(look('x'));
    expect(clefs).not.toContain('seed');
    expect(clefs).not.toContain('variant');
    expect(clefs, 'une pochette n\'est pas une identité réutilisable').not.toContain('cover');
  });
});
