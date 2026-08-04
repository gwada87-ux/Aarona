import { AudioEngine } from './audio/AudioEngine';

/**
 * Harnais de développement P3 — vérification manuelle du moteur audio et du
 * Transport (docs/03_DATA_FLOW.md FLUX 2). Remplace le harnais P2 (Loi 4,
 * déjà vérifiée et journalisée dans docs/JOURNAL.md).
 *
 * Le chronomètre affiché ici est un outil de diagnostic du harnais, pas une
 * dépendance du moteur : il réutilise le timestamp fourni par la boucle
 * requestAnimationFrame plutôt que d'appeler performance.now() séparément.
 * Seul AudioEngine.tick() dérive le temps musical de l'horloge réelle (Loi 1).
 */

const engine = new AudioEngine();

const fileInput = document.querySelector<HTMLInputElement>('#file-input')!;
const btnPlay = document.querySelector<HTMLButtonElement>('#btn-play')!;
const btnPause = document.querySelector<HTMLButtonElement>('#btn-pause')!;
const seekRange = document.querySelector<HTMLInputElement>('#seek-range')!;
const volumeRange = document.querySelector<HTMLInputElement>('#volume-range')!;
const loopCheckbox = document.querySelector<HTMLInputElement>('#loop-checkbox')!;
const calibrationInput = document.querySelector<HTMLInputElement>('#calibration-input')!;
const btnSeekStress = document.querySelector<HTMLButtonElement>('#btn-seek-stress')!;
const seekStressStatus = document.querySelector<HTMLSpanElement>('#seek-stress-status')!;

const outT = document.querySelector<HTMLElement>('#out-t')!;
const outDt = document.querySelector<HTMLElement>('#out-dt')!;
const outPlaying = document.querySelector<HTMLElement>('#out-playing')!;
const outDuration = document.querySelector<HTMLElement>('#out-duration')!;
const outWallClock = document.querySelector<HTMLElement>('#out-wallclock')!;
const outLatency = document.querySelector<HTMLElement>('#out-latency')!;
const outDrift = document.querySelector<HTMLElement>('#out-drift')!;
const logEl = document.querySelector<HTMLElement>('#log')!;

function log(message: string): void {
  logEl.textContent = `${new Date().toLocaleTimeString()}  ${message}\n${logEl.textContent}`;
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  engine
    .load(file)
    .then(() => {
      seekRange.max = String(engine.duration);
      log(`Chargé : ${file.name} — ${engine.duration.toFixed(2)} s`);
    })
    .catch((err: unknown) => {
      log(`Erreur de chargement : ${err instanceof Error ? err.message : String(err)}`);
    });
});

btnPlay.addEventListener('click', () => {
  wallClockStartMs = null; // resynchronise le chronomètre du harnais sur ce play
  engine.play();
});
btnPause.addEventListener('click', () => engine.pause());

seekRange.addEventListener('input', () => {
  engine.seek(Number(seekRange.value));
});

volumeRange.addEventListener('input', () => {
  engine.setVolume(Number(volumeRange.value));
});

loopCheckbox.addEventListener('change', () => {
  engine.setLoop(loopCheckbox.checked);
});

calibrationInput.addEventListener('change', () => {
  engine.setCalibrationOffset(Number(calibrationInput.value) / 1000);
});

btnSeekStress.addEventListener('click', () => {
  if (engine.duration === 0) {
    seekStressStatus.textContent = 'Chargez un fichier d’abord.';
    return;
  }
  const low = engine.duration * 0.2;
  const high = engine.duration * 0.8;
  let i = 0;
  const total = 50;
  const step = (): void => {
    if (i >= total) {
      seekStressStatus.textContent = `Terminé — ${total} seeks. t = ${engine.t.toFixed(3)} s.`;
      log(`Test de seek terminé : ${total} aller-retour, t final = ${engine.t.toFixed(3)} s`);
      return;
    }
    engine.seek(i % 2 === 0 ? high : low);
    i += 1;
    seekStressStatus.textContent = `${i}/${total}`;
    setTimeout(step, 80);
  };
  log('Début du test de seek (50 aller-retour, un par 80 ms)');
  step();
});

// outputLatency n'est pas garanti stable dès le départ (docs/03_DATA_FLOW.md :
// vaut 0 sur Chrome tant que rien n'a été rendu, puis évolue le temps que le
// pipeline audio se stabilise — la durée de cette phase transitoire dépend de
// la machine). Un instantané figé à N secondes confondrait cette évolution
// avec une vraie dérive. On annule donc outputLatency à CHAQUE image plutôt
// qu'une fois : `expectedT` = position estimée sans dérive, latence courante
// déduite à chaque calcul. Ce qui reste dans `t − expectedT` est la vraie
// dérive (le chiffre du critère de 14_ROADMAP.md), indépendante de la vitesse
// de stabilisation d'outputLatency.
let wallClockStartMs: number | null = null;
let tAtPlayStartUncompensated: number | null = null;

function loop(nowMs: number): void {
  engine.tick(nowMs);

  if (engine.playing) {
    if (wallClockStartMs === null) {
      wallClockStartMs = nowMs;
      tAtPlayStartUncompensated = engine.t + engine.outputLatencySeconds;
    }
    const wallClockElapsed = (nowMs - wallClockStartMs) / 1000;
    const expectedT = (tAtPlayStartUncompensated ?? 0) + wallClockElapsed - engine.outputLatencySeconds;

    outWallClock.textContent = wallClockElapsed.toFixed(3);
    outLatency.textContent = (engine.outputLatencySeconds * 1000).toFixed(1) + ' ms';
    outDrift.textContent = ((engine.t - expectedT) * 1000).toFixed(1) + ' ms';
  } else {
    wallClockStartMs = null;
    tAtPlayStartUncompensated = null;
  }

  outT.textContent = engine.t.toFixed(3);
  outDt.textContent = engine.dt.toFixed(4);
  outPlaying.textContent = String(engine.playing);
  outDuration.textContent = engine.duration.toFixed(3);
  if (!seekRange.matches(':active')) seekRange.value = String(engine.t);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
