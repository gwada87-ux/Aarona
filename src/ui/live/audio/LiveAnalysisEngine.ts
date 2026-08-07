/**
 * Orchestrateur de l'analyse live et machine a etats (§2.6).
 *
 * Sans machine a etats, le premier bug que voit l'utilisateur est un visuel qui
 * part en vrille sur du silence, l'AGC amplifiant le bruit de fond. D'ou le
 * gate de silence : sous le plancher de RMS, AUCUNE detection d'onset, AUCUNE
 * mise a jour d'AGC, AUCUNE alimentation du `TempoEstimator`.
 *
 * Classe pure au sens de §7 : aucun `window`, aucun `performance.now()`, aucun
 * acces au DOM. Toute l'horloge vient de `input.tAudio`
 * (= `audioContext.currentTime`), ce qui rend le moteur pilotable trame par
 * trame par le banc synthetique.
 */

import { AnalysisGrid } from './AnalysisGrid';
import { AudioFeatures } from './AudioFeatures';
import { BeatClock } from './BeatClock';
import {
  CH_FLATNESS,
  CH_HAT,
  CH_KICK,
  CH_KICK_ENV,
  CH_SNARE,
  GRID_CHANNELS,
  OnsetDetector,
  SpectralFlux,
  type OnsetKind,
} from './OnsetDetector';
import { TempoEstimator } from './TempoEstimator';
import { SectionEnergy } from './SectionEnergy';
import { MACRO_BAND_IDS, type LiveConfig } from '../LiveConfig';
import { impact } from '../util/easing';
import type { OnsetSet } from '../scenes/types';

export type EngineState = 'BOOT' | 'IDLE' | 'REACTIVE' | 'LOCKED';

export interface LiveAnalysisInput {
  /** `audioContext.currentTime` de cette trame. JAMAIS `performance.now()`. */
  readonly tAudio: number;
  /** Spectre de l'analyseur d'onsets (2048), en dBFS. */
  readonly freqOnsetDb: Float32Array;
  /** Spectre de l'analyseur de niveaux (8192), en dBFS. */
  readonly freqBandsDb: Float32Array;
  /** Bloc temporel flottant. */
  readonly timeDomain: Float32Array;
  /** `(currentTime - getOutputTimestamp().contextTime) * 1000`, ou repli. */
  readonly audioAheadMs: number;
  /** Intervalle de trame mesure, en secondes. */
  readonly frameIntervalSec: number;
}

/** `a` est-il dans un rapport 1/3, 1/2, 2 ou 3 avec `b`, a 6 % pres ? */
function isOctaveRelated(a: number, b: number): boolean {
  for (const k of [1 / 3, 0.5, 2, 3]) {
    if (Math.abs(a - b * k) / (b * k) < 0.06) return true;
  }
  return false;
}

/**
 * Vue des onsets telle qu'une scene la consomme (§4.1). Traduit les instants
 * bruts du detecteur en enveloppes utilisables par le rendu.
 */
class OnsetView implements OnsetSet {
  constructor(private readonly engine: LiveAnalysisEngine) {}

  fired(kind: OnsetKind): boolean {
    return this.engine.firedThisFrame(kind);
  }

  strength(kind: OnsetKind): number {
    return this.engine.onsets.lastStrength(kind);
  }

  lastTime(kind: OnsetKind): number {
    return this.engine.onsets.lastTime(kind);
  }

