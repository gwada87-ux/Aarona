/**
 * Fichier `.pvproj` — project/pvproj (docs/13_PROJECT_FORMAT.md §"Fichier
 * .pvproj") : `project.json` + `thumbnail.jpg` + `music.pmdi.json` (mode
 * "pmdi" uniquement) + `audio/<nom>` (sauvegarde "Complète" uniquement).
 *
 * `Project.music.pmdi` (docs/13 §"Modèle") vit directement sur l'objet en
 * mémoire (IndexedDB : un seul enregistrement, pas de notion de fichiers
 * séparés). En le SÉRIALISANT en `.pvproj`, ce module l'EXTRAIT vers sa
 * propre entrée `music.pmdi.json` plutôt que de le dupliquer dans
 * `project.json` — c'est justement la raison d'être de cette entrée séparée
 * (docs/13 : « un document PMDI complet pèse 2 à 5 Mo », project.json doit
 * rester petit). `readPvproj` fait l'inverse : il RÉ-INJECTE le PMDI lu dans
 * `project.music.pmdi` avant validation, pour que l'objet `Project` retourné
 * respecte toujours la forme complète du modèle TypeScript.
 */
import { migrate } from './migrate';
import type { Project } from './Project';
import type { PmdiDocument } from '../music/pmdi';
import { readZip, writeZip, ZipFormatError, type ZipEntry } from './zip';

const PROJECT_ENTRY = 'project.json';
const THUMBNAIL_ENTRY = 'thumbnail.jpg';
const PMDI_ENTRY = 'music.pmdi.json';
const AUDIO_DIR = 'audio/';

export class PvprojFormatError extends Error {}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface WritePvprojOptions {
  readonly project: Project;
  readonly thumbnail: Uint8Array;
  /** Présent seulement en sauvegarde « Complète » (docs/13) — absent en mode « Léger » (audio référencé par hash). */
  readonly audio?: { readonly filename: string; readonly data: Uint8Array };
}

export function writePvproj(options: WritePvprojOptions): Uint8Array {
  const { project, thumbnail, audio } = options;
  const entries: ZipEntry[] = [];

  if (project.music.mode === 'pmdi' && project.music.pmdi) {
    const { pmdi, ...musicWithoutPmdi } = project.music;
    const projectForFile: Project = { ...project, music: musicWithoutPmdi };
    entries.push({ name: PMDI_ENTRY, data: textEncoder.encode(JSON.stringify(pmdi)) });
    entries.push({ name: PROJECT_ENTRY, data: textEncoder.encode(JSON.stringify(projectForFile)) });
  } else {
    entries.push({ name: PROJECT_ENTRY, data: textEncoder.encode(JSON.stringify(project)) });
  }

  entries.push({ name: THUMBNAIL_ENTRY, data: thumbnail });
  if (audio) entries.push({ name: `${AUDIO_DIR}${audio.filename}`, data: audio.data });
  return writeZip(entries);
}

export async function writePvprojBlob(options: WritePvprojOptions): Promise<Blob> {
  return new Blob([writePvproj(options) as BlobPart], { type: 'application/zip' });
}

export interface ReadPvprojResult {
  readonly project: Project;
  readonly thumbnail: Uint8Array | null;
  /** Miroir de `project.music.pmdi` — pratique quand l'appelant ne veut pas vérifier `music.mode` lui-même. */
  readonly pmdi: PmdiDocument | null;
  readonly audio: { readonly filename: string; readonly data: Uint8Array } | null;
}

/** Lit et migre `project.json` (docs/13 §"Migration") — lève `ProjectError` si invalide/trop récent, jamais une lecture partielle. */
export function readPvproj(data: Uint8Array): ReadPvprojResult {
  let entries: ZipEntry[];
  try {
    entries = readZip(data);
  } catch (err) {
    if (err instanceof ZipFormatError) throw new PvprojFormatError(`fichier .pvproj invalide : ${err.message}`);
    throw err;
  }

  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const projectBytes = byName.get(PROJECT_ENTRY);
  if (!projectBytes) throw new PvprojFormatError("project.json absent de l'archive");

  const projectRaw: unknown = JSON.parse(textDecoder.decode(projectBytes));
  const pmdiBytes = byName.get(PMDI_ENTRY);
  const pmdi = pmdiBytes ? (JSON.parse(textDecoder.decode(pmdiBytes)) as PmdiDocument) : null;

  if (pmdi && isRecord(projectRaw) && isRecord(projectRaw.music)) {
    projectRaw.music = { ...projectRaw.music, pmdi };
  }

  const project = migrate(projectRaw);

  const audioEntry = entries.find((e) => e.name.startsWith(AUDIO_DIR));
  const audio = audioEntry ? { filename: audioEntry.name.slice(AUDIO_DIR.length), data: audioEntry.data } : null;

  return { project, thumbnail: byName.get(THUMBNAIL_ENTRY) ?? null, pmdi, audio };
}

export async function readPvprojBlob(blob: Blob): Promise<ReadPvprojResult> {
  const buffer = await blob.arrayBuffer();
  return readPvproj(new Uint8Array(buffer));
}
