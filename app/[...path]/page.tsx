import { notFound } from 'next/navigation';
import { front, frontViews } from '../../.creezio/generated/client';
import { resolveWorkspaceLocation } from '../../sdk/workspace/controller';
import { FrontHost } from '../front/host';

export default async function ModuleView({params, searchParams}: {
  params: Promise<{path: string[]}>;
  searchParams: Promise<Record<string,string|string[]|undefined>>;
}) {
  if (front.kind !== 'theme') notFound();
  const {path} = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) for (const item of value) query.append(key, item);
    else if (value !== undefined) query.append(key, value);
  }
  const url = `/${path.map(encodeURIComponent).join('/')}${query.size ? `?${query}` : ''}`;
  const declared = frontViews.filter(view => view.surfaces.includes('front') && view.audiences.includes('app'));
  if (!resolveWorkspaceLocation(url, declared, new Set(declared.map(view => view.id)), 'front')) notFound();
  return <FrontHost initialUrl={url} />;
}
