/** Native admin UI on synthetic, memory-only data. No product state is opened. */
import '../../../scripts/local-environment.mjs';
import {Miniflare} from 'miniflare';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {measureRuntimeArtifacts} from '../../../scripts/quality/runtime.mjs';
import {loadCompositionSchema} from '../../../scripts/data/composition-schema.mjs';
import {createAccountService, provisionBootstrapCapability} from '../../../core/identity/accounts.ts';
import {createAccountLifecycleService} from '../../../core/identity/lifecycle.ts';
import {createMachineAccountService} from '../../../core/identity/machines.ts';
import {createAuthorizationService} from '../../../core/authorization/service.ts';
import {ACCESS_TABLES} from '../../../core/identity/d1-store.ts';
import {startOAuthBrowserClient} from '../../oauth/harness/browser-client.mjs';

const root = fileURLToPath(new URL('../../../',import.meta.url));
const origin = 'http://127.0.0.1:8793';
const modulesRecipe = process.argv.includes('--modules');
const moduleManage = 'creezio.modules-settings:manage';
const plan = await loadCompositionSchema({root});
const moduleCatalog = plan.runtimeCatalog.modules.find(module => module.moduleId === 'creezio.modules-settings');
if (modulesRecipe && (!moduleCatalog || !moduleCatalog.models.some(model => model.modelId === 'head')
  || !moduleCatalog.models.some(model => model.modelId === 'plans')
  || !moduleCatalog.models.some(model => model.modelId === 'journal')))
  throw new Error('The --modules recipe requires a built composition with the modules-settings models.');
