import { buildMusicTimeline } from './music/MusicTimeline';
import { StepContextBuilder } from './music/StepContext';
import { validatePmdi } from './music/validatePmdi';
import type { MusicEvent, PmdiDocument } from './music/pmdi';
import { BehaviourEngine } from './behaviour/BehaviourEngine';
import { defaultMapping } from './behaviour/mapping/defaults';
import { createPulseStyle } from './visual/styles/pulse/createPulseStyle';
import { defaultPalette } from './visual/palette/Palette';
import { FlashLimiter } from './visual/safety/FlashLimiter';
import { Canvas2DRenderer } from './render/canvas2d/Canvas2DRenderer';
import { createViewport } from './render/Viewport';
import { FixedStep, FIXED_DT } from './core/time/FixedStep';

/**
 * Harnais de développement P7 — vérification manuelle du style `Pulse`
 * (docs/07_VISUAL_ENGINE.md). Remplace le harnais P3 (audio + Transport,
 * déjà vérifié et journalisé). Piloté par une timeline SYNTHÉTIQUE (clic
 * 120 BPM écrit à la main) plutôt que par un fichier audio réel : l'analyse
 * (P4) et le rendu visuel (P7) sont déjà tous deux vérifiés séparément,
 * l'intégration bout en bout audio→visuel reste un chantier futur (UI, P12).
 *
 * Le pipeline câblé ici est RÉEL, pas une maquette : MusicTimeline (P5) →
 * StepContextBuilder (P5) → BehaviourEngine (P6) → Scene Pulse (P7) →
 * Canvas2DRenderer → FlashLimiter, exactement l'ordre de docs/03_DATA_FLOW.md
 * FLUX 2. Seule l'horloge est un repli : sans `AudioEngine.Transport` réel
 * branché ici, `t` avance par `1/60 s` de temps réel par image plutôt que
 * par l'horloge audio compensée (déjà vérifiée séparément en P3).
 */

function buildSyntheticDoc(durationSec: number): PmdiDocument {
  const events: MusicEvent[] = [];
  const beatDur = 0.5; // 120 BPM
  for (let beat = 0; beat * beatDur < durationSec; beat++) {
    const t = beat * beatDur;
    events.push({ t, type: 'KICK', intensity: 0.75 + 0.2 * Math.sin(beat), confidence: 0.9 });
    if (beat % 4 === 0) events.push({ t, type: 'DOWNBEAT', intensity: 1, confidence: 0.95 });
    if (beat % 4 === 1 || beat % 4 === 3) events.push({ t, type: 'SNARE', intensity: 0.65, confidence: 0.85 });
  }
  for (let eighth = 0; eighth * (beatDur / 2) < durationSec; eighth++) {
    events.push({ t: eighth * (beatDur / 2), type: 'HAT', intensity: 0.3, confidence: 0.8 });
  }
  for (const dropT of [8, 20, 36]) {
    if (dropT < durationSec) events.push({ t: dropT, type: 'DROP', intensity: 1, confidence: 0.7 });
  }
  events.sort((a, b) => a.t - b.t);

  const hz = 10;
  const sampleCount = Math.ceil(durationSec * hz) + 1;
  const energy = new Array<number>(sampleCount);
  const bandSub = new Array<number>(sampleCount);
  const centroid = new Array<number>(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / hz;
    energy[i] = 0.5 + 0.35 * Math.sin(t * 0.25);
    bandSub[i] = 0.4 + 0.3 * Math.sin(t * 0.4 + 1);
    centroid[i] = 0.5 + 0.4 * Math.sin(t * 0.15 + 2);
  }

  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'harness-p7@1.0', createdAt: new Date(0).toISOString() },
    audio: { duration: durationSec, sampleRate: 48000, channels: 2, ref: { kind: 'none' } },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events,
    features: [
      { id: 'energy', hz, t0: 0, data: energy },
      { id: 'band.sub', hz, t0: 0, data: bandSub },
      { id: 'centroid', hz, t0: 0, data: centroid },
    ],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}

const DURATION_SEC = 60;
const doc = buildSyntheticDoc(DURATION_SEC);
const validation = validatePmdi(doc);
if (!validation.ok) throw new Error(`Timeline synthétique invalide : ${JSON.stringify(validation.errors)}`);

