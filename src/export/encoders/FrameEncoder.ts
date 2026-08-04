/**
 * Interface commune aux deux chemins d'encodage (docs/09_EXPORT.md, ADR-005) :
 * `MediabunnyEncoder` (WebCodecs, déterministe, principal) et
 * `MediaRecorderFallback` (temps réel, repli dégradé). Volontairement AU
 * NIVEAU DE L'EXPORT ENTIER, pas par image : `MediaRecorder` ne peut pas
 * recevoir « encode cette image à cet instant » comme `CanvasSource.add()`
 * le permet — il capture ce qui est dessiné à son propre rythme
 * (`captureStream`). Forcer les deux chemins derrière une interface
 * par-image aurait été artificiel pour le repli ; voir docs/JOURNAL.md,
 * Étape 10.
 */
export interface FrameEncoder {
  /** Prépare l'encodeur (tracks, démarrage du conteneur). */
  start(): Promise<void>;

  /**
   * Ajoute l'image actuellement dessinée sur le canvas lié à l'encodeur.
   * Respecte la contre-pression en interne (attend que l'encodeur soit prêt
   * à recevoir la suite) — voir MediabunnyEncoder.ts.
   */
  addVideoFrame(timestampSec: number, durationSec: number): Promise<void>;

  /** Ajoute la piste audio complète. Appelé une seule fois. */
  addAudio(buffer: AudioBuffer): Promise<void>;

  /** Finalise le conteneur et retourne le fichier vidéo. */
  finish(): Promise<Blob>;

  /** Annule proprement : libère les ressources internes (encodeurs, etc.), aucune fuite. */
  cancel(): Promise<void>;
}
