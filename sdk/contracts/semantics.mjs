import semver from 'semver';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { walk, walkContracts, safePackagePath, contractIndex, collectReferences, refKey, isContractRef } from './references.mjs';

const authActors = { session:'user', 'api-token':'machine', oauth:'delegated-user', impersonation:'impersonated-user', anonymous:'anonymous', 'webhook-signature':'signed-webhook' };
const subset = (small, large) => small.every(value => large.includes(value));
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const contractIntegrity = value => `sha256-${bytesToHex(sha256(new TextEncoder().encode(canonicalJson(value))))}`;
const routeKey = route => route.replace(/\{[^}]+\}/g, '{}').replace(/\/$/, '') || '/';

function unique(items, path, report, key = item => typeof item === 'object' ? item.id : item) {
  const seen = new Set();
  items.forEach((item, i) => { const id = key(item); if (seen.has(id)) report('duplicate.id', `${path}/${i}`, 'A contract identifier must be unique within its collection.'); seen.add(id); });
}
function version(value, path, report, range = false) {
  if (!(range ? semver.validRange(value) : semver.valid(value))) report('version.invalid', path, range ? 'Invalid semantic version range.' : 'Invalid semantic version.');
}

export function checkModule(module, report) {
  const { index, references } = collectReferences(module, report), c = module.contracts, ownId = module.identity.id;
  const get = (ref, expectedKind) => ref?.moduleId === ownId && (!expectedKind || ref.kind === expectedKind) ? index.get(ref.kind)?.get(ref.id) : undefined;
  const needKind = (ref, kinds, path) => { if (!kinds.includes(ref.kind)) report('ref.kind', path, 'Reference targets an incompatible contract kind.'); };
  const fieldsOf = ref => get(ref)?.fields?.map(field => field.id) ?? [];
  const schema = ref => index.get('schema').get(ref?.schemaId)?.schema;
  const requireInputFields = (ref, fields, path, required=false) => {
    const definition = schema(ref);
    if (definition?.type !== 'object' || fields.some(field => !Object.hasOwn(definition.properties ?? {}, field))) report('schema.field', path, 'Declared input fields must exist in an object schema.');
    else if(required && fields.some(field=>!(definition.required??[]).includes(field)))report('schema.field-required',path,'Fields required by the operation guarantee must also be required by its input schema.');
  };
  for (const [section,value] of Object.entries(c)) if (section !== 'schemas') walkContracts(value, (node, path) => {
    if (Array.isArray(node) && node.length && node.every(item => item && typeof item === 'object' && typeof item.id === 'string')) unique(node, path, report, item => isContractRef(item)?refKey(item):item.id);
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    const expected={operation:'operation',badgeOperation:'operation',rebuildOperation:'operation',deleteOperation:'operation',diagnoseOperation:'operation',resumeOperation:'operation',cancelOperation:'operation',callback:'operation',metadataModel:'model',model:'model',view:'view',widget:'widget'};
    for (const [key,kind] of Object.entries(expected)) if (node[key]?.moduleId) needKind(node[key],[kind],`${path}/${key}`);
    for (const key of ['permissions','emits','invalidatedBy','calls']) if (Array.isArray(node[key])) for (const ref of node[key]) needKind(ref,[key==='permissions'?'permission':key==='calls'?'operation':'event'],`${path}/${key}`);
  }, `/contracts/${section}`);
  unique(module.dependencies, '/dependencies', report, item => item.moduleId);
  version(module.identity.version, '/identity/version', report);
  version(module.compatibility.sdk, '/compatibility/sdk', report, true); version(module.compatibility.core, '/compatibility/core', report, true);
  if(module.entrypoints.publicPage){
    const entry=module.entrypoints.publicPage,path='/entrypoints/publicPage';
    if(!semver.validRange(module.compatibility.sdk)||!semver.subset(module.compatibility.sdk,'>=1.6.0'))
      report('public-page.sdk',path,'Public page projections require SDK 1.6 or later.');
    for(const [name,reference] of Object.entries(entry.models)){
      const model=get(reference,'model');
      if(!model||model.scope!=='context'||model.contextField!=='context_id'||model.public)
        report('public-page.model',`${path}/models/${name}`,'Public page references must name private, context-scoped models of this module.');
    }
  }
  for (const [i, dep] of module.dependencies.entries()) {
    version(dep.versionRange, `/dependencies/${i}/versionRange`, report, true);
    if (dep.moduleId === ownId) report('dependency.cycle', `/dependencies/${i}`, 'A module cannot depend on itself.');
    if (!dep.optional && dep.whenAbsent !== 'block') report('dependency.policy', `/dependencies/${i}`, 'A required dependency must block when absent.');
    if (dep.optional && dep.whenAbsent !== 'disable-contributions') report('dependency.policy', `/dependencies/${i}`, 'An optional dependency must preserve the autonomous module and remove its guarded contributions.');
    unique(dep.contracts, `/dependencies/${i}/contracts`, report);
    dep.contracts.forEach((port, j) => version(port.versionRange, `/dependencies/${i}/contracts/${j}/versionRange`, report, true));
  }
  for (const kind of ['models','files','widgets']) {
    if (!c[kind].length && !module.lifecycle.absent[kind]) report('contract.absence', `/lifecycle/absent/${kind}`, 'An absent capability requires an explicit policy justification.');
    if (c[kind].length && module.lifecycle.absent[kind]) report('contract.absence', `/lifecycle/absent/${kind}`, 'A present capability cannot be declared absent.');
  }
  for(const contribution of contributionEntries(module)){
    unique(contribution.entry.requiresModules??[],`${contribution.path}/requiresModules`,report);
    for(const id of contribution.entry.requiresModules??[])if(!module.dependencies.some(dep=>dep.moduleId===id&&dep.optional&&dep.whenAbsent==='disable-contributions'))report('dependency.guard',`${contribution.path}/requiresModules`,'A contribution guard must name an optional dependency with explicit removal when absent.');
  }
  (c.deliveries??[]).forEach((delivery,i)=>{
    const p=`/contracts/deliveries/${i}`;
    for(const key of ['command','prepare']){
      const ref=delivery[key],operation=get(ref,'operation');
      needKind(ref,['operation'],`${p}/${key}`);
      if(ref.moduleId!==ownId||!operation||operation.kind!==(key==='command'?'command':'query'))
        report('delivery.operation',`${p}/${key}`,'Delivery command and preparation query must belong to the declaring module.');
      if(operation?.public)report('delivery.operation',`${p}/${key}`,'Delivery operations must use native authorization, not public anonymous access.');
    }
    if(!delivery.command||!delivery.prepare||delivery.command.id===delivery.prepare.id)
      report('delivery.operation',p,'Delivery command and preparation query must be distinct.');
    needKind(delivery.provider.publicContract,['publicContract'],`${p}/provider/publicContract`);
    needKind(delivery.provider.readiness,['operation'],`${p}/provider/readiness`);
    if(delivery.provider.publicContract.moduleId===ownId
      ||delivery.provider.readiness.moduleId!==delivery.provider.publicContract.moduleId)
      report('delivery.provider',`${p}/provider`,'A delivery must consume one external provider contract.');
    const providerDependency=module.dependencies.find(item=>item.moduleId===delivery.provider.publicContract.moduleId);
    if(providerDependency?.optional&&!delivery.requiresModules?.includes(providerDependency.moduleId))
      report('dependency.guard',`${p}/requiresModules`,'An optional delivery provider must guard the entire contribution.');
    unique(delivery.models,`${p}/models`,report,refKey);
    for(const [j,ref] of delivery.models.entries()){
      needKind(ref,['model'],`${p}/models/${j}`);
      if(ref.moduleId!==ownId||!get(ref,'model')||get(ref,'model')?.public)
        report('delivery.model',`${p}/models/${j}`,'A delivery projector may use only own private models.');
    }
    const command=get(delivery.command,'operation'),prepare=get(delivery.prepare,'operation');
    if(command&&(!command.effects.providers.includes(delivery.provider.connectorId)
      ||!command.effects.calls.some(ref=>refKey(ref)===refKey(delivery.provider.readiness))))
      report('delivery.command',`${p}/command`,'The command must declare its provider and readiness query effects.');
    if(prepare&&(!prepare.effects.reads.every(ref=>delivery.models.some(model=>refKey(model)===refKey(ref)))
      ||prepare.effects.writes.length||prepare.effects.calls.length||prepare.effects.providers.length))
      report('delivery.prepare',`${p}/prepare`,'Preparation must be a read-only own-model query.');
    if(!Object.values(delivery.prepareInput).includes('$intentId')
      ||delivery.matchFields.some(field=>field===delivery.envelopeField))
      report('delivery.prepare',`${p}/prepareInput`,'Preparation must bind the durable intent ID and keep envelope separate from matched fields.');
    if(!Object.values(delivery.projectorInput).includes('$intentId')
      ||!Object.values(delivery.projectorInput).includes('$receipt'))
      report('delivery.projector',`${p}/projectorInput`,'The projector must receive the durable intent ID and normalized receipt.');
    if(prepare){
      requireInputFields(prepare.input,Object.keys(delivery.prepareInput),`${p}/prepareInput`,true);
      const output=schema(prepare.output);
      if(output?.type!=='object'||output.properties?.intentId?.type!=='string'
        ||!(output.required??[]).includes('intentId')
        ||[delivery.envelopeField,...delivery.matchFields].some(field=>
        !Object.hasOwn(output.properties??{},field)||!(output.required??[]).includes(field)))
        report('delivery.prepare',`${p}/prepare`,'Preparation output must require the string intent ID, envelope and every matched durable field.');
      const revisionField=delivery.provider.configRevisionField;
      if(!delivery.matchFields.includes(revisionField)
        ||output?.properties?.[revisionField]?.type!=='integer'
        ||!(output.required??[]).includes(revisionField))
        report('delivery.prepare',`${p}/provider/configRevisionField`,'The provider configuration revision must be a required integer matched against the durable intent.');
    }
    if(!c.schemas.some(item=>item.id===delivery.receipt.schemaId))
      report('delivery.receipt',`${p}/receipt`,'The receipt schema must belong to the declaring module.');
  });
  unique((c.deliveries??[]).map(item=>item.command.id),'/contracts/deliveries',report);
  c.models.forEach((model, i) => {
    const p = `/contracts/models/${i}`, fields = new Map(model.fields.map(field => [field.id, field]));
    const checkFields = (values, location) => { unique(values, location, report); if (values.some(field => !fields.has(field))) report('model.field', location, 'Referenced model field does not exist.'); };
    checkFields(model.primaryKey, `${p}/primaryKey`);
    if (model.primaryKey.some(field => fields.get(field)?.nullable)) report('model.primary-key', `${p}/primaryKey`, 'Primary key fields cannot be nullable.');
    if (model.scope === 'context' && (!model.contextField || !fields.has(model.contextField) || fields.get(model.contextField)?.nullable)) report('model.context', p, 'Context-scoped models need a non-null context field.');
    if (model.scope === 'application' && model.contextField) report('model.context', p, 'Application-scoped models cannot declare a context field.');
    model.indexes.forEach((item, j) => checkFields(item.fields, `${p}/indexes/${j}/fields`));
    model.fields.forEach((field, j) => {
      const bounds = field.constraints;
      if (bounds && (bounds.minimum > bounds.maximum || bounds.minLength > bounds.maxLength)) report('model.constraints', `${p}/fields/${j}`, 'Field constraint bounds are contradictory.');
    });
    model.relations.forEach((relation, j) => {
      const rp = `${p}/relations/${j}`; checkFields(relation.fields, `${rp}/fields`); needKind(relation.target, ['model'], `${rp}/target`);
      if (relation.fields.length !== relation.targetFields.length) report('model.relation', rp, 'Relation field arity differs.');
      if (relation.onDelete === 'set-null' && relation.fields.some(field => fields.get(field)?.nullable === false)) report('model.relation', rp, 'Set-null requires nullable source fields.');
      if (relation.target.moduleId !== ownId && (!relation.via || relation.via.kind !== 'publicContract' || relation.via.moduleId !== relation.target.moduleId)) report('ref.private', rp, 'Cross-module relations must name the public contract they consume.');
      const target = get(relation.target,'model');
      if (target) checkRelation(model, relation, target, rp, report);
    });
  });
  c.files.forEach((file, i) => {
    const p = `/contracts/files/${i}`; needKind(file.metadataModel, ['model'], `${p}/metadataModel`);
    if(file.metadataModel.moduleId!==ownId)report('ref.private',`${p}/metadataModel`,'A file category must own its metadata storage model.');
    if (get(file.metadataModel,'model') && ![file.ownerField,file.contextField].every(field => fieldsOf(file.metadataModel).includes(field))) report('file.field', p, 'File owner and context fields must exist in its metadata model.');
    const model=get(file.metadataModel,'model'), mapping=file.storageFields;
    if(model && mapping){
      const fields=new Map(model.fields.map(field=>[field.id,field]));
      const names=[file.ownerField,file.contextField,...Object.values(mapping)];
      if(new Set(names).size!==names.length)report('file.mapping',p,'File storage columns must be distinct.');
      if(model.public || model.scope!=='context' || model.contextField!==file.contextField || !same(model.primaryKey,[file.contextField,mapping.id]))report('file.model',p,'File metadata must be private and keyed by context and file identifier.');
      for(const name of names){const field=fields.get(name);if(!field || field.nullable || !field.protected || field.computed)report('file.field',p,'File storage columns must exist and be protected, required and persisted.');}
      for(const [role,name] of Object.entries(mapping))if(fields.get(name)?.type!==(['byteSize','version'].includes(role)?'integer':'string'))report('file.type',`${p}/storageFields/${role}`,'File storage column type is incompatible.');
      for(const name of [file.ownerField,file.contextField])if(fields.get(name)?.type!=='string')report('file.type',p,'Owner and context columns must be strings.');
      if(!(fields.get(mapping.byteSize)?.constraints?.minimum>=0) || !(fields.get(mapping.version)?.constraints?.minimum>=1))report('file.bounds',p,'File size and version need nonnegative and positive bounds respectively.');
      const digest=fields.get(mapping.digest)?.constraints;
      if(digest?.minLength!==64 || digest?.maxLength!==64)report('file.bounds',p,'File digests need exactly 64 characters; the runtime validates hexadecimal content.');
      const states=fields.get(mapping.state)?.constraints?.enum;
      if(!Array.isArray(states) || !same([...states].sort(),['abandoned','available','deleted','staged','staging']))report('file.state',p,'File state must describe the complete publication and cleanup lifecycle.');
      for(const names of [[file.contextField,mapping.intentId,mapping.generation],[file.contextField,mapping.objectKey]])if(!model.indexes.some(index=>index.unique&&same(index.fields,names)))report('file.index',p,'File intent generations and object keys need explicit unique context indexes.');
      if(!file.permissions.length)report('file.permissions',p,'A file category requires explicit permissions.');
    }
    if(file.linkedRead){
      const policy=file.linkedRead, q=`${p}/linkedRead`;
      if(policy.mcpImage){
        const image=policy.mcpImage;
        if(!semver.validRange(module.compatibility.sdk)||!semver.subset(module.compatibility.sdk,'>=1.5.0'))
          report('file.linked-image-sdk',`${q}/mcpImage`,'Private widget image tools require SDK 1.5 or later.');
        if(!policy.audiences.includes('app')||file.maxBytes>2*1024*1024
          ||file.mimeTypes.some(type=>!['image/png','image/jpeg','image/webp'].includes(type)))
          report('file.linked-image',`${q}/mcpImage`,'Private widget images require app linked-read, a 2 MiB bound and approved image MIME types.');
        for(const widgetId of image.widgetIds){
          const widget=c.widgets.find(item=>item.id===widgetId);
          if(!widget||!widget.audiences.includes('app')
            ||!widget.permissions.some(ref=>refKey(ref)===refKey(policy.permission)))
            report('file.linked-image-widget',`${q}/mcpImage`,'Every private image widget must be app-exposed and declare the linked-read permission.');
        }
      }
      if(!semver.validRange(module.compatibility.sdk)||!semver.subset(module.compatibility.sdk,'>=1.3.0'))
        report('file.linked-sdk',q,'Linked file reads require SDK 1.3 or later.');
      needKind(policy.linkModel,['model'],`${q}/linkModel`);
      needKind(policy.permission,['permission'],`${q}/permission`);
      const link=get(policy.linkModel,'model'), permission=get(policy.permission,'permission');
      if(file.public||policy.linkModel.moduleId!==ownId||policy.permission.moduleId!==ownId
        ||!link||!permission){report('file.linked-owner',q,'Linked reads require a private category and own module models and permission.');return;}
      const relation=link.relations.find(item=>item.id===policy.parentRelation), parent=get(relation?.target,'model');
      if(!relation||!parent||relation.target.moduleId!==ownId||relation.target.kind!=='model'
        ||link.public||parent.public||link.scope!=='context'||parent.scope!=='context'
        ||relation.fields.length!==2||relation.targetFields.length!==2
        ||relation.fields[0]!==link.contextField||relation.targetFields[0]!==parent.contextField
        ||!same(parent.primaryKey,relation.targetFields)
        ||!same(link.primaryKey,[link.contextField,relation.fields[1],policy.referenceFields.fileId])){
        report('file.linked-relation',q,'Linked reads require an exact private context-scoped parent relation and composite link key.');return;
      }
      const names=[link.contextField,relation.fields[1],...Object.values(policy.referenceFields)];
      const fields=new Map(link.fields.map(field=>[field.id,field]));
      const stringField=field=>field&&field.type==='string'&&!field.nullable&&!field.computed;
      if(new Set(names).size!==names.length||names.some(name=>!stringField(fields.get(name)))
        ||!stringField(parent.fields.find(field=>field.id===relation.targetFields[1]))
        ||!model?.fields.every(field=>field.protected))
        report('file.linked-fields',q,'Linked identity and reference columns must be distinct required persisted strings.');
      const state=parent.fields.find(field=>field.id===policy.when.field);
      if(!stringField(state)||!state.constraints?.enum?.includes(policy.when.equals))
        report('file.linked-state',q,'The required parent state must be a declared string enum value.');
      const refs=[file.metadataModel,policy.linkModel,relation.target,{moduleId:ownId,kind:'file',id:file.id}];
      if(!permission.actions.includes('read')||!subset(policy.audiences,permission.audiences)
        ||permission.public||!refs.every(ref=>permission.resources.some(item=>refKey(item)===refKey(ref)))
        ||![model,link,parent].every(item=>item?.permissions.some(ref=>refKey(ref)===refKey(policy.permission))))
        report('file.linked-permission',q,'Linked readers require explicit read permission for the file, metadata, link and parent in every declared audience.');
    }
  });
  c.mcp.tools.forEach((tool,i)=>{
    if(tool.widgetCalls&&(!semver.validRange(module.compatibility.sdk)
      ||!semver.subset(module.compatibility.sdk,'>=1.5.0')))
      report('mcp.widget-calls-sdk',`/contracts/mcp/tools/${i}/widgetCalls`,
        'Callable widget tool bindings require SDK 1.5 or later.');
  });
  (c.connectors??[]).forEach((connector,i)=>{
    const p=`/contracts/connectors/${i}`;
    if(connector.moduleId!==ownId)report('connector.owner',p,'A connector belongs to its declaring module.');
    for(const role of ['config','vault']){
      const storage=connector[role],model=c.models.find(item=>item.id===storage.modelId);
      const columns=[storage.contextField,...Object.values(storage.fields)];
      if(storage.moduleId!==ownId||!model||model.public||model.scope!=='context'
        ||model.contextField!==storage.contextField||!same(model.primaryKey,[storage.contextField,storage.fields.id]))
        report('connector.storage',`${p}/${role}`,'Connector storage must use its own private model keyed by context and ID.');
      if(new Set(columns).size!==columns.length||columns.some(name=>!model?.fields.some(field=>field.id===name)))
        report('connector.field',`${p}/${role}`,'Storage mappings require distinct declared columns.');
      if(role==='vault'&&columns.some(name=>{const field=model?.fields.find(item=>item.id===name);
        return !field||!field.protected||field.nullable||field.computed
          ||field.type!==(name===storage.fields.version?'integer':'string');}))
        report('connector.secret',`${p}/${role}`,'Vault columns are protected, required and persisted.');
      if(role==='vault'&&(!(model?.fields.find(field=>field.id===storage.fields.version)?.constraints?.minimum>=1)
        ||!same([...(model?.fields.find(field=>field.id===storage.fields.state)?.constraints?.enum??[])].sort(),['active','revoked'])))
        report('connector.secret',`${p}/${role}`,'Vault versions are positive integers and state is active or revoked.');
      if(role==='config'){
        const context=model?.fields.find(field=>field.id===storage.contextField);
        if(!context||context.type!=='string'||!context.protected||context.nullable||context.computed)
          report('connector.field',`${p}/${role}/contextField`,'The context column is a protected required persisted string.');
        const types={id:'string',origin:'string',keyRef:'string',secretVersion:'integer',enabled:'boolean',revision:'integer',updatedAt:'date-time'};
        for(const [key,type] of Object.entries(types)){
          const field=model?.fields.find(item=>item.id===storage.fields[key]);
          if(!field||field.type!==type||field.computed||(!['keyRef','secretVersion'].includes(key)&&field.nullable))
            report('connector.field',`${p}/${role}/fields/${key}`,'Configuration columns require their declared persisted types.');
        }
        if(!(model?.fields.find(field=>field.id===storage.fields.revision)?.constraints?.minimum>=1))
          report('connector.field',`${p}/${role}/fields/revision`,'Configuration revisions are positive integers.');
        if(!(model?.fields.find(field=>field.id===storage.fields.secretVersion)?.constraints?.minimum>=1))
          report('connector.field',`${p}/${role}/fields/secretVersion`,'Present secret versions are positive integers.');
      }
    }
    if(connector.auth.kind==='api-key-header'&&/^x-(?:forwarded|real|original|http|method|override|host|cookie|origin|proxy|cf|amz)(?:-|$)/i.test(connector.auth.name))
      report('connector.auth',`${p}/auth`,'A credential header cannot alter routing, proxy identity or cookies.');
    if(connector.fixedOrigin!==undefined){
      let valid=false;
      try{
        const url=new URL(connector.fixedOrigin);
        valid=url.protocol==='https:'&&connector.fixedOrigin===url.origin
          &&!url.username&&!url.password&&!url.hostname.endsWith('.')
          &&url.hostname!=='localhost'&&!/\.(?:localhost|local|internal)$/.test(url.hostname)
          &&!url.hostname.includes(':')&&!/^\d+(?:\.\d+){3}$/.test(url.hostname);
      }catch{}
      if(!valid)report('connector.origin',`${p}/fixedOrigin`,'A fixed origin is a canonical public HTTPS origin, without credentials, path or query.');
    }
    const reservedHeaders=new Set(['authorization','proxy-authorization','host','cookie','set-cookie',
      'origin','referer','accept','accept-encoding','content-length','content-type','connection',
      'upgrade','te','trailer','transfer-encoding','cache-control','range','user-agent','forwarded',
      ...(connector.auth.kind==='api-key-header'?[connector.auth.name.toLowerCase()]:[])]);
    const headerNames=new Set();
    (connector.staticHeaders??[]).forEach((header,j)=>{
      const name=header.name.toLowerCase();
      if(reservedHeaders.has(name)||/^(?:proxy-|sec-|if-|x-(?:forwarded|real|original|http|method|override|host|cookie|origin|proxy|cf|amz)(?:-|$))/.test(name)
        ||headerNames.has(name))report('connector.header',`${p}/staticHeaders/${j}`,'Static headers must be unique and cannot replace credentials or host-controlled headers.');
      headerNames.add(name);
    });
    connector.resources.forEach((resource,j)=>{
      const parts=resource.path.slice(1).split('/');
      if(parts.some(part=>part!=='{id}'&&(!/^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/.test(part)||part==='.'||part==='..'))
        ||parts.filter(part=>part==='{id}').length>1||parts.includes('{id}')!==resource.params.includes('id'))
        report('connector.resource',`${p}/resources/${j}`,'Only a fixed path and one declared ID segment are allowed.');
      const query=resource.query??{},names=[];
      for(const key of ['cursor','limit']){
        if(query[key]!==undefined&&!resource.params.includes(key))
          report('connector.query',`${p}/resources/${j}/query/${key}`,'A query alias must name a declared operation parameter.');
        if(resource.params.includes(key))names.push(query[key]??key);
      }
      names.push(...(query.fixed??[]).map(item=>item.name),
        ...(query.fields??[]).map(item=>item.wireName));
      if(new Set(names).size!==names.length)
        report('connector.query',`${p}/resources/${j}/query`,'Fixed and dynamic query parameter names must not collide.');
      if(new Set((query.fields??[]).map(item=>item.name)).size!==(query.fields??[]).length)
        report('connector.query',`${p}/resources/${j}/query/fields`,'Query field names must be unique.');
      const write=resource.method!=='GET',body=resource.body;
      if(!write&&(body!==undefined||resource.idempotencyHeader!==undefined)
        ||write&&resource.params.some(param=>param!=='id')
        ||write&&(query.cursor!==undefined||query.limit!==undefined||query.fields?.length))
        report('connector.resource',`${p}/resources/${j}`,'Mutations use fixed paths, declared IDs and bodies; GET has no body or replay header.');
      if(body){
        const wire=/^[A-Za-z][A-Za-z0-9_]*(?:\[(?:\d+|[A-Za-z_][A-Za-z0-9_]*)\])*$/;
        const names=[...body.fields.map(field=>field.wireName),...(body.fixed??[]).map(field=>field.name)];
        if(!write||new Set(names).size!==names.length
          ||new Set(body.fields.map(field=>field.name)).size!==body.fields.length
          ||body.encoding==='json-root'&&(body.fields.length!==1
            ||body.fields[0].kind!=='json'||body.fixed!==undefined)
          ||body.fields.some(field=>!wire.test(field.wireName)
            ||body.encoding!=='form'&&field.wireName.includes('[')
            ||body.encoding==='form'&&field.kind==='json')
          ||(body.fixed??[]).some(field=>!wire.test(field.name)
            ||body.encoding==='json'&&field.name.includes('[')))
          report('connector.body',`${p}/resources/${j}/body`,'Mutation body fields must be unique, declared and compatible with their encoding.');
      }
      if(resource.idempotencyHeader){
        const lower=resource.idempotencyHeader.toLowerCase();
        if(!write||reservedHeaders.has(lower)||headerNames.has(lower)
          ||/^(?:proxy-|sec-|if-|x-(?:forwarded|real|original|http|method|override|host|cookie|origin|proxy|cf|amz)(?:-|$))/.test(lower))
          report('connector.header',`${p}/resources/${j}/idempotencyHeader`,'The provider replay header cannot replace host or credential headers.');
      }
    });
    const binary=connector.binaryDownloads??[];
    if(binary.length){
      const configModel=c.models.find(model=>model.id===connector.config.modelId);
      const connectionField=configModel?.fields.find(field=>field.id===connector.config.fields.connectionId);
      if(!connectionField||connectionField.type!=='string'||connectionField.computed)
        report('connector.binary',`${p}/config/fields/connectionId`,
          'Binary downloads require a persisted connection ID in the connector configuration.');
    }
    if(new Set(binary.map(item=>item.id)).size!==binary.length)
      report('connector.binary',`${p}/binaryDownloads`,'Binary policy IDs must be unique.');
    binary.forEach((policy,j)=>{
      const path=`${p}/binaryDownloads/${j}`,proof=c.operations.find(op=>op.id===policy.proofOperationId);
      const event=c.models.find(model=>model.id===policy.event.modelId);
      const index=event?.indexes.find(item=>item.id===policy.event.indexId);
      const pathValid=value=>typeof value==='string'&&/^\/(?:[A-Za-z0-9_-]+|\{parentId\}|\{childId\})(?:\/(?:[A-Za-z0-9_-]+|\{parentId\}|\{childId\}))*$/.test(value)
        &&value.split('{parentId}').length===2&&value.split('{childId}').length===2;
      let cdnValid=false;
      try{const url=new URL(policy.cdnOrigin);cdnValid=url.protocol==='https:'&&url.origin===policy.cdnOrigin
        &&!url.username&&!url.password&&!url.hostname.endsWith('.')
        &&url.hostname!=='localhost'&&!/\.(?:localhost|local|internal)$/.test(url.hostname)
        &&!url.hostname.includes(':')&&!/^\d+(?:\.\d+){3}$/.test(url.hostname);}catch{}
      if(!proof||proof.kind!=='query'||!proof.public||!proof.permissions.length)
        report('connector.binary',`${path}/proofOperationId`,
          'A binary policy requires a public permissioned query of the same connector module.');
      if(!pathValid(policy.metadataPath)||!pathValid(policy.cdnPath)||!cdnValid)
        report('connector.binary',path,'API and CDN paths and HTTPS origin must be static and canonical.');
      if(!event||!index||!event.contextField||!index.fields.includes(policy.event.connectionField)
        ||!index.fields.includes(policy.event.parentField)
        ||[policy.event.connectionField,policy.event.parentField,policy.event.typeField]
          .some(id=>!event.fields.some(field=>field.id===id&&field.type==='string'&&!field.computed)))
        report('connector.binary',`${path}/event`,
          'A binary policy requires a concrete indexed signed-event model.');
    });
  });
  c.operations.forEach((op, i) => {
    const p = `/contracts/operations/${i}`;
    unique(op.audiences, `${p}/audiences`, report); unique(op.actors, `${p}/actors`, report);
    if(op.actors.includes('signed-webhook')&&(!op.actors.includes('machine')||op.kind!=='command'))
      report('operation.webhook',p,'Signed ingress requires a machine-authorized command.');
    if (op.actors.includes('impersonated-user') && op.permissions.some(ref => ref.moduleId === 'creezio.access' && ['manage', 'impersonate'].includes(ref.id)))
      report('operation.impersonation', p, 'Impersonation cannot administer access or start another impersonation.');
    if (!op.permissions.length && !op.actors.every(actor => actor === 'anonymous')) report('operation.permissions', `${p}/permissions`, 'Protected operations need declared permissions.');
    if (op.audiences.includes('admin') && op.actors.includes('anonymous')) report('operation.audience', p, 'Administrative operations cannot be anonymous.');
    if (op.kind === 'query' && (op.effects.writes.length || op.effects.emits.length || op.approval.mode !== 'none')) report('operation.effect', p, 'Queries cannot mutate, emit effects or require mutation approval.');
    if (op.kind === 'command' && (op.effects.writes.length || op.effects.emits.length || op.effects.providers.length) && op.idempotency.mode !== 'required') report('operation.idempotency', p, 'Effectful commands require idempotency.');
    for (const permission of op.permissions) {
      needKind(permission, ['permission'], `${p}/permissions`); const allowed = get(permission,'permission');
      if (allowed && (!subset(op.audiences, allowed.audiences)
        || !subset(op.actors.filter(actor=>actor!=='signed-webhook'), allowed.actors)
        || allowed.context === 'required' && op.context !== 'required'))
        report('operation.permissions', p, 'Operation audience, actors or context exceed its permission.');
    }
    for (const [effect, refs] of Object.entries(op.effects)) {
      if (effect === 'providers') continue;
      for (const ref of refs) {
        needKind(ref, effect === 'emits' ? ['event'] : effect === 'calls' ? ['operation'] : ['model','file'], `${p}/effects/${effect}`);
        const target = get(ref);
        if (['reads','writes'].includes(effect) && ref.moduleId !== ownId) report('ref.private',`${p}/effects/${effect}`,'Cross-module data access must use public operations, not another module storage.');
        if (['reads','writes'].includes(effect) && ref.moduleId === ownId && !op.permissions.some(permission=>{
          const policy=get(permission,'permission');
          const allowedActions=effect==='reads'?(op.kind==='query'?['read','export']:['read','create','update','delete','configure','execute','export']):['create','update','delete','configure','execute'];
          return policy?.resources.some(resource=>refKey(resource)===refKey(ref)) && policy.actions.some(action=>allowedActions.includes(action));
        })) report('operation.permissions',`${p}/effects/${effect}`,'Resource effects need a matching operation permission.');
        if (target && (target.scope === 'context' || target.context === 'required') && op.context !== 'required') report('operation.context', p, 'Context-bound resources require a context-bound operation.');
        if (effect === 'calls' && op.kind === 'query' && target?.kind === 'command') report('operation.effect', p, 'A query cannot call a command.');
      }
    }
    if (op.idempotency.mode === 'required') requireInputFields(op.input, [op.idempotency.keyField], `${p}/idempotency`,true);
    if (op.concurrency.mode === 'object-version') requireInputFields(op.input, [op.concurrency.versionField], `${p}/concurrency`,true);
    if (op.pagination.mode === 'cursor') requireInputFields(op.input, [op.pagination.limitField,op.pagination.cursorField], `${p}/pagination`);
    if (op.approval.mode === 'required') { needKind(op.approval.permission, ['permission'], `${p}/approval`); unique(op.approval.bind, `${p}/approval/bind`, report); }
    if (op.execution.resumable && (!op.execution.resumeOperation || !op.execution.progressSchema)) report('operation.resume', `${p}/execution`, 'A resumable operation needs its continuation operation and progress schema.');
  });
  const checkExposure = (exposure, p, kind, audiences) => {
    needKind(exposure.operation, ['operation'], `${p}/operation`);
    const op = get(exposure.operation,'operation'); if (!op) return;
    if (!subset(audiences, op.audiences)) report(`${kind}.audience`, p, 'Exposure exceeds the operation audience.');
    if (exposure.input.schemaId !== op.input.schemaId || exposure.output.schemaId !== op.output.schemaId) report(`${kind}.schema`, p, 'Exposure must use the same input and output contracts as its operation.');
    if (exposure.auth.some(auth => !op.actors.includes(authActors[auth]))) report(`${kind}.auth`, p, 'Authentication method is not accepted by the operation.');
    if (kind === 'api' && exposure.method === 'GET' && op.kind !== 'query') report('api.operation', p, 'GET cannot execute a command.');
    if (kind === 'mcp' && exposure.annotations.readOnly !== (op.kind === 'query')) report('mcp.annotation', p, 'Read-only annotation contradicts the operation.');
  };
  c.api.forEach((api, i) => { checkExposure(api, `/contracts/api/${i}`, 'api', [api.audience]); const params = [...api.path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]); if (params.some(name => !api.parameters.some(p => p.in === 'path' && p.name === name && p.required)) || api.parameters.some(p => p.in === 'path' && !params.includes(p.name))) report('api.parameters', `/contracts/api/${i}`, 'Path parameters and declared mapping differ.'); requireInputFields(api.input, api.parameters.map(p => p.inputField), `/contracts/api/${i}/parameters`); });
  c.mcp.tools.forEach((tool, i) => checkExposure(tool, `/contracts/mcp/tools/${i}`, 'mcp', tool.audiences));
  c.widgets.forEach((widget, i) => {
    const p = `/contracts/widgets/${i}`; version(widget.version, `${p}/version`, report); unique(widget.actions, `${p}/actions`, report);
    version(widget.compatibility,`${p}/compatibility`,report,true);
    const resource=c.mcp.resources.find(item=>item.id===widget.resource);
    if(!resource||resource.source.kind!=='asset'||resource.mimeType!=='text/html;profile=mcp-app'||resource.widget?.moduleId!==ownId||resource.widget?.kind!=='widget'||resource.widget?.id!==widget.id)report('widget.resource',`${p}/resource`,'A widget needs its corresponding packaged MCP Apps UI resource.');
    if(resource&&!subset(widget.audiences,resource.audiences))report('widget.audience',p,'Widget audiences exceed its UI resource audience.');
    widget.actions.forEach((action, j) => {
      const ap = `${p}/actions/${j}`;
      const fallbacks = { message:['unavailable','copy-message'], context:['unavailable','local-untransmitted-context'], direct:['unavailable'] };
      if (!fallbacks[action.mode].includes(action.fallback)) report('widget.fallback', ap, 'Fallback cannot change the action mode or its effect.');
      if (action.mode === 'message') unique(action.target.states, `${ap}/target/states`, report);
      if (action.mode === 'context') { unique(action.target.scope, `${ap}/target/scope`, report); requireInputFields(action.input, action.target.fields, `${ap}/target/fields`); }
      if (action.mode === 'direct' && action.target.kind === 'operation') {
        needKind(action.target.operation, ['operation'], `${ap}/target`); const op = get(action.target.operation,'operation');
        if (op && (!subset(widget.audiences, op.audiences) || action.input.schemaId !== op.input.schemaId)) report('widget.target', ap, 'Direct widget action must match operation schema and audience.');
      }
    });
  });
  const hasFront = c.ui.views.some(view => view.surfaces.includes('front'));
  if ((c.ui.front.mode === 'provided') !== hasFront) report('ui.front', '/contracts/ui/front', 'Front presence must match its declared views.');
  unique(c.ui.themes??[], '/contracts/ui/themes', report);
  (c.ui.themes??[]).forEach((theme,i)=>unique(theme.slots,`/contracts/ui/themes/${i}/slots`,report));
  c.ui.views.forEach((view,i)=>{
    const p=`/contracts/ui/views/${i}`; requireInputFields(view.input,view.panel.identityFields,`${p}/panel/identityFields`);
    for(const ref of view.operations){needKind(ref,['operation'],`${p}/operations`);const op=get(ref,'operation');if(view.surfaces.includes('front')&&op&&!op.audiences.includes('app'))report('ui.audience',p,'A front view cannot expose an administrative-only operation.');}
    for(const ref of view.permissions){const permission=get(ref,'permission');if(view.surfaces.includes('front')&&permission&&!permission.audiences.includes('app'))report('ui.audience',p,'A front view cannot require an administrative-only permission.');}
  });
  for(const section of ['navigation','slots'])c.ui[section].forEach((item,i)=>{const view=get(item.view,'view');if(view&&!subset(item.surfaces,view.surfaces))report('ui.surface',`/contracts/ui/${section}/${i}`,'Navigation and slots cannot expose the view on an undeclared surface.');});
  c.search.forEach((search, i) => { const p = `/contracts/search/${i}`, model = get(search.model,'model'); needKind(search.model, ['model'], `${p}/model`); if (model && [...search.fields,...search.facets].some(field => !model.fields.some(f => f.id === field))) report('search.field', p, 'Search references an unknown model field.'); if (model?.scope === 'context' && search.context !== 'required') report('search.context', p, 'Search must preserve the model context.'); if (search.engine === 'provider' && !search.provider) report('search.provider', p, 'Provider search needs an explicit provider.'); });
  c.settings.forEach((setting, i) => { if (setting.visibility === 'secret-reference' && Object.hasOwn(setting,'default')) report('setting.secret', `/contracts/settings/${i}`, 'A secret reference cannot carry a default secret.'); });
  c.mcp.skills.forEach((skill,i)=>skill.resources.forEach(resource=>{if(!c.mcp.resources.some(item=>item.id===resource))report('ref.missing',`/contracts/mcp/skills/${i}/resources`,'Skill resource does not exist.');}));
  c.publicContracts.forEach((port, i) => {
    version(port.version, `/contracts/publicContracts/${i}/version`, report);
    for(const [section,kind] of [['models','model'],['operations','operation'],['events','event']])for(const ref of port[section]){
      needKind(ref,[kind],`/contracts/publicContracts/${i}/${section}`);
      if(ref.moduleId!==ownId||get(ref,kind)?.public!==true)report('ref.private',`/contracts/publicContracts/${i}/${section}`,'Public contracts export only explicitly public contracts owned by this module.');
    }
  });
  checkPackaging(module, report);
  checkCollisions([module], report);
  return { index, references };
}

