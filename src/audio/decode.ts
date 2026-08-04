/** docs/00b_MASTER_PROMPT_V2.md §4 — import jusqu'à 12 min, refus au-delà. */
export const MAX_DURATION_SECONDS = 12 * 60;
/** docs/03_DATA_FLOW.md FLUX 1 — refus si taille > 150 Mo. */
export const MAX_FILE_SIZE_BYTES = 150 * 1024 * 1024;

export class AudioValidationError extends Error {}

export interface DecodedAudio {
  readonly buffer: AudioBuffer;
  /** Octets d'origine, jamais détachés — nécessaires au remux et au hash (docs/03 §octets compressés). */
  readonly originalBytes: ArrayBuffer;
}

/**
 * `decodeAudioData` détache l'ArrayBuffer qu'on lui passe (piège #3) : on
 * lui donne une copie et on conserve l'original. La durée n'est connue
 * qu'après décodage ; la taille est vérifiée avant, pour éviter de décoder
 * un fichier déjà refusable.
 */
export async function decodeAudioFile(file: File, ctx: AudioContext): Promise<DecodedAudio> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new AudioValidationError(
      `Fichier trop volumineux : ${(file.size / (1024 * 1024)).toFixed(1)} Mo (max 150 Mo).`,
    );
  }

  const originalBytes = await file.arrayBuffer();
  const forDecode = originalBytes.slice(0); // NE PAS SUPPRIMER CE slice — voir docs/03_DATA_FLOW.md
  const buffer = await ctx.decodeAudioData(forDecode);

  if (buffer.duration > MAX_DURATION_SECONDS) {
    throw new AudioValidationError(
      `Morceau trop long : ${(buffer.duration / 60).toFixed(1)} min (max 12 min).`,
    );
  }

  return { buffer, originalBytes };
}
