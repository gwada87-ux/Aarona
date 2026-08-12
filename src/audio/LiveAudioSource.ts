/**
 * Étape 53 (hors roadmap) : réception d'un flux audio EN DIRECT depuis une
 * page hôte qui embarque ce visualizer en iframe (ex. un séquenceur), via
 * WebRTC — remplace, pour le mode "live" uniquement, le pont fichier
 * (`pulsar:load-audio` dans App.ts) qui capture un extrait puis le rejoue de
 * façon indépendante. Cette classe ne connaît ni le DOM ni `postMessage` :
 * `App.ts` lui fournit l'offre SDP reçue et relaie la réponse — même
 * séparation que `AudioEngine.ts`, qui ignore lui aussi la messagerie.
 *
 * N'a AUCUN rapport avec `RealtimeProbe` (sonde décorative ADR-003, blend
 * ≤25% par-dessus des features issues de la timeline précalculée) : ici il
 * n'y a pas de timeline du tout, c'est la source primaire du mode live.
 */
export interface LiveAudioSourceCallbacks {
  readonly onConnectionStateChange: (state: RTCPeerConnectionState) => void;
  readonly onTrack: (stream: MediaStream) => void;
}

/**
 * Reglages d'analyse du mode direct. Passes en parametres et non lus depuis
 * `ui/live/LiveConfig` : la couche `audio` n'a pas le droit d'importer `ui`
 * (docs/02, `tests/unit/architecture.test.ts`).
 */
export interface LiveAnalysisOptions {
  /** FFT de l'analyseur d'ONSETS. Petit = reactif. */
  readonly fftSizeOnset?: number;
  /** FFT de l'analyseur de NIVEAUX. Grand = bandes graves resolues. */
  readonly fftSizeBands?: number;
  /** Lissage interne. 0 : tout le lissage est fait par bande et par usage cote analyse. */
  readonly smoothingTimeConstant?: number;
  readonly minDecibels?: number;
  readonly maxDecibels?: number;
}

const DEFAULT_ANALYSIS: Required<LiveAnalysisOptions> = {
  fftSizeOnset: 2048,
  fftSizeBands: 8192,
  smoothingTimeConstant: 0,
  minDecibels: -90,
  maxDecibels: 0,
};

export class LiveAudioSource {
  private readonly pc: RTCPeerConnection;
  /** Analyseur d'ONSETS. Reste `this.analyser` : c'est lui que servent les accesseurs octet historiques. */
  private analyser: AnalyserNode | null = null;
  /** Second analyseur, dedie aux niveaux de bandes. */
  private bandsAnalyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private timeData: Uint8Array<ArrayBuffer> | null = null;
  private floatFreqData: Float32Array<ArrayBuffer> | null = null;
  private floatBandsData: Float32Array<ArrayBuffer> | null = null;
  private floatTimeData: Float32Array<ArrayBuffer> | null = null;
  private sampleRate = 0;
  // Piège Chrome confirmé à l'exécution (Étape 53) : un flux WebRTC distant
  // connecté à un AnalyserNode via createMediaStreamSource() seul ne produit
  // AUCUNE donnée (getByteFrequencyData/getByteTimeDomainData figés à zéro),
  // même avec connectionState='connected' et des octets RTP réellement reçus
  // (confirmé via pc.getStats()). Le pipeline audio de Chrome pour un flux
  // entrant ne s'active correctement que si le MediaStream est AUSSI consommé
  // par un élément <audio> (muet, jamais ajouté au DOM) -- un artefact connu,
  // pas une erreur de branchement. Sans lien avec ctx.destination : ce lecteur
  // reste muet, sert uniquement à "reveiller" le flux pour l'AnalyserNode.
  private wakeupAudioEl: HTMLAudioElement | null = null;
  private pmdiChannel: RTCDataChannel | null = null;
  /**
   * Canal de verite PMDI (ADR-012) : messages du DataChannel `pmdi` ouvert
   * par l'hote sur la MEME RTCPeerConnection que l'audio - les evenements
   * vivent et meurent avec la session qu'ils horodatent. Chaine brute, non
   * parsee : le parsing et la validation appartiennent a `ui/live`
   * (`TruthChannel`), cette couche ne connait pas le format.
   */
  onPmdiMessage: ((data: string) => void) | null = null;

