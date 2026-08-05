import { describe, expect, it } from 'vitest';
import { computeAudioHash, computeCacheKey } from '../../src/project/cacheKey';

describe('computeAudioHash', () => {
  it('est déterministe : même contenu -> même hash', async () => {
    const data = Uint8Array.from([1, 2, 3, 4, 5]);
    const a = await computeAudioHash(data);
    const b = await computeAudioHash(data.slice()); // copie distincte, même contenu
    expect(a).toBe(b);
  });

  it('des contenus différents produisent des hashes différents', async () => {
    const a = await computeAudioHash(Uint8Array.from([1, 2, 3]));
    const b = await computeAudioHash(Uint8Array.from([1, 2, 4]));
    expect(a).not.toBe(b);
  });

  it('produit une chaîne hexadécimale de 64 caractères (SHA-256, 32 octets)', async () => {
    const hash = await computeAudioHash(Uint8Array.from([1, 2, 3]));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('computeCacheKey', () => {
  it('est déterministe pour le même (hash, profil)', async () => {
    const a = await computeCacheKey('deadbeef', 'balanced');
    const b = await computeCacheKey('deadbeef', 'balanced');
    expect(a).toBe(b);
  });

  it('un profil différent produit une clé différente (même hash audio)', async () => {
    const a = await computeCacheKey('deadbeef', 'fast');
    const b = await computeCacheKey('deadbeef', 'precise');
    expect(a).not.toBe(b);
  });

  it('un hash audio différent produit une clé différente (même profil)', async () => {
    const a = await computeCacheKey('aaaa', 'balanced');
    const b = await computeCacheKey('bbbb', 'balanced');
    expect(a).not.toBe(b);
  });
});
