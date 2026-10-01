#!/usr/bin/env node
import {build} from 'esbuild';
import {copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const sdk=path.join(root,'sdk');
const output=path.join(sdk,'dist');
const entries={
  'operations/error':'operations/error.ts',
  'operations/handler':'operations/handler.ts',
  'operations/client':'operations/client.ts',
  'operations/command-journal':'operations/command-journal.ts',
  'connectors/types':'connectors/types.ts',
  'search/types':'search/types.ts',
  'delivery/context':'delivery/context.tsx',
  'delivery/transport':'delivery/transport.ts',
  'delivery/types':'delivery/types.ts',
  'delivery/controller':'delivery/controller.ts',
  'delivery/view-model':'delivery/view-model.ts',
  'delivery/update-controller':'delivery/update-controller.ts',
  'delivery/update-view-model':'delivery/update-view-model.ts',
  'files/types':'files/types.ts',
  'files/client':'files/client.ts',
  'workspace/types':'workspace/types.ts',
  'workspace/navigation-catalog':'workspace/navigation-catalog.ts',
  'workspace/components':'workspace/components-impl.tsx',
  'workspace/metadata':'workspace/metadata-impl.tsx',
  'workspace/toolbar':'workspace/toolbar-impl.tsx',
  'front/types':'front/types.ts',
  'widgets/types':'widgets/types.ts',
  'widgets/validation':'widgets/validation.ts',
  'widgets/model-context':'widgets/model-context.ts',
  'ui/assistant-provider':'ui/assistant-provider-impl.tsx',
  ui:'ui/index.ts',
  'contracts/node':'contracts/validate.mjs',
};
await build({
  absWorkingDir:sdk,
  entryPoints:Object.values(entries).map(source=>path.join(sdk,source)),
  outdir:path.join(output,'esm'),
  outbase:sdk,entryNames:'[dir]/[name]',chunkNames:'chunks/[name]-[hash]',bundle:true,splitting:true,
  format:'esm',platform:'neutral',target:'es2022',packages:'external',
  jsx:'automatic',logLevel:'warning',
});
const schemas=path.join(output,'esm','contracts','schemas','v1');
mkdirSync(schemas,{recursive:true});
for(const name of readdirSync(path.join(sdk,'contracts','schemas','v1')).filter(name=>name.endsWith('.schema.json')))
  copyFileSync(path.join(sdk,'contracts','schemas','v1',name),path.join(schemas,name));
const tsc=path.join(root,'node_modules','typescript','bin','tsc');
if(!existsSync(tsc))throw new Error('Root TypeScript installation is required to build the SDK declarations.');
const types=spawnSync(process.execPath,[tsc,'--project',path.join(sdk,'tsconfig.package.json')],
  {cwd:root,stdio:'inherit'});
if(types.status!==0)throw new Error(`SDK declaration build failed (${types.status??types.error?.message}).`);
const declarationDir=path.join(output,'types','sdk','contracts');
mkdirSync(declarationDir,{recursive:true});
copyFileSync(path.join(sdk,'contracts','node.d.mts'),path.join(declarationDir,'node.d.mts'));
for(const relative of ['operations/handler.d.ts','operations/client.d.ts','files/types.d.ts'])
  copyFileSync(path.join(sdk,'public-declarations',relative),path.join(output,'types','sdk',relative));
function rewriteDeclarations(directory){
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())rewriteDeclarations(file);
    else if(entry.name.endsWith('.d.ts')){
      const original=readFileSync(file,'utf8');
      const rewritten=original.replace(/(['"])(\.{1,2}\/[^'"\n]+)\.tsx?\1/g,(_,quote,target)=>
        `${quote}${target}.js${quote}`);
      if(rewritten!==original)writeFileSync(file,rewritten);
    }
  }
}
rewriteDeclarations(path.join(output,'types','sdk'));
console.log('SDK ESM, declarations and contract schemas built in sdk/dist.');
