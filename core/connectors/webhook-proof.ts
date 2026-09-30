import {operationDigest} from '../operations/digest.ts';
import {copyJson} from '../data/input.ts';
import type {DataRecord} from '../data/types.ts';
import type {OperationRequest} from '../operations/service.ts';

export interface WebhookCommitGuard {
  readonly moduleId:string;
  readonly modelId:string;
  readonly key:DataRecord;
  readonly where:DataRecord;
  readonly fields:readonly string[];
}
type Bound=Readonly<{moduleId:string;operationId:string;contextId:string;audience:'admin'|'app';
  token:string;eventId:string;bodyDigest:string;inputDigest:string;
  guards:readonly WebhookCommitGuard[]}>;
/** A proof is consumed exactly once, before the operation claim, and cannot be copied through JSON. */
export function createWebhookProofAuthority(){
  const pending=new WeakMap<object,Bound>();
  return Object.freeze({
    async issue(input:Omit<Bound,'inputDigest'> & {readonly operationInput:unknown}):Promise<object>{
      const {operationInput,...binding}=input;
      const proof=Object.freeze(Object.create(null) as object);
      pending.set(proof,Object.freeze({...binding,
        inputDigest:await operationDigest(copyJson(operationInput))}));
      return proof;
    },
    async consume(proof:object,request:OperationRequest):Promise<readonly WebhookCommitGuard[]|null>{
      const binding=pending.get(proof);
      pending.delete(proof);
      if(!binding||request.credential.kind!=='api-token'||request.credential.token!==binding.token
        ||request.moduleId!==binding.moduleId||request.operationId!==binding.operationId
        ||request.contextId!==binding.contextId||request.audience!==binding.audience
        ||!request.input||typeof request.input!=='object'||Array.isArray(request.input))return null;
      const input=request.input as Record<string,unknown>;
      return input.requestKey===binding.eventId&&input.eventId===binding.eventId
        &&input.bodyDigest===binding.bodyDigest
        &&await operationDigest(copyJson(request.input))===binding.inputDigest?binding.guards:null;
    }
  });
}
export type WebhookProofAuthority=ReturnType<typeof createWebhookProofAuthority>;
