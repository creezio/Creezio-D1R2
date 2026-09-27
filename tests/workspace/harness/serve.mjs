/** Explicit synthetic browser recipe. Never opens .wrangler/state or product data. */
import '../../../scripts/local-environment.mjs';
import {Miniflare} from 'miniflare';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {measureRuntimeArtifacts} from '../../../scripts/quality/runtime.mjs';
import {loadCompositionSchema} from '../../../scripts/data/composition-schema.mjs';
import {createAccountService, provisionBootstrapCapability} from '../../../core/identity/accounts.ts';
import {createAuthorizationService} from '../../../core/authorization/service.ts';
import {createDataAccess} from '../../../core/data/service.ts';
import {seedWitnessRecords} from '../fixtures/seed.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const origin = 'http://127.0.0.1:8793';
const plan = await loadCompositionSchema({root, compositionPath:'configuration/composition.workspace-witness.json'});
const artifact = measureRuntimeArtifacts(root);
const runtime = new Miniflare({host:'127.0.0.1',port:8793,cf:false,d1Persist:false,r2Persist:false,
  modules:[{type:'ESModule',path:join(root,'dist/server/index.js')},
    ...artifact.files.filter(file => file.gzipBytes !== undefined && file.path !== 'dist/server/index.js')
      .map(file => ({type:'ESModule',path:join(root,file.path)}))],
  modulesRoot:join(root,'dist/server'), compatibilityDate:'2026-05-15', compatibilityFlags:['nodejs_compat'],
  bindings:{CREEZIO_RUNTIME_PROFILE:'local',CREEZIO_APP_ORIGIN:origin},
  d1Databases:{DB:'creezio-workspace-browser-synthetic'},r2Buckets:{BUCKET:'creezio-workspace-browser-synthetic'},
  assets:{directory:join(root,'dist/client'),binding:'ASSETS',routerConfig:{has_user_worker:true},assetConfig:{html_handling:'none',not_found_handling:'none'}},
});
const requireOk = value => {if (!value.ok) throw new Error(`Fixture refused: ${value.error}`); return value;};
try {
  await runtime.ready;
  const db = await runtime.getD1Database('DB');
  await db.batch(plan.statements.map(sql => db.prepare(sql)));
  const module = plan.runtimeCatalog.modules.find(item => item.moduleId !== 'creezio.access');
  const permissions = module.permissions.map(p => ({id:`${module.moduleId}:${p.id}`,audiences:p.audiences,actors:p.actors}));
  const accounts = createAccountService(db), capability = await provisionBootstrapCapability(db);
  const loginIdentifier = 'workspace@example.invalid', password = 'Synthetic workspace qualification password';
  const owner = requireOk(await accounts.bootstrap({token:capability.token,loginIdentifier,password,displayName:'Recette workspace'}));
  const session = requireOk(await accounts.login({loginIdentifier,password,audience:'admin'}));
  const authorization = createAuthorizationService(db,{permissions});
  let current = requireOk(await authorization.readPolicy(session.token));
  const policy = structuredClone(current.policy);
  policy.roles.push({id:'workspace-witness',inherits:[],permissionIds:permissions.map(p => p.id),permissionOverrides:[]});
  policy.assignments.push({principalId:owner.principalId,contextId:'application',audience:'admin',roleId:'workspace-witness'});
  requireOk(await authorization.replacePolicy(session.token,{expectedEpoch:current.epoch,policy}));
  const data = createDataAccess(db,{catalog:plan.runtimeCatalog,permissions});
  const lease = await data.authorize({kind:'session',token:session.token},{contextId:'application',audience:'admin',actors:['user'],requiredPermissionIds:permissions.map(p => p.id),purpose:'operation'},{moduleId:module.moduleId});
  await seedWitnessRecords(data.forModule(lease,module.moduleId)); data.dispose(lease);
  const table = module.models.find(model => model.modelId === 'record').table;
  console.log(JSON.stringify({ready:true,url:`${origin}/workspace/admin`,loginIdentifier,password,artifact:artifact.digest,composition:plan.compositionDigest}));
  const lines = createInterface({input:process.stdin});
  for await (const command of lines) {
    if (command.trim() === 'stop') {lines.close();break;}
    if (command.trim() === 'records') console.log(JSON.stringify({records:await db.prepare(`SELECT id,title,revision FROM "${table}" ORDER BY id`).all()}));
    if (command.trim() === 'revoke') {
      current = requireOk(await authorization.readPolicy(session.token));
      const changed = structuredClone(current.policy);
      changed.roles.find(role => role.id === 'workspace-witness').permissionIds = [];
      requireOk(await authorization.replacePolicy(session.token,{expectedEpoch:current.epoch,policy:changed}));
      console.log(JSON.stringify({revoked:true}));
    }
  }
} finally {await runtime.dispose();}
