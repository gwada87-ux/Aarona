import { clamp } from '../math/clamp';

/** Correction bornée par appel — convergence douce, aucun saut visible. */
const MAX_CORRECTION_SECONDS = 0.002;

/** Au-delà, un seek externe est présumé : on resynchronise directement. */
export const HARD_RESYNC_THRESHOLD_SECONDS = 0.12;

export interface DriftCorrectionResult {
  readonly t: number;
  readonly resynced: boolean;
}

/**
 * docs/03_DATA_FLOW.md §Détail : la correction de dérive.
 * `tPredicted` avance en douceur (+dt, calculé par l'appelant) ; `tMeasured`
 * vient de l'horloge audio, par paliers. L'écart est rattrapé à 2 ms par
 * appel maximum, sauf au-delà du seuil de resync dur.
 */
export function correctDrift(tPredicted: number, tMeasured: number): DriftCorrectionResult {
  const error = tMeasured - tPredicted;
  if (Math.abs(error) > HARD_RESYNC_THRESHOLD_SECONDS) {
    return { t: tMeasured, resynced: true };
  }
  return {
    t: tPredicted + clamp(error, -MAX_CORRECTION_SECONDS, MAX_CORRECTION_SECONDS),
    resynced: false,
  };
}

/**
 * REANCRAGE DE L'HORLOGE VISUELLE SUR L'HORLOGE AUDIO (14/08/2026).
 *
 * LE DEFAUT, REPRODUIT ET MESURE
 * ------------------------------
 * `correctDrift` ci-dessus protege `AudioEngine.t`. Rien ne protegeait `simT`,
 * la position de l'IMAGE : la boucle d'apercu ne l'avance que par DELTAS
 * (`audioAdvance = max(0, audioEngine.t - lastAudioT)`, plafonne a 0,25 s) et
 * ne la compare JAMAIS a la position audio absolue. Toute avance perdue l'est
 * donc pour toujours, et deux chemins la perdent :
 *
 * 1. un saut EN ARRIERE de l'horloge audio donne `max(0, negatif) = 0` :
 *    l'image garde son avance ;
 * 2. une image qui met plus de 250 ms (saccade, onglet en arriere-plan, autre
 *    application) voit son avance ECRETEE a 0,25 s, et l'exces est jete.
 *
 * Mesure au navigateur, demo en lecture, curseur de recalage manoeuvre de
 * +200 ms a -200 ms (donc un saut de 400 ms de l'horloge audio) :
 *
 * ```
 * reglage 0 ms                    ecart image/son  -25,2 ms
 * reglage +200 ms                                  -29,3 ms
 * reglage -200 ms                                 -426,3 ms
 * remise a 0, 1,5 s plus tard                     -423,7 ms   <- jamais rattrape
 * ```
 *
 * Un temps dure 441 ms a 136 BPM : l'image se retrouve decalee d'un temps
 * ENTIER, definitivement, et rien dans le moteur ne le corrige. Seul un saut
 * manuel dans la frise remettait les compteurs a zero — ce qui explique un
 * symptome longtemps insaisissable : « c'etait synchro, et ensuite non ».
 *
 * LE MEME SEUIL QUE `correctDrift`, DELIBEREMENT
 * ----------------------------------------------
 * `HARD_RESYNC_THRESHOLD_SECONDS` (0,12 s) sert deja a decider « ce n'est plus
 * une derive, c'est un saut ». La question posee ici est exactement la meme, un
 * etage plus haut. Un second seuil aurait pu deriver de celui-la sans que rien
 * ne le signale.
 *
 * POURQUOI ON NE REINITIALISE PAS LA SCENE
 * ----------------------------------------
 * Un `scene.reset()` viderait les pools de particules et la trainee : un
 * clignotement noir, bien plus visible que le decalage qu'on corrige. Les
 * couches se remettent d'un saut de 120 ms en quelques images, et
 * `EventDispatcher` gere deja les deux sens (fenetre `MAX_WINDOW` vers l'avant,
 * aucun rejeu vers l'arriere).
 */
export interface VisualResyncResult {
  /** Position visuelle a adopter. Inchangee quand aucun reancrage n'est necessaire. */
  readonly t: number;
  readonly resynced: boolean;
}

export function resyncVisualClock(simT: number, audioT: number, duration: number): VisualResyncResult {
  if (Math.abs(audioT - simT) <= HARD_RESYNC_THRESHOLD_SECONDS) return { t: simT, resynced: false };
  return { t: clamp(audioT, 0, duration), resynced: true };
}

/**
 * RATTRAPAGE DOUX DE L'HORLOGE VISUELLE (14/08/2026, second defaut).
 *
 * CE QUE `resyncVisualClock` SEUL LAISSAIT PASSER
 * ----------------------------------------------
 * Le reancrage dur ne se declenche qu'au-dela de
 * `HARD_RESYNC_THRESHOLD_SECONDS` (0,12 s). Un ecart INFERIEUR n'etait donc
 * corrige par personne, et rien ne le faisait diminuer : il restait la pour
 * toute la lecture.
 *
 * Mesure sur le beat d'Aaron, panneau debug :
 *
 * ```
 * beat quelconque       sync   +1,2 ms  ok        3 reancrages
 * beat de Beat Studio   sync -114,0 ms  ATTENTION 0 reancrage
 * ```
 *
 * **114 ms a 136 BPM, c'est un QUART DE TEMPS**, et le compteur de reancrages
 * reste a zero : l'ecart passe juste sous le seuil et s'y installe. C'est le
 * defaut que decrit Aaron depuis le debut sur ce morceau precis.
 *
 * L'erreur d'origine est identifiee : j'avais reutilise pour la CORRECTION un
 * seuil dont le role est la DETECTION D'UN SAUT. Un saut de 100 ms n'est pas un
 * saut ; un decalage permanent de 100 ms, si.
 *
 * LA CORRECTION, CALQUEE SUR `correctDrift`
 * -----------------------------------------
 * Meme mecanique que l'etage du dessous, et meme constante : au plus 2 ms par
 * image. A 60 images par seconde cela represente 120 ms de rattrapage par
 * seconde — l'ecart de 114 ms d'Aaron disparait en une seconde, sans le moindre
 * saut visible, et l'ecart residuel converge vers zero au lieu de stationner
 * n'importe ou sous le seuil.
 *
 * Deux etages plutot qu'un seuil abaisse : abaisser le seuil dur ferait sauter
 * l'image a chaque petite fluctuation, alors que le rattrapage doux la ramene
 * sans que rien ne se voie. C'est exactement le partage que `correctDrift`
 * pratique deja pour l'horloge audio.
 */
export function visualNudge(simT: number, audioT: number): number {
  const error = audioT - simT;
  if (Math.abs(error) > HARD_RESYNC_THRESHOLD_SECONDS) return 0; // au-dela, c'est un reancrage dur
  return clamp(error, -MAX_CORRECTION_SECONDS, MAX_CORRECTION_SECONDS);
}