const timeline = buildMusicTimeline(doc);
const stepper = new StepContextBuilder(timeline, 1);
const behaviourEngine = new BehaviourEngine(timeline, defaultMapping);
const scene = createPulseStyle();

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
const renderer = new Canvas2DRenderer(canvas);
const flashLimiter = new FlashLimiter(canvas);
scene.init({ renderer, palette: defaultPalette });

function resizeCanvas(): void {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const btnPlay = document.querySelector<HTMLButtonElement>('#btn-play')!;
const btnPause = document.querySelector<HTMLButtonElement>('#btn-pause')!;
const seekRange = document.querySelector<HTMLInputElement>('#seek-range')!;
const reducedFlashingCheckbox = document.querySelector<HTMLInputElement>('#reduced-flashing')!;
const stressCheckbox = document.querySelector<HTMLInputElement>('#flash-stress')!;
seekRange.max = String(DURATION_SEC);

const outT = document.querySelector<HTMLElement>('#out-t')!;
const outFps = document.querySelector<HTMLElement>('#out-fps')!;
const outRegime = document.querySelector<HTMLElement>('#out-regime')!;
const outClamped = document.querySelector<HTMLElement>('#out-clamped')!;

let t = 0;
let playing = false;
const fixedStep = new FixedStep(FIXED_DT);
let lastFrameMs: number | null = null;
let fpsSmoothed = 0;
let lastRegime = '—';

btnPlay.addEventListener('click', () => {
  playing = true;
  lastFrameMs = null;
});
btnPause.addEventListener('click', () => {
  playing = false;
});
seekRange.addEventListener('input', () => {
  t = Number(seekRange.value);
  fixedStep.reset();
  scene.reset(t);
});
reducedFlashingCheckbox.addEventListener('change', () => {
  flashLimiter.setReducedFlashing(reducedFlashingCheckbox.checked);
});

const viewport = createViewport(1);

function loop(nowMs: number): void {
  let frameDt = 0;
  if (lastFrameMs !== null) {
    frameDt = (nowMs - lastFrameMs) / 1000;
    if (frameDt > 0) fpsSmoothed = fpsSmoothed === 0 ? 1 / frameDt : fpsSmoothed * 0.9 + (1 / frameDt) * 0.1;
  }
  lastFrameMs = nowMs;

  if (playing) {
    // Temps réel écoulé, PAS une constante 1/60 : sinon la simulation ne
    // reflète plus l'horloge réelle (rAF throttlé en arrière-plan, moniteur
    // externe à fréquence différente...). Plafonné à 0,25 s (même logique
    // que MAX_WINDOW dans EventDispatcher, docs/06) pour éviter une rafale
    // de rattrapage géante après une pause de l'onglet.
    const steps = fixedStep.advance(Math.min(frameDt, 0.25));
    for (let i = 0; i < steps; i++) {
      t += FIXED_DT;
      if (t > DURATION_SEC) t = 0;
      const step = stepper.build(t);
      const signals = behaviourEngine.update(step);
      scene.update(step, signals);
      lastRegime = step.regime;
    }
    seekRange.value = String(t);
  }

  renderer.beginFrame(viewport);
  renderer.clear(defaultPalette.bg[1]);
  scene.draw(renderer, viewport);
  renderer.endFrame();

  if (stressCheckbox.checked) {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = Math.floor(nowMs / 50) % 2 === 0 ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  flashLimiter.apply(t);

  outT.textContent = t.toFixed(2);
  outFps.textContent = fpsSmoothed.toFixed(1);
  outRegime.textContent = lastRegime;
  outClamped.textContent = String(flashLimiter.clampedCount);
}

function raf(nowMs: number): void {
  loop(nowMs);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

/**
 * `requestAnimationFrame` est suspendu par le navigateur tant que l'onglet
 * n'est pas COMPOSITÉ à l'écran (`document.hidden`), pas seulement invisible
 * au sens de la fenêtre active — un simple onglet d'arrière-plan suffit.
 * Ce hook permet de faire avancer et redessiner une frame manuellement
 * (console, ou vérification automatisée) sans dépendre de rAF. Utile aussi
 * pour Aaron en session de développement (`__pulsarDebug.step(1/60)`).
 */
if (import.meta.env.DEV) {
  (window as unknown as { __pulsarDebug: unknown }).__pulsarDebug = {
    step: (dtSeconds = 1 / 60) => loop((lastFrameMs ?? performance.now()) + dtSeconds * 1000),
    play: () => btnPlay.click(),
    pause: () => btnPause.click(),
    get t() {
      return t;
    },
  };
}
