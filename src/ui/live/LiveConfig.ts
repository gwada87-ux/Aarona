/**
 * Configuration centrale du mode live (PROMPT §5.1). Regle absolue : aucune
 * constante de reglage ailleurs dans `src/ui/live/`. Un nombre qui subsiste
 * hors de ce fichier doit etre soit geometrique, soit mathematique.
 *
 * Seuls les groupes consommes par l'etape 1 (§9.1) existent : `audio`, `beat`,
 * `sync`, `state`, `content`. Les groupes `render` / `director` / `perf` /
 * `safety` seront ajoutes par les etapes suivantes, quand ils auront un
 * consommateur - `CLAUDE.md` interdit les options sans usage.
 *
 * Fusion : `mergeLiveConfig` fusionne sur DEUX niveaux (groupe -> champ). Un
 * champ dont la valeur est elle-meme un objet (`kickHz`, ...) est remplace en
 * bloc, jamais fusionne champ a champ - comportement previsible et suffisant.
 */

/** Bornes d'une plage de frequences, en Hz. */
export interface LiveHzRange {
  readonly lo: number;
  readonly hi: number;
}

/** Macro-bandes de §2.2. `presence` est indispensable au detecteur de snare et au vecteur de nouveaute de mesure. */
export type MacroBandId = 'sub' | 'bass' | 'mid' | 'presence' | 'air';

export const MACRO_BAND_IDS: readonly MacroBandId[] = ['sub', 'bass', 'mid', 'presence', 'air'];