function checkRelation(source, relation, target, p, report) {
  const sourceFields = new Map(source.fields.map(field => [field.id,field])), targetFields = new Map(target.fields.map(field => [field.id,field]));
  if (relation.targetFields.some((field, i) => !targetFields.has(field) || targetFields.get(field).type !== sourceFields.get(relation.fields[i])?.type)) report('model.relation', p, 'Relation field types or target fields are incompatible.');
  if (![target.primaryKey,...target.indexes.filter(index => index.unique).map(index => index.fields)].some(fields => same(fields, relation.targetFields))) report('model.relation', p, 'A relation must target a unique key.');
  if (target.scope === 'context' && (source.scope !== 'context' || !relation.fields.some((field,i)=>field===source.contextField&&relation.targetFields[i]===target.contextField))) report('model.relation-context', p, 'Context relations must map the source context field to the target context field.');
}

function checkResolvedOperations(module,indexes,disabled,report) {
  const resolve=(ref,kind)=>ref?.kind===kind?indexes.get(ref.moduleId)?.get(kind)?.get(ref.id):undefined;
  const inactive=path=>disabled.some(item=>path===item.path||path.startsWith(`${item.path}/`));
  const schema=(id,ref)=>indexes.get(id)?.get('schema')?.get(ref?.schemaId)?.schema;
  const exposure=(item,path,audiences,kind)=>{
    if(inactive(path))return; const op=resolve(item.operation,'operation'); if(!op)return;
    if(!subset(audiences,op.audiences))report(`${kind}.audience`,path,'Exposure exceeds the resolved operation audience.');
    if(item.auth?.some(auth=>!op.actors.includes(authActors[auth])))report(`${kind}.auth`,path,'Exposure authentication exceeds the resolved operation actors.');
    if(!same(schema(module.identity.id,item.input),schema(item.operation.moduleId,op.input))||!same(schema(module.identity.id,item.output),schema(item.operation.moduleId,op.output)))report(`${kind}.schema`,path,'Exposure schemas differ from the resolved operation contracts.');
    if(kind==='api'&&item.method==='GET'&&op.kind!=='query')report('api.operation',path,'GET cannot expose a resolved command.');
    if(kind==='mcp'&&item.annotations.readOnly!==(op.kind==='query'))report('mcp.annotation',path,'Tool annotation contradicts its resolved operation.');
  };
  module.contracts.api.forEach((item,i)=>exposure(item,`/contracts/api/${i}`,[item.audience],'api'));
  module.contracts.mcp.tools.forEach((item,i)=>exposure(item,`/contracts/mcp/tools/${i}`,item.audiences,'mcp'));
  module.contracts.operations.forEach((op,i)=>{
    const path=`/contracts/operations/${i}`;if(inactive(path))return;
    for(const ref of op.effects.calls){const target=resolve(ref,'operation');if(!target)continue;
      if(op.kind==='query'&&target.kind==='command')report('operation.effect',path,'A query cannot call a command in another module.');
      if(!subset(op.audiences,target.audiences)||!subset(op.actors,target.actors)||target.context==='required'&&op.context!=='required')report('operation.delegation',path,'A calling operation must preserve the target audience, actors and context.');
      if(target.approval.mode==='required'&&op.approval.mode!=='required')report('operation.approval',path,'A calling operation cannot omit required downstream approval.');
      if(target.idempotency.mode==='required'&&op.idempotency.mode!=='required')report('operation.idempotency',path,'A calling operation must preserve downstream idempotency.');
    }
  });
  module.contracts.ui.views.forEach((view,i)=>{
    const path=`/contracts/ui/views/${i}`;if(inactive(path))return;
    for(const ref of view.operations){const op=resolve(ref,'operation');if(view.surfaces.includes('front')&&op&&!op.audiences.includes('app'))report('ui.audience',path,'A front view cannot expose an administrative-only external operation.');}
  });
  module.contracts.widgets.forEach((widget,i)=>{
    const path=`/contracts/widgets/${i}`;if(inactive(path))return;
    for(const [j,action] of widget.actions.entries())if(!inactive(`${path}/actions/${j}`)&&action.mode==='direct'&&action.target.kind==='operation'){
      const op=resolve(action.target.operation,'operation');if(!op)continue;
      if(!subset(widget.audiences,op.audiences)||!same(schema(module.identity.id,action.input),schema(action.target.operation.moduleId,op.input)))report('widget.target',path,'Widget action differs from its resolved operation schema or audience.');
    }
  });
}

