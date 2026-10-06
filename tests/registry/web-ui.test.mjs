import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {registryScript} from '../../services/registry/web-ui.ts';

function browser({lostProject = false, lostInstallation = false, commitProject = true,
  holdInstallation = false, holdProjectBRead = false, authenticated = true,
  emailStartStatus = 202, emailVerifyStatus = 200, lostEmailStart = false,
  lostEmailVerify = false, commitEmailVerify = true, holdEmailStart = false,
  deploymentRows = [], deploymentsComplete = true, holdDeployments = false, holdProjects = false,
  authState = {authenticated}} = {}) {
  const names = ['status','sign-in','owner-panel','project-select','refresh-projects','project-form',
    'project-name','project-origin','create-project','installation-panel','installation-select',
    'refresh-installations','create-sites','create-cloudflare','rotate','download',
    'email-start-form','owner-email','email-start','email-verify-form','email-challenge-info',
    'owner-code','email-verify','owner-logout'];
  names.push('deployments-panel','refresh-deployments','deployments-status','deployments-list');
  class Element {
    constructor(id = '') {this.id = id; this.hidden = false; this.disabled = false;
      this.value = ''; this.textContent = ''; this.children = []; this.listeners = new Map();}
    addEventListener(name, callback) {this.listeners.set(name, callback);}
    replaceChildren(...children) {this.children = children;}
    add(child) {this.children.push(child);}
    append(child) {this.children.push(child);}
    remove() {}
    click() {}
    async fire(name, target = this) {
      const callback = this.listeners.get(name);
      assert.ok(callback, `missing ${name} handler on ${this.id}`);
      await callback({target, preventDefault() {}});
    }
  }
  const elements = new Map(names.map(name => [name, new Element(name)]));
  elements.get('sign-in').hidden = true;
  elements.get('owner-panel').hidden = true;
  elements.get('email-verify-form').hidden = true;
  elements.get('deployments-panel').hidden = true;
  const projects = [], installations = [], calls = [];
  let releaseInstallation;
  const installationGate = holdInstallation ? new Promise(resolve => {releaseInstallation = resolve;}) : null;
  let releaseProjectBRead;
  const projectBGate = holdProjectBRead ? new Promise(resolve => {releaseProjectBRead = resolve;}) : null;
  let releaseEmailStart;
  const emailStartGate = holdEmailStart ? new Promise(resolve => {releaseEmailStart = resolve;}) : null;
  let releaseDeployments;
  const deploymentsGate = holdDeployments ? new Promise(resolve => {releaseDeployments = resolve;}) : null;
  let releaseProjects;
  const projectsGate = holdProjects ? new Promise(resolve => {releaseProjects = resolve;}) : null;
  let downloaded;
  class BrowserURL extends URL {
    static createObjectURL(blob) {downloaded = blob; return 'blob:registry-test';}
    static revokeObjectURL() {}
  }
  const fetch = async (path, options) => {
    calls.push({path, method: options.method, headers: options.headers,
      credentials: options.credentials});
    if (path === '/v1/owners/me') return authState.authenticated
      ? Response.json({ownerId: 'owner-a'})
      : Response.json({error: {code: 'authentication_required'}}, {status: 401});
    if (path === '/v1/owners/email/start') {
      if (emailStartGate) await emailStartGate;
      if (emailStartStatus !== 202) return Response.json({error: {code: emailStartStatus === 429
        ? 'rate_limited' : 'configuration_unavailable'}}, {status: emailStartStatus});
      if (lostEmailStart) throw new Error('reply lost');
      return Response.json({challengeId: 'challenge-a', expiresAt: '2026-10-06T12:00:00.000Z'}, {status: 202});
    }
    if (path === '/v1/owners/email/verify') {
      if (emailVerifyStatus !== 200) return Response.json({error: {code: 'forbidden'}}, {status: emailVerifyStatus});
      if (commitEmailVerify) authState.authenticated = true;
      if (lostEmailVerify) throw new Error('reply lost');
      return Response.json({ownerId: 'owner-a', verifiedAt: '2026-10-06T11:00:00.000Z'});
    }
    if (path === '/v1/owners/logout') {
      authState.authenticated = false;
      return Response.json({status: 'signed_out'});
    }
    if (path === '/v1/projects' && options.method === 'GET') {
      if (projectsGate) await projectsGate;
      return Response.json({projects, complete: true, limit: 100});
    }
    if (path === '/v1/projects' && options.method === 'POST') {
      if (commitProject) projects.push({projectId: 'project-a', ...JSON.parse(options.body)});
      if (lostProject) throw new Error('reply lost');
      return Response.json({projectId: 'project-a'}, {status: 201});
    }
    if (path === '/v1/projects/project-a/installations' && options.method === 'GET')
      return Response.json({projectId: 'project-a', installations, complete: true, limit: 100});
    if (path === '/v1/projects/project-b/installations' && options.method === 'GET') {
      if (projectBGate) await projectBGate;
      return Response.json({projectId: 'project-b', installations: [], complete: true, limit: 100});
    }
    if (path === '/v1/installations/installation-a/deployments' && options.method === 'GET') {
      if (deploymentsGate) await deploymentsGate;
      return Response.json({installationId: 'installation-a', deployments: deploymentRows,
        complete: deploymentsComplete, limit: 100});
    }
    if (path === '/v1/installations' && options.method === 'POST') {
      if (installationGate) await installationGate;
      const input = JSON.parse(options.body);
      installations.push({installationId: 'installation-a', target: input.target, revokedAt: null});
      if (lostInstallation) throw new Error('reply lost');
      return Response.json({installationId: 'installation-a', projectId: 'project-a',
        target: input.target, token: 'cz1d_example-once'}, {status: 201});
    }
    throw new Error('unexpected request ' + path);
  };
  const document = {getElementById: id => elements.get(id),
    createElement: tag => new Element(tag), body: {append() {}}};
  const context = {document, fetch, Response, URL: BrowserURL, Blob,
    Option: class {constructor(text, value) {this.text = text; this.value = value;}},
    setTimeout: callback => {callback(); return 0;}, window: {confirm: () => true}};
  runInNewContext(registryScript, context);
  return {elements, calls, projects, installations, releaseInstallation, releaseProjectBRead,
    releaseEmailStart, releaseDeployments, releaseProjects, authState,
    downloaded: () => downloaded};
}

