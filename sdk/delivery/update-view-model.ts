import type {DeliveryUpdatePhase} from './transport.ts';
import type {DeliveryUpdateSnapshot} from './update-controller.ts';

export type DeliveryUpdateStepStatus = 'waiting' | 'current' | 'done' | 'attention';
export interface DeliveryUpdateViewModel {
  readonly headline: string;
  readonly detail: string;
  readonly updateId: string | null;
  readonly steps: readonly Readonly<{id: string; label: string; status: DeliveryUpdateStepStatus}>[];
  readonly canPrepare: boolean;
  readonly canConfigure: boolean;
  readonly canStart: boolean;
  readonly canRefresh: boolean;
  readonly canReconcile: boolean;
}
const steps = Object.freeze([
  {id: 'build', label: 'Construire la nouvelle version'},
  {id: 'preflight', label: 'Vérifier la cible existante'},
  {id: 'schema', label: 'Appliquer le schéma D1'},
  {id: 'publish', label: 'Publier et confirmer la mise à jour'},
]);
const phaseStep: Record<DeliveryUpdatePhase, number> = {
  prepared: 0, building: 0, built: 1, preflight: 1,
  'schema-applying': 2, 'schema-ready': 3, publishing: 3,
  'delivery-unknown': 3, delivered: 3,
};

export function deliveryUpdateViewModel(input: DeliveryUpdateSnapshot): DeliveryUpdateViewModel {
  const phase = input.update?.phase;
  const connected = input.connection === 'connected';
  const updateId = input.update?.updateId ?? input.saved?.updateId ?? input.inspection?.activeUpdateId ?? null;
  const prepared = !!input.prepared && !!input.saved && !input.saved.started
    && input.prepared.updateId === input.saved.updateId
    && input.prepared.planDigest === input.saved.planDigest;
  let headline = 'Préparer une mise à jour', detail = 'Vérifiez le plan de la nouvelle version avant sa publication.';
  if (!connected) {
    headline = 'Service local indisponible';
    detail = updateId ? 'Reconnectez le service local puis vérifiez cette mise à jour identifiée.'
      : 'Reconnectez le service local pour examiner la publication courante.';
  } else if (phase === 'delivery-unknown') {
    headline = 'Publication à vérifier';
    detail = 'Le résultat est incertain. Vérifiez cette même mise à jour avant toute nouvelle tentative.';
  } else if (phase === 'delivered') {
    headline = 'Mise à jour confirmée';
    detail = 'La nouvelle version du Worker a été publiée et vérifiée.';
  } else if (phase && phase !== 'prepared' || input.saved?.started) {
    headline = 'Mise à jour en cours';
    detail = 'Suivez la construction, le schéma et la publication de cette version identifiée.';
  } else if (input.inspection?.readiness !== 'ready') {
    headline = 'Mise à jour indisponible';
    detail = 'Vérifiez la publication courante et sa cible depuis le service local.';
  } else if (prepared) {
    headline = 'Plan de mise à jour prêt';
    detail = 'Relisez le plan avant de lancer la construction et la publication.';
  }
  return Object.freeze({headline, detail, updateId,
    steps: Object.freeze(steps.map((step,index) => Object.freeze({...step,
      status: phase === 'delivered' ? 'done' as const
        : phase === undefined ? 'waiting' as const
        : index < phaseStep[phase] ? 'done' as const
        : index > phaseStep[phase] ? 'waiting' as const
        : phase === 'delivery-unknown' ? 'attention' as const : 'current' as const}))),
    canPrepare: connected && input.inspection?.readiness === 'ready'
      && !input.inspection.activeUpdateId && (!input.saved || phase === 'delivered'),
    canConfigure: connected && input.inspection?.readiness === 'needed',
    canStart: connected && input.inspection?.readiness === 'ready' && prepared,
    canRefresh: true,
    canReconcile: connected && !!input.saved?.started && phase !== 'delivered',
  });
}
