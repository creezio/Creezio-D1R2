import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {exactOrigin,sandboxProfileHeaders} from '../../sdk/widgets/proxy/profile-policy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Compile the same static relay for local and hosted adapters. No app data or keys. */
export function compileWidgetSandbox({catalog,hostOrigins,local=false}) {
  if (!catalog || !Array.isArray(catalog.resources) || catalog.resources.length > 1000
    || !Array.isArray(hostOrigins) || !hostOrigins.length || hostOrigins.length > 16
    || hostOrigins.some(origin => !exactOrigin(origin,local))) throw new TypeError('Invalid widget sandbox deployment.');
  const origins = [...new Set(hostOrigins)].sort(), profiles = Object.create(null), assets = Object.create(null);
  const html = readFileSync(resolve(root,'sdk/widgets/proxy/sandbox.html'),'utf8');
  const relay = readFileSync(resolve(root,'sdk/widgets/proxy/sandbox.js'),'utf8');
  const put = (path,text,type,extra={}) => {
    assets[path] = {text,headers:{'Content-Type':type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
      'Cache-Control':'no-cache','ETag':`"${sha256(text)}"`,...extra}};
  };
  for (const resource of catalog.resources) {
    const {cspProfileId,uiMeta} = resource;
    const profile = {csp:uiMeta?.csp,permissions:uiMeta?.permissions};
    if (profiles[cspProfileId] && JSON.stringify(profiles[cspProfileId]) !== JSON.stringify(profile))
      throw new TypeError('Conflicting widget sandbox profiles.');
    const policy = sandboxProfileHeaders({cspProfileId,csp:profile.csp,hostOrigins:origins,local});
    profiles[cspProfileId] = profile;
    // The profile digest describes module CSP, while the host allowlist is deployment configuration.
    put(`/profiles/${cspProfileId}/sandbox.html`,html,'text/html; charset=utf-8',{...policy,'Cache-Control':'no-cache'});
  }
  if (!Object.keys(profiles).length) throw new TypeError('A widget sandbox needs a compiled profile.');
  put('/sandbox.js',relay,'text/javascript; charset=utf-8');
  put('/sandbox-config.js',`globalThis.__CREEZIO_WIDGET_SANDBOX_CONFIG__ = Object.freeze(${JSON.stringify({hostOrigins:origins,profiles})});\n`,
    'text/javascript; charset=utf-8');
  const serial = JSON.stringify(assets);
  const script = `const assets=${serial};\nexport default {fetch(request){\n`
    + `const path=new URL(request.url).pathname;\n`
    + `if(request.method!=='GET'&&request.method!=='HEAD')return new Response(null,{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});\n`
    + `const asset=Object.hasOwn(assets,path)?assets[path]:null;\n`
    + `if(!asset)return new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});\n`
    + `return new Response(request.method==='HEAD'?null:asset.text,{headers:asset.headers});\n}};\n`;
  return Object.freeze({script,digest:`sha256-${sha256(script)}`,hostOrigins:origins,
    profileIds:Object.keys(profiles).sort(),assetPaths:Object.keys(assets).sort()});
}
