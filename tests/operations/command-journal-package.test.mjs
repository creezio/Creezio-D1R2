import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import ts from 'typescript';

const root=fileURLToPath(new URL('../../',import.meta.url));
const source=path.join(root,'sdk','operations','command-journal.ts');
const read=relative=>readFileSync(path.join(root,relative),'utf8');

test('command journal is selected as a public SDK entry and package file',()=>{
  const pkg=JSON.parse(read('sdk/package.json'));
  const entry=pkg.exports['./operations/command-journal'];
  assert.deepEqual(entry,{types:'./dist/types/sdk/operations/command-journal.d.ts',
    import:'./dist/esm/operations/command-journal.js'});
  assert.ok(pkg.files.includes('dist/types/sdk/operations/command-journal.d.ts'));
  assert.ok(JSON.parse(read('sdk/tsconfig.package.json')).include.includes('operations/command-journal.ts'));
  assert.match(read('scripts/sdk/build.mjs'),/'operations\/command-journal':'operations\/command-journal\.ts'/);
});

test('browser entry has no runtime core dependency and declarations use only a public SDK type',async()=>{
  const bundle=await build({entryPoints:[source],bundle:true,write:false,metafile:true,
    platform:'browser',format:'esm',target:'es2022',packages:'external',logLevel:'silent'});
  assert.deepEqual(Object.keys(bundle.metafile.inputs).map(name=>path.basename(name)),['command-journal.ts']);
  assert.doesNotMatch(bundle.outputFiles[0].text,/core\/|node:/);

  const config=ts.readConfigFile(path.join(root,'sdk','tsconfig.package.json'),ts.sys.readFile);
  assert.equal(config.error,undefined);
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,path.join(root,'sdk'));
  const host=ts.createCompilerHost(parsed.options);
  let declaration='';
  host.writeFile=(name,content)=>{if(name.endsWith('command-journal.d.ts'))declaration=content;};
  const program=ts.createProgram([source],parsed.options,host);
  const ownErrors=ts.getPreEmitDiagnostics(program).filter(d=>d.file&&path.resolve(d.file.fileName)===source);
  assert.deepEqual(ownErrors.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[]);
  assert.equal(program.emit().emitSkipped,false);
  assert.ok(declaration.includes('createCommandJournal'));
  assert.doesNotMatch(declaration,/\bany\b|core\//);
  const rewritten=declaration.replace(/(['"])(\.{1,2}\/[^'"\n]+)\.tsx?\1/g,(_,quote,target)=>
    `${quote}${target}.js${quote}`);
  assert.deepEqual([...rewritten.matchAll(/from ['"]([^'"]+)['"]/g)].map(match=>match[1]),['./client.js']);
  assert.doesNotMatch(read('sdk/public-declarations/operations/client.d.ts'),/core\//);
});
