/**
 * Tests de `audio/decode.ts::decodeAudioFile()` — Étape 35. Premier test de
 * ce module, via `FakeAudioContext` (déjà construit à l'Étape 27, son
 * `decodeAudioData()` était déjà stubbé mais jamais exercé par un test).
 *
 * Le test le plus important ici défend le « piège #3 » documenté dans le
 * fichier source : `AudioContext.decodeAudioData()` DÉTACHE l'`ArrayBuffer`
 * qu'on lui passe — `decodeAudioFile()` doit donc lui donner une COPIE
 * (`.slice(0)`), jamais `originalBytes` lui-même, sous peine de rendre
 * `originalBytes` inutilisable pour le remux/hash après coup.
 */
import { describe, expect, it, vi } from 'vitest';
import { decodeAudioFile, AudioValidationError, MAX_FILE_SIZE_BYTES, MAX_DURATION_SECONDS } from '../../src/audio/decode';
import { FakeAudioContext } from './testSupport/FakeAudioContext';

/** Contenu zéro — suffisant pour les tests de taille/durée, où seul `.size`/`.byteLength` compte. */
function fileOfSize(size: number): File {
  return new File([new Uint8Array(size)], 'test.wav', { type: 'audio/wav' });
}

/** Contenu réel non nul, pour les tests d'intégrité byte-à-byte (petites tailles seulement). */
function fileWithRealContent(size: number): File {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 37) % 256;
  return new File([bytes], 'test.wav', { type: 'audio/wav' });
}

describe('decodeAudioFile — validation de taille (AVANT décodage)', () => {
  it('fichier > 150 Mo : rejette sans jamais appeler decodeAudioData (pas de décodage gaspillé)', async () => {
    const ctx = new FakeAudioContext();
    const decodeSpy = vi.spyOn(ctx, 'decodeAudioData');
    const file = fileOfSize(MAX_FILE_SIZE_BYTES + 1);

    await expect(decodeAudioFile(file, ctx as unknown as AudioContext)).rejects.toThrow(AudioValidationError);
    expect(decodeSpy).not.toHaveBeenCalled();
  });

  it('message d\'erreur mentionne la taille et "150 Mo"', async () => {
    const ctx = new FakeAudioContext();
    const file = fileOfSize(MAX_FILE_SIZE_BYTES + 1024 * 1024);
    await expect(decodeAudioFile(file, ctx as unknown as AudioContext)).rejects.toThrow(/trop volumineux.*150 Mo/);
  });

  it('fichier exactement à la limite (150 Mo pile) : PAS rejeté pour la taille (borne exclusive, > pas >=)', async () => {
    const ctx = new FakeAudioContext();
    ctx.nextDecodedDuration = 5;
    const file = fileOfSize(MAX_FILE_SIZE_BYTES);
    await expect(decodeAudioFile(file, ctx as unknown as AudioContext)).resolves.toBeDefined();
  });
});

describe('decodeAudioFile — validation de durée (APRÈS décodage)', () => {
  it('durée > 12 min : rejette après un décodage qui a bien eu lieu', async () => {
    const ctx = new FakeAudioContext();
    const decodeSpy = vi.spyOn(ctx, 'decodeAudioData');
    ctx.nextDecodedDuration = MAX_DURATION_SECONDS + 1;
    const file = fileOfSize(1024);

    await expect(decodeAudioFile(file, ctx as unknown as AudioContext)).rejects.toThrow(AudioValidationError);
    expect(decodeSpy).toHaveBeenCalledTimes(1); // contrairement au rejet de taille : le décodage a bien eu lieu
  });

  it('message d\'erreur mentionne la durée et "12 min" (arrondi à 1 décimale)', async () => {
    const ctx = new FakeAudioContext();
    ctx.nextDecodedDuration = 13 * 60; // 13 min
    const file = fileOfSize(1024);
    await expect(decodeAudioFile(file, ctx as unknown as AudioContext)).rejects.toThrow(/trop long.*13\.0 min.*12 min/);
  });

  it('durée exactement à la limite (12 min pile) : PAS rejetée (borne exclusive)', async () => {
    const ctx = new FakeAudioContext();
    ctx.nextDecodedDuration = MAX_DURATION_SECONDS;
    const file = fileOfSize(1024);
    await expect(decodeAudioFile(file, ctx as unknown as AudioContext)).resolves.toBeDefined();
  });
});

describe('decodeAudioFile — chemin nominal', () => {
  it('renvoie le buffer décodé ET les octets d\'origine', async () => {
    const ctx = new FakeAudioContext();
    ctx.nextDecodedDuration = 42;
    const file = fileOfSize(2048);

    const result = await decodeAudioFile(file, ctx as unknown as AudioContext);

    expect(result.buffer.duration).toBe(42);
    expect(result.originalBytes.byteLength).toBe(2048);
  });
});

describe('decodeAudioFile — piège #3 : ArrayBuffer détaché par decodeAudioData', () => {
  it('decodeAudioData reçoit une COPIE distincte, jamais originalBytes lui-même', async () => {
    const ctx = new FakeAudioContext();
    const decodeSpy = vi.spyOn(ctx, 'decodeAudioData');
    const file = fileOfSize(1024);

    const result = await decodeAudioFile(file, ctx as unknown as AudioContext);

    expect(decodeSpy).toHaveBeenCalledTimes(1);
    const passedBuffer = decodeSpy.mock.calls[0]![0];
    expect(passedBuffer).not.toBe(result.originalBytes); // références DISTINCTES
    expect(passedBuffer.byteLength).toBe(result.originalBytes.byteLength); // mais même contenu
  });

  it('originalBytes reste pleinement lisible après l\'appel (jamais détaché) — contenu byte-à-byte intact', async () => {
    const ctx = new FakeAudioContext();
    const file = fileWithRealContent(256);
    const expectedBytes = new Uint8Array(await file.arrayBuffer());

    const result = await decodeAudioFile(file, ctx as unknown as AudioContext);

    const actualBytes = new Uint8Array(result.originalBytes);
    expect(actualBytes).toEqual(expectedBytes);
  });
});
