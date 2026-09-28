import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {registryScript} from '../../services/registry/web-ui.ts';

function browser({lostProject = false, lostInstallation = false, commitProject = true,
  holdInstallation = false, holdProjectBRead = false} = {}) {
  const names = ['status','sign-in','owner-panel','project-select','refresh-projects','project-form',
    'project-name','project-origin','create-project','installation-panel','installation-select',
    'refresh-installations','create-sites','create-cloudflare','rotate','download'];
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
  const projects = [], installations = [], calls = [];
  let releaseInstallation;
  const installationGate = holdInstallation ? new Promise(resolve => {releaseInstallation = resolve;}) : null;
  let releaseProjectBRead;
  const projectBGate = holdProjectBRead ? new Promise(resolve => {releaseProjectBRead = resolve;}) : null;
  let downloaded;
  class BrowserURL extends URL {
    static createObjectURL(blob) {downloaded = blob; return 'blob:registry-test';}
    static revokeObjectURL() {}
  }
  const fetch = async (path, options) => {
    calls.push({path, method: options.method, headers: options.headers,
      credentials: options.credentials});
    if (path === '/v1/owners/me') return Response.json({ownerId: 'owner-a'});
    if (path === '/v1/projects' && options.method === 'GET')
      return Response.json({projects, complete: true, limit: 100});
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
