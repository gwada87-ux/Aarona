import { describe, expect, it } from 'vitest';
import { QualityGovernor, type QualityGovernorResult } from '../../src/perf/QualityGovernor';
import type { QualityLevel } from '../../src/perf/qualityLevels';

const FRAME_INTERVAL_MS = 16.67; // ~60 fps

function makeGovernor(initialLevel: QualityLevel = 'high') {
  let now = 0;
  const governor = new QualityGovernor({ initialLevel, now: () => now });
  const tick = (frameTimeMs: number): QualityGovernorResult => {
    now += FRAME_INTERVAL_MS;
    return governor.recordFrame(frameTimeMs);
  };
  return { governor, tick };
}

describe('QualityGovernor — fenêtre glissante', () => {
  it('ne change rien tant que les 90 images de la fenêtre ne sont pas toutes collectées', () => {
    const { tick } = makeGovernor();
    for (let i = 0; i < 89; i++) {
      expect(tick(50).changed).toBe(false); // 50ms est très au-dessus du seuil, mais fenêtre pas encore pleine
    }
  });
});

describe('QualityGovernor — descente (p95 > 20ms pendant 2s consécutives)', () => {
  it('descend d\'un niveau une fois le seuil tenu 2s d\'affilée', () => {
    const { tick } = makeGovernor('high');
    for (let i = 0; i < 90; i++) tick(25); // remplit la fenêtre, p95=25 > 20

    let result: QualityGovernorResult | undefined;
    let changed = false;
    for (let i = 0; i < 200 && !changed; i++) {
      result = tick(25);
      changed = result.changed;
    }
    expect(changed).toBe(true);
    expect(result!.reason).toBe('degrade');
    expect(result!.level).toBe('medium');
  });

  it('une reprise durable de bonnes performances relance le délai de 2s (continuité au sens du p95, pas d\'une image isolée)', () => {
    // p95 est calculé sur les 90 DERNIÈRES images (docs/10 le préfère à la moyenne justement parce
    // qu'il est robuste aux images isolées) — une seule image rapide au milieu de 89 lentes ne fait
    // PAS repasser p95 sous le seuil. Il faut un flux durable pour que la continuité soit rompue.
    const { tick } = makeGovernor('high');
    for (let i = 0; i < 90; i++) tick(25); // fenêtre pleine, p95=25>20 : le chrono "bad" démarre ici
    for (let i = 0; i < 100; i++) tick(25); // ~1667ms écoulés, pas encore les 2000ms

    // Ne serait-ce que ~1500ms de bonnes performances SUFFISENT à faire repasser p95 sous le seuil
    // (assez d'images rapides remplacent les lentes dans la fenêtre de 90).
    for (let i = 0; i < 90; i++) tick(5);

    // Reprend des images lentes : si le chrono n'avait PAS été remis à zéro pendant la phase rapide,
    // le total accumulé (bien plus de 2000ms au total) déclencherait une descente dès la 1re image.
    // S'il a bien été remis à zéro, quelques images plus tard (~500ms) ne suffisent pas.
    let changedWithin500ms = false;
    for (let i = 0; i < 30; i++) {
      if (tick(25).changed) changedWithin500ms = true;
    }
    expect(changedWithin500ms).toBe(false);
  });

  it('ne descend jamais sous "low" (déjà au plancher)', () => {
    const { tick } = makeGovernor('low');
    for (let i = 0; i < 90; i++) tick(25);
    for (let i = 0; i < 200; i++) {
      const result = tick(25);
      expect(result.changed).toBe(false);
      expect(result.level).toBe('low');
    }
  });
});

