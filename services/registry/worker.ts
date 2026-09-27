import {createRegistryService, type RegistryEnvironment} from './service.ts';

/** Deploy this Worker with its own D1 and secrets, separately from the app Worker. */
export default {fetch(request: Request, environment: RegistryEnvironment): Promise<Response> {
  return createRegistryService(environment).fetch(request);
}};
