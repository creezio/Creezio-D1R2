import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const template = JSON.parse(readFileSync(new URL('../openai/module/manifest.json', root), 'utf8'));
const moduleId = 'creezio.delivery', revision = 't32-local-delivery-v1';
const ref = (kind, id) => ({moduleId, kind, id});
const absence = (reason, policyRule) => ({reason, policyRule});
const string = maxLength => ({type: 'string', minLength: 1, maxLength});
const m = structuredClone(template);

m.identity = {id: moduleId, title: 'Livraison Cloudflare locale', publisher: 'creezio',
  origin: 'https://github.com/creezio/Creezio-D1R2', version: '0.0.0',
  source: {kind: 'snapshot', revision,
    integrity: `sha256-${createHash('sha256').update(revision).digest('hex')}`},
  license: {expression: 'NOASSERTION', file: 'LICENSE'}};
m.compatibility = {core: '^0.0.0', sdk: '^1.1.0', requiredCapabilities: ['runtime.worker'], optionalCapabilities: []};
m.entrypoints = {server: {path: 'module/entry.server.ts', export: 'delivery'},
  ui: {path: 'ui/index.tsx', export: 'DeliveryAdminView'},
  plugin: {manifest: 'plugin/plugin.json', mcp: 'plugin/mcp.json',
    contributions: {path: 'plugin/contributions.ts', export: 'contributions'}}};
m.dependencies = [];
m.contracts = {
  schemas: [
    {id: 'empty-input', schema: {type: 'object', properties: {}, required: [], additionalProperties: false}},
    {id: 'panel-state', schema: {type: 'object', properties: {
      owner: string(128), transferId: string(128),
      planDigest: {type: 'string', pattern: '^sha256-[a-f0-9]{64}$'}, started: {type: 'boolean'},
      initial: {type: 'object', properties: {owner: string(128), transferId: string(128),
        planDigest: {type: 'string', pattern: '^sha256-[a-f0-9]{64}$'}, started: {type: 'boolean'}},
      required: ['owner', 'transferId', 'planDigest', 'started'], additionalProperties: false},
      update: {type: 'object', properties: {kind: {const: 'update'}, owner: string(128),
        updateId: string(128), planDigest: {type: 'string', pattern: '^sha256-[a-f0-9]{64}$'},
        started: {type: 'boolean'}},
      required: ['kind', 'owner', 'updateId', 'planDigest', 'started'], additionalProperties: false},
    }, required: [], additionalProperties: false}},
  ],
  models: [], files: [], events: [], settings: [], search: [],
  permissions: [{id: 'manage', title: 'Gérer la livraison locale', audiences: ['admin'], actors: ['user'],
    scopes: ['delivery.manage'], context: 'application', default: 'deny', resources: [],
    actions: ['read', 'configure', 'execute'], enforcement: {request: true, commit: true}, public: false}],
  operations: [], api: [], mcp: {tools: [], resources: [], prompts: [], skills: []},
  ui: {views: [{id: 'admin', title: 'Livraison Cloudflare', surfaces: ['workspace'], route: '/admin/delivery',
    component: {path: 'ui/index.tsx', export: 'DeliveryAdminView'}, permissions: [ref('permission', 'manage')],
    operations: [], input: {schemaId: 'empty-input'},
    panel: {identityFields: [], navigation: 'sdk', retention: 'preserve', inactiveEffects: 'suspend',
      stateSchema: {schemaId: 'panel-state'}}}],
  navigation: [{id: 'delivery', title: 'Livraison Cloudflare', view: ref('view', 'admin'),
    permissions: [ref('permission', 'manage')], surfaces: ['workspace'], order: 50}],
  slots: [], front: {mode: 'absent', justification: {reason: 'Delivery is local admin-only.',
    policyRule: 'delivery.local-admin-only'}}, themes: [], styles: []},
  widgets: [], publicContracts: [],
};
m.documentation.versionBinding = {moduleVersion: '0.0.0', sourceRevision: revision};
for (const name of ['backend', 'ui', 'api-mcp', 'widgets', 'package', 'docs']) {
  m.validation.suites[name].tests = [`tests/${name}/contract.test.mjs`];
  if (name === 'api-mcp' || name === 'widgets') {
    m.validation.suites[name].mode = 'not-applicable';
    m.validation.suites[name].justification = absence(
      name === 'api-mcp' ? 'Publishing uses the native local operator, never a module operation or MCP tool.'
        : 'Delivery has no widget surface.', `delivery.no-${name}`);
  } else {m.validation.suites[name].mode = 'required'; delete m.validation.suites[name].justification;}
}
m.packaging.runtime.files = ['module/manifest.json', 'module/entry.server.ts', 'ui/index.tsx',
  'ui/presentation.tsx', 'ui/persistence.ts', 'README.md', 'prd.md', 'CHANGELOG.md', 'LICENSE',
  'plugin/plugin.json', 'plugin/mcp.json', 'plugin/contributions.ts'];
m.packaging.validation.files = ['AGENTS.md', 'FILES.md', 'interview.md', 'TODO.md', 'gate.mjs',
  'module/generate-manifest.mjs', 'ci/run-suite.mjs',
  ...['backend', 'ui', 'api-mcp', 'widgets', 'package', 'docs'].flatMap(name =>
    [`ci/${name}.mjs`, `tests/${name}/contract.test.mjs`])];
m.packaging.validationBinding = {moduleId, moduleVersion: '0.0.0', sourceRevision: revision};
m.lifecycle.absent = {
  models: absence('The local operator owns transfer state outside application D1.', 'delivery.no-models'),
  files: absence('Transfer data stays in the local operator, not module file categories.', 'delivery.no-files'),
  widgets: absence('Delivery is an administrative workspace view.', 'delivery.no-widgets'),
};
m.lifecycle.configuration = 'explicit-state';
writeFileSync(new URL('module/manifest.json', root), `${JSON.stringify(m, null, 2)}\n`);