const ready = () => new Promise(resolve => setTimeout(resolve, 0));
const prepare = async page => {
  await ready();
  page.elements.get('project-name').value = 'Creezio Lab';
  page.elements.get('project-origin').value = 'https://github.com/Creez-io/Creezio-Lab';
};

test('lost browser replies reconcile exact new IDs without repeating creation or rotating a token', async () => {
  const page = browser({lostProject: true, lostInstallation: true});
  await prepare(page);
  await page.elements.get('project-form').fire('submit');
  assert.equal(page.elements.get('project-select').value, 'project-a');
  assert.match(page.elements.get('status').textContent, /ID récupéré sans rejouer le POST/);
  await page.elements.get('create-sites').fire('click');
  await ready();
  assert.equal(page.elements.get('installation-select').value, 'installation-a');
  assert.match(page.elements.get('status').textContent, /jeton perdu/);
  assert.equal(page.elements.get('create-sites').disabled, true);
  assert.equal(page.calls.filter(call => call.path === '/v1/projects' && call.method === 'POST').length, 1);
  assert.equal(page.calls.filter(call => call.path === '/v1/installations' && call.method === 'POST').length, 1);
  assert.equal(page.calls.some(call => call.path.endsWith('/rotate')), false);
  assert.equal(page.calls.filter(call => call.method === 'POST')
    .every(call => call.headers['x-creezio-request'] === '1' && call.credentials === 'same-origin'), true);
});

test('zero matches after a lost reply remains uncertain and blocks another browser POST', async () => {
  const page = browser({lostProject: true, commitProject: false});
  await prepare(page);
  await page.elements.get('project-form').fire('submit');
  assert.match(page.elements.get('status').textContent, /incertaine, même si aucun projet nouveau/);
  assert.equal(page.elements.get('create-project').disabled, true);
  await page.elements.get('project-form').fire('submit');
  assert.equal(page.calls.filter(call => call.path === '/v1/projects' && call.method === 'POST').length, 1);
});

