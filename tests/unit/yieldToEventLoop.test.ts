/**
 * Tests de `export/yieldToEventLoop.ts` — Étape 42. Jamais testée. Le
 * commentaire source la documente comme un correctif pour un piège réel
 * (« piège #4 », docs/09_EXPORT.md) : les callbacks `output` de
 * `VideoEncoder` (Mediabunny) sont des tâches de la boucle d'événements —
 * sans un vrai passage par une MACROTÂCHE (pas une simple microtâche), elles
 * ne s'exécutent jamais durant l'export. Le seul comportement qui a une
 * vraie valeur de non-régression est donc CELUI-LÀ : que la promesse
 * traverse une frontière de macrotâche, pas juste la file de microtâches.
 */
import { describe, expect, it } from 'vitest';
import { yieldToEventLoop } from '../../src/export/yieldToEventLoop';

describe('yieldToEventLoop — franchit une vraie frontière de macrotâche', () => {
  it('résout APRÈS que toute une chaîne de microtâches en attente se soit entièrement vidée', async () => {
    const order: string[] = [];
    const yieldPromise = yieldToEventLoop().then(() => order.push('yield'));
    // Trois microtâches imbriquées : si yieldToEventLoop n'était qu'un wrapper autour de
    // Promise.resolve()/queueMicrotask (une microtâche), il pourrait s'intercaler avant l'une
    // d'elles plutôt qu'après toutes.
    const microtasks = Promise.resolve()
      .then(() => order.push('micro-1'))
      .then(() => order.push('micro-2'))
      .then(() => order.push('micro-3'));

    await Promise.all([yieldPromise, microtasks]);
    expect(order).toEqual(['micro-1', 'micro-2', 'micro-3', 'yield']);
  });
});

describe('yieldToEventLoop — résolution', () => {
  it('résout effectivement, vers undefined (ne bloque pas indéfiniment)', async () => {
    await expect(yieldToEventLoop()).resolves.toBeUndefined();
  });

  it('deux appels indépendants (deux MessageChannel distincts) résolvent tous les deux', async () => {
    const results = await Promise.all([yieldToEventLoop(), yieldToEventLoop()]);
    expect(results).toEqual([undefined, undefined]);
  });
});
