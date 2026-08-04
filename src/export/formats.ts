/**
 * Formats de sortie — copie fidèle du tableau de docs/09_EXPORT.md
 * §"Formats de sortie". Données pures : « le changement de format ne demande
 * aucune adaptation du style » (composition en unités normalisées, Loi 4).
 */
export interface ExportFormat {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export const FORMATS: readonly ExportFormat[] = Object.freeze([
  { id: 'youtube', label: 'YouTube (1920×1080, 16:9)', width: 1920, height: 1080 },
  { id: 'vertical', label: 'Shorts / TikTok / Reels (1080×1920, 9:16)', width: 1080, height: 1920 },
  { id: 'square', label: 'Post carré (1080×1080, 1:1)', width: 1080, height: 1080 },
  { id: 'free', label: 'Gratuit (1280×720, 16:9, watermark)', width: 1280, height: 720 },
  { id: 'preview', label: 'Aperçu rapide (854×480, 16:9)', width: 854, height: 480 },
]);

/**
 * `Fps` restreint à 30|60 : `ExportPipeline` en dérive le nombre de sous-pas
 * de simulation par image (`120 / fps`), qui doit être un entier exact —
 * voir ExportPipeline.ts.
 */
export type Fps = 30 | 60;
export const SUPPORTED_FPS: readonly Fps[] = Object.freeze([30, 60]);

/** Paliers de débit de docs/09 (8/12/20 Mb/s), en bits/seconde pour l'API Mediabunny. */
export const BITRATE_BPS = Object.freeze({
  low: 8_000_000,
  medium: 12_000_000,
  high: 20_000_000,
});
export type BitrateTier = keyof typeof BITRATE_BPS;

/** Débit audio AAC fixe — non tabulé par docs/09, choix standard pour de la musique. */
export const AUDIO_BITRATE_BPS = 192_000;

export function findFormat(id: string): ExportFormat | undefined {
  return FORMATS.find((f) => f.id === id);
}
