import { canEncodeAudio, canEncodeVideo } from 'mediabunny';

export type ExportPath = 'webcodecs' | 'media-recorder';

/**
 * docs/09_EXPORT.md §"Repli MediaRecorder" : teste la vidéo ET l'audio
 * séparément — `canEncodeVideo`/`canEncodeAudio` (Mediabunny) enveloppent
 * `VideoEncoder.isConfigSupported`/`AudioEncoder.isConfigSupported`.
 *
 * Simplification documentée par rapport à docs/09 : le document prévoit un
 * repli PARTIEL pour Firefox 130+ (vidéo WebCodecs + audio remuxé sans
 * réencodage depuis les octets source) — non implémenté ici, faute de
 * capacité de remux dans ce lot (`ExportPipeline` réencode toujours l'audio
 * via `AudioBufferSource`, voir docs/JOURNAL.md Étape 10). Un navigateur
 * avec vidéo supportée mais pas l'audio AAC bascule donc sur le repli
 * `MediaRecorder` complet, pas le chemin partiel optimal.
 */
export async function detectExportPath(width: number, height: number, bitrateBps: number): Promise<ExportPath> {
  const [videoOk, audioOk] = await Promise.all([
    canEncodeVideo('avc', { width, height, bitrate: bitrateBps }),
    canEncodeAudio('aac'),
  ]);
  return videoOk && audioOk ? 'webcodecs' : 'media-recorder';
}
