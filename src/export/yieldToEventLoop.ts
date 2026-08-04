/**
 * docs/09_EXPORT.md, piège #4 : JAMAIS `setTimeout` (bridé à 1 appel/s en
 * onglet d'arrière-plan) et JAMAIS de boucle `for` synchrone — les callbacks
 * `output` de `VideoEncoder` (sous Mediabunny) sont des tâches de la boucle
 * d'événements ; sans un vrai passage par cette boucle, elles ne s'exécutent
 * jamais, la file explose et l'annulation n'est jamais traitée.
 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port2.onmessage = () => resolve();
    channel.port1.postMessage(null);
  });
}
