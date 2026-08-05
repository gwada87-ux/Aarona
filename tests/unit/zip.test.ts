import { describe, expect, it } from 'vitest';
import { readZip, writeZip, ZipFormatError } from '../../src/project/zip';

describe('writeZip / readZip — aller-retour', () => {
  it('restitue exactement le nom et les octets d\'une seule entrée', () => {
    const data = new TextEncoder().encode('contenu de test');
    const zip = writeZip([{ name: 'fichier.txt', data }]);
    const [entry] = readZip(zip);
    expect(entry!.name).toBe('fichier.txt');
    expect(Array.from(entry!.data)).toEqual(Array.from(data));
  });

  it('conserve plusieurs entrées, dans l\'ordre, y compris un dossier ("audio/track.mp3")', () => {
    const entries = [
      { name: 'project.json', data: new TextEncoder().encode('{}') },
      { name: 'thumbnail.jpg', data: Uint8Array.from([0xff, 0xd8, 0xff, 0x00]) },
      { name: 'audio/track.mp3', data: Uint8Array.from([1, 2, 3, 4, 5]) },
    ];
    const zip = writeZip(entries);
    const read = readZip(zip);
    expect(read.map((e) => e.name)).toEqual(['project.json', 'thumbnail.jpg', 'audio/track.mp3']);
    for (let i = 0; i < entries.length; i++) {
      expect(Array.from(read[i]!.data)).toEqual(Array.from(entries[i]!.data));
    }
  });

  it('couvre toutes les valeurs d\'octet 0..255 sans corruption (binaire arbitraire, pas seulement du texte)', () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) data[i] = i;
    const zip = writeZip([{ name: 'binaire.bin', data }]);
    const [entry] = readZip(zip);
    expect(Array.from(entry!.data)).toEqual(Array.from(data));
  });

  it('gère une entrée vide (0 octet)', () => {
    const zip = writeZip([{ name: 'vide.txt', data: new Uint8Array(0) }]);
    const [entry] = readZip(zip);
    expect(entry!.data).toHaveLength(0);
  });

  it('gère un nom de fichier non-ASCII (UTF-8)', () => {
    const zip = writeZip([{ name: 'été.mp3', data: Uint8Array.from([1, 2, 3]) }]);
    const [entry] = readZip(zip);
    expect(entry!.name).toBe('été.mp3');
  });

  it('détecte une corruption via le CRC-32 (un octet de donnée modifié après écriture)', () => {
    const zip = writeZip([{ name: 'f.txt', data: Uint8Array.from([1, 2, 3, 4]) }]);
    // Localise la charge utile [1,2,3,4] écrite dans l'archive et la modifie — le CRC
    // vérifie la donnée, pas l'en-tête, donc n'importe quel octet du payload fait l'affaire.
    let dataIndex = -1;
    for (let i = 0; i < zip.length - 3; i++) {
      if (zip[i] === 1 && zip[i + 1] === 2 && zip[i + 2] === 3 && zip[i + 3] === 4) {
        dataIndex = i;
        break;
      }
    }
    expect(dataIndex).toBeGreaterThanOrEqual(0);
    const tampered = zip.slice();
    tampered[dataIndex] = 99;
    expect(() => readZip(tampered)).toThrow(ZipFormatError);
  });

  it('rejette une entrée qui n\'est pas un ZIP (pas de signature de fin de répertoire central)', () => {
    const garbage = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(() => readZip(garbage)).toThrow(ZipFormatError);
  });

  it('archive sans entrée : round-trip vide, pas d\'exception', () => {
    const zip = writeZip([]);
    expect(readZip(zip)).toEqual([]);
  });
});
