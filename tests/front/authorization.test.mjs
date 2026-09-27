import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrontAuthorizationService} from '../../core/front/authorization.ts';
import {projectSurfaceAuthorization} from '../../core/workspace/authorization.ts';

const digest = `sha256-${'a'.repeat(64)}`;
const ref = id => ({moduleId:'example.notes',kind:'permission',id});
const permissions = [
  {id:'example.notes:read',actors:['user'],audiences:['app']},
  {id:'example.notes:write',actors:['user'],audiences:['app']},
];
const view = (id, permission) => ({id:`example.notes:${id}`,surfaces:['front'],audiences:['app'],
  permissions:permission ? [ref(permission)] : []});
const catalog = {compositionDigest:digest,
  views:[view('list','read'),view('edit','write')],
  navigation:[{...view('list-nav'),viewId:'example.notes:list'},
    {...view('edit-nav'),viewId:'example.notes:edit'}],
  slots:[{...view('list-slot'),slot:'front.sidebar',viewId:'example.notes:list'},
    {...view('write-slot','write'),slot:'front.sidebar',viewId:'example.notes:list'},
    {...view('edit-slot'),slot:'front.context',viewId:'example.notes:edit'}]};
const state = {epoch:7,nowMs:100,session:{id:'session-app',principalId:'person',audience:'app',expiresAtMs:200},
  policy:{contexts:[{id:'application',status:'active'}],
    memberships:[{principalId:'person',contextId:'application',audience:'app',status:'active'}],
    roles:[{id:'reader',inherits:[],permissionIds:['example.notes:read'],permissionOverrides:[]}],
    assignments:[{principalId:'person',contextId:'application',audience:'app',roleId:'reader'}],overrides:[]}};

test('front projection gates slots by their own permission and target view under the same app ACL epoch', () => {
  const result = projectSurfaceAuthorization(state,catalog,permissions,'application','app','front');
  assert.deepEqual(result,{sessionId:'session-app',principalId:'person',audience:'app',contextId:'application',
    compositionDigest:digest,epoch:7,viewIds:['example.notes:list'],navigationIds:['example.notes:list-nav'],
    slotIds:['example.notes:list-slot']});
  assert.equal(projectSurfaceAuthorization(state,catalog,permissions,'other','app','front'),null);
  assert.equal(projectSurfaceAuthorization(state,catalog,permissions,'application','admin','front'),null);
  const revoked = {...state,epoch:8,policy:{...state.policy,overrides:[{principalId:'person',contextId:'application',
    audience:'app',permissionId:'example.notes:read',effect:'deny'}]}};
  assert.deepEqual(projectSurfaceAuthorization(revoked,catalog,permissions,'application','app','front')?.slotIds,[]);
});

test('front authorization validates a front-only catalogue before a D1 read', () => {
  const db = {prepare() {assert.fail('No D1 read during catalogue validation');}};
  assert.doesNotThrow(() => createFrontAuthorizationService(db,{permissions,catalog}));
  for (const bad of [
    {...catalog,views:[{...catalog.views[0],surfaces:['workspace']}]},
    {...catalog,views:[{...catalog.views[0],permissions:[ref('missing')]}]},
    {...catalog,navigation:[{...catalog.navigation[0],viewId:'example.notes:unknown'}]},
    {...catalog,slots:[{...catalog.slots[0],viewId:'example.notes:unknown'}]},
    {...catalog,slots:[catalog.slots[0],catalog.slots[0]]},
  ]) assert.throws(() => createFrontAuthorizationService(db,{permissions,catalog:bad}));
});
