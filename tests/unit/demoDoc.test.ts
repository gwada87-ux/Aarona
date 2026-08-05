/**
 * Tests de `ui/demoDoc.ts::buildDemoDoc()`/`buildDemoAudioFile()` — Étape 40.
 * Bien que dans `ui/`, ce sont deux fonctions PURES (aucun DOM) — repérées
 * comme telles par le 3e audit de couverture (un grep par dossier les aurait
 * ignorées à tort). Dernier fichier du lot de couverture visuelle/harnais.
 *
 * `buildDemoDoc(2)` (durée courte) sert de cas d'énumération EXACTE — assez
 * petit pour vérifier le compte de chaque type d'événement à la main.
 */
import { describe, expect, it } from 'vitest';
import { buildDemoDoc, buildDemoAudioFile } from '../../src/ui/demoDoc';
import { validatePmdi } from '../../src/music/validatePmdi';

describe('buildDemoDoc — validité PMDI', () => {
  it('passe validatePmdi() (document complet et cohérent)', () => {
    expect(validatePmdi(buildDemoDoc(10)).ok).toBe(true);
  });
});

describe('buildDemoDoc — durée courte (2s), énumération exacte (120 BPM, beatDur=0.5)', () => {
  const doc = buildDemoDoc(2);
  const byType = (type: string) => doc.events.filter((e) => e.type === type);

  it('4 KICK (beats 0,0.5,1,1.5), 1 DOWNBEAT (beat 0 seul, beat 4 hors bornes)', () => {
    expect(byType('KICK')).toHaveLength(4);
    expect(byType('DOWNBEAT')).toHaveLength(1);
    expect(byType('DOWNBEAT')[0]!.t).toBe(0);
  });

  it('2 SNARE (beat%4 dans {1,3} -> beats 1 et 3, t=0.5 et 1.5)', () => {
    const snares = byType('SNARE');
    expect(snares).toHaveLength(2);
    expect(snares.map((e) => e.t)).toEqual([0.5, 1.5]);
  });

  it('8 HAT (croches, pas de 0.25s, de 0 à 1.75 inclus)', () => {
    expect(byType('HAT')).toHaveLength(8);
  });

  it('0 DROP/BUILDUP : dropTimes [8,20,36] tous >= durationSec (2s)', () => {
    expect(byType('DROP')).toHaveLength(0);
    expect(byType('BUILDUP')).toHaveLength(0);
  });

  it('grid.beats/downbeats correspondent aux comptes ci-dessus', () => {
    expect(doc.grid!.beats).toHaveLength(4);
    expect(doc.grid!.downbeats).toHaveLength(1);
  });

  it('les événements sont triés par t croissant', () => {
    const ts = doc.events.map((e) => e.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it('features : energy/centroid/6 bandes, sampleCount = ceil(2*10)+1 = 21', () => {
    const byId = (id: string) => doc.features!.find((f) => f.id === id);
    expect(byId('energy')!.data).toHaveLength(21);
    expect(byId('centroid')!.data).toHaveLength(21);
    for (const band of ['sub', 'bass', 'lowmid', 'mid', 'himid', 'high']) {
      expect(byId(`band.${band}`)!.data).toHaveLength(21);
    }
  });

  it('sections : A/B/A contiguës, couvrant exactement [0, durationSec] sans trou ni chevauchement', () => {
    expect(doc.sections!.map((s) => s.letter)).toEqual(['A', 'B', 'A']);
    const [a1, b, a2] = doc.sections!;
    expect(a1!.t).toBe(0);
    expect(a1!.t + a1!.dur).toBeCloseTo(b!.t, 10);
    expect(b!.t + b!.dur).toBeCloseTo(a2!.t, 10);
    expect(a2!.t + a2!.dur).toBeCloseTo(2, 10);
  });
});

describe('buildDemoDoc — filtre dropTimes selon durationSec', () => {
  it('durationSec=60 (défaut) : les 3 DROP/BUILDUP (8, 20, 36) sont tous présents', () => {
    const doc = buildDemoDoc();
    expect(doc.events.filter((e) => e.type === 'DROP').map((e) => e.t)).toEqual([8, 20, 36]);
    expect(doc.events.filter((e) => e.type === 'BUILDUP').map((e) => e.t)).toEqual([5, 17, 33]);
  });

  it('durationSec=10 : seul le DROP à t=8 passe le filtre (20 et 36 exclus, borne stricte <)', () => {
    const doc = buildDemoDoc(10);
    const drops = doc.events.filter((e) => e.type === 'DROP');
    expect(drops).toHaveLength(1);
    expect(drops[0]!.t).toBe(8);
    const buildups = doc.events.filter((e) => e.type === 'BUILDUP');
    expect(buildups).toHaveLength(1);
    expect(buildups[0]!.t).toBe(5); // 8 - 3
    expect(buildups[0]!.dur).toBe(3);
  });
});

describe('buildDemoDoc — audio.duration reflète durationSec transmis', () => {
  it.each([1, 10, 60, 90])('durationSec=%i', (d) => {
    expect(buildDemoDoc(d).audio.duration).toBe(d);
  });
});

describe('buildDemoDoc — déterminisme (Loi 1 : pas de Math.random/horloge réelle)', () => {
  it('deux appels avec le même durationSec produisent EXACTEMENT le même document', () => {
    expect(buildDemoDoc(5)).toEqual(buildDemoDoc(5));
  });

  it("source.createdAt figé à l'epoch (new Date(0)), jamais l'heure réelle", () => {
    expect(buildDemoDoc(1).source.createdAt).toBe(new Date(0).toISOString());
  });
});

describe('buildDemoAudioFile — identité du fichier', () => {
  it('nom "pulsar-demo.wav", type "audio/wav"', () => {
    const file = buildDemoAudioFile(1, 8000);
    expect(file.name).toBe('pulsar-demo.wav');
    expect(file.type).toBe('audio/wav');
  });

  it('taille = 44 (en-tête) + numSamples×2 (mono 16 bits)', () => {
    const file = buildDemoAudioFile(1, 8000);
    expect(file.size).toBe(44 + Math.round(1 * 8000) * 2);
  });
});

describe('buildDemoAudioFile — en-tête WAV (RIFF/WAVE/fmt /data)', () => {
  it('marqueurs et champs fmt corrects : PCM mono 16 bits à la fréquence demandée', async () => {
    const sampleRate = 8000;
    const file = buildDemoAudioFile(1, sampleRate);
    const buf = await file.arrayBuffer();
    const view = new DataView(buf);
    const readStr = (offset: number, len: number) => String.fromCharCode(...new Uint8Array(buf, offset, len));

    expect(readStr(0, 4)).toBe('RIFF');
    expect(readStr(8, 4)).toBe('WAVE');
    expect(readStr(12, 4)).toBe('fmt ');
    expect(readStr(36, 4)).toBe('data');
    expect(view.getUint32(16, true)).toBe(16); // taille du sous-chunk fmt
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(sampleRate);
    expect(view.getUint32(28, true)).toBe(sampleRate * 2); // byteRate = sampleRate * blockAlign
    expect(view.getUint16(32, true)).toBe(2); // blockAlign
    expect(view.getUint16(34, true)).toBe(16); // bits/échantillon
  });

  it('tailles déclarées cohérentes avec numSamples', () => {
    const sampleRate = 8000;
    const durationSec = 1;
    const file = buildDemoAudioFile(durationSec, sampleRate);
    const numSamples = Math.round(durationSec * sampleRate);
    const dataSize = numSamples * 2;

    return file.arrayBuffer().then((buf) => {
      const view = new DataView(buf);
      expect(view.getUint32(40, true)).toBe(dataSize); // taille du sous-chunk data
      expect(view.getUint32(4, true)).toBe(36 + dataSize); // taille RIFF totale - 8
    });
  });
});

describe('buildDemoAudioFile — contenu PCM (ton 220 Hz, formule 0,15×sin(2π×220×i/sampleRate))', () => {
  it('échantillon 0 est exactement 0 (sin(0)=0, aucune ambiguïté de troncature)', async () => {
    const file = buildDemoAudioFile(1, 8000);
    const view = new DataView(await file.arrayBuffer());
    expect(view.getInt16(44, true)).toBe(0);
  });

  it('un échantillon interne correspond exactement au même calcul/passage par Int16 que la source', async () => {
    const sampleRate = 8000;
    const i = 100;
    const file = buildDemoAudioFile(1, sampleRate);
    const view = new DataView(await file.arrayBuffer());

    // Même formule ET même conversion Int16 que la source (docs/00b : reproduire la troncature
    // réelle plutôt que de supposer un résultat mathématiquement "propre").
    const expectedSample = 0.15 * Math.sin((2 * Math.PI * 220 * i) / sampleRate);
    const expectedView = new DataView(new ArrayBuffer(2));
    expectedView.setInt16(0, Math.max(-1, Math.min(1, expectedSample)) * 0x7fff, true);

    expect(view.getInt16(44 + i * 2, true)).toBe(expectedView.getInt16(0, true));
  });
});

describe('buildDemoAudioFile — déterminisme', () => {
  it('deux appels avec les mêmes paramètres produisent des octets IDENTIQUES', async () => {
    const a = new Uint8Array(await buildDemoAudioFile(0.5, 8000).arrayBuffer());
    const b = new Uint8Array(await buildDemoAudioFile(0.5, 8000).arrayBuffer());
    expect(a).toEqual(b);
  });
});
