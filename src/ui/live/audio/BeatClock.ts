/**
 * Horloge musicale (§2.5) : un oscillateur de phase verrouille sur les onsets,
 * qui PREDIT les temps au lieu de les subir. C'est ce qui separe un visuel
 * « qui reagit », toujours en retard et mou, d'un visuel « qui connait le
 * tempo », qui tombe pile.
 *
 * ---------------------------------------------------------------------------
 * CORRECTION DE SIGNE PAR RAPPORT AU PROMPT (§2.5) - verifiee par test
 * ---------------------------------------------------------------------------
 * Le prompt ecrit `phase += alphaEff * e`. Ce signe est inverse et fait
 * diverger le PLL, c'est-a-dire exactement le defaut contre lequel son propre
 * commentaire met en garde. Derivation :
 *
 *   - Un kick tombe alors que l'horloge est a `beatPhase = 0.05` : l'horloge a
 *     DEJA emis son temps il y a 0,05 temps, elle est EN AVANCE. `e = +0.05`.
 *     Il faut RETARDER l'horloge, donc DIMINUER la phase.
 *   - Un kick tombe a `beatPhase = 0.97` : le prochain temps de l'horloge est
 *     dans 0,03 temps, elle est EN RETARD. `e = 0.97 - 1 = -0.03`.
 *     Il faut AVANCER la phase.
 *
 * Dans les deux cas la correction est `phase -= alphaEff * e`.
 *
 * Le signe de la correction de PERIODE du prompt est en revanche correct :
 * une horloge systematiquement en avance (`e > 0`) tourne trop vite, sa
 * periode doit augmenter, ce que donne `period *= (1 + beta * e)`.
 *
 * ---------------------------------------------------------------------------
 * CONVENTION DE SYNCHRONISATION - a lire avant de toucher `syncOffsetMs`
 * ---------------------------------------------------------------------------
 *   tMusical = tFrame + syncOffsetMs / 1000
 *   syncOffsetMs POSITIF  =>  le visuel tombe EN AVANCE.
 *
 * L'`AnalyserNode` est branche avant la destination : il voit les echantillons
 * `baseLatency + outputLatency` AVANT que l'auditeur ne les entende. L'analyse
 * est donc en avance sur l'oreille, pas en retard - le raisonnement
 * « -45 ms compense la latence » est faux, et le signe l'est aussi des qu'on
 * sort du filaire.
 *
 * Voir NOTES.md (ecart n°2) pour la double compensation du retard de groupe,
 * neutralisee ici par `sync.onsetBackdatingApplied`.
 *
 * Classe pure : le temps est toujours un parametre.
 */

import type { LiveBeatConfig, LiveSyncConfig } from '../LiveConfig';

export interface BeatClockState {
  readonly bpm: number;
  readonly periodSec: number;
  /** Phase BRUTE de l'horloge. C'est elle que corrige le PLL. */
  readonly beatPhase: number;
  readonly barPhase: number;
  readonly phrasePhase: number;
  readonly beatIndex: number;
  readonly barIndex: number;
  readonly phraseIndex: number;
  readonly confidence: number;
  readonly downbeatConfidence: number;
  /**
   * Phase de temps decalee de `syncOffsetMs` : c'est CELLE-CI que doit lire le
   * rendu (§2.5). Lire `beatPhase` ferait tomber le visuel a l'instant ou
   * l'analyse voit le son, pas a l'instant ou l'auditeur l'entend.
   */
  readonly visualBeatPhase: number;
  readonly visualBarPhase: number;
  /** La phrase existe-t-elle ? Faux tant que le downbeat n'est pas fiable (§2.5). */
  readonly phraseValid: boolean;
}

/** Decomposition de `syncOffsetMs`, affichee au HUD pour que le calcul soit verifiable. */
export interface SyncBreakdown {
  readonly analyserDelayMs: number;
  readonly pickLookaheadMs: number;
  readonly presentDelayMs: number;
  readonly audioAheadMs: number;
  readonly userTrimMs: number;
  readonly totalMs: number;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

function wrap01(x: number): number {
  const w = x - Math.floor(x);
  return w < 0 ? w + 1 : w;
}

export class BeatClock implements BeatClockState {
  periodSec = 0;
  beatIndex = 0;
  confidence = 0;
  downbeatConfidence = 0;

  /** Nombre de temps emis pendant la derniere trame (0 ou plus). */
  beatsThisFrame = 0;
  /** Une frontiere de mesure est tombee pendant la derniere trame. */
  barThisFrame = false;
  /** Une frontiere de phrase est tombee pendant la derniere trame. */
  phraseThisFrame = false;
  /** `true` si l'hypothese de downbeat vient de changer. */
  downbeatChangedThisFrame = false;
  /** Compteurs de diagnostic, affiches au HUD (§4.6). */
  acceptedKicks = 0;
  rejectedKicks = 0;
  hardResyncs = 0;
  /** Derniere erreur de phase acceptee, en fraction de temps. */
  lastPhaseError = 0;
  /** Diagnostic de l'ajustement de periode : nombre de points retenus, residu RMS, periode ajustee (0 = rejete). */
  fitPoints = 0;
  fitResidual = 0;
  fittedPeriod = 0;