export interface LiveAudioConfig {
  /** Taille FFT de l'analyseur d'onsets. 2048 = reactivite ; plus grand tue les transitoires. */
  readonly fftSizeOnset: number;
  /** Taille FFT de l'analyseur de niveaux. 8192 : a 2048 les 7-8 bandes log les plus graves font moins d'un bin. */
  readonly fftSizeBands: number;
  /** Lissage interne des AnalyserNode. 0 impose : tout le lissage est fait par bande et par usage ici. Plage utile 0-0.15. */
  readonly smoothingTimeConstant: number;
  /** Plancher dB des AnalyserNode. -90 au lieu de -100 : evite la saturation des bins graves sur un master moderne. */
  readonly minDecibels: number;
  /** Plafond dB des AnalyserNode. 0 au lieu de -30, meme raison. */
  readonly maxDecibels: number;
  /** Plancher explicite applique avant tout calcul, en dBFS (§2.3.1). Sous -80 le bruit de quantification domine. */
  readonly dbFloor: number;
  /** Frequence de la grille d'analyse, en Hz. 50 = hop 20 ms. Plage utile 40-60. */
  readonly gridHz: number;
  /** Profondeur d'historique de la fonction de detection, en secondes. 8 s = 400 echantillons a 50 Hz. */
  readonly gridSeconds: number;
  /** Au-dela de ce trou entre deux lectures (s), la grille se re-ancre au lieu d'interpoler (retour d'onglet). */
  readonly gridReanchorSec: number;
  /** Decroissance du blanchiment adaptatif par bin, en dB/s. Plage utile 20-50. */
  readonly whiteningDecayDbPerSec: number;
  /** Bande du detecteur de kick. 30-150 Hz ; le bin bas est de toute facon force a 2 (composante continue exclue). */
  readonly kickHz: LiveHzRange;
  /** Moitie basse du detecteur snare/clap (moyenne geometrique avec la moitie haute). */
  readonly snareLowHz: LiveHzRange;
  /** Moitie haute du detecteur snare/clap. */
  readonly snareHighHz: LiveHzRange;
  /** Bande du detecteur de charley. 4-12 kHz : les codecs coupent vers 15-17 kHz, le transitoire est vers 6-8 kHz. */
  readonly hatHz: LiveHzRange;
  /** Porte de platitude spectrale du charley. Sous ce seuil le contenu est tonal, pas un transitoire de cymbale. */
  readonly hatFlatnessGate: number;
  /** Plage de calcul de la platitude spectrale (§2.2). Hors de 2-12 kHz la mesure n'a pas de sens ici. */
  readonly flatnessHz: LiveHzRange;
  /** Coupure du passe-bas 1 pole servant a l'enveloppe temporelle du kick, en Hz. */
  readonly kickEnvCutoffHz: number;
  /** Seuil normalise que l'enveloppe temporelle doit franchir pour confirmer un kick spectral. */
  readonly kickEnvGate: number;
  /** Fenetre de coincidence flux spectral / enveloppe temporelle du kick, en ms (§2.3, table). */
  readonly kickEnvWindowMs: number;
  /** Facteur `lambda` du seuil de peak-picking. Plage utile 1.2-2.0. */
  readonly peakLambda: number;
  /** Terme additif `delta` du seuil de peak-picking. Plage utile 0.5-1.5. */
  readonly peakDelta: number;
  /** Diviseur convertissant le depassement de seuil en force 0-1. Plus grand = frappes moins souvent a pleine force. */
  readonly peakStrengthScale: number;
  /** Fenetre des statistiques glissantes du peak-picking, en secondes. 1 s = 50 echantillons. */
  readonly peakStatsSeconds: number;
  /**
   * Ecretage de la contribution d'un canal a la fonction de detection large
   * bande consommee par `TempoEstimator`, en FRACTION du pic recent du canal.
   *
   * Deux raisons de compresser : l'autocorrelation est une somme de produits,
   * donc un pas isole tres au-dessus du reste fixe a lui seul toute la fenetre
   * de 8 s ; et sans compression, un temps portant trois instruments pese
   * bien plus qu'un temps n'en portant que deux, ce qui fait lire un backbeat
   * ordinaire comme « un temps sur deux est vide » (mesure : 63,8 BPM au lieu
   * de 128). Ne concerne PAS le peak-picking, qui lit la valeur entiere pour
   * calculer la force de la frappe.
   *
   * Exprime en fraction et non en ecarts-types absolus : voir
   * `OnsetDetector.clampContribution` pour la dependance au framerate d'un
   * plafond absolu. Plage utile 0.5-0.75.
   */
  readonly detectionClampFraction: number;
  /** Relachement du pic de reference servant a l'ecretage, en secondes. */
  readonly detectionPeakReleaseSec: number;
  /**
   * Duree de rodage du peak-picking, en fraction de `peakStatsSeconds`. Avant,
   * aucun candidat n'est evalue, la fonction de detection vaut 0 et rien n'est
   * pousse dans la fenetre d'autocorrelation.
   *
   * 0,5 (soit 0,5 s) est un plancher mesure : a 0,2 le residu de rodage entre
   * dans la fenetre et le moteur double le tempo sur click track 90 BPM
   * (179,96 au lieu de 90).
   */
  readonly warmupFraction: number;
  /** Plancher de refractaire du kick, en ms. Un fixe a 90 ms bloquerait les doubles-croches au-dessus de 165 BPM. */
  readonly refractoryKickMs: number;
  /** Refractaire du kick relatif a la periode, en temps. Actif des que `confidence > 0.5`. */
  readonly refractoryKickBeats: number;
  /** Plancher de refractaire du snare, en ms. */
  readonly refractorySnareMs: number;
  /** Refractaire du snare relatif a la periode, en temps. */
  readonly refractorySnareBeats: number;
  /** Plancher de refractaire du charley, en ms. */
  readonly refractoryHatMs: number;
  /** Refractaire du charley relatif a la periode, en temps. */
  readonly refractoryHatBeats: number;
  /** Fenetre d'arbitrage kick/snare, en ms : dans cet ecart, seul le plus fort survit. */
  readonly crosstalkMs: number;
  /** Nombre de bandes log du mandala. */
  readonly bandCount: number;
  /** Borne basse des bandes log, en Hz. */
  readonly bandMinHz: number;
  /** Borne haute des bandes log, en Hz. Au-dela, les codecs ne transmettent plus rien. */
  readonly bandMaxHz: number;
  /** Constante d'attaque des enveloppes de bande, en secondes. Sous 15 ms c'est de fait instantane a 60 fps. */
  readonly envAttackSec: number;
  /** Constante de relachement des enveloppes de bande, en secondes. Plage utile 0.15-0.20. C'est le vrai reglage. */
  readonly envReleaseSec: number;
  /** Constante de relachement du RMS perceptuel, en secondes. Plage utile 0.3-0.5. */
  readonly rmsReleaseSec: number;
  /** Relachement du suiveur de crete de l'AGC, en secondes. Trop court = pompage, trop long = plus de contraste au drop. */
  readonly agcReleaseSec: number;
  /** Plancher absolu de l'AGC, en unites d'energie normalisee : empeche la division par un residu de bruit. */
  readonly agcFloor: number;
}