test('successful browser creation holds the installation token only for an explicit download', async () => {
  const page = browser();
  await prepare(page);
  await page.elements.get('project-form').fire('submit');
  await page.elements.get('create-cloudflare').fire('click');
  await ready();
  assert.equal(page.elements.get('download').hidden, false);
  assert.equal(page.elements.get('status').textContent.includes('cz1d_example-once'), false);
  await page.elements.get('create-sites').fire('click');
  await page.elements.get('rotate').fire('click');
  await ready();
  assert.equal(page.calls.filter(call => call.method === 'POST').length, 2,
    'an undownloaded token blocks further creation and rotation');
  await page.elements.get('download').children[0].fire('click');
  assert.equal(page.elements.get('download').hidden, true);
  assert.equal(JSON.parse(await page.downloaded().text()).token, 'cz1d_example-once');
});

test('an in-flight creation keeps the project scope fixed and disables competing reads', async () => {
  const page = browser({holdInstallation: true});
  await prepare(page);
  await page.elements.get('project-form').fire('submit');
  await page.elements.get('create-sites').fire('click');
  await ready();
  assert.equal(page.elements.get('project-select').disabled, true);
  assert.equal(page.elements.get('refresh-projects').disabled, true);
  const reads = page.calls.filter(call => call.method === 'GET').length;
  await page.elements.get('project-select').fire('change', {value: 'another-project'});
  await page.elements.get('refresh-installations').fire('click');
  assert.equal(page.calls.filter(call => call.method === 'GET').length, reads);
  page.releaseInstallation();
  await ready();
  assert.equal(page.elements.get('project-select').value, 'project-a');
  assert.equal(page.downloaded(), undefined);
  await page.elements.get('download').children[0].fire('click');
  assert.equal(JSON.parse(await page.downloaded().text()).projectId, 'project-a');
});

test('switching projects clears stale installations before the new read and forbids rotation', async () => {
  const page = browser({lostInstallation: true, holdProjectBRead: true});
  await prepare(page);
  await page.elements.get('project-form').fire('submit');
  await page.elements.get('create-sites').fire('click');
  await ready();
  assert.equal(page.elements.get('installation-select').value, 'installation-a');
  assert.equal(page.elements.get('rotate').disabled, false);
  page.projects.push({projectId: 'project-b', name: 'Second', origin: 'https://example.invalid/b'});
  await page.elements.get('refresh-projects').fire('click');
  const selecting = page.elements.get('project-select').fire('change', {value: 'project-b'});
  await ready();
  assert.equal(page.elements.get('project-select').value, 'project-b');
  assert.equal(page.elements.get('installation-select').value, '');
  assert.equal(page.elements.get('installation-select').children.length, 1);
  assert.equal(page.elements.get('installation-select').disabled, true);
  assert.equal(page.elements.get('rotate').disabled, true);
  await page.elements.get('installation-select').fire('change', {value: 'installation-a'});
  await page.elements.get('rotate').fire('click');
  assert.equal(page.calls.filter(call => call.path.endsWith('/rotate') && call.method === 'POST').length, 0);
  page.releaseProjectBRead();
  await selecting;
  assert.equal(page.elements.get('installation-select').value, '');
  assert.equal(page.elements.get('rotate').disabled, true);
});

test('refresh clears installations when the selected project disappears', async () => {
  const page = browser({lostInstallation: true});
  await prepare(page);
  await page.elements.get('project-form').fire('submit');
  await page.elements.get('create-sites').fire('click');
  await ready();
  assert.equal(page.elements.get('installation-select').value, 'installation-a');
  page.projects.splice(0, 1);
  await page.elements.get('refresh-projects').fire('click');
  assert.equal(page.elements.get('project-select').value, '');
  assert.equal(page.elements.get('installation-select').value, '');
  assert.equal(page.elements.get('rotate').disabled, true);
  await page.elements.get('rotate').fire('click');
  assert.equal(page.calls.filter(call => call.path.endsWith('/rotate') && call.method === 'POST').length, 0);
});

