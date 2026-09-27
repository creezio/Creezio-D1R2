import { notFound } from 'next/navigation';
import { nativeAccess } from '../../../../.creezio/generated/client';
import { AccessOAuthConsentView } from '../../../../extensions/native/access/ui/consent';
import { isConsentTransactionId } from '../../../../sdk/oauth/consent';

/** Host-owned document. The server keeps the transaction and returns its preview separately. */
export default async function OAuthConsentPage({params}: {
  params: Promise<{transactionId: string}>;
}) {
  const {transactionId} = await params;
  if (!isConsentTransactionId(transactionId) || (!nativeAccess.admin && !nativeAccess.app)) notFound();
  return <AccessOAuthConsentView transactionId={transactionId} />;
}
