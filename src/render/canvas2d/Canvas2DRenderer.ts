import type { BlendMode, BloomConfig, Color, Renderer, SpriteHandle, SpriteTransform } from '../Renderer';
import type { Viewport } from '../Viewport';
import { BLOOM_COMPOSITE_ALPHA, computeBlurRadiusPx, computeSmallDimensions, extractHighlights } from './bloomMath';
import { ABERRATION_TINT_ALPHA, computeAberrationOffsetPx } from './chromaticMath';

/**
 * Bornes du zoom de caméra (ADR-011). La borne BASSE est la contrainte réelle :
 * sous 1, le cadrage s'élargit et découvre les bords, or les fonds plein écran
 * ont un rayon de 1,0 à 1,1 en unités normalisées et cesseraient de couvrir le
 * cadre. « Plan large » vaut donc 1, jamais moins.
 */
export const MIN_CAMERA_ZOOM = 1;
export const MAX_CAMERA_ZOOM = 2;

/** Traduction des modes de §7.2 en opérations Canvas. */
const BLEND_TO_COMPOSITE: Readonly<Record<BlendMode, GlobalCompositeOperation>> = {
  normal: 'source-over',
  additive: 'lighter',
  screen: 'screen',
  multiply: 'multiply',
  overlay: 'overlay',
  difference: 'difference',
};

/**
 * Backend Canvas 2D de `Renderer`. Convertit l'espace normalisé (Loi 4) en
 * pixels à partir des dimensions RÉELLES de la cible ACTIVE de la frame
 * (`activeCanvas.width`/`height`, voir `beginFrame()`), pas de
 * `viewport.aspect` — le viewport ne porte pas de pixels, voir
 * docs/02_ARCHITECTURE.md §Renderer.
 *
 * Limite connue (P2, toujours vraie en P7) : `fillStyle` est recalculé en
 * chaîne à chaque appel (`toCssColor`). Acceptable pour Pulse (poignée
 * d'appels/image, pas de boucle par particule) ; à revoir en P9 (`Field`,
 * 2500 particules) avec un cache de couleurs.
 *
 * Non testé automatiquement (nécessiterait un canvas mocké, comme en P2) :
 * vérifié manuellement au navigateur.
 *
 * Accepte `OffscreenCanvas` depuis l'Étape 10/P8 : `ExportPipeline` dessine
 * sur un canvas hors écran, INDÉPENDANT du canvas de preview (docs/09
 * §"Le pipeline déterministe" — étape 1, préparation).
 *
 * Résolution interne (Étape 24, docs/07 §"La résolution interne") : `canvas`
 * (le `<canvas>`/`OffscreenCanvas` RÉEL passé au constructeur, cible finale
 * d'affichage/export) et `activeCanvas` (la cible sur laquelle tout dessine
 * PENDANT la frame — `canvas` lui-même à `internalResolutionScale === 1`,
 * ou un buffer interne réduit sinon) sont deux notions distinctes depuis
 * cette étape. Toutes les méthodes de dessin (`fillCircle`, `clear`, le
 * bloom, le décalage chromatique…) ciblent `ctx`/`activeCanvas` — jamais
 * `displayCtx`/`canvas` directement, sauf l'unique agrandissement final dans
 * `endFrame()`. À `internalResolutionScale === 1` (défaut), `activeCanvas
 * === canvas` : aucun buffer supplémentaire, aucune copie de plus — chemin
 * strictement identique à avant cette étape.
 */
class CanvasSpriteHandle implements SpriteHandle {
  constructor(
    readonly size: number,
    readonly canvas: OffscreenCanvas,
  ) {}
}

