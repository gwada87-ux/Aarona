/**
 * Detection d'onsets (§2.3) : flux spectral blanchi, trois detecteurs, un
 * peak-picking normalise.
 *
 * Points ou une implementation naive echoue, tous traites ici :
 *
 * - **Blanchiment adaptatif par bin.** Sans lui, une ligne de basse forte
 *   ecrase tout et masque les charleys.
 * - **Division par le nombre de bins.** Les trois flux couvrent 5 a 190 bins ;
 *   sans normalisation ils ne sont pas comparables entre eux.
 * - **Moyenne geometrique pour le snare.** Une somme se declenche sur le clic
 *   large bande d'un kick.
 * - **Peak-picking, pas seuillage.** Un seuil sur moyenne glissante se
 *   declenche sur le front montant, 1 a 2 trames avant le maximum, avec une
 *   forte gigue. D'ou le maximum local, qui coute un pas de grille (20 ms) -
 *   compte dans `syncOffsetMs`.
 * - **Refractaire relatif au tempo.** Un refractaire kick fixe a 90 ms bloque
 *   les doubles-croches au-dessus de 165 BPM : drum'n'bass, techno rapide,
 *   808 rolls.
 * - **Retro-datation du retard de groupe** : l'onset est date du centre de la
 *   fenetre d'analyse, pas de la trame ou le seuil a ete franchi.
 *
 * Classe pure : le temps est un parametre, aucune allocation par trame.
 */

import { MIN_USABLE_BIN, hzRangeToBins, type BinSpan } from './bins';
import type { LiveAudioConfig } from '../LiveConfig';

export type OnsetKind = 'kick' | 'snare' | 'hat';

export interface OnsetEvent {
  readonly kind: OnsetKind;
  /** Instant retro-date sur l'horloge `audioContext.currentTime`. */
  readonly tSec: number;
  /** Force 0-1. Jamais un booleen (§2.7). */
  readonly strength: number;
}

/** Canaux pousses sur la grille 50 Hz. Ordre fige : indexe par les constantes ci-dessous. */
export const CH_KICK = 0;
export const CH_SNARE = 1;
export const CH_HAT = 2;
export const CH_FLATNESS = 3;
export const CH_KICK_ENV = 4;
export const GRID_CHANNELS = 5;

/** Canaux soumis au peak-picking (flatness exclue : c'est une porte, pas une fonction de detection). */
const PICKED = [CH_KICK, CH_SNARE, CH_HAT, CH_KICK_ENV] as const;
const KIND_OF: Readonly<Record<number, OnsetKind>> = { [CH_KICK]: 'kick', [CH_SNARE]: 'snare', [CH_HAT]: 'hat' };

class MutableOnset {
  kind: OnsetKind = 'kick';
  tSec = 0;
  strength = 0;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function clampPositive(x: number, cap: number): number {
  return x < 0 ? 0 : x > cap ? cap : x;
}


/**
 * Flux spectral par bande, calcule une fois par TRAME (pas par pas de grille) :
 * c'est la seule etape qui a besoin du spectre complet.
 */
export class SpectralFlux {
  private readonly ref: Float32Array;
  private readonly wPrev: Float32Array;
  private readonly kickSpan: BinSpan;
  private readonly snareLowSpan: BinSpan;
  private readonly snareHighSpan: BinSpan;
  private readonly hatSpan: BinSpan;
  private readonly lastBin: number;
  private readonly lpCoeff: number;
  private primed = false;
  private accKick = 0;
  private accSnareLow = 0;
  private accSnareHigh = 0;
  private accHat = 0;

  constructor(
    private readonly config: LiveAudioConfig,
    sampleRate: number,
    fftSizeOnset: number,
  ) {
    const bins = fftSizeOnset / 2;
    this.ref = new Float32Array(bins);
    this.wPrev = new Float32Array(bins);
    this.kickSpan = hzRangeToBins(config.kickHz, sampleRate, fftSizeOnset);
    this.snareLowSpan = hzRangeToBins(config.snareLowHz, sampleRate, fftSizeOnset);
    this.snareHighSpan = hzRangeToBins(config.snareHighHz, sampleRate, fftSizeOnset);
    this.hatSpan = hzRangeToBins(config.hatHz, sampleRate, fftSizeOnset);
    this.lastBin = Math.max(this.hatSpan.hi, this.snareHighSpan.hi);
    // Passe-bas 1 pole, forme discrete usuelle. Recalcule a chaque bloc depuis
    // son premier echantillon : le bloc temporel d'un AnalyserNode se recouvre
    // largement d'une trame a l'autre, un etat persistant re-integrerait
    // plusieurs fois le meme audio.
    this.lpCoeff = 1 - Math.exp((-2 * Math.PI * config.kickEnvCutoffHz) / sampleRate);
    this.reset();
  }