export interface LiveBeatConfig {
  /** Borne basse de la plage de tempo recherchee, en BPM. */
  readonly bpmMin: number;
  /** Borne haute de la plage de tempo recherchee, en BPM. */
  readonly bpmMax: number;
  /** Cadence de reevaluation du tempo en regime etabli, en Hz. Plage utile 2-8. Entre deux evaluations c'est BeatClock qui interpole. */
  readonly tempoEvalHz: number;
  /** Cadence de reevaluation tant que la confiance est sous `tempoAdoptGuardConfidence`, en Hz. Cout mesure : ~0,5 ms par evaluation. */
  readonly tempoEvalHzAcquiring: number;
  /** Paliers de croissance de la fenetre d'autocorrelation, en secondes (§2.4). */
  readonly tempoWindowStagesSec: readonly number[];
  /** Confiance plafonnee tant que la fenetre n'a pas depasse le premier palier. */
  readonly tempoEarlyConfidenceCap: number;
  /** Poids des harmoniques 1x a 4x dans le score de famille d'octave. */
  readonly tempoHarmonicWeights: readonly number[];
  /** Centre de l'a priori log-normal de tempo, en BPM. Standard en MIR. */
  readonly tempoPriorCenterBpm: number;
  /** Ecart-type de l'a priori, en octaves. */
  readonly tempoPriorSigmaOct: number;
  /**
   * Pas de la passe GROSSIERE de recherche de lag, en echantillons de grille.
   * Contrainte dure : `pas * harmoniqueMax` doit rester sous la demi-largeur du
   * pic d'autocorrelation (~0,5 echantillon, mesure), sinon le score de famille
   * evalue ses harmoniques dans les creux. 0.1 * 4 = 0.4 < 0.5.
   */
  readonly tempoCoarseStep: number;
  /** Pas de la passe FINE, en echantillons de grille. 0.02 => ~0.11 BPM a 128 BPM. */
  readonly tempoFineStep: number;
  /** Demi-largeur de la passe fine, en NOMBRE DE PAS GROSSIERS autour de l'argmax grossier. */
  readonly tempoFineSpanSteps: number;
  /**
   * DESCENTE d'un niveau metrique (aller plus vite) : rapport
   * `r[niveau rapide] / r[niveau lent]` au-dessus duquel le niveau rapide EST
   * le temps. Mesure : 1,01 a 1,09 quand la descente est necessaire (174 BPM),
   * 0,50 a 0,66 quand elle serait fausse (90 BPM). Plage utile 0.72-0.90.
   */
  readonly octaveDescendAcfRatio: number;
  /**
   * MONTEE d'un niveau metrique (aller moins vite) : rapport
   * `r[niveau courant] / r[niveau double]` SOUS lequel le niveau courant est
   * juge non soutenu. Mesure : jamais moins de 0,429 sur l'ensemble des cas
   * ou la montee serait fausse, d'ou 0,35. Un seuil symetrique a celui de la
   * descente ferait pulser a demi-vitesse des que le framerate change.
   */
  readonly octaveAscendAcfRatio: number;
  /**
   * Rapport energie(temps forts)/energie(temps faibles) au-dessus duquel les
   * positions intermediaires comptent comme vides. Condition CORROBORANTE de
   * la montee uniquement - seul, ce critere lit un backbeat ordinaire (mesure
   * 4,2 a 128 BPM) comme un temps sur deux vide.
   */
  readonly octaveHalveRatio: number;
  /** Domination requise du challenger pour changer d'octave. 1.4 = 40 %. */
  readonly octaveSwitchDominance: number;
  /** Duree pendant laquelle le challenger doit dominer avant un changement d'octave, en secondes. */
  readonly octaveSwitchHoldSec: number;
  /** Domination requise du score pour adopter un nouveau BPM. 1.15 = 15 %. */
  readonly tempoAdoptDominance: number;
  /** Nombre d'evaluations consecutives dominantes avant adoption. 3 a 4 Hz = 0.75 s. */
  readonly tempoAdoptHoldEvals: number;
  /** Sous cette confiance, l'adoption est immediate : l'hysteresis protege un verrouillage etabli, pas une premiere hypothese. */
  readonly tempoAdoptGuardConfidence: number;
  /** Rapport pic principal / second pic non harmonique requis pour depasser 0.6 de confiance. */
  readonly tempoSecondPeakRatio: number;
  /** Confiance maximale tant que ce rapport n'est pas atteint. */
  readonly tempoSecondPeakCap: number;
  /** Gain de phase du PLL. */
  readonly pllAlpha: number;
  /** Gain de periode du PLL. Doit rester 10-20x plus petit qu'alpha, sinon la periode oscille. */
  readonly pllBeta: number;
  /** Fenetre d'acceptation d'un onset, en fraction de temps. Au-dela : syncope ou ghost note, ignoree. Plage utile 0.08-0.18. */
  readonly pllAcceptPhase: number;
  /** Correction de phase maximale par onset, en temps. Borne dure. */
  readonly pllMaxCorrection: number;
  /**
   * Correction de phase maximale APPLIQUEE par trame, en ms de temps musical.
   * Toute correction plus grande (acquisition, resynchronisation dure) est
   * etalee sur plusieurs trames. Doit rester sous le critere §8.4 de 20 ms.
   */
  readonly resyncMaxJumpMs: number;
  /** Borne basse de la periode, en secondes (200 BPM). */
  readonly periodMinSec: number;
  /** Borne haute de la periode, en secondes (60 BPM). */
  readonly periodMaxSec: number;
  /** Variation relative maximale de periode par correction d'onset. */
  readonly periodMaxRelStep: number;
  /** Fenetre d'ajustement de periode par moindres carres sur les instants d'onsets, en secondes. */
  readonly periodFitWindowSec: number;
  /** Nombre minimal d'onsets avant que l'ajustement par moindres carres prenne le pas sur `beta * e`. */
  readonly periodFitMinPoints: number;
  /** Residu RMS maximal de l'ajustement, en fraction de temps. Au-dela, la droite ne decrit pas la grille et est rejetee. */
  readonly periodFitMaxResidual: number;
  /** Avance de phase maximale absorbee en une trame, en secondes (survit a une trame de 500 ms). */
  readonly phaseAdvanceClampSec: number;
  /** Nombre maximal de temps emis en une trame. Borne le `while` d'avance de phase. */
  readonly maxBeatsPerFrame: number;
  /** Temps par mesure. L'hypothese 4/4 est explicite et configurable. */
  readonly beatsPerBar: number;
  /** Mesures par phrase. */
  readonly barsPerPhrase: number;
  /** Nombre de kicks consecutifs hors fenetre avant resynchronisation dure. */
  readonly hardResyncMisses: number;
  /** Erreur de phase au-dela de laquelle un kick compte comme desynchronise. */
  readonly hardResyncPhaseErr: number;
  /** Duree de rampe de periode lors d'un changement de BPM inferieur au seuil dur, en secondes. */
  readonly tempoRampSec: number;
  /** Ecart relatif de BPM au-dela duquel la rampe de periode devient courte au lieu de longue. */
  readonly tempoHardResetRel: number;
  /** Duree de la rampe courte, en secondes. Assez breve pour ne pas laisser de tempo perime, assez longue pour ne pas deplacer l'ancre de temps de plus de `resyncMaxJumpMs`. */
  readonly tempoHardResetRampSec: number;
  /** Poids de l'indice backbeat dans le vote de downbeat. Indice principal. */
  readonly downbeatWeightBackbeat: number;
  /** Poids de l'indice de nouveaute de mesure. */
  readonly downbeatWeightNovelty: number;
  /** Poids de l'indice de saut d'energie basse frequence. */
  readonly downbeatWeightBassJump: number;
  /** Poids de l'indice d'energie kick. Faible : inutile en four-on-the-floor. */
  readonly downbeatWeightKick: number;
  /** Horizon de la moyenne exponentielle du vote de downbeat, en mesures. Plage utile 8-16. */
  readonly downbeatEmaBars: number;
  /** Domination requise du challenger pour changer de downbeat. 1.25 = 25 %. */
  readonly downbeatSwitchDominance: number;
  /** Nombre de mesures pendant lesquelles le challenger doit dominer. */
  readonly downbeatSwitchHoldBars: number;
  /** Sous cette confiance de downbeat, la phrase n'existe pas : le director ne quantifie plus que sur le temps et 2 mesures. */
  readonly downbeatPhraseThreshold: number;
}

