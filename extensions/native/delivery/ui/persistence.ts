import type {WorkspaceNavigation} from '@creezio/sdk/workspace/types';
import type {DeliveryPersistence, DeliverySavedTransfer} from '@creezio/sdk/delivery/controller';
import type {DeliveryUpdatePersistence, DeliverySavedUpdate} from '@creezio/sdk/delivery/update-controller';

function panelData(navigation: WorkspaceNavigation): Record<string, unknown> {
  const data = navigation.readPanelState()?.data;
  return data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown> : {};
}

/** Panel state contains transfer identity only. Credentials never enter workspace storage. */
export function deliveryPersistence(navigation: WorkspaceNavigation): DeliveryPersistence {
  return Object.freeze({
    read() { const data = panelData(navigation); return data.initial ?? data; },
    save(value: DeliverySavedTransfer | null) {
      const previous = navigation.readPanelState() ?? {};
      const data = {...panelData(navigation)};
      if (value) data.initial = {...value}; else delete data.initial;
      return navigation.savePanelState({...previous, data});
    },
  });
}

export function deliveryUpdatePersistence(navigation: WorkspaceNavigation): DeliveryUpdatePersistence {
  return Object.freeze({
    read() { return panelData(navigation).update ?? null; },
    save(value: DeliverySavedUpdate | null) {
      const previous = navigation.readPanelState() ?? {};
      const data = {...panelData(navigation)};
      if (value) data.update = {...value}; else delete data.update;
      return navigation.savePanelState({...previous, data});
    },
  });
}
