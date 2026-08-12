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
import type { LivePipeline } from './render/LivePipeline';
import type { LiveDirector } from './LiveDirector';
import type { IntensityDirector } from './IntensityDirector';
import type { OverlayDirector } from './Overlays';
import type { TruthDirector } from './truth/TruthDirector';
import { SHORTCUTS } from './Controls';
import type { LiveConfig } from './LiveConfig';

const PAD = 10;
const LINE = 15;
const BAR_W = 150;
/** Seuil de non-saturation de §2.8. Le garde-fou qui l'utilise est de l'etape 4 ; la mesure, elle, existe deja. */
const SATURATION_LIMIT = 0.55;

export class DebugHud {
  visible: boolean;
  /** Temps de trame median, en ms - alimente par le panneau. */
  frameMs = 0;
  /** Compteur de declenchements du FlashLimiter. */
  flashClamped = 0;
  /** Pipeline de rendu, pour les lignes de qualite et de saturation. */
  pipeline: LivePipeline | null = null;
  director: LiveDirector | null = null;
  intensity: IntensityDirector | null = null;
  overlays: OverlayDirector | null = null;
  /** Canal de verite PMDI (ADR-012) - diagnostic complet en une ligne. */
  truth: TruthDirector | null = null;

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
    // Ligne du canal de verite (ADR-012). C'est l'outil de diagnostic du
    // bout-en-bout : "aucun message" = emetteur absent ou iframe perimee ;
    // "acquisition paires n" = canal vivant, aligneur en cours ; "ACTIF" =
    // l'horloge est pilotee par l'hote (conf 1 attendue juste au-dessus).
    const truth = this.truth;
    if (truth) {
      const ch = truth.channel;
      const al = truth.aligner;
      const total = ch.accepted + ch.ignored + ch.rejected;
      const etat = truth.active
        ? 'ACTIF'
        : al.converged
          ? 'converge, en attente'
          : total === 0
            ? 'AUCUN MESSAGE'
            : 'acquisition';
      this.lines.push(
        `verite      canal ${total === 0 ? '-' : ch.alive(engine.audioTime) ? 'vivant' : 'MORT'}   msgs ${ch.accepted}/${ch.ignored}/${ch.rejected}   hote ${ch.tempoBpm > 0 ? `${ch.tempoBpm.toFixed(2)} BPM` : '-'}   paires ${al.matchedPairs}${al.ambiguousSkips > 0 ? ` (+${al.ambiguousSkips} amb.)` : ''}   MAD ${Number.isFinite(al.madMs) ? `${al.madMs.toFixed(1)} ms` : '-'}   offset ${Number.isFinite(al.offsetSec) ? `${al.offsetSec.toFixed(3)} s` : '-'}   ${etat}`,
      );
    }
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
    const p = this.pipeline;
    if (p) {
      const s = p.stats;
      const ref = p.budget.referencePeriodMs;
      this.lines.push(
        `rendu       qualite ${p.budget.level}/3   ref ${ref > 0 ? `${ref.toFixed(1)} ms` : 'calibration'}   passes ${s.passes}/${s.budget}   bitmap ${s.postW}x${s.postH}   ${s.memoryMb.toFixed(1)} Mo${s.degraded ? '   DEGRADE' : ''}`,
      );
      this.lines.push(
        `image       luminance ${s.luminance.toFixed(3)} (seuil ${SATURATION_LIMIT.toFixed(2)})${s.luminance > SATURATION_LIMIT ? '  SATURE' : ''}   palette ${p.palette.current.id}${p.palette.blending ? ' (fondu)' : ''}   scene ${p.currentScene?.id ?? '-'}`,
      );
      this.lines.push(
        `section     ${engine.section.arc}   E ${engine.section.lowDb.toFixed(1)} dB / ref ${engine.section.referenceDb.toFixed(1)} dB   intensite ${engine.section.intensity.toFixed(2)}   onsets/s ${engine.onsetRate.toFixed(1)}`,
      );
    }
    const ints = this.intensity;
    if (ints) {
      this.lines.push(
        `dramaturgie intensite ${ints.intensity.toFixed(2)} (x${ints.userScale.toFixed(1)})   overlays ${ints.budget.overlays}   bloom ${ints.budget.bloom.toFixed(2)}   ampli ${ints.budget.amplitude.toFixed(2)}${ints.saturated ? '   SATURE' : ''}${ints.forcingVoid ? '   VIDE FORCE' : ''}${ints.budget.grainOnly ? '   GRAIN SEUL' : ''}`,
      );
    }
    const dir = this.director;
    if (dir) {
      this.lines.push(
        `director    ${dir.degraded ? 'DEGRADED' : 'nominal'}${dir.sceneLocked ? '   SCENE VERROUILLEE' : ''}${engine.beat.manual ? '   TAP MANUEL' : ''}   overlays actifs ${this.overlays?.active.join(' ') || '-'}`,
      );
      for (const change of dir.log) {
        this.lines.push(
          `  coupe     t=${change.tSec.toFixed(1)}s  ${change.from} -> ${change.to} v${change.variant}  [${change.reason} / ${change.boundary}]  db=${change.downbeatConfidence.toFixed(2)}`,
        );
      }
    }
    this.lines.push(`marqueurs   ${marker(engine, 'kick')}  ${marker(engine, 'snare')}  ${marker(engine, 'hat')}`);
    this.lines.push(`?  aide      D  fermer`);

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

  /**
   * Panneau d'aide (touche `?`, §4.5). Dessine sur le canvas VISIBLE, apres
   * tout le reste. Sa table vient de `Controls.ts` : une seule source pour
   * l'aide affichee, la documentation de NOTES.md et le clavier reel.
   */
  drawHelp(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number): void {
    const scale = Math.max(1, dpr);
    const lineH = 20;
    const boxW = 460;
    const boxH = SHORTCUTS.length * lineH + 48;
    const x = w / scale / 2 - boxW / 2;
    const y = h / scale / 2 - boxH / 2;

    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(8,8,14,0.9)';
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeStyle = 'rgba(180,140,255,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, boxW, boxH);

    ctx.fillStyle = 'rgba(240,236,255,0.95)';
    ctx.font = '13px "IBM Plex Mono", ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('RACCOURCIS', x + 18, y + 16);
    ctx.font = '11px "IBM Plex Mono", ui-monospace, monospace';
    for (let i = 0; i < SHORTCUTS.length; i++) {
      const s = SHORTCUTS[i];
      if (!s) continue;
      ctx.fillStyle = 'rgba(255,160,120,0.95)';
      ctx.fillText(s.key, x + 18, y + 44 + i * lineH);
      ctx.fillStyle = 'rgba(220,215,245,0.85)';
      ctx.fillText(s.label, x + 168, y + 44 + i * lineH);
    }
    ctx.restore();
  }
}

function marker(engine: LiveAnalysisEngine, kind: 'kick' | 'snare' | 'hat'): string {
  // `lastTime` est sur l'horloge audio, comme `audioTime` : les deux sont
  // comparables. `tSec` ne le serait pas, c'est un temps ecoule depuis start().
  const age = engine.audioTime - engine.onsets.lastTime(kind);
  const hot = engine.firedThisFrame(kind) || age < 0.08;
  return `${kind} ${hot ? '[#]' : '[ ]'} ${engine.onsets.lastStrength(kind).toFixed(2)}`;
}