export interface LiveSyncConfig {
  /**
   * `true` = la retro-datation §2.3 est active dans `OnsetDetector`, donc
   * `analyserDelayMs` et `pickLookaheadMs` sont DEJA compenses et ne sont pas
   * recomptes dans `syncOffsetMs`. Le passer a `false` reproduit litteralement
   * la formule §2.5, au prix de 43 ms d'avance. Voir NOTES.md, ecart n°2.
   */
  readonly onsetBackdatingApplied: boolean;
  /** Retard du maximum local sur la grille 50 Hz, en ms. Vaut un pas de grille. */
  readonly pickLookaheadMs: number;
  /** Retard d'affichage estime, en intervalles de trame. 1.5 trame ~= 25 ms a 60 Hz. */
  readonly presentDelayFrames: number;
  /** Intervalle de trame de repli quand aucune mesure n'est encore disponible, en secondes. */
  readonly fallbackFrameIntervalSec: number;
  /** `outputLatency` de repli quand le navigateur ne l'expose pas (Safari), en secondes. */
  readonly fallbackOutputLatencySec: number;
  /** Reglage manuel final, en ms. Positif = le visuel tombe en avance. Plage utile +/- 80 ms. */
  readonly userTrimMs: number;
  /** Pas de reglage de `userTrimMs` aux fleches du HUD, en ms. */
  readonly userTrimStepMs: number;
  /** Periode de recalcul de `audioAheadMs`, en secondes. */
  readonly latencyRecomputeSec: number;
}