  private phase = 0;
  private phaseAcquired = false;
  private hardMisses = 0;
  /**
   * Mode verite (ADR-012) : periode et ancre de phase imposees par le canal
   * PMDI de l'hote via `setTruthGrid`. Meme famille que `manualTempo` (tap) :
   * le PLL est suspendu, pas detruit - il continue d'accumuler l'historique
   * de kicks et reprend sans a-coup au `clearTruth()`. Priorite :
   * operateur (tap) > verite (hote) > PLL.
   */
  private truthMode = false;
  /**
   * Correction de phase restant a appliquer, en temps. TOUTE correction passe
   * par ce tampon et est etalee sur plusieurs trames, bornee a
   * `resyncMaxJumpMs` par trame.
   *
   * Un `phase = cible` instantane produit un a-coup visible : mesure de 225 ms
   * sur une rampe 120 -> 128 BPM, la ou le critere §8.4 impose 20 ms par
   * trame. Meme une correction ordinaire du PLL (`alpha * e` borne a 0,024
   * temps) vaut 24 ms a 60 BPM, donc au-dessus du critere. Le glissement rend
   * la borne structurelle au lieu d'etre une coincidence de reglage.
   */
  private pendingPhaseShift = 0;
  private rampFrom = 0;
  private rampTo = 0;
  private rampStart = Number.NEGATIVE_INFINITY;
  private rampEnd = Number.NEGATIVE_INFINITY;
  private nowTime = 0;

  // Vote de downbeat (§2.5). Un accumulateur par position dans la mesure.
  private readonly snareAcc: Float32Array;
  private readonly kickAcc: Float32Array;
  private readonly noveltyAcc: Float32Array;
  private readonly bassJumpAcc: Float32Array;
  private readonly totals: Float32Array;
  /** Quatre tampons distincts : les quatre indices sont combines dans la MEME boucle, un scratch partage les ecraserait. */
  private readonly normSnare: Float32Array;
  private readonly normKick: Float32Array;
  private readonly normNovelty: Float32Array;
  private readonly normBass: Float32Array;
  private readonly rotateScratch: Float32Array;
  private readonly beatMacroSum: Float32Array;
  private readonly prevBeatMacro: Float32Array;
  private beatMacroCount = 0;
  private beatSnare = 0;
  private beatKick = 0;
  private prevBeatMacroValid = false;
  private downbeatOffset = 0;
  private downbeatChallenger = -1;
  private downbeatChallengerBars = 0;
  private lastFrameIntervalSec = 1 / 60;

  /**
   * Ajustement de periode par MOINDRES CARRES sur les instants de kicks
   * acceptes, en complement du terme `beta * e` du PLL.
   *
   * Le PLL corrige la periode de `beta * e` par temps, soit une constante de
   * temps de l'ordre de 20 temps : il ne peut pas atteindre la precision
   * demandee en 4 s. L'autocorrelation non plus - sur 3,5 s de signal gigue a
   * 2 %, son erreur mesuree est de 0,5 a 0,7 BPM. Une droite ajustee sur les
   * instants d'onsets exploite en revanche toute la portee de la fenetre :
   * pour N onsets d'ecart-type sigma, `sigma_T = sigma * sqrt(12/(N(N^2-1)))`,
   * soit 0,23 BPM a 128 BPM avec 8 onsets sur 3,5 s.
   */
  private readonly kickTimes = new Float64Array(64);
  private kickCount = 0;
  /** Tap tempo : quatre frappes suffisent (§4.5). */
  private readonly tapTimes = new Float64Array(4);
  private tapCount = 0;
  private manualTempo = false;
  private readonly fitIndex = new Float64Array(64);
  private readonly fitTime = new Float64Array(64);

  private syncMs: SyncBreakdown = {
    analyserDelayMs: 0,
    pickLookaheadMs: 0,
    presentDelayMs: 0,
    audioAheadMs: 0,
    userTrimMs: 0,
    totalMs: 0,
  };

  constructor(
    private readonly config: LiveBeatConfig,
    private syncConfig: LiveSyncConfig,
    private readonly macroCount: number,
  ) {
    const n = config.beatsPerBar;
    this.snareAcc = new Float32Array(n);
    this.kickAcc = new Float32Array(n);
    this.noveltyAcc = new Float32Array(n);
    this.bassJumpAcc = new Float32Array(n);
    this.totals = new Float32Array(n);
    this.normSnare = new Float32Array(n);
    this.normKick = new Float32Array(n);
    this.normNovelty = new Float32Array(n);
    this.normBass = new Float32Array(n);
    this.rotateScratch = new Float32Array(n);
    this.beatMacroSum = new Float32Array(macroCount);
    this.prevBeatMacro = new Float32Array(macroCount);
  }

  get bpm(): number {
    return this.periodSec > 0 ? 60 / this.periodSec : 0;
  }

  get beatPhase(): number {
    return this.phase;
  }

  private get barPosition(): number {
    const n = this.config.beatsPerBar;
    return (((this.beatIndex - this.downbeatOffset) % n) + n) % n;
  }

  get barPhase(): number {
    return (this.barPosition + this.phase) / this.config.beatsPerBar;
  }

  get barIndex(): number {
    return Math.floor((this.beatIndex - this.downbeatOffset) / this.config.beatsPerBar);
  }

  get phrasePhase(): number {
    const n = this.config.barsPerPhrase;
    const pos = ((this.barIndex % n) + n) % n;
    return (pos + this.barPhase - Math.floor(this.barPhase)) / n;
  }

