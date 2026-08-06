/**
 * Estimation de tempo par autocorrelation (§2.4).
 *
 * Choix imposes et leurs raisons :
 *
 * - **Fonction de detection large bande** (somme des trois flux), pas le kick
 *   seul : une fonction kick-only echoue sur tout le repertoire breakbeat /
 *   drum'n'bass.
 * - **Retrait de la moyenne** avant autocorrelation : la fonction de detection
 *   est semi-redressee donc >= 0 ; sans retrait, le terme continu ecrase la
 *   modulation.
 * - **Estimateur NON BIAISE** `r[L] = (1/(N-L)) * sum(...)` : l'estimateur brut
 *   decroit en `(N-L)` et favorise systematiquement les tempi rapides (~10 %).
 * - **Choix d'octave par scoring de familles**, jamais par repliement apres
 *   coup : un repliement dur vers 85-175 BPM n'est pas bijectif (175/85 = 2,06)
 *   et jette l'information qui permettrait de trancher.
 * - **Recherche fractionnaire du lag.** A 50 Hz le quantum d'un lag entier vaut
 *   10,5 BPM a 200 BPM et 5,5 BPM a 128 BPM : le critere « +/- 1 BPM » est
 *   inatteignable par simple argmax, et l'interpolation parabolique seule est
 *   biaisee sur un pic d'autocorrelation de train d'impulsions (sommet
 *   triangulaire). Voir NOTES.md pour la derivation du pas de 0,02 echantillon.
 *
 * Classe pure : le temps est un parametre, aucun `window`.
 */

import type { LiveBeatConfig } from '../LiveConfig';

export interface TempoHypothesis {
  /** Lag en echantillons de grille. */
  readonly lag: number;
  readonly bpm: number;
  /** Score de famille (harmoniques + a priori). */
  readonly score: number;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export class TempoEstimator {
  private readonly ring: Float32Array;
  private readonly work: Float32Array;
  private readonly raw: Float32Array;
  private readonly acf: Float32Array;
  private readonly candidateScores: Float32Array;
  private readonly candidateLags: Float32Array;
  private candidateCount = 0;
  private readonly sortScratch: Float32Array;
  private readonly hypothesisList: TempoHypothesis[] = [];

  private head = 0;
  private filled = 0;
  private lastEvalTime = Number.NEGATIVE_INFINITY;
  private nowTime = 0;
  /** Etat de l'evaluation courante, lu par `acfAt` (evite de le repasser en parametre partout). */
  private windowLen = 0;
  private r0 = 0;
  private maxLagNow = 0;

  private readonly lagMin: number;
  private readonly lagMax: number;
  private readonly maxAcfLag: number;

  /** BPM adopte, 0 tant qu'aucune estimation n'est disponible. */
  bpm = 0;
  /** Confiance 0-1 (§2.4). */
  confidence = 0;
  /** `true` sur l'evaluation ou le BPM vient d'etre adopte ou change. */
  changed = false;
  /** Dernier BPM candidat, adopte ou non - sert a la detection de changement de morceau (§2.6). */
  candidateBpm = 0;
  /** Lag brut sorti de la recherche, avant choix du niveau metrique - HUD et diagnostic. */
  searchedLag = 0;
  /** Rapport `r[niveau rapide]/r[niveau lent]` du dernier test de descente - HUD et diagnostic. */
  descendRatio = 0;
  /** Idem pour le test de montee. */
  ascendRatio = 0;
  /** Rapport d'energie forts/faibles du dernier test de montee. */
  ascendEnergyRatio = 0;

  private adoptedLag = 0;
  private adoptCount = 0;
  private adoptPending = 0;
  private octavePendingLag = 0;
  private octavePendingSince = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly config: LiveBeatConfig,
    private readonly gridHz: number,
    gridSeconds: number,
  ) {
    const n = Math.round(gridHz * gridSeconds);
    this.ring = new Float32Array(n);
    this.work = new Float32Array(n);
    this.raw = new Float32Array(n);
    this.lagMin = Math.max(2, Math.floor((60 * gridHz) / config.bpmMax));
    this.lagMax = Math.min(n - 2, Math.ceil((60 * gridHz) / config.bpmMin));
    const harmonics = config.tempoHarmonicWeights.length;
    this.maxAcfLag = Math.min(n - 2, this.lagMax * harmonics + 2);
    this.acf = new Float32Array(this.maxAcfLag + 1);
    const coarseSlots = Math.ceil((this.lagMax - this.lagMin) / config.tempoCoarseStep) + 2;
    this.candidateScores = new Float32Array(coarseSlots);
    this.candidateLags = new Float32Array(coarseSlots);
    this.sortScratch = new Float32Array(this.lagMax - this.lagMin + 1);
  }