  /**
   * Accumule le flux spectral de cette trame. Le resultat n'est PAS lu ici :
   * il est vide une fois par pas de grille par `take()`.
   *
   * C'est ce qui rend le flux independant du framerate. Le calculer par trame
   * puis le normaliser par `hop / dt` (recette §2.1) ne corrige que la
   * MOYENNE : la fenetre d'analyse fait 42,7 ms, donc a 120 fps l'energie
   * d'une attaque s'etale sur cinq trames et a 30 fps sur une seule, et c'est
   * le PIC de la fonction de detection qui change - d'un facteur qui suffit a
   * faire basculer le choix de niveau metrique. Mesure sur click track
   * 128 BPM : 127,9 BPM a 60 fps, 63,9 a 120 fps. Integrer sur le pas de
   * grille supprime la dependance.
   *
   * @param dt secondes ecoulees depuis la trame precedente (decroissance du blanchiment).
   * @param db spectre de l'analyseur d'onsets, en dBFS.
   */
  accumulate(dt: number, db: Float32Array): void {
    const { dbFloor, whiteningDecayDbPerSec } = this.config;
    const decay = dt * whiteningDecayDbPerSec;

    let accKick = 0;
    let accSnareLow = 0;
    let accSnareHigh = 0;
    let accHat = 0;

    for (let k = MIN_USABLE_BIN; k <= this.lastBin && k < db.length; k++) {
      const raw = db[k];
      if (raw === undefined) continue;
      const m = raw > dbFloor ? raw : dbFloor;
      // ref suit le maximum recent en decroissant de 30 dB/s : w est donc
      // toujours <= 0, mesure de la distance au pic local du bin.
      const nextRef = Math.max(m, this.ref[k]! - decay);
      this.ref[k] = nextRef;
      const w = m - nextRef;
      const rise = w - this.wPrev[k]!;
      this.wPrev[k] = w;
      if (rise <= 0) continue;

      if (k >= this.kickSpan.lo && k <= this.kickSpan.hi) accKick += rise;
      if (k >= this.snareLowSpan.lo && k <= this.snareLowSpan.hi) accSnareLow += rise;
      if (k >= this.snareHighSpan.lo && k <= this.snareHighSpan.hi) accSnareHigh += rise;
      if (k >= this.hatSpan.lo && k <= this.hatSpan.hi) accHat += rise;
    }

    // La premiere trame apres un reset compare a un `wPrev` nul : tout le
    // spectre parait monter d'un coup. On la neutralise.
    if (!this.primed) {
      this.primed = true;
      return;
    }
    // MUST §2.3 : division par le nombre de bins, sinon les trois flux (5 bins
    // contre 190) ne sont pas comparables entre eux.
    this.accKick += accKick / spanWidth(this.kickSpan);
    this.accSnareLow += accSnareLow / spanWidth(this.snareLowSpan);
    this.accSnareHigh += accSnareHigh / spanWidth(this.snareHighSpan);
    this.accHat += accHat / spanWidth(this.hatSpan);
  }

  /**
   * Vide les accumulateurs dans `out` (kick, snare, hat) et les remet a zero.
   * La moyenne geometrique du snare est calculee ICI, sur les valeurs
   * integrees : `sqrt(a*b)` n'est pas lineaire, l'appliquer par trame puis
   * sommer ne donnerait pas le meme resultat.
   */
  take(out: Float32Array): void {
    out[0] = this.accKick;
    // Moyenne GEOMETRIQUE, jamais une somme : une somme se declenche sur le
    // clic large bande d'un kick.
    out[1] = Math.sqrt(this.accSnareLow * this.accSnareHigh);
    out[2] = this.accHat;
    this.accKick = 0;
    this.accSnareLow = 0;
    this.accSnareHigh = 0;
    this.accHat = 0;
  }

