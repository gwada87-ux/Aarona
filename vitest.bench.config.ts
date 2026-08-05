import { defineConfig } from 'vitest/config';

/**
 * Config séparée pour les bancs de performance (docs/11_TESTING.md Niveau 4)
 * — délibérément PAS incluse dans `vitest.config.ts` : ces tests sont lents
 * par nature (signal synthétique de plusieurs minutes, pipeline complet) et
 * n'ont rien à faire dans la boucle de rétroaction rapide de `npm test`.
 * `testTimeout` relevé : le budget mesuré est 8 s (docs/11), le défaut
 * Vitest (5 s) ferait échouer le test sur son propre timeout avant même
 * d'atteindre l'assertion.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/bench/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
