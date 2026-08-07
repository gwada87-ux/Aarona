/**
 * Diagnostic PULSAR — à coller dans la console du navigateur.
 *
 *   import('/diag.js').then(m => m.diag())
 *
 * Existe parce que le panneau navigateur de l'agent de codage NE COMPOSE PAS
 * d'images : `requestAnimationFrame` n'y est jamais appelé, donc la boucle de
 * rendu réelle ne peut pas y être testée. Ce fichier déporte la mesure dans un
 * vrai navigateur.
 *
 * Il ne modifie rien de façon permanente : il charge la démo, la joue, essaie
 * quelques styles et un preset, puis rend un compte rendu. Recharger la page
 * remet tout en place.
 */

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

export async function diag() {
  const L = [];
  const p = (k, v) => L.push(`${k} = ${v}`);

  p('url', location.href);
  p('agent', navigator.userAgent.slice(0, 60));
  p('reduce_motion_actif', window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const d = window.__pulsarDebug;
  p('module_evalue', !!d);
  p('bundle_a_jour', d ? d.setBlend === undefined && 'automation' in d : 'n/a');

  const cible = document.querySelector('canvas');
  if (!cible) {
    p('canvas', 'ABSENT');
    return fin(L);
  }
  const r = cible.getBoundingClientRect();
  p('canvas', `${cible.width}x${cible.height} affiche=${Math.round(r.width)}x${Math.round(r.height)} visible=${cible.offsetParent !== null}`);

  // La boucle du navigateur tourne-t-elle seulement ?
  let n = 0;
  const tic = () => { n++; requestAnimationFrame(tic); };
  requestAnimationFrame(tic);

  const off = new OffscreenCanvas(48, 27).getContext('2d', { willReadFrequently: true });
  const snap = () => { off.drawImage(cible, 0, 0, 48, 27); return off.getImageData(0, 0, 48, 27).data; };
  const dif = (a, b) => {
    let s = 0;
    for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    return +(s / (48 * 27 * 3 * 255)).toFixed(4);
  };

  const repos = snap();
  await attendre(1000);
  p('images_rAF_en_1s', n);
  p('bouge_au_repos', dif(repos, snap()));

  if (d) {
    d.loadDemo();
    await attendre(2500);
    d.play();
    await attendre(1500);
  }
  const lecture = snap();
  await attendre(800);
  p('bouge_en_lecture', dif(lecture, snap()));
  p('horloge', texte('#out-time'));
  p('fps', texte('#out-fps'));
  p('frames_clampees', texte('#out-clamped'));

  const tuiles = [...document.querySelectorAll('#style-grid button')];
  p('tuiles_de_style', tuiles.length);
  for (const i of [1, 4, 7]) {
    const t = tuiles[i];
    if (!t) continue;
    const avant = snap();
    t.click();
    await attendre(900);
    p(`style_${t.textContent.trim().replace(/\s+/g, '_')}`, dif(avant, snap()));
  }

  const sel = document.querySelector('#preset-select');
  if (sel) {
    for (const id of ['phonk', 'ambient']) {
      const avant = snap();
      sel.value = id;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await attendre(900);
      p(`preset_${id}`, dif(avant, snap()));
    }
  }

  return fin(L);
}

function texte(sel) {
  const el = document.querySelector(sel);
  return el ? el.textContent : 'absent';
}

async function fin(L) {
  const txt = L.join('\n');
  console.log(`\n===== DIAGNOSTIC PULSAR =====\n${txt}\n=============================`);
  try {
    await navigator.clipboard.writeText(txt);
    console.log('(copié dans le presse-papiers)');
  } catch {
    console.log('(copie automatique refusée — sélectionne le bloc ci-dessus)');
  }
  return txt;
}
