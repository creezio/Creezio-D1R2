import {App,PostMessageTransport} from '@modelcontextprotocol/ext-apps';

type Kind='summary'|'events';
type Row=Record<string,unknown>;
const record=(v:unknown):v is Row=>!!v&&typeof v==='object'&&!Array.isArray(v);
const elem=(id:string)=>document.getElementById(id);
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max;
const node=(tag:string,className:string,value:string)=>{const e=document.createElement(tag);
  e.className=className;e.textContent=value;return e;};
const unwrap=(v:unknown):unknown=>record(v)&&v.kind==='creezio.widget.render.v1'?v.input:
  record(v)&&v.kind==='creezio.widget.action.v1'&&v.state==='succeeded'?v.output:v;
const output=(v:unknown):unknown=>record(v)&&Object.hasOwn(v,'structuredContent')?unwrap(v.structuredContent):unwrap(v);
const count=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0?String(v):'—';
const eventOrigin=(value:Row):Row|null=>{
  if(!['day','week','month','year'].includes(String(value.period))||
    !(value.query===undefined||text(value.query,120))||
    !(value.type===undefined||['page_view','click','activity','error'].includes(String(value.type)))||
    !(value.principalId===undefined||text(value.principalId,128)))return null;
  return {period:value.period,...(value.query===undefined?{}:{query:value.query}),
    ...(value.type===undefined?{}:{type:value.type}),
    ...(value.principalId===undefined?{}:{principalId:value.principalId})};
};
const svgNode=(tag:string,attributes:Record<string,string>)=>{
  const element=document.createElementNS('http://www.w3.org/2000/svg',tag);
  for(const [name,value] of Object.entries(attributes))element.setAttribute(name,value);
  return element;
};
function page(v:unknown,kind:Kind):Row|null{
  const value=output(v);
  if(!record(value)||!record(value.period)||value.period.period!=='week'&&kind==='summary'||
    !['day','week','month','year'].includes(String(value.period.period))||
    !text(value.period.from,35)||!text(value.period.to,35)||
    !Number.isSafeInteger(value.scanned)||Number(value.scanned)<0||Number(value.scanned)>500||
    typeof value.complete!=='boolean'||!(value.nextCursor===null||text(value.nextCursor,2048)))return null;
  if(kind==='summary'){
    if(value.source!=='reported'||!record(value.totals)||!Array.isArray(value.timeline)||
      value.timeline.length>8||value.timeline.some(item=>!record(item)||!text(item.name,35)||
      count(item.count)==='—'))return null;
    for(const key of ['events','pageViews','clicks','errors','reportedDurationMs'])
      if(count(value.totals[key])==='—')return null;
    if(count(value.activePrincipals)==='—')return null;
  }else{
    if(!Array.isArray(value.items)||value.items.length>5||value.items.some(item=>!record(item)||
      !text(item.id,36)||!text(item.surface,64)||
      !text(item.occurredAt,35)||!['page_view','click','activity','error'].includes(String(item.type))||
      !(item.path===null||text(item.path,256))||
      !(item.actionId===null||text(item.actionId,80))||
      !(item.errorCode===null||text(item.errorCode,80))))return null;
  }
  return value;
}

