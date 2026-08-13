import type { BlendMode, BloomConfig, Color, Renderer, SpriteHandle, SpriteTransform } from '../Renderer';
import type { Viewport } from '../Viewport';
import { MAX_CAMERA_ZOOM, MIN_CAMERA_ZOOM } from '../canvas2d/Canvas2DRenderer';
import { BLOOM_COMPOSITE_ALPHA, HIGHLIGHT_THRESHOLD, computeBlurRadiusPx, computeSmallDimensions } from '../canvas2d/bloomMath';
import { ABERRATION_TINT_ALPHA, computeAberrationOffsetPx } from '../canvas2d/chromaticMath';
import { buildStrokeStrip, strokeStripCapacity } from './strokeGeometry';
import { triangleIndexCapacity, triangulatePolygon } from './fillGeometry';
import {
  BLIT_FS,
  BLIT_VS,
  BLOOM_EXTRACT_FS,
  BLUR_FS,
  BLUR_MAX_TAPS,
  CIRCLE_FS,
  CIRCLE_VS,
  GRADIENT_FS,
  GRADIENT_VS,
  LAYER_COMPOSITE_FS,
  LAYER_COMPOSITE_VS,
  PRIM_FS,
  PRIM_VS,
  SPRITE_FS,
  SPRITE_VS,
} from './shaders';

/**
 * Backend WebGL2 de `Renderer` (ADR-013, lot 1 — parité SDR). Même contrat
 * observable que `Canvas2DRenderer` : espace normalisé (Loi 4) converti en
 * pixels de la cible ACTIVE, mêmes réglages de post (bloom/aberration/
 * résolution interne), mêmes constantes (`bloomMath`/`chromaticMath`).
 *
 * ## Architecture de présentation — pourquoi un canvas GL INTERNE
 *
 * Tout le rendu GL a lieu dans un `OffscreenCanvas` WebGL2 privé, composé en
 * FBO, puis BLITTÉ vers le canvas d'affichage via son contexte 2D dans
 * `endFrame()` (`drawImage` d'un canvas GL dans la même tâche que le rendu :
 * défini, pas besoin de `preserveDrawingBuffer`). Trois raisons, la première
 * étant la contrainte réelle :
 *
 * 1. `FlashLimiter.dimTowards()` fait `getContext('2d')` sur le canvas
 *    d'affichage pour poser son survoile. Un canvas ne porte qu'UN type de
 *    contexte : s'il était WebGL, cet appel rendrait `null` et le voile de
 *    sécurité deviendrait silencieusement inopérant — la Loi 5 (« FlashLimiter
 *    non contournable ») serait violée sans qu'aucun test ne le voie. Avec le
 *    blit, le canvas d'affichage reste 2D et le limiteur est INCHANGÉ.
 * 2. La sonde de vérification (`getImageData`, méthode §10 de la phase 3)
 *    lit le canvas d'affichage à l'identique sur les deux backends — la note
 *    d'ADR-013 sur le canvas 2D intermédiaire est résolue par construction.
 * 3. Le repli `Canvas2DRenderer` (contexte perdu) réutilise le MÊME canvas
 *    d'affichage — son `getContext('2d')` retourne le contexte déjà créé ici.
 *
 * ## Conventions
 *
 * - Espace pixel y vers le bas, identique à `Canvas2DRenderer.toPx` ; hors
 *   écran la projection n'inverse pas y, seule la présentation finale le
 *   fait (voir l'en-tête de `shaders.ts`).
 * - Couleurs prémultipliées ; `normal`/`additive`/`screen`/`multiply` en
 *   blending fixe, `overlay`/`difference` par calque intermédiaire + passe
 *   de composition ping-pong entre deux textures de scène (ADR-013).
 * - Les sprites restent rasterisés par OffscreenCanvas 2D (mêmes pixels
 *   source), uploadés en textures, dessinés en quads instanciés.
 *
 * Non testé automatiquement (comme `Canvas2DRenderer` : nécessiterait un
 * contexte WebGL réel) — vérifié au navigateur par la sonde comparative des
 * 8 styles (docs/JOURNAL.md, lot 1 GPU). La géométrie des traits, elle, est
 * pure et testée (`strokeGeometry.ts`).
 *
 * Limites connues du lot 1, mesurées par la sonde et consignées au JOURNAL :
 * mitre écrêtée au lieu d'un vrai biseau au-delà de `miterLimit` ; remplissage
 * en règle pair-impair de fait (polygones SIMPLES attendus, voir
 * `fillGeometry.ts`). L'anticrénelage des chemins vient du MSAA 4× des cibles
 * de scène (voir `TargetTexture`), celui des cercles du fragment.
 */
class WebGLSpriteHandle implements SpriteHandle {
  constructor(
    readonly size: number,
    readonly texture: WebGLTexture,
  ) {}
}

type Canvas2DLike = HTMLCanvasElement | OffscreenCanvas;
type Context2DLike = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface ProgramInfo {
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<string, WebGLUniformLocation | null>>;
}