const artifact = measureRuntimeArtifacts(root);
const runtime = new Miniflare({host:'127.0.0.1',port:8793,cf:false,d1Persist:false,r2Persist:false,
  modules:[{type:'ESModule',path:join(root,'dist/server/index.js')},
    ...artifact.files.filter(file=>file.gzipBytes!==undefined && file.path!=='dist/server/index.js')
      .map(file=>({type:'ESModule',path:join(root,file.path)}))],
  modulesRoot:join(root,'dist/server'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],
  bindings:{CREEZIO_RUNTIME_PROFILE:'local',CREEZIO_APP_ORIGIN:origin},
  d1Databases:{DB:'creezio-access-ui-synthetic'},r2Buckets:{BUCKET:'creezio-access-ui-synthetic'},
  assets:{directory:join(root,'dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true},
    assetConfig:{html_handling:'none',not_found_handling:'none'}},
});
const requireOk = result=>{if(!result?.ok)throw new Error(`Synthetic setup failed: ${result?.code}`);return result;};
let oauthClient;
try {
  await runtime.ready;
  const db=await runtime.getD1Database('DB');
  await db.batch(plan.statements.map(sql=>db.prepare(sql)));
  const permissions=plan.runtimeCatalog.modules.filter(module=>module.moduleId!=='creezio.access').flatMap(module=>module.permissions.map(permission=>({
    id:`${module.moduleId}:${permission.id}`,audiences:permission.audiences,actors:permission.actors})));
  const accounts=createAccountService(db), capability=await provisionBootstrapCapability(db);
  const password='Synthetic Access UI qualification password';
  const loginIdentifier='admin-ui@example.invalid';
  const owner=requireOk(await accounts.bootstrap({token:capability.token,loginIdentifier,password,displayName:'Administrateur recette'}));
  const session=requireOk(await accounts.login({loginIdentifier,password,audience:'admin'}));
  const lifecycle=createAccountLifecycleService(db,{permissions});
  const people=[];
  for(const [loginIdentifier,displayName] of [['alice-ui@example.invalid','Alice recette'],['bob-ui@example.invalid','Bob recette']]) {
    const invitation=requireOk(await lifecycle.issueInvitation(session.token,{loginIdentifier,displayName}));
    const account=requireOk(await lifecycle.redeem({token:invitation.token,purpose:'invitation',password}));
    requireOk(await accounts.login({loginIdentifier,password,audience:'admin'}));
    requireOk(await accounts.login({loginIdentifier,password,audience:'app'}));
    people.push({principalId:account.principalId,loginIdentifier,displayName});
  }
  const machine=requireOk(await createMachineAccountService(db,{permissions}).createService(session.token,{displayName:'Automatisation recette'}));
  const authorization=createAuthorizationService(db,{permissions});
  let current=requireOk(await authorization.readPolicy(session.token));
  const policy=structuredClone(current.policy);
  policy.roles.push({id:'support',inherits:[],permissionIds:[],permissionOverrides:[]},
    {id:'lecture',inherits:[],permissionIds:[],permissionOverrides:[]});
  if(modulesRecipe) {
    if(!permissions.some(permission=>permission.id===moduleManage))
      throw new Error('The composition has no declared modules-settings:manage permission.');
    policy.roles.push({id:'modules-recipe',inherits:[],permissionIds:[moduleManage],permissionOverrides:[]});
    policy.assignments.push({principalId:owner.principalId,contextId:'application',audience:'admin',roleId:'modules-recipe'});
  }
  policy.contexts.push({id:'secondaire',status:'active'});
  for(const person of people) for(const [contextId,audience] of [['application','admin'],['application','app'],['secondaire','app']]) {
    policy.memberships.push({principalId:person.principalId,contextId,audience,status:'active'});
    policy.assignments.push({principalId:person.principalId,contextId,audience,roleId:'lecture'});
  }
  requireOk(await authorization.replacePolicy(session.token,{expectedEpoch:current.epoch,policy}));
  if(process.argv.includes('--oauth')) oauthClient=await startOAuthBrowserClient(origin);
  console.log(JSON.stringify({ready:true,url:modulesRecipe
    ? `${origin}/workspace/admin?context=application&view=%2Fadmin%2Fmodules`
    : `${origin}/workspace/admin?context=application&view=%2Fadmin%2Faccess`,
    loginIdentifier,password,owner:owner.principalId,people,machine:machine.principal.id,artifact:artifact.digest,
    ...(modulesRecipe?{composition:plan.compositionDigest}:{})}));
  if(oauthClient)console.log(JSON.stringify({oauthAuthorizeUrl:oauthClient.begin()}));
  const lines=createInterface({input:process.stdin});
  for await(const line of lines) {
    if(line.trim()==='stop'){lines.close();break;}
    if(line.trim()==='oauth' && oauthClient)console.log(JSON.stringify({oauthAuthorizeUrl:oauthClient.begin()}));
    if(line.trim()==='oauth-empty' && oauthClient)console.log(JSON.stringify({oauthAuthorizeUrl:oauthClient.begin('')}));
    if(line.trim()==='policy')console.log(JSON.stringify(requireOk(await authorization.readPolicy(session.token))));
    if(line.trim()==='audit')console.log(JSON.stringify(await db.prepare(`SELECT id,action,created_at_ms FROM "${ACCESS_TABLES.access_audit}" ORDER BY created_at_ms DESC,id DESC LIMIT 20`).all()));
    if(modulesRecipe && ['module-head','module-plans','module-journal'].includes(line.trim())) {
      const modelId={'module-head':'head','module-plans':'plans','module-journal':'journal'}[line.trim()];
      const table=moduleCatalog.models.find(model=>model.modelId===modelId).table.replaceAll('"','""');
      const order=modelId==='head'?'id':'revision DESC';
      console.log(JSON.stringify(await db.prepare(`SELECT * FROM "${table}" ORDER BY ${order} LIMIT 20`).all()));
    }
    if(modulesRecipe && ['modules-revoke','modules-grant'].includes(line.trim())) {
      current=requireOk(await authorization.readPolicy(session.token));
      const changed=structuredClone(current.policy), role=changed.roles.find(role=>role.id==='modules-recipe');
      role.permissionIds=line.trim()==='modules-grant'?[moduleManage]:[];
      console.log(JSON.stringify(await authorization.replacePolicy(session.token,{expectedEpoch:current.epoch,policy:changed})));
    }
    if(line.trim()==='external-change') {
      current=requireOk(await authorization.readPolicy(session.token));
      const changed=structuredClone(current.policy), role=changed.roles.find(role=>role.id==='support');
      role.permissionOverrides=role.permissionOverrides.length?[]:[{permissionId:'creezio.access:impersonate',effect:'deny'}];
      console.log(JSON.stringify(await authorization.replacePolicy(session.token,{expectedEpoch:current.epoch,policy:changed})));
    }
  }
} finally {await oauthClient?.close();await runtime.dispose();}
