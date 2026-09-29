import type {PublishedPage} from './contracts.ts';

/** A browser-only lease for the active, authorized page; it never supplies crawler metadata. */
export function activatePublishedSeo(doc:Document,page:PublishedPage):()=>void{
  const title=page.seo.title?.trim()||page.title;
  const oldTitle=doc.title;
  doc.title=title;
  const description=page.seo.description?.trim()||'';
  const previous=doc.head.querySelector<HTMLMetaElement>('meta[name="description"]');
  const meta=description?(previous??doc.createElement('meta')):null;
  const oldDescription=previous?.getAttribute('content')??null;
  if(meta){
    if(!previous){meta.name='description';meta.dataset.creezioPagesSeo='description';doc.head.appendChild(meta);}
    meta.content=description;
  }
  const rawCanonical=page.seo.canonical?.trim()||'';
  let canonical='';
  try{
    if(rawCanonical){const url=new URL(rawCanonical,doc.location.origin);
      if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)canonical=url.href;}
  }catch{/* The stored value is ignored if it cannot form a browser URL. */}
  const previousCanonical=doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const link=canonical?(previousCanonical??doc.createElement('link')):null;
  const oldCanonical=previousCanonical?.getAttribute('href')??null;
  if(link){
    if(!previousCanonical){link.rel='canonical';link.dataset.creezioPagesSeo='canonical';doc.head.appendChild(link);}
    link.href=canonical;
  }
  return ()=>{
    if(doc.title===title)doc.title=oldTitle;
    if(meta&&meta.getAttribute('content')===description){
      if(previous){if(oldDescription===null)meta.removeAttribute('content');else meta.setAttribute('content',oldDescription);}
      else meta.remove();
    }
    if(link&&link.getAttribute('href')===canonical){
      if(previousCanonical){if(oldCanonical===null)link.removeAttribute('href');else link.setAttribute('href',oldCanonical);}
      else link.remove();
    }
  };
}