interface TargetTexture {
  texture: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
  /**
   * Anticrénelage : les cibles où les PRIMITIVES dessinent (scène, calque)
   * portent un renderbuffer multi-échantillonné ; les dessins y vont, et la
   * texture n'est mise à jour (blit de résolution) qu'à la demande, quand un
   * passage doit l'ÉCHANTILLONNER. Sans lui, les bords durs des traits et
   * polygones faisaient dériver la couverture mesurée de ±30-37 % sur
   * `spectrum-pro`/`iso-pulse` (sonde du lot 1) — hors du ±25 % d'ADR-013.
   */
  msaaFbo: WebGLFramebuffer | null;
  msaaRbo: WebGLRenderbuffer | null;
  /** La texture est-elle en retard sur le renderbuffer MSAA ? */
  dirty: boolean;
}

export class WebGL2Renderer implements Renderer {
  /** Contexte 2D du canvas d'affichage — ne reçoit QUE le blit final de `endFrame()`. */
  private readonly displayCtx: Context2DLike;
  private readonly glCanvas: OffscreenCanvas;
  private readonly gl: WebGL2RenderingContext;

  private readonly progPrim: ProgramInfo;
  private readonly progCircle: ProgramInfo;
  private readonly progGradient: ProgramInfo;
  private readonly progSprite: ProgramInfo;
  private readonly progBlit: ProgramInfo;
  private readonly progLayerComposite: ProgramInfo;
  private readonly progBloomExtract: ProgramInfo;
  private readonly progBlur: ProgramInfo;

  private readonly vaoQuad: WebGLVertexArrayObject;
  private readonly vaoPath: WebGLVertexArrayObject;
  private readonly vaoSprite: WebGLVertexArrayObject;
  private readonly pathVbo: WebGLBuffer;
  private readonly pathIbo: WebGLBuffer;
  private readonly instanceVbo: WebGLBuffer;

  /** Deux textures de scène en ping-pong — la composition overlay/difference lit l'une et écrit l'autre. */
  private scene: [TargetTexture | null, TargetTexture | null] = [null, null];
  private sceneIdx = 0;
  private layer: TargetTexture | null = null;
  private layerActive = false;
  private layerMode: 'overlay' | 'difference' = 'overlay';
  private feedback: TargetTexture | null = null;
  private feedbackValid = false;
  private bloomExtract: TargetTexture | null = null;
  private bloomBlur: TargetTexture | null = null;
  private aberrationScratch: TargetTexture | null = null;

  /** Matrice affine 2D en espace pixel, colonne-major pour mat3 (voir `applyShake`/`applyCamera`). */
  private readonly transform = new Float32Array(9);
  private readonly quadScratch = new Float32Array(8);

  private blend: BlendMode | null = null;
  private internalResolutionScale = 1;
  private bloomConfig: BloomConfig = { enabled: false, resolutionScale: 1, passes: 0 };
  private chromaticAberrationEnabled = false;

  /** Dimensions INTERNES de la frame en cours (résolution interne appliquée). */
  private internalWidth = 0;
  private internalHeight = 0;
  private minSide = 0;
  private halfWidth = 0;
  private halfHeight = 0;

  /** Vrai dès que le contexte GL est perdu — lu par `ui/` pour basculer sur `Canvas2DRenderer` à la frame suivante. */
  private lost = false;

  // Tampons de travail pré-alloués, agrandis à la demande (docs/10 : pas
  // d'allocation par image en régime établi).
  private pathPx = new Float32Array(1024);
  private strokeXs = new Float32Array(512);
  private strokeYs = new Float32Array(512);
  private stripPx = new Float32Array(4096);
  private indexScratch = new Uint16Array(1024);
  private instanceData = new Float32Array(4096);

