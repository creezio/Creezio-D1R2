import semver from 'semver';
import {canonicalJson, checkComposition, contractIntegrity} from '../contracts/semantics.mjs';

export const MODULE_PLAN_LIMITS = Object.freeze({actions:32, choicesBytes:8192, summaryBytes:8192,
  dataPlanBytes:49152});
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256-[a-f0-9]{64}$/;
const ACTIONS = new Set(['add','update','enable','disable','remove','configure','integration']);
const encoder = new TextEncoder();

function diagnostic(code, path, message) { return Object.freeze({code,path,message}); }
function own(value, required, optional=[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype,null].includes(Object.getPrototypeOf(value))) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key=>typeof key !== 'string'
    || ![...required,...optional].includes(key) || !descriptors[key].enumerable
    || !Object.hasOwn(descriptors[key],'value') || descriptors[key].value===undefined)
    || required.some(key=>!Object.hasOwn(descriptors,key))) return null;
  return Object.fromEntries(Object.entries(descriptors).map(([key,item])=>[key,item.value]));
}
function captureChoices(value) {
  const data = own(value,['schemaVersion','base','actions']);
  const base = own(data?.base,['revision','compositionDigest','lockDigest','inventoryDigest']);
  if (!data || data.schemaVersion !== 1 || !base
    || !Number.isSafeInteger(base.revision) || base.revision < 0
    || ![base.compositionDigest,base.lockDigest,base.inventoryDigest].every(item=>typeof item === 'string' && DIGEST.test(item))
    || !Array.isArray(data.actions) || data.actions.length > MODULE_PLAN_LIMITS.actions) return null;
  const actions=[], seen=new Set();
  for (const item of data.actions) {
    const action = own(item,['kind','moduleId'],['candidateKey','audiences','dependencyId','settingId','valueRef','enabled']);
    if (!action || !ACTIONS.has(action.kind) || typeof action.moduleId !== 'string' || !ID.test(action.moduleId)
      || action.candidateKey!==undefined && !DIGEST.test(action.candidateKey)
      || ['dependencyId','settingId','valueRef'].some(key=>action[key] !== undefined
        && (typeof action[key] !== 'string' || !ID.test(action[key])))
      || action.audiences!==undefined && (!Array.isArray(action.audiences)
        || action.audiences.length>2 || new Set(action.audiences).size!==action.audiences.length
        || action.audiences.some(audience=>!['admin','app'].includes(audience)))
      || action.enabled !== undefined && typeof action.enabled !== 'boolean') return null;
    const fields = {add:['candidateKey','audiences'],update:['candidateKey'],enable:['audiences'],disable:[],remove:[],
      configure:['settingId'],integration:['dependencyId','enabled']}[action.kind];
    if (fields.some(key=>action[key] === undefined)
      || !['add','update'].includes(action.kind) && action.candidateKey !== undefined
      || !['add','enable'].includes(action.kind) && action.audiences !== undefined
      || action.kind !== 'configure' && (action.settingId !== undefined || action.valueRef !== undefined)
      || action.kind !== 'integration' && (action.dependencyId !== undefined || action.enabled !== undefined)) return null;
    const identity = `${action.kind}:${action.moduleId}:${action.settingId??action.dependencyId??''}`;
    if (seen.has(identity)) return null;
    seen.add(identity); actions.push(Object.freeze(action.audiences===undefined?action:
      {...action,audiences:Object.freeze([...action.audiences])}));
  }
  const result = Object.freeze({schemaVersion:1,base:Object.freeze(base),actions:Object.freeze(actions)});
  if (encoder.encode(canonicalJson(result)).byteLength > MODULE_PLAN_LIMITS.choicesBytes) return null;
  return result;
}

/** Same canonical digest used by T02 locks and the persistent T11 plan fields. */
export const modulePlanDigest = value => contractIntegrity(value);