  /** Hypotheses d'octave classees, pour le HUD (§4.6). Tableau reutilise. */
  get hypotheses(): readonly TempoHypothesis[] {
    return this.hypothesisList;
  }

  /** Periode adoptee en secondes, 0 si aucune. */
  get periodSec(): number {
    return this.bpm > 0 ? 60 / this.bpm : 0;
  }

  /** Secondes d'historique accumulees. */
  get historySec(): number {
    return this.filled / this.gridHz;
  }

  /**
   * Un pas de grille. `detection` est la valeur BRUTE (pre-AGC) de la fonction
   * de detection large bande.
   */
  tick(tickTime: number, detection: number): void {
    this.changed = false;
    this.nowTime = tickTime;
    this.ring[this.head] = detection;
    this.head = (this.head + 1) % this.ring.length;
    if (this.filled < this.ring.length) this.filled++;

    // Cadence doublee tant que l'estimateur acquiert. Le prompt fixe 4 Hz pour
    // le cout ; ce cout est mesure a ~0,5 ms par evaluation, soit 0,4 % de CPU
    // a 8 Hz - negligeable, et transitoire. En regime etabli on revient a
    // 4 Hz. Sans ca, la premiere correction d'une hypothese fausse peut tomber
    // 250 ms apres l'echeance de verrouillage de 4 s.
    const hz = this.confidence >= this.config.tempoAdoptGuardConfidence ? this.config.tempoEvalHz : this.config.tempoEvalHzAcquiring;
    if (tickTime - this.lastEvalTime < 1 / hz) return;
    this.lastEvalTime = tickTime;
    this.evaluate();
  }

  private evaluate(): void {
    const stages = this.config.tempoWindowStagesSec;
    const availableSec = this.filled / this.gridHz;
    let windowSec = 0;
    for (const s of stages) if (availableSec >= s) windowSec = s;
    if (windowSec === 0) return;

    // Les paliers de §2.4 disent QUAND on a le droit d'estimer et jusqu'ou la
    // confiance peut monter ; ils ne disent pas de JETER l'historique
    // disponible. On correle donc sur tout ce qu'on a (plafonne a la
    // profondeur du ring), et `windowSec` ne sert qu'au plafond de confiance.
    // Avec 2 % de gigue a 128 BPM, correler sur 3 s a t = 4 s au lieu des 4 s
    // reellement accumulees donnait une premiere estimation a 142,7 BPM.
    const n = this.filled;
    this.snapshot(n);

    let mean = 0;
    for (let i = 0; i < n; i++) mean += this.raw[i]!;
    mean /= n;
    for (let i = 0; i < n; i++) this.work[i] = this.raw[i]! - mean;

    const maxLag = Math.min(this.maxAcfLag, n - 2);
    let r0 = 0;
    for (let i = 0; i < n; i++) r0 += this.work[i]! * this.work[i]!;
    r0 /= n;
    if (!(r0 > 1e-12)) {
      this.confidence = 0;
      return;
    }
    this.windowLen = n;
    this.r0 = r0;
    this.maxLagNow = maxLag;
    this.acf[0] = 1;
    for (let L = 1; L <= maxLag; L++) {
      let acc = 0;
      for (let i = 0; i + L < n; i++) acc += this.work[i]! * this.work[i + L]!;
      // Estimateur non biaise : division par le nombre de termes reellement sommes.
      this.acf[L] = acc / (n - L) / r0;
    }
    for (let L = maxLag + 1; L <= this.maxAcfLag; L++) this.acf[L] = 0;

    const fineLag = this.searchLag(maxLag);
    if (fineLag <= 0) return;
    const evidenced = this.selectMetricalLevel(fineLag, n, maxLag);
    const bpm = (60 * this.gridHz) / evidenced;
    this.candidateBpm = bpm;

    const conf = this.computeConfidence(evidenced, windowSec, stages);
    this.adopt(evidenced, bpm, conf);
  }

