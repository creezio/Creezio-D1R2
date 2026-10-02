import type {OperationClientResult} from '../../sdk/operations/client';

// These optional reads have permissions distinct from their workspace views.
// A local refusal cannot revoke the session or its other open views.
const optionalReads = new Set([
  'creezio.analytics:admin.collection.effective',
  'creezio.analytics:app.collection.effective',
  'creezio.analytics:admin.retention.preview',
  'creezio.pages-navigation:admin.sidebar.resolved',
  'creezio.pages-navigation:app.sidebar.resolved',
  'creezio.openai:admin.config.read',
  'creezio.openai:app.config.read',
  'creezio.openai:admin.models.list',
  'creezio.openai:app.models.list',
]);

export function shouldRefreshHostAccess(result: OperationClientResult, bindingId: string,
  source: 'invoke' | 'status' = 'invoke'): boolean {
  if (result.kind !== 'rejected') return false;
  if (result.code === 'authentication_required' || result.code === 'unauthorized') return true;
  return result.code === 'forbidden' && (source !== 'invoke' || result.status !== 403 || !optionalReads.has(bindingId));
}
