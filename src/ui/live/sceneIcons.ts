/**
 * Icônes des 6 scènes procédurales du mode direct (chantier « grille Scène
 * automatique », suite au retour d'Aaron : « il faut mettre des icônes comme
 * pour les autres »).
 *
 * Contrairement aux vignettes de style (`styleThumbnails.ts`), CE NE SONT PAS
 * des rendus réels du moteur : un aperçu fidèle exigerait un `LiveAnalysisEngine`
 * chauffé sur un signal synthétique, et les utilitaires qui savent générer ce
 * signal (`ui/live/testing/`) portent explicitement la garantie « jamais
 * importé par le code d'application, donc absent du bundle de production »
 * (voir `testing/AnalyserModel.ts`, `testing/SyntheticAudio.ts`) — les
 * importer ici casserait cette garantie. Dessin statique, simple, pensé pour
 * rester reconnaissable à la taille d'une vignette (160×90), pas pour rivaliser
 * avec le rendu réel.
 */

const ICON_BG = '#0c0a16';
const ICON_STROKE = '#c77dff';

function setup(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = ICON_BG;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = ICON_STROKE;
  ctx.fillStyle = ICON_STROKE;
  ctx.lineWidth = Math.max(1, h * 0.018);
  ctx.lineCap = 'round';
}

export function drawSceneIcon(ctx: CanvasRenderingContext2D, sceneId: string, w: number, h: number): void {
  setup(ctx, w, h);
  const cx = w / 2;
  const cy = h / 2;

  switch (sceneId) {
    case 'grid-horizon': {
      const horizon = h * 0.5;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(0, horizon);
      ctx.lineTo(w, horizon);
      ctx.stroke();
      for (let i = 1; i <= 4; i++) {
        const y = horizon + (h - horizon) * (i / 4) ** 1.6;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      for (let i = -3; i <= 3; i++) {
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(cx, horizon);
        ctx.lineTo(cx + i * w * 0.16, h);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'curl-flow': {
      for (let i = 0; i < 3; i++) {
        const yBase = h * (0.28 + i * 0.24);
        ctx.globalAlpha = 0.85 - i * 0.18;
        ctx.beginPath();
        ctx.moveTo(0, yBase);
        ctx.bezierCurveTo(w * 0.32, yBase - h * 0.2, w * 0.62, yBase + h * 0.2, w, yBase);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'slice-displace': {
      const rows = 6;
      for (let i = 0; i < rows; i++) {
        const y = (h / rows) * i;
        const offset = (i % 2 === 0 ? 1 : -1) * w * 0.07;
        ctx.globalAlpha = 0.35 + 0.4 * (i / rows);
        ctx.fillRect(offset, y, w, h / rows - 2);
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'laser-tunnel': {
      const maxR = Math.min(w, h) / 2;
      for (let r = 1; r <= 4; r++) {
        ctx.globalAlpha = 1 - r * 0.16;
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * (r / 4), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'mandala-32': {
      const spokes = 12;
      const r = Math.min(w, h) * 0.42;
      for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(w, h) * 0.1, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'type-slam': {
      ctx.font = `bold ${Math.round(h * 0.5)}px ui-monospace, "IBM Plex Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Aa', cx, cy);
      break;
    }
    default: {
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(w, h) * 0.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}
