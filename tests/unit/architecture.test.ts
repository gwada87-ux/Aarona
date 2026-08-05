import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import ts from 'typescript';

/**
 * Vérifie les règles de dépendance entre couches de docs/02_ARCHITECTURE.md
 * et CLAUDE.md. Ne parcourt que les couches explicitement tablées ; une
 * couche absente de ce tableau (project/, perf/, debug/, integration/...)
 * n'est pas encore contrainte — elles n'existent pas à cette étape et leurs
 * règles n'y sont pas spécifiées.
 *
 * `presets` ajoutée à l'Étape 13/P11 : docs/02 ne lui consacrait pas de ligne
 * (elle n'existait pas encore), seulement des mentions dans les lignes
 * `analysis`/`export`/`ui` existantes (« analysis ne peut jamais importer
 * presets », « export/ui peuvent importer presets »). Autorisations
 * choisies ici et documentées dans docs/JOURNAL.md : `core` (utilitaires),
 * `music` (types PMDI, pour `suggest.ts`), `behaviour` (type `MappingSchema`,
 * pour `resolve.ts`), `analysis` (type `ClassificationThresholds`, import de
 * TYPE uniquement — cohérent avec le sens unique déjà interdit dans l'autre
 * direction), `visual` (type `Palette`, pour `resolve.ts`/`palette.ts`).
 *
 * `project` ajoutée à l'Étape 15/P13 (docs/13_PROJECT_FORMAT.md) : même
 * situation, déjà anticipée dans les lignes `export`/`ui` existantes.
 * N'importe que `music` (types `PmdiDocument`/`AudioRef`, pour `Project.ts`/
 * `pvproj.ts`/`storage/db.ts`) — délibérément PAS `presets/` : le format de
 * sauvegarde stocke un diff de chemins pointés générique (`PresetDiff`,
 * chaînes "macros.glow" → valeur), pas des types du preset lui-même ;
 * `setByPath` y est dupliqué depuis `presets/resolve.ts` plutôt qu'importé
 * (même raisonnement que `music/StepContext.ts` dupliquant `BAND_IDS` depuis
 * `analysis/bands.ts` — la fonction ne fait qu'une dizaine de lignes).
 *
 * `perf` ajoutée à l'Étape 16/P14 (docs/10_PERFORMANCE.md), déjà anticipée
 * dans les lignes `export`/`ui`. N'importe que `core` (`QualityGovernor.ts`
 * consomme `core/math/percentile`) ; `qualityLevels.ts` n'importe rien.
 */
const SRC_ROOT = join(process.cwd(), 'src');

const ALLOWED_LAYERS: Readonly<Record<string, readonly string[]>> = {
  core: [],
  audio: ['core'],
  analysis: ['core', 'music'],
  music: ['core'],
  behaviour: ['core', 'music'],
  visual: ['core', 'behaviour', 'music', 'render'],
  render: ['core'],
  presets: ['core', 'music', 'behaviour', 'analysis', 'visual'],
  project: ['music'],
  perf: ['core'],
  export: [
    'core', 'audio', 'analysis', 'music', 'behaviour', 'visual', 'render',
    'presets', 'project', 'perf', 'debug', 'integration',
  ],
  ui: [
    'core', 'audio', 'analysis', 'music', 'behaviour', 'visual', 'render',
    'export', 'presets', 'project', 'perf', 'debug', 'integration',
  ],
};

interface ImportEdge {
  file: string;
  layer: string;
  specifier: string;
  targetLayer: string | null;
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function layerOf(pathFromSrc: string): string {
  return pathFromSrc.split(/[\\/]/)[0] ?? '';
}

function resolveRelativeToLayer(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null; // dépendance externe (npm), hors périmètre de ce test
  const resolved = join(dirname(fromFile), specifier);
  const rel = relative(SRC_ROOT, resolved).replace(/\\/g, '/');
  return layerOf(rel);
}

function collectImports(file: string): ImportEdge[] {
  const text = readFileSync(file, 'utf-8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const relFile = relative(SRC_ROOT, file).replace(/\\/g, '/');
  const layer = layerOf(relFile);
  const edges: ImportEdge[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      edges.push({
        file: relFile,
        layer,
        specifier,
        targetLayer: resolveRelativeToLayer(file, specifier),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edges;
}

describe('règles de dépendance entre couches (docs/02_ARCHITECTURE.md)', () => {
  const files = listSourceFiles(SRC_ROOT);
  const edges = files.flatMap(collectImports);

  it('aucun import interdit dans src/', () => {
    const violations = edges.filter((edge) => {
      if (!edge.targetLayer || edge.targetLayer === edge.layer) return false;
      const allowed = ALLOWED_LAYERS[edge.layer];
      if (allowed === undefined) return false; // couche non encore contrainte par le tableau
      return !allowed.includes(edge.targetLayer);
    });

    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });
});