  get phraseIndex(): number {
    return Math.floor(this.barIndex / this.config.barsPerPhrase);
  }

  /** La phrase n'existe pas tant que le downbeat n'est pas fiable (§2.5, dernier paragraphe). */
  get phraseValid(): boolean {
    return this.downbeatConfidence >= this.config.downbeatPhraseThreshold;
  }

  get sync(): SyncBreakdown {
    return this.syncMs;
  }

  /** Phase de temps a utiliser pour le RENDU : decalee de `syncOffsetMs` (§2.5). */
  get visualBeatPhase(): number {
    if (this.periodSec <= 0) return 0;
    return wrap01(this.phase + this.syncMs.totalMs / 1000 / this.periodSec);
  }

  get visualBarPhase(): number {
    if (this.periodSec <= 0) return 0;
    const shift = this.syncMs.totalMs / 1000 / this.periodSec / this.config.beatsPerBar;
    return wrap01(this.barPhase + shift);
  }

  /**
   * Avance de phase d'une trame. Le `while` est BORNE : il survit a une trame
   * de 500 ms apres un throttling d'onglet sans emettre 30 temps d'un coup.
   * `beatIndex` n'est JAMAIS decremente - sinon `onBeat` se declencherait deux
   * fois pour le meme index apres une correction negative.
   */
  advance(dt: number, nowTime: number): void {
    this.nowTime = nowTime;
    this.beatsThisFrame = 0;
    this.barThisFrame = false;
    this.phraseThisFrame = false;
    this.downbeatChangedThisFrame = false;
    if (this.periodSec <= 0) return;

    this.applyTempoRamp(nowTime);
    this.applyPhaseSlew();

    this.phase += Math.min(dt, this.config.phaseAdvanceClampSec) / this.periodSec;
    let guard = 0;
    while (this.phase >= 1 && guard++ < this.config.maxBeatsPerFrame) {
      this.phase -= 1;
      this.closeBeat();
      this.beatIndex++;
      this.beatsThisFrame++;
      if (this.barPosition === 0) {
        this.barThisFrame = true;
        this.closeBar();
        if (this.phraseValid && this.barIndex % this.config.barsPerPhrase === 0) this.phraseThisFrame = true;
      }
    }
    if (this.phase >= 1) this.phase = 0;
  }

  /** Alimente le temps courant : moyenne des macro-bandes, pour l'indice de nouveaute de mesure. */
  observe(macroDb: Float32Array): void {
    for (let i = 0; i < this.macroCount; i++) this.beatMacroSum[i] = this.beatMacroSum[i]! + (macroDb[i] ?? 0);
    this.beatMacroCount++;
  }

  /** Onset kick accepte : PLL + accumulateur de vote. */
  onKick(onsetTime: number, strength: number, tempoConfidence: number): void {
    this.beatKick += strength;
    this.noteKickTime(onsetTime);
    // Mode verite : l'horloge est ancree sur la grille de l'hote, aucun onset
    // detecte ne la corrige. L'historique de kicks continue de s'accumuler
    // (ci-dessus) pour que le PLL reprenne arme au `clearTruth()`.
    if (this.truthMode) return;
    if (this.periodSec <= 0) return;

    const elapsedBeats = (this.nowTime - onsetTime) / this.periodSec;
    // Position NON repliee : `beatIndex` ne decroit jamais, donc `beatPos` est
    // monotone et son arrondi identifie sans ambiguite le temps vise.
    const beatPos = this.beatIndex + this.phase - elapsedBeats;
    const onsetPhase = wrap01(this.phase - elapsedBeats);
    // Erreur de phase CIRCULAIRE : un kick a 0.97 est 3 % en avance, pas 97 %
    // en retard. Une difference brute donnerait une correction de signe oppose.
    const e = onsetPhase - Math.round(onsetPhase);

    // ACQUISITION. Quand une periode vient d'etre adoptee, la phase, elle, n'a
    // aucune raison d'etre bonne : elle vaut ce qu'elle valait. Sans ce
    // court-circuit, le premier kick tombe presque toujours hors de la fenetre
    // d'acceptation et n'est jamais consomme.
    //
    // Mesure a 174 BPM sans acquisition : erreur stationnaire de -0,18 temps,
    // donc AU-DESSUS de `pllAcceptPhase` (0,12) mais EN DESSOUS de
    // `hardResyncPhaseErr` (0,25). Le PLL rejetait les 77 kicks du signal, ne
    // declenchait jamais de resynchronisation dure, et restait bloque a
    // -62,6 ms indefiniment.
    if (!this.phaseAcquired) {
      this.phaseAcquired = true;
      this.hardMisses = 0;
      this.acceptedKicks++;
      this.requestPhase(wrap01(elapsedBeats));
      this.lastPhaseError = 0;
      return;
    }

    if (Math.abs(e) > this.config.pllAcceptPhase) {
      // Syncope / ghost note : ignore pour la correction. Le prompt ne compte
      // que |e| > 0.25 vers la resynchronisation dure ; on compte TOUTE
      // rejection consecutive, sinon la zone morte 0,12-0,25 est un
      // interblocage (voir ci-dessus). Le compteur est remis a zero des qu'un
      // kick est accepte, donc une horloge correctement verrouillee ne
      // resynchronise jamais.
      this.rejectedKicks++;
      this.hardMisses++;
      if (this.hardMisses >= this.config.hardResyncMisses) this.hardResync(onsetTime);
      return;
    }
    this.hardMisses = 0;
    this.acceptedKicks++;
    this.lastPhaseError = e;

    const magnitude = Math.abs(e) > 1e-6 ? Math.abs(e) : 1e-6;
    const alphaEff = Math.min(this.config.pllAlpha * strength * tempoConfidence, this.config.pllMaxCorrection / magnitude);
    // Voir l'en-tete : signe corrige par rapport au prompt. La correction est
    // mise en attente, pas appliquee seche (voir `pendingPhaseShift`).
    this.pendingPhaseShift -= alphaEff * e;

    if (this.rampEnd <= this.nowTime) {
      const fitted = this.fitPeriod(this.periodSec);
      // `beta * e` reste la correction par defaut (§2.5) ; l'ajustement par
      // moindres carres ne prend le relais que quand il a assez de points.
      const target = fitted > 0 ? fitted : this.periodSec * (1 + this.config.pllBeta * e);
      const maxStep = this.periodSec * this.config.periodMaxRelStep;
      const bounded = clamp(target, this.periodSec - maxStep, this.periodSec + maxStep);
      this.periodSec = clamp(bounded, this.config.periodMinSec, this.config.periodMaxSec);
    }
  }