  /** Enveloppe temporelle passe-bas 120 Hz redressee, maximum sur le bloc (§2.3, ligne kick). */
  lowEnvelope(timeDomain: Float32Array): number {
    let y = timeDomain[0] ?? 0;
    let peak = Math.abs(y);
    for (let i = 1; i < timeDomain.length; i++) {
      y += this.lpCoeff * ((timeDomain[i] ?? 0) - y);
      const a = y < 0 ? -y : y;
      if (a > peak) peak = a;
    }
    return peak;
  }

  reset(): void {
    this.ref.fill(this.config.dbFloor);
    this.wPrev.fill(0);
    this.primed = false;
    this.accKick = 0;
    this.accSnareLow = 0;
    this.accSnareHigh = 0;
    this.accHat = 0;
  }
}

function spanWidth(span: BinSpan): number {
  return span.hi - span.lo + 1;
}

export class OnsetDetector {
  /** Onsets emis au dernier `tick`. Objets recycles : ne pas conserver de reference. */
  private readonly pool: MutableOnset[] = [];
  private poolCount = 0;

  private readonly mu = new Float32Array(GRID_CHANNELS);
  private readonly variance = new Float32Array(GRID_CHANNELS);
  private readonly muNorm = new Float32Array(GRID_CHANNELS);
  private readonly hist0 = new Float32Array(GRID_CHANNELS);
  private readonly hist1 = new Float32Array(GRID_CHANNELS);
  private readonly rawHist1 = new Float32Array(GRID_CHANNELS);
  private readonly lastOnsetTime = new Float64Array(GRID_CHANNELS);
  private readonly lastOnsetStrength = new Float32Array(GRID_CHANNELS);
  private readonly scratch = new Float32Array(GRID_CHANNELS);
  /**
   * Fonction de detection large bande du dernier pas de grille : somme des
   * trois flux NORMALISES par leurs statistiques glissantes, pas des flux
   * bruts.
   *
   * Sans cette mise a l'echelle par canal, le flux de kick ecrase celui de
   * snare d'un facteur 2 a 5 ; la preuve rythmique de §2.4 lit alors un motif
   * kick / backbeat comme « un temps sur deux est vide » et divise le tempo
   * par deux. Mesure sur click track 128 BPM : 63,8 BPM avant, 128,0 apres.
   * La normalisation par canal n'est pas l'AGC de §2.2 (interdit a la
   * detection) : c'est la meme standardisation que le peak-picking de §2.3,
   * calculee sur la meme fenetre de 1 s.
   */
  detection = 0;
  private histTime = 0;
  private ticks = 0;
  private readonly statsAlpha: number;
  private readonly warmupTicks: number;
  private readonly analyserDelaySec: number;
  private readonly hopSec: number;
  private readonly peakRef = new Float32Array(GRID_CHANNELS);
  private readonly peakRefDecay: number;

  constructor(
    private readonly config: LiveAudioConfig,
    sampleRate: number,
    fftSizeOnset: number,
    gridHz: number,
  ) {
    this.statsAlpha = 1 / Math.max(1, config.peakStatsSeconds * gridHz);
    // Rodage court : assez pour que mu et sigma decrivent quelque chose grace
    // a la correction de biais, assez bref pour ne pas amputer la fenetre
    // d'autocorrelation au demarrage. Une demi-fenetre (0,5 s) repoussait la
    // premiere estimation de tempo a 3,5 s, trop pres du critere de 4 s.
    this.warmupTicks = Math.round(config.peakStatsSeconds * gridHz * config.warmupFraction);
    this.analyserDelaySec = fftSizeOnset / (2 * sampleRate);
    this.hopSec = 1 / gridHz;
    // La grille est a pas fixe : la decroissance du pic de reference se calcule
    // une fois pour toutes, elle est independante du framerate par construction.
    this.peakRefDecay = Math.exp(-this.hopSec / config.detectionPeakReleaseSec);
    for (let i = 0; i < 8; i++) this.pool.push(new MutableOnset());
    this.reset();
  }

  /** Retard de groupe compense, en secondes - expose pour le HUD et `syncOffsetMs`. */
  get analyserDelay(): number {
    return this.analyserDelaySec;
  }

