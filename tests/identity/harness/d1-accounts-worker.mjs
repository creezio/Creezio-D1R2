// Internal qualification worker only. Never imported by product composition or published.
// Calls the real store against the bound D1; it is not authentication middleware.
import { createD1IdentityStore } from '../../../core/identity/d1-store.ts';
import { hashPassword, verifyPassword } from '../../../core/identity/password.ts';
import { createAccountService, provisionBootstrapCapability, validNewPassword } from '../../../core/identity/accounts.ts';

export default {
  async fetch(request, env) {
    const body = await request.json();
    const store = createD1IdentityStore(env.DB);
    try {
      let value;
      switch (body.method) {
        case 'passwordPolicy': value = body.args.map(validNewPassword); break;
        case 'serviceProvision': value = await provisionBootstrapCapability(env.DB); break;
        case 'serviceBootstrap': value = await createAccountService(env.DB).bootstrap(...body.args); break;
        case 'serviceLogin': value = await createAccountService(env.DB).login(...body.args); break;
        case 'serviceSession': value = await createAccountService(env.DB).session(...body.args); break;
        case 'serviceLogout': value = await createAccountService(env.DB).logout(...body.args); break;
        case 'hash': value = hashPassword(body.args[0]); break;
        case 'verify': value = verifyPassword(...body.args); break;
        case 'provisionBootstrap': value = await store.provisionBootstrap(...body.args); break;
        case 'canCompleteBootstrap': value = await store.canCompleteBootstrap(...body.args); break;
        case 'completeBootstrap': value = await store.completeBootstrap(...body.args); break;
        case 'findPasswordAccount': value = await store.findPasswordAccount(...body.args); break;
        case 'createSessionAfterPassword': value = await store.createSessionAfterPassword(...body.args); break;
        case 'getSession': value = await store.getSession(...body.args); break;
        case 'revokeSession': value = await store.revokeSession(...body.args); break;
        case 'consumeThrottle': value = await store.consumeThrottle(...body.args); break;
        default: throw new Error('Unknown qualification operation.');
      }
      return Response.json({ value });
    } catch (error) {
      return Response.json({ error: { name: error.name, message: error.message } }, { status: 500 });
    }
  },
};
