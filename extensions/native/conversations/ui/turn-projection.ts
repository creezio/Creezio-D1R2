import type {ConversationEvent} from '../../../../sdk/conversations/types.ts';
import type {ConversationProgressStep} from './panel.tsx';

const object=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)
  ?value as Record<string,unknown>:null;

/** Present bounded, known progress fields; arbitrary provider payloads never enter the view. */
export function projectTurnEvents(events:readonly ConversationEvent[]):{
  preview:string;steps:readonly ConversationProgressStep[]}{
  let preview='';const steps:ConversationProgressStep[]=[];
  for(const event of events){
    if(event.kind==='text_delta'){
      const value=object(event.payload)?.text;
      if(typeof value==='string'&&value.isWellFormed())preview=(preview+value).slice(0,16000);
      continue;
    }
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
  return {preview,steps:steps.slice(-12)};
}