test('email code signs in through the same owner session and survives a reload', async () => {
  const page = browser({authenticated: false});
  await ready();
  assert.equal(page.elements.get('sign-in').hidden, false);
  page.elements.get('owner-email').value = ' Owner@Example.com ';
  await page.elements.get('email-start-form').fire('submit');
  assert.equal(page.elements.get('email-verify-form').hidden, false);
  assert.match(page.elements.get('email-challenge-info').textContent, /owner@example.com/);
  page.elements.get('owner-code').value = '12345678';
  await page.elements.get('email-verify-form').fire('submit');
  assert.equal(page.elements.get('owner-panel').hidden, false);
  assert.equal(page.elements.get('sign-in').hidden, true);
  assert.equal(page.elements.get('owner-code').value, '');
  assert.deepEqual(page.calls.filter(call => call.path.includes('/owners/email/')).map(call => call.path),
    ['/v1/owners/email/start', '/v1/owners/email/verify']);
  assert.equal(page.calls.filter(call => call.method === 'POST')
    .every(call => call.headers['x-creezio-request'] === '1' && call.credentials === 'same-origin'), true);
  const reloaded = browser({authState: page.authState});
  await ready();
  assert.equal(reloaded.elements.get('owner-panel').hidden, false);
  assert.equal(reloaded.calls.some(call => call.path.includes('/owners/email/')), false);
  await reloaded.elements.get('owner-logout').fire('click');
  assert.equal(reloaded.elements.get('owner-panel').hidden, true);
  assert.equal(reloaded.elements.get('sign-in').hidden, false);
});

test('refused or expired email code stays unauthenticated and permits corrected code', async () => {
  const page = browser({authenticated: false, emailVerifyStatus: 403});
  await ready();
  page.elements.get('owner-email').value = 'owner@example.com';
  await page.elements.get('email-start-form').fire('submit');
  page.elements.get('owner-code').value = '12345678';
  await page.elements.get('email-verify-form').fire('submit');
  assert.equal(page.elements.get('owner-panel').hidden, true);
  assert.match(page.elements.get('status').textContent, /Code refusé, expiré ou déjà utilisé/);
  assert.equal(page.elements.get('email-verify').disabled, false);
  assert.equal(page.elements.get('owner-code').value, '');
  assert.equal(page.calls.filter(call => call.path === '/v1/owners/email/verify').length, 1);
});

test('lost verification reply reads owner session once without repeating the code', async () => {
  const page = browser({authenticated: false, lostEmailVerify: true});
  await ready();
  page.elements.get('owner-email').value = 'owner@example.com';
  await page.elements.get('email-start-form').fire('submit');
  page.elements.get('owner-code').value = '12345678';
  await page.elements.get('email-verify-form').fire('submit');
  assert.equal(page.elements.get('owner-panel').hidden, false);
  assert.equal(page.calls.filter(call => call.path === '/v1/owners/email/verify').length, 1);
  assert.equal(page.calls.filter(call => call.path === '/v1/owners/me').length, 2);
});

test('lost verify without a session blocks replay; retry requires a new explicit code request', async () => {
  const page = browser({authenticated: false, lostEmailVerify: true, commitEmailVerify: false});
  await ready();
  page.elements.get('owner-email').value = 'owner@example.com';
  await page.elements.get('email-start-form').fire('submit');
  page.elements.get('owner-code').value = '12345678';
  await page.elements.get('email-verify-form').fire('submit');
  assert.equal(page.elements.get('owner-panel').hidden, true);
  assert.equal(page.elements.get('email-verify').disabled, true);
  await page.elements.get('email-verify-form').fire('submit');
  assert.equal(page.calls.filter(call => call.path === '/v1/owners/email/verify').length, 1);
  await page.elements.get('email-start-form').fire('submit');
  assert.equal(page.elements.get('email-verify').disabled, false);
  assert.equal(page.calls.filter(call => call.path === '/v1/owners/email/start').length, 2);
});

test('failed delivery and concurrent forms never claim a verified owner', async () => {
  const refused = browser({authenticated: false, emailStartStatus: 429});
  await ready();
  refused.elements.get('owner-email').value = 'owner@example.com';
  await refused.elements.get('email-start-form').fire('submit');
  assert.match(refused.elements.get('status').textContent, /Trop de demandes/);
  assert.equal(refused.elements.get('email-verify-form').hidden, true);
  const page = browser({authenticated: false, holdEmailStart: true});
  await ready();
  page.elements.get('owner-email').value = 'owner@example.com';
  const sending = page.elements.get('email-start-form').fire('submit');
  await ready();
  assert.equal(page.elements.get('email-start').disabled, true);
  await page.elements.get('email-start-form').fire('submit');
  await page.elements.get('email-verify-form').fire('submit');
  assert.equal(page.calls.filter(call => call.path === '/v1/owners/email/start').length, 1);
  assert.equal(page.calls.filter(call => call.path === '/v1/owners/email/verify').length, 0);
  page.releaseEmailStart();
  await sending;
  assert.equal(page.elements.get('owner-panel').hidden, true);
});

