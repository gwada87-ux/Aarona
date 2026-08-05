/**
 * Lecteur/écrivain ZIP minimal — project/zip (docs/13_PROJECT_FORMAT.md,
 * fichier `.pvproj` : « Archive ZIP (compatible avec l'écosystème,
 * inspectable) »). Méthode STORE uniquement (aucune compression) : l'audio
 * embarqué est déjà compressé par son propre codec, `project.json`/
 * `thumbnail.jpg` sont petits — implémenter DEFLATE à la main pour ce gain
 * marginal aurait été disproportionné (même logique qu'ADR-003 : DSP/formats
 * maison quand c'est raisonnable, pas de dépendance tierce sans mandat pour
 * un besoin aussi contenu). Un ZIP STORE-only reste un `.zip` valide,
 * ouvrable par n'importe quel outil standard.
 */

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIR_SIGNATURE = 0x06054b50;
const VERSION_NEEDED = 20; // 2.0 — méthode STORE, aucune fonctionnalité récente
const METHOD_STORE = 0;
const EOCD_FIXED_SIZE = 22;

// Horodatage DOS fixe (1980-01-01) : project.json porte déjà meta.modifiedAt, la vraie source de vérité.
const DOS_TIME = 0;
const DOS_DATE = ((1980 - 1980) << 9) | (1 << 5) | 1;

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

export class ZipFormatError extends Error {}

let crcTable: Uint32Array | null = null;
function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  writeBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }
  writeUint16(value: number): void {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, value, true);
    this.writeBytes(b);
  }
  writeUint32(value: number): void {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, value, true);
    this.writeBytes(b);
  }
  offset(): number {
    return this.length;
  }
  toUint8Array(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, o);
      o += chunk.length;
    }
    return out;
  }
}

export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  const writer = new ByteWriter();
  const central: Array<{ name: Uint8Array; crc: number; size: number; offset: number }> = [];

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const crc = crc32(entry.data);
    const offset = writer.offset();

    writer.writeUint32(LOCAL_FILE_SIGNATURE);
    writer.writeUint16(VERSION_NEEDED);
    writer.writeUint16(0); // flags
    writer.writeUint16(METHOD_STORE);
    writer.writeUint16(DOS_TIME);
    writer.writeUint16(DOS_DATE);
    writer.writeUint32(crc);
    writer.writeUint32(entry.data.length); // taille compressée == non compressée (STORE)
    writer.writeUint32(entry.data.length);
    writer.writeUint16(nameBytes.length);
    writer.writeUint16(0); // longueur du champ extra
    writer.writeBytes(nameBytes);
    writer.writeBytes(entry.data);

    central.push({ name: nameBytes, crc, size: entry.data.length, offset });
  }

  const centralDirStart = writer.offset();
  for (const e of central) {
    writer.writeUint32(CENTRAL_DIR_SIGNATURE);
    writer.writeUint16(VERSION_NEEDED); // version ayant créé l'archive
    writer.writeUint16(VERSION_NEEDED); // version requise pour l'extraire
    writer.writeUint16(0); // flags
    writer.writeUint16(METHOD_STORE);
    writer.writeUint16(DOS_TIME);
    writer.writeUint16(DOS_DATE);
    writer.writeUint32(e.crc);
    writer.writeUint32(e.size);
    writer.writeUint32(e.size);
    writer.writeUint16(e.name.length);
    writer.writeUint16(0); // extra
    writer.writeUint16(0); // commentaire
    writer.writeUint16(0); // numéro de disque
    writer.writeUint16(0); // attributs internes
    writer.writeUint32(0); // attributs externes
    writer.writeUint32(e.offset);
    writer.writeBytes(e.name);
  }
  const centralDirSize = writer.offset() - centralDirStart;

  writer.writeUint32(END_OF_CENTRAL_DIR_SIGNATURE);
  writer.writeUint16(0); // numéro de disque
  writer.writeUint16(0); // disque portant le répertoire central
  writer.writeUint16(central.length);
  writer.writeUint16(central.length);
  writer.writeUint32(centralDirSize);
  writer.writeUint32(centralDirStart);
  writer.writeUint16(0); // longueur du commentaire

  return writer.toUint8Array();
}

/**
 * Cherche la signature de fin de répertoire central en partant de la fin —
 * toujours exactement 22 octets avant la fin pour une archive écrite par
 * `writeZip` (jamais de commentaire), recherche en arrière par robustesse
 * pour les archives d'autres outils.
 */
function findEndOfCentralDirectory(view: DataView, length: number): number {
  for (let i = length - EOCD_FIXED_SIZE; i >= 0; i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIR_SIGNATURE) return i;
  }
  throw new ZipFormatError('signature de fin de répertoire central introuvable — fichier corrompu ou non-ZIP');
}

export function readZip(data: Uint8Array): ZipEntry[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view, data.length);

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  const entries: ZipEntry[] = [];
  let offset = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) {
      throw new ZipFormatError(`en-tête de répertoire central invalide à l'entrée ${i}`);
    }
    const method = view.getUint16(offset + 10, true);
    const crcExpected = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = textDecoder.decode(data.subarray(offset + 46, offset + 46 + nameLength));

    if (method !== METHOD_STORE) throw new ZipFormatError(`${name} : méthode de compression non supportée (STORE uniquement)`);

    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const fileData = data.subarray(dataStart, dataStart + size);

    if (crc32(fileData) !== crcExpected) throw new ZipFormatError(`${name} : somme de contrôle CRC-32 invalide — archive corrompue`);

    entries.push({ name, data: fileData });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
