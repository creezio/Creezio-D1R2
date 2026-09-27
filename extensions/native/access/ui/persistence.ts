import type { AccessAdminPendingPersistence } from '../../../../sdk/access/admin-types.ts';
import type { WorkspaceNavigation } from '../../../../sdk/workspace/types.ts';

/** The retained panel owns command-key durability; no module storage is opened. */
export function createPanelCommandPersistence(navigation: Pick<WorkspaceNavigation,
  'readPanelState' | 'savePanelState'>): AccessAdminPendingPersistence {
  return Object.freeze({
    read() {
      const data = navigation.readPanelState()?.data;
      return typeof data?.pendingBindingId === 'string' && typeof data.pendingRequestKey === 'string'
        ? {bindingId: data.pendingBindingId, requestKey: data.pendingRequestKey} : null;
    },
    save(value: Readonly<{bindingId: string; requestKey: string}> | null) {
      const previous = navigation.readPanelState() ?? {};
      const data: Record<string, unknown> = {...previous.data};
      if (value) { data.pendingBindingId = value.bindingId; data.pendingRequestKey = value.requestKey; }
      else { delete data.pendingBindingId; delete data.pendingRequestKey; }
      return navigation.savePanelState({...previous, data});
    }
  });
}