test('a lost start reply requires explicit resend, and an unverified reload has no phantom challenge', async () => {
  const page = browser({authenticated: false, lostEmailStart: true});
  await ready();
  page.elements.get('owner-email').value = 'owner@example.com';
  await page.elements.get('email-start-form').fire('submit');
  assert.match(page.elements.get('status').textContent, /Envoi du code incertain/);
  assert.equal(page.elements.get('email-verify-form').hidden, true);
  assert.equal(page.calls.filter(call => call.path === '/v1/owners/email/start').length, 1);
  const reloaded = browser({authState: page.authState});
  await ready();
  assert.equal(reloaded.elements.get('sign-in').hidden, false);
  assert.equal(reloaded.elements.get('email-verify-form').hidden, true);
  assert.equal(reloaded.calls.some(call => call.path.includes('/owners/email/')), false);
});

test('unconfigured email delivery reports the server refusal', async () => {
  const page = browser({authenticated: false, emailStartStatus: 503});
  await ready();
  page.elements.get('owner-email').value = 'owner@example.com';
  await page.elements.get('email-start-form').fire('submit');
  assert.match(page.elements.get('status').textContent, /Connexion par email indisponible/);
  assert.equal(page.elements.get('email-verify-form').hidden, true);
});

test('selected installation shows bounded declarations without claiming a served version', async () => {
  const page = browser({deploymentRows: [{declarationId: 'declaration-a', deploymentId: 'deployment-a',
    url: 'https://example.invalid/app', repositoryUrl: 'https://github.com/example/app',
    publishedSha: 'abc123', artifact: {coreVersion: '1.2.3', contractVersion: '2'},
    declaredAt: '2026-10-06T11:00:00.000Z', evidenceKind: 'authenticated_declaration'}],
    deploymentsComplete: false});
  await prepare(page);
  await page.elements.get('project-form').fire('submit');
  await page.elements.get('create-sites').fire('click');
  await ready();
  assert.equal(page.elements.get('deployments-panel').hidden, false);
  assert.match(page.elements.get('deployments-list').children[0].textContent, /Core 1.2.3, contrat 2, SHA publié abc123/);
  assert.match(page.elements.get('deployments-list').children[0].textContent, /https:\/\/example.invalid\/app/);
  assert.match(page.elements.get('deployments-list').children[0].textContent, /dépôt : https:\/\/github.com\/example\/app/);
  assert.match(page.elements.get('deployments-status').textContent, /historique incomplet/);
  await page.elements.get('refresh-deployments').fire('click');
  assert.equal(page.calls.filter(call => call.path.endsWith('/deployments')).length, 2);
});

test('late deployment response cannot repopulate another project scope', async () => {
  const page = browser({lostInstallation: true, holdDeployments: true,
    deploymentRows: [{url: 'https://example.invalid/old', declaredAt: '2026-10-06'}]});
  await prepare(page);
  await page.elements.get('project-form').fire('submit');
  await page.elements.get('create-sites').fire('click');
  await ready();
  await page.elements.get('installation-select').fire('change', {value: 'installation-a'});
  await ready();
  await page.elements.get('project-select').fire('change', {value: ''});
  page.releaseDeployments();
  await ready();
  assert.equal(page.elements.get('deployments-panel').hidden, true);
  assert.equal(page.elements.get('deployments-list').children.length, 0);
});

test('a projects read started before logout cannot restore the former owner list', async () => {
  const page = browser({holdProjects: true});
  page.projects.push({projectId: 'project-private', name: 'Privé', origin: 'https://private.example.invalid/'});
  await ready();
  assert.equal(page.elements.get('owner-panel').hidden, false);
  assert.equal(page.calls.filter(call => call.path === '/v1/projects').length, 1);
  const refreshing = page.elements.get('refresh-projects').fire('click');
  await ready();
  assert.equal(page.calls.filter(call => call.path === '/v1/projects').length, 2);
  await page.elements.get('owner-logout').fire('click');
  assert.equal(page.elements.get('owner-panel').hidden, true);
  page.releaseProjects();
  await refreshing;
  await ready();
  assert.equal(page.elements.get('project-select').children.length, 1);
  assert.match(page.elements.get('status').textContent, /Session fermée/);
});