  /**
   * MUST §2.7.2 : decroissance selon le TEMPS ECOULE depuis l'attaque, jamais
   * selon `beatPhase`. Avec `beatPhase`, l'enveloppe remonte a 1 sur TOUS les
   * temps meme sans frappe, et une frappe en contretemps nait deja a moitie
   * attenuee.
   *
   * Une nouvelle attaque REMPLACE l'enveloppe (`max`), elle ne s'y ajoute pas.
   *
   * ETAPE 6 - la decroissance etait exponentielle. `exp(-t/tau)` ne « revient
   * jamais au repos » : a `tau` elle vaut encore 0,37, et il faut environ 3
   * `tau` pour descendre sous 5 %. La consigne de §2.7.8 - « retour au repos
   * sur 0,3 a 0,6 temps » - n'etait donc pas tenue : avec `decayBeats` a 0,35
   * la reaction du kick restait allumee bien apres le temps suivant, ce qui
   * mange exactement le contraste que la frappe devait creer. `impact()` atteint
   * zero EXACTEMENT a `decayBeats`. Les appelants ont ete reregles en
   * consequence (constantes `DECAY_*`), ce n'est pas une simple substitution.
   */
  envelope(kind: OnsetKind, decayBeats: number, overshoot = 0): number {
    const period = this.engine.beat.periodSec;
    if (period <= 0) return 0;
    const since = this.engine.audioTime - this.engine.onsets.lastTime(kind);
    if (!(since >= 0) || !Number.isFinite(since)) return 0;
    return this.engine.onsets.lastStrength(kind) * impact(since / period, decayBeats, overshoot);
  }
}

export class LiveAnalysisEngine {
  readonly features: AudioFeatures;
  readonly onsets: OnsetDetector;
  readonly tempo: TempoEstimator;
  readonly beat: BeatClock;
  readonly section: SectionEnergy;
  /** Vue des onsets pour le rendu. */
  readonly onsetSet: OnsetSet;
  /** Onsets par seconde, lisse - alimente l'intensite (§2.8). */
  onsetRate = 0;

  state: EngineState = 'BOOT';
  /** Secondes ecoulees depuis `start()`, en temps audio. */
  tSec = 0;
  /** `dt` de la derniere trame utile, deja clampe. */
  dt = 0;
  /** Une trame a-t-elle ete ignoree parce que l'AnalyserNode n'avait pas avance ? */
  staleFrames = 0;

  private readonly grid: AnalysisGrid;
  private readonly flux: SpectralFlux;
  private readonly channels = new Float32Array(GRID_CHANNELS);
  private readonly fluxOut = new Float32Array(3);
  private readonly fluxCarry = new Float32Array(3);
  private frameStart = 0;
  private fracPrev = 0;
  private readonly fired: Record<OnsetKind, boolean> = { kick: false, snare: false, hat: false };

