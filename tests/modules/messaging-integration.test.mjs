import '../../scripts/local-environment.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {Miniflare} from 'miniflare';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {generateD1Schema} from '../../scripts/data/d1-schema.mjs';
import {OPERATION_MODELS, OPERATION_STORAGE_MODULE_ID} from '../../core/operations/models.ts';
import {createAccountService, provisionBootstrapCapability} from '../../core/identity/accounts.ts';
import {createAccountLifecycleService} from '../../core/identity/lifecycle.ts';
import {createMachineAccountService} from '../../core/identity/machines.ts';
import {createAuthorizationService} from '../../core/authorization/service.ts';
import {createOperationRegistry} from '../../core/operations/registry.ts';
import {createOperationEngine} from '../../core/operations/service.ts';
import {createDataAccess} from '../../core/data/service.ts';
import {createFileService} from '../../core/files/service.ts';
import {dispatchFileHttp} from '../../core/files/http.ts';
import {fileOwnerId} from '../../core/files/catalog.ts';
import {compileHttpBindings} from '../../scripts/operations/http-bindings.mjs';
import {createOperationHttpTransport} from '../../core/operations/http.ts';
import {Client, StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {compileMcpBindings} from '../../scripts/mcp/bindings.mjs';
import {compileWidgetCatalog} from '../../scripts/widgets/compile.mjs';
import {createMcpHttpTransport} from '../../core/mcp/http.ts';
import * as handlers from '../../extensions/native/messaging/module/operations.ts';

const json = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const manifest = json('../../extensions/native/messaging/module/manifest.json');
const moduleId = manifest.identity.id, digest = `sha256-${'8'.repeat(64)}`;
const generated = generateD1Schema(moduleId, manifest.contracts.models);
const access = generateD1Schema('creezio.access', json('../../extensions/native/access/module/models.json'));
const technical = generateD1Schema(OPERATION_STORAGE_MODULE_ID, OPERATION_MODELS);
const permissions = manifest.contracts.permissions.map(permission => ({
  id: `${moduleId}:${permission.id}`, audiences: permission.audiences, actors: permission.actors}));
const catalog = {schemaVersion: 1, compositionDigest: digest, modules: [{moduleId,
  version: manifest.identity.version, enabled: true, permissions: manifest.contracts.permissions,
  models: manifest.contracts.models.map(model => ({modelId: model.id, table: generated.tables[model.id], model}))}]};
const fileCatalog = {compositionDigest: digest, categories: manifest.contracts.files.map(category =>
  ({moduleId, category, audiences: ['admin', 'app']}))};

function operationRegistry() {
  const ajv = addFormats(new Ajv2020({strict: true, allErrors: false, coerceTypes: false, removeAdditional: false}));
  const validators = {}, schemaNames = new Map();
  for (const [index, item] of manifest.contracts.schemas.entries()) {
    const name = `schema_${index}`;
    schemaNames.set(item.id, name);
    validators[name] = ajv.compile(item.schema);
  }
  const operationCatalog = {schemaVersion: 1, compositionDigest: digest, modules: [{moduleId,
    version: manifest.identity.version, enabled: true,
    schemas: [...schemaNames].map(([schemaId, validator]) => ({schemaId, validator})),
    operations: manifest.contracts.operations.map(operation => ({operation, active: true, contractDigest: digest,
      inputValidator: schemaNames.get(operation.input.schemaId), outputValidator: schemaNames.get(operation.output.schemaId)}))}]};
  return createOperationRegistry({catalog: operationCatalog, validators,
    handlers: Object.fromEntries(manifest.contracts.operations.map(op => [`${moduleId}:${op.id}`, handlers[op.handler.export]]))});
}
const good = result => {assert.equal(result.ok, true, JSON.stringify(result)); return result;};
const success = result => {assert.equal(result.execution.state, 'succeeded', JSON.stringify(result)); return result.execution.output;};
const rejected = async (promise, code) => {
  const result = await promise.catch(error => error);
  assert.notEqual(result?.execution?.state, 'succeeded');
  assert.equal(result.code ?? result.execution?.errorCode, code, JSON.stringify(result));
};

test('native messaging persists drafts and private files through the real D1 operation engine', {timeout: 90000}, async () => {
  const runtime = new Miniflare({host: '127.0.0.1', port: 0, cf: false, modules: true,
    compatibilityDate: '2026-05-15', script: 'export default {fetch(){return new Response(null,{status:404})}}',
    d1Databases: {DB: 'creezio-messaging-integration'}, r2Buckets: ['BUCKET'], d1Persist: false, r2Persist: false});
  let data, lease, appLease;
  try {
    const db = await runtime.getD1Database('DB'), bucket = await runtime.getR2Bucket('BUCKET');
    await db.batch([...access.statements, ...technical.statements, ...generated.statements].map(sql => db.prepare(sql)));
    const accounts = createAccountService(db), bootstrap = await provisionBootstrapCapability(db);
    const password = 'Synthetic messaging integration password';
    const owner = good(await accounts.bootstrap({token: bootstrap.token, loginIdentifier: 'mail-owner@example.invalid',
      displayName: 'Mail owner', password}));
    const ownerAdmin = good(await accounts.login({loginIdentifier: 'mail-owner@example.invalid', password, audience: 'admin'}));
    const ownerApp = good(await accounts.login({loginIdentifier: 'mail-owner@example.invalid', password, audience: 'app'}));
    const lifecycle = createAccountLifecycleService(db, {permissions});
    const invitation = good(await lifecycle.issueInvitation(ownerAdmin.token,
      {loginIdentifier: 'mail-other@example.invalid', displayName: 'Other mail user'}));
    const other = good(await lifecycle.redeem({token: invitation.token, purpose: 'invitation', password}));
    const otherAdmin = good(await accounts.login({loginIdentifier: 'mail-other@example.invalid', password, audience: 'admin'}));
    const machines = createMachineAccountService(db, {permissions});
    const machine = good(await machines.createService(ownerAdmin.token, {displayName: 'Mail API client'})).principal;
    const acl = createAuthorizationService(db, {permissions}), before = good(await acl.readPolicy(ownerAdmin.token));
    const policy = structuredClone(before.policy);
    policy.roles.push({id: 'messaging-user', inherits: [], permissionIds: [`${moduleId}:use`], permissionOverrides: []});
    policy.contexts.push({id: 'other', status: 'active'});
    for (const [principalId, audience, contextId] of [[owner.principalId, 'admin', 'application'],
      [owner.principalId, 'app', 'application'], [owner.principalId, 'admin', 'other'], [other.principalId, 'admin', 'application'],
      [machine.id, 'app', 'application']]) {
      if (!policy.memberships.some(row => row.principalId === principalId && row.audience === audience && row.contextId === contextId))
        policy.memberships.push({principalId, audience, contextId, status: 'active'});
      policy.assignments.push({principalId, audience, contextId, roleId: 'messaging-user'});
    }
    good(await acl.replacePolicy(ownerAdmin.token, {expectedEpoch: before.epoch, policy}));
    const apiToken = good(await machines.issueToken(ownerAdmin.token, {principalId: machine.id, label: 'Messaging test',
      ttlMs: 60000, scopes: [{contextId: 'application', audience: 'app', permissionIds: [`${moduleId}:use`]}]})).token;
    const makeEngine = () => createOperationEngine({db, catalog, registry: operationRegistry(), permissions,
      files: {catalog: fileCatalog, bucket}});
    let engine = makeEngine();
    const invoke = (operationId, input, {token = ownerAdmin.token, audience = 'admin', contextId = 'application'} = {}) =>
      engine.invoke({credential: {kind: 'session', token}, moduleId, operationId, contextId, audience, input});
    const boxInput = {requestKey: 'mail-box', name: 'Boîte personnelle', address: 'owner@example.invalid'};
    const box = success(await invoke('box.create', boxInput)).box;
    assert.equal(success(await invoke('box.create', boxInput)).box.id, box.id, 'replay keeps the same mailbox');
    assert.equal(success(await invoke('box.list', {limit: 10})).items.length, 1);
    const boxPreview = success(await invoke('box.preview.list', {limit: 5}));
    assert.equal(boxPreview.items[0].id, box.id);
    assert.equal(Object.hasOwn(boxPreview.items[0], 'name'), false);
    const appScope = {token: ownerApp.token, audience: 'app'};
    assert.equal(success(await invoke('box.list', {limit: 10}, appScope)).items[0].id, box.id,
      'the same owner sees an admin-created box in app');
    const appBox = success(await invoke('box.create', {requestKey: 'app-mail-box',
      name: 'Boîte créée dans l’app', address: ''}, appScope)).box;
    assert.ok(success(await invoke('box.list', {limit: 10})).items.some(item=>item.id===appBox.id),
      'admin sees a box created in app');
    const draft = success(await invoke('draft.create', {requestKey: 'mail-draft', boxId: box.id})).draft;
    const privateRead = {boxId: box.id, draftId: draft.id};
    assert.equal(success(await invoke('draft.read', privateRead, appScope)).draft.id,draft.id);
    const saved = success(await invoke('draft.save', {...privateRead, requestKey: 'mail-save', revision: draft.revision,
      to: 'recipient@example.invalid', cc: '', bcc: '', subject: 'Brouillon conservé',
      text: 'Contenu privé', html: '<p>Contenu <strong>privé</strong></p><img src=x onerror=alert(1)>'})).draft;
    assert.equal(saved.revision, 2);
    assert.ok(!saved.html.includes('<img'));
    assert.equal(success(await invoke('draft.read', privateRead)).draft.text, 'Contenu privé');
    const draftPreview = success(await invoke('draft.preview.list', {boxId: box.id, limit: 5}));
    assert.equal(draftPreview.items[0].id, draft.id);
    assert.equal(Object.hasOwn(draftPreview.items[0], 'text'), false);
    assert.equal(Object.hasOwn(draftPreview.items[0], 'html'), false);
    await rejected(invoke('draft.save', {...privateRead, requestKey: 'mail-stale', revision: 1,
      to: '', cc: '', bcc: '', subject: 'Lost update', text: '', html: ''}), 'conflict');
    const appDraft = success(await invoke('draft.create', {requestKey: 'app-mail-draft',boxId:box.id},appScope)).draft;
    const appRead = {boxId:box.id,draftId:appDraft.id};
    assert.equal(success(await invoke('draft.read',appRead)).draft.id,appDraft.id,
      'admin sees an app-created draft');
    const crossInput={...appRead,to:'recipient@example.invalid',cc:'',bcc:'',subject:'Partagé',
      text:'Modification croisée',html:'<p>Partagé</p>'};
    const adminSaved=success(await invoke('draft.save',{...crossInput,requestKey:'admin-cross-save',
      revision:appDraft.revision})).draft;
    await rejected(invoke('draft.save',{...crossInput,requestKey:'app-cross-stale',
      revision:appDraft.revision},appScope),'conflict');
    const appSaved=success(await invoke('draft.save',{...crossInput,requestKey:'app-cross-save',
      revision:adminSaved.revision},appScope)).draft;
    assert.equal(success(await invoke('draft.read',appRead)).draft.revision,appSaved.revision);
    await rejected(invoke('draft.save',{...crossInput,requestKey:'admin-cross-stale',
      revision:adminSaved.revision}),'conflict');
    for (const scope of [{token: otherAdmin.token}, {contextId: 'other'}]) {
      await rejected(invoke('draft.read', privateRead, scope), 'not_found');
      assert.deepEqual(success(await invoke('box.list', {limit: 10}, scope)).items, []);
    }
    const seenDrafts=new Set();let draftCursor;
    do {const page=success(await invoke('draft.list',{boxId:box.id,limit:10,
      ...(draftCursor?{cursor:draftCursor}:{})},appScope));
      for(const item of page.items)seenDrafts.add(item.id);draftCursor=page.nextCursor;
    }while(draftCursor&&seenDrafts.size<2);
    assert.deepEqual(seenDrafts,new Set([draft.id,appDraft.id]));
    assert.deepEqual({...success(await invoke('transport.status', {}))},
      {state: 'unavailable', send: false, receive: false, from: null});
    await rejected(invoke('message.send', {...privateRead, requestKey: 'mail-send', revision: saved.revision}), 'unavailable');
    assert.equal(success(await invoke('draft.read', privateRead)).draft.revision, saved.revision);
    assert.deepEqual(success(await invoke('message.list', {boxId: box.id, limit: 10})).items, []);

    const received = {context_id: 'application', owner_id: owner.principalId, box_id: box.id,
      id: 'received-message', direction: 'inbound', from_addr: 'sender@example.invalid', to_addr: 'owner@example.invalid',
      cc_addr: '', subject: 'Facture reçue', text_body: `Contenu fournisseur ${'x'.repeat(150)}`,
      html_body: '<p>Contenu fournisseur</p>',
      state: 'received', folder: 'inbox', read_at: null, thread_id: 'thread-1', reply_to: null, in_reply_to: null,
      provider_message_id: null, received_at: new Date().toISOString(), sent_at: null,
      created_at: new Date().toISOString(), revision: 1};
    const fields = Object.keys(received);
    await db.prepare(`INSERT INTO "${generated.tables.message}" (${fields.map(name => `"${name}"`).join(',')})
      VALUES (${fields.map(() => '?').join(',')})`).bind(...fields.map(name => received[name])).run();
    await db.batch(Array.from({length: 25}, (_, index) => {
      const row = {...received, id: `noise-${index}`, folder: 'trash', thread_id: 'noise-thread',
        read_at: received.received_at, subject: 'Autre dossier',
        created_at: new Date(Date.now() + (index + 1) * 1000).toISOString()};
      return db.prepare(`INSERT INTO "${generated.tables.message}" (${fields.map(name => `"${name}"`).join(',')})
        VALUES (${fields.map(() => '?').join(',')})`).bind(...fields.map(name => row[name]));
    }));
    const found = success(await invoke('message.list', {boxId: box.id, limit: 10, folder: 'inbox', unread: true, query: 'fournisseur'}));
    assert.equal(found.items[0].id, received.id);
    const messagePreview = success(await invoke('message.preview.list', {boxId: box.id, limit: 5,
      folder: 'inbox', unread: true, query: 'fournisseur'}, appScope));
    assert.equal(messagePreview.items[0].id, received.id);
    assert.equal(messagePreview.items[0].bodyExcerpt.length, 48);
    assert.equal(messagePreview.items[0].bodyHasMore, true);
    assert.equal(Object.hasOwn(messagePreview.items[0], 'text'), false);
    assert.ok(Buffer.byteLength(JSON.stringify(messagePreview)) < 8192);
    await rejected(invoke('message.preview.list', {boxId: box.id, limit: 5},
      {token: otherAdmin.token}), 'not_found');
    assert.equal(success(await invoke('message.read',{boxId:box.id,messageId:received.id},appScope)).message.id,received.id);
    assert.equal(success(await invoke('message.list', {boxId: box.id, limit: 10, threadId: 'thread-1'})).items[0].id, received.id);
    assert.equal(success(await invoke('message.list', {boxId: box.id, limit: 10, unread: true})).items[0].id, received.id);
    const classified = success(await invoke('message.update', {requestKey: 'mail-classify', boxId: box.id,
      messageId: received.id, revision: 1, folder: 'archive', read: true})).message;
    assert.equal(classified.revision, 2);
    assert.equal(classified.read, true);
    assert.equal(classified.folder, 'archive');
    assert.deepEqual(success(await invoke('message.list', {boxId: box.id, limit: 10, folder: 'inbox'})).items, []);
    await rejected(invoke('message.update', {requestKey: 'mail-classify-stale', boxId: box.id,
      messageId: received.id, revision: 1, folder: 'trash'}), 'conflict');
    await rejected(invoke('message.update', {requestKey: 'app-classify-stale', boxId: box.id,
      messageId: received.id, revision: 1, folder: 'trash'},appScope), 'conflict');
    assert.equal(success(await invoke('message.read',{boxId:box.id,messageId:received.id},appScope)).message.folder,'archive');
    await rejected(invoke('message.read', {boxId: box.id, messageId: received.id}, {token: otherAdmin.token}), 'not_found');

    const registered = operationRegistry();
    const httpBindings = compileHttpBindings({composition: {modules: [{moduleId, enabled: true}],
      exposure: {admin: {moduleIds: [moduleId]}, app: {moduleIds: [moduleId]}}}, modules: [manifest], operationCatalog: registered.catalog});
    const http = createOperationHttpTransport(httpBindings, engine), origin = 'https://mail.example.invalid';
    const httpRequest = (path, token, body) => new Request(`${origin}${path}`, {method: body ? 'POST' : 'GET',
      headers: {authorization: `Bearer ${token}`, 'x-creezio-context': 'application',
        ...(body ? {'content-type': 'application/json', 'x-creezio-request': '1'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {})});
    const dispatch = request => http.dispatch(request, {profile: 'sites', bindings: {DB: db, BUCKET: bucket}},
      {CREEZIO_APP_ORIGIN: origin}, 'messaging-native-http');
    const machineBox = await dispatch(httpRequest('/api/app/messaging/box/create', apiToken,
      {requestKey: 'machine-mailbox', name: 'Machine box', address: ''}));
    assert.equal(machineBox.status, 200, await machineBox.clone().text());
    assert.equal((await machineBox.json()).execution.state, 'succeeded');
    const machineList = await dispatch(httpRequest('/api/app/messaging/box/list?limit=10', apiToken));
    assert.equal(machineList.status, 200, await machineList.clone().text());
    const machineItems = (await machineList.json()).execution.output.items;
    assert.equal(machineItems.length, 1);
    assert.notEqual(machineItems[0].id, box.id);
    const wrongAudience = await dispatch(httpRequest('/api/admin/messaging/box/list?limit=10', apiToken));
    assert.equal(wrongAudience.status, 401);
    assert.equal((await wrongAudience.json()).error.code, 'unauthorized');
    const composition = {modules: [{moduleId, enabled: true}],
      exposure: {admin: {moduleIds: [moduleId]}, app: {moduleIds: [moduleId]}}};
    const widgetCatalog = compileWidgetCatalog({composition, modules: [manifest],
      operationCatalog: registered.catalog,
      readAsset: (_id, relative) => readFileSync(new URL(`../../extensions/native/messaging/${relative}`,
        import.meta.url), 'utf8'),
      bundleRenderer: (_id, reference) => buildSync({entryPoints: [fileURLToPath(new URL(
        `../../extensions/native/messaging/${reference.path}`, import.meta.url))], bundle: true,
        write: false, platform: 'browser', format: 'iife', globalName: '__creezioWidget', target: 'es2022',
        minify: true, footer: {js: `__creezioWidget.${reference.export}();`}}).outputFiles[0].text});
    assert.equal(widgetCatalog.widgets.length, 3);
    const mcpBindings = compileMcpBindings({composition, modules: [manifest],
      operationCatalog: registered.catalog, widgetCatalog});
    const mcp = createMcpHttpTransport(mcpBindings, registered, engine, {origin,
      resourceMetadataUrl: audience => `${origin}/.well-known/oauth-protected-resource/mcp/${audience}`,
      authenticate: async (request, audience) => {
        const token = request.headers.get('authorization')?.replace(/^Bearer /, '');
        const checked = await machines.check(token, {contextId: 'application', audience, actors: ['machine'],
          requiredPermissionIds: [`${moduleId}:use`], purpose: 'operation'});
        return checked.allowed ? {credential: {kind: 'api-token', token}, contextId: 'application'} : null;
      }, canDiscover: async (identity, target) => (await machines.check(identity.credential.token,
        {contextId: target.contextId, audience: target.audience, actors: target.actors,
          requiredPermissionIds: target.permissionIds, purpose: 'operation'})).allowed});
    const client = new Client({name: 'messaging-integration', version: '1.0.0'});
    const wire = new StreamableHTTPClientTransport(new URL(`${origin}/mcp/app`), {
      authProvider: {token: async () => apiToken},
      fetch: (input, init) => mcp.dispatch(new Request(input, init), 'app', 'messaging-native-mcp')});
    try {
      await client.connect(wire);
      const tools = (await client.listTools()).tools;
      assert.ok(tools.some(tool => tool.name === 'messaging_box_list'));
      const toolResult = await client.callTool({name: 'messaging_box_list', arguments: {limit: 10}});
      assert.equal(toolResult.structuredContent.items[0].id, machineItems[0].id);
      assert.notEqual(toolResult.structuredContent.items[0].id, box.id);
      const widgetResult = await client.callTool({name: 'messaging_box_preview_list', arguments: {limit: 5}});
      assert.equal(widgetResult.structuredContent.input.items[0].id, machineItems[0].id);
      assert.ok(tools.find(tool => tool.name === 'messaging_box_preview_list')._meta?.ui?.resourceUri);
    } finally {await client.close();}

    data = createDataAccess(db, {catalog, permissions});
    lease = await data.authorize({kind: 'session', token: ownerAdmin.token},
      {contextId: 'application', audience: 'admin', actors: ['user'], requiredPermissionIds: [`${moduleId}:use`], purpose: 'operation'}, {moduleId});
    const category = manifest.contracts.files.find(item => item.id === 'attachments');
    assert.equal(category.ownerScope,'principal');
    const ownerId = await fileOwnerId(owner.principalId, 'admin', category.ownerScope);
    assert.equal(ownerId,await fileOwnerId(owner.principalId,'app',category.ownerScope));
    const files = createFileService({data, catalog, moduleId, category, bucket, ownerId});
    const adminBytes = new TextEncoder().encode('private attachment · é');
    const staged = await files.stage(lease, {ownerId, intentId: 'mail-file', generation: '1', filename: 'note.txt',
      contentType: 'text/plain', bytes: adminBytes});
    const linked = success(await invoke('attachment.link', {...privateRead, requestKey: 'mail-link',
      revision: saved.revision, staged}));
    assert.equal(linked.attachment.fileId, staged.fileId);
    assert.equal(linked.draft.revision, saved.revision + 1);
    assert.equal(success(await invoke('attachment.list', {...privateRead, limit: 50})).items[0].reference.digest, staged.digest,
      'the maximum UI page includes the mailbox and draft authorization reads in its work budget');
    const readFile = (audience, token, reference=staged, contextId='application') => dispatchFileHttp(new Request(
      `http://127.0.0.1:8787/api/files/${audience}/${moduleId}/attachments?${new URLSearchParams(reference)}`,
      {headers: {cookie: `creezio-local-${audience}=${token}`, 'x-creezio-context': contextId}}),
      {profile: 'local', bindings: {DB: db, BUCKET: bucket}}, {CREEZIO_APP_ORIGIN: 'http://127.0.0.1:8787'},
      'messaging-private-file', {catalog, files: fileCatalog, permissions});
    const ownFile = await readFile('admin', ownerAdmin.token);
    assert.equal(ownFile.status, 200);
    assert.deepEqual(new Uint8Array(await ownFile.arrayBuffer()),adminBytes);
    const sharedFile = await readFile('app', ownerApp.token);
    assert.equal(sharedFile.status,200);
    assert.deepEqual(new Uint8Array(await sharedFile.arrayBuffer()),adminBytes,
      'the same principal reads byte-identical admin bytes through app');
    assert.equal((await readFile('admin', otherAdmin.token)).status, 404);
    assert.equal((await readFile('admin', ownerAdmin.token,staged,'other')).status,404);
    appLease = await data.authorize({kind:'session',token:ownerApp.token},
      {contextId:'application',audience:'app',actors:['user'],requiredPermissionIds:[`${moduleId}:use`],
        purpose:'operation'},{moduleId});
    const appFiles=createFileService({data,catalog,moduleId,category,bucket,ownerId});
    const appBytes=new Uint8Array([0,1,2,42,127,128,254,255]);
    const appStaged=await appFiles.stage(appLease,{ownerId,intentId:'app-mail-file',generation:'1',
      filename:'app-note.txt',contentType:'text/plain',bytes:appBytes});
    const appLinked=success(await invoke('attachment.link',{...privateRead,requestKey:'app-mail-link',
      revision:linked.draft.revision,staged:appStaged},appScope));
    assert.equal(appLinked.draft.revision,linked.draft.revision+1);
    assert.deepEqual(new Set(success(await invoke('attachment.list',{...privateRead,limit:50})).items.map(item=>item.fileId)),
      new Set([staged.fileId,appStaged.fileId]));
    const appUploadRead=await readFile('admin',ownerAdmin.token,appStaged);
    assert.equal(appUploadRead.status,200);
    assert.deepEqual(new Uint8Array(await appUploadRead.arrayBuffer()),appBytes,
      'admin reads byte-identical app bytes');
    assert.equal((await readFile('admin',otherAdmin.token,appStaged)).status,404);
    await rejected(invoke('draft.delete', {...privateRead, requestKey: 'mail-delete-linked', revision: appLinked.draft.revision}), 'conflict');

    engine = makeEngine();
    assert.equal(success(await invoke('draft.read', privateRead)).draft.subject, 'Brouillon conservé');
    assert.equal(success(await invoke('draft.read', privateRead)).draft.revision, appLinked.draft.revision);
    const appUnlinked=success(await invoke('attachment.unlink',{...privateRead,requestKey:'app-mail-unlink',
      fileId:appStaged.fileId,revision:appLinked.draft.revision},appScope));
    const unlinked = success(await invoke('attachment.unlink', {...privateRead, requestKey: 'mail-unlink',
      fileId: staged.fileId, revision: appUnlinked.draft.revision}));
    assert.equal(appUnlinked.removed,true);assert.equal(unlinked.removed, true);
    assert.deepEqual(success(await invoke('attachment.list', {...privateRead, limit: 10})).items, []);
    assert.deepEqual(new Uint8Array(await (await readFile('app',ownerApp.token)).arrayBuffer()),adminBytes,
      'unlink retains private bytes');
    assert.equal(success(await invoke('draft.delete', {...privateRead, requestKey: 'mail-delete', revision: unlinked.draft.revision})).deleted, true);
    await rejected(invoke('draft.read', privateRead), 'not_found');
    const latest = good(await acl.readPolicy(ownerAdmin.token)), revoked = structuredClone(latest.policy);
    revoked.assignments = revoked.assignments.filter(row => !(row.principalId===owner.principalId
      &&row.audience==='admin'&&row.contextId==='application'&&row.roleId==='messaging-user'));
    good(await acl.replacePolicy(ownerAdmin.token, {expectedEpoch: latest.epoch, policy: revoked}));
    await rejected(invoke('box.list', {limit: 10}), 'forbidden');
    assert.equal((await readFile('admin',ownerAdmin.token,appStaged)).status,403,
      'the shared owner hash never bypasses the revoked admin grant');
    assert.ok(success(await invoke('box.list',{limit:10},appScope)).items.some(item=>item.id===box.id),
      'revoking admin leaves the independent app grant active');
    assert.equal(success(await invoke('draft.read',appRead,appScope)).draft.revision,appSaved.revision);
    const afterRevocation=await readFile('app',ownerApp.token,appStaged);
    assert.equal(afterRevocation.status,200);
    assert.deepEqual(new Uint8Array(await afterRevocation.arrayBuffer()),appBytes);
  } finally {
    if (data && lease) data.dispose(lease);
    if (data && appLease) data.dispose(appLease);
    await runtime.dispose();
  }
});
