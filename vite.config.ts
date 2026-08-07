import { defineConfig } from 'vite';
import { captureSink } from './tools/captureSink';

export default defineConfig({
  // `captureSink` est un greffon de DÉVELOPPEMENT (`apply: 'serve'`) : il sert
  // à déposer les captures du critère 12 dans `docs/captures/` et n'existe pas
  // dans le bundle de production. Voir tools/captureSink.ts.
  plugins: [captureSink()],
  server: {
    port: 5174,
    strictPort: true,
  },
});
