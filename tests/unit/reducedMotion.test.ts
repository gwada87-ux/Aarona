import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CALMEST_STYLE,
  REDUCED_MOTION_STYLES,
  STYLE_MOTION_LOAD,
  isReducedMotionSafe,
  pickReducedMotionStyle,
} from '../../src/presets/reducedMotion';
import { STYLE_IDS } from '../../src/presets/schema';
import { REDUCED_FLASHING_MODE } from '../../src/visual/safety/FlashLimiter';

/**
 * docs/17 §12 critère 14 : « `prefers-reduced-motion` : la liste des styles
 * autorisés reste non vide et aucun d'eux ne stroboscope. »
 */
describe('critère 14 — la liste des styles autorisés', () => {
  it("n'est PAS vide", () => {
    // La moitié littérale du critère. Un jour quelqu'un classera un style de
    // trop en `agite` et ce test sera le seul à s'en apercevoir.
    expect(REDUCED_MOTION_STYLES.length).toBeGreaterThan(0);
  });

  it('ne contient que des styles réellement déclarés', () => {
    for (const id of REDUCED_MOTION_STYLES) expect(STYLE_IDS).toContain(id);
  });

  it('contient exactement les styles non `agite`, sans doublon', () => {
    // Dérivée, jamais recopiée : deux listes qui disent la même chose finissent
    // toujours par se contredire.
    const attendu = STYLE_IDS.filter((id) => STYLE_MOTION_LOAD[id] !== 'agite');
    expect([...REDUCED_MOTION_STYLES]).toEqual(attendu);
    expect(new Set(REDUCED_MOTION_STYLES).size).toBe(REDUCED_MOTION_STYLES.length);
  });

  it('inclut le style de repli, sinon le repli serait lui-même interdit', () => {
    expect(REDUCED_MOTION_STYLES).toContain(CALMEST_STYLE);
    expect(isReducedMotionSafe(CALMEST_STYLE)).toBe(true);
  });

  it('couvre les huit styles : aucun oubli possible', () => {
    // `Record<StyleId, …>` le garantit à la compilation ; ce test le garantit
    // aussi à l'exécution, pour le cas où quelqu'un élargirait le type.
    for (const id of STYLE_IDS) expect(STYLE_MOTION_LOAD[id]).toBeDefined();
    expect(Object.keys(STYLE_MOTION_LOAD).sort()).toEqual([...STYLE_IDS].sort());
  });
});

describe('critère 14 — « aucun d\'eux ne stroboscope »', () => {
  it('les écarts de luminance mesurés restent sous le seuil de réduction des flashs', () => {
    // Relevés au navigateur (voir l'en-tête de reducedMotion.ts) : écart de
    // luminance image à image, instrument identique à
    // FlashLimiter.measureLuminance. Le pire des huit, `eclats`, est à 0,0344.
    const ECART_MAX_MESURE: Readonly<Record<string, number>> = {
      chambre: 0.0022, monolith: 0.0202, aurore: 0.0022, 'spectrum-pro': 0.0118,
      'iso-pulse': 0.0064, pulse: 0.0063, field: 0.0037, eclats: 0.0344,
    };
    for (const id of REDUCED_MOTION_STYLES) {
      expect(ECART_MAX_MESURE[id], `${id} non mesuré`).toBeDefined();
      expect(ECART_MAX_MESURE[id]!, `${id} clignote`).toBeLessThan(REDUCED_FLASHING_MODE.deltaThreshold);
    }
  });

  it('le plus agité de tous reste sous le seuil, autorisé ou non', () => {
    // `eclats` est écarté pour son MOUVEMENT, pas pour un clignotement : le dire
    // ici évite qu'on relise un jour son exclusion comme un aveu de flash.
    expect(0.0344).toBeLessThan(REDUCED_FLASHING_MODE.deltaThreshold);
    expect(STYLE_MOTION_LOAD.eclats).toBe('agite');
  });
});