  private snapshot(n: number): void {
    // Copie chronologique : le plus ancien des `n` derniers echantillons d'abord.
    const start = (this.head - n + this.ring.length * 2) % this.ring.length;
    for (let i = 0; i < n; i++) this.raw[i] = this.ring[(start + i) % this.ring.length]!;
  }

  /**
   * Recherche du lag, en deux passes FRACTIONNAIRES.
   *
   * Pourquoi pas une passe entiere suivie d'un raffinement local : le score de
   * famille evalue l'autocorrelation en `L, 2L, 3L, 4L`. Avec un `L` entier et
   * un vrai lag fractionnaire, ces multiples tombent a cote du pic - et le pic
   * est etroit (mesure sur click track 128 BPM : `r[46] = 0.225` contre
   * `r[47] = 0.820`, soit une demi-largeur d'environ 0,5 echantillon).
   *
   * Consequence mesuree : a 128 BPM (vrai lag 23,44), `score(23)` perdait ses
   * harmoniques 46 / 69 / 92 dans les creux et valait 0,78, tandis que
   * `score(47)` - proche du vrai lag double 46,88 - valait 1,055. Le moteur
   * verrouillait 63,8 BPM. Meme mecanisme a 140 BPM.
   *
   * Le pas grossier doit donc satisfaire `pas * harmoniqueMax < demi-largeur`,
   * soit `0.1 * 4 = 0.4 < 0.5`. La passe fine suit au pas de `tempoFineStep`.
   */
  private searchLag(maxLag: number): number {
    const { tempoCoarseStep, tempoFineStep } = this.config;
    let best = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    let slot = 0;
    for (let lag = this.lagMin; lag <= this.lagMax + 1e-9; lag += tempoCoarseStep) {
      const s = this.fineScore(lag, maxLag);
      if (slot < this.candidateScores.length) {
        this.candidateLags[slot] = lag;
        this.candidateScores[slot] = s;
        slot++;
      }
      if (s > bestScore) {
        bestScore = s;
        best = lag;
      }
    }
    this.candidateCount = slot;
    if (best < 0) return -1;

    // Fenetre fine volontairement plus large qu'un pas grossier : le score de
    // famille n'est pas lisse a l'echelle de 0,1 echantillon (le 4e harmonique
    // se deplace de 0,4), donc l'argmax grossier peut manquer le vrai pic de
    // plusieurs pas.
    const span = tempoCoarseStep * this.config.tempoFineSpanSteps;
    const from = Math.max(this.lagMin, best - span);
    const to = Math.min(this.lagMax, best + span);
    for (let lag = from; lag <= to + 1e-9; lag += tempoFineStep) {
      const s = this.fineScore(lag, maxLag);
      if (s > bestScore) {
        bestScore = s;
        best = lag;
      }
    }
    this.collectHypotheses(maxLag, best);
    return best;
  }

  private prior(bpm: number): number {
    const z = Math.log2(bpm / this.config.tempoPriorCenterBpm) / this.config.tempoPriorSigmaOct;
    return Math.exp(-0.5 * z * z);
  }

  /**
   * Autocorrelation a lag FRACTIONNAIRE, calculee directement sur le signal
   * par interpolation lineaire des echantillons.
   *
   * Interpoler `acf` entre deux lags entiers ne marche PAS : le maximum d'une
   * fonction affine par morceaux est toujours sur un noeud, donc la recherche
   * fine renvoyait systematiquement un lag entier et le BPM restait quantifie
   * a 5,5 BPM pres a 128 BPM. Il faut decaler le signal, pas la correlation.
   */
  private acfAt(lag: number): number {
    const n = this.windowLen;
    if (lag < 1 || lag >= n - 1 || this.r0 <= 0) return 0;
    const i0 = Math.floor(lag);
    const f = lag - i0;
    // `count` borne aussi la lecture a `work[n-1]` : `i + i0 + 1` doit rester
    // dans la fenetre, sinon on lit un residu de l'evaluation precedente.
    const count = n - i0 - 1;
    if (count <= 1) return 0;
    let acc = 0;
    for (let i = 0; i < count; i++) {
      const a = this.work[i + i0]!;
      const b = this.work[i + i0 + 1]!;
      acc += this.work[i]! * (a + (b - a) * f);
    }
    // Estimateur non biaise : division par le nombre de termes reellement sommes.
    return acc / count / this.r0;
  }