function checkPackaging(module, report) {
  const p = module.packaging, runtime = new Set(p.runtime.files), validation = new Set(p.validation.files);
  for (const [artifact, inventory] of Object.entries({runtime,validation})) {
    unique(p[artifact].files.map(file => file.toLowerCase()), `/packaging/${artifact}/files`, report);
    for (const file of inventory) {
      if (!safePackagePath(file)) report('path.invalid', `/packaging/${artifact}/files`, 'Paths must be safe artifact-relative POSIX paths.');
      if (runtime.has(file) && validation.has(file)) report('package.overlap', `/packaging/${artifact}/files`, 'One path cannot belong to two assembled artifacts.');
      if (/(?:^|\/)(?:migrations?|historical-migrations)(?:\/|$)|\.sql$/i.test(file)) report('package.sql', `/packaging/${artifact}/files`, 'Module packages cannot supply SQL transformation scripts.');
      if (artifact === 'runtime' && /^(?:ci|tests|demo|node_modules|\.git|\.github)\/|^gate\.mjs$/.test(file)) report('package.runtime', `/packaging/${artifact}/files`, 'Development, tests and demo files must stay outside the runtime package.');
    }
    for (const [i, ref] of p[artifact].references.entries()) if (!inventory.has(ref.from) || !(ref.artifact === 'runtime' ? runtime : validation).has(ref.to) || artifact === 'runtime' && ref.artifact !== 'runtime') report('package.closure', `/packaging/${artifact}/references/${i}`, 'Declared references must close within their allowed artifact.');
  }
  const requireFile = (file, artifact, location) => { if (!safePackagePath(file)) report('path.invalid', location, 'Unsafe package path.'); else if (!(artifact === 'runtime' ? runtime : validation).has(file)) report('path.missing', location, 'Referenced file is absent from its artifact inventory.'); };
  walk(module.entrypoints, (node, location) => { if (node && typeof node === 'object' && typeof node.path === 'string') requireFile(node.path,'runtime',`${location}/path`); }, '/entrypoints');
  if(module.entrypoints.publicPage)requireFile(module.entrypoints.publicPage.stylesheet,'runtime','/entrypoints/publicPage/stylesheet');
  requireFile(module.entrypoints.plugin.manifest,'runtime','/entrypoints/plugin/manifest'); requireFile(module.entrypoints.plugin.mcp,'runtime','/entrypoints/plugin/mcp'); requireFile(module.identity.license.file,'runtime','/identity/license/file');
  for (const [section, value] of Object.entries(module.contracts)) if (section !== 'schemas') walkContracts(value, (node, location) => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      if (typeof node.path === 'string' && !location.startsWith('/contracts/api/')
        && !/^\/contracts\/connectors\/\d+\/(?:resources\/\d+|webhook)$/.test(location))
        requireFile(node.path,'runtime',`${location}/path`);
      if (typeof node.template === 'string') requireFile(node.template,'runtime',`${location}/template`);
      for (const key of ['assets','styles']) if (Array.isArray(node[key])) node[key].forEach((file,i) => requireFile(file,'runtime',`${location}/${key}/${i}`));
    }
  }, `/contracts/${section}`);
  for (const [section, docs] of Object.entries({installed:module.documentation.installed,development:module.documentation.development})) for (const [name, doc] of Object.entries(docs)) {
    requireFile(doc.path,doc.artifact,`/documentation/${section}/${name}`);
    if (section === 'installed' && doc.artifact !== 'runtime') report('documentation.installed', `/documentation/${section}/${name}`, 'Installed version documents belong to the runtime artifact.');
  }
  requireFile(module.validation.gate,'validation','/validation/gate');
  const required = { backend:true, ui:module.contracts.ui.views.length + module.contracts.widgets.length > 0, 'api-mcp':module.contracts.operations.length + module.contracts.api.length + Object.values(module.contracts.mcp).reduce((n,list)=>n+list.length,0) > 0, widgets:module.contracts.widgets.length > 0, package:true, docs:true };
  for (const [name,suite] of Object.entries(module.validation.suites)) {
    requireFile(suite.script,'validation',`/validation/suites/${name}/script`); suite.tests.forEach((test,i) => requireFile(test,'validation',`/validation/suites/${name}/tests/${i}`));
    if (required[name] && suite.mode !== 'required') report('validation.not-applicable', `/validation/suites/${name}`, 'This module capability requires its validation suite.');
  }
  const b=p.validationBinding, d=module.documentation.versionBinding;
  if (b.moduleId !== module.identity.id || b.moduleVersion !== module.identity.version || b.sourceRevision !== module.identity.source.revision || d.moduleVersion !== module.identity.version || d.sourceRevision !== module.identity.source.revision) report('package.binding', '/packaging/validationBinding', 'Artifacts and installed documents must bind the same module version and source.');
}

