'use client';

import { useState } from 'react';

export function RuntimeStatus() {
  const [state, setState] = useState<'idle' | 'pending' | 'ready' | 'unavailable'>('idle');
  async function verify() {
    setState('pending');
    try {
      const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      const result: unknown = await response.json();
      setState(response.ok && result !== null && typeof result === 'object' && 'status' in result && result.status === 'ok' ? 'ready' : 'unavailable');
    } catch { setState('unavailable'); }
  }
  return <div className="status-card">
    <div><h2>État de l’installation</h2><p role="status" aria-live="polite">
      {state === 'idle' && 'Vérifiez que le socle répond avant de continuer.'}
      {state === 'pending' && 'Vérification en cours…'}
      {state === 'ready' && 'Le socle répond. Les connexions D1 et R2 sont configurées.'}
      {state === 'unavailable' && 'La vérification n’a pas abouti. Vérifiez la configuration puis réessayez.'}
    </p></div>
    <button type="button" disabled={state === 'pending'} onClick={verify}>
      {state === 'pending' ? 'Vérification…' : state === 'idle' ? 'Vérifier' : 'Vérifier à nouveau'}
    </button>
  </div>;
}
