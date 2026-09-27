'use client';

import {createContext, useContext, type ReactNode} from 'react';
import type {DeliveryTransport} from './transport.ts';

const DeliveryTransportContext = createContext<DeliveryTransport | null>(null);

/** The native admin host supplies the locally authorized operator transport. */
export function DeliveryTransportProvider({transport, children}: {
  readonly transport: DeliveryTransport | null;
  readonly children: ReactNode;
}) {
  return <DeliveryTransportContext.Provider value={transport}>{children}</DeliveryTransportContext.Provider>;
}

export function useDeliveryTransport(): DeliveryTransport | null {
  return useContext(DeliveryTransportContext);
}
