import {createImageGate} from '../image-gate.ts';

export type LinkedWidgetImage=Readonly<{mimeType:'image/png'|'image/jpeg'|'image/webp';bytes:Uint8Array}>;
export type LinkedWidgetMedia=Readonly<{reference:Readonly<{fileId:string;intentId:string;generation:string;digest:string}>;
  contentType:string}>;
export type WidgetImageReader=Readonly<{
  media:(productId:string)=>Promise<readonly LinkedWidgetMedia[]>;
  image:(productId:string,media:LinkedWidgetMedia)=>Promise<LinkedWidgetImage>;
}>;

const imageTypes=new Set(['image/png','image/jpeg','image/webp']);
const maximum=2*1024*1024;
const encodedMaximum=4*Math.ceil(maximum/3);
const fileId=(value:unknown)=>typeof value==='string'&&/^f1_[a-f0-9]{64}$/u.test(value);
const digest=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const token=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=128
  &&!/[\u0000-\u001f\u007f]/u.test(value);

/** `media.list` is an ordinary read; its opaque reference is never an authorization. */
export function linkedMediaFromResult(value:unknown,productId:string):readonly LinkedWidgetMedia[]|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const result=value as Record<string,unknown>;
  if(result.isError===true)return null;
  let output=result.structuredContent;
  if(output&&typeof output==='object'&&!Array.isArray(output)){
    const envelope=output as Record<string,unknown>;
    if(envelope.kind==='creezio.widget.action.v1'){
      if(envelope.state!=='succeeded')return null;
      output=envelope.output;
    }
  }
  if(!output||typeof output!=='object'||Array.isArray(output))return null;
  const items=(output as Record<string,unknown>).items;
  if(!Array.isArray(items)||items.length>5)return null;
  const parsed:LinkedWidgetMedia[]=[];
  for(const raw of items){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
    const item=raw as Record<string,unknown>;
    if(item.productId!==productId||typeof item.contentType!=='string'||!imageTypes.has(item.contentType)
      ||!item.reference||typeof item.reference!=='object'||Array.isArray(item.reference))return null;
    const reference=item.reference as Record<string,unknown>;
    if(!fileId(reference.fileId)||!token(reference.intentId)||!token(reference.generation)
      ||!digest(reference.digest)||item.fileId!==reference.fileId||item.digest!==reference.digest)return null;
    parsed.push({contentType:item.contentType,reference:reference as LinkedWidgetMedia['reference']});
  }
  return parsed;
}

/** Private app-only MCP metadata; content and structuredContent carry no image bytes. */
export function linkedImageFromResult(value:unknown):LinkedWidgetImage|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const result=value as Record<string,unknown>;
  if(result.isError===true||Object.hasOwn(result,'structuredContent')||!Array.isArray(result.content)
    ||result.content.length!==1||!result.content[0]||typeof result.content[0]!=='object'
    ||result.content[0].type!=='text'||result.content[0].text!=='Image privée remise au composant.'
    ||!result._meta||typeof result._meta!=='object'||Array.isArray(result._meta))return null;
  const image=(result._meta as Record<string,unknown>)['creezio/linkedImage'];
  if(!image||typeof image!=='object'||Array.isArray(image))return null;
  const payload=image as Record<string,unknown>;
  if(payload.schemaVersion!==1||payload.type!=='image'||typeof payload.mimeType!=='string'||!imageTypes.has(payload.mimeType)
    ||typeof payload.data!=='string'||!payload.data.length||payload.data.length>encodedMaximum
    ||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(payload.data))return null;
  try{
    const decoded=atob(payload.data);
    if(!decoded.length||decoded.length>maximum)return null;
    const bytes=Uint8Array.from(decoded,char=>char.charCodeAt(0));
    return {mimeType:payload.mimeType as LinkedWidgetImage['mimeType'],bytes};
  }catch{return null;}
}

/** Only the current visible card owns these bytes and Blob URLs. No persistent cache. */
export function createWidgetImageView(reader:WidgetImageReader,options:{observer?:typeof IntersectionObserver|null;
  makeUrl?:(blob:Blob)=>string;revokeUrl?:(url:string)=>void}={}){
  const gate=createImageGate({maxConcurrent:2,maxPerMinute:20});
  const makeUrl=options.makeUrl??(blob=>URL.createObjectURL(blob));
  const revokeUrl=options.revokeUrl??(url=>URL.revokeObjectURL(url));
  const Observer=options.observer===undefined?globalThis.IntersectionObserver:options.observer;
  let generation=0;
  const active=new Set<{dispose:()=>void}>();
  const clear=()=>{generation++;for(const item of active)item.dispose();active.clear();gate.cancel();};
  const attach=(element:HTMLElement,productId:string,limit:1|5)=>{
    const mark=generation;
    let alive=true,started=false,observer:IntersectionObserver|undefined;
    const urls:string[]=[];
    const current=()=>alive&&mark===generation&&element.isConnected;
    const status=document.createElement('span');
    status.textContent='Chargement de l’image…';element.replaceChildren(status);
    const entry={dispose:()=>{alive=false;observer?.disconnect();for(const url of urls)revokeUrl(url);
      urls.length=0;element.replaceChildren();}};
    active.add(entry);
    const load=async()=>{
      if(started||!current())return;started=true;
      try{
        const media=await reader.media(productId);
        if(!current())return;
        if(!Array.isArray(media)||media.length>5)throw new Error('invalid_media');
        const selected=media.slice(0,limit);
        if(!selected.length){status.textContent='Aucune image';return;}
        if(limit===5)element.replaceChildren();
        for(const item of selected){
          if(!current())return;
          const slot=limit===1?element:document.createElement('div');
          if(limit===5){slot.className='image';element.appendChild(slot);}
          const unavailable=()=>{const label=document.createElement('span');label.textContent='Image indisponible';
            slot.replaceChildren(label);};
          if(!imageTypes.has(item.contentType)){unavailable();continue;}
          let result:LinkedWidgetImage|undefined;
          try{result=await gate.run(current,()=>reader.image(productId,item));}
          catch{if(current())unavailable();continue;}
          if(!current())return;
          if(!result||result.mimeType!==item.contentType||!imageTypes.has(result.mimeType)
            ||!(result.bytes instanceof Uint8Array)||!result.bytes.length||result.bytes.length>maximum){
            unavailable();continue;}
          const url=makeUrl(new Blob([new Uint8Array(result.bytes)],{type:result.mimeType}));
          if(!current()){revokeUrl(url);return;}
          urls.push(url);
          const image=document.createElement('img');image.src=url;image.alt='';
          image.addEventListener('error',()=>{const index=urls.indexOf(url);if(index>=0){revokeUrl(url);urls.splice(index,1);}
            image.remove();if(current())unavailable();});
          slot.replaceChildren(image);
        }
      }catch{if(current())status.textContent='Image indisponible';}
    };
    if(Observer){observer=new Observer(entries=>{if(entries.some(item=>item.isIntersecting)){
      observer?.disconnect();void load();}},{rootMargin:'150px'});observer.observe(element);}
    else status.textContent='Aperçu indisponible dans cet hôte';
  };
  return Object.freeze({attach,clear});
}