  get count(): number {
    return this.poolCount;
  }

  at(i: number): OnsetEvent {
    const e = this.pool[i];
    if (!e) throw new RangeError(`OnsetDetector: onset ${i} hors des ${this.poolCount} emis`);
    return e;
  }

  /** Valeur normalisee du canal au pas evalue (`n-1`) - HUD et diagnostic. */
  normalizedAt(ch: number): number {
    return this.hist1[ch] ?? 0;
  }

  /** Seuil adaptatif courant du canal - HUD et diagnostic. */
  thresholdAt(ch: number): number {
    return this.config.peakLambda * (this.muNorm[ch] ?? 0) + this.config.peakDelta;
  }

  /** Les statistiques glissantes decrivent-elles quelque chose ? Avant, `detection` vaut 0. */
  get warmedUp(): boolean {
    return this.ticks >= this.warmupTicks;
  }

  /**
   * Plafond COMMUN aux trois canaux, suivant le pic recent le plus fort.
   *
   * Un plafond absolu en ecarts-types n'est pas neutre vis-a-vis du framerate :
   * a 120 fps l'energie d'une attaque s'etale sur deux fois plus de trames, le
   * pic normalise passe d'environ 8 a environ 4 sigma, et un plafond fixe a 5
   * n'ecrete plus rien. L'asymetrie du backbeat revient alors dans la fonction
   * de detection et le moteur monte d'un niveau metrique : mesure de 63,9 BPM
   * a 120 fps contre 127,9 a 60 fps sur le meme click track.
   *
   * Un plafond PAR CANAL ne marche pas non plus : le charley culmine bien plus
   * bas que le kick, son plafond propre l'ecraserait et la fonction de
   * detection redeviendrait dominee par l'alternance kick / kick+snare.
   * Mesure : 63,8 BPM a 128 BPM. C'est bien un plafond unique, suivant le pic
   * le plus fort, qui preserve les rapports entre canaux a toute cadence.
   */
  private contributionCap(norm: Float32Array): number {
    const m = Math.max(norm[CH_KICK] ?? 0, norm[CH_SNARE] ?? 0, norm[CH_HAT] ?? 0);
    const ref = Math.max(m, this.peakRef[0]! * this.peakRefDecay);
    this.peakRef[0] = ref;
    return Math.max(1, ref) * this.config.detectionClampFraction;
  }

  /** Instant du dernier onset de ce type, ou `-Infinity`. Sert aux enveloppes visuelles (§2.7.2). */
  lastTime(kind: OnsetKind): number {
    return this.lastOnsetTime[channelOf(kind)]!;
  }

  lastStrength(kind: OnsetKind): number {
    return this.lastOnsetStrength[channelOf(kind)]!;
  }

  /**
   * Un pas de grille. Les candidats sont evalues a `n-1` (maximum local), donc
   * un tick de retard sur l'entree.
   *
   * @param tickTime    instant du pas courant, horloge audio.
   * @param values      les 5 canaux (voir CH_*).
   * @param periodSec   periode courante de `BeatClock`, pour le refractaire relatif.
   * @param confidence  confiance de tempo : sous 0.5 le refractaire reste absolu.
   */
  tick(tickTime: number, values: Float32Array, periodSec: number, confidence: number): void {
    this.poolCount = 0;
    const prevTime = this.histTime;
    const useRelative = confidence > 0.5;

    // 1. Normalisation de chaque canal pique, avec les statistiques ANTERIEURES.
    const norm = this.normalizeChannels(values);
    // Contribution par canal ECRETEE. L'autocorrelation est une somme de
    // produits : un unique pas a 50 sigma - ce que produit le transitoire de
    // sortie de rodage, ou un changement brutal de niveau - pese 150 fois un
    // pas ordinaire a 4 sigma et fixe a lui seul toute la fenetre de 8 s.
    // Mesure sur click track 128 BPM gigue 2 % : `r[temps]/r[2 temps]` tombait
    // a 0,375 (contre 0,90 sur la meme fenetre sans le transitoire), le
    // moteur montait d'un niveau metrique et verrouillait 63,8 BPM.
    const cap = this.contributionCap(norm);
    this.detection =
      clampPositive(norm[CH_KICK] ?? 0, cap) +
      clampPositive(norm[CH_SNARE] ?? 0, cap) +
      clampPositive(norm[CH_HAT] ?? 0, cap);

    // 2. Candidats a n-1, dans l'ordre kick -> snare -> hat (l'arbitrage de
    //    diaphonie a besoin du kick avant le snare).
    if (this.ticks >= this.warmupTicks + 2) {
      for (const ch of PICKED) {
        if (ch === CH_KICK_ENV) continue;
        this.evaluateCandidate(ch, norm, prevTime, periodSec, useRelative);
      }
    }

    // 3. Decalage de l'historique.
    const a = Math.max(this.statsAlpha, 1 / (this.ticks + 1));
    for (const ch of PICKED) {
      this.hist0[ch] = this.hist1[ch]!;
      this.hist1[ch] = norm[ch]!;
      this.muNorm[ch] = this.muNorm[ch]! + a * (norm[ch]! - this.muNorm[ch]!);
    }
    this.rawHist1[CH_FLATNESS] = values[CH_FLATNESS] ?? 0;
    this.histTime = tickTime;
    this.ticks++;
  }