  private fineScore(lag: number, maxLag: number): number {
    const weights = this.config.tempoHarmonicWeights;
    let s = 0;
    for (let h = 0; h < weights.length; h++) {
      const l = lag * (h + 1);
      if (l > maxLag) break;
      s += weights[h]! * this.acfAt(l);
    }
    return s * this.prior((60 * this.gridHz) / lag);
  }

  /**
   * Choix du niveau metrique dans la famille gagnante (§2.4, « scoring de
   * familles, jamais par repliement apres coup »).
   *
   * Le critere est le RAPPORT D'AUTOCORRELATION entre deux niveaux adjacents.
   * Mesures completes sur click tracks a 30, 60 et 120 fps (voir NOTES.md) :
   *
   *   cas          descente r[L/2]/r[L]   montee r[L]/r[2L]
   *   90 @60             0.503 - 0.663            0.716
   *   128 @60                     -               0.666 - 0.717
   *   128 @120                    -               0.429 - 0.471
   *   128 @30                     -               0.855 - 1.066
   *   140 @60                     -               0.704 - 0.749
   *   140 @120                    -               0.488 - 0.516
   *   174 @60            1.077 - 1.090            idem
   *   174 @120           1.011 - 1.089            idem
   *   126 four-on-floor           -               0.964 - 1.002
   *
   * DESCENTE (aller plus vite) : doit se declencher a 174 (>= 1.01) et jamais
   * a 90 (<= 0.663). Seuil a 0,80, au milieu de l'intervalle.
   *
   * MONTEE (aller moins vite) : ne doit se declencher dans AUCUN de ces cas,
   * dont le minimum est 0,429. Seuil a 0,35. C'est la mesure qui l'impose :
   * a 0,68 la montee se declenchait a tort sur 128 et 140 des que le framerate
   * changeait, et le moteur pulsait a demi-vitesse.
   *
   * Pourquoi PAS le seul rapport d'energie pairs/impairs de §2.4 : mesure a
   * 4,2 sur un motif kick + backbeat a 128 BPM (le temps portant le snare est
   * 4 fois plus « fort ») et a 1,2 a 174 BPM. Le seuil de 1,6 du prompt lit
   * donc un backbeat ordinaire comme « les temps intermediaires sont vides ».
   * Ce rapport est conserve, mais seulement comme condition CORROBORANTE de la
   * montee, jamais comme critere principal.
   */
  private selectMetricalLevel(lag0: number, n: number, maxLag: number): number {
    let lag = lag0;
    this.searchedLag = lag0;
    this.descendRatio = 0;

    // Descente : tant que le niveau deux fois plus rapide garde l'essentiel de
    // la correlation, c'est lui le temps.
    for (let guard = 0; guard < 3; guard++) {
      const half = lag / 2;
      if (half < this.lagMin) break;
      const rLag = this.acfAt(lag);
      if (rLag <= 1e-9) break;
      const ratio = this.acfAt(half) / rLag;
      if (guard === 0) this.descendRatio = ratio;
      if (ratio < this.config.octaveDescendAcfRatio) break;
      lag = half;
    }

    // Montee : uniquement si le niveau courant est mal soutenu par rapport au
    // double ET que les positions intermediaires sont effectivement vides.
    const doubled = lag * 2;
    if (doubled > maxLag || doubled > this.lagMax) return lag;
    const rLag = this.acfAt(lag);
    const rDouble = this.acfAt(doubled);
    this.ascendRatio = rDouble !== 0 ? rLag / rDouble : 0;
    if (rDouble <= 1e-9 || rLag / rDouble >= this.config.octaveAscendAcfRatio) return lag;
    const ratio = this.evenOddRatio(lag, n);
    this.ascendEnergyRatio = ratio;
    if (ratio > this.config.octaveHalveRatio) return doubled;
    return lag;
  }

