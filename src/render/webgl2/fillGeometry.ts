/**
 * Triangulation CPU des polygones de `fillPath` (ADR-013, lot 1) — découpe
 * d'oreilles (ear clipping) sur polygone SIMPLE, sens de parcours quelconque.
 *
 * Pourquoi pas un éventail : l'ADR-013 prévoyait « trianguler simple,
 * VÉRIFIER sur les 8 styles avant de sophistiquer ». La vérification à la
 * sonde a tranché : les rubans d'`aurore` (`AuroraRibbons`, 80 points en
 * aller-retour autour d'une médiane ondulée) sont CONCAVES, et l'éventail
 * depuis le sommet 0 remplissait tout le creux de l'onde — luminance ×3,
 * couverture ×14 sur ce style. La découpe d'oreilles remplit exactement le
 * polygone, en O(n²) sur des tailles de l'ordre de 80 points — négligeable.
 *
 * Fonctions PURES, testables en Node (`bloomMath`/`strokeGeometry`, même
 * principe). Limite documentée : polygone SIMPLE attendu (les styles n'en
 * produisent pas d'auto-intersectant) ; en cas de blocage numérique
 * (colinéarités, points confondus des extrémités effilées), le reste est
 * émis en éventail plutôt que de boucler — jamais d'image absente.
 */

/** Indices produits au pire : (count − 2) triangles × 3. */
export function triangleIndexCapacity(count: number): number {
  return Math.max(0, (count - 2) * 3);
}

/** Aire signée ×2 du triangle (a, b, c) — > 0 si parcours antihoraire. */
function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** `p` est-il DANS le triangle (a, b, c) supposé antihoraire (bords inclus) ? */
function pointInTriangle(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  return cross(ax, ay, bx, by, px, py) >= 0 && cross(bx, by, cx, cy, px, py) >= 0 && cross(cx, cy, ax, ay, px, py) >= 0;
}

/**
 * Triangule les `count` premiers points de `pts` (paires x,y ENTRELACÉES,
 * le format du tampon de sommets du renderer) et écrit les indices de
 * triangles dans `out` (capacité : `triangleIndexCapacity(count)`).
 * Retourne le nombre d'INDICES écrits (multiple de 3).
 */
export function triangulatePolygon(pts: Float32Array, count: number, out: Uint16Array): number {
  if (count < 3) return 0;
  const X = (i: number): number => pts[i * 2]!;
  const Y = (i: number): number => pts[i * 2 + 1]!;

  // Sens de parcours global : la découpe travaille en antihoraire, un
  // polygone horaire est simplement lu à l'envers.
  let area2 = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    area2 += X(i) * Y(j) - X(j) * Y(i);
  }

  // Liste chaînée implicite des sommets restants, dans le sens antihoraire.
  const order = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    order[i] = area2 >= 0 ? i : count - 1 - i;
  }

  let written = 0;
  let remaining = count;
  let guard = 0; // tours complets sans oreille trouvée

  while (remaining > 3) {
    let clipped = false;
    for (let i = 0; i < remaining; i++) {
      const iPrev = order[(i + remaining - 1) % remaining]!;
      const iCurr = order[i]!;
      const iNext = order[(i + 1) % remaining]!;
      const ax = X(iPrev);
      const ay = Y(iPrev);
      const bx = X(iCurr);
      const by = Y(iCurr);
      const cx = X(iNext);
      const cy = Y(iNext);

      const convex = cross(ax, ay, bx, by, cx, cy);
      if (convex <= 0) continue; // sommet rentrant (ou plat) : pas une oreille

      // Une oreille ne contient aucun AUTRE sommet restant.
      let contains = false;
      for (let k = 0; k < remaining; k++) {
        const idx = order[k]!;
        if (idx === iPrev || idx === iCurr || idx === iNext) continue;
        if (pointInTriangle(X(idx), Y(idx), ax, ay, bx, by, cx, cy)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;

      out[written++] = iPrev;
      out[written++] = iCurr;
      out[written++] = iNext;
      order.splice(i, 1);
      remaining--;
      clipped = true;
      break;
    }

    if (!clipped) {
      guard++;
      if (guard >= 2) {
        // Blocage numérique (colinéarités, points confondus) : émettre le
        // reste en éventail — approximation locale plutôt qu'un trou.
        for (let i = 1; i < remaining - 1; i++) {
          out[written++] = order[0]!;
          out[written++] = order[i]!;
          out[written++] = order[i + 1]!;
        }
        return written;
      }
      // Deuxième passe : tolérer les oreilles PLATES (convex == 0), qui
      // n'ajoutent aucune surface mais débloquent les chaînes colinéaires.
      let flat = -1;
      for (let i = 0; i < remaining; i++) {
        const iPrev = order[(i + remaining - 1) % remaining]!;
        const iCurr = order[i]!;
        const iNext = order[(i + 1) % remaining]!;
        if (cross(X(iPrev), Y(iPrev), X(iCurr), Y(iCurr), X(iNext), Y(iNext)) === 0) {
          flat = i;
          break;
        }
      }
      if (flat >= 0) {
        order.splice(flat, 1);
        remaining--;
        guard = 0;
      }
    }
  }

  if (remaining === 3) {
    out[written++] = order[0]!;
    out[written++] = order[1]!;
    out[written++] = order[2]!;
  }
  return written;
}