  /**
   * Statistiques glissantes O(1) avec CORRECTION DE BIAIS au demarrage.
   *
   * Sans elle, au premier pas la variance vaut 0 et `(x - mu) / (sigma + 1e-6)`
   * produit des valeurs de l'ordre de 1e6 ; la moyenne glissante de la valeur
   * normalisee - qui sert de seuil - met alors plusieurs dizaines de secondes a
   * redescendre, et AUCUN onset ne passe pendant ce temps. Mesure sur click
   * track 128 BPM : seuil a 439 apres 2 s, 11 kicks detectes sur 42.
   *
   * L'alpha effectif vaut `max(1/(k+1), alphaCible)` : moyenne exacte tant que
   * la fenetre n'est pas remplie, EMA ensuite. Les candidats ne sont pas
   * evalues avant `warmupTicks`.
   */
  private normalizeChannels(values: Float32Array): Float32Array {
    const out = this.scratch;
    const a = Math.max(this.statsAlpha, 1 / (this.ticks + 1));
    for (const ch of PICKED) {
      const x = values[ch] ?? 0;
      const mu = this.mu[ch]!;
      const sigma = Math.sqrt(this.variance[ch]!);
      const raw = this.ticks < this.warmupTicks ? 0 : (x - mu) / (sigma + 1e-6);
      // Borne dure : un unique pas aberrant ne doit pas pouvoir deplacer le
      // seuil hors de portee pour la seconde qui suit.
      out[ch] = raw > 50 ? 50 : raw < -20 ? -20 : raw;
      // Mise a jour APRES usage : sinon un pic gonfle sa propre reference et
      // s'auto-supprime.
      const nextMu = mu + a * (x - mu);
      const dev = x - nextMu;
      this.mu[ch] = nextMu;
      this.variance[ch] = this.variance[ch]! + a * (dev * dev - this.variance[ch]!);
    }
    return out;
  }

