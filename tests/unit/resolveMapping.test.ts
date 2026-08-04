import { describe, expect, it } from 'vitest';
import { resolve } from '../../src/behaviour/mapping/resolve';
import { defaultMapping } from '../../src/behaviour/mapping/defaults';
import { Impulse } from '../../src/behaviour/signals/Impulse';
import { Continuous } from '../../src/behaviour/signals/Continuous';
import { Anticipation } from '../../src/behaviour/signals/Anticipation';
import type { MappingSchema } from '../../src/behaviour/mapping/MappingSchema';

describe('resolve — table de câblage par défaut', () => {
  it('classe chaque entrée dans la bonne famille par la forme de `from`, pas par un discriminant', () => {
    const resolved = resolve(defaultMapping);
    expect([...resolved.impulses.keys()].sort()).toEqual(
      ['accent', 'impact', 'sectionShift', 'subImpact', 'tick'].sort(),
    );
    expect([...resolved.continuous.keys()].sort()).toEqual(['brightness', 'drive', 'weight'].sort());
    expect([...resolved.anticipations.keys()]).toEqual(['tension']);
  });

  it('instancie la bonne classe de primitive par famille', () => {
    const resolved = resolve(defaultMapping);
    expect(resolved.impulses.get('impact')?.primitive).toBeInstanceOf(Impulse);
    expect(resolved.continuous.get('drive')?.primitive).toBeInstanceOf(Continuous);
    expect(resolved.anticipations.get('tension')?.primitive).toBeInstanceOf(Anticipation);
  });

  it('un preset peut recâbler un signal sans toucher au code (ex. impact nourri par SNARE)', () => {
    const rbPreset: MappingSchema = {
      ...defaultMapping,
      impact: { from: ['SNARE'], gain: 1.0, decay: 0.12 },
    };
    const resolved = resolve(rbPreset);
    expect(resolved.impulses.get('impact')?.from).toEqual(['SNARE']);
  });

  it('extrait le featureId sans le préfixe "feature:" et le type sans "anticipate:"', () => {
    const resolved = resolve(defaultMapping);
    expect(resolved.continuous.get('drive')?.featureId).toBe('energy');
    expect(resolved.continuous.get('weight')?.featureId).toBe('band.sub');
    expect(resolved.anticipations.get('tension')?.eventType).toBe('DROP');
  });
});
