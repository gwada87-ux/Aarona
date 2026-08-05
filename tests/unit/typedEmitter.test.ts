/**
 * Tests de `core/bus/TypedEmitter.ts` — Étape 42. Jamais testée. Signalé
 * mort (0 référence hors de son propre fichier) dès l'Étape 36 puis
 * reconfirmé au 4e audit (Étape 41) — de la scaffolding réservée à de
 * futurs événements applicatifs (docs/16), pas encore câblée. Reste une
 * classe autonome à logique réelle (pub/sub par `Set`, pas `Array` — un
 * détail qui change le comportement sur listener dupliqué, voir plus bas) :
 * vaut la peine d'être couverte avant son premier câblage réel.
 */
import { describe, expect, it, vi } from 'vitest';
import { TypedEmitter } from '../../src/core/bus/TypedEmitter';

interface TestEvents extends Record<string, unknown> {
  foo: number;
  bar: { label: string };
}

describe('TypedEmitter — on()/emit() de base', () => {
  it('emit() appelle le listener enregistré avec le payload exact', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const received: number[] = [];
    emitter.on('foo', (v) => received.push(v));
    emitter.emit('foo', 42);
    expect(received).toEqual([42]);
  });

  it('plusieurs listeners sur le même événement sont TOUS appelés, dans l\'ordre d\'abonnement', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const calls: string[] = [];
    emitter.on('foo', () => calls.push('a'));
    emitter.on('foo', () => calls.push('b'));
    emitter.emit('foo', 1);
    expect(calls).toEqual(['a', 'b']);
  });

  it('emit() sur un événement sans aucun listener ne lève pas', () => {
    const emitter = new TypedEmitter<TestEvents>();
    expect(() => emitter.emit('foo', 1)).not.toThrow();
  });

  it('le payload objet est transmis PAR RÉFÉRENCE, sans copie', () => {
    const emitter = new TypedEmitter<TestEvents>();
    let receivedPayload: TestEvents['bar'] | null = null;
    emitter.on('bar', (p) => {
      receivedPayload = p;
    });
    const payload = { label: 'x' };
    emitter.emit('bar', payload);
    expect(receivedPayload).toBe(payload);
  });
});

describe('TypedEmitter — isolation entre événements', () => {
  it("emit('foo') n'appelle jamais un listener enregistré sur 'bar'", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const barListener = vi.fn();
    emitter.on('bar', barListener);
    emitter.emit('foo', 1);
    expect(barListener).not.toHaveBeenCalled();
  });
});

describe('TypedEmitter — off()', () => {
  it('off() retire un listener précis ; les autres restent actifs', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const calls: string[] = [];
    const a = () => calls.push('a');
    const b = () => calls.push('b');
    emitter.on('foo', a);
    emitter.on('foo', b);
    emitter.off('foo', a);
    emitter.emit('foo', 1);
    expect(calls).toEqual(['b']);
  });

  it("off() d'un listener jamais enregistré, ou d'un événement inconnu, ne lève pas", () => {
    const emitter = new TypedEmitter<TestEvents>();
    expect(() => emitter.off('foo', () => {})).not.toThrow();
  });
});

describe('TypedEmitter — désabonnement via la closure renvoyée par on()', () => {
  it('appeler la fonction renvoyée par on() équivaut à off() pour CE listener précis', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const calls: string[] = [];
    const a = () => calls.push('a');
    const unsubscribeA = emitter.on('foo', a);
    emitter.on('foo', () => calls.push('b'));

    unsubscribeA();
    emitter.emit('foo', 1);
    expect(calls).toEqual(['b']);
  });
});

describe('TypedEmitter — même référence de fonction enregistrée deux fois (Set interne, pas Array)', () => {
  it('un même listener ajouté deux fois via on() n\'est appelé qu\'UNE SEULE fois par emit()', () => {
    const emitter = new TypedEmitter<TestEvents>();
    const listener = vi.fn();
    emitter.on('foo', listener);
    emitter.on('foo', listener);
    emitter.emit('foo', 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('TypedEmitter — désabonnement PENDANT emit()', () => {
  it("un listener qui se désabonne lui-même pendant l'appel n'empêche pas les autres de s'exécuter, et ne se ré-exécute pas au emit() suivant", () => {
    const emitter = new TypedEmitter<TestEvents>();
    const calls: string[] = [];
    let unsubscribeSelf: () => void = () => {};
    const selfRemoving = () => {
      calls.push('self');
      unsubscribeSelf();
    };
    unsubscribeSelf = emitter.on('foo', selfRemoving);
    emitter.on('foo', () => calls.push('other'));

    emitter.emit('foo', 1);
    expect(calls).toEqual(['self', 'other']);

    calls.length = 0;
    emitter.emit('foo', 2);
    expect(calls).toEqual(['other']);
  });
});