function compactSummary(status, changes, dependencyOrder, disabledContributionCount, diagnosticCount) {
  if (changes.length>256 || dependencyOrder.length>256) return null;
  const summary={status,changes,dependencyOrder,disabledContributionCount,diagnosticCount,
    detailsPaged:false};
  if (encoder.encode(canonicalJson(summary)).byteLength>MODULE_PLAN_LIMITS.summaryBytes) return null;
  return Object.freeze({...summary,changes:Object.freeze([...changes]),
    dependencyOrder:Object.freeze([...dependencyOrder])});
}
function result(base, inventoryDigest, choicesDigest, next, metrics, diagnostics, changes) {
  let summary=compactSummary(next?'ready':'blocked',changes,metrics.dependencyOrder??[],
    metrics.disabledContributions?.length??0,diagnostics.length);
  if (!summary) {
    next=null;
    diagnostics=[...diagnostics,diagnostic('plan.summary_limit','/summary',
      'The complete plan impact exceeds the bounded summary; split the change.')];
    summary=compactSummary('blocked',[],[],metrics.disabledContributions?.length??0,diagnostics.length);
  }
  return Object.freeze({schemaVersion:1,base,inventoryDigest,choicesDigest,
    next:next?Object.freeze(next):null,
    nextCompositionDigest:next?contractIntegrity(next.composition):null,
    nextLockDigest:next?contractIntegrity(next.lock):null,
    summary,summaryDigest:contractIntegrity(summary),diagnostics:Object.freeze(diagnostics)});
}
function inventoryEntries(inventory) {
  const data=own(inventory,['schemaVersion','digest','candidates']);
  if (!data || data.schemaVersion!==1 || typeof data.digest!=='string' || !DIGEST.test(data.digest)
    || !Array.isArray(data.candidates) || data.candidates.length>1000
    || contractIntegrity({schemaVersion:1,candidates:data.candidates})!==data.digest) return null;
  const byKey=new Map(), byId=new Map();
  for (const candidate of data.candidates) {
    const item=own(candidate,['candidateKey','moduleId','origin','version','source','descriptor','lockNode']);
    if (!item || typeof item.candidateKey!=='string' || !DIGEST.test(item.candidateKey)
      || typeof item.moduleId!=='string' || !ID.test(item.moduleId)
      || typeof item.version!=='string' || !semver.valid(item.version)
      || item.descriptor?.identity?.id!==item.moduleId
      || item.descriptor?.identity?.version!==item.version
      || item.descriptor?.identity?.origin!==item.origin
      || item.lockNode?.moduleId!==item.moduleId || item.lockNode?.origin!==item.origin
      || item.lockNode?.version!==item.version || byKey.has(item.candidateKey)) return null;
    byKey.set(item.candidateKey,item);
    const list=byId.get(item.moduleId)??[]; list.push(item); byId.set(item.moduleId,list);
  }
  return {byKey,byId};
}
function chooseDependency(dep, byId) {
  const matches=(byId.get(dep.moduleId)??[]).filter(candidate=>candidate.origin===dep.origin
    && semver.satisfies(candidate.version,dep.versionRange));
  matches.sort((a,b)=>semver.rcompare(a.version,b.version)||a.candidateKey.localeCompare(b.candidateKey));
  return matches[0]??null;
}
function selection(candidate, previous=null) {
  const optional=candidate.descriptor.dependencies.filter(dep=>dep.optional).map(dep=>({moduleId:dep.moduleId,
    enabled:previous?.integrations?.find(item=>item.moduleId===dep.moduleId)?.enabled??false}));
  return {moduleId:candidate.moduleId,origin:candidate.origin,versionRange:candidate.version,
    source:candidate.source,enabled:previous?.enabled??true,
    configuration:previous?.configuration??[],integrations:optional};
}
function transitionDiagnostics(before,next) {
  const diagnostics=[],oldSelection=new Map(before.composition.modules.map(item=>[item.moduleId,item]));
  const oldLock=new Map(before.lock.modules.map(item=>[item.moduleId,item]));
  const newLock=new Map(next.lock.modules.map(item=>[item.moduleId,item]));
  for (const selection of next.composition.modules) {
    const previous=oldSelection.get(selection.moduleId);
    if (!previous) continue;
    const prior=oldLock.get(selection.moduleId),current=newLock.get(selection.moduleId);
    if (previous.origin!==selection.origin)
      diagnostics.push(diagnostic('transition.origin',`/next/modules/${selection.moduleId}`,
        'Changing a module origin requires a separate adoption contract.'));
    if (previous.source.kind==='package' && prior && current && prior.version===current.version
      && (prior.contractIntegrity!==current.contractIntegrity
        || prior.runtime.integrity!==current.runtime.integrity
        || prior.validation.integrity!==current.validation.integrity
        || canonicalJson(prior.source)!==canonicalJson(current.source)))
      diagnostics.push(diagnostic('transition.immutable',`/next/modules/${selection.moduleId}`,
        'A versioned package cannot change its source, contract or artifact bytes without a new version.'));
  }
  return diagnostics;
}

