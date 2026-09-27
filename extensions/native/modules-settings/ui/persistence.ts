import type {WorkspaceNavigation} from '../../../../sdk/workspace/types.ts';
import type {ModuleSettingsPendingPersistence} from '../../../../sdk/module-settings/types.ts';

/** Only the non-secret request identity is retained by the declared panel state. */
export function modulePendingPersistence(navigation: WorkspaceNavigation): ModuleSettingsPendingPersistence {
  return Object.freeze({
    read() {
      const data = navigation.readPanelState()?.data;
      return data && {requestKey: data.pendingRequestKey, owner: data.pendingOwner};
    },
    save(value: Readonly<{requestKey: string; owner: string}> | null) {
      const previous = navigation.readPanelState() ?? {};
      const data = value ? {pendingRequestKey: value.requestKey, pendingOwner: value.owner} : {};
      return navigation.savePanelState({...previous, data});
    },
  });
}
