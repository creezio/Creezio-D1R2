/** Explicit synthetic browser recipe. Never opens .wrangler/state or product data. */
import '../../../scripts/local-environment.mjs';
import {Miniflare} from 'miniflare';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {measureRuntimeArtifacts} from '../../../scripts/quality/runtime.mjs';
import {loadCompositionSchema} from '../../../scripts/data/composition-schema.mjs';
import {createAccountService, provisionBootstrapCapability} from '../../../core/identity/accounts.ts';
import {createAuthorizationService} from '../../../core/authorization/service.ts';
import {createDataAccess} from '../../../core/data/service.ts';
import {seedWitnessRecords} from '../fixtures/seed.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const origin = 'http://127.0.0.1:8793';
const themeArg = process.argv.find(value => value.startsWith('--front='))?.slice('--front='.length);
const conversations = process.argv.includes('--conversations');
const openai = process.argv.includes('--openai');
const application = process.argv.includes('--application');
if (application && themeArg) throw new Error('Application and front-witness recipes are distinct.');
if(openai && (!conversations || !process.env.CREEZIO_VAULT_KEYRING))throw new Error('OpenAI recipe requires Conversations and an operator-supplied vault keyring.');
if (themeArg && !['standard','chatgpt-like'].includes(themeArg)) throw new Error('Unknown synthetic front theme.');
const compositionPath = application ? 'configuration/composition.json' : themeArg ? `configuration/composition.front-${themeArg}.json` : 'configuration/composition.workspace-witness.json';
const plan = await loadCompositionSchema({root, compositionPath});
const persist = (!!themeArg || conversations) && process.argv.includes('--persist');
const recipe=openai?'t15-openai-browser':conversations?'t14-conversations-browser':'t13-front-browser';
const stateRoot = join(root,'.quality',recipe);
if (persist) {
  for (const folder of [root,join(root,'.quality'),stateRoot]) {
    if (existsSync(folder) && (!lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink())) throw new Error('Unsafe synthetic state path.');
  }
  mkdirSync(stateRoot,{recursive:true});
}
const markerPath=join(stateRoot,'synthetic-recipe.json');
const schemaDigest=createHash('sha256').update(JSON.stringify(plan.statements)).digest('hex');
const marker=persist&&existsSync(markerPath)?JSON.parse(readFileSync(markerPath,'utf8')):null;
if(marker&&(marker.recipe!==recipe||marker.schemaDigest!==schemaDigest))throw new Error('Synthetic state schema mismatch; preserving it without changes.');
const artifact = measureRuntimeArtifacts(root);
const runtime = new Miniflare({host:'127.0.0.1',port:8793,cf:false,d1Persist:persist?join(stateRoot,'d1'):false,r2Persist:persist?join(stateRoot,'r2'):false,
  modules:[{type:'ESModule',path:join(root,'dist/server/index.js')},
    ...artifact.files.filter(file => file.gzipBytes !== undefined && file.path !== 'dist/server/index.js')
      .map(file => ({type:'ESModule',path:join(root,file.path)}))],
  modulesRoot:join(root,'dist/server'), compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'],
  bindings:{CREEZIO_RUNTIME_PROFILE:'local',CREEZIO_APP_ORIGIN:origin,
    ...(openai?{CREEZIO_VAULT_KEYRING:process.env.CREEZIO_VAULT_KEYRING}:{})},
  d1Databases:{DB:'creezio-workspace-browser-synthetic'},r2Buckets:{BUCKET:'creezio-workspace-browser-synthetic'},
  assets:{directory:join(root,'dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true},assetConfig:{html_handling:'none',not_found_handling:'none'}},
});
const requireOk = value => {if (!value.ok) throw new Error(`Fixture refused: ${value.error}`); return value;};
try {
  await runtime.ready;
  const db = await runtime.getD1Database('DB');
  const tables=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%'").all();
  const restored=!!tables.results.length;
  if(persist && restored!==!!marker)throw new Error('Incomplete synthetic setup; preserving state for inspection.');
  if(!restored)await db.batch(plan.statements.map(sql => db.prepare(sql)));
  const module = plan.runtimeCatalog.modules.find(item => item.moduleId === 'example.workspace-witness');
  if(!application&&!module)throw new Error('The witness composition is required for this recipe.');
  const recipeModules=conversations?plan.runtimeCatalog.modules.filter(item=>[...(module?[module.moduleId]:[]),'creezio.conversations',...(openai?['creezio.openai']:[])].includes(item.moduleId)):[module];
  if(conversations&&recipeModules.length!==((openai?2:1)+(module?1:0)))throw new Error('A required module is missing from the browser recipe.');
  const permissions = recipeModules.flatMap(item=>item.permissions.map(p => ({id:`${item.moduleId}:${p.id}`,audiences:p.audiences,actors:p.actors})));
  const accounts = createAccountService(db);
  const loginIdentifier = 'workspace@example.invalid', password = 'Synthetic workspace qualification password';
  if(!restored){const capability=await provisionBootstrapCapability(db);
    requireOk(await accounts.bootstrap({token:capability.token,loginIdentifier,password,displayName:'Recette workspace'}));}
  const session = requireOk(await accounts.login({loginIdentifier,password,audience:'admin'}));
  const owner={principalId:session.session.principalId};
  const authorization = createAuthorizationService(db,{permissions});
  let current = requireOk(await authorization.readPolicy(session.token));
  if(!restored){
    const policy = structuredClone(current.policy);
    policy.roles.push({id:'workspace-witness',inherits:[],permissionIds:permissions.map(p => p.id),permissionOverrides:[]});
    policy.assignments.push({principalId:owner.principalId,contextId:'application',audience:'admin',roleId:'workspace-witness'});
    if(themeArg || conversations){
      policy.memberships.push({principalId:owner.principalId,contextId:'application',audience:'app',status:'active'});
      policy.assignments.push({principalId:owner.principalId,contextId:'application',audience:'app',roleId:'workspace-witness'});
    }
    requireOk(await authorization.replacePolicy(session.token,{expectedEpoch:current.epoch,policy}));
    if(module){const data = createDataAccess(db,{catalog:plan.runtimeCatalog,permissions});
      const lease = await data.authorize({kind:'session',token:session.token},{contextId:'application',audience:'admin',actors:['user'],requiredPermissionIds:permissions.map(p => p.id),purpose:'operation'},{moduleId:module.moduleId});
      await seedWitnessRecords(data.forModule(lease,module.moduleId)); data.dispose(lease);}
    if(persist)writeFileSync(markerPath,JSON.stringify({recipe,schemaDigest})+'\n');
  }
  const table = module?.models.find(model => model.modelId === 'record').table;
  console.log(JSON.stringify({ready:true,url:themeArg?`${origin}/${conversations?'conversations':'welcome'}`:`${origin}/workspace/admin`,theme:themeArg??null,recipe,restored,persist,
    loginIdentifier,password,artifact:artifact.digest,composition:plan.compositionDigest}));
  const lines = createInterface({input:process.stdin});
  for await (const command of lines) {
    if (command.trim() === 'stop') {lines.close();break;}
    if (command.trim() === 'records' && table) console.log(JSON.stringify({records:await db.prepare(`SELECT id,title,revision FROM "${table}" ORDER BY id`).all()}));
    if (command.trim() === 'conversations' && conversations) {
      const models=recipeModules.find(item=>item.moduleId==='creezio.conversations').models;
      const summary={};
      for(const model of models)summary[model.modelId]=(await db.prepare(`SELECT count(*) AS total FROM "${model.table}"`).first()).total;
      console.log(JSON.stringify({conversations:summary}));
    }
    if (command.trim() === 'revoke' || command.trim() === 'grant') {
      current = requireOk(await authorization.readPolicy(session.token));
      const changed = structuredClone(current.policy);
      // Explicit operator action on this synthetic fixture only; a restart never
      // restores revoked grants and no application data or account is reset.
      changed.roles.find(role => role.id === 'workspace-witness').permissionIds =
        command.trim() === 'grant' ? permissions.map(permission => permission.id) : [];
      requireOk(await authorization.replacePolicy(session.token,{expectedEpoch:current.epoch,policy:changed}));
      console.log(JSON.stringify({revoked:command.trim() === 'revoke',granted:command.trim() === 'grant'}));
    }
  }
} finally {await runtime.dispose();}
