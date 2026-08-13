/**
 * Correspondance HARMONIE -> teinte (ADR-015, lot 1). Module PUR : aucune
 * couleur, aucun canvas, seulement de l'arithmétique musicale — donc testable
 * en Node, comme `bloomMath`, `strokeGeometry` ou `hdrMath`.
 *
 * ## Pourquoi le cercle des quintes, et pas `pitchClass / 12`
 *
 * Une correspondance linéaire par classe de hauteur rendrait Do et Si
 * visuellement VOISINS alors qu'ils sont harmoniquement éloignés, et Do et Sol
 * ÉLOIGNÉS alors qu'ils sont les plus proches parents qui soient. Pour un
 * produit dont le différenciateur est « le visuel connaît la musique », c'est
 * l'erreur à ne pas commettre. La distance en QUINTES, elle, est
 * proportionnelle à l'écart harmonique perçu.
 *
 * ## Pourquoi c'est RELATIF à un centre tonal
 *
 * Le morceau doit se colorer à la teinte de sa palette AU REPOS, et ne s'en
 * écarter que lorsqu'il module. Le décalage est donc mesuré depuis le centre
 * tonal (le premier accord annoncé après un `reset`), pas depuis un Do absolu :
 * un morceau en Fa# n'a aucune raison d'être en permanence à l'opposé du
 * cercle chromatique.
 *
 * ## La borne (§3.5 de `render/Palette.ts`)
 *
 * `render/Palette.ts` interdit la rotation de teinte pilotée par un index ou
 * par l'horloge — « la signature de l'amateurisme » — et borne toute
 * modulation temps réel à `hueModulation`. Ce module n'y échappe pas : il ne
 * produit qu'une FRACTION (`CHORD_HUE_SHARE`) de cette enveloppe, et
 * `PaletteBook` retire du budget de modulation par élément ce que l'accord
 * consomme. L'excursion totale d'un élément reste donc bornée exactement comme
 * avant ce chantier.
 */

/** Les douze classes de hauteur, do = 0 (convention de `ChordEvent`, doc 12). */
export const PITCH_CLASSES = 12;

/**
 * Écart maximal en quintes entre deux tonalités. Le triton vaut 6 : c'est
 * l'accord le plus lointain, et c'est là que tombe la discontinuité inévitable
 * quand on comprime un cercle de douze sur un arc borné — musicalement juste.
 */
export const MAX_FIFTHS_DISTANCE = 6;

/**
 * Part de l'enveloppe `hueModulation` de la palette cédée à l'harmonie. Le
 * reste demeure disponible pour la modulation par élément, de sorte que la
 * somme des deux ne dépasse jamais l'enveloppe (voir `PaletteBook.refresh`).
 *
 * 0,6 : assez pour que la modulation se VOIE sur une palette normale
 * (nocturne, 22° -> ±13°), assez peu pour que les scènes gardent de quoi
 * distinguer leurs éléments.
 */
export const CHORD_HUE_SHARE = 0.6;

/** Classe de hauteur valide ? (entier 0..11 — tout le reste est refusé à la réception.) */
export function isPitchClass(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < PITCH_CLASSES;
}

/**
 * Position d'une classe de hauteur sur le cercle des quintes.
 * `7` est l'intervalle de quinte juste en demi-tons ; `7 × 7 = 49 ≡ 1 (mod 12)`
 * fait de la multiplication par 7 sa propre réciproque, d'où cette forme.
 */
export function fifthsIndex(pitchClass: number): number {
  return (((pitchClass * 7) % PITCH_CLASSES) + PITCH_CLASSES) % PITCH_CLASSES;
}

/**
 * Distance SIGNÉE en quintes de `fromPc` vers `toPc`, dans `[-5, +6]`.
 * Positive vers les dièses (quinte ascendante : do -> sol), négative vers les
 * bémols (do -> fa).
 *
 * L'asymétrie de la plage est inhérente : douze étant pair, le triton est à
 * égale distance des deux côtés et doit trancher — il est arbitrairement mais
 * DÉTERMINISTEMENT rangé du côté positif.
 */
export function signedFifthsDistance(fromPc: number, toPc: number): number {
  const d = (((fifthsIndex(toPc) - fifthsIndex(fromPc)) % PITCH_CLASSES) + PITCH_CLASSES) % PITCH_CLASSES;
  return d > MAX_FIFTHS_DISTANCE ? d - PITCH_CLASSES : d;
}

/**
 * Décalage de teinte, en degrés OKLCH, de l'accord `rootPc` par rapport au
 * centre tonal `centerPc`. Borné à `±maxDeg` par construction : la valeur
 * retournée vaut `maxDeg × distance / 6`, et `|distance| ≤ 6`.
 *
 * Retourne `0` si l'une des deux classes est invalide — l'absence d'harmonie
 * connue ne décale rien, elle ne devine pas.
 */
export function chordHueOffsetDeg(rootPc: number, centerPc: number, maxDeg: number): number {
  if (!isPitchClass(rootPc) || !isPitchClass(centerPc)) return 0;
  if (!Number.isFinite(maxDeg) || maxDeg <= 0) return 0;
  return (maxDeg * signedFifthsDistance(centerPc, rootPc)) / MAX_FIFTHS_DISTANCE;
}
