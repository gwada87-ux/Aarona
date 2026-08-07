/**
 * Persistance IndexedDB — project/storage/db (docs/13_PROJECT_FORMAT.md
 * §"Persistance IndexedDB"). Quatre magasins : `projects` (clé `id`),
 * `audioCache`/`analysisCache` (LRU, plafonds 500 Mo / 200 Mo), `settings`
 * (clé unique `"app"`).
 *
 * Non couvert par un test automatisé : `indexedDB` n'existe pas en
 * environnement Node (Vitest) — même limite déjà documentée pour
 * `AudioEngine.ts`/`analysis/worker.ts`. La décision « quoi évincer » est
 * isolée dans `project/lru.ts` (pure, testée) précisément pour que le
 * minimum de logique reste ici, non vérifiable autrement qu'au navigateur.
 */
import { selectEvictions, type CacheEntry } from '../lru';
import type { PmdiDocument } from '../../music/pmdi';
import type { Project } from '../Project';

export const DB_NAME = 'pulsar-visualizer';
export const DB_VERSION = 1;
export const AUDIO_CACHE_LIMIT_BYTES = 500 * 1024 * 1024;
export const ANALYSIS_CACHE_LIMIT_BYTES = 200 * 1024 * 1024;

const PROJECTS_STORE = 'projects';
const AUDIO_CACHE_STORE = 'audioCache';
const ANALYSIS_CACHE_STORE = 'analysisCache';
const SETTINGS_STORE = 'settings';
const SETTINGS_KEY = 'app';

export interface StoredProject {
  readonly id: string;
  readonly project: Project;
  readonly thumbnail: Blob;
  /**
   * Pochette importée, octets d'origine (docs/17 §7.5, chantier 10 lot B).
   *
   * AUCUNE MONTÉE DE `DB_VERSION` n'a été nécessaire, et ce n'est pas une
   * approximation : un magasin IndexedDB n'a pas de schéma de colonnes. Il
   * stocke des objets structurés-clonables indexés par `keyPath`, donc ajouter
   * un champ à `StoredProject` est lisible par l'ancienne version comme par la
   * nouvelle - l'ancienne l'ignore, la nouvelle le trouve `undefined` sur les
   * enregistrements écrits avant. `DB_VERSION` ne sert qu'à créer ou supprimer
   * des MAGASINS et des index, et il n'y en a ni l'un ni l'autre ici.
   */
  readonly cover?: Blob;
}

interface AudioCacheRecord {
  readonly hash: string;
  readonly blob: Blob;
  readonly size: number;
  readonly lastAccessed: number;
}

interface AnalysisCacheRecord {
  readonly cacheKey: string;
  readonly pmdi: PmdiDocument;
  readonly size: number;
  readonly lastAccessed: number;
}

export interface AppSettings {
  readonly reducedFlashingDefault?: boolean;
  readonly quality?: 'auto' | 'low' | 'medium' | 'high' | 'ultra';
  readonly [key: string]: unknown;
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisifyTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction IndexedDB annulée'));
  });
}

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(AUDIO_CACHE_STORE)) db.createObjectStore(AUDIO_CACHE_STORE, { keyPath: 'hash' });
      if (!db.objectStoreNames.contains(ANALYSIS_CACHE_STORE)) db.createObjectStore(ANALYSIS_CACHE_STORE, { keyPath: 'cacheKey' });
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Demande un stockage persistant (docs/13 : « demandé au premier
 * enregistrement ») — best-effort, l'API peut être absente ou refuser sans
 * que ce soit une erreur bloquante pour l'utilisateur.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

// --- projects ---------------------------------------------------------------

export async function saveProject(db: IDBDatabase, project: Project, thumbnail: Blob, cover?: Blob | null): Promise<void> {
  const tx = db.transaction(PROJECTS_STORE, 'readwrite');
  // `cover` OMIS quand il n'y en a pas, plutôt que mis à `undefined` : un `put`
  // remplace l'enregistrement entier, donc un champ présent à `undefined` et un
  // champ absent sont équivalents ici — mais l'enregistrement reste lisible par
  // une version antérieure qui ne connaît pas le champ.
  const record: StoredProject = cover
    ? { id: project.meta.id, project, thumbnail, cover }
    : { id: project.meta.id, project, thumbnail };
  tx.objectStore(PROJECTS_STORE).put(record);
  await promisifyTransaction(tx);
}

export async function loadProject(db: IDBDatabase, id: string): Promise<StoredProject | null> {
  const tx = db.transaction(PROJECTS_STORE, 'readonly');
  const result = await promisifyRequest(tx.objectStore(PROJECTS_STORE).get(id));
  return (result as StoredProject | undefined) ?? null;
}

export async function listProjects(db: IDBDatabase): Promise<StoredProject[]> {
  const tx = db.transaction(PROJECTS_STORE, 'readonly');
  const result = await promisifyRequest(tx.objectStore(PROJECTS_STORE).getAll());
  return result as StoredProject[];
}

export async function deleteProject(db: IDBDatabase, id: string): Promise<void> {
  const tx = db.transaction(PROJECTS_STORE, 'readwrite');
  tx.objectStore(PROJECTS_STORE).delete(id);
  await promisifyTransaction(tx);
}

// --- caches (LRU) -------------------------------------------------------------

