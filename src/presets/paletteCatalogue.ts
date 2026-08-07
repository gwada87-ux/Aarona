/**
 * Catalogue de palettes prêtes (docs/17_PHASE2_VISUELS.md §9.2, chantier 9).
 *
 * POURQUOI CES HUIT-LÀ, ET PAS D'AUTRES INVENTÉES
 * -----------------------------------------------
 * §9.2 est explicite : « Le mode live a 8 palettes OKLCH [...] REGARDE-LES avant
 * d'en inventer. » Elles ont été regardées, et elles sont reprises. Elles ont
 * derrière elles une contrainte que rien n'égale ici : elles ont tourné en
 * direct, sur du son réel, avec une modulation de teinte en temps réel, et un
 * test leur impose déjà 4:1 entre le fond et leur couleur la plus claire.
 * Inventer huit autres familles de teintes aurait produit, au mieux, les mêmes.
 *
 * CE QUI A DÛ ÊTRE AJOUTÉ
 * -----------------------
 * Le mode fichier a des rôles que le mode live n'a pas :
 *
 * - **`bg` est une PAIRE.** Les fonds du mode fichier sont des dégradés
 *   radiaux entre deux valeurs. Le second est le fond live, le premier une
 *   version plus sombre - assombrie en OKLCH, donc à teinte constante.
 * - **`glow`** n'existe pas en live, qui a un `highlight` presque blanc. Un halo
 *   blanc lave la palette : `glow` est ici la primaire remontée en clarté et en
 *   chroma, ce qui garde la couleur du style dans le halo.
 * - **`drift`**, les deux couleurs entre lesquelles `temperature(energy)`
 *   interpole. Choisies aux deux bouts de l'axe de la palette : la secondaire
 *   assombrie pour le bas, l'accent éclairci pour le haut. C'est le seul endroit
 *   du moteur où une interpolation traverse vraiment l'espace des couleurs, d'où
 *   l'OKLCH (voir `presets/palette.ts`).
 *
 * Les recettes sont écrites en OKLCH et converties en hexadécimal au chargement
 * du module. Écrire directement l'hexadécimal aurait figé des valeurs dont
 * personne n'aurait plus pu dire d'où elles viennent - alors qu'ici on lit
 * « même teinte, clarté 0,2 de moins ».
 */

import { oklchToHex, type Oklch } from '../core/color/oklch';
import type { PresetPaletteConfig } from './schema';

interface PaletteRecipe {
  readonly id: string;
  readonly label: string;
  /** Fond du mode live. Le fond sombre du dégradé en est dérivé. */
  readonly background: Oklch;
  readonly primary: Oklch;
  readonly secondary: Oklch;
  readonly accent: Oklch;
  readonly contrast: number;
}

/** Clarté retirée au fond pour obtenir le premier point du dégradé. */
const BG_DARKEN = 0.045;
/** Clarté et chroma ajoutés à la primaire pour obtenir le halo. */
const GLOW_LIGHTEN = 0.14;
const GLOW_CHROMA = 0.02;
/** Bornes de la dérive de température, dérivées de la secondaire et de l'accent. */
const DRIFT_LOW_DARKEN = 0.08;
const DRIFT_HIGH_LIGHTEN = 0.06;

function darker(c: Oklch, amount: number): Oklch {
  return { l: Math.max(0.02, c.l - amount), c: c.c, h: c.h };
}

function lighter(c: Oklch, amount: number, chroma = 0): Oklch {
  return { l: Math.min(0.98, c.l + amount), c: c.c + chroma, h: c.h };
}

