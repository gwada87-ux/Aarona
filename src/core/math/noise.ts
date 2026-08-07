/**
 * Bruit simplex 2D et champ curl, ECRITS A LA MAIN (§1 : aucune dependance
 * npm ajoutee). Implementation de Gustavson, deterministe et seedee.
 *
 * Pourquoi du CURL et pas du bruit brut : un champ de vitesse pris directement
 * dans un bruit a de la divergence, donc les particules s'accumulent dans des
 * puits et se vident des sources. Au bout de quelques secondes tout le monde
 * est agglutine au meme endroit et le champ ne raconte plus rien. Le curl d'un
 * potentiel scalaire est INCOMPRESSIBLE par construction (`div(curl(psi)) = 0`)
 * : la densite de particules reste homogene indefiniment.
 *
 * En 2D, le curl d'un scalaire `psi` est le vecteur `(dpsi/dy, -dpsi/dx)`.
 *
 * Fonctions pures, aucune allocation apres construction.
 */

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/** 8 directions de gradient. Une table plus grande n'ameliore rien en 2D. */
const GRAD_X = new Float32Array([1, -1, 1, -1, 1, -1, 0, 0]);
const GRAD_Y = new Float32Array([1, 1, -1, -1, 0, 0, 1, -1]);

export class SimplexNoise {
  /** Table de permutation doublee : evite un modulo dans la boucle chaude. */
  private readonly perm = new Uint8Array(512);

  constructor(seed = 1) {
    const source = new Uint8Array(256);
    for (let i = 0; i < 256; i++) source[i] = i;
    // Melange de Fisher-Yates pilote par un PRNG seede - pas `Math.random()`,
    // le champ doit etre reproductible d'une session a l'autre.
    let s = seed >>> 0 || 1;
    for (let i = 255; i > 0; i--) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      const tmp = source[i]!;
      source[i] = source[j]!;
      source[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = source[i & 255]!;
  }

  /**
   * Bruit simplex 2D, approximativement dans [-1, 1].
   *
   * hot-path (§8.9) - jusqu'a trois octaves par particule et par trame.
   */
  noise2(xin: number, yin: number): number {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const g0 = this.perm[ii + this.perm[jj]!]! & 7;
    const g1 = this.perm[ii + i1 + this.perm[jj + j1]!]! & 7;
    const g2 = this.perm[ii + 1 + this.perm[jj + 1]!]! & 7;

    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      t0 *= t0;
      n += t0 * t0 * (GRAD_X[g0]! * x0 + GRAD_Y[g0]! * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      t1 *= t1;
      n += t1 * t1 * (GRAD_X[g1]! * x1 + GRAD_Y[g1]! * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      t2 *= t2;
      n += t2 * t2 * (GRAD_X[g2]! * x2 + GRAD_Y[g2]! * y2);
    }
    return 70 * n;
  }

  /**
   * Bruit fractal a `octaves` couches. Chaque octave double la frequence et
   * halve l'amplitude : c'est ce qui donne au champ des tourbillons a
   * plusieurs echelles au lieu d'une seule taille de cellule.
   *
   * hot-path (§8.9) - dans la boucle des particules.
   */
  fbm2(x: number, y: number, octaves: number): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise2(x * freq, y * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return norm > 0 ? sum / norm : 0;
  }
}

/**
 * Champ de vitesse CURL, incompressible par construction.
 *
 * Le potentiel est un fbm ; on en prend le rotationnel par differences finies.
 * `epsilon` doit rester petit devant l'echelle du bruit mais grand devant la
 * precision flottante - 1e-3 en unites de bruit est le compromis usuel.
 */
export class CurlField {
  private readonly noise: SimplexNoise;

  constructor(seed = 1, private readonly epsilon = 1e-3) {
    this.noise = new SimplexNoise(seed);
  }

  /**
   * Remplit `out` (longueur >= 2) avec la vitesse au point `(x, y)`.
   * `twist` deforme le potentiel : c'est par lui que la basse tord le champ.
   *
   * hot-path (§8.9) - la fonction la plus chaude du mode live : jusqu'a
   * 6 000 appels par trame.
   */
  sample(x: number, y: number, twist: number, octaves: number, out: Float32Array): void {
    const e = this.epsilon;
    // Le twist fait tourner les coordonnees d'echantillonnage autour de
    // l'origine du champ : une torsion, pas un simple decalage - un decalage
    // ferait glisser le motif sans le deformer.
    const c = Math.cos(twist);
    const s = Math.sin(twist);
    const xr = x * c - y * s;
    const yr = x * s + y * c;
    const n1 = this.noise.fbm2(xr, yr + e, octaves);
    const n2 = this.noise.fbm2(xr, yr - e, octaves);
    const n3 = this.noise.fbm2(xr + e, yr, octaves);
    const n4 = this.noise.fbm2(xr - e, yr, octaves);
    const dx = (n1 - n2) / (2 * e);
    const dy = (n3 - n4) / (2 * e);
    out[0] = dx;
    out[1] = -dy;
  }
}
