/**
 * Persistance de la pochette, du texte et de la palette (chantier 10, lot B).
 *
 * Trois limites signalées trois fois de suite — au chantier 7 pour la pochette,
 * au 8 pour le texte, au 9 pour la palette éditée — et toutes renvoyées à
 * `docs/13_PROJECT_FORMAT.md`. C'est ce lot.
 *
 * LA RÈGLE QUE CES TESTS PROTÈGENT : une valeur absente, inconnue ou illisible
 * remet le réglage à zéro, elle ne fait JAMAIS échouer la restauration. Un
 * projet écrit par une version future doit s'ouvrir, quitte à perdre ce que
 * celle-ci ne comprend pas.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateProject } from '../../src/project/Project';
import { readPvproj, writePvproj } from '../../src/project/pvproj';
import { normaliseTextConfig } from '../../src/visual/text/textConfig';
import { makeProject } from './testSupport/projectFixture';

const thumbnail = new Uint8Array([1, 2, 3, 4]);

describe('le format accepte les trois nouveaux champs', () => {
  it('une palette du CATALOGUE est un simple identifiant', () => {
    // Par identifiant et non par ses huit couleurs : les figer dans chaque
    // projet interdirait au catalogue d'evoluer.
    const p = makeProject({ visual: { presetId: 'trap-dark', presetVersion: 1, overrides: {}, palette: 'ember' } });
    expect(validateProject(p).ok).toBe(true);
  });

  it('une palette ÉDITÉE est un objet de surcharge, éventuellement partiel', () => {
    const p = makeProject({
      visual: { presetId: 'trap-dark', presetVersion: 1, overrides: {}, palette: { accent: '#ff0000' } },
    });
    expect(validateProject(p).ok).toBe(true);
  });

  it('le texte et le nom de pochette sont acceptés', () => {
    const p = makeProject({
      visual: {
        presetId: 'trap-dark',
        presetVersion: 1,
        overrides: {},
        text: { ...normaliseTextConfig({ text: 'PULSAR' }), size: 1.3 },
        coverName: 'album.png',
      },
    });
    expect(validateProject(p).ok).toBe(true);
  });

  it('un projet SANS aucun des trois reste valide', () => {
    // Tous optionnels : les projets enregistres avant ce lot doivent s'ouvrir.
    expect(validateProject(makeProject()).ok).toBe(true);
  });

  it('rejette une forme franchement fausse, pas une valeur inconnue', () => {
    // La FORME est verifiee...
    const mauvaisType = makeProject({
      visual: { presetId: 'x', presetVersion: 1, overrides: {}, palette: 42 as unknown as string },
    });
    expect(validateProject(mauvaisType).ok).toBe(false);
    const texteSansTexte = makeProject({
      visual: { presetId: 'x', presetVersion: 1, overrides: {}, text: { size: 2 } as never },
    });
    expect(validateProject(texteSansTexte).ok).toBe(false);

    // ...mais PAS les valeurs : une animation inconnue de cette version ne doit
    // pas faire perdre tout le reste du fichier.
    const animationFuture = makeProject({
      visual: {
        presetId: 'x',
        presetVersion: 1,
        overrides: {},
        text: { ...normaliseTextConfig({ text: 'A' }), animation: 'kaleidoscope-2029' },
      },
    });
    expect(validateProject(animationFuture).ok).toBe(true);
    // Et c'est `normaliseTextConfig` qui la ramene au defaut a l'application.
    expect(normaliseTextConfig({ text: 'A' }).animation).toBe('word');
  });
});

describe('la pochette voyage dans le `.pvproj`', () => {
  const cover = { filename: 'album.png', data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 42]) };

  it('aller-retour à l\'octet près', () => {
    // Les octets D'ORIGINE, pas un re-encodage : re-comprimer un JPEG a chaque
    // sauvegarde le degraderait a chaque fois.
    const archive = writePvproj({ project: makeProject(), thumbnail, cover });
    const relu = readPvproj(archive);
    expect(relu.cover?.filename).toBe('album.png');
    expect(Array.from(relu.cover!.data)).toEqual(Array.from(cover.data));
  });

  it('l\'extension d\'origine est conservée', () => {
    // Un dossier `cover/` et non un nom fixe : le type MIME se retrouve depuis
    // l'extension, sans avoir a le stocker a cote.
    const jpg = { filename: 'pochette.jpg', data: new Uint8Array([255, 216, 255]) };
    expect(readPvproj(writePvproj({ project: makeProject(), thumbnail, cover: jpg })).cover?.filename).toBe('pochette.jpg');
  });

  it('une archive SANS pochette rend `null`, pas une erreur', () => {
    expect(readPvproj(writePvproj({ project: makeProject(), thumbnail })).cover).toBeNull();
  });

  it('la pochette n\'écrase ni l\'audio ni la vignette', () => {
    const audio = { filename: 'track.mp3', data: new Uint8Array([1, 1, 1]) };
    const relu = readPvproj(writePvproj({ project: makeProject(), thumbnail, audio, cover }));
    expect(relu.audio?.filename).toBe('track.mp3');
    expect(Array.from(relu.thumbnail!)).toEqual(Array.from(thumbnail));
    expect(relu.cover?.filename).toBe('album.png');
  });
});

describe('les trois réglages atteignent la sauvegarde ET la restauration', () => {
  const app = readFileSync(join(process.cwd(), 'src/ui/App.ts'), 'utf-8');

  it('`buildCurrentProject` écrit les trois', () => {
    expect(app, 'la palette du catalogue doit être enregistrée par identifiant').toContain('palette: cataloguePaletteId');
    expect(app).toMatch(/\{ text: \{ \.\.\.textConfig, size: textSize \} \}/);
    expect(app).toContain('coverName: coverSource.name');
  });

  it('`restoreVisualExtras` relit les trois', () => {
    expect(app).toContain('const savedPalette = project.visual.palette');
    expect(app).toContain('const savedText = project.visual.text');
    expect(app, 'la pochette doit être redécodée à la restauration').toContain('const imported = await importCover(named)');
  });

  it('la pochette est enregistrée dans les DEUX contenants', () => {
    // IndexedDB pour la reprise automatique, `.pvproj` pour le partage. En
    // oublier un donnerait un projet qui rouvre avec sa pochette chez soi et
    // sans elle chez le destinataire.
    expect(app, 'IndexedDB').toContain('saveProject(db, project, thumbnail, coverSource?.blob ?? null)');
    expect(app, '.pvproj').toMatch(/writePvprojBlob\(\{ project, thumbnail, cover \}\)/);
    expect(app, 'import .pvproj').toContain('cover: embeddedCover');
  });

  it('les contrôles de texte sont RÉÉCRITS après restauration', () => {
    // Sans ca, le texte reapparaitrait a l'ecran mais les champs afficheraient
    // les valeurs par defaut - et la premiere interaction avec l'un d'eux
    // ecraserait tout le reste par ce qu'affichent les autres.
    expect(app).toContain('function writeTextControls()');
    expect(app).toMatch(/textConfig = normaliseTextConfig\(savedText as Partial<TextConfig> \| undefined\);[\s\S]{0,120}writeTextControls\(\);/);
  });

  it('une pochette illisible ne fait pas échouer l\'ouverture', () => {
    expect(app).toContain('Pochette du projet illisible');
  });
});

describe('aucune montée de `DB_VERSION` (chantier 10 lot B)', () => {
  it('le champ `cover` s\'ajoute sans migration', () => {
    // Un magasin IndexedDB n'a pas de schema de colonnes : `DB_VERSION` ne sert
    // qu'a creer ou supprimer des MAGASINS et des index. Ajouter un champ a un
    // enregistrement est lisible par l'ancienne version comme par la nouvelle.
    const db = readFileSync(join(process.cwd(), 'src/project/storage/db.ts'), 'utf-8');
    expect(db).toContain('export const DB_VERSION = 1;');
    expect(db).toContain('readonly cover?: Blob;');
  });
});