async function evictFromStore(db: IDBDatabase, storeName: string, keyField: string, limitBytes: number): Promise<void> {
  const readTx = db.transaction(storeName, 'readonly');
  const all = (await promisifyRequest(readTx.objectStore(storeName).getAll())) as Array<Record<string, unknown>>;
  const entries: CacheEntry[] = all.map((r) => ({
    key: r[keyField] as string,
    size: r.size as number,
    lastAccessed: r.lastAccessed as number,
  }));
  const toEvict = selectEvictions(entries, limitBytes);
  if (toEvict.length === 0) return;

  const writeTx = db.transaction(storeName, 'readwrite');
  const store = writeTx.objectStore(storeName);
  for (const key of toEvict) store.delete(key);
  await promisifyTransaction(writeTx);
}

export async function cacheAudio(db: IDBDatabase, hash: string, blob: Blob): Promise<void> {
  const tx = db.transaction(AUDIO_CACHE_STORE, 'readwrite');
  const record: AudioCacheRecord = { hash, blob, size: blob.size, lastAccessed: Date.now() };
  tx.objectStore(AUDIO_CACHE_STORE).put(record);
  await promisifyTransaction(tx);
  await evictFromStore(db, AUDIO_CACHE_STORE, 'hash', AUDIO_CACHE_LIMIT_BYTES);
}

export async function getCachedAudio(db: IDBDatabase, hash: string): Promise<Blob | null> {
  const readTx = db.transaction(AUDIO_CACHE_STORE, 'readonly');
  const record = (await promisifyRequest(readTx.objectStore(AUDIO_CACHE_STORE).get(hash))) as AudioCacheRecord | undefined;
  if (!record) return null;

  const touchTx = db.transaction(AUDIO_CACHE_STORE, 'readwrite');
  touchTx.objectStore(AUDIO_CACHE_STORE).put({ ...record, lastAccessed: Date.now() });
  await promisifyTransaction(touchTx);
  return record.blob;
}

export async function cacheAnalysis(db: IDBDatabase, cacheKey: string, pmdi: PmdiDocument): Promise<void> {
  const size = new TextEncoder().encode(JSON.stringify(pmdi)).length;
  const tx = db.transaction(ANALYSIS_CACHE_STORE, 'readwrite');
  const record: AnalysisCacheRecord = { cacheKey, pmdi, size, lastAccessed: Date.now() };
  tx.objectStore(ANALYSIS_CACHE_STORE).put(record);
  await promisifyTransaction(tx);
  await evictFromStore(db, ANALYSIS_CACHE_STORE, 'cacheKey', ANALYSIS_CACHE_LIMIT_BYTES);
}

export async function getCachedAnalysis(db: IDBDatabase, cacheKey: string): Promise<PmdiDocument | null> {
  const readTx = db.transaction(ANALYSIS_CACHE_STORE, 'readonly');
  const record = (await promisifyRequest(readTx.objectStore(ANALYSIS_CACHE_STORE).get(cacheKey))) as AnalysisCacheRecord | undefined;
  if (!record) return null;

  const touchTx = db.transaction(ANALYSIS_CACHE_STORE, 'readwrite');
  touchTx.objectStore(ANALYSIS_CACHE_STORE).put({ ...record, lastAccessed: Date.now() });
  await promisifyTransaction(touchTx);
  return record.pmdi;
}

/** Espace total occupé par les deux caches — pour l'affichage préconisé par docs/13 ("l'espace occupé"). */
export async function getCacheUsage(db: IDBDatabase): Promise<{ audioBytes: number; analysisBytes: number }> {
  const audioTx = db.transaction(AUDIO_CACHE_STORE, 'readonly');
  const audioRecords = (await promisifyRequest(audioTx.objectStore(AUDIO_CACHE_STORE).getAll())) as AudioCacheRecord[];
  const analysisTx = db.transaction(ANALYSIS_CACHE_STORE, 'readonly');
  const analysisRecords = (await promisifyRequest(analysisTx.objectStore(ANALYSIS_CACHE_STORE).getAll())) as AnalysisCacheRecord[];
  return {
    audioBytes: audioRecords.reduce((sum, r) => sum + r.size, 0),
    analysisBytes: analysisRecords.reduce((sum, r) => sum + r.size, 0),
  };
}

export async function clearCaches(db: IDBDatabase): Promise<void> {
  const tx = db.transaction([AUDIO_CACHE_STORE, ANALYSIS_CACHE_STORE], 'readwrite');
  tx.objectStore(AUDIO_CACHE_STORE).clear();
  tx.objectStore(ANALYSIS_CACHE_STORE).clear();
  await promisifyTransaction(tx);
}

// --- settings -----------------------------------------------------------------

export async function getSettings(db: IDBDatabase): Promise<AppSettings> {
  const tx = db.transaction(SETTINGS_STORE, 'readonly');
  const record = (await promisifyRequest(tx.objectStore(SETTINGS_STORE).get(SETTINGS_KEY))) as { key: string; value: AppSettings } | undefined;
  return record?.value ?? {};
}

export async function saveSettings(db: IDBDatabase, settings: AppSettings): Promise<void> {
  const tx = db.transaction(SETTINGS_STORE, 'readwrite');
  tx.objectStore(SETTINGS_STORE).put({ key: SETTINGS_KEY, value: settings });
  await promisifyTransaction(tx);
}
