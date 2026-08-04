import { describe, expect, it } from 'vitest';
import { FixedStep, FIXED_DT } from '../../src/core/time/FixedStep';

describe('FixedStep — pas fixe 1/120s avec reliquat reporté (Loi 1)', () => {
  it('reporte le reliquat au lieu de le perdre ou de le simuler', () => {
    const fs = new FixedStep();
    const steps1 = fs.advance(FIXED_DT * 1.5);
    expect(steps1).toBe(1);
    const steps2 = fs.advance(FIXED_DT * 0.5);
    expect(steps2).toBe(1);
  });

  it('le nombre total de pas sur une durée donnée ne dépend pas du découpage en dt (60 fps vs 30 fps)', () => {
    const totalSeconds = 2;
    const frame60 = 1 / 60;
    const frame30 = 1 / 30;
    const n60 = Math.round(totalSeconds / frame60);
    const n30 = Math.round(totalSeconds / frame30);

    const fs60 = new FixedStep();
    let steps60 = 0;
    for (let i = 0; i < n60; i++) steps60 += fs60.advance(frame60);

    const fs30 = new FixedStep();
    let steps30 = 0;
    for (let i = 0; i < n30; i++) steps30 += fs30.advance(frame30);

    expect(steps60).toBe(steps30);
  });

  it('reset() vide l’accumulateur', () => {
    const fs = new FixedStep();
    fs.advance(FIXED_DT * 0.5);
    fs.reset();
    expect(fs.advance(FIXED_DT * 0.5)).toBe(0);
    expect(fs.advance(FIXED_DT * 0.5)).toBe(1);
  });
});
