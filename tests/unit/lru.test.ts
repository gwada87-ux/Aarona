import { describe, expect, it } from 'vitest';
import { selectEvictions, type CacheEntry } from '../../src/project/lru';

describe('selectEvictions', () => {
  it('ne renvoie rien si la taille totale est déjà sous la limite', () => {
    const entries: CacheEntry[] = [
      { key: 'a', size: 100, lastAccessed: 1 },
      { key: 'b', size: 100, lastAccessed: 2 },
    ];
    expect(selectEvictions(entries, 500)).toEqual([]);
  });

  it('évince les entrées les plus anciennes en premier (LRU)', () => {
    const entries: CacheEntry[] = [
      { key: 'récent', size: 100, lastAccessed: 300 },
      { key: 'ancien', size: 100, lastAccessed: 100 },
      { key: 'moyen', size: 100, lastAccessed: 200 },
    ];
    // total 300, limite 150 -> il faut libérer 150 -> évincer "ancien" (100) ne suffit pas seul,
    // puis "moyen" (100) -> reste 100 <= 150, s'arrête là.
    expect(selectEvictions(entries, 150)).toEqual(['ancien', 'moyen']);
  });

  it('n\'évince que le strict nécessaire pour repasser sous la limite', () => {
    const entries: CacheEntry[] = [
      { key: 'a', size: 50, lastAccessed: 1 },
      { key: 'b', size: 50, lastAccessed: 2 },
      { key: 'c', size: 50, lastAccessed: 3 },
    ];
    // total 150, limite 120 -> évincer "a" (50) suffit : reste 100 <= 120.
    expect(selectEvictions(entries, 120)).toEqual(['a']);
  });

  it('évince tout si nécessaire (limite à zéro)', () => {
    const entries: CacheEntry[] = [
      { key: 'a', size: 10, lastAccessed: 1 },
      { key: 'b', size: 10, lastAccessed: 2 },
    ];
    expect(selectEvictions(entries, 0)).toEqual(['a', 'b']);
  });

  it('tableau vide -> aucune éviction', () => {
    expect(selectEvictions([], 1000)).toEqual([]);
  });
});
