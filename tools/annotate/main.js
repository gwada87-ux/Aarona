// tools/annotate/index.html — outil interne, jetable-outil (ne fait pas partie du
// produit livré). Tap-tempo au clavier pendant la lecture, export au format exact
// de docs/11_TESTING.md (§Annotation) : fixtures/<nom>.truth.json.

const fileInput = document.getElementById('file');
const player = document.getElementById('player');
const latencyInput = document.getElementById('latency');
const bpmInput = document.getElementById('bpm');
const sectionLabelInput = document.getElementById('sectionLabel');
const markSectionBtn = document.getElementById('markSection');
const undoBtn = document.getElementById('undo');
const clearAllBtn = document.getElementById('clearAll');
const exportBtn = document.getElementById('export');
const downloadBtn = document.getElementById('download');
const reportEl = document.getElementById('report');

const countEls = {
  beat: document.getElementById('countBeats'),
  downbeat: document.getElementById('countDownbeats'),
  kick: document.getElementById('countKicks'),
  snare: document.getElementById('countSnares'),
  section: document.getElementById('countSections'),
};

let actions = []; // { category: 'beat'|'downbeat'|'kick'|'snare'|'section', t, label? }
let bpmManuallyEdited = false;
let currentFileBaseName = 'annotation';
let lastExportedJson = null;

function currentTimeCorrected() {
  const latencyMs = Number(latencyInput.value) || 0;
  return Math.max(0, player.currentTime - latencyMs / 1000);
}

function updateCounts() {
  countEls.beat.textContent = actions.filter((a) => a.category === 'beat' || a.category === 'downbeat').length;
  countEls.downbeat.textContent = actions.filter((a) => a.category === 'downbeat').length;
  countEls.kick.textContent = actions.filter((a) => a.category === 'kick').length;
  countEls.snare.textContent = actions.filter((a) => a.category === 'snare').length;
  countEls.section.textContent = actions.filter((a) => a.category === 'section').length;
}

function medianInterval(sortedTimes) {
  if (sortedTimes.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < sortedTimes.length; i++) intervals.push(sortedTimes[i] - sortedTimes[i - 1]);
  intervals.sort((a, b) => a - b);
  return intervals[Math.floor(intervals.length / 2)];
}

function recomputeBpmIfNotEdited() {
  if (bpmManuallyEdited) return;
  const beats = actions
    .filter((a) => a.category === 'beat' || a.category === 'downbeat')
    .map((a) => a.t)
    .sort((a, b) => a - b);
  const period = medianInterval(beats);
  if (period && period > 0) {
    bpmInput.value = (60 / period).toFixed(1);
  }
}

function recordAction(category, extra = {}) {
  actions.push({ category, t: currentTimeCorrected(), ...extra });
  updateCounts();
  recomputeBpmIfNotEdited();
}

function isTypingInField(target) {
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

document.addEventListener('keydown', (ev) => {
  if (isTypingInField(ev.target)) return;
  if (ev.repeat) return;
  if (!player.src) return;

  switch (ev.key.toLowerCase()) {
    case ' ':
      ev.preventDefault();
      if (player.paused) player.play();
      else player.pause();
      break;
    case 'b':
      recordAction('beat');
      break;
    case 'd':
      recordAction('downbeat');
      break;
    case 'k':
      recordAction('kick');
      break;
    case 's':
      recordAction('snare');
      break;
    case 'n':
      recordAction('section', { label: sectionLabelInput.value || '(sans nom)' });
      break;
    case 'z':
      undoLast();
      break;
    default:
      break;
  }
});

function undoLast() {
  actions.pop();
  updateCounts();
  recomputeBpmIfNotEdited();
}

bpmInput.addEventListener('input', () => {
  bpmManuallyEdited = true;
});

markSectionBtn.addEventListener('click', () => {
  if (!player.src) return;
  recordAction('section', { label: sectionLabelInput.value || '(sans nom)' });
});

undoBtn.addEventListener('click', undoLast);

clearAllBtn.addEventListener('click', () => {
  actions = [];
  bpmManuallyEdited = false;
  bpmInput.value = 0;
  updateCounts();
  reportEl.textContent = 'Tout effacé.';
  downloadBtn.disabled = true;
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  player.src = URL.createObjectURL(file);
  currentFileBaseName = file.name.replace(/\.[^.]+$/, '');
  actions = [];
  bpmManuallyEdited = false;
  bpmInput.value = 0;
  updateCounts();
  reportEl.textContent = `Fichier chargé : ${file.name}. Cliquez sur le lecteur puis utilisez les raccourcis clavier.`;
  downloadBtn.disabled = true;
});

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function uniqueSorted(times) {
  const sorted = [...new Set(times.map(round3))].sort((a, b) => a - b);
  return sorted;
}

exportBtn.addEventListener('click', () => {
  const beats = uniqueSorted(actions.filter((a) => a.category === 'beat' || a.category === 'downbeat').map((a) => a.t));
  const downbeats = uniqueSorted(actions.filter((a) => a.category === 'downbeat').map((a) => a.t));
  const kicks = uniqueSorted(actions.filter((a) => a.category === 'kick').map((a) => a.t));
  const snares = uniqueSorted(actions.filter((a) => a.category === 'snare').map((a) => a.t));
  const sections = actions
    .filter((a) => a.category === 'section')
    .map((a) => ({ t: round3(a.t), label: a.label }))
    .sort((a, b) => a.t - b.t);

  const truth = {
    bpm: Number(bpmInput.value) || 0,
    beats,
    downbeats,
    kicks,
    snares,
    sections,
  };

  lastExportedJson = JSON.stringify(truth, null, 2);
  reportEl.textContent = lastExportedJson;
  downloadBtn.disabled = false;
});

downloadBtn.addEventListener('click', () => {
  if (!lastExportedJson) return;
  const blob = new Blob([lastExportedJson], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentFileBaseName}.truth.json`;
  a.click();
  URL.revokeObjectURL(url);
});
