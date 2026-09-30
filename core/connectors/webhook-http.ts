import type {createOperationEngine} from '../operations/service.ts';
import type {WebhookProofAuthority} from './webhook-proof.ts';
import type {WebhookCommitGuard} from './webhook-proof.ts';
import {parseWebhookJson,readWebhookBody,verifyStandardWebhook,verifyStripeWebhook,
  webhookBodyDigest} from './webhooks.ts';

export interface SignedWebhookBinding {
  readonly moduleId:string;readonly operationId:string;readonly audience:'admin'|'app';
  readonly auth:readonly string[];readonly path?:string;
}
export interface SignedWebhookConfiguration {
  readonly scheme:'stripe'|'standard'|'resend';readonly contextId:string;
  readonly serviceToken:string;readonly secrets:readonly string[];
  readonly guards:readonly WebhookCommitGuard[];
  /** Converts a verified provider event into the declared operation schema. */
  readonly map:(event:Record<string,unknown>,eventId:string,bodyDigest:string)=>unknown;
}
export function createSignedWebhookBridge(options:Readonly<{
  engine:Pick<ReturnType<typeof createOperationEngine>,'invoke'>;
  proof:WebhookProofAuthority;
  resolve:(binding:SignedWebhookBinding)=>Promise<SignedWebhookConfiguration|null>;
}>){
  return Object.freeze({async dispatch(request:Request,binding:SignedWebhookBinding):Promise<Response>{
    if(request.method!=='POST')return new Response(null,{status:405,headers:{allow:'POST'}});
    if(!binding.auth.includes('webhook-signature')||request.headers.has('authorization')
      ||new URL(request.url).search||!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type')??''))
      return new Response(null,{status:400});
    const configuration=await options.resolve(binding);
    if(!configuration||!configuration.contextId||!configuration.serviceToken
      ||configuration.secrets.length<1)return new Response(null,{status:503});
    const body=await readWebhookBody(request);
    if(!body)return new Response(null,{status:400});
    const event=parseWebhookJson(body);
    if(!event)return new Response(null,{status:400});
    const eventId=configuration.scheme==='stripe'?event.id:request.headers.get(
      configuration.scheme==='resend'?'svix-id':'webhook-id');
    if(typeof eventId!=='string'||!(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(eventId)))
      return new Response(null,{status:400});
    const valid=configuration.scheme==='stripe'
      ?await verifyStripeWebhook({body,signature:request.headers.get('stripe-signature'),
        secrets:configuration.secrets})
      :await verifyStandardWebhook({body,id:eventId,
        timestamp:request.headers.get(configuration.scheme==='resend'?'svix-timestamp':'webhook-timestamp'),
        signature:request.headers.get(configuration.scheme==='resend'?'svix-signature':'webhook-signature'),
        secrets:configuration.secrets});
    if(!valid)return new Response(null,{status:401});
    const bodyDigest=await webhookBodyDigest(body);
    let input:unknown;
    try{input=configuration.map(event,eventId,bodyDigest);}catch{return new Response(null,{status:400});}
    const proof=await options.proof.issue({moduleId:binding.moduleId,operationId:binding.operationId,
      contextId:configuration.contextId,audience:binding.audience,token:configuration.serviceToken,
      eventId,bodyDigest,guards:configuration.guards,operationInput:input});
    try{
      const result=await options.engine.invoke({credential:{kind:'api-token',token:configuration.serviceToken},
        moduleId:binding.moduleId,operationId:binding.operationId,contextId:configuration.contextId,
        audience:binding.audience,input,webhookProof:proof});
      return new Response(null,{status:result.execution.state==='succeeded'?204:503});
    }catch{return new Response(null,{status:503});}
  }});
}
export type SignedWebhookBridge=ReturnType<typeof createSignedWebhookBridge>;