  constructor(callbacks: LiveAudioSourceCallbacks) {
    // Pas de serveur STUN/TURN : les deux pairs sont dans le même onglet/la
    // même machine (candidats hôtes suffisants), garde l'appli utilisable
    // hors ligne comme le reste du projet.
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.pc.onconnectionstatechange = () => callbacks.onConnectionStateChange(this.pc.connectionState);
    this.pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) callbacks.onTrack(stream);
    };
    this.pc.ondatachannel = (event) => {
      if (event.channel.label !== 'pmdi') return;
      this.pmdiChannel = event.channel;
      event.channel.onmessage = (m) => {
        if (typeof m.data === 'string') this.onPmdiMessage?.(m.data);
      };
    };
  }

  /** Traite une offre SDP reçue de l'hôte, retourne la réponse à lui renvoyer. */
  async handleOffer(sdp: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(sdp);
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    await this.waitForIceGatheringComplete();
    const local = this.pc.localDescription;
    if (!local) throw new Error('LiveAudioSource: localDescription absente après setLocalDescription');
    // `local` est une instance native RTCSessionDescription — non clonable par
    // `postMessage` (DataCloneError confirmé à l'exécution côté émetteur, même
    // piège). Objet simple, structurellement un RTCSessionDescriptionInit valide.
    return { type: local.type, sdp: local.sdp };
  }

  /** ICE non-trickle : ICE candidates déjà inclus dans `pc.localDescription` une fois la collecte terminée. */
  private waitForIceGatheringComplete(): Promise<void> {
    if (this.pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, 500); // borne : la collecte hôte-seul est quasi instantanée en local
      const onChange = () => {
        if (this.pc.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          this.pc.removeEventListener('icegatheringstatechange', onChange);
          resolve();
        }
      };
      this.pc.addEventListener('icegatheringstatechange', onChange);
    });
  }

  /**
   * Branche l'analyse sur le flux reçu. Ne connecte JAMAIS `ctx.destination` :
   * l'hôte joue déjà ce son lui-même, un second chemin créerait un écho.
   */
  attachAnalysis(ctx: AudioContext, stream: MediaStream, options: LiveAnalysisOptions | number = {}): void {
    const opts: Required<LiveAnalysisOptions> = {
      ...DEFAULT_ANALYSIS,
      ...(typeof options === 'number' ? { fftSizeOnset: options } : options),
    };
    this.detachAnalysis();
    this.wakeupAudioEl = document.createElement('audio');
    this.wakeupAudioEl.muted = true;
    this.wakeupAudioEl.srcObject = stream;
    void this.wakeupAudioEl.play().catch(() => {
      // Repli défensif : si l'autoplay est bloqué malgré `muted=true` (rare,
      // certaines politiques navigateur), l'AnalyserNode restera silencieux --
      // pas d'erreur à propager, le mode direct dégrade proprement (aucun
      // impact sur le reste de l'appli).
    });
    this.sampleRate = ctx.sampleRate;
    this.sourceNode = ctx.createMediaStreamSource(stream);

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = opts.fftSizeOnset;
    this.analyser.smoothingTimeConstant = opts.smoothingTimeConstant;
    this.analyser.minDecibels = opts.minDecibels;
    this.analyser.maxDecibels = opts.maxDecibels;
    this.sourceNode.connect(this.analyser);

    this.bandsAnalyser = ctx.createAnalyser();
    this.bandsAnalyser.fftSize = opts.fftSizeBands;
    this.bandsAnalyser.smoothingTimeConstant = opts.smoothingTimeConstant;
    this.bandsAnalyser.minDecibels = opts.minDecibels;
    this.bandsAnalyser.maxDecibels = opts.maxDecibels;
    this.sourceNode.connect(this.bandsAnalyser);

    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this.floatFreqData = new Float32Array(this.analyser.frequencyBinCount);
    this.floatBandsData = new Float32Array(this.bandsAnalyser.frequencyBinCount);
    this.floatTimeData = new Float32Array(this.analyser.fftSize);
  }

  private detachAnalysis(): void {
    this.sourceNode?.disconnect();
    this.analyser?.disconnect();
    this.bandsAnalyser?.disconnect();
    this.sourceNode = null;
    this.analyser = null;
    this.bandsAnalyser = null;
    this.freqData = null;
    this.timeData = null;
    this.floatFreqData = null;
    this.floatBandsData = null;
    this.floatTimeData = null;
    this.sampleRate = 0;
    if (this.wakeupAudioEl) {
      this.wakeupAudioEl.pause();
      this.wakeupAudioEl.srcObject = null;
      this.wakeupAudioEl = null;
    }
  }

  /** Bins de fréquence, 0..255. Retourne `null` si l'analyse n'est pas encore branchée. */
  getFrequencyData(): Uint8Array<ArrayBuffer> | null {
    if (!this.analyser || !this.freqData) return null;
    this.analyser.getByteFrequencyData(this.freqData);
    return this.freqData;
  }

  /** Énergie moyenne instantanée du domaine temporel, 0..1. */
  getEnergy(): number {
    if (!this.analyser || !this.timeData) return 0;
    this.analyser.getByteTimeDomainData(this.timeData);
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i++) {
      sum += Math.abs((this.timeData[i] ?? 128) - 128);
    }
    return sum / this.timeData.length / 128;
  }

  /**
   * Spectre de l'analyseur d'ONSETS, en dBFS flottants.
   *
   * MUST §2.0 : c'est la version flottante qu'il faut consommer, pas les
   * octets. Un octet couvre `[minDecibels, maxDecibels]` sur 256 pas, et sur
   * un master moderne la difference entre deux trames devient nulle dans les
   * graves. A appeler UNE SEULE FOIS par trame, le buffer etant partage.
   */
  getFloatFrequencyData(): Float32Array<ArrayBuffer> | null {
    if (!this.analyser || !this.floatFreqData) return null;
    this.analyser.getFloatFrequencyData(this.floatFreqData);
    return this.floatFreqData;
  }

  /** Spectre de l'analyseur de NIVEAUX (8192), en dBFS flottants. Un seul appel par trame. */
  getFloatBandsFrequencyData(): Float32Array<ArrayBuffer> | null {
    if (!this.bandsAnalyser || !this.floatBandsData) return null;
    this.bandsAnalyser.getFloatFrequencyData(this.floatBandsData);
    return this.floatBandsData;
  }

  /**
   * Bloc temporel flottant. La version octet est en 8 bits, soit un plancher
   * de l'ordre de -42 dBFS : inutilisable sur un passage doux.
   */
  getFloatTimeDomainData(): Float32Array<ArrayBuffer> | null {
    if (!this.analyser || !this.floatTimeData) return null;
    this.analyser.getFloatTimeDomainData(this.floatTimeData);
    return this.floatTimeData;
  }

  /** Frequence d'echantillonnage reelle de l'`AudioContext`. 0 si l'analyse n'est pas branchee. */
  getSampleRate(): number {
    return this.sampleRate;
  }

  /** Taille de FFT de l'analyseur d'onsets. */
  get fftSizeOnset(): number {
    return this.analyser?.fftSize ?? 0;
  }

  /** Taille de FFT de l'analyseur de niveaux. */
  get fftSizeBands(): number {
    return this.bandsAnalyser?.fftSize ?? 0;
  }

  /** L'analyse est-elle branchee ? */
  get analysisReady(): boolean {
    return this.analyser !== null && this.bandsAnalyser !== null;
  }

  get frequencyBinCount(): number {
    return this.analyser?.frequencyBinCount ?? 0;
  }

  /** Exposé pour la vérification (Playwright `pc.getStats()`) et pour `onconnectionstatechange` externe si besoin. */
  get peerConnection(): RTCPeerConnection {
    return this.pc;
  }

  dispose(): void {
    this.detachAnalysis();
    if (this.pmdiChannel) {
      this.pmdiChannel.onmessage = null;
      this.pmdiChannel = null;
    }
    this.onPmdiMessage = null;
    try {
      this.pc.close();
    } catch {
      // déjà fermée -- pas d'erreur à propager
    }
  }
}