  constructor(private readonly canvas: Canvas2DLike) {
    // Même remarque que Canvas2DRenderer : l'union perd la surcharge précise.
    const displayCtx = canvas.getContext('2d') as Context2DLike | null;
    if (!displayCtx) {
      throw new Error("WebGL2Renderer: contexte 2D du canvas d'affichage indisponible");
    }
    this.displayCtx = displayCtx;

    this.glCanvas = new OffscreenCanvas(Math.max(1, canvas.width), Math.max(1, canvas.height));
    const gl = this.glCanvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      throw new Error('WebGL2Renderer: contexte WebGL2 indisponible');
    }
    this.gl = gl;

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);

    this.progPrim = this.createProgram(PRIM_VS, PRIM_FS, ['uTransform', 'uTargetSize', 'uColor']);
    this.progCircle = this.createProgram(CIRCLE_VS, CIRCLE_FS, ['uTransform', 'uTargetSize', 'uCenter', 'uExtent', 'uColor', 'uRadius', 'uHalfWidth']);
    this.progGradient = this.createProgram(GRADIENT_VS, GRADIENT_FS, ['uTransform', 'uTargetSize', 'uCenter', 'uR0', 'uR1', 'uInner', 'uOuter']);
    this.progSprite = this.createProgram(SPRITE_VS, SPRITE_FS, ['uTransform', 'uTargetSize', 'uTex']);
    this.progBlit = this.createProgram(BLIT_VS, BLIT_FS, ['uDstRect', 'uTargetSize', 'uYSign', 'uTex', 'uTint', 'uAlpha']);
    this.progLayerComposite = this.createProgram(LAYER_COMPOSITE_VS, LAYER_COMPOSITE_FS, ['uDstRect', 'uTargetSize', 'uYSign', 'uDst', 'uSrc', 'uMode']);
    this.progBloomExtract = this.createProgram(BLIT_VS, BLOOM_EXTRACT_FS, ['uDstRect', 'uTargetSize', 'uYSign', 'uTex', 'uThreshold']);
    this.progBlur = this.createProgram(BLIT_VS, BLUR_FS, ['uDstRect', 'uTargetSize', 'uYSign', 'uTex', 'uDir', 'uTexSize', 'uSigma', 'uStepPx']);

    // Quad partagé (coin [0,1]²) — cercles, blits, passes plein cadre, sprites.
    const cornerVbo = gl.createBuffer();
    if (!cornerVbo) throw new Error('WebGL2Renderer: création de buffer échouée');
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    this.vaoQuad = gl.createVertexArray()!;
    gl.bindVertexArray(this.vaoQuad);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Géométrie dynamique (traits, polygones, quads pleins) — attribut 0 = aPos.
    // L'ELEMENT_ARRAY_BUFFER fait partie de l'état du VAO : lié ici une fois,
    // `fillPath` n'a plus qu'à y verser ses indices de triangulation.
    this.pathVbo = gl.createBuffer()!;
    this.pathIbo = gl.createBuffer()!;
    this.vaoPath = gl.createVertexArray()!;
    gl.bindVertexArray(this.vaoPath);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.pathIbo);

    // Sprites instanciés : coin partagé + tampon d'instances (x, y, taille, alpha).
    this.instanceVbo = gl.createBuffer()!;
    this.vaoSprite = gl.createVertexArray()!;
    gl.bindVertexArray(this.vaoSprite);
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);
  }

  /** Lu par `ui/App.ts` à chaque frame : vrai => repli `Canvas2DRenderer` (ADR-013, « repli automatique et silencieux »). */
  get contextLost(): boolean {
    return this.lost;
  }

  // -------------------------------------------------------------------------
  // Cycle de frame
  // -------------------------------------------------------------------------

  beginFrame(_viewport: Viewport): void {
    const gl = this.gl;
    const w = Math.max(1, this.canvas.width);
    const h = Math.max(1, this.canvas.height);
    if (this.glCanvas.width !== w || this.glCanvas.height !== h) {
      this.glCanvas.width = w;
      this.glCanvas.height = h;
    }

    const { width: iw, height: ih } = computeSmallDimensions(w, h, this.internalResolutionScale);
    if (this.internalWidth !== iw || this.internalHeight !== ih) {
      this.internalWidth = iw;
      this.internalHeight = ih;
      this.scene = [this.reallocTarget(this.scene[0], iw, ih, true), this.reallocTarget(this.scene[1], iw, ih, true)];
      this.sceneIdx = 0;
      // Mêmes gardes de dimensions que Canvas2DRenderer : les buffers annexes
      // sont recréés à leur prochain usage, le feedback repart de zéro.
      this.layer = this.dropTarget(this.layer);
      this.feedback = this.dropTarget(this.feedback);
      this.feedbackValid = false;
      this.aberrationScratch = this.dropTarget(this.aberrationScratch);
    }

    this.minSide = Math.min(iw, ih);
    this.halfWidth = iw / 2;
    this.halfHeight = ih / 2;

    // Identité — l'équivalent du save() unique par image de Canvas2DRenderer.
    const m = this.transform;
    m[0] = 1; m[1] = 0; m[2] = 0;
    m[3] = 0; m[4] = 1; m[5] = 0;
    m[6] = 0; m[7] = 0; m[8] = 1;

    this.layerActive = false;
    // Le mode de fusion ne survit pas à une image (même règle que Canvas2DRenderer).
    this.setBlendMode(null);

    // Comme Canvas 2D, la cible n'est PAS effacée ici : le contenu de la frame
    // précédente persiste jusqu'au clear() du style.
    const target = this.scene[this.sceneIdx];
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.drawFboOf(target));
      gl.viewport(0, 0, iw, ih);
    }
  }

  endFrame(): void {
    const gl = this.gl;
    this.flushLayer();
    if (this.bloomConfig.enabled) this.applyBloom();
    if (this.chromaticAberrationEnabled) this.applyChromaticAberration();

    // Présentation : scène -> framebuffer par défaut du canvas GL (agrandissement
    // bilinéaire si résolution interne < 1, comme le drawImage final de Canvas2D),
    // y inversé une seule fois ici (voir shaders.ts).
    const w = this.glCanvas.width;
    const h = this.glCanvas.height;
    this.resolveTarget(this.scene[this.sceneIdx]!);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    this.drawBlit(this.scene[this.sceneIdx]!.texture, 0, 0, w, h, w, h, -1, 1, 1, 1, 1);
    gl.enable(gl.BLEND);

    if (gl.isContextLost()) {
      // Ne pas blitter un canvas GL perdu : le canvas d'affichage garde la
      // dernière image valide (« sans écran noir »), ui/ bascule à la frame
      // suivante en lisant `contextLost`.
      this.lost = true;
      return;
    }

    // Blit final vers le canvas d'affichage 2D — même tâche que le rendu,
    // donc le drawing buffer GL est encore garanti présent. 'copy' remplace
    // tout (alpha compris), l'équivalent du dessin direct de Canvas2D.
    const prevComposite = this.displayCtx.globalCompositeOperation;
    this.displayCtx.globalCompositeOperation = 'copy';
    this.displayCtx.drawImage(this.glCanvas, 0, 0);
    this.displayCtx.globalCompositeOperation = prevComposite;
  }

  // -------------------------------------------------------------------------
  // État : fusion, post, transformations
  // -------------------------------------------------------------------------

  setBlendMode(mode: BlendMode | null): void {
    if (this.layerActive && mode !== this.blend) this.flushLayer();
    this.blend = mode;
    if (mode === 'overlay' || mode === 'difference') this.beginLayer(mode);
  }

  setBloomConfig(config: BloomConfig): void {
    this.bloomConfig = config;
  }

  setChromaticAberration(enabled: boolean): void {
    this.chromaticAberrationEnabled = enabled;
  }

  setInternalResolutionScale(scale: number): void {
    this.internalResolutionScale = scale;
  }

  applyShake(dx: number, dy: number): void {
    this.translate(dx * this.minSide, -dy * this.minSide);
  }

  applyCamera(dx: number, dy: number, zoom: number): void {
    this.translate(dx * this.minSide, -dy * this.minSide);
    const z = zoom < MIN_CAMERA_ZOOM ? MIN_CAMERA_ZOOM : zoom > MAX_CAMERA_ZOOM ? MAX_CAMERA_ZOOM : zoom;
    if (z === 1) return;
    // Échelle centrée sur l'origine du repère normalisé (le centre du bitmap),
    // même composition que Canvas2DRenderer.applyCamera.
    this.translate(this.halfWidth, this.halfHeight);
    this.scaleTransform(z);
    this.translate(-this.halfWidth, -this.halfHeight);
  }

  /** Post-multiplication par une translation — la sémantique de `ctx.translate`. */
  private translate(tx: number, ty: number): void {
    const m = this.transform;
    m[6] = m[0]! * tx + m[3]! * ty + m[6]!;
    m[7] = m[1]! * tx + m[4]! * ty + m[7]!;
  }

  /** Post-multiplication par une échelle uniforme — la sémantique de `ctx.scale`. */
  private scaleTransform(s: number): void {
    const m = this.transform;
    m[0] = m[0]! * s;
    m[1] = m[1]! * s;
    m[3] = m[3]! * s;
    m[4] = m[4]! * s;
  }

  // -------------------------------------------------------------------------
  // Primitives
  // -------------------------------------------------------------------------

  clear(color: Color): void {
    // fillRect(0,0,w,h) de Canvas2D : un quad plein cadre à travers la
    // transformation et le mode de fusion courants — pas un gl.clear, qui
    // ignorerait les deux.
    const gl = this.gl;
    this.bindDrawTarget();
    this.applyPrimBlend('normal');
    gl.useProgram(this.progPrim.program);
    this.setCommonUniforms(this.progPrim);
    this.setPremultipliedColor(this.progPrim, color);
    this.uploadPathQuad(0, 0, this.internalWidth, this.internalHeight);
    gl.bindVertexArray(this.vaoPath);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  fillCircle(x: number, y: number, radius: number, color: Color): void {
    this.drawCircle(x, y, radius, 0, color);
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, color: Color): void {
    this.drawCircle(x, y, radius, Math.max(lineWidth * this.minSide, 0) / 2, color);
  }

  private drawCircle(x: number, y: number, radius: number, halfWidthPx: number, color: Color): void {
    const gl = this.gl;
    const px = this.halfWidth + x * this.minSide;
    const py = this.halfHeight - y * this.minSide;
    const pr = radius * this.minSide;

    this.bindDrawTarget();
    this.applyPrimBlend('normal');
    gl.useProgram(this.progCircle.program);
    this.setCommonUniforms(this.progCircle);
    gl.uniform2f(this.u(this.progCircle, 'uCenter'), px, py);
    gl.uniform1f(this.u(this.progCircle, 'uExtent'), pr + halfWidthPx + 1);
    gl.uniform1f(this.u(this.progCircle, 'uRadius'), pr);
    gl.uniform1f(this.u(this.progCircle, 'uHalfWidth'), halfWidthPx);
    this.setPremultipliedColor(this.progCircle, color);
    gl.bindVertexArray(this.vaoQuad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  strokePath(xs: Float32Array, ys: Float32Array, count: number, lineWidth: number, color: Color, closed: boolean): void {
    if (count < 2) return;
    const gl = this.gl;
    if (this.strokeXs.length < count) {
      this.strokeXs = new Float32Array(count * 2);
      this.strokeYs = new Float32Array(count * 2);
    }
    for (let i = 0; i < count; i++) {
      this.strokeXs[i] = this.halfWidth + xs[i]! * this.minSide;
      this.strokeYs[i] = this.halfHeight - ys[i]! * this.minSide;
    }
    const capacity = strokeStripCapacity(count);
    if (this.stripPx.length < capacity) this.stripPx = new Float32Array(capacity * 2);
    const vertices = buildStrokeStrip(this.strokeXs, this.strokeYs, count, Math.max(lineWidth * this.minSide, 0) / 2, closed, this.stripPx);
    if (vertices < 3) return;

    this.bindDrawTarget();
    this.applyPrimBlend('normal');
    gl.useProgram(this.progPrim.program);
    this.setCommonUniforms(this.progPrim);
    this.setPremultipliedColor(this.progPrim, color);
    gl.bindVertexArray(this.vaoPath);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.stripPx.subarray(0, vertices * 2), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertices);
  }

  fillPath(xs: Float32Array, ys: Float32Array, count: number, color: Color): void {
    if (count < 3) return;
    const gl = this.gl;
    if (this.pathPx.length < count * 2) this.pathPx = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      this.pathPx[i * 2] = this.halfWidth + xs[i]! * this.minSide;
      this.pathPx[i * 2 + 1] = this.halfHeight - ys[i]! * this.minSide;
    }

    // Découpe d'oreilles, PAS un éventail : la vérification demandée par
    // l'ADR-013 (« trianguler simple, vérifier sur les 8 styles ») a montré
    // que les rubans d'`aurore` sont concaves — l'éventail remplissait le
    // creux de l'onde (luminance ×3 à la sonde). Voir fillGeometry.ts.
    const capacity = triangleIndexCapacity(count);
    if (this.indexScratch.length < capacity) this.indexScratch = new Uint16Array(capacity * 2);
    const indexCount = triangulatePolygon(this.pathPx, count, this.indexScratch);
    if (indexCount === 0) return;

    this.bindDrawTarget();
    this.applyPrimBlend('normal');
    gl.useProgram(this.progPrim.program);
    this.setCommonUniforms(this.progPrim);
    this.setPremultipliedColor(this.progPrim, color);
    gl.bindVertexArray(this.vaoPath);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.pathPx.subarray(0, count * 2), gl.DYNAMIC_DRAW);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indexScratch.subarray(0, indexCount), gl.DYNAMIC_DRAW);
    gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
  }

  fillRadialGradient(innerRadius: number, outerRadius: number, inner: Color, outer: Color): void {
    const gl = this.gl;
    this.bindDrawTarget();
    this.applyPrimBlend('normal');
    gl.useProgram(this.progGradient.program);
    this.setCommonUniforms(this.progGradient);
    gl.uniform2f(this.u(this.progGradient, 'uCenter'), this.halfWidth, this.halfHeight);
    gl.uniform1f(this.u(this.progGradient, 'uR0'), innerRadius * this.minSide);
    gl.uniform1f(this.u(this.progGradient, 'uR1'), outerRadius * this.minSide);
    gl.uniform4f(this.u(this.progGradient, 'uInner'), inner.r / 255, inner.g / 255, inner.b / 255, inner.a);
    gl.uniform4f(this.u(this.progGradient, 'uOuter'), outer.r / 255, outer.g / 255, outer.b / 255, outer.a);
    this.uploadPathQuad(0, 0, this.internalWidth, this.internalHeight);
    gl.bindVertexArray(this.vaoPath);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // -------------------------------------------------------------------------
  // Sprites
  // -------------------------------------------------------------------------

  createSprite(draw: (ctx: OffscreenCanvasRenderingContext2D) => void, size: number): SpriteHandle {
    // Rasterisation STRICTEMENT identique à Canvas2DRenderer (ADR-013 :
    // « mêmes pixels source ») — seule la destination change (texture GL).
    const offscreen = new OffscreenCanvas(size, size);
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) throw new Error('WebGL2Renderer.createSprite: contexte 2D hors écran indisponible');
    draw(offCtx);

    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('WebGL2Renderer.createSprite: création de texture échouée');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return new WebGLSpriteHandle(size, texture);
  }

  drawSprite(sprite: SpriteHandle, transforms: readonly SpriteTransform[], count: number): void {
    if (!(sprite instanceof WebGLSpriteHandle)) {
      throw new Error('WebGL2Renderer.drawSprite: SpriteHandle étranger à ce Renderer');
    }
    if (count <= 0) return;
    const gl = this.gl;

    if (this.instanceData.length < count * 4) {
      this.instanceData = new Float32Array(count * 8);
    }
    for (let i = 0; i < count; i++) {
      const t = transforms[i]!;
      this.instanceData[i * 4] = this.halfWidth + t.x * this.minSide;
      this.instanceData[i * 4 + 1] = this.halfHeight - t.y * this.minSide;
      // `t.scale` : taille de rendu normalisée (diamètre) — même convention
      // que Canvas2DRenderer.drawSprite.
      this.instanceData[i * 4 + 2] = t.scale * this.minSide;
      this.instanceData[i * 4 + 3] = t.alpha;
    }

    this.bindDrawTarget();
    // Un sprite est additif par nature (c'est ce qui remplace shadowBlur) ;
    // une couche qui déclare un blend l'emporte — même règle que Canvas2D.
    this.applyPrimBlend('additive');
    gl.useProgram(this.progSprite.program);
    this.setCommonUniforms(this.progSprite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sprite.texture);
    gl.uniform1i(this.u(this.progSprite, 'uTex'), 0);
    gl.bindVertexArray(this.vaoSprite);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.subarray(0, count * 4), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  // -------------------------------------------------------------------------
  // Feedback (textures copiées, ADR-011 : espace écran)
  // -------------------------------------------------------------------------

  drawFeedback(scale: number, alpha: number): void {
    if (!this.feedbackValid || !this.feedback) return; // rien capturé encore
    const w = this.internalWidth;
    const h = this.internalHeight;
    const scaledW = w * scale;
    const scaledH = h * scale;
    this.bindDrawTarget();
    this.applyPrimBlend('normal');
    // Espace ÉCRAN, transformation de frame ignorée (ADR-011) : le blit ne
    // passe pas par uTransform, c'est structurel — rien à neutraliser.
    this.drawBlit(this.feedback.texture, (w - scaledW) / 2, (h - scaledH) / 2, scaledW, scaledH, w, h, 1, 1, 1, 1, alpha);
  }

  captureFeedback(): void {
    const gl = this.gl;
    this.flushLayer();
    const w = this.internalWidth;
    const h = this.internalHeight;
    if (!this.feedback || this.feedback.width !== w || this.feedback.height !== h) {
      this.feedback = this.reallocTarget(this.feedback, w, h);
      this.feedbackValid = false;
    }
    this.resolveTarget(this.scene[this.sceneIdx]!);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.scene[this.sceneIdx]!.fbo);
    gl.bindTexture(gl.TEXTURE_2D, this.feedback.texture);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    this.feedbackValid = true;
  }

  // -------------------------------------------------------------------------
  // Calque intermédiaire overlay/difference (ADR-013)
  // -------------------------------------------------------------------------

  private beginLayer(mode: 'overlay' | 'difference'): void {
    const gl = this.gl;
    const w = this.internalWidth;
    const h = this.internalHeight;
    if (w === 0 || h === 0) return; // avant la première frame, rien à préparer
    if (!this.layer || this.layer.width !== w || this.layer.height !== h) {
      this.layer = this.reallocTarget(this.layer, w, h, true);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.drawFboOf(this.layer));
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.layerActive = true;
    this.layerMode = mode;
  }

  /** Compose le calque en attente sur la scène (ping-pong) — sans effet si aucun. */
  private flushLayer(): void {
    if (!this.layerActive) return;
    const gl = this.gl;
    const w = this.internalWidth;
    const h = this.internalHeight;
    const dstIdx = this.sceneIdx === 0 ? 1 : 0;
    this.layerActive = false;

    // Les DEUX sources vont être échantillonnées : textures à jour d'abord.
    this.resolveTarget(this.scene[this.sceneIdx]!);
    this.resolveTarget(this.layer!);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.drawFboOf(this.scene[dstIdx]!));
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(this.progLayerComposite.program);
    gl.uniform4f(this.u(this.progLayerComposite, 'uDstRect'), 0, 0, w, h);
    gl.uniform2f(this.u(this.progLayerComposite, 'uTargetSize'), w, h);
    gl.uniform1f(this.u(this.progLayerComposite, 'uYSign'), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene[this.sceneIdx]!.texture);
    gl.uniform1i(this.u(this.progLayerComposite, 'uDst'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.layer!.texture);
    gl.uniform1i(this.u(this.progLayerComposite, 'uSrc'), 1);
    gl.uniform1i(this.u(this.progLayerComposite, 'uMode'), this.layerMode === 'overlay' ? 0 : 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.vaoQuad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
    this.sceneIdx = dstIdx;
  }

  // -------------------------------------------------------------------------
  // Post SDR — mêmes réglages observables que Canvas2DRenderer
  // -------------------------------------------------------------------------

  private applyBloom(): void {
    const gl = this.gl;
    const { width: smallW, height: smallH } = computeSmallDimensions(this.internalWidth, this.internalHeight, this.bloomConfig.resolutionScale);
    if (!this.bloomExtract || this.bloomExtract.width !== smallW || this.bloomExtract.height !== smallH) {
      this.bloomExtract = this.reallocTarget(this.bloomExtract, smallW, smallH);
      this.bloomBlur = this.reallocTarget(this.bloomBlur, smallW, smallH);
    }

    // 1+2. Sous-échantillonnage (échantillonnage linéaire du plein cadre) et
    //      extraction des hautes lumières en un seul passage.
    this.resolveTarget(this.scene[this.sceneIdx]!);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bloomExtract.fbo);
    gl.viewport(0, 0, smallW, smallH);
    gl.useProgram(this.progBloomExtract.program);
    gl.uniform4f(this.u(this.progBloomExtract, 'uDstRect'), 0, 0, smallW, smallH);
    gl.uniform2f(this.u(this.progBloomExtract, 'uTargetSize'), smallW, smallH);
    gl.uniform1f(this.u(this.progBloomExtract, 'uYSign'), 1);
    gl.uniform1f(this.u(this.progBloomExtract, 'uThreshold'), HIGHLIGHT_THRESHOLD / 255);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene[this.sceneIdx]!.texture);
    gl.uniform1i(this.u(this.progBloomExtract, 'uTex'), 0);
    gl.bindVertexArray(this.vaoQuad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 3. Flou gaussien séparable — σ = rayon/2 (correspondance filter:blur).
    const radiusPx = computeBlurRadiusPx(smallW, smallH, this.bloomConfig.passes);
    let blurred = this.bloomExtract;
    if (radiusPx > 0 && this.bloomBlur) {
      const sigma = radiusPx / 2;
      const stepPx = Math.max(1, radiusPx / BLUR_MAX_TAPS);
      this.blurPass(this.bloomExtract, this.bloomBlur, 1, 0, sigma, stepPx);
      this.blurPass(this.bloomBlur, this.bloomExtract, 0, 1, sigma, stepPx);
      blurred = this.bloomExtract;
    }
    gl.enable(gl.BLEND);

    // 4. Composition additive par-dessus la scène, remise à l'échelle réelle.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.drawFboOf(this.scene[this.sceneIdx]!));
    gl.viewport(0, 0, this.internalWidth, this.internalHeight);
    this.applyFixedBlend('additive');
    this.drawBlit(blurred.texture, 0, 0, this.internalWidth, this.internalHeight, this.internalWidth, this.internalHeight, 1, 1, 1, 1, BLOOM_COMPOSITE_ALPHA);
  }

  private blurPass(src: TargetTexture, dst: TargetTexture, dirX: number, dirY: number, sigma: number, stepPx: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.width, dst.height);
    gl.useProgram(this.progBlur.program);
    gl.uniform4f(this.u(this.progBlur, 'uDstRect'), 0, 0, dst.width, dst.height);
    gl.uniform2f(this.u(this.progBlur, 'uTargetSize'), dst.width, dst.height);
    gl.uniform1f(this.u(this.progBlur, 'uYSign'), 1);
    gl.uniform2f(this.u(this.progBlur, 'uDir'), dirX, dirY);
    gl.uniform2f(this.u(this.progBlur, 'uTexSize'), src.width, src.height);
    gl.uniform1f(this.u(this.progBlur, 'uSigma'), sigma);
    gl.uniform1f(this.u(this.progBlur, 'uStepPx'), stepPx);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.texture);
    gl.uniform1i(this.u(this.progBlur, 'uTex'), 0);
    gl.bindVertexArray(this.vaoQuad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private applyChromaticAberration(): void {
    const gl = this.gl;
    const w = this.internalWidth;
    const h = this.internalHeight;
    if (!this.aberrationScratch || this.aberrationScratch.width !== w || this.aberrationScratch.height !== h) {
      this.aberrationScratch = this.reallocTarget(this.aberrationScratch, w, h);
    }
    // Capture de la scène (bloom inclus) — base commune aux deux passes
    // teintées ; lire et écrire la même texture serait indéfini.
    this.resolveTarget(this.scene[this.sceneIdx]!);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.scene[this.sceneIdx]!.fbo);
    gl.bindTexture(gl.TEXTURE_2D, this.aberrationScratch.texture);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.drawFboOf(this.scene[this.sceneIdx]!));
    gl.viewport(0, 0, w, h);
    this.applyFixedBlend('additive');
    const offsetPx = computeAberrationOffsetPx(w, h);
    // La teinte multiplicative isole le canal (0×x = 0), même principe que
    // l'aplat 'multiply' de Canvas2D ; rouge décalé à gauche, bleu à droite.
    this.drawBlit(this.aberrationScratch.texture, -offsetPx, 0, w, h, w, h, 1, 1, 0, 0, ABERRATION_TINT_ALPHA);
    this.drawBlit(this.aberrationScratch.texture, offsetPx, 0, w, h, w, h, 1, 0, 0, 1, ABERRATION_TINT_ALPHA);
  }

  // -------------------------------------------------------------------------
  // Aides internes
  // -------------------------------------------------------------------------

  private u(prog: ProgramInfo, name: string): WebGLUniformLocation | null {
    return prog.uniforms[name] ?? null;
  }

  /** Cible de dessin courante : le calque overlay/difference s'il est ouvert, sinon la scène. */
  private bindDrawTarget(): void {
    const gl = this.gl;
    const target = this.layerActive ? this.layer : this.scene[this.sceneIdx];
    if (!target) return; // beginFrame pas encore passé (défensif)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.drawFboOf(target));
    gl.viewport(0, 0, this.internalWidth, this.internalHeight);
  }

  /**
   * Fusion effective d'une primitive : son défaut si aucune couche n'a posé
   * de mode, sinon le mode posé — sauf `overlay`/`difference`, où le dessin
   * va au CALQUE en `normal` (la composition différée fait le mode).
   */
  private applyPrimBlend(defaultMode: 'normal' | 'additive'): void {
    const mode = this.blend ?? defaultMode;
    this.applyFixedBlend(mode === 'overlay' || mode === 'difference' ? 'normal' : mode);
  }

  /** Équations de fusion en fonction fixe, couleurs prémultipliées. */
  private applyFixedBlend(mode: 'normal' | 'additive' | 'screen' | 'multiply'): void {
    const gl = this.gl;
    switch (mode) {
      case 'normal':
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case 'additive':
        // 'lighter' additionne couleur ET alpha.
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE);
        break;
      case 'screen':
        // screen = s + d·(1−s) : exprimable en fixe sur couleurs prémultipliées.
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
      case 'multiply':
        // s·d + d·(1−as) : produit + laissée du fond hors couverture source.
        gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        break;
    }
  }

  private setCommonUniforms(prog: ProgramInfo): void {
    const gl = this.gl;
    gl.uniformMatrix3fv(this.u(prog, 'uTransform'), false, this.transform);
    gl.uniform2f(this.u(prog, 'uTargetSize'), this.internalWidth, this.internalHeight);
  }

  private setPremultipliedColor(prog: ProgramInfo, color: Color): void {
    const a = color.a;
    this.gl.uniform4f(this.u(prog, 'uColor'), (color.r / 255) * a, (color.g / 255) * a, (color.b / 255) * a, a);
  }

  /** Blit générique (programme blit) : `tex` vers le rectangle (x, y, w, h) de la cible LIÉE, teinte et alpha donnés. */
  private drawBlit(
    tex: WebGLTexture,
    x: number,
    y: number,
    w: number,
    h: number,
    targetW: number,
    targetH: number,
    ySign: number,
    tintR: number,
    tintG: number,
    tintB: number,
    alpha: number,
  ): void {
    const gl = this.gl;
    const prog = this.progBlit;
    gl.useProgram(prog.program);
    gl.uniform4f(this.u(prog, 'uDstRect'), x, y, w, h);
    gl.uniform2f(this.u(prog, 'uTargetSize'), targetW, targetH);
    gl.uniform1f(this.u(prog, 'uYSign'), ySign);
    gl.uniform4f(this.u(prog, 'uTint'), tintR, tintG, tintB, 1);
    gl.uniform1f(this.u(prog, 'uAlpha'), alpha);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.u(prog, 'uTex'), 0);
    gl.bindVertexArray(this.vaoQuad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private uploadPathQuad(x: number, y: number, w: number, h: number): void {
    const gl = this.gl;
    const q = this.quadScratch;
    q[0] = x; q[1] = y;
    q[2] = x + w; q[3] = y;
    q[4] = x; q[5] = y + h;
    q[6] = x + w; q[7] = y + h;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathVbo);
    gl.bufferData(gl.ARRAY_BUFFER, q, gl.DYNAMIC_DRAW);
  }

  private reallocTarget(target: TargetTexture | null, width: number, height: number, withMsaa = false): TargetTexture {
    const gl = this.gl;
    this.dropTarget(target);
    const texture = gl.createTexture();
    const fbo = gl.createFramebuffer();
    if (!texture || !fbo) throw new Error('WebGL2Renderer: allocation de cible de rendu échouée');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // Zéro-initialisée par spécification WebGL — un feedback fraîchement
    // (re)créé est transparent, comme l'OffscreenCanvas neuf de Canvas2D.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    let msaaFbo: WebGLFramebuffer | null = null;
    let msaaRbo: WebGLRenderbuffer | null = null;
    if (withMsaa) {
      const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
      if (samples > 1) {
        msaaRbo = gl.createRenderbuffer();
        msaaFbo = gl.createFramebuffer();
        if (msaaRbo && msaaFbo) {
          gl.bindRenderbuffer(gl.RENDERBUFFER, msaaRbo);
          gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, width, height);
          gl.bindFramebuffer(gl.FRAMEBUFFER, msaaFbo);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, msaaRbo);
        }
      }
    }
    return { texture, fbo, width, height, msaaFbo, msaaRbo, dirty: false };
  }

  private dropTarget(target: TargetTexture | null): null {
    if (target) {
      this.gl.deleteTexture(target.texture);
      this.gl.deleteFramebuffer(target.fbo);
      if (target.msaaFbo) this.gl.deleteFramebuffer(target.msaaFbo);
      if (target.msaaRbo) this.gl.deleteRenderbuffer(target.msaaRbo);
    }
    return null;
  }

  /** FBO où DESSINER dans cette cible (le MSAA s'il existe). */
  private drawFboOf(target: TargetTexture): WebGLFramebuffer {
    if (target.msaaFbo) {
      target.dirty = true;
      return target.msaaFbo;
    }
    return target.fbo;
  }

  /** Met la TEXTURE de la cible à jour depuis son renderbuffer MSAA, si nécessaire. */
  private resolveTarget(target: TargetTexture): void {
    if (!target.msaaFbo || !target.dirty) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.msaaFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.fbo);
    gl.blitFramebuffer(0, 0, target.width, target.height, 0, 0, target.width, target.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    target.dirty = false;
  }

  private createProgram(vsSource: string, fsSource: string, uniformNames: readonly string[]): ProgramInfo {
    const gl = this.gl;
    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('WebGL2Renderer: création de shader échouée');
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(`WebGL2Renderer: compilation de shader échouée — ${gl.getShaderInfoLog(shader) ?? 'sans détail'}`);
      }
      return shader;
    };
    const program = gl.createProgram();
    if (!program) throw new Error('WebGL2Renderer: création de programme échouée');
    const vs = compile(gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl.FRAGMENT_SHADER, fsSource);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    // Emplacements d'attributs FIXÉS avant l'édition de liens : 0 = position
    // ou coin, 1 = instance — tous les VAOs partagent cette convention.
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.bindAttribLocation(program, 0, 'aCorner');
    gl.bindAttribLocation(program, 1, 'aInstance');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`WebGL2Renderer: édition de liens échouée — ${gl.getProgramInfoLog(program) ?? 'sans détail'}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniformNames) {
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    return { program, uniforms };
  }
}
