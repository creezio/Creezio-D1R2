import type {DeliveryPhase, DeliveryStepId, DeliveryStepStatus, DeliveryStepViewModel,
  DeliveryViewInput, DeliveryViewModel} from './types.ts';

const steps: readonly Readonly<{id: DeliveryStepId; label: string}>[] = Object.freeze([
  {id: 'capture', label: 'Capturer la source locale'},
  {id: 'schema', label: 'Préparer le schéma D1'},
  {id: 'd1', label: 'Transférer les données D1'},
  {id: 'r2', label: 'Transférer les objets R2'},
  {id: 'secrets', label: 'Configurer les secrets et les bindings'},
  {id: 'verify', label: 'Vérifier la cible'},
  {id: 'publish', label: 'Publier et confirmer la livraison'},
]);

const phaseStep: Record<DeliveryPhase, DeliveryStepId> = {
  prepared: 'capture', starting: 'capture', capturing: 'capture', captured: 'schema',
  'schema-ready': 'd1', 'd1-copying': 'd1', 'r2-copying': 'r2',
  'secrets-ready': 'verify', verified: 'publish',
  'delivery-unknown': 'publish', delivered: 'publish',
};

function stepStatus(id: DeliveryStepId, phase: DeliveryPhase): DeliveryStepStatus {
  if (phase === 'delivered') return 'done';
  const current = steps.findIndex(step => step.id === phaseStep[phase]);
  const index = steps.findIndex(step => step.id === id);
  if (index < current) return 'done';
  if (index > current) return 'waiting';
  return phase === 'delivery-unknown' ? 'attention' : 'current';
}

/** Pure projection: a lost connection never turns an uncertain delivery into success or failure. */
export function deliveryViewModel(input: DeliveryViewInput): DeliveryViewModel {
  const transfer = input.transfer;
  const connected = input.connection === 'connected';
  const active = transfer !== null && transfer.phase !== 'delivered';
  const uncertain = transfer?.phase === 'delivery-unknown';
  const complete = transfer?.phase === 'delivered';
  const connectionLabel = input.connection === 'connected' ? 'Service local connecté'
    : input.connection === 'reconnecting' ? 'Reconnexion au service local…' : 'Service local indisponible';
  let headline: string, detail: string;
  if (!connected) {
    headline = connectionLabel;
    detail = complete ? 'Dernier état confirmé : livraison terminée. Reconnectez le service local pour actualiser le statut.'
      : transfer ? 'Le transfert identifié reste à vérifier auprès du service local après reconnexion.'
      : 'Reconnectez le service local pour consulter la préparation de la livraison.';
  } else if (active && input.configuration === 'needed') {
    headline = 'Jeton à ressaisir';
    detail = 'Le service local a perdu son jeton. Renseignez-le pour la même cible, puis vérifiez ce transfert.';
  } else if (uncertain) {
    headline = 'Publication à vérifier';
    detail = 'Le résultat de la publication est incertain. Vérifiez ce même transfert avant toute nouvelle tentative.';
  } else if (complete) {
    headline = 'Livraison confirmée';
    detail = 'Le transfert identifié a été publié et vérifié.';
  } else if (active) {
    headline = 'Livraison en cours';
    detail = 'Suivez la progression du transfert identifié. Vous pouvez revenir sur cet écran après une coupure.';
  } else if (input.configuration !== 'ready') {
    headline = 'Configurer Cloudflare';
    detail = 'Renseignez la cible et les références de secrets nécessaires à la livraison.';
  } else if (input.preparation !== 'ready' || !input.planReviewed) {
    headline = 'Préparer la livraison';
    detail = 'Vérifiez les ressources et la construction avant de lancer le transfert.';
  } else {
    headline = 'Prêt à livrer';
    detail = 'Le profil Docker local est préparé pour une livraison vers Cloudflare.';
  }
  return Object.freeze({
    profileLabel: 'Docker local', connection: input.connection, connectionLabel, headline, detail,
    transferId: transfer?.id ?? null,
    steps: Object.freeze(steps.map(step => Object.freeze({...step,
      status: transfer ? stepStatus(step.id, transfer.phase) : 'waiting' as const}))),
    showCaptureNotice: connected && !transfer && input.configuration === 'ready'
      && input.preparation === 'ready' && input.planReviewed,
    canConfigure: connected && (!active && !input.planReviewed || input.configuration === 'needed'),
    canPrepare: connected && !transfer && !input.planReviewed && input.configuration === 'ready',
    canStart: connected && !transfer && input.configuration === 'ready'
      && input.preparation === 'ready' && input.planReviewed,
    canRefresh: true,
    canReconcile: connected && !!transfer && transfer.phase !== 'delivered',
  });
}
