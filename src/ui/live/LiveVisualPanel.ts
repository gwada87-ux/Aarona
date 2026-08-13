import { FlashLimiter } from '../../visual/safety/FlashLimiter';
import type { LiveAudioSource } from '../../audio/LiveAudioSource';
import { LiveAnalysisEngine } from './audio/LiveAnalysisEngine';
import { DebugHud } from './DebugHud';
import { LivePipeline } from './render/LivePipeline';
import { playableScenes, sceneById } from './scenes';
import { IntensityDirector } from './IntensityDirector';
import { LiveDirector } from './LiveDirector';
import { OverlayDirector } from './Overlays';
import { actionForKey, loadControls, saveControls, type PersistedControls } from './Controls';
import { mergeLiveConfig, type LiveConfig, type LiveConfigPatch } from './LiveConfig';
import { TruthDirector } from './truth/TruthDirector';
import { CHORD_HUE_SHARE, chordHueOffsetDeg } from './util/tonalHue';

/**
 * Etape 53 (hors roadmap) : rendu du mode "live" - deliberement SEPARE du
 * moteur StepContext/BehaviourEngine/Scene (Loi 1, docs/00b : rendu = fonction
 * pure du temps musical, incompatible avec un flux dont la fin n'est pas
 * connue). Son propre `<canvas>`, sa propre boucle `requestAnimationFrame`,
 * un rendu 2D volontairement simple (pas via `Renderer`/`Canvas2DRenderer`,
 * dont le contrat sert le moteur a timeline precalculee). Le mode fichier
 * (`#canvas`) n'est jamais touche par cette classe.
 *
 * ETAPE 1 de la refonte live : le panneau devient un orchestrateur mince.
 * Toute l'analyse (grille 50 Hz, onsets, tempo, horloge musicale, machine a
 * etats) est dans `audio/`, testee sans navigateur. Le RENDU n'est pas encore
 * refait : il reste le mandala de 32 barres, simplement alimente par les
 * features au lieu des octets bruts de l'AnalyserNode. Les scenes, le
 * pipeline de post et le director arrivent aux etapes suivantes.
 */
export class LiveVisualPanel {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx2d: CanvasRenderingContext2D;
  private readonly flashLimiter: FlashLimiter;
  private readonly container: HTMLElement;

  private config: LiveConfig = mergeLiveConfig();
  private engine: LiveAnalysisEngine | null = null;
  /** Canal de verite PMDI (ADR-012) - meme cycle de vie que `engine`. */
  private truth: TruthDirector | null = null;
  private pipeline: LivePipeline | null = null;
  private director: LiveDirector | null = null;
  private intensity: IntensityDirector | null = null;
  private overlays: OverlayDirector | null = null;
  private hud: DebugHud | null = null;
  private paletteLocked = false;
  private helpVisible = false;
  /** Mire de calibration de `userTrimMs` (touche `C`). */
  private calibrationVisible = false;
  /** Phase de mesure visuelle de la trame precedente. -1 = aucune. */
  private lastCalibPhase = -1;
  private persisted: PersistedControls = loadControls();
  private directorRng: () => number = Math.random;
  private source: LiveAudioSource | null = null;
  private audioContext: AudioContext | null = null;
  private motionQuery: MediaQueryList | null = null;
  private reducedMotion = false;
  /** Textes de `type-slam` poses par l'interface, survivant a `stop()`/`start()`. */
  private pendingSlamText: readonly string[] | null = null;
  /** Voir `setPaused()`. */
  private paused = false;

