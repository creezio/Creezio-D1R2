import type {ConversationEvent} from '../../../../sdk/conversations/types.ts';
import type {ConversationProgressStep} from './panel.tsx';

const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:null;

/** Present bounded, known progress fields; arbitrary provider payloads never enter the view. */
export function projectTurnEvents(events:readonly ConversationEvent[]):{
  preview:string;steps:readonly ConversationProgressStep[];toolDiagnostics:string|null;
  cancelOutcomeUnknown:boolean}{
  let preview='',truncated=false,cancelOutcomeUnknown=false;const steps:ConversationProgressStep[]=[];
  const diagnosticLabels:Record<string,string>={invalid_catalog:'catalogue invalide',inactive:'inactifs',
    unsupported_schema:'schéma non compatible',invalid_schema:'schéma invalide',forbidden:'sans autorisation',
    collision:'noms en conflit',limit:'limite atteinte',unavailable:'indisponibles',other:'autres'};
  const diagnosticCounts=new Map<string,number>();
  for(const event of events){
    if(event.kind==='text_delta'){
      const value=object(event.payload)?.text;
      if(typeof value==='string'&&value.isWellFormed())preview=(preview+value).slice(0,16000);
      continue;
    }
    if(event.kind==='started'){
      const payload=object(event.payload);
      if(Array.isArray(payload?.toolDiagnostics))for(const raw of payload.toolDiagnostics){
        const item=object(raw),code=item?.code,count=item?.count;
        if(typeof code==='string'&&Object.hasOwn(diagnosticLabels,code)
          &&typeof count==='number'&&Number.isSafeInteger(count)&&count>0&&count<=1000)
          diagnosticCounts.set(code,Math.min(1000,(diagnosticCounts.get(code)??0)+count));
      }
      if(payload?.toolDiagnosticsTruncated===true)truncated=true;
    }
    if(event.kind==='unknown'&&object(event.payload)?.cancelRequested===true)
      cancelOutcomeUnknown=true;
    const known:Record<string,{label:string;state:ConversationProgressStep['state']}>= {
      queued:{label:'Tour en attente',state:'running'},
      running:{label:'Réponse en cours',state:'running'},
      started:{label:'Réponse du fournisseur démarrée',state:'done'},
      tool_call:{label:'Outil en cours',state:'running'},
      tool_result:{label:'Résultat de l’outil reçu',state:'done'},
      cancel_requested:{label:'Arrêt demandé',state:'running'},
      cancelled:{label:'Réponse arrêtée',state:'done'},
      completed:{label:'Réponse terminée',state:'done'},
      failed:{label:'Réponse échouée',state:'failed'},
      unknown:{label:'Résultat du fournisseur incertain',state:'failed'},
    };
    const step=known[event.kind];
    if(step)steps.push({id:String(event.sequence),...step});
  }
  const details=[...diagnosticCounts].map(([code,count])=>`${count} ${diagnosticLabels[code]}`);
  if(truncated)details.push('diagnostics limités');
  return {preview,steps:steps.slice(-12),toolDiagnostics:details.length
    ?`Outils non proposés : ${details.join(', ')}.`:null,cancelOutcomeUnknown};
}
