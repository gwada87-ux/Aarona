import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Résilience de la boucle de rendu.
 *
 * Le code était :
 *
 * ```js
 * function raf(nowMs) {
 *   loop(nowMs);
 *   requestAnimationFrame(raf);   // jamais atteint si loop() lève
 * }
 * ```
 *
 * **Une seule exception, à une seule image, arrêtait la boucle pour toujours.**
 * Canevas gelé, tous les contrôles en apparence morts, rien à l'écran pour dire
 * pourquoi, et aucun moyen de s'en relever sans recharger. Une panne à
 * conséquence disproportionnée : un défaut passager dans une couche condamnait
 * l'application entière.
 *
 * Ces tests lisent la SOURCE. C'est un pis-aller assumé : `App.ts` ne
 * s'instancie pas hors navigateur, et le panneau dont dispose l'agent de codage
 * ne compose pas d'images — `requestAnimationFrame` n'y est jamais appelé. La
 * vraie boucle n'y est donc pas exécutable, ce qui est précisément la raison
 * pour laquelle ce défaut a survécu si longtemps sans être vu.
 */
describe('boucle de rendu — une exception ne doit pas la tuer', () => {
  // Fins de ligne NORMALISÉES : le dépôt est en CRLF sous Windows, et une
  // première version de ce test cherchait `\n}\n`, introuvable dans `\r\n}\r\n`.
  // Le test échouait alors sur du code parfaitement correct.
  const app = readFileSync('src/ui/App.ts', 'utf-8').replace(/\r\n/g, '\n');
  const raf = app.slice(app.indexOf('function raf(nowMs: number): void {'));
  const corps = raf.slice(0, raf.indexOf('\n}\n') + 3);

  it('le corps de `raf` protège l\'appel à `loop`', () => {
    expect(corps).toMatch(/try\s*\{\s*loop\(nowMs\);/);
    expect(corps).toContain('catch');
  });

  it('la replanification est HORS du try — c\'est tout l\'enjeu', () => {
    // Si `requestAnimationFrame(raf)` vivait dans le `try`, une exception de
    // `loop()` sauterait par-dessus et la boucle mourrait quand même.
    const finDuCatch = corps.lastIndexOf('}');
    const replanif = corps.lastIndexOf('requestAnimationFrame(raf);');
    expect(replanif, 'la replanification doit exister').toBeGreaterThan(0);
    expect(replanif, 'la replanification doit venir après le bloc catch').toBeLessThan(finDuCatch);
    const avantReplanif = corps.slice(0, replanif);
    expect(avantReplanif).toContain('catch');
  });

  it('l\'erreur est REMONTÉE, pas avalée en silence', () => {
    // Une boucle qui absorbe sans rien dire échange une panne visible contre
    // une panne invisible, ce qui est pire.
    expect(corps).toContain('console.error');
  });

  it('les exceptions répétées sont comptées, pas déversées à chaque image', () => {
    expect(corps).toMatch(/loopErreurs\s*<=\s*LOOP_ERREURS_DETAILLEES/);
  });

  it('le compteur est lisible depuis la console de développement', () => {
    expect(app).toMatch(/get loopErreurs\(\)/);
  });

  it('`__pulsarDebug.step` appelle `loop` DIRECTEMENT, sans le filet', () => {
    // Délibéré : c'est l'outil de diagnostic. S'il avalait les exceptions, le
    // défaut des courbes d'anticipation (`CURVES[this.curve] is not a
    // function`) ne se serait jamais montré — il a été trouvé exactement comme
    // ça. Le filet protège l'utilisateur, pas la mesure.
    expect(app).toMatch(/step: \(dtSeconds = 1 \/ 60\) => loop\(/);
  });
});