/** No operation is dispatched by mounting, connecting, or receiving a tool result. */
export async function mountAnalyticsWidget(kind:Kind):Promise<void>{
  const root=elem('analytics-widget');if(!root)return;
  const app=new App({name:`Creezio Analytics ${kind}`,version:'0.1.0'},{});
  let tools=false,busy=false,serial=0,interactive=false,current:Row|null=null;
  let origin:Row|null=kind==='summary'?{}:null;
  const status=(message:string)=>{const target=elem('status');if(target)target.textContent=message;};
  const controls=()=>{for(const id of ['refresh','more']){
    const button=elem(id) as HTMLButtonElement|null;
    if(button)button.disabled=!tools||busy||(id==='more'&&(!current?.nextCursor||!origin));
  }};
  const render=()=>{
    const target=elem('result');if(!target)return;target.replaceChildren();
    if(!current){target.appendChild(node('p','analytics-empty','Aucune lecture pour cette page.'));controls();return;}
    const bounds=current.period as Row;
    target.appendChild(node('p','analytics-period',`${String(bounds.period)} · événements déclarés`));
    if(kind==='events'&&origin){
      const filters=[origin.query?'recherche appliquée':null,origin.type?'type filtré':null,
        origin.principalId?'émetteur filtré':null].filter(Boolean);
      if(filters.length)target.appendChild(node('p','analytics-period',filters.join(' · ')));
    }
    if(kind==='summary'){
      target.appendChild(node('h3','analytics-title','Totaux du segment'));
      const totals=current.totals as Row;
      const cards=node('div','analytics-cards','');
      for(const [key,label] of [['events','Événements'],['pageViews','Pages vues'],['clicks','Clics'],
        ['errors','Erreurs'],['activePrincipals','Émetteurs déclarés']] as const){
        const card=node('section','analytics-card','');
        card.appendChild(node('small','analytics-label',label));
        card.appendChild(node('strong','analytics-value',
          count(key==='activePrincipals'?current.activePrincipals:totals[key])));cards.appendChild(card);
      }
      target.appendChild(cards);
      const points=current.timeline as Row[];
      if(points.length){
        const maximum=Math.max(1,...points.map(item=>Number(item.count)));
        const coordinates=points.map((item,index)=>({name:String(item.name),value:Number(item.count),
          x:points.length===1?300:32+index*536/(points.length-1),
          y:208-Number(item.count)/maximum*172}));
        const graph=node('div','analytics-chart','');
        graph.setAttribute('role','img');
        graph.setAttribute('aria-label','Évolution des événements déclarés sur ce segment');
        const svg=svgNode('svg',{viewBox:'0 0 600 240',preserveAspectRatio:'none','aria-hidden':'true'});
        for(const y of [36,122,208])svg.appendChild(svgNode('line',
          {x1:'32',x2:'568',y1:String(y),y2:String(y),stroke:'#e2e8f0','stroke-dasharray':'3 3'}));
        svg.appendChild(svgNode('polyline',{points:coordinates.map(({x,y})=>`${x},${y}`).join(' '),
          fill:'none',stroke:'#0ea5e9','stroke-width':'2'}));
        for(const point of coordinates){const dot=svgNode('circle',
          {cx:String(point.x),cy:String(point.y),r:'3',fill:'#0ea5e9'});
          dot.appendChild(svgNode('title',{})).textContent=`${point.name} : ${count(point.value)} événements`;
          svg.appendChild(dot);}
        graph.appendChild(svg);
        graph.appendChild(node('p','analytics-period',
          `${coordinates[0].name} — ${coordinates[coordinates.length-1].name}`));
        target.appendChild(graph);
      }else target.appendChild(node('p','analytics-empty','Aucun événement déclaré sur ce segment.'));
    }else{
      for(const item of current.items as Row[]){
        const row=node('article','analytics-row','');
        row.appendChild(node('strong','analytics-type',String(item.type)));
        row.appendChild(node('span','analytics-date',String(item.occurredAt)));
        row.appendChild(node('p','analytics-surface',
          `${String(item.surface)} · ${String(item.path??item.actionId??'')}`));
        target.appendChild(row);
      }
      if(!(current.items as Row[]).length)target.appendChild(node('p','analytics-empty','Aucun événement déclaré sur cette page.'));
    }
    target.appendChild(node('p','analytics-partial',
      `Segment : ${count(current.scanned)} événement(s) examinés. ${current.complete?'Fin de cette fenêtre.':
        origin?'Suite disponible si le curseur est fourni.':
          'Pour lire la suite, relancez cette liste avec ses filtres.'}`));
    controls();
  };
  app.addEventListener('toolinput',event=>{
    if(interactive||!record(event)||!record(event.arguments))return;
    const input=event.arguments;
    if(kind==='summary')origin={};
    else{
      origin=eventOrigin(input);
      if(origin){
        const period=elem('period') as HTMLSelectElement|null;
        const query=elem('query') as HTMLInputElement|null;
        if(period)period.value=String(origin.period);
        if(query)query.value=String(origin.query??'');
      }
    }
    current=null;render();
  });
  app.addEventListener('toolresult',event=>{
    if(interactive)return;const parsed=page(event,kind);
    if(parsed){current=parsed;render();}else status('Résultat indisponible ou trop volumineux.');
  });
  render();
  try{await app.connect(new PostMessageTransport(window.parent,window.parent));}
  catch{status('Pont MCP indisponible ; résultat en lecture seule.');return;}
  tools=!!app.getHostCapabilities()?.serverTools;controls();
  status(tools?'Lectures disponibles sur demande.':'Outils directs indisponibles ; résultat en lecture seule.');
  async function read(more:boolean){
    if(!tools||busy||more&&(!current?.nextCursor||!origin))return;
    const input:Row={...(origin??{})};
    if(kind==='events'&&!more){
      const period=elem('period') as HTMLSelectElement|null;
      const query=elem('query') as HTMLInputElement|null;
      if(period&&['day','week','month','year'].includes(period.value))input.period=period.value;
      if(query){if(query.value.length>120){status('Recherche trop longue.');return;}
        if(query.value.trim())input.query=query.value.trim();else delete input.query;}
    }
    if(more)input.cursor=current?.nextCursor;else delete input.cursor;
    const token=++serial;interactive=true;busy=true;controls();
    try{const response=await app.callServerTool({name:`analytics_analytics_widget_${kind}`,arguments:input});
      if(token!==serial||!root?.isConnected)return;
      const parsed=page(response,kind);
      if(!parsed||more&&parsed.nextCursor===current?.nextCursor){
        status('Page refusée, trop volumineuse ou curseur inchangé.');return;}
      current=parsed;origin={...input};delete origin.cursor;render();status('Segment chargé.');
    }catch{if(token===serial&&root?.isConnected)status('Lecture indisponible ou refusée.');}
    finally{if(token===serial){busy=false;controls();}}
  }
  elem('refresh')?.addEventListener('click',()=>void read(false));
  elem('more')?.addEventListener('click',()=>void read(true));
}
export const startSummary=()=>mountAnalyticsWidget('summary');
export const startEvents=()=>mountAnalyticsWidget('events');