function checkCollisions(modules, report) {
  const seen = new Map();
  const take = (key, path) => { if (seen.has(key)) report('composition.collision', path, 'Contributions collide within the same routed surface.'); else seen.set(key,path); };
  modules.forEach((module, m) => {
    const p = modules.length === 1 ? '/contracts' : `/modules/${m}/contracts`, c = module.contracts;
    c.api.forEach((route,i) => take(`api:${route.method}:${routeKey(route.path)}`,`${p}/api/${i}`));
    c.ui.views.forEach((view,i) => view.surfaces.forEach(surface => take(`ui:${surface}:${routeKey(view.route)}`,`${p}/ui/views/${i}`)));
    c.mcp.tools.forEach((tool,i) => tool.audiences.forEach(audience => take(`tool:${audience}:${tool.name}`,`${p}/mcp/tools/${i}`)));
    c.mcp.resources.forEach((resource,i) => resource.audiences.forEach(audience => take(`resource:${audience}:${resource.uri}`,`${p}/mcp/resources/${i}`)));
  });
}

/** Guards are declarations, not permission grants. No module is acquired or activated by this resolver. */
function contributionEntries(module) {
  const c = module.contracts;
  return Object.entries({ operations:c.operations, api:c.api, widgets:c.widgets, events:c.events, search:c.search, settings:c.settings,
    deliveries:c.deliveries??[],
    'mcp/tools':c.mcp.tools, 'mcp/resources':c.mcp.resources, 'mcp/prompts':c.mcp.prompts, 'mcp/skills':c.mcp.skills,
    'ui/views':c.ui.views, 'ui/navigation':c.ui.navigation, 'ui/slots':c.ui.slots
  }).flatMap(([section,entries]) => entries.map((entry,i) => ({entry,path:`/contracts/${section}/${i}`,section})))
    .concat(c.widgets.flatMap((widget,i)=>widget.actions.map((entry,j)=>({entry,path:`/contracts/widgets/${i}/actions/${j}`,section:`widgets/${i}/actions`}))));
}