  /**
   * Historique des instants de kick, TOUS retenus (acceptes ou non par le
   * PLL) : c'est ce qui permet d'ajuster la periode des la toute premiere
   * adoption de tempo, sans attendre que l'horloge ait accumule des temps.
   */
  noteKickTime(onsetTime: number): void {
    const cutoff = onsetTime - this.config.periodFitWindowSec;
    let write = 0;
    for (let i = 0; i < this.kickCount; i++) {
      if (this.kickTimes[i]! >= cutoff) this.kickTimes[write++] = this.kickTimes[i]!;
    }
    this.kickCount = write;
    if (this.kickCount >= this.kickTimes.length) {
      for (let i = 1; i < this.kickCount; i++) this.kickTimes[i - 1] = this.kickTimes[i]!;
      this.kickCount--;
    }
    this.kickTimes[this.kickCount++] = onsetTime;
  }

  /**
   * Periode ajustee par moindres carres sur l'historique de kicks, indexe par
   * `guess`. Retourne 0 si l'ajustement n'est pas exploitable.
   *
   * Indexer avec une estimation a 0,4 % pres sur 3,5 s (7,5 temps) accumule
   * 3 % de temps d'erreur, tres en dessous du seuil de rejet de 0,25 : le
   * chainage est sur.
   */
  private fitPeriod(guess: number): number {
    this.fitPoints = 0;
    this.fitResidual = 0;
    this.fittedPeriod = 0;
    if (guess <= 0 || this.kickCount < this.config.periodFitMinPoints) return 0;
    const ref = this.kickTimes[this.kickCount - 1]!;
    let n = 0;
    for (let i = 0; i < this.kickCount; i++) {
      const x = (this.kickTimes[i]! - ref) / guess;
      const idx = Math.round(x);
      // Hors grille : syncope, ghost note, ou frappe d'un autre niveau
      // metrique. Elle fausserait la pente, on l'ecarte.
      if (Math.abs(x - idx) > 0.25) continue;
      this.fitIndex[n] = idx;
      this.fitTime[n] = this.kickTimes[i]!;
      n++;
    }
    this.fitPoints = n;
    if (n < this.config.periodFitMinPoints) return 0;

    // Deux passes : la seconde ecarte les points aberrants de la premiere.
    // Un onset mal date - typiquement les premiers, quand le blanchiment n'a
    // pas fini de converger - suffit a incliner la droite de 1,3 % (mesure :
    // 129,7 BPM au lieu de 128,0, residu RMS 0,040 contre 0,008 une fois le
    // point sorti de la fenetre).
    let fitted = this.solveSlope(n);
    if (fitted <= 0) return 0;
    n = this.rejectOutliers(n, fitted);
    if (n < this.config.periodFitMinPoints) return 0;
    fitted = this.solveSlope(n);
    if (fitted <= 0 || Math.abs(fitted - guess) / guess > 0.1) return 0;

    this.fitPoints = n;
    this.fitResidual = this.residualRms(n, fitted);
    // Garde-fou final : si l'ajustement ne decrit toujours pas une grille, on
    // le jette et on laisse le terme `beta * e` du PLL faire son travail.
    if (this.fitResidual > this.config.periodFitMaxResidual) return 0;
    this.fittedPeriod = fitted;
    return fitted;
  }

  /** Pente des moindres carres sur les `n` premiers points de `fitIndex`/`fitTime`. */
  private solveSlope(n: number): number {
    let meanN = 0;
    let meanT = 0;
    for (let i = 0; i < n; i++) {
      meanN += this.fitIndex[i]!;
      meanT += this.fitTime[i]!;
    }
    meanN /= n;
    meanT /= n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const dn = this.fitIndex[i]! - meanN;
      num += dn * (this.fitTime[i]! - meanT);
      den += dn * dn;
    }
    return den > 1e-9 ? num / den : 0;
  }

