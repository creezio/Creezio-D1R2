import {existsSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {Miniflare} from 'miniflare';
import {compileWidgetSandbox} from '../widgets/sandbox.mjs';

/** In-process static relay with no business state, cookie, or application binding. */
export async function startLocalWidgetSandbox(config, {Runtime = Miniflare,
  loadCatalog = async source => (await import(pathToFileURL(source).href)).widgetCatalog} = {}) {
  const source = path.join(config.root, '.creezio', 'generated', 'widget-catalog.ts');
  if (!existsSync(source)) return null;
  const catalog = await loadCatalog(source);
  if (!catalog || !Array.isArray(catalog.resources)) throw new Error('Invalid local widget catalog.');
  if (!catalog.resources.length) return null;
  const compiled = compileWidgetSandbox({catalog,hostOrigins:[config.origin],local:true});
  const runtime = new Runtime({host:config.sandboxHost,port:config.sandboxPort,cf:false,
    modules:true,script:compiled.script,compatibilityDate:config.compatibilityDate});
  try { await runtime.ready; }
  catch (error) { await runtime.dispose(); throw error; }
  return Object.freeze({origin:config.sandboxOrigin, digest:compiled.digest,
    profileIds:compiled.profileIds, close:() => runtime.dispose()});
}
