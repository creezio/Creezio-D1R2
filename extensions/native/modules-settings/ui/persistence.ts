import type {WorkspaceNavigation} from '../../../../sdk/workspace/types.ts';
import type {ModuleSettingsPendingPersistence} from '../../../../sdk/module-settings/types.ts';

/** Only the non-secret request identity is retained by the declared panel state. */
export function modulePendingPersistence(navigation: WorkspaceNavigation): ModuleSettingsPendingPersistence {
  return Object.freeze({
    read() {
      const data = navigation.readPanelState()?.data;
      return data && {requestKey: data.pendingRequestKey, owner: data.pendingOwner,
        operation: data.pendingOperation};
    },
    save(value: Readonly<{requestKey: string; owner: string;
      operation: 'plans.accept' | 'plans.confirm-publication' | 'plans.cancel-pending'}> | null) {
      const previous = navigation.readPanelState() ?? {};
      const data = value ? {pendingRequestKey: value.requestKey, pendingOwner: value.owner,
        pendingOperation: value.operation} : {};
      return navigation.savePanelState({...previous, data});
    },
  });
}
