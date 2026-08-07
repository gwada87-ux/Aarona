/**
 * Interface (docs/17_PHASE2_VISUELS.md §10.1, chantier 10, lot A).
 *
 * Ces tests lisent des FICHIERS plutôt que le DOM : le projet n'a pas
 * d'environnement jsdom, et les monter pour ça coûterait une dépendance de
 * développement que §10.1 interdit explicitement (« aucune dépendance npm
 * nouvelle »). Ce qu'ils vérifient est de toute façon structurel — la présence
 * des groupes, l'absence de style en dur — pas comportemental.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(process.cwd(), 'index.html'), 'utf-8');
const css = readFileSync(join(process.cwd(), 'src/ui/styles.css'), 'utf-8');
const app = readFileSync(join(process.cwd(), 'src/ui/App.ts'), 'utf-8');

describe('le CSS est sorti du HTML (§10.1)', () => {
  it('index.html ne contient plus de bloc <style>', () => {
    expect(html).not.toMatch(/<style[\s>]/i);
  });

  it('ni d\'attribut `style=` en ligne', () => {
    // Il y en avait huit, dont trois qui repetaient la meme regle de note
    // discrete. Une regle en ligne echappe aux variables de theme par
    // construction : elle ne peut pas etre changee depuis un seul endroit.
    expect(html).not.toMatch(/\sstyle="/i);
  });

  it('App.ts importe la feuille de style', () => {
    // Liee depuis le HTML, une feuille au chemin faux donne une page sans style
    // et aucune erreur. Importee, elle casse la compilation.
    expect(app).toMatch(/import '\.\/styles\.css';/);
  });
});

describe('le thème passe par des VARIABLES (§10.1)', () => {
  it('déclare les variables de couleur dans `:root`', () => {
    const root = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    for (const nom of ['--fond-page', '--fond-champ', '--trait', '--texte', '--accent', '--alerte', '--avertissement']) {
      expect(root, `variable ${nom} absente de :root`).toContain(nom);
    }
  });

  it('aucune couleur hexadécimale hors de `:root`', () => {
    // La garde qui compte : sans elle, une regle ajoutee plus tard recopie un
    // `#2c2e38` et le theme cesse d'etre changeable en un point. `#2c2e38`
    // apparaissait onze fois dans l'ancien bloc en ligne.
    // Commentaires retires d'abord : l'en-tete de la feuille CITE les couleurs
    // qu'elle a remplacees, et une garde qui se declencherait sur sa propre
    // documentation serait inutilisable.
    const sansRoot = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:root\s*\{[\s\S]*?\}/, '');
    const fautifs = sansRoot.match(/:\s*[^;{}]*#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(fautifs, `couleurs en dur hors :root : ${fautifs.join(' | ')}`).toEqual([]);
  });
});

describe('cinq groupes par intention (§10.1)', () => {
  it('les cinq groupes existent, dans l\'ordre', () => {
    const ids = [...html.matchAll(/<details class="groupe" id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['groupe-visuel', 'groupe-couleurs', 'groupe-texte', 'groupe-reactivite', 'groupe-export']);
  });

  it('les onglets FILTRENT au lieu de découper', () => {
    // Il y avait deux panneaux dont un seul etait visible : un reglage changeait
    // de place selon l'onglet. `data-mode` les laisse a la meme place.
    expect(html, 'les anciens panneaux Simple/Avancé sont encore là').not.toMatch(/id="panel-(simple|advanced)"/);
    expect(html).toMatch(/data-mode="avance"/);
    expect(app, 'selectTab doit filtrer sur [data-mode]').toContain("querySelectorAll<HTMLElement>('[data-mode]')");
  });

  it('l\'état initial du filtre est posé au chargement', () => {
    // Sans cet appel, les elements `data-mode="avance"` seraient visibles au
    // demarrage alors que l'onglet Simple est actif.
    expect(app).toMatch(/^selectTab\('simple'\);$/m);
  });
});

describe('vignettes de style (§10.1)', () => {
  it('la grille est vide dans le HTML et remplie par le panneau', () => {
    expect(html).toContain('id="style-grid"');
    const panel = readFileSync(join(process.cwd(), 'src/ui/panels/AdvancedPanel.ts'), 'utf-8');
    expect(panel).toContain("className = 'style-tile'");
    expect(panel, 'une vignette par STYLE_ID').toMatch(/for \(const id of STYLE_IDS\)/);
  });

  it('chaque vignette porte son nom pour un lecteur d\'écran', () => {
    // Un canvas rendu par le moteur ne dit rien a une synthese vocale.
    const panel = readFileSync(join(process.cwd(), 'src/ui/panels/AdvancedPanel.ts'), 'utf-8');
    expect(panel).toContain("setAttribute('aria-label', STYLE_LABELS[id])");
    expect(panel).toContain("setAttribute('aria-pressed'");
  });

  it('le rendu est ÉTALÉ par `setTimeout`, pas par `requestAnimationFrame`', () => {
    // Mesure : les huit vignettes d'affilee coutaient 68,7 ms, soit quatre
    // images perdues. Etalees par rAF elles restaient NOIRES dans tout onglet
    // qui ne composite pas ; `setTimeout` s'execute partout.
    expect(app).toContain('thumbnailTimer = window.setTimeout(next, 0)');
    expect(app, 'rAF ne se declenche pas dans un onglet en arriere-plan').not.toContain('requestAnimationFrame(next)');
  });

  it('le rendu ne se déclenche pas quand le groupe est replié', () => {
    expect(app).toMatch(/if \(!groupe\?\.open \|\| !currentPalette\) return;/);
  });
});
