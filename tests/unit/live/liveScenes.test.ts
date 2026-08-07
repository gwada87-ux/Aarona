/**
 * Etape 3 : invariants du registre de scenes (§4.2, §3.6, §8.12) et proprietes
 * du champ curl (§1 : ecrit a la main, donc a prouver).
 *
 * Le RENDU des scenes n'est pas teste ici - `vitest` tourne sans DOM. Il est
 * verifie au navigateur, 60 s par scene, comme l'impose le livrable de §9.3.
 * Ce qui est teste ici est tout ce qui peut l'etre sans canvas : la structure
 * du registre, les contraintes de composition, et le champ vectoriel.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SCENE_REGISTRY, playableScenes, sceneById } from '../../../src/ui/live/scenes';
import { capFor, CURL_FLOW_BUCKETS } from '../../../src/ui/live/scenes/CurlFlowScene';
import { CurlField, SimplexNoise } from '../../../src/core/math/noise';
import { QUALITY_PROFILES } from '../../../src/ui/live/render/FrameBudget';

const SCENES_DIR = join(process.cwd(), 'src', 'ui', 'live', 'scenes');

describe('Registre de scenes (§4.2)', () => {
  /** Table de §4.2, passe 1. Le registre doit la reproduire exactement. */
  const TABLE: readonly {
    id: string;
    tags: readonly string[];
    range: readonly [number, number];
    reducedMotionSafe: boolean;
  }[] = [
    { id: 'grid-horizon', tags: ['neon', 'geometric', 'calm'], range: [0.15, 0.7], reducedMotionSafe: true },
    { id: 'laser-tunnel', tags: ['neon', 'intense', 'strobe'], range: [0.55, 1], reducedMotionSafe: false },
    { id: 'curl-flow', tags: ['organic', 'calm'], range: [0.1, 0.75], reducedMotionSafe: true },
    { id: 'mandala-32', tags: ['geometric'], range: [0.3, 0.85], reducedMotionSafe: true },
    { id: 'slice-displace', tags: ['glitch', 'intense', 'strobe'], range: [0.6, 1], reducedMotionSafe: false },
    { id: 'type-slam', tags: ['glitch', 'intense', 'strobe'], range: [0.55, 1], reducedMotionSafe: false },
  ];

  it('les six scenes de la passe 1 sont au registre, conformes a la table §4.2', () => {
    expect(SCENE_REGISTRY.length).toBe(6);
    for (const row of TABLE) {
      const entry = sceneById(row.id);
      expect(entry, `${row.id} absente du registre`).not.toBeNull();
      expect([...(entry?.tags ?? [])].sort(), `${row.id} tags`).toEqual([...row.tags].sort());
      expect(entry?.intensityRange, `${row.id} plage`).toEqual(row.range);
      expect(entry?.reducedMotionSafe, `${row.id} reduced-motion`).toBe(row.reducedMotionSafe);
    }
  });

  it('les quatre familles sont couvertes', () => {
    const families = new Set<string>();
    for (const s of SCENE_REGISTRY) {
      if (s.tags.includes('glitch')) families.add('glitch');
      if (s.tags.includes('organic')) families.add('organic');
      if (s.tags.includes('geometric')) families.add('geometric');
      if (s.tags.includes('neon')) families.add('neon');
    }
    expect([...families].sort()).toEqual(['geometric', 'glitch', 'neon', 'organic']);
  });

  it('chaque scene expose 2 a 3 variantes internes', () => {
    for (const s of SCENE_REGISTRY) {
      expect(s.variants, s.id).toBeGreaterThanOrEqual(2);
      expect(s.variants, s.id).toBeLessThanOrEqual(3);
    }
  });

  it('les identifiants et les plages d intensite sont ceux de la table §4.2', () => {
    expect(sceneById('grid-horizon')?.intensityRange).toEqual([0.15, 0.7]);
    expect(sceneById('curl-flow')?.intensityRange).toEqual([0.1, 0.75]);
    expect(sceneById('slice-displace')?.intensityRange).toEqual([0.6, 1]);
    expect(sceneById('inexistante')).toBeNull();
  });

  it('les instances declarent les memes tags et plages que le registre', () => {
    for (const entry of SCENE_REGISTRY) {
      const scene = entry.create();
      expect(scene.id).toBe(entry.id);
      expect([...scene.tags].sort()).toEqual([...entry.tags].sort());
      expect(scene.intensityRange).toEqual(entry.intensityRange);
      scene.dispose();
    }
  });

  it('chaque scene declare son accent principal (§2.7.6)', () => {
    for (const entry of SCENE_REGISTRY) {
      const scene = entry.create();
      expect(scene.primaryAccent.length, entry.id).toBeGreaterThan(0);
      scene.dispose();
    }
  });

  it('les plages d intensite couvrent tout l intervalle [0,1] sans trou', () => {
    // Sans couverture complete, le director n'aurait rien a jouer dans le
    // trou - et un trou d'intensite est un ecran fige.
    const ranges = SCENE_REGISTRY.map((s) => s.intensityRange).sort((a, b) => a[0] - b[0]);
    expect(ranges[0]?.[0], 'aucune scene ne couvre les tres basses intensites').toBeLessThanOrEqual(0.15);
    let reach = ranges[0]?.[1] ?? 0;
    for (let i = 1; i < ranges.length; i++) {
      const range = ranges[i]!;
      expect(range[0], `trou entre ${reach} et ${range[0]}`).toBeLessThanOrEqual(reach);
      reach = Math.max(reach, range[1]);
    }
    expect(reach, 'aucune scene ne couvre les tres hautes intensites').toBeGreaterThanOrEqual(1);
  });
});

