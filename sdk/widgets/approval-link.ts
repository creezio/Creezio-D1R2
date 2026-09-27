import type {AccessAudience} from '../access/types.ts';

const identifier = (value: unknown): value is string => typeof value === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

/** URL parameters select a native audience and lookup only; the session and server grant decide access. */
export function validWidgetApprovalLink(audience: unknown, approvalId: unknown, contextId: unknown,
  exposed: Readonly<Record<AccessAudience, boolean>>): audience is AccessAudience {
  return (audience === 'admin' || audience === 'app') && exposed[audience] === true &&
    identifier(approvalId) && identifier(contextId);
}

export function widgetApprovalPath(audience: AccessAudience, approvalId: string, contextId: string): string {
  if (!validWidgetApprovalLink(audience,approvalId,contextId,{admin:true,app:true}))
    throw new TypeError('Invalid widget approval link.');
  return `/approvals/${audience}/${encodeURIComponent(approvalId)}?context=${encodeURIComponent(contextId)}`;
}