export interface LiveStateConfig {
  /** Duree de l'etat BOOT apres `start()`, en secondes. */
  readonly bootSec: number;
  /** Seuil d'ENTREE en IDLE, en dBFS. */
  readonly idleEnterDbfs: number;
  /** Duree sous le seuil avant de basculer en IDLE, en secondes. */
  readonly idleEnterSec: number;
  /** Seuil de SORTIE d'IDLE, en dBFS. Hysteresis obligatoire avec `idleEnterDbfs`. */
  readonly idleExitDbfs: number;
  /** Duree au-dessus du seuil avant de quitter IDLE, en secondes. */
  readonly idleExitSec: number;
  /** Duree de roue libre de BeatClock en IDLE avant mise en veille, en secondes. Le BPM est conserve. */
  readonly idleFreewheelSec: number;
  /** Sous cette confiance, l'etat est REACTIVE. */
  readonly reactiveConfidence: number;
  /** Au-dessus de cette confiance, l'etat peut passer LOCKED. Un seuil unique ferait osciller le director. */
  readonly lockedConfidence: number;
  /** Duree de stabilite requise au-dessus de `lockedConfidence` avant LOCKED, en secondes. */
  readonly lockedHoldSec: number;
  /** Duree de croisement REACTIVE <-> LOCKED, en secondes. */
  readonly lockedCrossSec: number;
  /** Silence au-dela duquel on considere un changement de morceau, en secondes. */
  readonly trackChangeSilenceSec: number;
  /** Ecart relatif de tempo candidat declenchant un changement de morceau. */
  readonly trackChangeTempoRel: number;
  /** Duree pendant laquelle l'ecart de tempo doit persister, en secondes. */
  readonly trackChangeTempoSec: number;
  /** Clamp dur de `dt`, en secondes. Aucun rattrapage au retour d'onglet. */
  readonly dtClampSec: number;
  /** Absence d'onglet au-dela de laquelle on fait un re-arm complet, en secondes. */
  readonly hiddenReArmSec: number;
}

export interface LiveRenderConfig {
  /** Plafond memoire de l'ensemble des calques, en Mo. Safari plafonne la memoire canvas GLOBALE vers 224-256 Mo. */
  readonly layerMemoryLimitMb: number;
  /** Largeur maximale du bitmap de post, en pixels physiques. Le DPR ne sert qu'au calque HUD. */
  readonly postMaxWidth: number;
  /** Hauteur maximale du bitmap de post, en pixels physiques. */
  readonly postMaxHeight: number;
  /** Constante de temps du feedback, en secondes. 0,13 s reproduit un alpha de 0,88 a 60 fps. */
  readonly feedbackTauSec: number;
  /** Amplitude de la « respiration » du feedback sur `barPhase`, en fraction de tau. */
  readonly feedbackBreath: number;
  /** Zoom du feedback par trame. Au-dela de 1,02 l'image part en tunnel. */
  readonly feedbackZoom: number;
  /** Borne basse du facteur de decroissance par trame. */
  readonly feedbackKMin: number;
  /** Borne haute. Au-dela de 0,95 l'image ne se vide plus jamais. */
  readonly feedbackKMax: number;
  /** Gain d'injection de la scene dans le feedback. <= 1, pondere par (1-k) pour eviter l'emballement. */
  readonly feedbackSceneGain: number;
  /** Seuil de luminance du bright pass, 0-1. Variante B uniquement (necessite ctx.filter). */
  readonly bloomThreshold: number;
  /** Contraste du bright pass, variante B. Plus grand = seuil plus raide. */
  readonly bloomContrast: number;
  /** Gain de recomposition du bloom. */
  readonly bloomGain: number;
  /** Rayon de flou de base, en pixels pour un buffer de 1080 de haut. Recalcule a la hauteur reelle. */
  readonly bloomSigmaAt1080: number;
  /** Cote de la tuile de grain, en pixels. */
  readonly grainTileSize: number;
  /** Amplitude maximale du grain, sur 255. Additif. */
  readonly grainAmplitude255: number;
  /** Sous ce deplacement en pixels device, l'aberration est SAUTEE - elle ne produirait rien de visible. */
  readonly aberrationGatePx: number;
  /** Deplacement maximal de l'aberration, en pixels device. */
  readonly aberrationMaxPx: number;
  /** Force de la vignette, 0-1. */
  readonly vignetteStrength: number;
  /** Opacite des scanlines, 0-1. */
  readonly scanlineStrength: number;
  /** Periode des scanlines, en pixels du bitmap de post. */
  readonly scanlinePeriodPx: number;
}

export interface LivePerfConfig {
  /** Nombre de trames servant a ESTIMER la periode de reference. Jamais 16,7 ms en dur. */
  readonly calibrationFrames: number;
  /** Taille de la fenetre glissante de decision. */
  readonly windowFrames: number;
  /** Nombre de trames lentes dans la fenetre declenchant une descente de qualite. */
  readonly slowFrames: number;
  /** Multiple de la periode de reference au-dela duquel une trame est « lente ». */
  readonly slowFactor: number;
  /** Nombre de trames rapides CONSECUTIVES declenchant une remontee. */
  readonly goodFrames: number;
  /** Multiple de la periode sous lequel une trame est « rapide ». L'ecart avec `slowFactor` EST la zone morte. */
  readonly fastFactor: number;
  /** Delai minimal entre deux changements de niveau, en ms. */
  readonly qualityCooldownMs: number;
  /** Au-dela de cette duree, une trame est un retour d'onglet ou un GC, pas une trame lente. */
  readonly outlierFrameMs: number;
  /** Gel de l'adaptation apres un resize, en ms. */
  readonly resizeFreezeMs: number;
  /** Gel de l'adaptation pendant une transition de scene, en ms. */
  readonly transitionFreezeMs: number;
}

