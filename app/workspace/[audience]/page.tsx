import { notFound } from 'next/navigation';
import { nativeAccess } from '../../../.creezio/generated/client';
import { WorkspaceHost } from '../host';

/** Public shell only. Native session and permissions determine its contents. */
export default async function WorkspacePage({params}: {params: Promise<{audience: string}>}) {
  const {audience} = await params;
  if ((audience !== 'admin' && audience !== 'app') || !nativeAccess[audience]) notFound();
  return <WorkspaceHost audience={audience} />;
}