/** Pure preview over an inventory embedded by the host. No AJV, filesystem, network or package loading. */
export function solveModulePlan(current, suppliedChoices, inventory) {
  const choices=captureChoices(suppliedChoices);
  const fallbackBase=choices?.base??Object.freeze({revision:0,compositionDigest:'',lockDigest:'',inventoryDigest:''});
  const choicesDigest=choices?contractIntegrity(choices):null;
  const blocked=(code,path,message)=>result(fallbackBase,inventory?.digest??'',choicesDigest,null,{},
    [diagnostic(code,path,message)],[]);
  if (!choices) return blocked('plan.invalid_choices','/choices','Choices are malformed or exceed their bound.');
  const entries=inventoryEntries(inventory);
  if (!entries) return blocked('plan.invalid_inventory','/inventory','Compiled inventory is invalid.');
  if (!current || !Number.isSafeInteger(current.revision) || current.revision<0
    || !current.composition || !current.lock || !Array.isArray(current.descriptors))
    return blocked('plan.invalid_current','/current','Current composition is unavailable.');
  if (choices.base.revision!==current.revision
    || choices.base.compositionDigest!==contractIntegrity(current.composition)
    || choices.base.lockDigest!==contractIntegrity(current.lock)
    || choices.base.inventoryDigest!==inventory.digest)
    return blocked('plan.stale','/choices/base','The composition, lock or inventory changed.');
  const composition=structuredClone(current.composition), lock=structuredClone(current.lock);
  const selected=new Map(composition.modules.map(item=>[item.moduleId,item]));
  const frozen=new Map(lock.modules.map(item=>[item.moduleId,item]));
  const descriptors=new Map(current.descriptors.map(item=>[item.identity.id,item]));
  const chosen=new Map(), explicitlyRemoved=new Set(), changes=[];
  const setExposure=(moduleId,audiences)=>{
    for (const audience of ['admin','app']) {
      const listed=composition.exposure[audience].moduleIds.filter(id=>id!==moduleId);
      if (audiences.includes(audience)) listed.push(moduleId);
      composition.exposure[audience].moduleIds=listed;
    }
  };
  const refusal=(code,path,message)=>result(choices.base,inventory.digest,choicesDigest,null,{},
    [diagnostic(code,path,message)],changes);
  for (const [index,action] of choices.actions.entries()) {
    const path=`/choices/actions/${index}`;
    const old=selected.get(action.moduleId);
    if (action.kind==='add'||action.kind==='update') {
      const candidate=entries.byKey.get(action.candidateKey);
      if (!candidate || candidate.moduleId!==action.moduleId) return refusal('plan.candidate',path,'Candidate is not in the compiled inventory.');
      if (action.kind==='add' && old || action.kind==='update' && !old)
        return refusal('plan.selection',path,'Action does not match current module presence.');
      selected.set(action.moduleId,selection(candidate,old));
      frozen.set(action.moduleId,structuredClone(candidate.lockNode));
      descriptors.set(action.moduleId,candidate.descriptor); chosen.set(action.moduleId,candidate);
      if (action.kind==='add') setExposure(action.moduleId,action.audiences);
    } else {
      if (!old) return refusal('plan.selection',path,'Selected module is absent.');
      if (action.kind==='remove') { explicitlyRemoved.add(action.moduleId);
        selected.delete(action.moduleId); frozen.delete(action.moduleId);
        descriptors.delete(action.moduleId); }
      if (action.kind==='enable'||action.kind==='disable') {
        selected.set(action.moduleId,{...old,enabled:action.kind==='enable'});
        if (action.kind==='enable') setExposure(action.moduleId,action.audiences);
      }
      if (action.kind==='configure') {
        const configuration=old.configuration.filter(item=>item.setting.id!==action.settingId);
        if (action.valueRef!==undefined) configuration.push({setting:{moduleId:action.moduleId,kind:'setting',id:action.settingId},
          valueRef:action.valueRef});
        selected.set(action.moduleId,{...old,configuration});
      }
      if (action.kind==='integration') {
        if (!old.integrations.some(item=>item.moduleId===action.dependencyId))
          return refusal('plan.integration',path,'Optional integration is not declared.');
        selected.set(action.moduleId,{...old,integrations:old.integrations.map(item=>item.moduleId===action.dependencyId
          ? {...item,enabled:action.enabled}:item)});
      }
    }
    changes.push({moduleId:action.moduleId,action:action.kind});
  }
  // Required transitive dependencies may be proposed from the closed, already available inventory.
  const visiting=new Set();
  function addRequired(id) {
    if (visiting.has(id)) return;
    visiting.add(id);
    const owner=descriptors.get(id), ownerSelection=selected.get(id);
    if (!owner || !ownerSelection?.enabled) {visiting.delete(id);return;}
    for (const dep of owner.dependencies) {
      if (dep.optional) continue;
      const present=selected.get(dep.moduleId), descriptor=descriptors.get(dep.moduleId);
      if (present && descriptor && present.origin===dep.origin
        && semver.satisfies(descriptor.identity.version,dep.versionRange)) {
        addRequired(dep.moduleId); continue;
      }
      if (present || explicitlyRemoved.has(dep.moduleId)) continue;
      // A selected incompatible version and an explicit removal are never silently changed.
      const candidate=chooseDependency(dep,entries.byId);
      if (!candidate) continue; // T02 reports the exact missing dependency.
      selected.set(dep.moduleId,selection(candidate)); frozen.set(dep.moduleId,structuredClone(candidate.lockNode));
      descriptors.set(dep.moduleId,candidate.descriptor); chosen.set(dep.moduleId,candidate);
      changes.push({moduleId:dep.moduleId,action:'add-required'}); addRequired(dep.moduleId);
    }
    visiting.delete(id);
  }
  for (const id of [...selected.keys()]) addRequired(id);
  composition.modules=[...selected.values()];
  for (const audience of ['admin','app']) composition.exposure[audience].moduleIds=
    composition.exposure[audience].moduleIds.filter(id=>selected.get(id)?.enabled);
  const modules=[...descriptors.values()].filter(item=>selected.has(item.identity.id));
  lock.modules=[...selected.keys()].map(id=>{
    const node=frozen.get(id), descriptor=descriptors.get(id);
    return {...node,dependencies:descriptor.dependencies.filter(dep=>selected.has(dep.moduleId))
      .map(dep=>({moduleId:dep.moduleId,version:descriptors.get(dep.moduleId).identity.version}))};
  });
  lock.compositionIntegrity=contractIntegrity(composition);
  const diagnostics=[];
  let metrics={};
  try { metrics=checkComposition(composition,modules,lock,(code,path,message)=>{
    if (diagnostics.length<128) diagnostics.push(diagnostic(code,path,message));
  }); } catch { diagnostics.push(diagnostic('plan.invalid_state','/next','Candidate contracts are invalid.')); }
  if (diagnostics.length===0) diagnostics.push(...transitionDiagnostics(current,{composition,lock}));
  if (diagnostics.length) return result(choices.base,inventory.digest,choicesDigest,null,metrics,diagnostics,changes);
  return result(choices.base,inventory.digest,choicesDigest,{composition,lock},metrics,diagnostics,changes);
}

/** Re-solve against current state before a guarded commit; a stored summary grants no authority. */
export function verifyModulePlanForCommit({current,choices,inventory,expectedChoicesDigest,expectedSummaryDigest}) {
  const plan=solveModulePlan(current,choices,inventory);
  if (!plan.next || plan.choicesDigest!==expectedChoicesDigest || plan.summaryDigest!==expectedSummaryDigest)
    return null;
  return plan;
}