  /** Rapport energie(positions fortes)/energie(positions faibles) sur la grille de pas `lag` (§2.4). */
  private evenOddRatio(lag: number, n: number): number {
    const step = Math.max(1, Math.round(lag));
    let bestPhase = 0;
    let bestEnergy = -1;
    for (let p = 0; p < step; p++) {
      let e = 0;
      for (let pos = p; pos < n; pos += lag) e += this.raw[Math.round(pos)] ?? 0;
      if (e > bestEnergy) {
        bestEnergy = e;
        bestPhase = p;
      }
    }
    let evenSum = 0;
    let evenN = 0;
    let oddSum = 0;
    let oddN = 0;
    let i = 0;
    for (let pos = bestPhase; pos < n; pos += lag, i++) {
      const v = this.raw[Math.round(pos)] ?? 0;
      if (i % 2 === 0) {
        evenSum += v;
        evenN++;
      } else {
        oddSum += v;
        oddN++;
      }
    }
    if (evenN < 2 || oddN < 2) return 1;
    const a = evenSum / evenN;
    const b = oddSum / oddN;
    return Math.max(a, b) / (Math.min(a, b) + 1e-9);
  }

  private computeConfidence(lag: number, windowSec: number, stages: readonly number[]): number {
    const peak = this.acfAt(lag);
    const count = this.lagMax - this.lagMin + 1;
    for (let i = 0; i < count; i++) this.sortScratch[i] = this.acf[this.lagMin + i]!;
    const view = this.sortScratch.subarray(0, count);
    view.sort();
    const median = view[count >> 1] ?? 0;
    const max = view[count - 1] ?? 0;
    let conf = clamp01((peak - median) / (max - median + 1e-6));

    // Croisement avec le second pic NON harmonique : sans lui, un signal
    // parfaitement periodique et un signal a deux periodicites concurrentes
    // recevraient la meme confiance.
    let second = 0;
    for (let L = this.lagMin; L <= this.lagMax; L++) {
      if (isHarmonicallyRelated(L, lag)) continue;
      const v = this.acf[L]!;
      if (v > second) second = v;
    }
    if (peak / (second + 1e-9) < this.config.tempoSecondPeakRatio) {
      conf = Math.min(conf, this.config.tempoSecondPeakCap);
    }
    if (windowSec <= (stages[0] ?? 0)) conf = Math.min(conf, this.config.tempoEarlyConfidenceCap);
    return conf;
  }

