import { describe, expect, it } from 'vitest';
import { FlashRateGate, NORMAL_MODE, REDUCED_FLASHING_MODE } from '../../src/visual/safety/FlashLimiter';

describe('FlashRateGate — sous le seuil de delta', () => {
  it('laisse passer une variation de luminance faible, sans compter de transition', () => {
    const gate = new FlashRateGate(NORMAL_MODE); // deltaThreshold = 0.45
    expect(gate.evaluate(0, 0.5, 0.3)).toBeCloseTo(0.5, 10); // delta = 0.2 < 0.45
  });
});

describe('FlashRateGate — au-delà du seuil, sous la limite de fréquence', () => {
  it('autorise jusqu\'à maxTransitionsPerSecond transitions dans la même seconde musicale', () => {
    const gate = new FlashRateGate(NORMAL_MODE); // max 3/s
    expect(gate.evaluate(0.0, 1.0, 0.0)).toBe(1.0); // 1ère, autorisée
    expect(gate.evaluate(0.1, 0.0, 1.0)).toBe(0.0); // 2e, autorisée
    expect(gate.evaluate(0.2, 1.0, 0.0)).toBe(1.0); // 3e, autorisée
  });
});

describe('FlashRateGate — au-delà de la limite de fréquence', () => {
  it('clampe (interpole vers la valeur précédente) la transition en trop', () => {
    const gate = new FlashRateGate(NORMAL_MODE); // max 3/s
    gate.evaluate(0.0, 1.0, 0.0);
    gate.evaluate(0.1, 0.0, 1.0);
    gate.evaluate(0.2, 1.0, 0.0);
    const clamped = gate.evaluate(0.3, 0.0, 1.0); // 4e dans la même seconde
    expect(clamped).toBe(1.0); // reste à la valeur précédente, pas 0.0
  });

  it('la fenêtre glisse en TEMPS MUSICAL, pas en nombre d\'appels', () => {
    const gate = new FlashRateGate(NORMAL_MODE);
    gate.evaluate(0.0, 1.0, 0.0);
    gate.evaluate(0.1, 0.0, 1.0);
    gate.evaluate(0.2, 1.0, 0.0);
    // plus d'une seconde musicale plus tard : la fenêtre s'est vidée, transition à nouveau autorisée
    const allowed = gate.evaluate(1.3, 0.0, 1.0);
    expect(allowed).toBe(0.0);
  });

  it('NE RESTE PAS bloqué : la scène redevenue calme repasse sans écrêtage', () => {
    // Vérification du critère 13 de §12 (chantier 10). Au navigateur, une
    // mesure isolée avait montré un écrêtage de 50 % — le maximum possible,
    // `apply` ne mesurant qu'une image sur deux — et la première hypothèse
    // était un verrouillage : `previousLuminance` figé à une valeur extrême,
    // clampant ensuite chaque image indéfiniment.
    //
    // Elle est FAUSSE, et ce test l'inscrit. Après une salve qui épuise le
    // budget de transitions, une scène dont la luminance ne bouge plus repasse
    // intégralement — le delta est sous le seuil, la porte n'est même pas
    // consultée. Mesuré aussi au navigateur : 5 images écrêtées pendant une
    // salve forcée, puis 0 sur les 240 images suivantes.
    const gate = new FlashRateGate(NORMAL_MODE);
    let precedente = 0;
    let ecretees = 0;
    for (let i = 0; i < 8; i++) {
      const voulue = i % 2 === 0 ? 1 : 0;
      const rendue = gate.evaluate(i * 0.02, voulue, precedente);
      if (rendue !== voulue) ecretees++;
      precedente = rendue;
    }
    // La salve a bien fini par écrêter — sinon le reste du test ne prouve rien.
    expect(ecretees, 'la salve aurait dû épuiser le budget de transitions').toBeGreaterThan(0);

    // Retour au calme. La fenêtre glisse en temps MUSICAL : une seconde plus
    // tard, le budget est reconstitué et la scène retrouve sa vraie luminance
    // en une transition — c'est ce moment-là qu'un verrouillage empêcherait.
    precedente = gate.evaluate(1.5, 0.5, precedente);
    expect(precedente, 'la scène ne retrouve jamais sa luminance réelle').toBe(0.5);

    // Puis trente images de petites variations : plus rien ne doit être écrêté.
    for (let i = 0; i < 30; i++) {
      const voulue = 0.5 + (i % 2) * 0.01;
      expect(gate.evaluate(1.52 + i * 0.02, voulue, precedente), `image ${i}`).toBe(voulue);
      precedente = voulue;
    }
  });

  it('reset() vide la fenêtre de transitions récentes', () => {
    const gate = new FlashRateGate(NORMAL_MODE);
    gate.evaluate(0.0, 1.0, 0.0);
    gate.evaluate(0.1, 0.0, 1.0);
    gate.evaluate(0.2, 1.0, 0.0);
    gate.reset();
    expect(gate.evaluate(0.21, 0.0, 1.0)).toBe(0.0); // autorisée à nouveau juste après reset
  });
});

describe('FlashRateGate — mode réduction des flashs', () => {
  it('utilise un seuil plus bas et une limite plus stricte que le mode normal', () => {
    const gate = new FlashRateGate(REDUCED_FLASHING_MODE); // seuil 0.18, max 2/s
    expect(gate.evaluate(0.0, 0.25, 0.0)).toBe(0.25); // delta=0.25 > 0.18 : compte comme transition
    expect(gate.evaluate(0.1, 0.0, 0.25)).toBe(0.0); // 2e transition, encore autorisée
    expect(gate.evaluate(0.2, 0.25, 0.0)).toBe(0.0); // 3e : au-delà de la limite (2/s), clampée
  });
});
