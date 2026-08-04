// Spike P0 — jetable. Prouve que WebCodecs + Mediabunny (ADR-005) produisent un MP4
// 1920x1080 60fps de 5s, rendu image par image hors temps réel, avec audio muxé.
// Ce fichier n'appartient à aucune couche de l'architecture cible (docs/02_ARCHITECTURE.md) :
// il sera jeté à la fin de l'étape 1, cf. docs/00b_MASTER_PROMPT_V2.md §9.

import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  AudioBufferSource,
  Quality,
  canEncodeVideo,
  canEncodeAudio,
} from 'mediabunny';

const FPS = 60;
const DURATION_S = 5;
const TOTAL_FRAMES = FPS * DURATION_S;
const WIDTH = 1920;
const HEIGHT = 1080;
const PROGRESS_EVERY = 15; // docs/09_EXPORT.md: progression émise toutes les 15 images

const runButton = document.getElementById('run');
const statusEl = document.getElementById('status');
const reportEl = document.getElementById('report');
const videoEl = document.getElementById('preview');

function yieldToEventLoop() {
  // docs/09_EXPORT.md piège #4 : jamais setTimeout (bridé en arrière-plan), jamais de for
  // synchrone — MessageChannel garantit un vrai passage par la boucle d'évènements.
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port2.onmessage = () => resolve();
    channel.port1.postMessage(null);
  });
}

// render(t) — fonction pure du temps (Loi 1). Aucune lecture d'horloge réelle ici.
function drawFrame(ctx, t) {
  ctx.fillStyle = '#0b0d12';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const cx = WIDTH / 2 + Math.sin(t * 1.3) * (WIDTH * 0.28);
  const cy = HEIGHT / 2 + Math.cos(t * 0.9) * (HEIGHT * 0.22);
  const radius = Math.max(90 + 40 * Math.sin(t * 6.0), 10);
  const hue = (t * 40) % 360;

  ctx.fillStyle = `hsl(${hue.toFixed(1)} 85% 60%)`;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(WIDTH / 2, HEIGHT / 2);
  ctx.rotate(t * 1.1);
  ctx.strokeStyle = `hsl(${(hue + 180) % 360} 80% 65%)`;
  ctx.lineWidth = 10;
  const size = 260;
  ctx.strokeRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}

// Ton sinusoïdal déterministe de 5 s — pas de Math.random, pas de fichier source.
function buildToneBuffer() {
  const sampleRate = 48000;
  const length = Math.round(sampleRate * DURATION_S);
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  const freq = 440;
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    data[i] = 0.2 * Math.sin(2 * Math.PI * freq * t);
  }
  ctx.close();
  return buffer;
}

async function runExportSpike() {
  const [videoOk, audioOk] = await Promise.all([
    canEncodeVideo('avc'),
    canEncodeAudio('aac'),
  ]);
  if (!videoOk || !audioOk) {
    throw new Error(
      `Codec non supporté par ce navigateur (avc=${videoOk}, aac=${audioOk}). ` +
      `Ce spike P0 ne teste pas de repli MediaRecorder — cf. docs/09_EXPORT.md.`
    );
  }

  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });

  const videoSource = new CanvasSource(canvas, { codec: 'avc', quality: new Quality('high') });
  output.addVideoTrack(videoSource, { frameRate: FPS });

  const audioSource = new AudioBufferSource({ codec: 'aac', quality: new Quality('high') });
  output.addAudioTrack(audioSource);

  const t0 = performance.now(); // mesure UI du spike uniquement, hors pipeline de rendu
  await output.start();

  const frameDuration = 1 / FPS;
  for (let f = 0; f < TOTAL_FRAMES; f++) {
    const t = f / FPS; // t = f/fps : rendu hors temps réel, jamais performance.now()/rAF ici
    drawFrame(ctx, t);
    await videoSource.add(t, frameDuration);

    if (f % PROGRESS_EVERY === 0) {
      statusEl.textContent = `Encodage vidéo : image ${f}/${TOTAL_FRAMES}`;
      await yieldToEventLoop();
    }
  }

  statusEl.textContent = 'Ajout de la piste audio…';
  await audioSource.add(buildToneBuffer());

  statusEl.textContent = 'Finalisation du conteneur MP4…';
  await output.finalize();

  const elapsedMs = performance.now() - t0;
  const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
  return { blob, elapsedMs };
}

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  reportEl.textContent = '';
  statusEl.textContent = 'Vérification du support codec…';

  try {
    const { blob, elapsedMs } = await runExportSpike();

    const url = URL.createObjectURL(blob);
    videoEl.src = url;

    const meta = await new Promise((resolve) => {
      videoEl.addEventListener('loadedmetadata', () => resolve({
        duration: videoEl.duration,
        videoWidth: videoEl.videoWidth,
        videoHeight: videoEl.videoHeight,
      }), { once: true });
    });

    statusEl.textContent = 'Export terminé.';
    reportEl.textContent = [
      `blob.size        = ${blob.size} octets (${(blob.size / 1024).toFixed(1)} Ko)`,
      `blob.type        = ${blob.type}`,
      `video.duration   = ${meta.duration.toFixed(3)} s (attendu 5.000 s)`,
      `video.videoWidth = ${meta.videoWidth} (attendu 1920)`,
      `video.videoHeight= ${meta.videoHeight} (attendu 1080)`,
      `frames encodées  = ${TOTAL_FRAMES} @ ${FPS} fps`,
      `temps d'encodage = ${elapsedMs.toFixed(0)} ms (mesure UI du spike, hors pipeline)`,
    ].join('\n');
  } catch (err) {
    statusEl.textContent = 'Échec de l\'export.';
    reportEl.textContent = `${err.name}: ${err.message}\n\n${err.stack ?? ''}`;
    console.error(err);
  } finally {
    runButton.disabled = false;
  }
});
