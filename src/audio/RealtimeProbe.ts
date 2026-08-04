/**
 * Sonde décorative (ADR-003, docs/00b_MASTER_PROMPT_V2.md) : un `AnalyserNode`
 * ne peut pas horodater et n'est jamais une source de vérité musicale. Elle
 * fournit un micro-mouvement continu entre deux trames d'analyse en preview.
 * `enabled` doit être mis à `false` en export (docs/03_DATA_FLOW.md FLUX 3).
 */
export class RealtimeProbe {
  private readonly analyser: AnalyserNode;
  private readonly data: Uint8Array<ArrayBuffer>;

  enabled = true;

  constructor(ctx: AudioContext, source: AudioNode, fftSize = 1024) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.smoothingTimeConstant = 0.6;
    source.connect(this.analyser);
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
  }

  /** Niveau moyen instantané, 0..1. Retourne 0 si désactivée. */
  sample(): number {
    if (!this.enabled) return 0;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      sum += Math.abs((this.data[i] ?? 128) - 128);
    }
    return sum / this.data.length / 128;
  }

  dispose(): void {
    this.analyser.disconnect();
  }
}
