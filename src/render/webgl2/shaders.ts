/**
 * Sources GLSL ES 3.00 du backend WebGL2 (ADR-013, lot 1) — chaînes dans le
 * source, aucune dépendance (règle du chantier : « shaders en chaînes »).
 *
 * Conventions partagées par tous les programmes :
 * - L'espace de travail est l'ESPACE PIXEL de la cible active (origine en
 *   haut à gauche, y vers le bas), le même que `Canvas2DRenderer` — la
 *   conversion espace normalisé → pixels reste côté TypeScript (`toPx`).
 * - Hors écran (FBO), la projection N'INVERSE PAS y : la ligne 0 du
 *   framebuffer est la ligne 0 de l'image, et tous les blits
 *   intermédiaires échantillonnent à l'identité. La SEULE inversion a lieu
 *   à la présentation finale vers le framebuffer par défaut (`uYSign`
 *   du programme blit), dont la ligne 0 s'affiche en BAS du canvas.
 * - Toutes les couleurs voyagent PRÉMULTIPLIÉES (les textures de sprites
 *   sont uploadées avec `UNPACK_PREMULTIPLY_ALPHA_WEBGL`) : c'est ce qui
 *   permet `normal` en `(ONE, ONE_MINUS_SRC_ALPHA)` et `screen` en
 *   `(ONE, ONE_MINUS_SRC_COLOR)` en fonction fixe.
 */

/** Sommet commun des géométries en espace pixel (traits, polygones, aplat). */
export const PRIM_VS = `#version 300 es
in vec2 aPos;
uniform mat3 uTransform;
uniform vec2 uTargetSize;
void main() {
  vec3 p = uTransform * vec3(aPos, 1.0);
  gl_Position = vec4(p.x / uTargetSize.x * 2.0 - 1.0, p.y / uTargetSize.y * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Aplat de couleur prémultipliée. */
export const PRIM_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}
`;

/**
 * Cercle plein ou anneau par champ de distance signé : un quad autour du
 * centre, l'antialiasing (~1 px local) fait au fragment — l'équivalent du
 * lissage du rasterizer sur `ctx.arc()`.
 */
export const CIRCLE_VS = `#version 300 es
in vec2 aCorner; // [0,1]²
uniform mat3 uTransform;
uniform vec2 uTargetSize;
uniform vec2 uCenter;  // px
uniform float uExtent; // rayon + demi-trait + marge AA, px
out vec2 vLocal;       // offset px AVANT transformation (le SDF vit là)
void main() {
  vLocal = (aCorner * 2.0 - 1.0) * uExtent;
  vec3 p = uTransform * vec3(uCenter + vLocal, 1.0);
  gl_Position = vec4(p.x / uTargetSize.x * 2.0 - 1.0, p.y / uTargetSize.y * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const CIRCLE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;      // prémultipliée
uniform float uRadius;    // px
uniform float uHalfWidth; // px ; <= 0 => disque plein
in vec2 vLocal;
out vec4 outColor;
void main() {
  float d = length(vLocal);
  float cov;
  if (uHalfWidth <= 0.0) {
    cov = clamp(uRadius + 0.5 - d, 0.0, 1.0);
  } else {
    cov = clamp(uHalfWidth + 0.5 - abs(d - uRadius), 0.0, 1.0);
  }
  outColor = uColor * cov;
}
`;

/**
 * Dégradé radial plein cadre — le quad couvre (0,0)-(W,H) à travers la
 * transformation courante (comme le `fillRect` de Canvas), le dégradé est
 * évalué en espace LOCAL (avant transformation), comme un
 * `createRadialGradient` qui vit dans le repère utilisateur courant.
 * Interpolation en couleurs NON prémultipliées puis prémultiplication —
 * c'est l'interpolation des dégradés Canvas.
 */
export const GRADIENT_VS = `#version 300 es
in vec2 aPos; // px locaux
uniform mat3 uTransform;
uniform vec2 uTargetSize;
out vec2 vLocal;
void main() {
  vLocal = aPos;
  vec3 p = uTransform * vec3(aPos, 1.0);
  gl_Position = vec4(p.x / uTargetSize.x * 2.0 - 1.0, p.y / uTargetSize.y * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const GRADIENT_FS = `#version 300 es