export function checkComposition(composition, modules, lock, report) {
  const selected = new Map(composition.modules.map(item => [item.moduleId,item]));
  const descriptors = new Map(modules.map(module => [module.identity.id,module]));
  const locked = new Map(lock.modules.map(item => [item.moduleId,item]));
  const indexes = new Map(modules.map(module => [module.identity.id,contractIndex(module)]));
  const inactive = new Map(), inactiveReferences = new Set(), dependencyOrder = [], chains = [];
  unique(composition.modules,'/modules',report,item => item.moduleId);
  unique(modules,'/descriptors',report,item => item.identity.id);
  unique(lock.modules,'/lock/modules',report,item => item.moduleId);
  version(composition.sdk.version,'/sdk/version',report); version(composition.sdk.coreVersion,'/sdk/coreVersion',report);
  if (lock.applicationId !== composition.application.id || lock.sdkVersion !== composition.sdk.version || lock.coreVersion !== composition.sdk.coreVersion || !same(lock.policy,composition.sdk.policy)) report('lock.mismatch','/lock','Lock must match the application and SDK policy.');
  if (lock.compositionIntegrity !== contractIntegrity(composition)) report('lock.integrity','/lock/compositionIntegrity','Composition digest does not match its canonical contract.');
  for (const [i, selection] of composition.modules.entries()) {
    const p=`/modules/${i}`, module=descriptors.get(selection.moduleId), frozen=locked.get(selection.moduleId);
    version(selection.versionRange,`${p}/versionRange`,report,true);
    if (selection.source.kind === 'workspace' && !safePackagePath(selection.source.path)) report('path.invalid',`${p}/source/path`,'Unsafe workspace source path.');
    if (!module) { report('dependency.missing',p,'Selected module descriptor is missing.'); continue; }
    const integrations=new Map(selection.integrations.map(item=>[item.moduleId,item.enabled]));
    unique(selection.integrations,`${p}/integrations`,report,item=>item.moduleId);
    const optionalIds=module.dependencies.filter(dep=>dep.optional).map(dep=>dep.moduleId);
    if(integrations.size!==optionalIds.length || optionalIds.some(id=>!integrations.has(id)) || [...integrations.keys()].some(id=>!optionalIds.includes(id)))report('dependency.integration',`${p}/integrations`,'Every optional dependency requires exactly one explicit integration choice; required dependencies cannot be opted out.');
    if (!frozen) report('lock.missing',p,'Every selected module, including disabled modules, must be locked.');
    if (module.identity.origin !== selection.origin) report('dependency.origin',p,'Selected origin differs from the module descriptor.');
    if (!semver.satisfies(module.identity.version,selection.versionRange)) report('dependency.version',p,'Selected module does not satisfy the requested version range.');
    if (!semver.satisfies(composition.sdk.version,module.compatibility.sdk) || !semver.satisfies(composition.sdk.coreVersion,module.compatibility.core)) report('dependency.compatibility',p,'Module SDK or core compatibility is not satisfied.');
    if (!same(module.validation.policy,composition.sdk.policy)) report('validation.policy',p,'Module validation declaration must bind the application SDK policy.');
    if (selection.enabled && !subset(module.compatibility.requiredCapabilities,composition.host.capabilities)) report('host.capability',p,'Host declaration lacks a required module capability.');
    if (frozen) {
      if (frozen.origin !== module.identity.origin || frozen.version !== module.identity.version || !same(frozen.source,module.identity.source)) report('lock.mismatch',p,'Locked identity, origin, version or source differs from the module.');
      if (frozen.contractIntegrity !== contractIntegrity(module)) report('lock.integrity',p,'Locked module digest differs from its canonical contract.');
      for (const name of ['runtime','validation']) if (frozen[name].location.kind === 'local' && !safePackagePath(frozen[name].location.path)) report('path.invalid',`${p}/${name}`,'Unsafe local artifact path.');
      unique(frozen.dependencies,`${p}/dependencies`,report,item => item.moduleId);
      const expected = module.dependencies.filter(dep => selected.has(dep.moduleId));
      if (frozen.dependencies.length !== expected.length || expected.some(dep => !frozen.dependencies.some(edge => edge.moduleId === dep.moduleId && edge.version === descriptors.get(dep.moduleId)?.identity.version))) report('lock.dependencies',p,'Locked dependency edges must exactly match the selected dependency graph.');
    }
    selection.configuration.forEach((setting,j) => { if (setting.setting.kind !== 'setting' || setting.setting.moduleId !== module.identity.id || !indexes.get(module.identity.id)?.get('setting').has(setting.setting.id)) report('ref.missing',`${p}/configuration/${j}`,'Configuration must reference a setting belonging to the selected module.'); });
    for (const [j,dep] of module.dependencies.entries()) {
      const dp=`${p}/dependencies/${j}`, target=descriptors.get(dep.moduleId), targetSelection=selected.get(dep.moduleId);
      if(dep.optional && integrations.get(dep.moduleId)!==true)continue;
      if (!targetSelection || !target) {
        if (!dep.optional && selection.enabled || dep.optional && dep.whenAbsent === 'block' && selection.enabled) report('dependency.missing',dp,`${module.identity.id} requires unavailable module ${dep.moduleId}.`);
        continue;
      }
      if (dep.origin !== target.identity.origin) report('dependency.origin',dp,'Dependency origin does not match the selected provider.');
      if (!semver.satisfies(target.identity.version,dep.versionRange)) report('dependency.version',dp,`${module.identity.id} requires ${dep.moduleId} ${dep.versionRange}; selected ${target.identity.version}.`);
      if (selection.enabled && !targetSelection.enabled && (!dep.optional || dep.whenAbsent === 'block')) report('dependency.disabled',dp,'An active module requires an active dependency.');
      for (const port of dep.contracts) {
        const provided=target.contracts.publicContracts.find(contract => contract.id===port.id);
        if (!provided) report('dependency.contract',dp,'The dependency does not export the required public contract.');
        else if (!semver.satisfies(provided.version,port.versionRange)) report('dependency.contract-version',dp,'The exported public contract version is incompatible.');
      }
    }
    const entries=contributionEntries(module), disabled=[];
    for (const contribution of entries) {
      for (const id of contribution.entry.requiresModules ?? []) {
        const dependency=module.dependencies.find(dep => dep.moduleId===id);
        if (!dependency?.optional || dependency.whenAbsent !== 'disable-contributions') report('dependency.guard',`${p}${contribution.path}/requiresModules`,'Contribution guards require a declared optional dependency with contribution removal.');
        if ((integrations.get(id)!==true || !selected.get(id)?.enabled) && !disabled.includes(contribution)) disabled.push(contribution);
      }
    }
    inactive.set(module.identity.id, disabled);
    const kindBySection={operations:'operation',widgets:'widget',events:'event',search:'search',settings:'setting','ui/views':'view'};
    for (const contribution of disabled) if (kindBySection[contribution.section]) inactiveReferences.add(`${module.identity.id}:${kindBySection[contribution.section]}:${contribution.entry.id}`);
  }
  for (const module of modules) if (!selected.has(module.identity.id)) report('composition.unselected','/descriptors','A descriptor is present without a composition selection.');
  for (const node of lock.modules) if (!selected.has(node.moduleId)) report('lock.extra','/lock/modules','The lock contains an unselected module.');
  const active = new Set(), done = new Set();
  function visit(id, trail) {
    if (active.has(id)) { report('dependency.cycle','/modules',`Dependency cycle: ${[...trail,id].join(' -> ')}.`); return; }
    if (done.has(id) || !descriptors.has(id)) return;
    active.add(id); const chain=[...trail,id]; chains.push(chain);
    for (const dep of descriptors.get(id).dependencies) if (selected.has(dep.moduleId) && (!dep.optional || selected.get(id)?.integrations.some(item=>item.moduleId===dep.moduleId&&item.enabled))) visit(dep.moduleId,chain);
    active.delete(id); done.add(id); dependencyOrder.push(id);
  }
  for (const id of selected.keys()) visit(id,[]);
  for (const module of modules) {
    if (!selected.get(module.identity.id)?.enabled) continue;
    const {references}=collectReferences(module,()=>{}), disabled=inactive.get(module.identity.id) ?? [];
    for (const {reference:ref,path} of references) {
      const contributionDisabled=disabled.some(item => path===item.path || path.startsWith(`${item.path}/`));
      if (contributionDisabled) continue;
      const target=indexes.get(ref.moduleId)?.get(ref.kind)?.get(ref.id);
      if (!target || !selected.get(ref.moduleId)?.enabled || inactiveReferences.has(refKey(ref))) { report('ref.missing',`/descriptors/${module.identity.id}${path}`,'An active contribution references an absent, disabled or guarded-off contract.'); continue; }
      if (ref.moduleId === module.identity.id) continue;
      const dependency=module.dependencies.find(dep=>dep.moduleId===ref.moduleId), targetModule=descriptors.get(ref.moduleId);
      if(dependency?.optional && !selected.get(module.identity.id).integrations.some(item=>item.moduleId===ref.moduleId&&item.enabled))report('dependency.integration',`/descriptors/${module.identity.id}${path}`,'An active reference cannot opt into an unselected optional integration.');
      const ports=(dependency?.contracts??[]).map(port=>targetModule.contracts.publicContracts.find(item=>item.id===port.id)).filter(Boolean);
      const exported=ref.kind==='publicContract' ? ports.some(port=>port.id===ref.id) : ports.some(port=>[...port.models,...port.operations,...port.events].some(item=>refKey(item)===refKey(ref)) || ref.kind==='schema' && port.schemas.some(item=>item.schemaId===ref.id));
      if (!exported) report('ref.private',`/descriptors/${module.identity.id}${path}`,'External references must be exported by a consumed versioned public contract.');
    }
    module.contracts.models.forEach((model,i)=>model.relations.forEach((relation,j)=>{ const target=indexes.get(relation.target.moduleId)?.get('model')?.get(relation.target.id); if(target)checkRelation(model,relation,target,`/descriptors/${module.identity.id}/contracts/models/${i}/relations/${j}`,report); }));
    (module.contracts.deliveries??[]).forEach((delivery,i)=>{
      if((inactive.get(module.identity.id)??[]).some(item=>item.path===`/contracts/deliveries/${i}`))return;
      const p=`/descriptors/${module.identity.id}/contracts/deliveries/${i}`;
      const provider=descriptors.get(delivery.provider.publicContract.moduleId);
      const selectedProvider=selected.get(delivery.provider.publicContract.moduleId);
      const exported=provider?.contracts.publicContracts.find(item=>item.id===delivery.provider.publicContract.id);
      const connector=provider?.contracts.connectors?.find(item=>item.id===delivery.provider.connectorId);
      const readiness=provider?.contracts.operations.find(item=>item.id===delivery.provider.readiness.id);
      if(!provider||!selectedProvider?.enabled||!exported
        ||!exported.operations.some(ref=>refKey(ref)===refKey(delivery.provider.readiness))
        ||readiness?.kind!=='query'
        ||!connector||!connector.resources.some(item=>item.id===delivery.provider.resourceId
          &&item.method!=='GET'&&item.idempotencyHeader))
        report('delivery.provider',p,'An active delivery needs an exported readiness query and one active idempotent mutation resource.');
    });
    checkResolvedOperations(module,indexes,inactive.get(module.identity.id)??[],report);
  }
  for (const audience of ['admin','app']) {
    unique(composition.exposure[audience].moduleIds,`/exposure/${audience}/moduleIds`,report);
    for (const id of composition.exposure[audience].moduleIds) if (!selected.get(id)?.enabled) report('composition.exposure',`/exposure/${audience}`,'Exposure may include only selected and enabled modules.');
  }
  if (composition.front.kind==='theme') {
    const themeSelection=selected.get(composition.front.moduleId);
    const themeModule=descriptors.get(composition.front.moduleId);
    const matches=themeModule?.contracts.ui.themes?.filter(item=>item.id===composition.front.theme)??[];
    if (!themeSelection?.enabled || matches.length!==1)
      report('composition.front','/front','The front theme must resolve to one export of an enabled selected module.');
    else {
      const supported=new Set(matches[0].slots);
      for(const [moduleId,module] of descriptors) {
        if(!selected.get(moduleId)?.enabled||!composition.exposure.app.moduleIds.includes(moduleId))continue;
        for(const [index,slot] of module.contracts.ui.slots.entries()) {
          if(!slot.surfaces.includes('front') || (inactive.get(moduleId)??[]).some(item=>item.path===`/contracts/ui/slots/${index}`))continue;
          if(!supported.has(slot.slot))report('composition.front-slot',`/descriptors/${moduleId}/contracts/ui/slots/${index}`,
            'The selected theme does not support this front slot.');
        }
      }
    }
  }
  const enabledModules=modules.filter(module=>selected.get(module.identity.id)?.enabled).map(module=>{
    const copy=structuredClone(module), disabled=inactive.get(module.identity.id)??[];
    for (const section of new Set(disabled.map(item=>item.section).filter(section=>['api','mcp/tools','mcp/resources','ui/views'].includes(section)))) {
      const keys=section.split('/'); let parent=copy.contracts; for(const key of keys.slice(0,-1))parent=parent[key];
      const removed=new Set(disabled.filter(item=>item.section===section).map(item=>item.entry.id)); parent[keys.at(-1)]=parent[keys.at(-1)].filter(item=>!removed.has(item.id));
    }
    return copy;
  });
  checkCollisions(enabledModules,report);
  return { moduleCount:modules.length, dependencyEdges:modules.reduce((count,module)=>count+module.dependencies.length,0), dependencyOrder,
    disabledContributions:[...inactive].flatMap(([moduleId,entries])=>entries.map(item=>({moduleId,path:item.path}))), dependencyChains:chains };
}