  private startTime = Number.NaN;
  private lastTime = Number.NaN;
  private silentFor = 0;
  private loudFor = 0;
  private lockedFor = 0;
  private unlockedFor = 0;
  private tempoDriftFor = 0;
  private lastSyncAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly config: LiveConfig,
    readonly sampleRate: number,
    readonly onsetFftSize: number,
    readonly bandsFftSize: number,
  ) {
    const fftSizeOnset = onsetFftSize;
    const fftSizeBands = bandsFftSize;
    const a = config.audio;
    this.features = new AudioFeatures(a, sampleRate, fftSizeBands);
    this.flux = new SpectralFlux(a, sampleRate, fftSizeOnset);
    this.onsets = new OnsetDetector(a, sampleRate, fftSizeOnset, a.gridHz);
    this.tempo = new TempoEstimator(config.beat, a.gridHz, a.gridSeconds);
    this.beat = new BeatClock(config.beat, config.sync, MACRO_BAND_IDS.length);
    this.grid = new AnalysisGrid(GRID_CHANNELS, a.gridHz, a.gridReanchorSec);
    this.section = new SectionEnergy(config.state);
    this.onsetSet = new OnsetView(this);
  }

  /** Un onset de ce type est-il tombe pendant la derniere trame ? */
  firedThisFrame(kind: OnsetKind): boolean {
    return this.fired[kind];
  }

  /** Derniere valeur d'`audioContext.currentTime` consommee. Meme base de temps que les onsets. */
  get audioTime(): number {
    return this.lastTime;
  }

  /**
   * Confiance de tempo REELLE. En tap tempo manuel (§4.5), l'operateur a
   * impose la grille : elle vaut 1, ce qui fait passer la machine a etats en
   * LOCKED et rend les frontieres de phrase de nouveau exploitables par le
   * director - c'est tout l'interet du filet de securite.
   */
  get effectiveConfidence(): number {
    return this.beat.manual ? 1 : this.tempo.confidence;
  }

  /** Audio present et au-dessus du plancher de bruit. */
  get audible(): boolean {
    return this.state === 'REACTIVE' || this.state === 'LOCKED';
  }

  step(input: LiveAnalysisInput): void {
    this.fired.kick = false;
    this.fired.snare = false;
    this.fired.hat = false;

    const { tAudio } = input;
    if (!Number.isFinite(this.startTime)) {
      this.startTime = tAudio;
      this.lastTime = tAudio;
      this.tSec = 0;
      return;
    }
    // Sur un ecran 144 Hz avec un quantum de 512 echantillons, deux trames
    // lisent le meme buffer : le flux serait nul et `dt` faux.
    if (this.grid.isStale(tAudio) || tAudio <= this.lastTime) {
      this.staleFrames++;
      return;
    }

    const raw = tAudio - this.lastTime;
    this.dt = Math.min(Math.max(raw, 0), this.config.state.dtClampSec);
    this.frameStart = this.lastTime;
    this.lastTime = tAudio;
    this.tSec = tAudio - this.startTime;

    const silent = this.updateSilence(input, this.dt);
    this.features.update(this.dt, input.freqBandsDb, input.timeDomain, !silent);
    this.updateState(this.dt, silent);

    this.beat.confidence = this.effectiveConfidence;
    this.beat.advance(this.dt, tAudio);
    this.beat.observe(this.features.macroDb);

    if (!silent) {
      // Le flux est INTEGRE sur la trame, donc il se REPARTIT sur les pas de
      // grille franchis au prorata du temps ; il ne s'interpole pas comme une
      // grandeur instantanee. Les deux canaux scalaires (platitude, enveloppe
      // grave) sont eux instantanes et passent bien par l'interpolation.
      //
      // Le prorata compte : repartir en parts EGALES quantifie l'instant de
      // l'attaque au pas de grille et fait passer l'erreur de phase RMS de
      // 5 ms a 14 ms.
      this.flux.accumulate(this.dt, input.freqOnsetDb);
      this.flux.take(this.fluxOut);
      this.fracPrev = 0;
      this.channels[CH_FLATNESS] = this.features.flatness;
      this.channels[CH_KICK_ENV] = this.flux.lowEnvelope(input.timeDomain);
      this.grid.push(tAudio, this.channels, this.onGridTick);
      // Reliquat de fin de trame : il ira au premier pas de la trame suivante.
      const rest = 1 - this.fracPrev;
      for (let c = 0; c < 3; c++) this.fluxCarry[c] = this.fluxCarry[c]! + rest * this.fluxOut[c]!;
    } else {
      this.onsets.clearEvents();
    }

    this.updateOnsetRate(this.dt);
    // La detection de sections lit les niveaux BRUTS, pre-AGC (§2.7.9).
    const barSec = this.beat.periodSec > 0 ? this.beat.periodSec * this.config.beat.beatsPerBar : 2;
    this.section.update(
      this.tSec,
      this.dt,
      this.features.macroDb,
      this.features.rmsDbfs,
      this.onsetRate,
      this.beat.barIndex,
      this.beat.barThisFrame,
      barSec,
    );

    this.detectTrackChange(this.dt, silent);
    this.maybeUpdateSync(input);
  }

  private updateOnsetRate(dt: number): void {
    let count = 0;
    if (this.fired.kick) count++;
    if (this.fired.snare) count++;
    if (this.fired.hat) count++;
    // Lissage sur ~1,5 s : assez court pour distinguer un breakdown d'un drop,
    // assez long pour ne pas suivre chaque croche.
    const a = 1 - Math.exp(-dt / 1.5);
    this.onsetRate += (count / Math.max(dt, 1e-4) - this.onsetRate) * a;
  }

  private readonly onGridTick = (tickTime: number, values: Float32Array): void => {
    const span = this.lastTime - this.frameStart;
    const frac = span > 0 ? Math.min(1, Math.max(0, (tickTime - this.frameStart) / span)) : 1;
    const slice = frac - this.fracPrev;
    this.fracPrev = frac;
    values[CH_KICK] = this.fluxCarry[0]! + slice * this.fluxOut[0]!;
    values[CH_SNARE] = this.fluxCarry[1]! + slice * this.fluxOut[1]!;
    values[CH_HAT] = this.fluxCarry[2]! + slice * this.fluxOut[2]!;
    this.fluxCarry[0] = 0;
    this.fluxCarry[1] = 0;
    this.fluxCarry[2] = 0;
    this.onsets.tick(tickTime, values, this.beat.periodSec, this.tempo.confidence);
    // Fonction de detection LARGE BANDE (§2.4) : une fonction kick-only echoue
    // sur tout le repertoire breakbeat / drum'n'bass. Voir `OnsetDetector.detection`
    // pour la raison de la normalisation par canal et de son ecretage.
    // Rien n'est pousse tant que les statistiques glissantes ne decrivent pas
    // le signal : la fenetre d'autocorrelation ne doit pas contenir de rodage.
    if (this.onsets.warmedUp) this.tempo.tick(tickTime, this.onsets.detection);

    if (this.tempo.changed && this.tempo.bpm > 0) this.beat.setTempo(this.tempo.bpm, tickTime);

    // En BOOT aucun onset n'est CONSOMME (§2.6) : la scene d'attente tourne
    // sur l'horloge reelle et rien ne doit flasher avant que l'audio soit
    // etabli. Leurs INSTANTS sont en revanche enregistres : ils alimentent
    // l'ajustement de periode par moindres carres, qui doit disposer d'assez
    // de points des la premiere adoption de tempo (vers t = 3,5 s). Les jeter
    // amputait l'historique de 1,5 s, soit 3 kicks a 128 BPM, et l'ajustement
    // ne se declenchait qu'a t = 4,4 s.
    const booting = this.state === 'BOOT';
    for (let i = 0; i < this.onsets.count; i++) {
      const e = this.onsets.at(i);
      if (booting) {
        if (e.kind === 'kick') this.beat.noteKickTime(e.tSec);
        continue;
      }
      this.fired[e.kind] = true;
      if (e.kind === 'kick') this.beat.onKick(e.tSec, e.strength, Math.max(this.tempo.confidence, 0.1));
      else if (e.kind === 'snare') this.beat.onSnare(e.strength);
    }
    if (booting) this.onsets.clearEvents();
  };

  /** Gate de silence : le seuil d'entree est plus bas que celui de sortie (hysteresis obligatoire). */
  private updateSilence(input: LiveAnalysisInput, dt: number): boolean {
    let sumSq = 0;
    for (let i = 0; i < input.timeDomain.length; i++) {
      const v = input.timeDomain[i] ?? 0;
      sumSq += v * v;
    }
    const rms = input.timeDomain.length > 0 ? Math.sqrt(sumSq / input.timeDomain.length) : 0;
    const dbfs = 20 * Math.log10(rms + 1e-9);
    const s = this.config.state;
    if (dbfs < s.idleEnterDbfs) {
      this.silentFor += dt;
      this.loudFor = 0;
    } else if (dbfs > s.idleExitDbfs) {
      this.loudFor += dt;
      this.silentFor = 0;
    }
    if (this.state === 'IDLE') return this.loudFor < s.idleExitSec;
    return this.silentFor >= s.idleEnterSec;
  }

  private updateState(dt: number, silent: boolean): void {
    const s = this.config.state;
    if (this.tSec < s.bootSec) {
      this.state = 'BOOT';
      return;
    }
    if (silent) {
      this.state = 'IDLE';
      this.lockedFor = 0;
      this.unlockedFor = 0;
      return;
    }
    const conf = this.effectiveConfidence;
    if (conf > s.lockedConfidence) {
      this.lockedFor += dt;
      this.unlockedFor = 0;
    } else if (conf < s.reactiveConfidence) {
      this.unlockedFor += dt;
      this.lockedFor = 0;
    }
    if (this.state === 'LOCKED') {
      // Un seuil unique a 0,4 ferait osciller le director d'un mode a l'autre,
      // ce qui est visuellement pire que l'un ou l'autre.
      if (this.unlockedFor >= s.lockedCrossSec) this.state = 'REACTIVE';
      return;
    }
    this.state = this.lockedFor >= s.lockedHoldSec ? 'LOCKED' : 'REACTIVE';
  }

  /** Silence long ou tempo candidat durablement decale => re-arm complet (§2.6). */
  private detectTrackChange(dt: number, silent: boolean): void {
    const s = this.config.state;
    if (silent && this.silentFor >= s.trackChangeSilenceSec) {
      this.reArm();
      this.silentFor = s.trackChangeSilenceSec;
      return;
    }
    const held = this.beat.bpm;
    const candidate = this.tempo.candidateBpm;
    // Une hesitation d'OCTAVE n'est pas un changement de morceau. Sans cette
    // exclusion, l'hysteresis d'octave (6 s) est plus longue que le delai de
    // changement de morceau (4 s) : un candidat a la moitie du tempo declenche
    // un re-arm complet avant meme d'avoir pu etre rejete, et le moteur
    // reperd son BPM toutes les 8 s. Reproduit a 174 BPM.
    const octaveRelated = held > 0 && candidate > 0 && isOctaveRelated(candidate, held);
    if (!octaveRelated && held > 0 && candidate > 0 && Math.abs(candidate - held) / held > s.trackChangeTempoRel) {
      this.tempoDriftFor += dt;
      if (this.tempoDriftFor >= s.trackChangeTempoSec) this.reArm();
    } else {
      this.tempoDriftFor = 0;
    }
  }

  private maybeUpdateSync(input: LiveAnalysisInput): void {
    if (input.tAudio - this.lastSyncAt < this.config.sync.latencyRecomputeSec) return;
    this.lastSyncAt = input.tAudio;
    this.beat.updateSync(input.audioAheadMs, input.frameIntervalSec, this.onsets.analyserDelay * 1000);
  }

  /**
   * Retour d'onglet. Aucun rattrapage : `dt` est deja clampe, et au-dela de
   * `hiddenReArmSec` d'absence l'etat accumule (fenetre d'autocorrelation,
   * blanchiment, AGC) ne decrit plus rien de reel.
   */
  onVisible(hiddenSec: number): void {
    this.lastTime = Number.NaN;
    this.startTime = Number.NaN;
    if (hiddenSec > this.config.state.hiddenReArmSec) this.reArm();
  }

  /** Changement de morceau : confiance a 0, fenetre videe, AGC au plancher. Le BPM n'est pas conserve. */
  reArm(): void {
    this.tempo.reArm();
    this.beat.reArm();
    this.beat.periodSec = 0;
    this.onsets.reset();
    this.features.reset();
    this.flux.reset();
    this.grid.reset();
    this.section.reset();
    this.onsetRate = 0;
    this.fluxCarry.fill(0);
    this.fluxOut.fill(0);
    this.fracPrev = 0;
    this.tempoDriftFor = 0;
    this.lockedFor = 0;
    this.unlockedFor = 0;
  }

  reset(): void {
    this.reArm();
    this.tempo.reset();
    this.beat.reset();
    this.state = 'BOOT';
    this.tSec = 0;
    this.dt = 0;
    this.staleFrames = 0;
    this.startTime = Number.NaN;
    this.lastTime = Number.NaN;
    this.silentFor = 0;
    this.loudFor = 0;
    this.lastSyncAt = Number.NEGATIVE_INFINITY;
  }
}
