/**
 * Le bloom appartient au PRESET (docs/17_PHASE2_VISUELS.md §6.5, chantier 9).
 *
 * §6.5, en entier : « `setBloomConfig` doit être piloté par le preset et par la
 * macro Glow, avec le niveau de qualité comme PLAFOND et non comme source. »
 *
 * CE QUI SE PASSAIT AVANT
 * -----------------------
 * `ui/App.ts` et `export/ExportPipeline.ts` passaient directement
 * `QUALITY_LEVEL_CONFIGS[niveau].bloom` au `Renderer`. Conséquence : un preset
 * volontairement mat (`lofi`, `glow` à 0,3) et un preset volontairement
 * incandescent (`trap-dark`, `glow` à 0,7) recevaient EXACTEMENT le même bloom,
 * et la macro Glow - qui a pourtant un curseur dans le panneau Simple - n'avait
 * aucune action sur lui. C'est un cas de plus du diagnostic de §5 : un réglage
 * offert au choix qui ne change rien.
 *
 * LE PLAFOND N'EST PAS LA SOURCE
 * ------------------------------
 * La distinction est celle que §6.5 demande, et elle a une conséquence
 * pratique : le niveau `low` désactive le bloom (`enabled: false`) et son veto
 * l'emporte toujours - c'est le rôle d'un plafond. Mais un niveau `ultra`
 * n'IMPOSE plus deux passes à un preset qui n'en veut qu'une.
 *
 * `resolutionScale` reste entièrement au plafond : c'est un réglage de COÛT
 * (taille du buffer d'extraction), pas d'intention artistique. Un preset n'a
 * rien à dire dessus.
 */

import type { PresetBloomConfig } from './schema';

/**
 * Forme du bloom rendu au `Renderer`.
 *
 * Déclarée ICI plutôt qu'importée : la règle de dépendance interdit à
 * `presets/` d'atteindre `render/` comme elle interdit à `render/` d'atteindre
 * `perf/`. Le typage structurel de TypeScript fait interopérer les trois
 * déclarations sans import, `ui/App.ts` faisant le pont - exactement
 * l'arbitrage déjà écrit au-dessus de `BloomConfig` dans `render/Renderer.ts`.
 */
export interface ResolvedBloom {
  readonly enabled: boolean;
  readonly resolutionScale: number;
  readonly passes: number;
}

/** Bloom d'un preset qui n'en déclare pas : deux passes, comportement d'avant ce chantier. */
export const DEFAULT_PRESET_BLOOM: PresetBloomConfig = Object.freeze({ enabled: true, passes: 2 });

/** Nombre de passes maximal, quel que soit le preset. Au-delà le flou devient une brume. */
export const MAX_BLOOM_PASSES = 3;

/**
 * Configuration finale du bloom.
 *
 * @param preset  intention du preset. `undefined` = `DEFAULT_PRESET_BLOOM`.
 * @param glow    macro Glow résolue, 0 à 1.
 * @param ceiling bloom du niveau de qualité courant, qui PLAFONNE le résultat.
 */
export function resolveBloom(
  preset: PresetBloomConfig | undefined,
  glow: number,
  ceiling: ResolvedBloom,
): ResolvedBloom {
  const wanted = preset ?? DEFAULT_PRESET_BLOOM;
  // Le veto du plafond est absolu : `low` coupe le bloom parce que la machine ne
  // suit pas, et aucune intention de preset ne doit pouvoir le rallumer.
  if (!ceiling.enabled || !wanted.enabled) {
    return Object.freeze({ enabled: false, resolutionScale: ceiling.resolutionScale, passes: 0 });
  }

  // La macro Glow module les passes AUTOUR de l'intention du preset : à 0,5 -
  // valeur neutre - le preset est rendu tel qu'il se décrit. En dessous le halo
  // se resserre, au-dessus il s'étale. Une macro qui remplacerait l'intention
  // plutôt que de la moduler rendrait tous les presets identiques au curseur
  // poussé à fond, ce qui est exactement le défaut qu'on corrige.
  //
  // Le facteur est `2 x glow` et non `0,5 + glow`, et un test a tranché : avec
  // la seconde forme, un preset d'UNE passe à Glow = 0 donnait 0,5, que
  // `Math.round` remonte à 1 - le curseur n'avait pas de bas de course, alors
  // que le commentaire au-dessus affirmait le contraire.
  const scaled = wanted.passes * 2 * Math.min(1, Math.max(0, glow));
  // `Math.round` et non `Math.ceil` : à Glow = 0, un preset d'une passe doit
  // pouvoir tomber à zéro, sinon le curseur n'a pas de bas de course.
  const passes = Math.min(MAX_BLOOM_PASSES, ceiling.passes, Math.round(scaled));
  if (passes <= 0) {
    return Object.freeze({ enabled: false, resolutionScale: ceiling.resolutionScale, passes: 0 });
  }
  return Object.freeze({ enabled: true, resolutionScale: ceiling.resolutionScale, passes });
}
