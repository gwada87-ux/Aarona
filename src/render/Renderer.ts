import type { Viewport } from './Viewport';

export interface Color {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Sprite pré-rendu (glow additif, docs/07 §"Le glow : jamais shadowBlur"). Opaque côté appelant. */
export interface SpriteHandle {
  readonly size: number;
}

/**
 * Une instance de sprite à dessiner — `drawSprite` prend un tableau pour
 * permettre l'instanciation. Champs MUTABLES (pas `readonly`) : un pool de
 * particules pré-alloue ses transformations une fois et les mute en place
 * chaque image plutôt que d'en recréer (docs/10_PERFORMANCE.md).
 */
export interface SpriteTransform {
  x: number;
  y: number;
  /** Taille de rendu en unités normalisées (diamètre) — pas un facteur multipliant `sprite.size`. */
  scale: number;
  alpha: number;
}

/**
 * Configuration du bloom d'ensemble (docs/07_VISUAL_ENGINE.md §"Le bloom
 * d'ensemble", docs/10_PERFORMANCE.md — table des 4 niveaux de qualité).
 * Forme structurellement identique à `perf/qualityLevels.ts::BloomConfig`
 * (même champs), mais déclarée séparément ici plutôt qu'importée : `render/`
 * n'a pas le droit d'importer `perf/` (docs/02, tableau des dépendances) —
 * le typage structurel de TypeScript suffit à faire interopérer les deux
 * sans import, `ui/App.ts` (qui a le droit d'importer les deux) faisant le
 * pont en passant directement une valeur de l'un à l'autre.
 */
export interface BloomConfig {
  readonly enabled: boolean;
  /** Fraction de la résolution native pour le buffer d'extraction/flou — sans objet si `enabled` est faux. */
  readonly resolutionScale: number;
  readonly passes: number;
}

/**
 * Interface de dessin (docs/02_ARCHITECTURE.md §Renderer). Complétée en P7
 * avec exactement ce que le style Pulse requiert : `strokeCircle`/`strokePath`
 * (anneaux, forme d'onde circulaire), `fillRadialGradient` (fond), `createSprite`/
 * `drawSprite` (glow additif), `applyShake` (tremblement d'écran, PostFx).
 *
 * `pushLayer`/`popLayer` (compositing hors-écran groupé générique) restent
 * DIFFÉRÉS — le seul besoin concret rencontré (le feedback de `Field`, P9)
 * s'est avéré plus spécifique qu'un groupe alpha générique : voir
 * `drawFeedback`/`captureFeedback` ci-dessous, ajoutées à sa place (docs/
 * JOURNAL.md, Étape 11). `drawText` reste différé : aucune couche `Text`
 * avant P12.
 *
 * Toutes les coordonnées reçues sont en espace normalisé (Loi 4).
 */
/**
 * Modes de fusion exposés aux couches (docs/17_PHASE2_VISUELS.md §7.2).
 *
 * Sous-ensemble VOLONTAIREMENT réduit de `globalCompositeOperation`. Chacun
 * donne un caractère complètement différent à la même géométrie, ce qui en
 * fait la variété la moins chère du moteur — mais tous ne sont pas sûrs :
 * `difference` peut produire des sauts de luminance que le `FlashLimiter`
 * écrêterait en permanence, auquel cas il vaut mieux ne pas le proposer.
 * Voir le journal du chantier 4 pour la mesure.
 *
 * `additive` porte un nom parlant plutôt que `'lighter'`, le nom Canvas :
 * une couche décrit une intention, pas une opération de contexte.
 */
export type BlendMode = 'normal' | 'additive' | 'screen' | 'multiply' | 'overlay' | 'difference';

export interface Renderer {
  beginFrame(viewport: Viewport): void;

  /**
   * Mode de fusion des dessins SUIVANTS, jusqu'au prochain appel (§7.2).
   * `null` restaure le comportement par défaut de chaque primitive — en
   * particulier `drawSprite`, qui est additif par nature.
   *
   * Posé par `Scene.draw` avant chaque couche depuis son champ `blend`, et
   * remis à `null` après : une couche ne peut pas contaminer la suivante.
   */
  setBlendMode(mode: BlendMode | null): void;
  clear(color: Color): void;
  fillCircle(x: number, y: number, radius: number, color: Color): void;

  strokeCircle(x: number, y: number, radius: number, lineWidth: number, color: Color): void;

  /**
   * Chemin à partir de tableaux typés parallèles — zéro allocation par
   * appel côté appelant (docs/10_PERFORMANCE.md). `count` peut être
   * inférieur à la capacité des tableaux (pool pré-alloué plus grand que
   * l'usage courant). `closed` (Étape 11/P9) : `true` referme le chemin sur
   * son premier point (boucle, ex. la forme d'onde circulaire de Pulse),
   * `false` le laisse ouvert (ex. la ligne d'onde plate de Spectrum Pro).
   */
  strokePath(xs: Float32Array, ys: Float32Array, count: number, lineWidth: number, color: Color, closed: boolean): void;

  /**
   * Polygone REMPLI à partir de tableaux typés parallèles — même
   * convention que `strokePath`. Ajouté à l'Étape 11/P9 pour les barres de
   * `Spectrum Pro` : ni `fillCircle` (rond) ni `strokePath` (contour seul)
   * ne peuvent produire un rectangle plein.
   */
  fillPath(xs: Float32Array, ys: Float32Array, count: number, color: Color): void;

  /** Dégradé radial couvrant tout le viewport, centré en (0,0). */
  fillRadialGradient(innerRadius: number, outerRadius: number, inner: Color, outer: Color): void;

