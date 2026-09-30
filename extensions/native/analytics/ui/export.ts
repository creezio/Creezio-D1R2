import type {ExportPage,Period} from './contracts.ts';

/** A browser export is bounded to ten authorized 50-row reads. Every continuation
 * carries the server's frozen period and filters; no private storage is queried. */
export async function collectExportPages(input:{period:Period;format:'csv'|'json';
  fetch:(cursor?:string)=>Promise<ExportPage>;isCurrent:()=>boolean}){
  const visited=new Set<string>(),parts:string[]=[],objects:unknown[]=[];
  let cursor:string|undefined,anchor:string|undefined,csvHeader:string|undefined,complete=false,pages=0;
  for(;pages<10;pages++){
    if(!input.isCurrent())throw new Error('stale');
    const page=await input.fetch(cursor);
    if(!input.isCurrent())throw new Error('stale');
    if(page.format!==input.format||page.period.period!==input.period)throw new Error('invalid_export');
    const bound=JSON.stringify(page.period);
    if(anchor!==undefined&&anchor!==bound)throw new Error('invalid_export');
    anchor=bound;
    if(input.format==='json'){
      const parsed:unknown=JSON.parse(page.content);
      if(!Array.isArray(parsed)||parsed.length>50)throw new Error('invalid_export');
      objects.push(...parsed);
    }else{
      const end=page.content.indexOf('\n');
      const header=end<0?page.content:page.content.slice(0,end);
      if(!header.startsWith('"id","principalId"'))throw new Error('invalid_export');
      if(csvHeader!==undefined&&csvHeader!==header)throw new Error('invalid_export');
      csvHeader=header;
      if(end>=0&&page.content.slice(end+1))parts.push(page.content.slice(end+1));
    }
    if(page.complete||!page.nextCursor){complete=page.complete;pages++;break;}
    if(visited.has(page.nextCursor))throw new Error('invalid_export');
    visited.add(page.nextCursor);cursor=page.nextCursor;
  }
  const content=input.format==='json'?JSON.stringify(objects):[csvHeader??'',...parts].join('\n');
  if(new TextEncoder().encode(content).length>2_000_000)throw new Error('export_too_large');
  return {content,complete,pages,nextCursor:complete?null:cursor??null};
}
