/**
 * Sélection d'éviction LRU — project/lru (docs/13_PROJECT_FORMAT.md
 * §"Persistance IndexedDB" : "Les caches sont purgés en LRU quand le quota
 * approche"). Logique PURE, isolée du magasin IndexedDB lui-même
 * (`storage/db.ts`, non testable en environnement Node) — ainsi la décision
 * "quoi évincer" reste vérifiable sans navigateur.
 */

export interface CacheEntry {
  readonly key: string;
  readonly size: number;
  /** Horodatage du dernier accès (epoch ms) — plus petit = plus ancien = évincé en premier. */
  readonly lastAccessed: number;
}

/**
 * Retourne les clés à évincer, de la plus ancienne à la plus récente, pour
 * repasser la taille totale sous `limitBytes`. Vide si déjà sous la limite —
 * ne réserve jamais de marge supplémentaire, juste assez pour repasser sous
 * le plafond.
 */
export function selectEvictions(entries: readonly CacheEntry[], limitBytes: number): readonly string[] {
  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
  if (totalSize <= limitBytes) return [];

  const oldestFirst = [...entries].sort((a, b) => a.lastAccessed - b.lastAccessed);
  const evicted: string[] = [];
  let remaining = totalSize;
  for (const entry of oldestFirst) {
    if (remaining <= limitBytes) break;
    evicted.push(entry.key);
    remaining -= entry.size;
  }
  return evicted;
}
