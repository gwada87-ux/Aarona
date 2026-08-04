import { describe, expect, it } from 'vitest';
import { Envelope } from '../../src/behaviour/signals/Envelope';

describe('Envelope', () => {
  it('monte pendant attack, tient à 1 pendant hold, puis redescend pendant release', () => {
    // Avance par petits pas (1/120s), comme le fera toujours BehaviourEngine
    // en pratique (Loi 1) : un seul `update(dt)` avec un dt qui dépasse la
    // phase courante clampe à la frontière sans reporter le surplus sur la
    // phase suivante (voir Envelope.ts, limite documentée) — non
    // représentatif de l'usage réel, qu'il ne faut donc pas tester ainsi.
    const envelope = new Envelope(0.2, 0.4); // attack=0,2s, release=0,4s
    envelope.fire(1.0); // durée totale de l'événement porteur : 1,0s → hold = 1.0 - 0.2 = 0.8s
    const dt = 1 / 120;
    const advance = (seconds: number) => {
      for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) envelope.update(dt);
    };

    advance(0.1); // mi-attaque
    expect(envelope.value).toBeGreaterThan(0);
    expect(envelope.value).toBeLessThan(1);

    advance(0.15); // dépasse la fin d'attaque (0,25s cumulées)
    expect(envelope.value).toBe(1);

    advance(0.7); // toujours dans le maintien (0,95s cumulées, hold dure jusqu'à 1,0s)
    expect(envelope.value).toBe(1);

    advance(0.15); // dépasse la fin du hold (1,10s cumulées), entre en release
    advance(0.2); // mi-release (1,30s cumulées → 0,30s de release sur 0,4s)
    expect(envelope.value).toBeGreaterThan(0);
    expect(envelope.value).toBeLessThan(1);

    advance(0.5); // release largement dépassé
    expect(envelope.value).toBe(0);
  });

  it('rien ne se passe avant le premier fire()', () => {
    const envelope = new Envelope(0.1, 0.1);
    envelope.update(1.0);
    expect(envelope.value).toBe(0);
  });

  it('reset() interrompt net, quelle que soit la phase', () => {
    const envelope = new Envelope(0.1, 0.1);
    envelope.fire(1.0);
    envelope.update(0.05);
    envelope.reset();
    expect(envelope.value).toBe(0);
  });
});
