import { describe, expect, it } from 'vitest';
import { migrate } from '../../src/project/migrate';
import { ProjectError, CURRENT_PROJECT_VERSION } from '../../src/project/Project';
import { makeProject } from './testSupport/projectFixture';

describe('migrate', () => {
  it('accepte un projet déjà à la version courante, inchangé', () => {
    const project = makeProject();
    const migrated = migrate(project);
    expect(migrated.version).toBe(CURRENT_PROJECT_VERSION);
    expect(migrated.meta.id).toBe(project.meta.id);
  });

  it('refuse un format différent de "pvproj" (FORMAT_UNKNOWN)', () => {
    expect(() => migrate({ ...makeProject(), format: 'autre-chose' })).toThrow(ProjectError);
    try {
      migrate({ ...makeProject(), format: 'autre-chose' });
    } catch (err) {
      expect((err as ProjectError).code).toBe('FORMAT_UNKNOWN');
    }
  });

  it('refuse explicitement une version plus récente que celle supportée (VERSION_TOO_RECENT), jamais une lecture partielle', () => {
    const fromTheFuture = { ...makeProject(), version: CURRENT_PROJECT_VERSION + 1 };
    expect(() => migrate(fromTheFuture)).toThrow(ProjectError);
    try {
      migrate(fromTheFuture);
    } catch (err) {
      expect((err as ProjectError).code).toBe('VERSION_TOO_RECENT');
    }
  });

  it('rejette une valeur qui n\'est pas un objet', () => {
    expect(() => migrate(null)).toThrow(ProjectError);
    expect(() => migrate('pvproj')).toThrow(ProjectError);
  });

  it('rejette un projet de forme invalide après (tentative de) migration (INVALID_SHAPE)', () => {
    const broken = { ...makeProject(), meta: undefined };
    expect(() => migrate(broken)).toThrow(ProjectError);
    try {
      migrate(broken);
    } catch (err) {
      expect((err as ProjectError).code).toBe('INVALID_SHAPE');
    }
  });

  it('préserve un champ ext inconnu tel quel (aucune perte de données)', () => {
    const project = makeProject({ ext: { customField: 42 } });
    const migrated = migrate(project);
    expect(migrated.ext).toEqual({ customField: 42 });
  });
});