export interface LiveDirectorConfig {
  /** Duree minimale d'une scene, en secondes. Suspendue par un drop (§4.3). */
  readonly minSceneSec: number;
  /** Duree maximale d'une scene, en secondes. Au-dela, coupe a la prochaine frontiere de phrase. */
  readonly maxSceneSec: number;
  /** Si aucune frontiere de phrase n'arrive avant ce delai, on coupe a la prochaine frontiere de mesure. */
  readonly hardMaxSceneSec: number;
  /** Ecart minimal entre deux coupes, en MESURES. Seule contrainte qui survit a un drop. */
  readonly minBarsBetweenCuts: number;
  /** Nombre de scenes qui doivent passer avant qu'une scene revienne. Borne a `nombre de scenes - 1`. */
  readonly antiRepeat: number;
  /** Duree maximale d'un fondu de transition, en fraction de mesure. */
  readonly maxCrossfadeBars: number;
  /** Resolution de la couche scene pendant une transition. Les deux scenes coexistent : on la reduit. */
  readonly transitionScale: number;
  /** Mode degrade : creux d'energie sous cette fraction de la moyenne glissante. */
  readonly degradedTroughRatio: number;
  /** Duree minimale du creux, en secondes. */
  readonly degradedTroughSec: number;
  /** Minuteur de secours du mode degrade, en secondes. */
  readonly degradedTimerSec: number;
  /** Duree du fondu en mode degrade, en secondes. Une coupe seche n'a de sens que sur une grille. */
  readonly degradedFadeSec: number;
  /** Duree de vie minimale d'un overlay, en MESURES. Empeche le clignotement. */
  readonly overlayMinBars: number;
}

export interface LiveSafetyConfig {
  /** Respecter `prefers-reduced-motion`. Mettre a `false` desactive l'adaptation, pas la detection. */
  readonly respectReducedMotion: boolean;
  /** Plafond du facteur de decroissance du feedback en mouvement reduit. */
  readonly reducedFeedbackKMax: number;
  /** Diviseur d'amplitude applique aux reactions en mouvement reduit. */
  readonly reducedAmplitudeDivider: number;
  /** Duree minimale d'une transition en mouvement reduit, en secondes. Fondu uniquement, jamais de coupe. */
  readonly reducedTransitionSec: number;
}

export interface LiveIntensityConfig {
  /** Sous cette intensite, un seul overlay expressif est autorise (§2.8). */
  readonly overlayThreshold1: number;
  /** Sous celle-ci, deux. Au-dela, trois. */
  readonly overlayThreshold2: number;
  /** Fraction de la moyenne glissante de luminance sous laquelle un temps compte comme « vide ». */
  readonly voidFloorRatio: number;
  /** Nombre de temps CONSECUTIFS vides exiges par phrase. */
  readonly voidFloorBeats: number;
  /** A partir de cette phase de phrase, si le vide n'a pas eu lieu, il est FORCE. */
  readonly voidForceFrom: number;
  /** Amplitude de reaction dans les 2 dernieres mesures d'une montee. < 1 : la retenue avant impact. */
  readonly buildRestraint: number;
  /** Nombre de mesures de retenue avant l'impact. */
  readonly buildRestraintBars: number;
  /** Mesures d'explosion maximale apres un drop. */
  readonly dropExplosionBars: number;
  /** Mesures de retombee apres l'explosion. */
  readonly dropFalloutBars: number;
  /** Niveau d'intensite pendant la retombee, en fraction du niveau d'avant le drop. */
  readonly dropFalloutRatio: number;
  /** Luminance moyenne maximale en breakdown. Quasi-noir assume. */
  readonly breakdownLuminance: number;
  /** Seuil de saturation de la moyenne glissante de luminance (§2.8). */
  readonly saturationLimit: number;
  /** Fenetre de la moyenne glissante de luminance, en secondes. */
  readonly saturationWindowSec: number;
  /** Multiplicateur d'intensite au clavier : bornes. */
  readonly userScaleMin: number;
  readonly userScaleMax: number;
  readonly userScaleStep: number;
}

export interface LiveContentConfig {
  /** Ouvre le HUD de debug des le demarrage. Sinon touche `D`. */
  readonly debugHudOnStart: boolean;
  /** Index de palette impose. `-1` = laisser le moteur choisir. */
  readonly forcedPalette: number;
  /** Duree du fondu de palette sur frontiere de phrase, en secondes. 0 = coupe franche. */
  readonly paletteCrossfadeSec: number;
  /** Identifiant de scene impose. `''` = premiere scene jouable du registre. */
  readonly forcedScene: string;
}

