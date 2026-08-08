import { defineConfig } from 'vite';
import { captureSink } from './tools/captureSink';

/**
 * Horodatage de build, injecte a la compilation et affiche dans le panneau
 * « Etat (debug) ».
 *
 * Raison d'etre : quatre allers-retours de diagnostic ont ete brouilles par une
 * question sans reponse — « la version testee contient-elle le correctif ? ».
 * La console d'Aaron montrait `index-xz3DyyNa.js` alors que deux correctifs
 * plus recents existaient deja. Un horodatage lisible a l'ecran tranche cette
 * question en une seconde, sans console et sans supposition.
 */
const BUILD_ID = new Date().toISOString().replace('T', ' ').slice(0, 19);

export default defineConfig({
  // GitHub Pages sert ce dépôt sous un sous-chemin (`/Aarona/`), jamais la
  // racine -- `GITHUB_ACTIONS` n'est vrai QUE dans le workflow de déploiement
  // (`.github/workflows/deploy-pages.yml`), jamais en local ni sur Netlify.
  // Sans ce chemin, les assets référencés en absolu (`/assets/...`) pointeraient
  // sous la racine du domaine et 404 en production.
  base: process.env.GITHUB_ACTIONS ? '/Aarona/' : '/',
  // `captureSink` est un greffon de DÉVELOPPEMENT (`apply: 'serve'`) : il sert
  // à déposer les captures du critère 12 dans `docs/captures/` et n'existe pas
  // dans le bundle de production. Voir tools/captureSink.ts.
  plugins: [captureSink()],
  define: {
    __PULSAR_BUILD__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
