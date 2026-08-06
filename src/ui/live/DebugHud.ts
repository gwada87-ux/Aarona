/**
 * HUD de debug du mode live (§4.6).
 *
 * MUST : dessine directement sur le canvas VISIBLE, apres le post - jamais
 * dans un buffer soumis au feedback, au bloom ou a la mesure de luminance.
 * Desactive par defaut, bascule par `D`.
 *
 * Ne couvre que ce qui existe a l'etape 1. Les lignes prevues par §4.6 qui
 * dependent des etapes suivantes (scene et variante, luminance moyenne du
 * cadre, nombre d'overlays actifs, journal des changements de scene) seront
 * ajoutees avec leurs modules ; les afficher vides serait du bruit.
 */

import type { LiveAnalysisEngine } from './audio/LiveAnalysisEngine';
import type { LiveConfig } from './LiveConfig';

const PAD = 10;
const LINE = 15;
const BAR_W = 150;

export class DebugHud {
  visible: boolean;
  /** Temps de trame median, en ms - alimente par le panneau. */
  frameMs = 0;
  /** Compteur de declenchements du FlashLimiter. */
  flashClamped = 0;

  private readonly lines: string[] = [];

  constructor(private readonly config: LiveConfig) {
    this.visible = config.content.debugHudOnStart;
  }

  toggle(): void {
    this.visible = !this.visible;
  }

  /**
   * @param ctx   contexte du canvas VISIBLE.
   * @param dpr   ratio de pixels, pour que le texte reste lisible.
   */
  draw(ctx: CanvasRenderingContext2D, engine: LiveAnalysisEngine, dpr: number): void {
    if (!this.visible) return;
    const beat = engine.beat;
    const sync = beat.sync;

    this.lines.length = 0;
    this.lines.push(`etat        ${engine.state}${engine.staleFrames > 0 ? `  (trames rejouees ${engine.staleFrames})` : ''}`);
    this.lines.push(
      `tempo       ${beat.bpm.toFixed(2)} BPM   conf ${engine.tempo.confidence.toFixed(2)}   downbeat ${beat.downbeatConfidence.toFixed(2)}${beat.phraseValid ? '' : '  (phrase invalide)'}`,
    );
    this.lines.push(`octaves     ${engine.tempo.hypotheses.map((h) => `${h.bpm.toFixed(1)}:${h.score.toFixed(2)}`).join('  ') || '-'}`);
    this.lines.push(
      `mesure      temps ${beat.beatIndex}   mesure ${beat.barIndex}   phrase ${beat.phraseIndex}   kicks ${beat.acceptedKicks}/${beat.acceptedKicks + beat.rejectedKicks}   resync ${beat.hardResyncs}`,
    );
    this.lines.push(
      `sync        total ${sync.totalMs.toFixed(1)} ms  =  analyse ${sync.analyserDelayMs.toFixed(1)} + pick ${sync.pickLookaheadMs.toFixed(0)} + affichage ${sync.presentDelayMs.toFixed(1)} - avance audio ${sync.audioAheadMs.toFixed(1)} + trim ${sync.userTrimMs.toFixed(0)}`,
    );
    if (this.config.sync.onsetBackdatingApplied) {
      this.lines.push(`            (retro-datation active : analyse et pick deja compenses, non recomptes)`);
    }
    this.lines.push(
      `perf        ${this.frameMs.toFixed(1)} ms/trame   flashs limites ${this.flashClamped}   ajustement periode ${beat.fitPoints} pts, residu ${beat.fitResidual.toFixed(3)}`,
    );
    this.lines.push(`marqueurs   ${marker(engine, 'kick')}  ${marker(engine, 'snare')}  ${marker(engine, 'hat')}`);
    this.lines.push(`fleches haut/bas : trim de synchro   D : fermer`);

    const scale = Math.max(1, dpr);
    const height = PAD * 2 + this.lines.length * LINE + 22;
    const width = 640;

    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';

    ctx.fillStyle = 'rgba(8,8,14,0.82)';
    ctx.fillRect(PAD - 6, PAD - 6, width, height);
    ctx.strokeStyle = 'rgba(180,140,255,0.5)';
    ctx.lineWidth = 1;
    // Demi-pixel : un trait d'epaisseur 1 sur une coordonnee entiere s'etale
    // sur deux rangees grises et scintille (§3.4).
    ctx.strokeRect(Math.round(PAD - 6) + 0.5, Math.round(PAD - 6) + 0.5, width, height);

    ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(230,225,255,0.92)';
    for (let i = 0; i < this.lines.length; i++) {
      ctx.fillText(this.lines[i] ?? '', PAD + 4, PAD + 4 + i * LINE);
    }

    // Barre de phase de temps : le seul element du HUD lu du coin de l'oeil.
    const barY = PAD + 4 + this.lines.length * LINE + 4;
    ctx.strokeStyle = 'rgba(180,140,255,0.6)';
    ctx.strokeRect(PAD + 4.5, barY + 0.5, BAR_W, 8);
    ctx.fillStyle = 'rgba(255,160,120,0.9)';
    ctx.fillRect(PAD + 5, barY + 1, BAR_W * beat.beatPhase, 7);
    ctx.fillStyle = 'rgba(120,255,200,0.9)';
    ctx.fillRect(PAD + 5 + BAR_W + 8, barY + 1, BAR_W * beat.barPhase, 7);
    ctx.fillStyle = 'rgba(230,225,255,0.7)';
    ctx.fillText('temps', PAD + 4, barY + 11);
    ctx.fillText('mesure', PAD + 4 + BAR_W + 8, barY + 11);

    ctx.restore();
  }

  /** Fleches haut/bas du HUD. Retourne `true` si la touche a ete consommee. */
  handleKey(key: string, engine: LiveAnalysisEngine): boolean {
    if (!this.visible) return false;
    const step = this.config.sync.userTrimStepMs;
    if (key === 'ArrowUp') {
      engine.beat.setUserTrimMs(engine.beat.userTrimMs + step);
      return true;
    }
    if (key === 'ArrowDown') {
      engine.beat.setUserTrimMs(engine.beat.userTrimMs - step);
      return true;
    }
    return false;
  }
}

function marker(engine: LiveAnalysisEngine, kind: 'kick' | 'snare' | 'hat'): string {
  // `lastTime` est sur l'horloge audio, comme `audioTime` : les deux sont
  // comparables. `tSec` ne le serait pas, c'est un temps ecoule depuis start().
  const age = engine.audioTime - engine.onsets.lastTime(kind);
  const hot = engine.firedThisFrame(kind) || age < 0.08;
  return `${kind} ${hot ? '[#]' : '[ ]'} ${engine.onsets.lastStrength(kind).toFixed(2)}`;
}