const RECIPES: readonly PaletteRecipe[] = Object.freeze([
  {
    id: 'nocturne',
    label: 'Nocturne (bleu nuit)',
    background: { l: 0.13, c: 0.035, h: 262 },
    primary: { l: 0.56, c: 0.15, h: 258 },
    secondary: { l: 0.42, c: 0.12, h: 246 },
    accent: { l: 0.72, c: 0.14, h: 200 },
    contrast: 0.85,
  },
  {
    id: 'glacier',
    label: 'Glacier (cyan froid)',
    background: { l: 0.12, c: 0.028, h: 212 },
    primary: { l: 0.62, c: 0.11, h: 205 },
    secondary: { l: 0.48, c: 0.09, h: 218 },
    accent: { l: 0.78, c: 0.12, h: 168 },
    contrast: 0.8,
  },
  {
    id: 'ember',
    label: 'Braise (rouge orangé)',
    background: { l: 0.12, c: 0.03, h: 28 },
    primary: { l: 0.55, c: 0.17, h: 34 },
    secondary: { l: 0.41, c: 0.14, h: 20 },
    accent: { l: 0.74, c: 0.16, h: 68 },
    contrast: 0.9,
  },
  {
    id: 'amber',
    label: 'Ambre (doré)',
    background: { l: 0.13, c: 0.026, h: 66 },
    primary: { l: 0.66, c: 0.15, h: 72 },
    secondary: { l: 0.5, c: 0.13, h: 84 },
    accent: { l: 0.72, c: 0.17, h: 40 },
    contrast: 0.82,
  },
  {
    id: 'cyan-magenta',
    label: 'Bichromie cyan / magenta',
    background: { l: 0.11, c: 0.032, h: 288 },
    primary: { l: 0.68, c: 0.15, h: 196 },
    secondary: { l: 0.45, c: 0.12, h: 205 },
    accent: { l: 0.63, c: 0.22, h: 330 },
    contrast: 0.95,
  },
  {
    id: 'lime-violet',
    label: 'Bichromie citron / violet',
    background: { l: 0.12, c: 0.03, h: 300 },
    primary: { l: 0.74, c: 0.17, h: 132 },
    secondary: { l: 0.52, c: 0.13, h: 146 },
    // Clarté remontée de 0,55 (valeur du mode live) à 0,63 : à 0,55 l'accent
    // violet ne tenait que 3,81:1 contre le fond du mode fichier, plus sombre
    // que celui du live. Un accent porte de l'information - une frappe, un pic -
    // et doit tenir le seuil de §9.2 pour lui-même, pas seulement par le biais
    // de la primaire.
    accent: { l: 0.63, c: 0.2, h: 296 },
    contrast: 0.95,
  },
  {
    id: 'graphite',
    label: 'Graphite (monochrome)',
    background: { l: 0.12, c: 0.012, h: 264 },
    primary: { l: 0.52, c: 0.022, h: 264 },
    secondary: { l: 0.36, c: 0.018, h: 264 },
    accent: { l: 0.72, c: 0.03, h: 264 },
    contrast: 0.7,
  },
  {
    id: 'pulsar',
    label: 'Pulsar (violet / orange)',
    background: { l: 0.13, c: 0.034, h: 296 },
    primary: { l: 0.6, c: 0.17, h: 296 },
    secondary: { l: 0.5, c: 0.19, h: 332 },
    accent: { l: 0.73, c: 0.17, h: 38 },
    contrast: 0.88,
  },
]);

function toConfig(r: PaletteRecipe): PresetPaletteConfig {
  return Object.freeze({
    bg: [oklchToHex(darker(r.background, BG_DARKEN)), oklchToHex(r.background)] as const,
    primary: oklchToHex(r.primary),
    secondary: oklchToHex(r.secondary),
    accent: oklchToHex(r.accent),
    glow: oklchToHex(lighter(r.primary, GLOW_LIGHTEN, GLOW_CHROMA)),
    contrast: r.contrast,
    drift: Object.freeze({
      lowEnergy: oklchToHex(darker(r.secondary, DRIFT_LOW_DARKEN)),
      highEnergy: oklchToHex(lighter(r.accent, DRIFT_HIGH_LIGHTEN)),
    }),
  });
}

export interface CataloguePalette {
  readonly id: string;
  readonly label: string;
  readonly config: PresetPaletteConfig;
}

export const PALETTE_CATALOGUE: readonly CataloguePalette[] = Object.freeze(
  RECIPES.map((r) => Object.freeze({ id: r.id, label: r.label, config: toConfig(r) })),
);

export function cataloguePaletteById(id: string): CataloguePalette | null {
  return PALETTE_CATALOGUE.find((p) => p.id === id) ?? null;
}
