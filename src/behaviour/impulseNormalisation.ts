/**
 * NORMALISATION DES FRAPPES PAR MORCEAU (14/08/2026).
 *
 * LE DEFAUT, SIGNALE PAR AARON ET MESURE
 * --------------------------------------
 * « J'ai mis un beat que j'avais fait dans Beat Studio et le kick n'est pas
 * tellement visible, comparé a un autre kick d'un beat qui ne venait pas de
 * Beat Studio. »
 *
 * Mesure, meme motif a 136 BPM, seule l'intensite des KICK change :
 *
 * | intensite | secousse d'ecran (seuil 0,7) | gonflement du halo |
 * |-----------|------------------------------|--------------------|
 * | 0,51 (Beat Studio) | **JAMAIS DECLENCHEE**  | +15,3 %            |
 * | 0,75 (demo)        | 3,8 % des pas          | +22,5 %            |
 * | 0,95 (tres dynamique) | 13,2 % des pas      | +28,5 %            |
 *
 * Un export de Beat Studio est COMPRESSE et LIMITE : ses kicks sortent a 0,51
 * la ou un morceau dynamique tape a 0,95. Or tout le moteur visuel reagit a
 * `event.intensity` sur une echelle ABSOLUE 0..1, et `ScreenShake` a en plus
 * un seuil fixe a 0,7 que ces beats n'atteignent jamais. Le visuel PUNIT donc
 * un morceau bien mixe — exactement l'inverse de ce qu'on veut.
 *
 * CE QUE CE MODULE FAIT
 * ---------------------
 * Il calcule, UNE FOIS par morceau et par signal d'impulsion, un facteur qui
 * ramene les frappes de ce morceau a une echelle utile. Un kick est fort par
 * rapport aux AUTRES KICKS du morceau, pas par rapport a un maximum theorique
 * que personne n'atteint.
 *
 * IL NE PEUT QUE MONTER, JAMAIS BAISSER
 * -------------------------------------
 * `NORMALISE_MIN = 1`. Un morceau deja dynamique — dont le 90e centile
 * atteint la cible — obtient un facteur de 1 exactement, donc une sortie
 * IDENTIQUE a celle d'avant ce module. C'est la propriete qui rend ce chantier
 * sur : il ne peut rien degrader de ce qui marchait, il ne fait que relever ce
 * qui etait ecrase.
 *
 * LE 90e CENTILE, PAS LE MAXIMUM
 * ------------------------------
 * Une seule frappe aberrante — un artefact d'analyse, un accent isole — ne
 * doit pas fixer l'echelle du morceau entier. Le 90e centile represente « les
 * frappes fortes de ce morceau » sans se laisser dicter par une valeur unique.
 *
 * LE PLAFOND
 * ----------
 * `NORMALISE_MAX = 2.2` : un morceau dont les frappes fortes sont a 0,42 est
 * releve jusqu'a la cible, pas au-dela. Sans plafond, un morceau sans aucune
 * percussion nette verrait son bruit de fond amplifie jusqu'a devenir un beat
 * imaginaire.
 *
 * DETERMINISME (Loi 1)
 * --------------------
 * Fonction PURE de la timeline, calculee une fois a la construction du
 * `BehaviourEngine`. Aucune adaptation en cours de lecture : une normalisation
 * qui suivrait le morceau ferait qu'un meme instant rendrait deux images
 * differentes selon le chemin parcouru pour y arriver.
 */
import type { MusicTimeline } from '../music/MusicTimeline';
import type { EventType } from '../music/pmdi';

/**
 * Drapeau du chantier. A `false`, `normalisationFor` rend toujours 1 et le
 * moteur se comporte exactement comme avant.
 */
export const IMPULSE_NORMALISE_V1 = true;

/** Jamais d'attenuation : voir « IL NE PEUT QUE MONTER ». */
export const NORMALISE_MIN = 1;
export const NORMALISE_MAX = 2.2;

/**
 * Valeur visee pour le 90e centile des frappes. Legerement sous 1 : viser 1
 * exactement ferait saturer une frappe sur dix, et `Impulse.fire` ne borne
 * pas — les couches recevraient des valeurs superieures a 1, hors du contrat
 * annonce par `VisualSignals`.
 */
export const NORMALISE_TARGET = 0.92;

/** Centile utilise. Voir « LE 90e CENTILE, PAS LE MAXIMUM ». */
const PERCENTILE = 0.9;

/** En dessous, l'echantillon est trop maigre pour qu'un centile veuille dire quoi que ce soit. */
const MIN_SAMPLE = 4;

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Facteur de normalisation pour un signal d'impulsion, d'apres les evenements
 * de `types` presents dans `timeline`.
 *
 * Rend exactement 1 — donc aucun changement — quand le drapeau est eteint,
 * quand le morceau ne porte pas assez de frappes de ces types, ou quand elles
 * sont deja assez fortes.
 */
export function normalisationFor(timeline: MusicTimeline, types: readonly EventType[]): number {
  if (!IMPULSE_NORMALISE_V1 || types.length === 0) return 1;

  const intensites: number[] = [];
  for (const type of types) {
    for (const e of timeline.eventsOfTypeBetween(type, -1, timeline.duration)) {
      if (Number.isFinite(e.intensity) && e.intensity > 0) intensites.push(e.intensity);
    }
  }
  if (intensites.length < MIN_SAMPLE) return 1;

  intensites.sort((a, b) => a - b);
  // Index du centile, borne au dernier element : sur un echantillon de 4, un
  // arrondi superieur sortirait du tableau.
  const idx = Math.min(intensites.length - 1, Math.floor(intensites.length * PERCENTILE));
  const p90 = intensites[idx]!;
  if (!(p90 > 0)) return 1;

  return clamp(NORMALISE_TARGET / p90, NORMALISE_MIN, NORMALISE_MAX);
}
