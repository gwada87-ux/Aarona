/**
 * Démixage mono — audio/downmix (docs/02_ARCHITECTURE.md, tableau des
 * dépendances : `analysis/` ne peut pas importer `audio/`, donc cette étape
 * doit vivre ici, jamais dans `analysis/AnalysisPipeline.ts` qui l'attend en
 * entrée déjà faite — voir son en-tête, « le démixage est un souci de
 * `audio/` »).
 *
 * `(L+R)/2`, seule formule mentionnée dans le code existant — pas de
 * pondération ITU/BS.1770, hors périmètre pour un simple flux d'analyse.
 */
export function downmixToMono(buffer: AudioBuffer): Float32Array {
  const { numberOfChannels, length } = buffer;
  if (numberOfChannels <= 1) return buffer.getChannelData(0).slice();

  const out = new Float32Array(length);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) out[i]! += data[i]!;
  }
  const scale = 1 / numberOfChannels;
  for (let i = 0; i < length; i++) out[i]! *= scale;
  return out;
}
