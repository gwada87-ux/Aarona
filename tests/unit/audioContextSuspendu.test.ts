import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { correctDrift, HARD_RESYNC_THRESHOLD_SECONDS } from '../../src/core/time/driftCorrection';

/**
 * Panne signalée par Aaron, en production, PULSAR embarqué en surcouche :
 *
 * > après avoir cliqué ▶, le compteur de temps reste bloqué à 0:00 / 1:00
 * > indéfiniment, alors que la boucle de rendu tourne activement
 * > (requestAnimationFrame déclenché plus de 4000 fois) et que le canvas reste
 * > pixel-identique tout du long. Aucune erreur console.
 *
 * Mécanisme : contexte audio suspendu (politique d'autoplay, ou iframe sans
 * `allow="autoplay"`) -> `ctx.currentTime` gelé -> la position mesurée reste à
 * ~0 pendant que la position prédite avance sur l'horloge murale -> l'écart
 * franchit le seuil de resynchronisation dure -> `correctDrift` ramène la
 * position à la valeur mesurée, ZÉRO, à chaque image.
 *
 * Le correcteur de dérive faisait exactement son travail. C'est de l'alimenter
 * avec une horloge à l'arrêt qui était l'erreur.
 */

/** Contexte audio factice dont l'horloge est GELÉE, comme un contexte suspendu. */
function contexteGele(etat: AudioContextState = 'suspended') {
  const noeud = {
    connect() {},
    disconnect() {},
    start() {},
    stop() {},
    buffer: null as unknown,
    loop: false,
    gain: { value: 1 },
  };
  return {
    state: etat,
    currentTime: 0, // NE BOUGE JAMAIS
    baseLatency: 0,
    outputLatency: 0,
    destination: {},
    createGain: () => noeud,
    createBufferSource: () => ({ ...noeud }),
    resume: () => Promise.reject(new Error('play() failed because the user agent did not allow it')),
  } as unknown as AudioContext;
}

/** Injecte un tampon décodé sans passer par `decodeAudioData`. */
function avecTampon(moteur: AudioEngine, duree: number): void {
  (moteur as unknown as { decoded: unknown }).decoded = {
    buffer: { duration: duree, sampleRate: 48000, numberOfChannels: 1, length: duree * 48000 },
  };
}

describe('le correcteur de dérive, isolé, fait bien ce qu\'on lui demande', () => {
  it('resynchronise durement quand la position mesurée est très en retard', () => {
    // Ce test ne dénonce pas un défaut : il ÉTABLIT que le correcteur n'est pas
    // le coupable. Nourri d'une horloge figée, il ne pouvait faire que ça.
    const r = correctDrift(0.5, 0);
    expect(Math.abs(0 - 0.5)).toBeGreaterThan(HARD_RESYNC_THRESHOLD_SECONDS);
    expect(r.resynced).toBe(true);
    expect(r.t).toBe(0);
  });
});

describe('AudioEngine — horloge audio à l\'arrêt', () => {
  it('AVANT le correctif, la position serait épinglée à zéro ; elle avance maintenant', () => {
    const moteur = new AudioEngine({ context: contexteGele() });
    avecTampon(moteur, 60);
    moteur.play();
    expect(moteur.playing, 'la lecture est bien déclarée active').toBe(true);

    // Deux secondes d'horloge murale, à 60 images par seconde.
    let ms = 0;
    for (let i = 0; i < 120; i++) {
      ms += 1000 / 60;
      moteur.tick(ms);
    }
    // Avec l'ancien code : t ~= 0 (resync dur vers la mesure figée) a chaque image.
    expect(moteur.t, 'le transport doit avancer malgre une horloge audio gelee').toBeGreaterThan(1.5);
    expect(moteur.t).toBeLessThan(2.5);
  });

  it('la position avance de façon MONOTONE, sans à-coup ni retour en arrière', () => {
    const moteur = new AudioEngine({ context: contexteGele() });
    avecTampon(moteur, 60);
    moteur.play();
    let ms = 0;
    let precedent = -1;
    for (let i = 0; i < 200; i++) {
      ms += 1000 / 60;
      moteur.tick(ms);
      expect(moteur.t, `recul a l'image ${i}`).toBeGreaterThanOrEqual(precedent);
      precedent = moteur.t;
    }
  });

  it("le refus de `resume()` est ENREGISTRÉ, plus avalé", async () => {
    const moteur = new AudioEngine({ context: contexteGele() });
    avecTampon(moteur, 60);
    moteur.play();
    await Promise.resolve();
    await Promise.resolve();
    expect(moteur.contextBlockedReason, 'le motif du refus doit être conservé').toBeTruthy();
    expect(moteur.contextState).toBe('suspended');
  });

  it("un contexte QUI TOURNE garde la correction de dérive intacte", () => {
    // Le correctif ne doit RIEN changer au cas normal : c'est la seule façon de
    // ne pas payer une panne par une régression de synchronisation.
    const ctx = contexteGele('running') as unknown as { currentTime: number };
    const moteur = new AudioEngine({ context: ctx as unknown as AudioContext });
    avecTampon(moteur, 60);
    moteur.play();
    let ms = 0;
    for (let i = 0; i < 120; i++) {
      ms += 1000 / 60;
      ctx.currentTime += 1 / 60; // horloge audio qui avance normalement
      moteur.tick(ms);
    }
    expect(moteur.t).toBeGreaterThan(1.5);
    expect(moteur.t).toBeLessThan(2.5);
  });

  it("une horloge audio qui DÉCROCHE en cours de route reste tenue par le correcteur", () => {
    // Contexte 'running' mais `currentTime` qui cesse d'avancer : le correcteur
    // garde la main, c'est son rôle. Il n'a pas été désactivé — on a seulement
    // cessé de le NOURRIR quand le contexte est à l'arrêt.
    const ctx = contexteGele('running') as unknown as { currentTime: number };
    const moteur = new AudioEngine({ context: ctx as unknown as AudioContext });
    avecTampon(moteur, 60);
    moteur.play();
    let ms = 0;
    for (let i = 0; i < 60; i++) { ms += 1000 / 60; ctx.currentTime += 1 / 60; moteur.tick(ms); }
    const mesureFigee = moteur.t;
    for (let i = 0; i < 60; i++) { ms += 1000 / 60; moteur.tick(ms); } // l'horloge decroche

    // La position OSCILLE : elle grimpe de ~14,7 ms par image jusqu'a depasser
    // le seuil de 0,12 s, resynchronise dur vers la mesure, et repart. Elle ne
    // repasse donc jamais SOUS la mesure — ma premiere version du test
    // l'attendait, a tort. Ce qui compte est qu'elle ne s'echappe pas avec
    // l'horloge murale, qui donnerait ~2 s.
    expect(moteur.t, 'ne doit pas suivre l\'horloge murale').toBeLessThan(mesureFigee + HARD_RESYNC_THRESHOLD_SECONDS);
    expect(moteur.t).toBeGreaterThanOrEqual(mesureFigee);
  });
});