describe('QualityGovernor — remontée (p95 < 12ms pendant 8s consécutives)', () => {
  it('remonte d\'un niveau une fois le seuil tenu 8s d\'affilée', () => {
    const { tick } = makeGovernor('medium');
    for (let i = 0; i < 90; i++) tick(5); // p95=5 < 12

    let result: QualityGovernorResult | undefined;
    let changed = false;
    for (let i = 0; i < 600 && !changed; i++) {
      result = tick(5);
      changed = result.changed;
    }
    expect(changed).toBe(true);
    expect(result!.reason).toBe('upgrade');
    expect(result!.level).toBe('high');
  });

  it('ne remonte jamais au-dessus du plafond choisi manuellement, même avec d\'excellentes performances indéfiniment', () => {
    const { governor, tick } = makeGovernor('high');
    governor.setManualLevel('medium'); // plafond manuel = medium
    for (let i = 0; i < 90; i++) tick(2);

    for (let i = 0; i < 1000; i++) {
      const result = tick(2);
      expect(result.level === 'medium' || result.level === 'low').toBe(true);
    }
  });

  it('la remontée automatique est bridée à une fois par minute', () => {
    // Aucun `setManualLevel` : le plafond par défaut ("ultra") laisse la place à plusieurs remontées.
    const { tick } = makeGovernor('low');
    for (let i = 0; i < 90; i++) tick(2);

    let firstChange: QualityGovernorResult | undefined;
    for (let i = 0; i < 600 && !firstChange; i++) {
      const r = tick(2);
      if (r.changed) firstChange = r;
    }
    expect(firstChange?.reason).toBe('upgrade');
    expect(firstChange?.level).toBe('medium');

    // Encore 8s de bonnes performances immédiatement après — devrait qualifier pour remonter à
    // nouveau (medium -> high) au niveau du seuil de maintien, mais le cooldown de 60s l'empêche.
    let secondChangeWithinCooldown = false;
    for (let i = 0; i < 500; i++) {
      // ~500 * 16.67ms ≈ 8.3s, largement sous le cooldown de 60s depuis la première remontée.
      if (tick(2).changed) secondChangeWithinCooldown = true;
    }
    expect(secondChangeWithinCooldown).toBe(false);
  });
});

describe('QualityGovernor — zone neutre (12ms <= p95 <= 20ms)', () => {
  it('ne déclenche ni descente ni remontée indéfiniment dans la zone neutre', () => {
    const { tick } = makeGovernor('medium');
    for (let i = 0; i < 90; i++) tick(15); // dans [12, 20]
    for (let i = 0; i < 300; i++) {
      const result = tick(15);
      expect(result.changed).toBe(false);
      expect(result.level).toBe('medium');
    }
  });
});

describe('QualityGovernor — setManualLevel', () => {
  it('devient le niveau courant ET le nouveau plafond de remontée', () => {
    const { governor } = makeGovernor('high');
    governor.setManualLevel('low');
    expect(governor.currentLevel).toBe('low');
  });

  it('réinitialise l\'historique (une série de mauvaises performances avant le changement ne compte plus après)', () => {
    const { governor, tick } = makeGovernor('high');
    for (let i = 0; i < 90; i++) tick(25);
    for (let i = 0; i < 100; i++) tick(25); // approche de la descente automatique

    governor.setManualLevel('high'); // reste "high", mais purge l'historique
    for (let i = 0; i < 90; i++) {
      expect(tick(25).changed).toBe(false); // il faut reconstituer toute la fenêtre avant de rejuger
    }
  });
});

describe('QualityGovernor — resetAuto', () => {
  it('lève un plafond manuel posé précédemment (remontée à nouveau libre jusqu\'à "ultra")', () => {
    const { governor, tick } = makeGovernor('high');
    governor.setManualLevel('low'); // plafond = low : ne remonterait jamais au-delà sans resetAuto
    governor.resetAuto('medium');
    expect(governor.currentLevel).toBe('medium');

    for (let i = 0; i < 90; i++) tick(2); // p95=2 < 12 : remplit la fenêtre

    let changed = false;
    for (let i = 0; i < 600 && !changed; i++) {
      if (tick(2).changed) changed = true;
    }
    // Si le plafond "low" n'avait pas été levé, le niveau n'aurait jamais dépassé "low".
    expect(governor.currentLevel === 'high' || governor.currentLevel === 'ultra').toBe(true);
  });
});