  private adopt(lag: number, bpm: number, conf: number): void {
    this.confidence = conf;

    if (this.adoptedLag === 0) {
      this.commit(lag, bpm);
      return;
    }

    const currentBpm = (60 * this.gridHz) / this.adoptedLag;
    const rel = Math.abs(bpm - currentBpm) / currentBpm;

    // Meme octave, ecart faible : c'est un raffinement, pas un changement.
    // C'est ce chemin qui amene la precision a +/- 0,5 BPM en quelques
    // evaluations sans attendre l'hysteresis.
    if (rel <= 0.03) {
      this.adoptPending = 0;
      this.adoptCount = 0;
      this.octavePendingSince = Number.NEGATIVE_INFINITY;
      this.commit(lag, bpm, false);
      return;
    }

    const ratio = bpm / currentBpm;
    const isOctave = Math.abs(ratio - 2) < 0.12 || Math.abs(ratio - 0.5) < 0.06;
    if (isOctave) {
      const currentScore = this.fineScore(this.adoptedLag, this.maxLagNow);
      const challengerScore = this.fineScore(lag, this.maxLagNow);
      if (challengerScore < currentScore * this.config.octaveSwitchDominance) {
        this.octavePendingSince = Number.NEGATIVE_INFINITY;
        return;
      }
      if (this.octavePendingLag === 0 || Math.abs(this.octavePendingLag - lag) / lag > 0.03) {
        this.octavePendingLag = lag;
        this.octavePendingSince = this.nowTime;
        return;
      }
      // Un doublement de tempo percu est plus destructeur qu'un mauvais BPM
      // stable : 6 s de domination continue avant de basculer.
      if (this.nowTime - this.octavePendingSince < this.config.octaveSwitchHoldSec) return;
      this.octavePendingSince = Number.NEGATIVE_INFINITY;
      this.commit(lag, bpm);
      return;
    }

    const currentScore = this.fineScore(this.adoptedLag, this.maxLagNow);
    const challengerScore = this.fineScore(lag, this.maxLagNow);
    if (challengerScore >= currentScore * this.config.tempoAdoptDominance) {
      if (this.adoptPending > 0 && Math.abs(this.adoptPending - lag) / lag > 0.03) this.adoptCount = 0;
      this.adoptPending = lag;
      this.adoptCount++;
      // L'hysteresis protege un verrouillage ETABLI, pas une premiere
      // hypothese. Tant que la confiance est basse (fenetre de 3 s, ou signal
      // gigue), attendre 3 evaluations retarde la correction au-dela des 4 s
      // du critere §8.2 : mesure a 128 BPM avec 2 % de gigue, premiere
      // estimation a 142,7 BPM corrigee seulement a t = 5,5 s.
      const hold = this.confidence >= this.config.tempoAdoptGuardConfidence ? this.config.tempoAdoptHoldEvals : 1;
      if (this.adoptCount >= hold) this.commit(lag, bpm);
    } else {
      this.adoptCount = 0;
      this.adoptPending = 0;
    }
  }

  private commit(lag: number, bpm: number, signal = true): void {
    this.adoptedLag = lag;
    this.bpm = bpm;
    this.adoptCount = 0;
    this.adoptPending = 0;
    this.changed = signal;
  }

  /**
   * Hypotheses affichees au HUD : les niveaux metriques de la famille gagnante
   * (moitie, gagnant, double), plus le meilleur candidat NON harmonique. C'est
   * ce qu'il faut voir pour diagnostiquer un doublement de tempo percu.
   */
  private collectHypotheses(maxLag: number, best: number): void {
    this.hypothesisList.length = 0;
    for (const lag of [best / 2, best, best * 2]) {
      if (lag < this.lagMin || lag > this.lagMax) continue;
      this.hypothesisList.push({ lag, bpm: (60 * this.gridHz) / lag, score: this.fineScore(lag, maxLag) });
    }
    let rival = -1;
    let rivalScore = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < this.candidateCount; i++) {
      const lag = this.candidateLags[i]!;
      if (isHarmonicallyRelated(lag, best)) continue;
      const s = this.candidateScores[i]!;
      if (s > rivalScore) {
        rivalScore = s;
        rival = lag;
      }
    }
    if (rival > 0) this.hypothesisList.push({ lag: rival, bpm: (60 * this.gridHz) / rival, score: rivalScore });
  }

  /** Vide la fenetre et la confiance sans perdre l'historique de configuration (changement de morceau, §2.6). */
  reArm(): void {
    this.ring.fill(0);
    this.filled = 0;
    this.head = 0;
    this.confidence = 0;
    this.bpm = 0;
    this.candidateBpm = 0;
    this.adoptedLag = 0;
    this.adoptCount = 0;
    this.adoptPending = 0;
    this.octavePendingLag = 0;
    this.octavePendingSince = Number.NEGATIVE_INFINITY;
    this.hypothesisList.length = 0;
    this.changed = false;
  }

  reset(): void {
    this.reArm();
    this.lastEvalTime = Number.NEGATIVE_INFINITY;
    this.nowTime = 0;
  }
}

/** `L` est-il dans un rapport 1:1, 1:2, 2:1, 1:3, 3:1, 1:4 ou 4:1 avec `lag` (a 10 % pres) ? */
function isHarmonicallyRelated(L: number, lag: number): boolean {
  for (let h = 1; h <= 4; h++) {
    if (Math.abs(L - lag * h) / (lag * h) < 0.1) return true;
    if (Math.abs(L - lag / h) / (lag / h) < 0.1) return true;
  }
  return false;
}
