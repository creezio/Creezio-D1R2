import { notFound } from 'next/navigation';
import { nativeAccess } from '../../../.creezio/generated/client';
import { NativeAccessPanel } from '../../../sdk/access/components';

// Public entry to native authentication, not a module view or an authorization.
export default async function AccessPage({ params }: { params: Promise<{ audience: string }> }) {
  const { audience } = await params;
  if ((audience !== 'admin' && audience !== 'app') || !nativeAccess[audience]) notFound();
  return <main className="welcome access-entry">
    <header className="brand"><a href="/" aria-label="Creezio — accueil"><span className="mark" aria-hidden="true">c</span>Creezio</a></header>
    <section className="access-entry-body">
      <p className="eyebrow">{audience === 'admin' ? 'Workspace Creezio' : 'Votre application'}</p>
      <NativeAccessPanel audience={audience} />
    </section>
    <footer>Votre compte. Votre espace.</footer>
  </main>;
}