  private evaluateCandidate(
    ch: number,
    norm: Float32Array,
    candidateTime: number,
    periodSec: number,
    useRelative: boolean,
  ): void {
    const value = this.hist1[ch]!;
    // Maximum local strict a gauche, large a droite : un plateau de deux pas
    // ne produit qu'un seul onset.
    if (!(value > this.hist0[ch]! && value >= norm[ch]!)) return;

    const threshold = this.config.peakLambda * this.muNorm[ch]! + this.config.peakDelta;
    if (value < threshold) return;

    if (ch === CH_HAT && this.rawHist1[CH_FLATNESS]! <= this.config.hatFlatnessGate) return;

    if (ch === CH_KICK) {
      // Coincidence flux spectral / enveloppe temporelle dans une fenetre de
      // +/- un pas de grille autour du candidat (40 ms), la resolution la plus
      // fine possible sur une grille a 50 Hz pour la fenetre de 30 ms de §2.3.
      const env = Math.max(this.hist0[CH_KICK_ENV]!, this.hist1[CH_KICK_ENV]!, norm[CH_KICK_ENV]!);
      if (env < this.config.kickEnvGate) return;
    }

    const strength = clamp01((value - threshold) / this.config.peakStrengthScale);
    // INTERPOLATION PARABOLIQUE du pic. Sans elle l'instant d'onset est
    // quantifie au pas de grille (20 ms), et sur un signal periodique cette
    // quantification n'est PAS un bruit independant : le motif d'arrondi se
    // repete (a 128 BPM la periode vaut 23,44 pas, le residu boucle tous les
    // ~2,3 temps) et biaise systematiquement toute estimation de periode
    // ajustee sur ces instants. Mesure : 126,6 BPM au lieu de 128 sans
    // interpolation, 128,0 avec.
    const y0 = this.hist0[ch]!;
    const y1 = value;
    const y2 = norm[ch]!;
    const denom = y0 - 2 * y1 + y2;
    const delta = denom < -1e-9 ? clamp(0.5 * (y0 - y2) / denom, -0.5, 0.5) : 0;
    const onsetTime = candidateTime + delta * this.hopSec - this.analyserDelaySec;

    if (this.isRefractory(ch, onsetTime, periodSec, useRelative)) return;
    if (this.isCrosstalkSuppressed(ch, onsetTime, strength)) return;

    this.lastOnsetTime[ch] = onsetTime;
    this.lastOnsetStrength[ch] = strength;
    this.emit(KIND_OF[ch] ?? 'kick', onsetTime, strength);
  }

  private isRefractory(ch: number, onsetTime: number, periodSec: number, useRelative: boolean): boolean {
    const c = this.config;
    const baseMs = ch === CH_KICK ? c.refractoryKickMs : ch === CH_SNARE ? c.refractorySnareMs : c.refractoryHatMs;
    const beats = ch === CH_KICK ? c.refractoryKickBeats : ch === CH_SNARE ? c.refractorySnareBeats : c.refractoryHatBeats;
    const relativeMs = useRelative ? beats * periodSec * 1000 : 0;
    const refractorySec = Math.max(baseMs, relativeMs) / 1000;
    return onsetTime - this.lastOnsetTime[ch]! < refractorySec;
  }

  /**
   * Diaphonie kick <-> snare (§2.3) : dans une fenetre de 25 ms, seul le plus
   * fort survit. Regle causale - l'onset anterieur est deja emis, donc c'est
   * le plus recent qui est supprime s'il est plus faible. Le cas symetrique
   * (kick emis, snare plus fort juste apres) laisse passer le snare, qui est
   * le comportement voulu ; c'est bien le clic large bande du kick fuyant vers
   * le detecteur de snare que la regle doit tuer, et la moyenne geometrique
   * l'a deja largement attenue en amont.
   */
  private isCrosstalkSuppressed(ch: number, onsetTime: number, strength: number): boolean {
    if (ch !== CH_KICK && ch !== CH_SNARE) return false;
    const other = ch === CH_KICK ? CH_SNARE : CH_KICK;
    const gapSec = onsetTime - this.lastOnsetTime[other]!;
    if (gapSec < 0 || gapSec > this.config.crosstalkMs / 1000) return false;
    return strength <= this.lastOnsetStrength[other]!;
  }

  private emit(kind: OnsetKind, tSec: number, strength: number): void {
    while (this.poolCount >= this.pool.length) this.pool.push(new MutableOnset());
    const e = this.pool[this.poolCount]!;
    e.kind = kind;
    e.tSec = tSec;
    e.strength = strength;
    this.poolCount++;
  }

  /** Desarme les detecteurs sans perdre les statistiques (gate de silence, §2.6). */
  clearEvents(): void {
    this.poolCount = 0;
  }

  reset(): void {
    this.poolCount = 0;
    this.detection = 0;
    this.mu.fill(0);
    this.variance.fill(0);
    this.muNorm.fill(0);
    this.hist0.fill(0);
    this.hist1.fill(0);
    this.rawHist1.fill(0);
    this.lastOnsetTime.fill(Number.NEGATIVE_INFINITY);
    this.lastOnsetStrength.fill(0);
    this.scratch.fill(0);
    this.peakRef.fill(0);
    this.histTime = 0;
    this.ticks = 0;
  }
}

function channelOf(kind: OnsetKind): number {
  return kind === 'kick' ? CH_KICK : kind === 'snare' ? CH_SNARE : CH_HAT;
}