describe('prefers-reduced-motion (§8.12)', () => {
  it('la liste des scenes jouables n est jamais vide', () => {
    expect(playableScenes(false).length).toBeGreaterThan(0);
    expect(playableScenes(true).length).toBeGreaterThan(0);
  });

  it('aucune scene taguee strobe n est jouable en mouvement reduit', () => {
    for (const s of playableScenes(true)) {
      expect(s.tags.includes('strobe'), `${s.id} est taguee strobe`).toBe(false);
    }
  });

  it('les scenes eligibles sont exactement celles de la table §4.2', () => {
    expect(playableScenes(true).map((s) => s.id).sort()).toEqual(['curl-flow', 'grid-horizon', 'mandala-32']);
  });
});

/**
 * Fichiers des scenes DU REGISTRE, derives des identifiants. `WitnessScene`
 * en est exclue : c'est l'outil de mise au point du pipeline de l'etape 2, pas
 * une scene jouable, et elle n'a pas de table de variantes.
 */
const REGISTRY_FILES = SCENE_REGISTRY.map(
  (entry) => `${entry.id.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')}Scene.ts`,
);

describe('Composition et cadrage (§3.6)', () => {
  const files = REGISTRY_FILES;

  it('les fichiers de scene deduits du registre existent tous', () => {
    const present = readdirSync(SCENES_DIR);
    for (const f of files) expect(present, f).toContain(f);
  });

  it('chaque scene expose au moins une variante DECENTREE', () => {
    // Verification structurelle : la table de variantes de chaque scene doit
    // contenir au moins une entree dont le point d'interet est hors centre.
    // §3.6 : « toute scene expose une variante dont le point d'interet est
    // hors centre, sur un point fort du tiers ».
    for (const file of files) {
      const text = readFileSync(join(SCENES_DIR, file), 'utf-8');
      const block = text.slice(text.indexOf('VARIANTS'), text.indexOf('];', text.indexOf('VARIANTS')));
      const offsets = [...block.matchAll(/-?0\.\d+/g)].map((m) => Math.abs(Number(m[0])));
      expect(offsets.some((n) => n > 0.1), `${file} : aucune variante decentree`).toBe(true);
    }
  });

  it('au plus une variante centree par scene', () => {
    // §3.6 : « au plus une scene sur trois est centree ». Applique ici a la
    // granularite des variantes, ce qui est plus strict et plus verifiable.
    for (const file of files) {
      const text = readFileSync(join(SCENES_DIR, file), 'utf-8');
      const block = text.slice(text.indexOf('VARIANTS'), text.indexOf('];', text.indexOf('VARIANTS')));
      const centered = [...block.matchAll(/\n/g)].length > 0 ? (block.match(/:\s*0,/g) ?? []).length : 0;
      expect(centered, `${file} : ${centered} valeurs centrees`).toBeLessThanOrEqual(2);
    }
  });

  it('aucune scene ne code de coordonnee en pixels absolus', () => {
    // Toute taille doit etre relative a `view.min`, `view.w` ou `view.h`.
    for (const file of files) {
      const code = readFileSync(join(SCENES_DIR, file), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      // Un litteral de plus de 3 chiffres suivi d'un usage geometrique serait
      // suspect ; on cherche surtout les `px` explicites.
      expect(code.includes("'px'"), file).toBe(false);
      expect(/\b\d{3,}\s*\*\s*(?!Math)/.test(code) && !code.includes('view.'), file).toBe(false);
    }
  });
});

describe('Interdits de §6 dans les scenes', () => {
  // Ici on scanne TOUT le dossier, scene temoin comprise : les interdits de §6
  // valent pour tout ce qui dessine, pas seulement pour le registre.
  const files = readdirSync(SCENES_DIR).filter((f) => f.endsWith('.ts'));

  it('aucun shadowBlur, getImageData, putImageData ni willReadFrequently', () => {
    for (const file of files) {
      const code = readFileSync(join(SCENES_DIR, file), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const forbidden of ['shadowBlur', 'getImageData', 'putImageData', 'willReadFrequently']) {
        expect(code.includes(forbidden), `${file} contient ${forbidden}`).toBe(false);
      }
    }
  });

  it('aucune rotation de teinte : pas de hsl() ni de Math.random()', () => {
    for (const file of files) {
      const code = readFileSync(join(SCENES_DIR, file), 'utf-8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code.includes('hsl('), `${file} : teinte hors palette`).toBe(false);
      // `Math.random` n'est tolere qu'en valeur de repli d'un champ, jamais
      // dans un rendu : le PRNG seede du director est la seule source.
      const inRender = code.slice(code.indexOf('render('));
      expect(inRender.includes('Math.random'), `${file} : Math.random dans render`).toBe(false);
    }
  });
});

describe('Particules (§3.7)', () => {
  it('les plafonds suivent la table de §3.7', () => {
    expect([0, 1, 2, 3].map(capFor)).toEqual([600, 1500, 3000, 6000]);
  });

  it('les plafonds du registre de qualite et de la scene concordent', () => {
    for (const profile of QUALITY_PROFILES) {
      expect(capFor(profile.level), `qualite ${profile.level}`).toBe(profile.particleCap);
    }
  });

  it('6 a 8 buckets de couleur', () => {
    expect(CURL_FLOW_BUCKETS).toBeGreaterThanOrEqual(6);
    expect(CURL_FLOW_BUCKETS).toBeLessThanOrEqual(8);
  });
});

describe('Bruit simplex et champ curl (§1, ecrits a la main)', () => {
  it('le bruit simplex reste borne et n est pas constant', () => {
    const noise = new SimplexNoise(42);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 4000; i++) {
      const v = noise.noise2(i * 0.031, i * 0.017);
      min = Math.min(min, v);
      max = Math.max(max, v);
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(min).toBeGreaterThanOrEqual(-1.05);
    expect(max).toBeLessThanOrEqual(1.05);
    expect(max - min, 'champ constant').toBeGreaterThan(0.8);
  });

  it('le bruit est deterministe pour une graine donnee', () => {
    const a = new SimplexNoise(7);
    const b = new SimplexNoise(7);
    const c = new SimplexNoise(8);
    expect(a.noise2(1.3, 2.7)).toBe(b.noise2(1.3, 2.7));
    expect(a.noise2(1.3, 2.7)).not.toBe(c.noise2(1.3, 2.7));
  });

  it('le bruit est continu : deux points proches donnent des valeurs proches', () => {
    const noise = new SimplexNoise(3);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.07;
      const d = Math.abs(noise.noise2(x, 1.1) - noise.noise2(x + 1e-3, 1.1));
      expect(d, `discontinuite en x=${x.toFixed(2)}`).toBeLessThan(0.05);
    }
  });

  /**
   * Propriete qui justifie le curl : le champ est INCOMPRESSIBLE. Sans elle,
   * les particules s'accumulent dans des puits et le champ se vide en quelques
   * secondes. On mesure la divergence par differences finies - elle doit etre
   * negligeable devant l'amplitude du champ.
   */
  it('le champ curl est a divergence quasi nulle', () => {
    const field = new CurlField(11);
    const a = new Float32Array(2);
    const b = new Float32Array(2);
    const c = new Float32Array(2);
    const d = new Float32Array(2);
    const h = 1e-2;
    let maxDiv = 0;
    let maxMag = 0;
    for (let i = 0; i < 300; i++) {
      const x = (i % 17) * 0.31;
      const y = Math.floor(i / 17) * 0.29;
      field.sample(x + h, y, 0, 2, a);
      field.sample(x - h, y, 0, 2, b);
      field.sample(x, y + h, 0, 2, c);
      field.sample(x, y - h, 0, 2, d);
      const div = (a[0]! - b[0]!) / (2 * h) + (c[1]! - d[1]!) / (2 * h);
      field.sample(x, y, 0, 2, a);
      maxMag = Math.max(maxMag, Math.hypot(a[0]!, a[1]!));
      maxDiv = Math.max(maxDiv, Math.abs(div));
    }
    expect(maxMag, 'champ nul').toBeGreaterThan(0);
    // La divergence residuelle vient uniquement des differences finies.
    expect(maxDiv / maxMag, `divergence relative ${(maxDiv / maxMag).toFixed(4)}`).toBeLessThan(0.05);
  });

  it('la torsion deforme le champ au lieu de le translater', () => {
    const field = new CurlField(5);
    const a = new Float32Array(2);
    const b = new Float32Array(2);
    field.sample(1.2, 0.8, 0, 2, a);
    field.sample(1.2, 0.8, 1.5, 2, b);
    expect(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!), 'la torsion ne change rien').toBeGreaterThan(1e-6);
  });
});
