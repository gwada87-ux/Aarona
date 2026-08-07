/**
 * Puits de captures — greffon Vite de DÉVELOPPEMENT UNIQUEMENT.
 *
 * ## Pourquoi il existe
 *
 * docs/17 §12, critère 12 : « l'intro, la montée, le drop et le breakdown
 * donnent des images visiblement différentes. **À démontrer par capture.** »
 *
 * Le mot « capture » est le problème. Dans la session où ce fichier a été
 * écrit, aucune des routes habituelles ne fonctionnait :
 *
 * - la capture d'écran du panneau expire, faute de composition d'images ;
 * - le téléchargement du navigateur atterrit hors du dossier du projet, ce que
 *   CLAUDE.md interdit sans discussion ;
 * - faire transiter le `toDataURL` par la conversation a été ESSAYÉ et a
 *   échoué : 5 543 caractères arrivés sur 23 416, marqueur de fin `fff6` au
 *   lieu de `ffd9`, JPEG corrompu. Une image tronquée qui *ressemble* à une
 *   preuve est pire que pas d'image du tout.
 *
 * D'où ce point de dépôt : la page POSTe son `toDataURL`, le serveur écrit le
 * fichier dans le projet. Le trajet ne traverse rien qui puisse le tronquer.
 *
 * ## Ce qu'il n'est pas
 *
 * `apply: 'serve'` — il n'existe PAS dans le bundle de production, et n'est
 * même pas chargé par `vite build`. Il n'écrit que sous `docs/captures/`, et
 * le nom de fichier est réduit à `[a-z0-9_-]` : un nom hostile ne peut pas
 * remonter l'arborescence.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Plugin } from 'vite';

const DOSSIER = 'docs/captures';
const TAILLE_MAX = 8 * 1024 * 1024;

/** Réduit un nom à ce qui ne peut pas sortir du dossier : ni `/`, ni `\`, ni `..`. */
function nomSur(brut: unknown): string {
  const s = typeof brut === 'string' ? brut : '';
  const propre = s.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60);
  return propre.length > 0 ? propre : 'capture';
}

export function captureSink(): Plugin {
  return {
    name: 'pulsar-capture-sink',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__capture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST attendu');
          return;
        }
        let corps = '';
        let trop = false;
        req.on('data', (morceau) => {
          corps += morceau;
          // Une image ne doit pas pouvoir faire tomber le serveur de dev.
          if (corps.length > TAILLE_MAX) {
            trop = true;
            res.statusCode = 413;
            res.end('trop volumineux');
            req.destroy();
          }
        });
        req.on('end', () => {
          if (trop) return;
          try {
            const { nom, dataUrl } = JSON.parse(corps) as { nom?: string; dataUrl?: string };
            const virgule = typeof dataUrl === 'string' ? dataUrl.indexOf(',') : -1;
            if (virgule < 0) throw new Error('dataUrl absente ou malformée');
            const entete = dataUrl!.slice(0, virgule);
            const extension = entete.includes('image/png') ? 'png' : 'jpg';
            const octets = Buffer.from(dataUrl!.slice(virgule + 1), 'base64');

            // `server.config.root`, PAS `process.cwd()`. Le serveur de dev peut
            // très bien avoir été lancé depuis un autre dossier que la racine
            // qu'il sert — c'est le cas ici — et `cwd()` a effectivement écrit
            // la première capture EN DEHORS du projet avant que ce soit corrigé.
            const dossier = resolve(server.config.root, DOSSIER);
            mkdirSync(dossier, { recursive: true });
            const chemin = join(dossier, `${nomSur(nom)}.${extension}`);
            writeFileSync(chemin, octets);

            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, chemin, octets: octets.length }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}