export interface LiveConfig {
  readonly audio: LiveAudioConfig;
  readonly beat: LiveBeatConfig;
  readonly sync: LiveSyncConfig;
  readonly state: LiveStateConfig;
  readonly render: LiveRenderConfig;
  readonly perf: LivePerfConfig;
  readonly director: LiveDirectorConfig;
  readonly intensity: LiveIntensityConfig;
  readonly safety: LiveSafetyConfig;
  readonly content: LiveContentConfig;
}

/** Plages de macro-bandes en Hz (§2.2), independantes du `sampleRate` - la conversion en bins ne l'est pas. */
export const MACRO_BAND_HZ: Readonly<Record<MacroBandId, LiveHzRange>> = Object.freeze({
  sub: Object.freeze({ lo: 20, hi: 60 }),
  bass: Object.freeze({ lo: 60, hi: 160 }),
  mid: Object.freeze({ lo: 160, hi: 2000 }),
  presence: Object.freeze({ lo: 2000, hi: 6000 }),
  air: Object.freeze({ lo: 6000, hi: 16000 }),
});

export const DEFAULT_LIVE_CONFIG: LiveConfig = Object.freeze({
  audio: Object.freeze({
    fftSizeOnset: 2048,
    fftSizeBands: 8192,
    smoothingTimeConstant: 0,
    minDecibels: -90,
    maxDecibels: 0,
    dbFloor: -80,
    gridHz: 50,
    gridSeconds: 8,
    gridReanchorSec: 0.5,
    whiteningDecayDbPerSec: 30,
    kickHz: Object.freeze({ lo: 30, hi: 150 }),
    snareLowHz: Object.freeze({ lo: 150, hi: 400 }),
    snareHighHz: Object.freeze({ lo: 2000, hi: 6000 }),
    hatHz: Object.freeze({ lo: 4000, hi: 12000 }),
    hatFlatnessGate: 0.35,
    flatnessHz: Object.freeze({ lo: 2000, hi: 12000 }),
    kickEnvCutoffHz: 120,
    kickEnvGate: 0.8,
    kickEnvWindowMs: 30,
    peakLambda: 1.5,
    peakDelta: 0.8,
    peakStrengthScale: 3,
    peakStatsSeconds: 1,
    detectionClampFraction: 0.5,
    detectionPeakReleaseSec: 4,
    warmupFraction: 0.5,
    refractoryKickMs: 45,
    refractoryKickBeats: 0.22,
    refractorySnareMs: 45,
    refractorySnareBeats: 0.22,
    refractoryHatMs: 25,
    refractoryHatBeats: 0.1,
    crosstalkMs: 25,
    bandCount: 32,
    bandMinHz: 40,
    bandMaxHz: 18000,
    envAttackSec: 0.01,
    envReleaseSec: 0.18,
    rmsReleaseSec: 0.4,
    agcReleaseSec: 3,
    agcFloor: 1e-4,
  }),
  beat: Object.freeze({
    bpmMin: 60,
    bpmMax: 200,
    tempoEvalHz: 4,
    tempoEvalHzAcquiring: 8,
    tempoWindowStagesSec: Object.freeze([3, 6, 8]),
    tempoEarlyConfidenceCap: 0.5,
    tempoHarmonicWeights: Object.freeze([1, 0.5, 0.33, 0.25]),
    tempoPriorCenterBpm: 120,
    tempoPriorSigmaOct: 0.9,
    tempoCoarseStep: 0.1,
    tempoFineStep: 0.02,
    tempoFineSpanSteps: 3,
    octaveDescendAcfRatio: 0.8,
    octaveAscendAcfRatio: 0.35,
    octaveHalveRatio: 1.6,
    octaveSwitchDominance: 1.4,
    octaveSwitchHoldSec: 6,
    tempoAdoptDominance: 1.15,
    tempoAdoptHoldEvals: 3,
    tempoAdoptGuardConfidence: 0.55,
    tempoSecondPeakRatio: 1.25,
    tempoSecondPeakCap: 0.6,
    pllAlpha: 0.2,
    pllBeta: 0.01,
    pllAcceptPhase: 0.12,
    pllMaxCorrection: 0.05,
    resyncMaxJumpMs: 15,
    periodMinSec: 0.3,
    periodMaxSec: 1,
    periodMaxRelStep: 0.005,
    periodFitWindowSec: 4,
    periodFitMinPoints: 5,
    periodFitMaxResidual: 0.02,
    phaseAdvanceClampSec: 0.1,
    maxBeatsPerFrame: 4,
    beatsPerBar: 4,
    barsPerPhrase: 8,
    hardResyncMisses: 8,
    hardResyncPhaseErr: 0.25,
    tempoRampSec: 2,
    tempoHardResetRel: 0.05,
    tempoHardResetRampSec: 0.3,
    downbeatWeightBackbeat: 1.5,
    downbeatWeightNovelty: 1.2,
    downbeatWeightBassJump: 1,
    downbeatWeightKick: 0.5,
    downbeatEmaBars: 12,
    downbeatSwitchDominance: 1.25,
    downbeatSwitchHoldBars: 8,
    downbeatPhraseThreshold: 0.5,
  }),
  sync: Object.freeze({
    onsetBackdatingApplied: true,
    pickLookaheadMs: 20,
    presentDelayFrames: 1.5,
    fallbackFrameIntervalSec: 1 / 60,
    fallbackOutputLatencySec: 0.02,
    userTrimMs: 0,
    userTrimStepMs: 2,
    latencyRecomputeSec: 1,
  }),
  state: Object.freeze({
    bootSec: 1.5,
    idleEnterDbfs: -55,
    idleEnterSec: 1.5,
    idleExitDbfs: -50,
    idleExitSec: 0.2,
    idleFreewheelSec: 8,
    reactiveConfidence: 0.35,
    lockedConfidence: 0.55,
    lockedHoldSec: 2,
    lockedCrossSec: 0.5,
    trackChangeSilenceSec: 2.5,
    trackChangeTempoRel: 0.12,
    trackChangeTempoSec: 4,
    dtClampSec: 0.05,
    hiddenReArmSec: 1,
  }),
  render: Object.freeze({
    layerMemoryLimitMb: 120,
    postMaxWidth: 1920,
    postMaxHeight: 1080,
    feedbackTauSec: 0.13,
    feedbackBreath: 0.6,
    feedbackZoom: 1.005,
    feedbackKMin: 0.8,
    feedbackKMax: 0.94,
    feedbackSceneGain: 0.9,
    bloomThreshold: 0.62,
    bloomContrast: 10,
    bloomGain: 0.85,
    bloomSigmaAt1080: 9,
    grainTileSize: 256,
    grainAmplitude255: 10,
    aberrationGatePx: 1,
    aberrationMaxPx: 6,
    vignetteStrength: 0.55,
    scanlineStrength: 0.16,
    scanlinePeriodPx: 4,
  }),
  perf: Object.freeze({
    calibrationFrames: 60,
    windowFrames: 12,
    slowFrames: 8,
    slowFactor: 1.5,
    goodFrames: 90,
    fastFactor: 0.8,
    qualityCooldownMs: 500,
    outlierFrameMs: 500,
    resizeFreezeMs: 500,
    transitionFreezeMs: 1000,
  }),
  director: Object.freeze({
    minSceneSec: 15,
    maxSceneSec: 60,
    hardMaxSceneSec: 75,
    minBarsBetweenCuts: 4,
    antiRepeat: 3,
    maxCrossfadeBars: 0.5,
    transitionScale: 0.6,
    degradedTroughRatio: 0.45,
    degradedTroughSec: 0.3,
    degradedTimerSec: 20,
    degradedFadeSec: 0.8,
    overlayMinBars: 2,
  }),
  intensity: Object.freeze({
    overlayThreshold1: 0.3,
    overlayThreshold2: 0.7,
    voidFloorRatio: 0.35,
    voidFloorBeats: 2,
    voidForceFrom: 0.7,
    buildRestraint: 0.55,
    buildRestraintBars: 2,
    dropExplosionBars: 1,
    dropFalloutBars: 2,
    dropFalloutRatio: 0.7,
    breakdownLuminance: 0.15,
    saturationLimit: 0.55,
    saturationWindowSec: 4,
    userScaleMin: 0.5,
    userScaleMax: 1.5,
    userScaleStep: 0.1,
  }),
  safety: Object.freeze({
    respectReducedMotion: true,
    reducedFeedbackKMax: 0.85,
    reducedAmplitudeDivider: 2,
    reducedTransitionSec: 0.6,
  }),
  content: Object.freeze({
    debugHudOnStart: false,
    forcedPalette: -1,
    paletteCrossfadeSec: 0.3,
    forcedScene: '',
  }),
});

/** Patch accepte par `start()` : profondeur 2 (groupe -> champ). */
export type LiveConfigPatch = {
  readonly [K in keyof LiveConfig]?: Partial<LiveConfig[K]>;
};

/** Fusionne un patch sur les defauts. Retourne toujours un objet neuf et gele. */
export function mergeLiveConfig(patch?: LiveConfigPatch, base: LiveConfig = DEFAULT_LIVE_CONFIG): LiveConfig {
  if (!patch) return base;
  return Object.freeze({
    audio: Object.freeze({ ...base.audio, ...patch.audio }),
    beat: Object.freeze({ ...base.beat, ...patch.beat }),
    sync: Object.freeze({ ...base.sync, ...patch.sync }),
    state: Object.freeze({ ...base.state, ...patch.state }),
    render: Object.freeze({ ...base.render, ...patch.render }),
    perf: Object.freeze({ ...base.perf, ...patch.perf }),
    director: Object.freeze({ ...base.director, ...patch.director }),
    intensity: Object.freeze({ ...base.intensity, ...patch.intensity }),
    safety: Object.freeze({ ...base.safety, ...patch.safety }),
    content: Object.freeze({ ...base.content, ...patch.content }),
  });
}