  private intercept(n: number, slope: number): number {
    let meanN = 0;
    let meanT = 0;
    for (let i = 0; i < n; i++) {
      meanN += this.fitIndex[i]!;
      meanT += this.fitTime[i]!;
    }
    return meanT / n - (meanN / n) * slope;
  }

  private residualRms(n: number, slope: number): number {
    const t0 = this.intercept(n, slope);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const d = (this.fitTime[i]! - (t0 + this.fitIndex[i]! * slope)) / slope;
      acc += d * d;
    }
    return Math.sqrt(acc / n);
  }

  /** Compacte `fitIndex`/`fitTime` en ecartant les points a plus de 2,5 ecarts du modele. */
  private rejectOutliers(n: number, slope: number): number {
    const t0 = this.intercept(n, slope);
    // Seuil ABSOLU, pas un multiple du RMS : un point aberrant gonfle
    // justement le RMS, et « 2,5 sigma » ne le rejette alors jamais. Mesure a
    // 128 BPM gigue 2 % : RMS de 0,040 temps avec le point fautif, seuil
    // 2,5 sigma a 0,099, aucun rejet. Un onset a plus de 4 % de temps de la
    // grille n'est simplement pas sur la grille.
    const limit = this.config.periodFitMaxResidual * 2;
    let write = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs((this.fitTime[i]! - (t0 + this.fitIndex[i]! * slope)) / slope);
      if (d > limit) continue;
      this.fitIndex[write] = this.fitIndex[i]!;
      this.fitTime[write] = this.fitTime[i]!;
      write++;
    }
    return write;
  }

  /** Onset snare/clap : indice principal du vote de downbeat (backbeat). */
  onSnare(strength: number): void {
    this.beatSnare += strength;
  }

  /**
   * Adoption d'un tempo venu de `TempoEstimator`. Changement < 5 % : rampe de
   * periode sur 2 s. >= 5 % : reset dur - une rampe de 2 s sur un changement
   * de morceau laisserait 2 s de visuel a un tempo qui n'existe plus.
   */
  /**
   * TAP TEMPO (§4.5). Quatre frappes imposent le BPM ET la phase.
   *
   * C'est le filet de securite pour la musique live sans grille : quand la
   * detection echoue - batterie acoustique, tempo libre, morceau sans kick -
   * l'operateur reprend la main. `confidence` est forcee a 1 tant que le mode
   * manuel dure, ce qui fait passer la machine a etats en LOCKED et rend les
   * frontieres de phrase de nouveau utilisables.
   */
  tap(tSec: number): void {
    // Une frappe isolee tres eloignee recommence une serie : deux taps a 6 s
    // d'intervalle ne decrivent pas un tempo de 10 BPM, ils decrivent un
    // operateur qui a hesite.
    const last = this.tapTimes[this.tapCount - 1];
    if (last !== undefined && tSec - last > this.config.periodMaxSec * 2) this.tapCount = 0;

    if (this.tapCount >= this.tapTimes.length) {
      for (let i = 1; i < this.tapTimes.length; i++) this.tapTimes[i - 1] = this.tapTimes[i]!;
      this.tapCount = this.tapTimes.length - 1;
    }
    this.tapTimes[this.tapCount++] = tSec;
    if (this.tapCount < this.tapTimes.length) return;

    let sum = 0;
    for (let i = 1; i < this.tapCount; i++) sum += this.tapTimes[i]! - this.tapTimes[i - 1]!;
    const period = sum / (this.tapCount - 1);
    if (!(period > 0)) return;

    this.periodSec = clamp(period, this.config.periodMinSec, this.config.periodMaxSec);
    this.manualTempo = true;
    this.rampEnd = Number.NEGATIVE_INFINITY;
    this.kickCount = 0;
    this.hardMisses = 0;
    this.phaseAcquired = true;
    this.pendingPhaseShift = 0;
    // La derniere frappe EST un temps : la phase est l'ecart ecoule depuis.
    this.phase = wrap01((this.nowTime - tSec) / this.periodSec);
  }

  /** Retour au suivi automatique (touche `A`, §4.5). */
  releaseManual(): void {
    this.manualTempo = false;
    this.tapCount = 0;
  }

  /** Le tempo est-il impose a la main ? */
  get manual(): boolean {
    return this.manualTempo;
  }

  /** L'horloge est-elle pilotee par le canal de verite (ADR-012) ? */
  get truthActive(): boolean {
    return this.truthMode;
  }

  /**
   * Grille imposee par le canal de verite (ADR-012). `beatAnchorLocal` est
   * l'instant LOCAL d'un temps de la grille hote, deja aligne par
   * `ClockAligner` (`tBeat + offset`).
   *
   * Appelee a CHAQUE trame tant que la verite a autorite : la cible de phase
   * passe par `requestPhase`, donc par le glissement borne a
   * `resyncMaxJumpMs` par trame - jamais de saut sec, ni a l'activation ni
   * sur une derive d'offset. Seule exception : la toute premiere adoption
   * quand l'horloge n'a encore AUCUNE periode (`periodSec <= 0`), ou la phase
   * est posee directement, exactement comme le tap tempo - il n'y a rien a
   * preserver.
   *
   * Le tap tempo manuel garde la main : operateur > hote.
   */
  setTruthGrid(periodSec: number, beatAnchorLocal: number, nowTime: number): void {
    if (this.manualTempo) return;
    if (!(periodSec > 0) || !Number.isFinite(beatAnchorLocal) || !Number.isFinite(nowTime)) return;
    const p = clamp(periodSec, this.config.periodMinSec, this.config.periodMaxSec);
    this.truthMode = true;
    this.rampEnd = Number.NEGATIVE_INFINITY;
    this.nowTime = nowTime;
    if (this.periodSec <= 0) {
      this.periodSec = p;
      this.phase = wrap01((nowTime - beatAnchorLocal) / p);
      this.pendingPhaseShift = 0;
    } else {
      this.periodSec = p;
      this.requestPhase(wrap01((nowTime - beatAnchorLocal) / p));
    }
    this.phaseAcquired = true;
    this.hardMisses = 0;
  }

  /**
   * Ancre le downbeat sur un instant LOCAL annonce par l'hote (deja aligne).
   * Ne fait rien tant que l'instant vise reste sur la position 0 courante -
   * l'appel est donc idempotent trame apres trame.
   */
  truthDownbeatAt(tLocalDownbeat: number): void {
    if (!this.truthMode || this.periodSec <= 0 || !Number.isFinite(tLocalDownbeat)) return;
    const beatsAgo = (this.nowTime - tLocalDownbeat) / this.periodSec;
    const k = Math.round(this.beatIndex + this.phase - beatsAgo);
    const n = this.config.beatsPerBar;
    const desired = ((k % n) + n) % n;
    const delta = (((desired - this.downbeatOffset) % n) + n) % n;
    if (delta !== 0) this.shiftDownbeat(delta);
    this.downbeatConfidence = 1;
  }

  /**
   * Fin de l'autorite de la verite (canal muet, desalignement, reset). Periode
   * et phase sont CONSERVEES : le PLL reprend de la ou la verite l'a laisse,
   * et la bascule reste bornee par le glissement comme toute correction.
   */
  clearTruth(): void {
    this.truthMode = false;
  }

  setTempo(bpm: number, nowTime: number): void {
    // En mode manuel ou verite, l'estimateur n'a plus la main : c'est tout l'interet.
    if (this.manualTempo || this.truthMode) return;
    if (!(bpm > 0)) return;
    const guess = clamp(60 / bpm, this.config.periodMinSec, this.config.periodMaxSec);
    // Affinage immediat sur l'historique de kicks. Sans lui, la periode a
    // t = 4 s vaut exactement celle de l'autocorrelation, dont l'erreur
    // mesuree sur 3,5 s de signal gigue a 2 % est de 0,5 a 0,7 BPM.
    const fitted = this.fitPeriod(guess);
    const target = fitted > 0 ? fitted : guess;
    if (this.periodSec <= 0) {
      this.periodSec = target;
      return;
    }
    const rel = Math.abs(target - this.periodSec) / this.periodSec;
    if (rel < 1e-6) return;
    // Changement < 5 % : rampe de 2 s. >= 5 % : rampe COURTE plutot qu'une
    // affectation seche.
    //
    // Le prompt demande un « reset dur » au-dela de 5 %, pour ne pas laisser
    // 2 s de visuel a un tempo qui n'existe plus. Mais l'ancre de temps vaut
    // `t - phase * periode` : changer la periode de 6,4 % d'un coup la
    // deplace de `phase * dPeriode`, soit jusqu'a 28 ms mesures sur la rampe
    // 120 -> 128 BPM, au-dessus du critere §8.4 de 20 ms par trame. Une rampe
    // de 0,3 s ramene le deplacement a 1,5 ms par trame et reste dix fois plus
    // courte que la duree que le prompt cherchait a eviter.
    //
    // Un VRAI changement de morceau ne passe pas par ici : il declenche
    // `reArm()` dans `LiveAnalysisEngine`, qui remet la periode a zero.
    // Rampe courte aussi tant que la confiance est basse : sinon l'horloge
    // traine 2 s derriere un estimateur qui vient tout juste de se corriger,
    // et le BPM a t = 4 s reflete encore l'hypothese initiale.
    const short = rel >= this.config.tempoHardResetRel || this.confidence < this.config.tempoAdoptGuardConfidence;
    this.rampFrom = this.periodSec;
    this.rampTo = target;
    this.rampStart = nowTime;
    this.rampEnd = nowTime + (short ? this.config.tempoHardResetRampSec : this.config.tempoRampSec);
    if (rel >= this.config.tempoHardResetRel) {
      this.hardMisses = 0;
      // Les points d'ajustement ont ete indexes sur l'ancienne periode.
      this.kickCount = 0;
    }
  }

  /** Applique au plus `resyncMaxJumpMs` de correction de phase par trame. */
  private applyPhaseSlew(): void {
    if (this.pendingPhaseShift === 0 || this.periodSec <= 0) return;
    const maxBeats = this.config.resyncMaxJumpMs / 1000 / this.periodSec;
    const step = clamp(this.pendingPhaseShift, -maxBeats, maxBeats);
    this.pendingPhaseShift -= step;
    if (Math.abs(this.pendingPhaseShift) < 1e-6) this.pendingPhaseShift = 0;
    this.phase += step;
    // MUST : jamais de decrement de `beatIndex`. Le reliquat reste en attente
    // et s'appliquera aux trames suivantes, quand la phase aura avance.
    if (this.phase < 0) {
      this.pendingPhaseShift += this.phase;
      this.phase = 0;
    }
  }

  private applyTempoRamp(nowTime: number): void {
    if (nowTime >= this.rampEnd) return;
    const span = this.rampEnd - this.rampStart;
    const k = span > 0 ? clamp01((nowTime - this.rampStart) / span) : 1;
    this.periodSec = this.rampFrom + (this.rampTo - this.rampFrom) * k;
  }

  private hardResync(onsetTime: number): void {
    this.hardMisses = 0;
    this.hardResyncs++;
    this.rampEnd = Number.NEGATIVE_INFINITY;
    if (this.periodSec <= 0) return;
    // Le dernier onset EST le temps : on vise la phase telle que l'instant
    // `onsetTime` corresponde a phase 0. Vise, pas impose - le glissement.
    this.requestPhase(wrap01((this.nowTime - onsetTime) / this.periodSec));
  }

  /** Demande une phase cible par le chemin circulaire le plus court. */
  private requestPhase(target: number): void {
    let delta = target - (this.phase + this.pendingPhaseShift);
    delta -= Math.round(delta);
    this.pendingPhaseShift += delta;
  }

  private closeBeat(): void {
    const pos = this.barPosition;
    const alpha = 1 / Math.max(1, this.config.downbeatEmaBars * this.config.beatsPerBar);

    this.snareAcc[pos] = this.snareAcc[pos]! + alpha * (this.beatSnare - this.snareAcc[pos]!);
    this.kickAcc[pos] = this.kickAcc[pos]! + alpha * (this.beatKick - this.kickAcc[pos]!);

    let novelty = 0;
    let bassJump = 0;
    if (this.beatMacroCount > 0) {
      for (let i = 0; i < this.macroCount; i++) this.beatMacroSum[i] = this.beatMacroSum[i]! / this.beatMacroCount;
      if (this.prevBeatMacroValid) {
        novelty = 1 - cosineSimilarity(this.beatMacroSum, this.prevBeatMacro);
        // Macro-bandes 0 et 1 = sub et bass : leur entree marque la mesure.
        const now = (this.beatMacroSum[0] ?? 0) + (this.beatMacroSum[1] ?? 0);
        const before = (this.prevBeatMacro[0] ?? 0) + (this.prevBeatMacro[1] ?? 0);
        bassJump = Math.max(0, now - before);
      }
      this.prevBeatMacro.set(this.beatMacroSum);
      this.prevBeatMacroValid = true;
    }
    this.noveltyAcc[pos] = this.noveltyAcc[pos]! + alpha * (novelty - this.noveltyAcc[pos]!);
    this.bassJumpAcc[pos] = this.bassJumpAcc[pos]! + alpha * (bassJump - this.bassJumpAcc[pos]!);

    this.beatMacroSum.fill(0);
    this.beatMacroCount = 0;
    this.beatSnare = 0;
    this.beatKick = 0;
  }

  /**
   * Vote de downbeat a quatre indices (§2.5). Surtout PAS « le temps qui a le
   * plus d'energie kick » : en house/techno le kick est four-on-the-floor, les
   * 4 temps portent la meme energie, l'argmax est du bruit et le downbeat
   * bascule aleatoirement toutes les quelques mesures.
   */
  private closeBar(): void {
    // Mode verite : le downbeat vient de l'hote (`truthDownbeatAt`), le vote
    // n'a pas voix au chapitre. Ses accumulateurs continuent de se remplir
    // (`closeBeat`), donc il reprend arme au retour du mode automatique.
    if (this.truthMode) {
      this.downbeatConfidence = 1;
      this.downbeatChallenger = -1;
      this.downbeatChallengerBars = 0;
      return;
    }
    const n = this.config.beatsPerBar;
    const snare = normalizeInto(this.snareAcc, this.normSnare, n);
    const kick = normalizeInto(this.kickAcc, this.normKick, n);
    const novelty = normalizeInto(this.noveltyAcc, this.normNovelty, n);
    const bass = normalizeInto(this.bassJumpAcc, this.normBass, n);

    let best = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    let second = Number.NEGATIVE_INFINITY;
    for (let d = 0; d < n; d++) {
      // Backbeat : les deux maxima de snare sont les temps 2 et 4, donc les
      // positions d+1 et d+3 relatives au downbeat candidat.
      const backbeat = (snare[(d + 1) % n] ?? 0) + (snare[(d + n - 1) % n] ?? 0);
      const score =
        this.config.downbeatWeightBackbeat * backbeat +
        this.config.downbeatWeightNovelty * (novelty[d] ?? 0) +
        this.config.downbeatWeightBassJump * (bass[d] ?? 0) +
        this.config.downbeatWeightKick * (kick[d] ?? 0);
      this.totals[d] = score;
      if (score > bestScore) {
        second = bestScore;
        bestScore = score;
        best = d;
      } else if (score > second) {
        second = score;
      }
    }

    this.downbeatConfidence = bestScore > 0 ? clamp01((bestScore - second) / bestScore) : 0;

    // Le downbeat courant est la position 0 par construction (barPosition), on
    // compare donc `best` a 0 dans le referentiel courant.
    if (best === 0) {
      this.downbeatChallenger = -1;
      this.downbeatChallengerBars = 0;
      return;
    }
    const currentScore = this.totals[0] ?? 0;
    if (bestScore < currentScore * this.config.downbeatSwitchDominance) {
      this.downbeatChallenger = -1;
      this.downbeatChallengerBars = 0;
      return;
    }
    if (this.downbeatChallenger !== best) {
      this.downbeatChallenger = best;
      this.downbeatChallengerBars = 1;
      return;
    }
    this.downbeatChallengerBars++;
    if (this.downbeatChallengerBars < this.config.downbeatSwitchHoldBars) return;

    this.shiftDownbeat(best);
  }

  /** Deplace l'origine de mesure de `delta` temps, en faisant tourner les accumulateurs avec elle. */
  private shiftDownbeat(delta: number): void {
    const n = this.config.beatsPerBar;
    this.downbeatOffset = (((this.downbeatOffset + delta) % n) + n) % n;
    rotate(this.snareAcc, this.rotateScratch, n, delta);
    rotate(this.kickAcc, this.rotateScratch, n, delta);
    rotate(this.noveltyAcc, this.rotateScratch, n, delta);
    rotate(this.bassJumpAcc, this.rotateScratch, n, delta);
    this.downbeatChallenger = -1;
    this.downbeatChallengerBars = 0;
    this.downbeatChangedThisFrame = true;
  }

  /**
   * `syncOffsetMs`, recalcule une fois par seconde par le moteur.
   *
   * @param audioAheadMs      `(currentTime - getOutputTimestamp().contextTime) * 1000`.
   * @param frameIntervalSec  intervalle de trame mesure, pour `presentDelayMs`.
   * @param analyserDelayMs   `1000 * fftSize / (2 * sampleRate)`.
   */
  updateSync(audioAheadMs: number, frameIntervalSec: number, analyserDelayMs: number): void {
    const c = this.syncConfig;
    this.lastFrameIntervalSec = frameIntervalSec;
    const presentDelayMs = c.presentDelayFrames * frameIntervalSec * 1000;
    // Les deux premiers termes sont deja compenses par la retro-datation §2.3
    // quand `onsetBackdatingApplied` est vrai. Voir NOTES.md, ecart n°2.
    const counted = c.onsetBackdatingApplied ? 0 : analyserDelayMs + c.pickLookaheadMs;
    this.syncMs = {
      analyserDelayMs,
      pickLookaheadMs: c.pickLookaheadMs,
      presentDelayMs,
      audioAheadMs,
      userTrimMs: c.userTrimMs,
      totalMs: counted + presentDelayMs - audioAheadMs + c.userTrimMs,
    };
  }

  /** Reglage manuel au HUD (fleches haut/bas). */
  setUserTrimMs(ms: number): void {
    this.syncConfig = { ...this.syncConfig, userTrimMs: ms };
    this.updateSync(this.syncMs.audioAheadMs, this.lastFrameIntervalSec, this.syncMs.analyserDelayMs);
  }

  get userTrimMs(): number {
    return this.syncConfig.userTrimMs;
  }

  /** Roue libre : on garde le BPM mais on remet la structure a zero (changement de morceau). */
  reArm(): void {
    // La verite se reaffirme d'elle-meme a la trame suivante si le canal est
    // toujours vivant (`TruthDirector.step`) ; un re-arm ne doit pas laisser
    // un mode verite orphelin d'un canal mort.
    this.truthMode = false;
    this.phase = 0;
    this.pendingPhaseShift = 0;
    this.phaseAcquired = false;
    this.beatIndex = 0;
    this.hardMisses = 0;
    this.acceptedKicks = 0;
    this.rejectedKicks = 0;
    this.hardResyncs = 0;
    this.lastPhaseError = 0;
    this.rampEnd = Number.NEGATIVE_INFINITY;
    this.confidence = 0;
    this.downbeatConfidence = 0;
    this.downbeatOffset = 0;
    this.downbeatChallenger = -1;
    this.downbeatChallengerBars = 0;
    this.snareAcc.fill(0);
    this.kickAcc.fill(0);
    this.noveltyAcc.fill(0);
    this.bassJumpAcc.fill(0);
    this.totals.fill(0);
    this.beatMacroSum.fill(0);
    this.prevBeatMacro.fill(0);
    this.prevBeatMacroValid = false;
    this.beatMacroCount = 0;
    this.beatSnare = 0;
    this.beatKick = 0;
    this.beatsThisFrame = 0;
    this.barThisFrame = false;
    this.phraseThisFrame = false;
    this.downbeatChangedThisFrame = false;
    this.kickCount = 0;
  }

  reset(): void {
    this.reArm();
    this.periodSec = 0;
    this.nowTime = 0;
    this.manualTempo = false;
    this.tapCount = 0;
  }
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 1e-12 ? clamp(dot / d, -1, 1) : 1;
}

/** Normalise a somme 1 pour que les poids du vote soient comparables entre indices. */
function normalizeInto(src: Float32Array, dst: Float32Array, n: number): Float32Array {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.max(0, src[i] ?? 0);
  for (let i = 0; i < n; i++) dst[i] = sum > 1e-12 ? Math.max(0, src[i] ?? 0) / sum : 1 / n;
  return dst;
}

function rotate(arr: Float32Array, scratch: Float32Array, n: number, delta: number): void {
  for (let i = 0; i < n; i++) scratch[i] = arr[(i + delta) % n] ?? 0;
  for (let i = 0; i < n; i++) arr[i] = scratch[i]!;
}
