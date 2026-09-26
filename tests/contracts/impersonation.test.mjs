import test from 'node:test';
import { validateModule } from '../../sdk/contracts/validate.mjs';
import { accepted, refused, fixture, namedModule } from './helpers.mjs';

function acceptsImpersonation(module) {
  module.contracts.permissions.find(p => p.id === 'read').actors.push('impersonated-user');
  module.contracts.operations.find(o => o.id === 'get').actors.push('impersonated-user');
}

test('API and MCP declarations require an explicit impersonated actor instead of reusing user or OAuth', () => {
  for (const surface of ['api', 'mcp']) {
    const module = fixture();
    const exposure = (surface === 'api' ? module.contracts.api : module.contracts.mcp.tools).find(e => e.operation.id === 'get');
    exposure.auth.push('impersonation');
    refused(validateModule(module), `${surface}.auth`);
    acceptsImpersonation(module);
    accepted(validateModule(module));
    module.contracts.permissions.find(p => p.id === 'read').actors = ['user', 'machine', 'delegated-user'];
    refused(validateModule(module), 'operation.permissions');
  }
});

test('an impersonation declaration never opens native access administration or chained impersonation', () => {
  for (const id of ['manage', 'impersonate']) {
    const module = namedModule('creezio.access', 'creezio');
    acceptsImpersonation(module);
    const permission = structuredClone(module.contracts.permissions.find(p => p.id === 'read'));
    permission.id = id;
    module.contracts.permissions.push(permission);
    module.contracts.operations.find(o => o.id === 'get').permissions = [{moduleId:'creezio.access',kind:'permission',id}];
    refused(validateModule(module), 'operation.impersonation');
  }
});
