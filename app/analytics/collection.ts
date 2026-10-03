export type AnalyticsRoute={readonly viewId:string;readonly route:string};
export interface CollectionClient {invoke(input:{bindingId:string;contextId:string;
  input:Record<string,unknown>;isCurrent:()=>boolean}):Promise<unknown>}
const stableId=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u;
const safeRoute=/^\/[A-Za-z0-9/._:{}-]*$/u;
const safe=(value:AnalyticsRoute|null):value is AnalyticsRoute=>!!value
  &&stableId.test(value.viewId)&&value.route.length<=256&&safeRoute.test(value.route)
  &&!value.route.includes('//');

/** The browser submits only catalog route templates and explicit component IDs.
 * It never reads labels, text, hrefs, query strings or attributes beyond the one opt-in ID. */
export function startAnalyticsCollection(input:{client:CollectionClient;contextId:string;
  audience:'admin'|'app';surface:'workspace'|'front';target:Document}){
  let live=true,generation=0,policy:{navigation:boolean;clicks:boolean}={navigation:false,clicks:false};
  let route:AnalyticsRoute|null=null,lastPage='';
  const invoke=(operation:string,payload:Record<string,unknown>)=>input.client.invoke({
    bindingId:`creezio.analytics:${input.audience}.${operation}`,contextId:input.contextId,
    input:payload,isCurrent:()=>live});
  const emit=(type:'page_view'|'click',actionId?:string)=>{
    if(!live||!safe(route))return;
    void invoke('event.record',{requestKey:crypto.randomUUID(),type,surface:input.surface,
      path:route.route,...(actionId?{actionId}:{})}).catch(()=>{});
  };
  const recordPage=()=>{
    if(!policy.navigation||!safe(route)||lastPage===route.viewId)return;
    lastPage=route.viewId;emit('page_view');
  };
  const click=(event:Event)=>{
    if(!live||!policy.clicks||!safe(route)||!(event.target instanceof Element))return;
    const element=event.target.closest('[data-creezio-analytics-id]');
    if(!element||!input.target.contains?.(element))return;
    const id=element.getAttribute('data-creezio-analytics-id');
    if(id&&stableId.test(id))emit('click',id);
  };
  input.target.addEventListener('click',click,true);
  return Object.freeze({
    async refresh(){
      if(!live)return;
      const current=++generation;policy={navigation:false,clicks:false};
      try{const result=await invoke('collection.effective',{});
        if(!live||generation!==current)return;
        const r=result as {kind?:string;execution?:{state?:string;output?:unknown}};
        const value=r.kind==='execution'&&r.execution?.state==='succeeded'?r.execution.output:null;
        if(!value||typeof value!=='object'||Array.isArray(value)){lastPage='';return;}
        const flags=value as Record<string,unknown>;
        if(typeof flags.navigation!=='boolean'||typeof flags.clicks!=='boolean'){lastPage='';return;}
        policy={navigation:flags.navigation,clicks:flags.clicks};
        if(!policy.navigation)lastPage='';else recordPage();
      }catch{if(generation===current){policy={navigation:false,clicks:false};lastPage='';}}
    },
    location(value:AnalyticsRoute|null){route=safe(value)?value:null;
      generation++;policy={navigation:false,clicks:false};if(!route)lastPage='';},
    dispose(){live=false;generation++;input.target.removeEventListener('click',click,true);},
  });
}
