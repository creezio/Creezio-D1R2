import type {NavItem} from './contracts.ts';

/** An explicit editorial target has one canonical URL; arbitrary routes remain untouched. */
export function editorialHref(item:NavItem):string{
  return item.pageSlug?`/pages?slug=${encodeURIComponent(item.pageSlug)}`:item.href;
}

export function editorialLinkActive(item:NavItem,url:string):boolean{
  const parsed=new URL(url,'https://creezio.invalid');
  if(item.pageSlug){
    return parsed.pathname==='/pages'&&parsed.searchParams.get('slug')===item.pageSlug;
  }
  return item.href===url||/^\/[A-Za-z0-9/_-]*$/u.test(item.href)
    &&parsed.pathname==='/pages'&&parsed.searchParams.get('slug')===item.href;
}

export function subscribeFrontLocation(callback:()=>void):()=>void{
  window.addEventListener('popstate',callback);
  window.addEventListener('creezio:front-location',callback);
  return ()=>{
    window.removeEventListener('popstate',callback);
    window.removeEventListener('creezio:front-location',callback);
  };
}

export const currentFrontLocation=()=>`${window.location.pathname}${window.location.search}`;
export const serverFrontLocation=()=>'';
