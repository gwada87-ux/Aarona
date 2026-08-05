/**
 * Tests de `project/storage/db.ts` — Étape 31. Premiers tests automatisés de
 * ce module (jusqu'ici « non couvert par un test automatisé : `indexedDB`
 * n'existe pas en environnement Node », voir son commentaire d'en-tête) via
 * `fake-indexeddb` (dépendance de dev ajoutée à cette étape, avec l'accord
 * d'Aaron — cf. docs/JOURNAL.md).
 *
 * `IDBFactory` fraîche à chaque test (`beforeEach`) : `openDatabase()` ouvre
 * toujours le même `DB_NAME` fixe — sans réinitialisation, les tests
 * partageraient un état IndexedDB persistant d'un test à l'autre.
 *
 * Limite assumée : `AUDIO_CACHE_LIMIT_BYTES`/`ANALYSIS_CACHE_LIMIT_BYTES`
 * (500 Mo / 200 Mo) ne sont pas des paramètres injectables — les dépasser
 * réellement dans un test allouerait des centaines de Mo, impraticable.
 * L'algorithme de SÉLECTION de l'éviction (`selectEvictions`) est déjà
 * testé, pur, dans `project/lru.test.ts` ; ce fichier-ci vérifie seulement
 * que `cacheAudio`/`cacheAnalysis` écrivent et relisent correctement sous
 * la limite (le chemin réellement executé à chaque appel), pas le
 * déclenchement de l'éviction elle-même à pleine échelle.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  openDatabase,
  saveProject,
  loadProject,
  listProjects,
  deleteProject,
  cacheAudio,
  getCachedAudio,
  cacheAnalysis,
  getCachedAnalysis,
  getCacheUsage,
  clearCaches,
  getSettings,
  saveSettings,
} from '../../src/project/storage/db';
import type { Project } from '../../src/project/Project';
import type { PmdiDocument } from '../../src/music/pmdi';
import { makeProject } from './testSupport/projectFixture';

beforeEach(() => {
  // eslint-disable-next-line no-global-assign
  indexedDB = new IDBFactory();
});

function projectWithId(id: string): Project {
  const p = makeProject();
  return { ...p, meta: { ...p.meta, id } };
}

function minimalPmdi(): PmdiDocument {
  return {
    pmdi: '1.0',
    source: { kind: 'analysis', generator: 'test@1.0', createdAt: '2026-01-01T00:00:00.000Z' },
    audio: { duration: 10, sampleRate: 48000, channels: 2 },
    tempo: { global: 120, confidence: 1, map: [{ t: 0, bpm: 120 }] },
    meter: { map: [{ t: 0, num: 4, den: 4 }] },
    events: [],
    confidence: { tempo: 1, grid: 1, classification: 1, structure: 1 },
  };
}

describe('db — openDatabase / schéma', () => {
  it('crée les 4 magasins attendus', async () => {
    const db = await openDatabase();
    expect(db.objectStoreNames.contains('projects')).toBe(true);
    expect(db.objectStoreNames.contains('audioCache')).toBe(true);
    expect(db.objectStoreNames.contains('analysisCache')).toBe(true);
    expect(db.objectStoreNames.contains('settings')).toBe(true);
    db.close();
  });

  it('une seconde ouverture réutilise le même schéma sans erreur (idempotent)', async () => {
    const db1 = await openDatabase();
    db1.close();
    const db2 = await openDatabase();
    expect(db2.objectStoreNames.contains('projects')).toBe(true);
    db2.close();
  });
});

describe('db — projects CRUD', () => {
  it('saveProject -> loadProject : round-trip fidèle (projet + vignette)', async () => {
    const db = await openDatabase();
    const project = projectWithId('p1');
    const thumbnail = new Blob(['jpeg-bytes'], { type: 'image/jpeg' });

    await saveProject(db, project, thumbnail);
    const loaded = await loadProject(db, 'p1');

    expect(loaded).not.toBeNull();
    expect(loaded!.project).toEqual(project);
    expect(loaded!.thumbnail.size).toBe(thumbnail.size);
    expect(loaded!.thumbnail.type).toBe('image/jpeg');
    db.close();
  });

  it('loadProject sur un id inconnu renvoie null (pas une erreur)', async () => {
    const db = await openDatabase();
    expect(await loadProject(db, 'jamais-sauvé')).toBeNull();
    db.close();
  });

  it('saveProject sur un id existant écrase (put, pas add) — pas de doublon', async () => {
    const db = await openDatabase();
    const project = projectWithId('p1');
    await saveProject(db, project, new Blob(['a']));
    const updated = { ...project, meta: { ...project.meta, name: 'Renommé' } };
    await saveProject(db, updated, new Blob(['b']));

    const all = await listProjects(db);
    expect(all).toHaveLength(1);
    expect(all[0]!.project.meta.name).toBe('Renommé');
    db.close();
  });

  it('listProjects renvoie tous les projets sauvés', async () => {
    const db = await openDatabase();
    await saveProject(db, projectWithId('p1'), new Blob(['a']));
    await saveProject(db, projectWithId('p2'), new Blob(['b']));
    await saveProject(db, projectWithId('p3'), new Blob(['c']));

    const all = await listProjects(db);
    expect(all.map((s) => s.id).sort()).toEqual(['p1', 'p2', 'p3']);
    db.close();
  });

  it('listProjects sur une base vide renvoie un tableau vide', async () => {
    const db = await openDatabase();
    expect(await listProjects(db)).toEqual([]);
    db.close();
  });

  it('deleteProject retire le projet, les autres restent', async () => {
    const db = await openDatabase();
    await saveProject(db, projectWithId('p1'), new Blob(['a']));
    await saveProject(db, projectWithId('p2'), new Blob(['b']));

    await deleteProject(db, 'p1');

    expect(await loadProject(db, 'p1')).toBeNull();
    expect(await loadProject(db, 'p2')).not.toBeNull();
    db.close();
  });

  it('deleteProject sur un id inconnu ne lève pas (no-op silencieux)', async () => {
    const db = await openDatabase();
    await expect(deleteProject(db, 'jamais-sauvé')).resolves.toBeUndefined();
    db.close();
  });
});

describe('db — cache audio', () => {
  it('cacheAudio -> getCachedAudio : round-trip fidèle', async () => {
    const db = await openDatabase();
    const blob = new Blob(['contenu-audio'], { type: 'audio/mpeg' });

    await cacheAudio(db, 'hash-1', blob);
    const cached = await getCachedAudio(db, 'hash-1');

    expect(cached).not.toBeNull();
    expect(cached!.size).toBe(blob.size);
    expect(cached!.type).toBe('audio/mpeg');
    db.close();
  });

  it('getCachedAudio sur un hash absent renvoie null', async () => {
    const db = await openDatabase();
    expect(await getCachedAudio(db, 'jamais-caché')).toBeNull();
    db.close();
  });

  it('cacheAudio sur le même hash écrase (pas de doublon dans getCacheUsage)', async () => {
    const db = await openDatabase();
    await cacheAudio(db, 'hash-1', new Blob(['court']));
    await cacheAudio(db, 'hash-1', new Blob(['beaucoup-plus-long-que-avant']));

    const usage = await getCacheUsage(db);
    expect(usage.audioBytes).toBe(new Blob(['beaucoup-plus-long-que-avant']).size);
    db.close();
  });
});

describe('db — cache analyse', () => {
  it('cacheAnalysis -> getCachedAnalysis : round-trip fidèle', async () => {
    const db = await openDatabase();
    const pmdi = minimalPmdi();

    await cacheAnalysis(db, 'key-1', pmdi);
    const cached = await getCachedAnalysis(db, 'key-1');

    expect(cached).toEqual(pmdi);
    db.close();
  });

  it('getCachedAnalysis sur une clé absente renvoie null', async () => {
    const db = await openDatabase();
    expect(await getCachedAnalysis(db, 'jamais-cachée')).toBeNull();
    db.close();
  });
});

describe('db — getCacheUsage / clearCaches', () => {
  it('getCacheUsage additionne les tailles des deux caches indépendamment', async () => {
    const db = await openDatabase();
    const audioBlob = new Blob(['x'.repeat(100)]);
    await cacheAudio(db, 'h1', audioBlob);
    const pmdi = minimalPmdi();
    await cacheAnalysis(db, 'k1', pmdi);

    const usage = await getCacheUsage(db);
    expect(usage.audioBytes).toBe(100);
    expect(usage.analysisBytes).toBe(new TextEncoder().encode(JSON.stringify(pmdi)).length);
    db.close();
  });

  it('base vide : usage nul des deux côtés', async () => {
    const db = await openDatabase();
    expect(await getCacheUsage(db)).toEqual({ audioBytes: 0, analysisBytes: 0 });
    db.close();
  });

  it('clearCaches vide les deux caches, ne touche pas aux projets', async () => {
    const db = await openDatabase();
    await cacheAudio(db, 'h1', new Blob(['x']));
    await cacheAnalysis(db, 'k1', minimalPmdi());
    await saveProject(db, projectWithId('p1'), new Blob(['thumb']));

    await clearCaches(db);

    expect(await getCachedAudio(db, 'h1')).toBeNull();
    expect(await getCachedAnalysis(db, 'k1')).toBeNull();
    expect(await loadProject(db, 'p1')).not.toBeNull(); // les projets ne sont PAS un cache
    db.close();
  });
});

describe('db — settings', () => {
  it('getSettings sur une base vide renvoie un objet vide (pas null, pas d\'erreur)', async () => {
    const db = await openDatabase();
    expect(await getSettings(db)).toEqual({});
    db.close();
  });

  it('saveSettings -> getSettings : round-trip fidèle', async () => {
    const db = await openDatabase();
    await saveSettings(db, { reducedFlashingDefault: true, quality: 'high' });
    expect(await getSettings(db)).toEqual({ reducedFlashingDefault: true, quality: 'high' });
    db.close();
  });

  it('saveSettings écrase entièrement (pas de fusion avec l\'ancien état)', async () => {
    const db = await openDatabase();
    await saveSettings(db, { reducedFlashingDefault: true, quality: 'high' });
    await saveSettings(db, { quality: 'low' });
    expect(await getSettings(db)).toEqual({ quality: 'low' });
    db.close();
  });
});
