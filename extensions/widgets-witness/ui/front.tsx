'use client';

import type {PublicFrontViewProps} from '../../../sdk/front/types';
import type {WorkspaceViewProps} from '../../../sdk/workspace/types';

/** Synthetic presentation only. No identity, client or data capability is supplied. */
export function witness_public({navigation}: PublicFrontViewProps) {
  return <section aria-label="Information publique témoin">
    <p>Cette contribution publique est fournie par le module témoin.</p>
    <button type="button" onClick={() => navigation.open('example.widgets-witness:home')}>Ouvrir les fiches</button>
  </section>;
}

export function witness_private({contextId}: WorkspaceViewProps) {
  return <aside aria-label="Contribution privée témoin">Espace autorisé : {contextId}</aside>;
}