describe('pickReducedMotionStyle', () => {
  it('ne change RIEN sans préférence active', () => {
    // Le cas ordinaire doit rester byte-pour-byte celui d'avant.
    for (const id of STYLE_IDS) expect(pickReducedMotionStyle(id, false)).toBe(id);
  });

  it('laisse passer un style autorisé même sous la préférence', () => {
    for (const id of REDUCED_MOTION_STYLES) expect(pickReducedMotionStyle(id, true)).toBe(id);
  });

  it('replie un style à mouvement soutenu sur le plus calme', () => {
    expect(pickReducedMotionStyle('eclats', true)).toBe(CALMEST_STYLE);
  });

  it('est idempotente : replier deux fois ne bouge plus', () => {
    const une = pickReducedMotionStyle('eclats', true);
    expect(pickReducedMotionStyle(une, true)).toBe(une);
  });
});

/**
 * Le piège de l'Étape 25 sous une autre forme : la préférence système était
 * câblée côté live et NULLE PART côté preview/export. Ces tests lisent la
 * source, faute de pouvoir instancier `App.ts` hors navigateur.
 */
describe('critère 14 — le câblage de la préférence système', () => {
  const app = readFileSync('src/ui/App.ts', 'utf-8');

  it('App.ts observe bien `prefers-reduced-motion`', () => {
    expect(app).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
  });

  it("l'écoute est CONTINUE, pas seulement au démarrage", () => {
    // La préférence peut être activée pendant que le visuel tourne, et c'est
    // précisément le moment où elle sert.
    expect(app).toMatch(/motionQuery\.addEventListener\('change'/);
  });

  it('la suggestion à l\'import passe par le filtre', () => {
    expect(app).toContain('pickReducedMotionStyle(');
  });

  it('la préférence n\'ÉTEINT jamais un réglage manuel', () => {
    // `active && !reducedFlashing` : elle allume, elle ne retire pas une case
    // que l'utilisateur a cochée lui-même.
    expect(app).toContain('if (active && !reducedFlashing)');
  });

  /**
   * RÉGRESSION — le défaut le plus grave de la phase 2, signalé par Aaron :
   * « quand je change le style du visuel et sa couleur [...] ça ne change pas
   * du tout le visuel ».
   *
   * L'appel initial `applyReducedMotion(motionQuery.matches)` vivait au niveau
   * module, à côté de la déclaration de la fonction — ce qui semblait propre.
   * Quand la préférence système est ACTIVE, il appelle
   * `applyActiveConfiguration()`, qui touche `SWATCHES`, `reactionEditor`,
   * `layerComposer`... tous déclarés en `const` plus bas dans le fichier.
   * Résultat : `ReferenceError: Cannot access 'SWATCHES' before initialization`,
   * évaluation du module interrompue, `requestAnimationFrame(raf)` jamais
   * atteint. **Canevas gelé, tous les contrôles morts.**
   *
   * Invisible pour moi : la branche ne s'exécute QUE si `prefers-reduced-motion`
   * est actif, et il ne l'est pas sur cette machine. Reproduit ensuite en
   * forçant `matchMedia` avant une réévaluation du module.
   */
  const ordre = (aiguille: string) => app.indexOf(aiguille);

  it("l'installation de l'écoute vient APRÈS la configuration initiale", () => {
    const config = ordre('\napplyActiveConfiguration();');
    const install = ordre('\ninstallerReducedMotion();');
    expect(config, 'la configuration initiale doit exister au niveau module').toBeGreaterThan(0);
    expect(install, "l'installation doit exister au niveau module").toBeGreaterThan(0);
    expect(install, 'installer avant la configuration initiale regèle le canevas').toBeGreaterThan(config);
  });

  it('la boucle de rendu est enregistrée AVANT tout cela', () => {
    // Défense en profondeur : si quoi que ce soit lève plus bas, la boucle
    // tourne déjà et l'image reste vivante au lieu de se figer.
    expect(ordre('\nrequestAnimationFrame(raf);')).toBeLessThan(ordre('\napplyActiveConfiguration();'));
  });

  it("aucun appel à applyReducedMotion au niveau module avant l'installation", () => {
    // Un appel nu en colonne 0, hors de `installerReducedMotion`, remettrait
    // exactement le même piège.
    const nus = [...app.matchAll(/\napplyReducedMotion\(/g)].map((m) => m.index ?? 0);
    expect(nus, `appel(s) au niveau module : ${nus.length}`).toEqual([]);
  });
});
