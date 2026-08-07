/**
 * §8.9, deuxieme phrase : « Une regle ESLint locale interdit `new`, `[]`, `{}`,
 * `.map/.filter/.slice` et les litteraux de fonction dans les fichiers marques
 * `// hot-path`. »
 *
 * ECART ASSUME n°10 : implemente en TEST et non en regle ESLint. Le projet n'a
 * pas ESLint, et §7 interdit d'ajouter la moindre dependance - installer
 * `eslint` + un plugin pour une seule regle contredirait la consigne plus
 * fortement que de la porter ici. Le compilateur TypeScript est deja une
 * devDependency et expose l'AST qu'il faut ; ce test lit donc le meme arbre
 * qu'une regle ESLint aurait lu, et echoue de la meme facon.
 *
 * EXTENSION : le marqueur est accepte au niveau FICHIER (comme le demande le
 * prompt) et au niveau METHODE. Sans le second, `CurlField.sample` - la
 * fonction la plus chaude de tout le mode live, appelee jusqu'a 6 000 fois par
 * trame - serait intestable : son fichier alloue legitimement ses tables de
 * permutation au constructeur, ce qui ferait echouer un marqueur de fichier
 * pour une allocation qui n'a jamais lieu dans une boucle.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const LIVE_ROOT = join(process.cwd(), 'src', 'ui', 'live');
const MARKER = 'hot-path';

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly what: string;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Le noeud porte-t-il un commentaire `// hot-path` juste au-dessus ? */
function isMarked(node: ts.Node, text: string): boolean {
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart());
  if (!ranges) return false;
  return ranges.some((r) => text.slice(r.pos, r.end).includes(MARKER));
}

function scanBody(body: ts.Node, text: string, source: ts.SourceFile, file: string, out: Violation[]): void {
  const push = (node: ts.Node, what: string): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    out.push({ file, line, what });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node)) push(node, '`new`');
    else if (ts.isArrayLiteralExpression(node)) push(node, 'litteral de tableau `[]`');
    else if (ts.isObjectLiteralExpression(node)) push(node, 'litteral d objet `{}`');
    else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) push(node, 'litteral de fonction');
    else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      (node.expression.name.text === 'map' ||
        node.expression.name.text === 'filter' ||
        node.expression.name.text === 'slice')
    ) {
      push(node, '`.' + node.expression.name.text + '()`');
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
}

function violationsIn(file: string): Violation[] {
  const text = readFileSync(file, 'utf-8');
  const rel = relative(process.cwd(), file).replace(/\\/g, '/');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const out: Violation[] = [];

  // Marqueur de FICHIER : dans l'en-tete, avant la premiere declaration.
  const header = text.slice(0, source.statements[0]?.getFullStart() ?? text.length);
  if (header.includes(MARKER)) {
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) continue;
      scanBody(statement, text, source, rel, out);
      // `scanBody` ne visite que les ENFANTS ; une declaration qui EST
      // elle-meme une violation (`const t = [1, 2]` au niveau module) doit
      // etre attrapee aussi.
      if (ts.isVariableStatement(statement)) {
        for (const d of statement.declarationList.declarations) {
          if (d.initializer) scanBody(statement, text, source, rel, out);
          break;
        }
      }
    }
    return out;
  }

  // Marqueur de METHODE ou de FONCTION.
  const visit = (node: ts.Node): void => {
    const isFn =
      ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isPropertyDeclaration(node);
    if (isFn && isMarked(node, text)) {
      const body = ts.isPropertyDeclaration(node) ? node.initializer : node.body;
      if (body) scanBody(body, text, source, rel, out);
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return out;
}

describe('discipline du chemin chaud (§8.9)', () => {
  const files = listFiles(LIVE_ROOT);

  it('le marqueur existe quelque part - sinon la regle ne protege rien', () => {
    const marked = files.filter((f) => readFileSync(f, 'utf-8').includes(MARKER));
    // Une regle qui ne s'applique a aucun fichier passe toujours. Ce garde-fou
    // fait echouer la suite si quelqu'un retire tous les marqueurs.
    expect(marked.length, 'aucun fichier marque `// hot-path`').toBeGreaterThanOrEqual(4);
  });

  it('aucune allocation dans les zones marquees', () => {
    const all: Violation[] = [];
    for (const file of files) all.push(...violationsIn(file));
    const report = all.map((v) => `  ${v.file}:${v.line} -> ${v.what}`).join('\n');
    expect(all, `allocations interdites en chemin chaud :\n${report}`).toEqual([]);
  });
});
