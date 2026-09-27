'use client';

import { createElement, useEffect, useMemo } from 'react';
import type { RuntimeViewProps } from '../../../../sdk/runtime/ui.ts';
import { createAccessAdminController } from '../../../../sdk/access/admin-controller.ts';
import { useWorkspacePortalHost } from '@creezio/sdk/workspace/components';
import { AccessAdminClient } from './access-admin-client.tsx';
import { createPanelCommandPersistence } from './persistence.ts';

/** Declarative module view: the generic workspace supplies guarded SDK clients. */
export function AccessAdminView(props: RuntimeViewProps) {
  const portalContainer = useWorkspacePortalHost();
  const persistence = useMemo(() => createPanelCommandPersistence(props.navigation), [props.navigation]);
  const controller = useMemo(() => props.audience === 'admin' && props.client.audience === 'admin'
    ? createAccessAdminController({client: props.client, access: props.access, persistence}) : null,
  [props.client, props.access, props.audience, persistence]);
  useEffect(() => () => controller?.dispose(), [controller]);
  if (!controller || props.contextId !== 'application')
    return createElement('p', {role: 'alert'}, 'Vue d’accès indisponible dans ce contexte.');
  return createElement(AccessAdminClient, {controller, active: props.active,
    authorized: props.authorized, portalContainer});
}

export { AccessAdminClient };