  /** Rendu une seule fois dans un canvas hors écran ; réutilisé par `drawSprite`. */
  createSprite(draw: (ctx: OffscreenCanvasRenderingContext2D) => void, size: number): SpriteHandle;

  /**
   * Composite additif (`globalCompositeOperation = 'lighter'`), une
   * traversée pour les `count` premières entrées de `transforms`. `count`
   * en paramètre séparé (comme `strokePath`) depuis l'Étape 11/P9 : `Field`
   * pré-alloue son tableau de transformations à la taille du pool de
   * particules (2500) et le MUTE en place chaque image — passer un
   * `count` évite un `.slice()` (donc une allocation) par image.
   */
  drawSprite(sprite: SpriteHandle, transforms: readonly SpriteTransform[], count: number): void;

  /**
   * Décalage global (unités normalisées) appliqué à tout ce qui est dessiné
   * ENSUITE dans cette frame — PostFx "tremblement d'écran" doit donc être
   * la première couche à dessiner, pas la dernière (docs/07 liste l'ordre
   * conceptuel des couches, pas l'ordre d'exécution : un décalage global ne
   * peut affecter que ce qui est dessiné après lui).
   */
  applyShake(dx: number, dy: number): void;

  /**
   * CADRAGE global — translation et échelle — appliqué à tout ce qui est
   * dessiné ensuite (ADR-011). Se compose avec `applyShake`, qui reste la
   * secousse par couche : deux transformations successives sur le même
   * contexte.
   *
   * `zoom` est BORNÉ à [1, 2] par l'implémentation. Sous 1, le cadrage
   * s'élargirait et découvrirait les bords : les fonds plein écran cesseraient
   * de couvrir le cadre. « Plan large » est donc la valeur par défaut, « plan
   * rapproché » un zoom supérieur — jamais l'inverse.
   *
   * `drawFeedback` n'est délibérément PAS affecté : voir sa docstring.
   */
  applyCamera(dx: number, dy: number, zoom: number): void;

  /**
   * Redessine le contenu capturé par le dernier `captureFeedback()`, centré,
   * mis à l'échelle et atténué — docs/07 §"Field" : « canvas précédent
   * redessiné à 0,88 d'alpha, mis à l'échelle 1,004 ». Sans effet (rien
   * dessiné) tant qu'aucune capture n'a encore eu lieu, ex. toute première
   * image ou juste après `reset(t)`.
   *
   * Doit être appelé EN PREMIER dans la frame (avant le nouveau contenu),
   * comme `applyShake` : c'est la base sur laquelle le reste se compose.
   *
   * INSENSIBLE À `applyCamera` (ADR-011), et ce n'est pas un oubli. La capture
   * contient l'image telle qu'affichée, donc déjà cadrée par la caméra ; la
   * redessiner sous le même cadrage l'agrandirait une seconde fois, et
   * l'échelle croîtrait géométriquement d'une image à l'autre — un zoom tenu à
   * 1,15 pendant deux secondes donnerait un facteur supérieur à 10 000. La
   * traînée reste donc en espace ÉCRAN, ce qui a en prime un intérêt visuel :
   * elle se déforme quand la caméra bouge au lieu de la suivre rigidement.
   */
  drawFeedback(scale: number, alpha: number): void;

  /**
   * Capture l'état ACTUEL du canvas (après `endFrame()`) pour le prochain
   * `drawFeedback()`. Couche à état de framebuffer (docs/02 §Layer,
   * `needsDrawPriming = true`) : ne peut pas être reconstruite par
   * `update()` seul après un seek.
   */
  captureFeedback(): void;

  /**
   * Bloom d'ensemble (docs/07 §"Le bloom d'ensemble", Étape 21) : appliqué
   * en post-traitement dans `endFrame()`, sur l'image COMPOSITE finale —
   * jamais par couche individuelle. `enabled: false` restaure exactement le
   * comportement d'avant cette étape (aucun appel = déjà `false` par défaut
   * dans `Canvas2DRenderer`). Appelée par `ui/App.ts` à chaque changement de
   * niveau de qualité, et par `ExportPipeline.ts::runExport()` pour figer le
   * niveau HIGH pendant toute la durée d'un export (docs/10, règle non
   * négociable #2).
   */
  setBloomConfig(config: BloomConfig): void;

  /**
   * Décalage chromatique (docs/07 §"Le décalage chromatique", Étape 23) :
   * frange rouge/bleue discrète appliquée en post-traitement dans
   * `endFrame()`, sur l'image COMPOSITE finale (après le bloom), même
   * principe d'un simple booléen que `perf/qualityLevels.ts::QualityLevelConfig
   * .chromaticAberration` — pas besoin d'un type dédié dupliqué comme
   * `BloomConfig`, aucun autre paramètre à faire voyager à travers la
   * frontière `render/`/`perf/`. `false` par défaut restaure exactement le
   * comportement d'avant cette étape.
   */
  setChromaticAberration(enabled: boolean): void;

  /**
   * Résolution interne (docs/07 §"La résolution interne", Étape 24) : fraction
   * de la résolution native du canvas à laquelle TOUT le dessin de la frame a
   * lieu (couches, bloom, décalage chromatique) — un unique agrandissement
   * bilinéaire natif remet à l'échelle réelle en toute fin de `endFrame()`.
   * `1` (défaut) = chemin direct sur le canvas réel, identique à avant cette
   * étape ; aucun buffer interne n'est créé dans ce cas. Même principe de
   * booléen/nombre simple que `setChromaticAberration` — pas de type dédié,
   * `perf/qualityLevels.ts::QualityLevelConfig.internalResolutionScale` est
   * déjà un `number` nu.
   */
  setInternalResolutionScale(scale: number): void;

  endFrame(): void;
}
