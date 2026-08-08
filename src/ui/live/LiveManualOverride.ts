/**
 * Bascule automatique/manuel du mode direct (chantier « panneau
 * Style/Preset/Palette/Texte/Macros réellement fonctionnel en direct »).
 *
 * Décidé avec Aaron : le système à 6 scènes (`LiveDirector`/`LivePipeline`)
 * reste le comportement par défaut, inchangé, tant que le panneau n'est pas
 * touché. Dès qu'un contrôle change pendant le direct (Style/Preset/Palette/
 * Texte/macro), `activate()` bascule sur le vrai moteur fichier, jusqu'à
 * `deactivate()` (bouton « Revenir à l'automatique »). Aucune régression sur
 * le comportement actuel si rien n'est touché.
 */
export class LiveManualOverride {
  private _active = false;

  get active(): boolean {
    return this._active;
  }

  activate(): void {
    this._active = true;
  }

  deactivate(): void {
    this._active = false;
  }
}