type Canvas2DLike = HTMLCanvasElement | OffscreenCanvas;
type Context2DLike = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class Canvas2DRenderer implements Renderer {
  /** Contexte du `<canvas>`/`OffscreenCanvas` RÉEL (constructeur) — jamais dessiné dedans directement, sauf le blit final de `endFrame()`. */
  private readonly displayCtx: Context2DLike;
  /** Cible ACTIVE de la frame en cours — `displayCtx`/`canvas` par défaut, ou le buffer interne réduit (voir `beginFrame()`). */
  private ctx: Context2DLike;
  private activeCanvas: Canvas2DLike;
  private minSide = 0;
  private halfWidth = 0;
  private halfHeight = 0;
  /** Mode de fusion courant, posé par `Scene.draw` avant chaque couche. `null` = défaut de la primitive. */
  private blend: BlendMode | null = null;
  /** `1` par défaut — un `Canvas2DRenderer` jamais configuré via `setInternalResolutionScale` rend exactement comme avant l'Étape 24 (aucun buffer interne créé). */
  private internalResolutionScale = 1;
  private sceneBuffer: OffscreenCanvas | null = null;
  private sceneCtx: OffscreenCanvasRenderingContext2D | null = null;
  private feedbackBuffer: OffscreenCanvas | null = null;
  private feedbackCtx: OffscreenCanvasRenderingContext2D | null = null;
  /** `enabled: false` par défaut — un `Canvas2DRenderer` jamais configuré via `setBloomConfig` rend exactement comme avant l'Étape 21. */
  private bloomConfig: BloomConfig = { enabled: false, resolutionScale: 1, passes: 0 };
  private bloomExtractBuffer: OffscreenCanvas | null = null;
  private bloomExtractCtx: OffscreenCanvasRenderingContext2D | null = null;
  private bloomBlurBuffer: OffscreenCanvas | null = null;
  private bloomBlurCtx: OffscreenCanvasRenderingContext2D | null = null;
  /** `false` par défaut — un `Canvas2DRenderer` jamais configuré via `setChromaticAberration` rend exactement comme avant l'Étape 23. */
  private chromaticAberrationEnabled = false;
  private aberrationSnapshotBuffer: OffscreenCanvas | null = null;
  private aberrationSnapshotCtx: OffscreenCanvasRenderingContext2D | null = null;
  private aberrationScratchBuffer: OffscreenCanvas | null = null;
  private aberrationScratchCtx: OffscreenCanvasRenderingContext2D | null = null;

  constructor(private readonly canvas: Canvas2DLike) {
    // `getContext('2d')` sur l'union HTMLCanvasElement|OffscreenCanvas perd la
    // surcharge précise de TypeScript (retombe sur `RenderingContext`, qui
    // inclut `ImageBitmapRenderingContext`) : on sait par construction que
    // l'id `'2d'` ne peut renvoyer que l'un des deux types 2D.
    const ctx = canvas.getContext('2d') as Context2DLike | null;
    if (!ctx) {
      throw new Error('Canvas2DRenderer: contexte 2D indisponible');
    }
    this.displayCtx = ctx;
    this.ctx = ctx;
    this.activeCanvas = canvas;
  }

  /**
   * Choisit la cible ACTIVE de la frame (Étape 24) : à `internalResolutionScale === 1`,
   * `canvas` lui-même (chemin direct, identique à avant cette étape). Sinon, un buffer
   * interne réduit — recréé seulement si ses dimensions ont changé (même garde que
   * `captureFeedback`/`applyBloom`), pas alloué à chaque image.
   */
  beginFrame(_viewport: Viewport): void {
    if (this.internalResolutionScale !== 1) {
      const { width, height } = computeSmallDimensions(this.canvas.width, this.canvas.height, this.internalResolutionScale);
      if (!this.sceneBuffer || this.sceneBuffer.width !== width || this.sceneBuffer.height !== height) {
        this.sceneBuffer = new OffscreenCanvas(width, height);
        this.sceneCtx = this.sceneBuffer.getContext('2d');
      }
      this.activeCanvas = this.sceneBuffer;
      this.ctx = this.sceneCtx!;
    } else {
      this.activeCanvas = this.canvas;
      this.ctx = this.displayCtx;
    }

    this.minSide = Math.min(this.activeCanvas.width, this.activeCanvas.height);
    this.halfWidth = this.activeCanvas.width / 2;
    this.halfHeight = this.activeCanvas.height / 2;
    // Un seul save/restore PAR IMAGE (pas par primitive) : c'est ce qui rend
    // applyShake() bon marché malgré la règle "pas de save/restore en boucle
    // serrée" de docs/10_PERFORMANCE.md, qui vise les appels par particule.
    this.ctx.save();
    // Le mode de fusion ne survit PAS à une image : une couche qui en poserait
    // un puis lèverait une exception avant sa remise à zéro contaminerait
    // toutes les images suivantes.
    this.setBlendMode(null);
  }

  private toPx(x: number, y: number): [number, number] {
    return [this.halfWidth + x * this.minSide, this.halfHeight - y * this.minSide];
  }

  /**
   * Pose l'opération directement sur le contexte : les primitives de tracé
   * (`fillCircle`, `strokePath`, `fillPath`, `fillRadialGradient`) n'y touchent
   * pas et en héritent donc sans une ligne de plus. Seul `drawSprite` doit s'en
   * occuper, parce qu'il force `'lighter'`.
   *
   * `this.blend` est conservé pour ce seul usage.
   */
  setBlendMode(mode: BlendMode | null): void {
    this.blend = mode;
    this.ctx.globalCompositeOperation = mode === null ? 'source-over' : BLEND_TO_COMPOSITE[mode];
  }

  clear(color: Color): void {
    this.ctx.fillStyle = toCssColor(color);
    this.ctx.fillRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
  }

  fillCircle(x: number, y: number, radius: number, color: Color): void {
    const [px, py] = this.toPx(x, y);
    const pr = radius * this.minSide;

    this.ctx.fillStyle = toCssColor(color);
    this.ctx.beginPath();
    this.ctx.arc(px, py, pr, 0, Math.PI * 2);
    this.ctx.fill();
  }

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, color: Color): void {
    const [px, py] = this.toPx(x, y);
    this.ctx.strokeStyle = toCssColor(color);
    this.ctx.lineWidth = lineWidth * this.minSide;
    this.ctx.beginPath();
    this.ctx.arc(px, py, radius * this.minSide, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  strokePath(xs: Float32Array, ys: Float32Array, count: number, lineWidth: number, color: Color, closed: boolean): void {
    if (count < 2) return;
    this.ctx.strokeStyle = toCssColor(color);
    this.ctx.lineWidth = lineWidth * this.minSide;
    this.ctx.beginPath();
    const [x0, y0] = this.toPx(xs[0]!, ys[0]!);
    this.ctx.moveTo(x0, y0);
    for (let i = 1; i < count; i++) {
      const [px, py] = this.toPx(xs[i]!, ys[i]!);
      this.ctx.lineTo(px, py);
    }
    if (closed) this.ctx.closePath();
    this.ctx.stroke();
  }

  fillPath(xs: Float32Array, ys: Float32Array, count: number, color: Color): void {
    if (count < 3) return;
    this.ctx.fillStyle = toCssColor(color);
    this.ctx.beginPath();
    const [x0, y0] = this.toPx(xs[0]!, ys[0]!);
    this.ctx.moveTo(x0, y0);
    for (let i = 1; i < count; i++) {
      const [px, py] = this.toPx(xs[i]!, ys[i]!);
      this.ctx.lineTo(px, py);
    }
    this.ctx.closePath();
    this.ctx.fill();
  }

  fillRadialGradient(innerRadius: number, outerRadius: number, inner: Color, outer: Color): void {
    // Recréé par image : acceptable pour un fond, docs/10_PERFORMANCE.md
    // reporte explicitement sa mise en cache à la phase 12 ("fond statique
    // mis en cache"). Pas un fond figé ici : `inner`/`outer` varient avec
    // `brightness`, un cache par couleur exacte thrasherait de toute façon.
    const gradient = this.ctx.createRadialGradient(
      this.halfWidth,
      this.halfHeight,
      innerRadius * this.minSide,
      this.halfWidth,
      this.halfHeight,
      outerRadius * this.minSide,
    );
    gradient.addColorStop(0, toCssColor(inner));
    gradient.addColorStop(1, toCssColor(outer));
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.activeCanvas.width, this.activeCanvas.height);
  }

  createSprite(draw: (ctx: OffscreenCanvasRenderingContext2D) => void, size: number): SpriteHandle {
    const offscreen = new OffscreenCanvas(size, size);
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) throw new Error('Canvas2DRenderer.createSprite: contexte 2D hors écran indisponible');
    draw(offCtx);
    return new CanvasSpriteHandle(size, offscreen);
  }

  drawSprite(sprite: SpriteHandle, transforms: readonly SpriteTransform[], count: number): void {
    if (!(sprite instanceof CanvasSpriteHandle)) {
      throw new Error('Canvas2DRenderer.drawSprite: SpriteHandle étranger à ce Renderer');
    }
    const prevComposite = this.ctx.globalCompositeOperation;
    const prevAlpha = this.ctx.globalAlpha;
    // `'lighter'` reste le défaut : un sprite est additif par nature, c'est ce
    // qui remplace `shadowBlur`. Une couche qui déclare un `blend` l'emporte.
    this.ctx.globalCompositeOperation = this.blend === null ? 'lighter' : BLEND_TO_COMPOSITE[this.blend];
    for (let i = 0; i < count; i++) {
      const t = transforms[i]!;
      const [px, py] = this.toPx(t.x, t.y);
      // `t.scale` : taille de rendu en unités normalisées (diamètre), pas un
      // facteur appliqué à `sprite.size` — cohérent avec `radius` ailleurs
      // dans ce backend, toujours normalisé puis multiplié par `minSide` ici.
      const pixelSize = t.scale * this.minSide;
      this.ctx.globalAlpha = t.alpha;
      this.ctx.drawImage(sprite.canvas, px - pixelSize / 2, py - pixelSize / 2, pixelSize, pixelSize);
    }
    this.ctx.globalCompositeOperation = prevComposite;
    this.ctx.globalAlpha = prevAlpha;
  }

  applyShake(dx: number, dy: number): void {
    this.ctx.translate(dx * this.minSide, -dy * this.minSide);
  }

  /**
   * ADR-011. Même mécanisme qu'`applyShake` — une transformation posée dans le
   * `save`/`restore` de `beginFrame`/`endFrame` — plus une mise à l'échelle
   * autour de l'ORIGINE DU REPÈRE NORMALISÉ, qui est au centre du bitmap
   * (`toPx` : `halfWidth + x·minSide`). Mettre à l'échelle autour de (0,0) en
   * pixels ferait fuir l'image vers le coin haut-gauche.
   */
  applyCamera(dx: number, dy: number, zoom: number): void {
    this.ctx.translate(dx * this.minSide, -dy * this.minSide);
    const z = zoom < MIN_CAMERA_ZOOM ? MIN_CAMERA_ZOOM : zoom > MAX_CAMERA_ZOOM ? MAX_CAMERA_ZOOM : zoom;
    if (z === 1) return;
    this.ctx.translate(this.halfWidth, this.halfHeight);
    this.ctx.scale(z, z);
    this.ctx.translate(-this.halfWidth, -this.halfHeight);
  }

  /**
   * Dessiné en espace ÉCRAN, transformation courante NEUTRALISÉE (ADR-011).
   *
   * La capture contient l'image telle qu'affichée, donc déjà cadrée par la
   * caméra. La redessiner sous ce même cadrage l'agrandirait une seconde fois,
   * et le facteur croîtrait géométriquement d'une image à l'autre : un zoom
   * tenu à 1,15 pendant deux secondes dépasserait 10 000. Le `save`/`restore`
   * local est le prix — un par image, pas un par particule, donc hors du champ
   * de la règle de `docs/10` sur les `save/restore` en boucle serrée.
   */
  drawFeedback(scale: number, alpha: number): void {
    if (!this.feedbackBuffer) return; // rien capturé encore (première image, ou juste après un seek)
    const w = this.activeCanvas.width;
    const h = this.activeCanvas.height;
    const scaledW = w * scale;
    const scaledH = h * scale;
    const prevAlpha = this.ctx.globalAlpha;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(this.feedbackBuffer, (w - scaledW) / 2, (h - scaledH) / 2, scaledW, scaledH);
    this.ctx.restore();
    this.ctx.globalAlpha = prevAlpha;
  }

  /**
   * Capture la cible ACTIVE (`activeCanvas`, Étape 24) — `Scene.draw()` l'appelle AVANT
   * `endFrame()` (voir son commentaire), donc avant le bloom/décalage chromatique/upscale : la
   * traînée porte sur le composite brut des couches, jamais sur la version post-traitée.
   */
  captureFeedback(): void {
    const w = this.activeCanvas.width;
    const h = this.activeCanvas.height;
    if (!this.feedbackBuffer || this.feedbackBuffer.width !== w || this.feedbackBuffer.height !== h) {
      this.feedbackBuffer = new OffscreenCanvas(w, h);
      this.feedbackCtx = this.feedbackBuffer.getContext('2d');
    }
    // `drawImage(this.activeCanvas, ...)` fonctionne quel que soit son type concret
    // (<canvas> réel, OffscreenCanvas d'export, ou buffer de résolution interne).
    this.feedbackCtx!.clearRect(0, 0, w, h);
    this.feedbackCtx!.drawImage(this.activeCanvas, 0, 0);
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

  endFrame(): void {
    // `restore()` D'ABORD : annule le décalage de `applyShake()` avant que le bloom ne lise les
    // pixels du canvas — le bloom travaille en espace écran, pas dans l'espace transformé de la frame.
    this.ctx.restore();
    if (this.bloomConfig.enabled) this.applyBloom();
    // Après le bloom, jamais avant : la frange doit porter sur l'image DÉJÀ étendue par le halo,
    // pas l'inverse (docs/07 §"Le décalage chromatique" — ordre des post-traitements).
    if (this.chromaticAberrationEnabled) this.applyChromaticAberration();
    // Dernière étape, une seule fois : agrandissement bilinéaire natif du buffer interne réduit
    // vers le canvas RÉEL — jamais avant (le bloom/décalage chromatique doivent rester bon marché,
    // à la résolution interne, pas à la résolution native). Sans objet à `internalResolutionScale
    // === 1` : `activeCanvas === canvas`, rien à recopier.
    if (this.activeCanvas !== this.canvas) {
      this.displayCtx.drawImage(
        this.activeCanvas,
        0,
        0,
        this.activeCanvas.width,
        this.activeCanvas.height,
        0,
        0,
        this.canvas.width,
        this.canvas.height,
      );
      // `endFrame()` doit laisser `ctx`/`activeCanvas` sur la cible RÉELLE avant de rendre la main :
      // `ExportPipeline.ts::runExport()` dessine le filigrane via `Renderer` APRÈS `endFrame()`, hors
      // du bracket `beginFrame`/`endFrame` (pas de nouvelle frame pour un simple filigrane). Sans ce
      // reset, ces appels viseraient encore le buffer interne déjà recopié plus haut — jamais réaffiché.
      this.activeCanvas = this.canvas;
      this.ctx = this.displayCtx;
    }
  }

  /**
   * Bloom d'ensemble (docs/07 §"Le bloom d'ensemble", Étape 21) : sous-échantillonnage → extraction
   * des hautes lumières → flou → composition additive, sur l'image COMPOSITE finale de la frame
   * (jamais par couche individuelle — une couche ne sait pas ce que les autres ont dessiné).
   *
   * Écart assumé par rapport à « deux passes de flou séparable » (docs/07) : `ctx.filter =
   * 'blur()'` natif (supporté par toute la matrice navigateurs de docs/11 — Chrome 52+, Firefox
   * 35+, Safari 9.1+) plutôt qu'une convolution séparable écrite à la main. `passes` (docs/10)
   * élargit le RAYON du flou plutôt que de répéter une vraie passe de convolution : un flou gaussien
   * de rayon R et N flous successifs de rayon R/N produisent un résultat visuellement très proche
   * pour un halo stylisé — la différence ne justifie pas la complexité d'un buffer ping-pong pour
   * ce produit. Même résultat DOCUMENTÉ (un halo qui s'étale), mécanisme plus simple.
   *
   * `getImageData`/`putImageData` uniquement sur le PETIT buffer réduit (jamais l'image pleine
   * résolution) — même principe que `FlashLimiter`, qui échantillonne déjà à 32×18 pour la même
   * raison de coût (docs/07 §"Canvas 2D" : `ctx.getImageData()` par image est listé comme un piège,
   * la parade documentée est justement le sous-échantillonnage AVANT lecture des pixels).
   */
  private applyBloom(): void {
    const fullW = this.activeCanvas.width;
    const fullH = this.activeCanvas.height;
    const { width: smallW, height: smallH } = computeSmallDimensions(fullW, fullH, this.bloomConfig.resolutionScale);

    if (!this.bloomExtractBuffer || this.bloomExtractBuffer.width !== smallW || this.bloomExtractBuffer.height !== smallH) {
      this.bloomExtractBuffer = new OffscreenCanvas(smallW, smallH);
      this.bloomExtractCtx = this.bloomExtractBuffer.getContext('2d');
      this.bloomBlurBuffer = new OffscreenCanvas(smallW, smallH);
      this.bloomBlurCtx = this.bloomBlurBuffer.getContext('2d');
    }
    const extractCtx = this.bloomExtractCtx!;
    const blurCtx = this.bloomBlurCtx!;

    // 1. Sous-échantillonnage : image composite de la cible ACTIVE -> petit buffer (rééchantillonnage
    //    bilinéaire gratuit via drawImage, même s'il s'agit du même `this.activeCanvas` en source).
    extractCtx.clearRect(0, 0, smallW, smallH);
    extractCtx.drawImage(this.activeCanvas, 0, 0, fullW, fullH, 0, 0, smallW, smallH);

    // 2. Extraction des hautes lumières, en place, sur le petit buffer.
    const imageData = extractCtx.getImageData(0, 0, smallW, smallH);
    extractHighlights(imageData.data);
    extractCtx.putImageData(imageData, 0, 0);

    // 3. Flou natif, rayon fonction du nombre de passes du niveau de qualité.
    const radiusPx = computeBlurRadiusPx(smallW, smallH, this.bloomConfig.passes);
    blurCtx.clearRect(0, 0, smallW, smallH);
    blurCtx.filter = radiusPx > 0 ? `blur(${radiusPx}px)` : 'none';
    blurCtx.drawImage(this.bloomExtractBuffer, 0, 0);
    blurCtx.filter = 'none';

    // 4. Composition additive par-dessus l'image d'origine, remise à l'échelle réelle.
    const prevComposite = this.ctx.globalCompositeOperation;
    const prevAlpha = this.ctx.globalAlpha;
    this.ctx.globalCompositeOperation = 'lighter';
    this.ctx.globalAlpha = BLOOM_COMPOSITE_ALPHA;
    this.ctx.drawImage(this.bloomBlurBuffer!, 0, 0, smallW, smallH, 0, 0, fullW, fullH);
    this.ctx.globalCompositeOperation = prevComposite;
    this.ctx.globalAlpha = prevAlpha;
  }

  /**
   * Décalage chromatique (docs/07 §"Le décalage chromatique", Étape 23) :
   * frange rouge/bleue discrète, sur l'image composite finale (bloom
   * inclus). Purement ADDITIVE par-dessus l'image d'origine, jamais de
   * `clear`/reconstruction — au pire l'effet est trop discret ou trop
   * marqué, jamais une image cassée.
   *
   * Isolation de canal SANS `getImageData` (contrairement au bloom, qui
   * doit lire des pixels — mais seulement sur son petit buffer réduit) :
   * `globalCompositeOperation = 'multiply'` avec un aplat de couleur pure
   * met les deux autres canaux à zéro (produit par canal, 0×x = 0) —
   * uniquement des opérations natives accélérées (`drawImage`/`fillRect`).
   */
  private applyChromaticAberration(): void {
    const w = this.activeCanvas.width;
    const h = this.activeCanvas.height;

    if (!this.aberrationSnapshotBuffer || this.aberrationSnapshotBuffer.width !== w || this.aberrationSnapshotBuffer.height !== h) {
      this.aberrationSnapshotBuffer = new OffscreenCanvas(w, h);
      this.aberrationSnapshotCtx = this.aberrationSnapshotBuffer.getContext('2d');
      this.aberrationScratchBuffer = new OffscreenCanvas(w, h);
      this.aberrationScratchCtx = this.aberrationScratchBuffer.getContext('2d');
    }

    // Capture de l'image de la cible ACTIVE (déjà composée, bloom inclus) — base commune aux deux passes teintées.
    this.aberrationSnapshotCtx!.clearRect(0, 0, w, h);
    this.aberrationSnapshotCtx!.drawImage(this.activeCanvas, 0, 0);

    const offsetPx = computeAberrationOffsetPx(w, h);
    this.compositeTintedChannel('#ff0000', -offsetPx);
    this.compositeTintedChannel('#0000ff', offsetPx);
  }

  /** Isole un canal (aplat `tint` en `'multiply'` sur la capture) puis le composite en `'lighter'` sur le canvas principal, décalé de `offsetXPx`. */
  private compositeTintedChannel(tint: string, offsetXPx: number): void {
    const w = this.activeCanvas.width;
    const h = this.activeCanvas.height;
    const scratchCtx = this.aberrationScratchCtx!;

    scratchCtx.clearRect(0, 0, w, h);
    scratchCtx.drawImage(this.aberrationSnapshotBuffer!, 0, 0);
    scratchCtx.globalCompositeOperation = 'multiply';
    scratchCtx.fillStyle = tint;
    scratchCtx.fillRect(0, 0, w, h);
    scratchCtx.globalCompositeOperation = 'source-over';

    const prevComposite = this.ctx.globalCompositeOperation;
    const prevAlpha = this.ctx.globalAlpha;
    this.ctx.globalCompositeOperation = 'lighter';
    this.ctx.globalAlpha = ABERRATION_TINT_ALPHA;
    this.ctx.drawImage(this.aberrationScratchBuffer!, offsetXPx, 0);
    this.ctx.globalCompositeOperation = prevComposite;
    this.ctx.globalAlpha = prevAlpha;
  }
}

function toCssColor(c: Color): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`;
}