  private rafId: number | null = null;
  /**
   * Incremente a chaque `stop()`. La callback rAF verifie la generation en
   * tete : une trame peut etre EN VOL au moment ou `cancelAnimationFrame` est
   * appele, et elle dessinerait alors sur un moteur deja libere.
   */
  private generation = 0;
  private resizeObserver: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;
  private pendingW = 0;
  private pendingH = 0;
  private lastFrameStamp = 0;
  private frameMs = 16.7;
  private hiddenAt = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'live-canvas';
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none';
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('LiveVisualPanel: contexte 2D indisponible');
    this.ctx2d = ctx;
    // FlashLimiter DEDIE, separe de celui du mode fichier - celui-ci tourne sur
    // le temps reel (pas de temps musical en direct), l'autre sur `simT` :
    // les melanger ferait cohabiter deux notions de temps dans une seule
    // fenetre glissante d'une seconde.
    this.flashLimiter = new FlashLimiter(this.canvas);
  }

  /**
   * @param source source live DEJA branchee (`attachAnalysis` appele).
   * @param patch  surcharge de configuration, fusionnee sur les defauts.
   */
  start(source: LiveAudioSource, patch?: LiveConfigPatch): void {
    this.stop();
    this.config = mergeLiveConfig(patch);
    this.source = source;
    const sampleRate = source.getSampleRate();
    if (sampleRate <= 0) {
      // `attachAnalysis` n'a pas ete appele : rien a analyser, on ne demarre
      // pas de boucle qui ne pourrait rien afficher.
      this.source = null;
      return;
    }
    this.engine = new LiveAnalysisEngine(this.config, sampleRate, source.fftSizeOnset, source.fftSizeBands);
    this.truth = new TruthDirector(this.config.truth);
    // Canal de verite (ADR-012) : l'heure d'arrivee est relevee sur l'horloge
    // audio LOCALE - la seule base comparable aux onsets detectes. Sans
    // contexte (avant `attachAudioContext`), le message est perdu ; l'hote
    // reemet tempo et heartbeat en continu, rien a rattraper.
    source.onPmdiMessage = (raw) => {
      const ctx = this.audioContext;
      if (ctx && this.truth) this.truth.ingest(ctx.currentTime, raw);
    };
    this.pipeline = new LivePipeline(this.config);
    // Texte pose par l'interface AVANT le demarrage : le mode live ne demarre
    // que sur un pont WebRTC entrant, donc c'est le cas courant, pas l'exception.
    if (this.pendingSlamText) this.pipeline.setSlamText(this.pendingSlamText);
    this.director = new LiveDirector(this.config.director);
    this.intensity = new IntensityDirector(this.config.intensity);
    this.overlays = new OverlayDirector(this.config.director);
    this.hud = new DebugHud(this.config);

    // Reglages persistes (§4.5).
    this.persisted = loadControls();
    this.intensity.userScale = this.persisted.userScale;
    this.hud.visible = this.persisted.hudVisible || this.config.content.debugHudOnStart;
    this.engine.beat.setUserTrimMs(this.persisted.userTrimMs);
    this.directorRng = makeSeededRng(0x9e3779b9);

    this.canvas.style.display = 'block';
    this.measure();
    this.applyPendingSize();
    this.watchReducedMotion();

    // Scene imposee par la configuration : elle verrouille le director, sinon
    // il la remplacerait a la premiere frontiere.
    if (this.config.content.forcedScene) {
      this.selectScene(this.config.content.forcedScene);
      this.director.sceneLocked = true;
    }

    // `getBoundingClientRect()` par trame force un reflow a chaque image
    // (interdit §6.6). Le ResizeObserver ne fait que STOCKER la taille ; la
    // reallocation a lieu en tete de trame.
    this.resizeObserver = new ResizeObserver(() => this.measure());
    this.resizeObserver.observe(this.canvas);
    // `ResizeObserver` ne se declenche PAS sur un changement de DPR : il faut
    // une media query dediee, rearmee a chaque declenchement.
    this.watchDpr();

    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    const generation = this.generation;
    const frame = (stamp: number): void => {
      if (generation !== this.generation) return;
      this.tick(stamp);
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  /** Idempotent : appelable deux fois de suite sans effet de bord. */
  stop(): void {
    this.generation++;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.dprQuery) {
      this.dprQuery.removeEventListener('change', this.onDprChange);
      this.dprQuery = null;
    }
    if (this.motionQuery) {
      this.motionQuery.removeEventListener('change', this.onMotionChange);
      this.motionQuery = null;
    }
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);

    this.engine?.reset();
    this.engine = null;
    if (this.source) this.source.onPmdiMessage = null;
    this.truth = null;
    this.pipeline?.dispose();
    this.pipeline = null;
    this.director?.reset();
    this.director = null;
    this.intensity?.reset();
    this.intensity = null;
    this.overlays?.reset();
    this.overlays = null;
    this.helpVisible = false;
    this.paletteLocked = false;
    this.hud = null;
    this.source = null;
    this.audioContext = null;
    this.flashLimiter.reset(0);
    this.canvas.style.display = 'none';
  }

  get active(): boolean {
    return this.rafId !== null;
  }

  /**
   * Accès au moteur d'analyse — pour `LiveStepContextBridge` (chantier
   * « panneau réellement fonctionnel en direct »), qui a besoin de lire
   * `features`/`beat`/`onsetSet`/`section`/`state`/`tSec` chaque frame pour
   * construire un `StepContext`. Le panneau reste seul propriétaire du cycle
   * de vie du moteur (`start()`/`stop()`/`reArm()`) ; ceci n'expose qu'une
   * référence de lecture.
   */
  get analysisEngine(): LiveAnalysisEngine | null {
    return this.engine;
  }

  /**
   * Suspend/reprend le rendu du système à 6 scènes SANS arrêter `engine`
   * (`stop()` le ferait, perdant le verrouillage de tempo — un retour à
   * l'automatique redémarrerait alors en `BOOT`, plusieurs secondes de
   * réacquisition). En pause, `tick()` continue d'appeler `engine.step()`
   * (le tempo reste chaud) mais saute director/overlays/palette/rendu — le
   * canvas est masqué, ce travail serait perdu de toute façon.
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.canvas.style.display = paused ? 'none' : 'block';
  }

  /**
   * Contexte audio, pour lire `currentTime` et `getOutputTimestamp()` (§2.5).
   * A appeler APRES `start()` : celui-ci commence par `stop()`, qui relache la
   * reference - le contexte appartient a l'appelant, pas au panneau. Sans
   * contexte, la boucle tourne mais n'alimente pas le moteur d'analyse.
   */
  attachAudioContext(ctx: AudioContext): void {
    this.audioContext = ctx;
  }

  /**
   * Choisit une scene par identifiant. `''` prend la premiere scene jouable
   * dans le mode de mouvement courant.
   */
  selectScene(id: string): void {
    if (!this.pipeline) return;
    const playable = playableScenes(this.reducedMotion);
    const wanted = id ? sceneById(id) : null;
    const entry = wanted && playable.includes(wanted) ? wanted : playable[0];
    if (!entry) return;
    this.pipeline.setScene(entry.create());
  }

  /**
   * Choisit une scène ET la verrouille (chantier « choisir une scène
   * automatique au même titre qu'un style ») — sans le verrou, le director
   * la remplacerait à la prochaine frontière de phrase/mesure, contredisant
   * le choix qui vient d'être fait.
   */
  selectSceneLocked(id: string): void {
    this.selectScene(id);
    if (this.director) this.director.sceneLocked = true;
  }

  /** Une scène a-t-elle été choisie à la main (verrouillée) ? Pour la synchronisation de l'UI. */
  get sceneLocked(): boolean {
    return this.director?.sceneLocked ?? false;
  }

  /** Retour au director automatique — voir le bouton « Revenir à l'automatique ». */
  unlockScene(): void {
    if (this.director) this.director.sceneLocked = false;
  }

  /**
   * Textes de `type-slam` (docs/17 §9.3, chantier 8).
   *
   * §9.3 : « `LiveConfig.content.slamText` existe [...] mais aucune interface ne
   * l'expose. Expose-le. » C'est fait par le MEME champ que le texte du mode
   * fichier : Aaron ecrit son label une fois, et il sert aux deux moteurs. Deux
   * champs separes auraient demande de choisir lequel des deux fait foi.
   *
   * Memorise meme panneau arrete : le mode live ne demarre que sur un pont
   * WebRTC entrant, donc le texte est presque toujours saisi AVANT que le
   * panneau existe.
   */
  setSlamText(lines: readonly string[]): void {
    this.pendingSlamText = lines;
    this.pipeline?.setSlamText(lines);
  }

  /** Etat courant du moteur - expose pour la verification Playwright. */
  get engineState(): string {
    return this.engine?.state ?? 'STOPPED';
  }

  get sceneId(): string {
    return this.pipeline?.currentScene?.id ?? '-';
  }

  get bpm(): number {
    return this.engine?.beat.bpm ?? 0;
  }

  /**
   * Controles utilisateur (§4.5). Le panneau traduit une intention en effet ;
   * `Controls.ts` ne connait ni le rendu ni l'analyse.
   */
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const engine = this.engine;
    const pipeline = this.pipeline;
    const director = this.director;
    const intensity = this.intensity;
    if (!engine || !pipeline || !director || !intensity || !this.hud) return;

    const action = actionForKey(event, engine.audioTime);
    if (!action) return;
    event.preventDefault();

    switch (action.type) {
      case 'tap':
        engine.beat.tap(action.tSec);
        break;
      case 'auto-tempo':
        engine.beat.releaseManual();
        break;
      case 'toggle-scene-lock':
        director.sceneLocked = !director.sceneLocked;
        break;
      case 'scene-step':
        director.requestManual(action.direction);
        break;
      case 'toggle-palette-lock':
        this.paletteLocked = !this.paletteLocked;
        break;
      case 'palette-next':
        pipeline.palette.next(this.config.content.paletteCrossfadeSec);
        break;
      case 'intensity':
        intensity.nudgeUserScale(action.direction);
        this.persist();
        break;
      case 'sync-trim':
        engine.beat.setUserTrimMs(engine.beat.userTrimMs + action.direction * this.config.sync.userTrimStepMs);
        this.persist();
        break;
      case 'panic': {
        // Retour IMMEDIAT a la scene d'attente, tous overlays coupes (§4.5).
        this.overlays?.panic();
        const decision = director.panic(this.directorInput(engine));
        if (decision) pipeline.setScene(decision.entry.create(), decision.variant);
        break;
      }
      case 'toggle-help':
        this.helpVisible = !this.helpVisible;
        break;
      case 'toggle-hud':
        this.hud.toggle();
        this.persist();
        break;
      case 'toggle-calibration':
        this.calibrationVisible = !this.calibrationVisible;
        // Pas de persistance : la mire est un outil de mesure, pas un reglage.
        // La retrouver allumee au demarrage suivant serait un defaut.
        this.lastCalibPhase = -1;
        break;
    }
  };

  private persist(): void {
    if (!this.engine || !this.intensity || !this.hud) return;
    this.persisted = {
      userScale: this.intensity.userScale,
      userTrimMs: this.engine.beat.userTrimMs,
      hudVisible: this.hud.visible,
    };
    saveControls(this.persisted);
  }

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.hiddenAt = performance.now();
      return;
    }
    // Aucun rattrapage au retour d'onglet : `dt` est deja clampe, et au-dela
    // d'une seconde l'etat accumule ne decrit plus rien de reel.
    const hiddenSec = this.hiddenAt > 0 ? (performance.now() - this.hiddenAt) / 1000 : 0;
    this.hiddenAt = 0;
    this.engine?.onVisible(hiddenSec);
    this.lastFrameStamp = 0;
  };

  /**
   * `prefers-reduced-motion` ecoute EN CONTINU (§1), pas seulement au
   * demarrage : l'utilisateur peut l'activer pendant que le visuel tourne, et
   * c'est precisement le moment ou il en a besoin.
   */
  private watchReducedMotion(): void {
    if (!this.config.safety.respectReducedMotion) return;
    this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motionQuery.matches;
    this.motionQuery.addEventListener('change', this.onMotionChange);
    this.flashLimiter.setReducedFlashing(this.reducedMotion);
  }

  private readonly onMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
    this.flashLimiter.setReducedFlashing(this.reducedMotion);
  };

  private watchDpr(): void {
    const dpr = window.devicePixelRatio || 1;
    this.dprQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  private readonly onDprChange = (): void => {
    if (this.dprQuery) this.dprQuery.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
    this.measure();
    this.watchDpr();
  };

  private measure(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.pendingW = Math.round(rect.width * dpr);
    this.pendingH = Math.round(rect.height * dpr);
  }

  /**
   * Ecrire `canvas.width` reinitialise TOUT l'etat du contexte et vide le
   * bitmap : on ne le fait qu'en cas de changement reel, et jamais sur une
   * taille nulle (un element `display:none` ferait lever `InvalidStateError`
   * a `drawImage`).
   */
  private applyPendingSize(): void {
    if (this.pendingW <= 0 || this.pendingH <= 0) return;
    if (this.canvas.width === this.pendingW && this.canvas.height === this.pendingH) return;
    this.canvas.width = this.pendingW;
    this.canvas.height = this.pendingH;
    this.ctx2d.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx2d.imageSmoothingEnabled = true;
    this.ctx2d.globalAlpha = 1;
    this.ctx2d.globalCompositeOperation = 'source-over';
    // Le feedback est perdu par le redimensionnement : on le vide franchement
    // et on gele l'adaptation de qualite, dont les mesures ne seraient pas
    // representatives pendant la reallocation (§3.7).
    this.pipeline?.invalidate(this.lastFrameStamp);
  }

  private tick(stamp: number): void {
    const engine = this.engine;
    const source = this.source;
    const pipeline = this.pipeline;
    if (!engine || !source || !pipeline) return;
    this.applyPendingSize();
    if (this.canvas.width <= 0 || this.canvas.height <= 0) return;

    // MUST §3.7 : le temps de trame se mesure sur les horodatages de rAF, pas
    // avec un `performance.now()` autour du code de rendu - le travail Canvas
    // 2D est soumis de facon asynchrone.
    pipeline.budget.sample(stamp);
    if (this.lastFrameStamp > 0) {
      const delta = stamp - this.lastFrameStamp;
      if (delta > 0 && delta < 500) this.frameMs = this.frameMs + 0.1 * (delta - this.frameMs);
    }
    this.lastFrameStamp = stamp;

    const freqOnsetDb = source.getFloatFrequencyData();
    const freqBandsDb = source.getFloatBandsFrequencyData();
    const timeDomain = source.getFloatTimeDomainData();
    const ctx = this.audioContext;
    if (freqOnsetDb && freqBandsDb && timeDomain && ctx) {
      engine.step({
        tAudio: ctx.currentTime,
        freqOnsetDb,
        freqBandsDb,
        timeDomain,
        audioAheadMs: audioAheadMs(ctx, this.config.sync.fallbackOutputLatencySec),
        frameIntervalSec: this.frameMs / 1000,
      });
      // ADR-012 : la verite s'evalue apres l'analyse de la trame - elle a
      // besoin des onsets que `step()` vient de poser.
      this.truth?.step(ctx.currentTime, engine);
    }

    // Voir `setPaused()` : le tempo doit rester chaud (analyse ci-dessus),
    // mais tout le travail de rendu est inutile canvas masqué.
    if (this.paused) return;

    const director = this.director;
    const intensityDirector = this.intensity;
    const overlays = this.overlays;
    if (!director || !intensityDirector || !overlays) return;

    // 1. INTENSITE. Tout ce qui suit lit ceci, jamais l'audio (§2.8).
    intensityDirector.update(engine.dt, engine.section, engine.beat, pipeline.stats.luminance);

    // 2. DIRECTOR. Une transition en cours gele l'adaptation de qualite : son
    //    cout x2 n'est pas representatif (§3.7).
    if (pipeline.transitioning) pipeline.budget.freeze(stamp, this.config.perf.transitionFreezeMs);
    const decision = director.update(this.directorInput(engine));
    if (decision) {
      // Fondu plafonne a une demi-mesure (§4.3).
      const barSec = engine.beat.periodSec > 0 ? engine.beat.periodSec * this.config.beat.beatsPerBar : 2;
      const maxFade = barSec * this.config.director.maxCrossfadeBars;
      const fade = this.reducedMotion
        ? Math.max(decision.fadeSec, this.config.safety.reducedTransitionSec)
        : Math.min(decision.fadeSec, maxFade);
      const scene = decision.entry.create();
      if (fade > 0) pipeline.crossfadeTo(scene, decision.variant, fade);
      else pipeline.setScene(scene, decision.variant);
      pipeline.budget.freeze(stamp, this.config.perf.transitionFreezeMs);
    }

    // 3. OVERLAYS. Bascule sur frontiere de mesure uniquement (§4.4).
    overlays.update(
      engine.beat,
      intensityDirector.budget,
      intensityDirector.intensity,
      pipeline.currentScene?.id ?? '',
      this.reducedMotion,
      this.directorRng,
    );

    // Fondu de palette sur frontiere de PHRASE (§3.5), coupe franche sur un
    // drop - sauf si l'operateur a verrouille la palette (§4.5).
    if (!this.paletteLocked) {
      if (engine.beat.phraseThisFrame) pipeline.palette.next(this.config.content.paletteCrossfadeSec);
      else if (engine.section.dropFired) pipeline.palette.next(0);
    }
    if (engine.beat.beatsThisFrame > 0) pipeline.palette.markBeat();

    // ADR-015 : la couleur suit l'HARMONIE. La cible est recalculee a chaque
    // trame parce que `setTonalHueTarget` est idempotente — mais elle ne
    // CHANGE qu'a l'arrivee d'un nouvel accord, lequel est annonce par mesure
    // cote Beat Studio : la frontiere de mesure est donc portee par l'harmonie
    // elle-meme, sans qu'il faille un signal de mesure separe. Sans canal de
    // verite, ou avant le premier accord, `chordRoot` vaut -1 et la cible est
    // nulle : la palette rend exactement ce qu'elle rendait avant ce chantier.
    const chordRoot = this.truth?.chordRoot ?? -1;
    pipeline.palette.setTonalHueTarget(
      chordRoot < 0
        ? 0
        : chordHueOffsetDeg(chordRoot, this.truth!.tonalCenter, pipeline.palette.current.hueModulation * CHORD_HUE_SHARE),
    );
    // Le shake est une modulation de la CAMERA, pas un effet separe (§3.6).
    // L'amplitude passe par le budget : c'est lui qui porte la retenue avant
    // impact et la retombee d'apres drop.
    if (engine.firedThisFrame('kick')) {
      pipeline.camera.impulse(engine.onsets.lastStrength('kick') * intensityDirector.budget.amplitude);
    }

    pipeline.render(
      this.ctx2d,
      this.canvas.width,
      this.canvas.height,
      window.devicePixelRatio || 1,
      {
        dt: engine.dt,
        tSec: engine.tSec,
        state: engine.state,
        beat: engine.beat,
        features: engine.features,
        onsets: engine.onsetSet,
        energy: engine.section,
        intensity: intensityDirector.intensity,
        reducedMotion: this.reducedMotion,
      },
      { budget: intensityDirector.budget, overlays: overlays.active },
    );

    this.drawBadge(engine, pipeline);
    this.drawCalibrationMarker(engine);

    // `FlashLimiter` : dernier etage, non contournable (Loi 5). En direct il
    // n'y a pas de temps musical au sens du mode fichier, on lui passe
    // l'horloge audio.
    this.flashLimiter.apply(engine.tSec);

    if (this.hud) {
      this.hud.frameMs = pipeline.budget.medianFrameMs || this.frameMs;
      this.hud.flashClamped = this.flashLimiter.clampedCount;
      this.hud.pipeline = pipeline;
      this.hud.director = director;
      this.hud.intensity = intensityDirector;
      this.hud.overlays = overlays;
      this.hud.truth = this.truth;
      this.hud.draw(this.ctx2d, engine, window.devicePixelRatio || 1);
    }
    if (this.helpVisible) this.hud?.drawHelp(this.ctx2d, this.canvas.width, this.canvas.height, window.devicePixelRatio || 1);
  }

  private directorInput(engine: LiveAnalysisEngine): Parameters<LiveDirector['update']>[0] {
    return {
      tSec: engine.tSec,
      dt: engine.dt,
      state: engine.state,
      beat: engine.beat,
      section: engine.section,
      intensity: this.intensity?.intensity ?? 0,
      rmsDbfs: engine.features.rmsDbfs,
      reducedMotion: this.reducedMotion,
      rng: this.directorRng,
    };
  }

  /**
   * Repere `EN DIRECT`, conserve par §1 mais RETRAVAILLE : couleur de palette
   * au lieu d'un blanc pose, apparition progressive pendant BOOT (§2.6), et la
   * pastille bat sur le temps MUSICAL - decale de `syncOffsetMs` - plutot que
   * de clignoter sur une horloge independante. Dessine sur le canvas visible
   * apres le post : il ne doit ni entrer dans le feedback, ni etre floute par
   * le bloom.
   */
  /**
   * MIRE DE CALIBRATION de `userTrimMs` (§9.6). Touche `C`.
   *
   * §8 designe la latence son -> image comme le seul critere non automatisable :
   * « elle exige de filmer l'ecran et le son a 240 fps sur un click track de
   * BPM connu ». Ce mode est ce qui rend cette mesure FAISABLE. Sans lui,
   * l'operateur doit reperer sur la video l'instant exact ou une scene « reagit »,
   * ce qui n'a pas de front net : une enveloppe qui monte en trois trames ne
   * donne pas d'instant a mesurer.
   *
   * La mire, elle, apparait sur UNE SEULE trame, avec un bord franc. A 240 fps
   * elle occupe quatre images de film consecutives et pas une de plus. On
   * compte les images entre l'attaque du clic dans la piste audio et la
   * premiere image ou le carre est allume ; a 240 fps chaque image vaut
   * 4,17 ms. `userTrimMs` se regle ensuite aux fleches haut/bas jusqu'a
   * annuler l'ecart, et la valeur est persistee.
   *
   * Un CARRE d'un huitieme de cote, pas un plein ecran : la mire passe par le
   * `FlashLimiter` comme tout le reste (§6.9), et un plein ecran blanc y serait
   * ecrete - la mire mesurerait alors le limiteur et non la latence.
   *
   * Dessine sur le coin BAS-DROIT, a l'oppose du badge et du HUD, pour rester
   * lisible quel que soit ce qui est affiche par ailleurs.
   */
  private drawCalibrationMarker(engine: LiveAnalysisEngine): void {
    if (!this.calibrationVisible) return;
    const phase = engine.beat.visualBarPhase;
    // Frontiere de MESURE visuelle : detectee sur le rebouclage de la phase,
    // pas sur `barIndex`, qui avance a la frontiere brute - donc en avance de
    // `syncOffsetMs`, c'est-a-dire de la quantite meme qu'on cherche a mesurer.
    const wrapped = this.lastCalibPhase >= 0 && phase < this.lastCalibPhase - 0.5;
    this.lastCalibPhase = phase;

    const ctx = this.ctx2d;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const side = Math.round(Math.min(w, h) / 8);
    const x = w - side - Math.round(side * 0.25);
    const y = h - side - Math.round(side * 0.25);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // Cadre permanent : il montre a l'operateur OU regarder sur la video, et
    // donne une reference de niveau pour distinguer « eteint » de « hors champ ».
    ctx.strokeStyle = '#404040';
    ctx.lineWidth = Math.max(1, Math.round(side * 0.02));
    ctx.strokeRect(x + 0.5, y + 0.5, side, side);
    if (!wrapped) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, side, side);
  }

  private drawBadge(engine: LiveAnalysisEngine, pipeline: LivePipeline): void {
    const ctx = this.ctx2d;
    const h = this.canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const boot = engine.state === 'BOOT' ? Math.min(1, engine.tSec / this.config.state.bootSec) : 1;
    if (boot <= 0) return;

    const size = Math.max(11, Math.round(h * 0.016));
    const pad = Math.round(12 * dpr);
    const toBeat = engine.beat.periodSec > 0 ? 1 - engine.beat.visualBeatPhase : 0;
    const dot = 0.45 + 0.55 * toBeat * toBeat;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = boot * 0.9;
    ctx.fillStyle = pipeline.palette.hex('accent');
    ctx.beginPath();
    ctx.arc(pad + size * 0.35, pad + size * 0.55, size * 0.28 * dot, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = boot * 0.75;
    ctx.fillStyle = pipeline.palette.hex('highlight');
    ctx.font = `${size}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('EN DIRECT', pad + size, pad + size * 0.55);
    ctx.globalAlpha = 1;
  }
}

/**
 * `(currentTime - getOutputTimestamp().contextTime) * 1000` : de combien
 * l'analyse est EN AVANCE sur l'oreille. Voir la convention dans `BeatClock`.
 * `baseLatency` seul (2,9 a 11,6 ms) ne suffit pas - c'est `outputLatency` qui
 * porte la latence materielle, et Safari ne l'expose pas.
 */
/** PRNG seede du director : les choix de scene doivent etre reproductibles. */
function makeSeededRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000000) / 1000000;
  };
}

function audioAheadMs(ctx: AudioContext, fallbackOutputLatencySec: number): number {
  const ts = ctx.getOutputTimestamp?.();
  if (ts && typeof ts.contextTime === 'number' && ts.contextTime > 0) {
    return (ctx.currentTime - ts.contextTime) * 1000;
  }
  const output = typeof ctx.outputLatency === 'number' ? ctx.outputLatency : fallbackOutputLatencySec;
  return (ctx.baseLatency + output) * 1000;
}
