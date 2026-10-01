import type {CSSProperties} from 'react';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {LANDING_PREFAB_COMPONENTS} from './prefabs.tsx';
import {publishedImageIds} from './published-images.ts';
import type {NavItem,PublishedPage} from './contracts.ts';

const color=(value:unknown):string|undefined=>typeof value==='string'&&
  /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/u.test(value)?value:undefined;
const path=(slug:string)=>`/p?slug=${encodeURIComponent(slug)}`;
const safeCanonical=(value:string)=>!/[\\\u0000-\u001f]/u.test(value)&&
  (value.startsWith('/')&&!value.startsWith('//')||/^https?:\/\//u.test(value));

/** Static HTML uses the same five editorial prefabs as the authenticated front. */
export function PublicPageDocument({page,navigation,origin,css}: {
  page:PublishedPage;navigation:readonly NavItem[];origin:string;css:string;
}){
  const title=page.seo.title?.trim()||page.title;
  const description=page.seo.description?.trim()||'';
  const ownUrl=new URL(path(page.slug),origin).href;
  let canonical=ownUrl;
  try{
    const rawCanonical=page.seo.canonical??'';
    const requested=new URL(rawCanonical.trim()||ownUrl,origin);
    if((!rawCanonical.trim()||safeCanonical(rawCanonical))
      &&['http:','https:'].includes(requested.protocol)
      &&!requested.username&&!requested.password)canonical=requested.href;
  }catch{/* The current page remains its own canonical URL. */}
  const images=Object.fromEntries(publishedImageIds(page).map(fileId=>[fileId,{status:'ready' as const,
    url:`/api/public/pages-navigation/media?slug=${encodeURIComponent(page.slug)}&file_id=${encodeURIComponent(fileId)}&revision=${page.publishedRevision}`} ]));
  const style={...(color(page.settings.accent)?{'--lnd-accent':color(page.settings.accent)}:{}),
    ...(color(page.settings.background)?{'--lnd-bg':color(page.settings.background)}:{})} as CSSProperties;
  return <html lang="fr"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
    <title>{title}</title>{description&&<meta name="description" content={description}/>}
    <link rel="canonical" href={canonical}/><style>{css}</style></head><body>
    <main className="lnd-root" style={style}>
      <nav aria-label="Navigation éditoriale"><ul>{navigation.filter(item=>!item.hidden).sort((a,b)=>a.order-b.order)
        .map(item=><li key={item.id}><a href={item.pageSlug?path(item.pageSlug):item.href}>{item.label}</a></li>)}</ul></nav>
      {page.sections.filter(section=>section.enabled).sort((a,b)=>a.position-b.position)
        .map(section=>{const Component=LANDING_PREFAB_COMPONENTS[section.kind];return Component?
          <Component key={section.id} content={section.content} settings={page.settings} images={images}/>:null;})}
    </main></body></html>;
}

export function renderPublicPage(page:PublishedPage,navigation:readonly NavItem[],origin:string,css:string):string{
  return renderToStaticMarkup(createElement(PublicPageDocument,{page,navigation,origin,css}));
}
