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

export class LiveAudioSource {
  private readonly pc: RTCPeerConnection;
  private analyser: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private timeData: Uint8Array<ArrayBuffer> | null = null;
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
  attachAnalysis(ctx: AudioContext, stream: MediaStream, fftSize = 1024): void {
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
    this.sourceNode = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.smoothingTimeConstant = 0.6;
    this.sourceNode.connect(this.analyser);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
  }

  private detachAnalysis(): void {
    this.sourceNode?.disconnect();
    this.analyser?.disconnect();
    this.sourceNode = null;
    this.analyser = null;
    this.freqData = null;
    this.timeData = null;
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

  get frequencyBinCount(): number {
    return this.analyser?.frequencyBinCount ?? 0;
  }

  /** Exposé pour la vérification (Playwright `pc.getStats()`) et pour `onconnectionstatechange` externe si besoin. */
  get peerConnection(): RTCPeerConnection {
    return this.pc;
  }

  dispose(): void {
    this.detachAnalysis();
    try {
      this.pc.close();
    } catch {
      // déjà fermée -- pas d'erreur à propager
    }
  }
}
