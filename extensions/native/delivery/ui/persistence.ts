import type {WorkspaceNavigation} from '../../../../sdk/workspace/types.ts';
import type {DeliveryPersistence, DeliverySavedTransfer} from '../../../../sdk/delivery/controller.ts';

/** Panel state contains transfer identity only. Credentials never enter workspace storage. */
export function deliveryPersistence(navigation: WorkspaceNavigation): DeliveryPersistence {
  return Object.freeze({
    read() { return navigation.readPanelState()?.data ?? null; },
    save(value: DeliverySavedTransfer | null) {
      const previous = navigation.readPanelState() ?? {};
      return navigation.savePanelState({...previous, data: value ? {...value} : {}});
    },
  });
}
