import type {Media,PublishedPage,Result} from './contracts.ts';

export type ImageState={status:'loading'|'unavailable'|'ready';url?:string};
export type ImageStates=Record<string,ImageState>;
const fileId=(value:unknown):string=>typeof value==='string'&&/^f1_[a-f0-9]{64}$/u.test(value)?value:'';
/** The server admits at most five distinct linked images in one published snapshot. */
export function publishedImageIds(page:Pick<PublishedPage,'settings'|'sections'>):string[]{
  const ids:string[]=[],add=(value:unknown)=>{const id=fileId(value);if(id&&!ids.includes(id))ids.push(id);};
  for(const section of page.sections){if(!section.enabled)continue;
    if(section.kind==='hero'){add(section.content.logoFileId||page.settings.logoFileId);add(section.content.imageFileId);}
    if(section.kind==='features'&&Array.isArray(section.content.items))for(const item of section.content.items)
      if(item&&typeof item==='object'&&!Array.isArray(item))add((item as Record<string,unknown>).imageFileId);
  }
  return ids;
}
/** An editor may have many draft uploads, while a rendered page cites at most five. */
export function referencedMedia(items:readonly Media[],ids:readonly string[]):Media[]{
  return ids.map(id=>items.find(item=>item.fileId===id)).filter((item):item is Media=>item!==undefined);
}
export function createPublishedImageLoad(options:{
  ids:readonly string[];isCurrent:()=>boolean;
  list:()=>Promise<Result<{items:Media[]}>>;
  download:(media:Media)=>Promise<{kind:string;value?:Blob}>;
  createUrl:(bytes:Blob,mime:string)=>string;revokeUrl:(url:string)=>void;
  update:(images:ImageStates)=>void;
}){
  let active=true;const urls=new Set<string>();
  const current=()=>active&&options.isCurrent();
  let states:ImageStates=Object.fromEntries(options.ids.map(id=>[id,{status:'loading'}]));
  const set=(id:string,status:ImageState)=>{if(!current())return;states={...states,[id]:status};options.update(states);};
  return {async run(){
    if(!current())return;options.update(states);
    if(options.ids.length===0)return;
    let result:Result<{items:Media[]}>;
    try{result=await options.list();}catch{result={kind:'rejected',code:'unavailable'};}
    if(!current())return;
    if(options.ids.length>5||result.kind!=='ok'||result.value.items.length>5){
      for(const id of options.ids)set(id,{status:'unavailable'});return;}
    const byId=new Map(result.value.items.map(item=>[item.fileId,item]));
    for(const id of options.ids){
      if(!current())return;
      const media=byId.get(id);
      if(!media||!['image/png','image/jpeg','image/webp'].includes(media.contentType)){
        set(id,{status:'unavailable'});continue;
      }
      let response:{kind:string;value?:Blob};
      try{response=await options.download(media);}catch{response={kind:'rejected'};}
      if(!current())return;
      if(response.kind!=='ready'||!response.value){set(id,{status:'unavailable'});continue;}
      let url:string;
      try{url=options.createUrl(response.value,media.contentType);}catch{set(id,{status:'unavailable'});continue;}
      if(!current()){options.revokeUrl(url);return;}
      urls.add(url);set(id,{status:'ready',url});
    }
  },dispose(){active=false;for(const url of urls)options.revokeUrl(url);urls.clear();}};
}
