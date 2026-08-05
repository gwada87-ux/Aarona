/**
 * Hash audio et clé de cache d'analyse — project/cacheKey
 * (docs/13_PROJECT_FORMAT.md §"L'analyse n'est pas stockée dans le fichier") :
 *
 *   cacheKey = sha256( hash_audio + version_moteur_analyse + profil )
 *
 * `Web Crypto` (`crypto.subtle`), pas un hash maison : c'est littéralement
 * l'algorithme nommé par docs/13 ("sha256"), disponible nativement en
 * navigateur ET en Node ≥ 20 (donc testable sans mock) — aucune raison d'en
 * réimplémenter un.
 */

/**
 * À incrémenter si l'algorithme d'analyse change d'une façon qui invaliderait
 * un cache existant (nouvelle version d'un détecteur, changement de
 * résolution STFT, etc.) — fait partie intégrante de la clé pour que le
 * cache ne serve jamais un résultat obtenu avec un moteur différent.
 */
export const ANALYSIS_ENGINE_VERSION = '1';

async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Hash de contenu de l'audio décodé — identifie le fichier indépendamment de son nom (docs/13 §"Fichier .pvproj"). */
export async function computeAudioHash(data: BufferSource): Promise<string> {
  return sha256Hex(data);
}

export async function computeCacheKey(audioHash: string, profile: string): Promise<string> {
  const combined = new TextEncoder().encode(`${audioHash}:${ANALYSIS_ENGINE_VERSION}:${profile}`);
  return sha256Hex(combined);
}
