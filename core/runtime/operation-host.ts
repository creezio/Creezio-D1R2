import {createOperationEngine} from '../operations/service.ts';
import {OperationError} from '../operations/types.ts';
import {createOpenAiProviderHost,readProviderKeyring} from '../providers/host.ts';
import {createWidgetApprovalService} from '../widgets/approval.ts';
import type {FileBucket} from '../files/service.ts';
import type {RuntimeFileCatalog} from '../files/catalog.ts';
import type {RuntimeEnvironment} from './environment.ts';
import type {ConnectorDescriptor} from '../../sdk/connectors/types.ts';

type EngineOptions=Parameters<typeof createOperationEngine>[0];
type ProviderOptions=Parameters<typeof createOpenAiProviderHost>[0];
type Engine=ReturnType<typeof createOperationEngine>;
export type RuntimeOperationHostOptions=Omit<EngineOptions,
  'db'|'authorityDb'|'storageRoute'|'storageMutation'|'files'|'connectors'|'approvals'|'providerAvailability'|'providerSecrets'> & {
  readonly fileCatalog?:RuntimeFileCatalog;
  readonly connectors?:readonly ConnectorDescriptor[];
  readonly openAiProvider?:Pick<ProviderOptions,'config'|'vault'|'transport'>;
};

/** Request-local factories share one execution implementation on every hosting profile.
 * Selecting a binding is not authorization: each service still resolves native identity
 * on the authority D1 and validates its target lease before reading or committing data.
 */
export function createRuntimeOperationHost(options:RuntimeOperationHostOptions,
  environment:RuntimeEnvironment,rawEnvironment:unknown){
  let keyring:ReturnType<typeof readProviderKeyring>=null;
  try{keyring=readProviderKeyring(rawEnvironment);}catch{/* Invalid host configuration disables providers. */}
  const cache=new Map<string,ReturnType<typeof createContext>>();
  function createContext(contextId:string){
    if(typeof contextId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(contextId))
      throw new OperationError('forbidden');
    let selection;
    try{selection=environment.storageAuthority?.forContext(contextId);}
    catch{throw new OperationError('forbidden');}
    if(environment.storage&&!environment.storageAuthority)throw new OperationError('unavailable');
    const db=selection?.db??environment.bindings.DB;
    const bucket=(selection?.bucket??environment.bindings.BUCKET) as unknown as FileBucket;
    const authority=selection?.storageRoute
      ?{authorityDb:selection.authorityDb,storageRoute:selection.storageRoute}:{};
    const shared={db,catalog:options.catalog,permissions:options.permissions,...authority};
    const provider=options.openAiProvider
      ?createOpenAiProviderHost({...shared,...options.openAiProvider,keyring}):null;
    const approvals=createWidgetApprovalService({...shared,registry:options.registry});
    const {fileCatalog,connectors,openAiProvider,...execution}=options;
    const engine=createOperationEngine({...execution,...shared,approvals,
      ...(environment.storageAuthority?.storageMutation
        ?{storageMutation:environment.storageAuthority.storageMutation}:{}),
      connectors:(connectors??[]).map(descriptor=>({descriptor,keyring})),
      ...(fileCatalog?{files:{catalog:fileCatalog,bucket}}:{}),
      ...(provider?{providerAvailability:async(request,providerId)=>providerId==='openai.responses.v1'
        ?provider.availability(request):{providerId,state:'missing' as const,modelIds:[]}}:{}),
      ...(openAiProvider&&keyring?{providerSecrets:{storage:openAiProvider.vault,keyring,
        providerId:'openai.responses.v1'}}:{})});
    return Object.freeze({...shared,bucket,provider,approvals,engine});
  }
  function forContext(contextId:string){
    let context=cache.get(contextId);
    if(!context){context=createContext(contextId);cache.set(contextId,context);}
    return context;
  }
  const engine=Object.freeze<Engine>({
    invoke:request=>forContext(request.contextId).engine.invoke(request),
    status:request=>forContext(request.contextId).engine.status(request),
    lookup:request=>forContext(request.contextId).engine.lookup(request),
    deliver:request=>forContext(request.contextId).engine.deliver(request),
    deliveryStatus:request=>forContext(request.contextId).engine.deliveryStatus(request),
  });
  const approvals=Object.freeze<ReturnType<typeof createWidgetApprovalService>>({
    request:input=>forContext(input.contextId).approvals.request(input),
    resolveApproved:input=>forContext(input.contextId).approvals.resolveApproved(input),
    preview:input=>forContext(input.contextId).approvals.preview(input),
    decide:input=>forContext(input.contextId).approvals.decide(input),
    prepareConsumption:input=>forContext(input.identity.contextId).approvals.prepareConsumption(input),
  });
  return Object.freeze({forContext,engine,approvals,keyring});
}
