import { notFound } from 'next/navigation';
import type { ComponentType } from 'react';
import { views } from '../../.creezio/generated/client';

// T-03 exposes only explicitly anonymous front views. The authenticated
// workspace and its authorization-aware composition are added by later lots.
export default async function ModuleView({ params }: { params: Promise<{ path: string[] }> }) {
  const route = `/${(await params).path.join('/')}`;
  const view = views.find(item => item.route === route && item.access === 'public-read' && item.surfaces.includes('front'));
  if (!view) notFound();
  // This anonymous T-03 entry is a presentational projection. It does not
  // provide an authenticated workspace controller or execution capability.
  const Component = view.component as ComponentType;
  return <main className="welcome"><header className="brand"><a href="/">Creezio</a></header>
    <section className="welcome-body" aria-label={view.title}><Component /></section></main>;
}
