import {notFound} from 'next/navigation';
import {nativeAccess} from '../../../../.creezio/generated/client';
import {NativeWidgetApprovalView} from '../../../../sdk/widgets/native-approval';
import {validWidgetApprovalLink} from '../../../../sdk/widgets/approval-link';

/** The URL is an opaque lookup pointer. Native session and grant checks happen on every read/decision. */
export default async function WidgetApprovalPage({params, searchParams}: {
  params: Promise<{audience: string; approvalId: string}>;
  searchParams: Promise<{context?: string | string[]}>;
}) {
  const [{audience,approvalId},{context}] = await Promise.all([params,searchParams]);
  if (!validWidgetApprovalLink(audience,approvalId,context,
    {admin:nativeAccess.admin,app:nativeAccess.app})) notFound();
  return <NativeWidgetApprovalView audience={audience} approvalId={approvalId} contextId={context as string} />;
}
