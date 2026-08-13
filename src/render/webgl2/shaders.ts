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
uniform vec4 uInner;     // NON prémultipliée, sRGB
uniform vec4 uOuter;     // NON prémultipliée, sRGB
uniform float uLinearize; // 1.0 en HDR : sortie linéaire (l'interpolation reste en sRGB, comme Canvas)
in vec2 vLocal;
out vec4 outColor;
${'' /* décodage sRGB exact — partagé par copie, GLSL n'a pas d'import */}
vec3 srgbToLinear3(vec3 c) {
  bvec3 lo = lessThanEqual(c, vec3(0.04045));
  vec3 a = c / 12.92;
  vec3 b = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(b, a, vec3(lo));
}
void main() {
  float t = uR1 > uR0 ? clamp((length(vLocal - uCenter) - uR0) / (uR1 - uR0), 0.0, 1.0) : 1.0;
  vec4 c = mix(uInner, uOuter, t);
  vec3 rgb = uLinearize > 0.5 ? srgbToLinear3(c.rgb) : c.rgb;
  outColor = vec4(rgb * c.a, c.a);
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
uniform float uLinearize; // 1.0 en HDR : décodage sRGB APRÈS filtrage (parité avec le drawImage Canvas, qui filtre en sRGB)
in vec2 vUV;
in float vAlpha;
out vec4 outColor;
vec3 srgbToLinear3(vec3 c) {
  bvec3 lo = lessThanEqual(c, vec3(0.04045));
  vec3 a = c / 12.92;
  vec3 b = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(b, a, vec3(lo));
}
void main() {
  vec4 t = texture(uTex, vUV);
  if (uLinearize > 0.5) {
    vec3 straight = t.a > 0.0 ? t.rgb / t.a : vec3(0.0);
    t = vec4(srgbToLinear3(straight) * t.a, t.a);
  }
  outColor = t * vAlpha;
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
  vec4 c = texture(uTex, vUV) * vec4(uTint.rgb, 1.0) * uAlpha;
  // L'alpha accumulé d'un buffer flottant peut dépasser 1 (fusions
  // additives) ; recopié tel quel puis composé en normal, il donnerait un
  // poids NÉGATIF au fond (ONE_MINUS_SRC_ALPHA). Borné ici — sans effet en
  // SDR, où l'alpha est déjà écrêté à 1 par le format.
  outColor = vec4(c.rgb, min(c.a, 1.0));
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
  // Alpha accumulé borné (buffers flottants, voir TONEMAP_FS) : au-delà de
  // 1, la déprémultiplication sous-estimerait les couleurs droites.
  float as = min(S.a, 1.0);
  float ab = min(D.a, 1.0);
  vec3 cs = as > 0.0 ? S.rgb / as : vec3(0.0);
  vec3 cb = ab > 0.0 ? D.rgb / ab : vec3(0.0);
  // Les formules de fusion W3C sont définies sur [0,1] : en HDR, les valeurs
  // linéaires accumulées peuvent dépasser 1 — bornées ICI seulement (le
  // source-over du bas reste non borné). Sans effet en SDR.
  cb = clamp(cb, 0.0, 1.0);
  cs = clamp(cs, 0.0, 1.0);
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

/**
 * Bright-pass du bloom HDR (ADR-013, lot 2) : seuil PHYSIQUE sur l'énergie
 * linéaire — l'accumulation additive au-delà de 1 existe réellement en 16F
 * au lieu d'être écrêtée avant le bloom. Seuil doux proportionnel à l'excès,
 * même esprit que `extractHighlights` (bloomMath) dont le seuil sRGB 200/255
 * est converti en linéaire (`hdrMath.BLOOM_THRESHOLD_LINEAR`).
 */
export const BLOOM_BRIGHTPASS_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uThreshold; // linéaire
in vec2 vUV;
out vec4 outColor;
void main() {
  // Radiance directe (scène opaque, voir TONEMAP_FS) ; alpha de sortie NUL :
  // la composition additive du bloom ne doit ajouter que de la LUMIÈRE,
  // jamais gonfler l'alpha accumulé de la scène.
  vec3 c = texture(uTex, vUV).rgb;
  float energy = max(c.r, max(c.g, c.b));
  float factor = energy > uThreshold ? (energy - uThreshold) / max(energy, 1e-6) : 0.0;
  outColor = vec4(c * factor, 0.0);
}
`;

/**
 * Tone mapping filmique (ADR-013, lot 2) : scène 16F LINÉAIRE -> image
 * d'affichage sRGB. Les deux courbes candidates de l'ADR sont embarquées et
 * commutées par uniforme (uCurve 0 = ACES Narkowicz, 1 = AgX minimal) — le
 * choix par défaut est tranché À LA MESURE (voir hdrMath.ts et le JOURNAL).
 * Miroir TypeScript exact : hdrMath.ts.
 */
export const TONEMAP_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform int uCurve;      // 0 = ACES, 1 = AgX, 2 = pulsar (épaule seule — hdrMath.pulsarToneMap)
uniform float uExposure;
in vec2 vUV;
out vec4 outColor;

vec3 linearToSrgb3(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  bvec3 lo = lessThanEqual(c, vec3(0.0031308));
  vec3 a = c * 12.92;
  vec3 b = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(b, a, vec3(lo));
}

vec3 aces(vec3 x) {
  const float a = 2.51; const float b = 0.03; const float c = 2.43; const float d = 0.59; const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

const mat3 AGX_MAT = mat3(
  0.842479062253094, 0.0423282422610123, 0.0423756549057051,
  0.0784335999999992, 0.878468636469772, 0.0784336,
  0.0792237451477643, 0.0791661274605434, 0.879142973793104);
const mat3 AGX_MAT_INV = mat3(
  1.19687900512017, -0.0528968517574562, -0.0529716355144438,
  -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
  -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
const float AGX_MIN_EV = -12.47393;
const float AGX_MAX_EV = 4.026069;

vec3 agxContrast3(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}

vec3 agx(vec3 v) {
  v = AGX_MAT * max(v, vec3(1e-10));
  v = clamp(log2(v), AGX_MIN_EV, AGX_MAX_EV);
  v = (v - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV);
  v = agxContrast3(v);
  v = AGX_MAT_INV * v;
  // EOTF de sortie de l'ajustement minimal (pow 2,2) : retour au linéaire,
  // pour encoder en sRGB EXACT ensuite — même convention de sortie qu'ACES.
  return pow(clamp(v, 0.0, 1.0), vec3(2.2));
}

const float PULSAR_PIVOT = 0.8;

// Épaule seule : identité sous le pivot (le contenu SDR traverse intact),
// compression exponentielle douce au-dessus — hdrMath.pulsarToneMap.
vec3 pulsarShoulder(vec3 x) {
  vec3 over = max(x - PULSAR_PIVOT, vec3(0.0));
  vec3 shoulder = PULSAR_PIVOT + (1.0 - PULSAR_PIVOT) * (1.0 - exp(-over / (1.0 - PULSAR_PIVOT)));
  return mix(max(x, vec3(0.0)), shoulder, step(PULSAR_PIVOT, x));
}

void main() {
  // PAS de déprémultiplication : la scène est OPAQUE par construction (le
  // clear() du style pose a = 1), donc c.rgb EST la radiance finale. L'alpha
  // du buffer flottant, lui, ACCUMULE au-delà de 1 sous les fusions
  // additives — diviser par lui assombrissait toute l'image (mesuré :
  // radiance ÷1,55 à cause du seul bloom, sonde du lot 2).
  vec3 straight = texture(uTex, vUV).rgb * uExposure;
  vec3 mapped = uCurve == 0 ? aces(straight) : uCurve == 1 ? agx(straight) : pulsarShoulder(straight);
  outColor = vec4(linearToSrgb3(mapped), 1.0);
}
`;

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
