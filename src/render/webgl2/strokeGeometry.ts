/**
 * Extrusion CPU d'une polyligne en bande de triangles (ADR-013, lot 1) —
 * l'équivalent WebGL2 de `ctx.stroke()` : Canvas 2D épaissit les chemins par
 * le rasterizer, un backend GL doit produire la géométrie lui-même.
 *
 * Fonctions PURES, aucune référence WebGL : séparées de `WebGL2Renderer.ts`
 * pour rester testables en Node, même principe que `bloomMath.ts` /
 * `chromaticMath.ts` (voir leurs en-têtes).
 *
 * Convention de sortie : bande de triangles (TRIANGLE_STRIP), deux sommets
 * par point du chemin — `p + m·s` puis `p − m·s`, où `m` est la normale
 * mitrée du point. Chemin fermé : la première paire est répétée en fin de
 * bande pour refermer la boucle.
 *
 * Joints : mitre (le défaut Canvas), bornée à `MITER_LIMIT × demi-largeur` —
 * Canvas bascule en biseau au-delà de `miterLimit` (10 par défaut) ; ici la
 * mitre est simplement ÉCRÊTÉE à la même longueur, ce qui évite de casser la
 * topologie de la bande (un biseau vrai insérerait des sommets). Différence
 * sub-pixel sur les angles très fermés, mesurée par la sonde du lot 1.
 * Extrémités ouvertes : coupe franche (`butt`, le défaut Canvas).
 */

/** Même valeur que le `miterLimit` par défaut de Canvas 2D. */
export const MITER_LIMIT = 10;

/** En-dessous, deux points sont confondus et le segment est ignoré (px). */
const EPSILON = 1e-6;

/**
 * Nombre de floats que `buildStrokeStrip` peut écrire au pire pour `count`
 * points : 2 sommets × 2 coordonnées par point, +1 paire de fermeture.
 */
export function strokeStripCapacity(count: number): number {
  return (count + 1) * 4;
}

/**
 * Construit la bande de triangles d'un trait de demi-largeur `halfWidth`
 * (px) le long des `count` premiers points de `xs`/`ys` (px, déjà convertis
 * par l'appelant). Écrit les sommets `(x, y)` entrelacés dans `out` et
 * retourne le NOMBRE DE SOMMETS écrits (pas de floats). `out` doit avoir une
 * capacité d'au moins `strokeStripCapacity(count)` floats.
 *
 * Points consécutifs confondus : ignorés (le sommet reprend la direction du
 * segment précédent), comme le rasterizer Canvas qui ne trace rien pour un
 * segment de longueur nulle.
 */
export function buildStrokeStrip(
  xs: Float32Array,
  ys: Float32Array,
  count: number,
  halfWidth: number,
  closed: boolean,
  out: Float32Array,
): number {
  if (count < 2) return 0;

  let vertices = 0;
  const maxMiter = halfWidth * MITER_LIMIT;

  for (let i = 0; i < count; i++) {
    const px = xs[i]!;
    const py = ys[i]!;

    // Directions des segments adjacents — en boucle pour un chemin fermé,
    // répétées à l'identique aux extrémités d'un chemin ouvert (coupe butt).
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < count - 1;
    const prevIdx = i === 0 ? count - 1 : i - 1;
    const nextIdx = i === count - 1 ? 0 : i + 1;

    let d0x = 0;
    let d0y = 0;
    if (hasPrev) {
      d0x = px - xs[prevIdx]!;
      d0y = py - ys[prevIdx]!;
    }
    let d1x = 0;
    let d1y = 0;
    if (hasNext) {
      d1x = xs[nextIdx]! - px;
      d1y = ys[nextIdx]! - py;
    }

    let l0 = Math.hypot(d0x, d0y);
    let l1 = Math.hypot(d1x, d1y);
    // Segment dégénéré d'un côté : reprendre la direction de l'autre.
    if (l0 <= EPSILON) {
      d0x = d1x;
      d0y = d1y;
      l0 = l1;
    }
    if (l1 <= EPSILON) {
      d1x = d0x;
      d1y = d0y;
      l1 = l0;
    }
    if (l0 <= EPSILON) continue; // les deux segments sont nuls : point isolé, rien à tracer

    // Normales unitaires (rotation +90° : (-dy, dx)).
    const n0x = -d0y / l0;
    const n0y = d0x / l0;
    const n1x = -d1y / l1;
    const n1y = d1x / l1;

    // Mitre = bissectrice des normales ; sa longueur croît en 1/cos(θ/2).
    let mx = n0x + n1x;
    let my = n0y + n1y;
    const ml = Math.hypot(mx, my);
    let scale: number;
    if (ml <= EPSILON) {
      // Demi-tour exact (θ = 180°) : la mitre est indéfinie, retomber sur la
      // normale du premier segment — même dégradation qu'un biseau plat.
      mx = n0x;
      my = n0y;
      scale = halfWidth;
    } else {
      mx /= ml;
      my /= ml;
      const cosHalf = mx * n0x + my * n0y; // cos(θ/2), toujours > 0 hors demi-tour
      scale = cosHalf > EPSILON ? halfWidth / cosHalf : maxMiter;
      if (scale > maxMiter) scale = maxMiter; // écrêtage façon miterLimit
    }

    out[vertices * 2] = px + mx * scale;
    out[vertices * 2 + 1] = py + my * scale;
    out[vertices * 2 + 2] = px - mx * scale;
    out[vertices * 2 + 3] = py - my * scale;
    vertices += 2;
  }

  if (closed && vertices >= 2) {
    // Referme la boucle : répète la première paire.
    out[vertices * 2] = out[0]!;
    out[vertices * 2 + 1] = out[1]!;
    out[vertices * 2 + 2] = out[2]!;
    out[vertices * 2 + 3] = out[3]!;
    vertices += 2;
  }

  return vertices;
}