precision highp float;
uniform vec2 uCenter;    // px
uniform float uR0;
uniform float uR1;
uniform vec4 uInner;     // NON prémultipliée
uniform vec4 uOuter;     // NON prémultipliée
in vec2 vLocal;
out vec4 outColor;
void main() {
  float t = uR1 > uR0 ? clamp((length(vLocal - uCenter) - uR0) / (uR1 - uR0), 0.0, 1.0) : 1.0;
  vec4 c = mix(uInner, uOuter, t);
  outColor = vec4(c.rgb * c.a, c.a);
}
`;

/** Sprites instanciés : un quad, N instances (x, y, taille px, alpha). */
export const SPRITE_VS = `#version 300 es
in vec2 aCorner;   // [0,1]²
in vec4 aInstance; // centre x, centre y (px), taille (px), alpha
uniform mat3 uTransform;
uniform vec2 uTargetSize;
out vec2 vUV;
out float vAlpha;
void main() {
  vUV = aCorner;
  vAlpha = aInstance.w;
  vec2 local = aInstance.xy + (aCorner - 0.5) * aInstance.z;
  vec3 p = uTransform * vec3(local, 1.0);
  gl_Position = vec4(p.x / uTargetSize.x * 2.0 - 1.0, p.y / uTargetSize.y * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const SPRITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUV;
in float vAlpha;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUV) * vAlpha;
}
`;

/**
 * Blit générique en espace ÉCRAN (aucune transformation de frame) : rectangle
 * de destination en px, teinte multiplicative + alpha global — sert au
 * feedback (`drawFeedback`), à la composition du bloom, aux deux passes
 * teintées de l'aberration chromatique et à la présentation finale
 * (`uYSign = -1.0` uniquement là, voir l'en-tête du fichier).
 */
export const BLIT_VS = `#version 300 es
in vec2 aCorner; // [0,1]²
uniform vec4 uDstRect; // x, y, w, h en px de la cible
uniform vec2 uTargetSize;
uniform float uYSign;  // 1.0 hors écran, -1.0 vers le framebuffer par défaut
out vec2 vUV;
void main() {
  vUV = aCorner;
  vec2 p = uDstRect.xy + aCorner * uDstRect.zw;
  gl_Position = vec4(p.x / uTargetSize.x * 2.0 - 1.0, (p.y / uTargetSize.y * 2.0 - 1.0) * uYSign, 0.0, 1.0);
}
`;

export const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec4 uTint;   // multiplicative (1,1,1,1 = neutre)
uniform float uAlpha; // équivalent globalAlpha
in vec2 vUV;
out vec4 outColor;
void main() {
  outColor = texture(uTex, vUV) * vec4(uTint.rgb, 1.0) * uAlpha;
}
`;

/**
 * Composition des modes `overlay`/`difference` (ADR-013 : « par calque
 * intermédiaire + shader », inexprimables en blending fixe). Lit la scène
 * (fond) et le calque (source), écrit la composition dans l'AUTRE texture de
 * scène (ping-pong — lire et écrire la même texture est indéfini en GL).
 * Formules du modèle W3C Compositing & Blending, en couleurs droites.
 */
export const LAYER_COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uDst; // scène (backdrop), prémultipliée
uniform sampler2D uSrc; // calque (source), prémultiplié
uniform int uMode;      // 0 = overlay, 1 = difference
in vec2 vUV;
out vec4 outColor;
void main() {
  vec4 S = texture(uSrc, vUV);
  vec4 D = texture(uDst, vUV);
  float as = S.a;
  float ab = D.a;
  vec3 cs = as > 0.0 ? S.rgb / as : vec3(0.0);
  vec3 cb = ab > 0.0 ? D.rgb / ab : vec3(0.0);
  vec3 B;
  if (uMode == 0) {
    B = mix(2.0 * cb * cs, 1.0 - 2.0 * (1.0 - cb) * (1.0 - cs), step(0.5, cb));
  } else {
    B = abs(cb - cs);
  }
  vec3 cs2 = (1.0 - ab) * cs + ab * B;
  float ao = as + ab * (1.0 - as);
  outColor = vec4(as * cs2 + ab * cb * (1.0 - as), ao);
}
`;

export const LAYER_COMPOSITE_VS = BLIT_VS;

/**
 * Extraction des hautes lumières du bloom — réplique `extractHighlights`
 * (bloomMath.ts) : seuil doux sur le canal max en couleurs DROITES (le
 * pipeline Canvas lit des pixels non prémultipliés via getImageData), pixel
 * nul sous le seuil, atténuation proportionnelle à l'excès au-dessus.
 * Le sous-échantillonnage vers le petit buffer est fait par le même passage
 * (échantillonnage linéaire), comme le `drawImage` réducteur de l'étape 1
 * du bloom Canvas.
 */
export const BLOOM_EXTRACT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uThreshold; // 0..1 (HIGHLIGHT_THRESHOLD / 255)
in vec2 vUV;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUV);
  vec3 straight = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
  float brightness = max(straight.r, max(straight.g, straight.b));
  if (brightness <= uThreshold) {
    outColor = vec4(0.0);
  } else {
    float factor = uThreshold < 1.0 ? (brightness - uThreshold) / (1.0 - uThreshold) : 1.0;
    outColor = vec4(straight * factor * c.a, c.a);
  }
}
`;

/**
 * Flou gaussien séparable (une passe X, une passe Y sur le petit buffer).
 * σ = rayon/2 — la correspondance du `filter: blur(r)` Canvas, dont la
 * déviation standard vaut la moitié du rayon (spécification Filter Effects).
 * Le pas d'échantillonnage `uStepPx` se dilate quand σ dépasse ce que
 * MAX_TAPS couvre, le filtrage linéaire lissant les interstices.
 */
export const BLUR_MAX_TAPS = 24;

export const BLUR_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir;     // (1,0) ou (0,1)
uniform vec2 uTexSize; // px du petit buffer
uniform float uSigma;  // px
uniform float uStepPx; // px entre deux prises
in vec2 vUV;
out vec4 outColor;
void main() {
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (int i = -${BLUR_MAX_TAPS}; i <= ${BLUR_MAX_TAPS}; i++) {
    float d = float(i) * uStepPx;
    float w = exp(-0.5 * (d / uSigma) * (d / uSigma));
    acc += w * texture(uTex, vUV + uDir * d / uTexSize);
    wsum += w;
  }
  outColor = acc / wsum;
}
`;
