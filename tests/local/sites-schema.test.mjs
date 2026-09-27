import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,readdirSync,lstatSync,unlinkSync,rmdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {compileCompositionSchema} from '../../scripts/data/composition-schema.mjs';
import {contractIntegrity} from '../../sdk/contracts/validate.mjs';
import {prepareSitesSchema} from '../../scripts/sites/schema.mjs';

const json=name=>JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
function plan(){
  const composition=json('../contracts/fixtures/valid-composition.json');
  const lock=json('../contracts/fixtures/valid-composition-lock.json');
  composition.modules=[];lock.modules=[];composition.exposure.admin.moduleIds=[];composition.exposure.app.moduleIds=[];
  lock.compositionIntegrity=contractIntegrity(composition);
  return compileCompositionSchema({composition,lock,modules:[]});
}
// Only files in this test's fresh directory, no links, no recursive delete primitive.
function dispose(directory,boundary=directory){
  const relative=path.relative(boundary,directory);
  assert(!relative.startsWith('..')&&!path.isAbsolute(relative));assert(!lstatSync(directory).isSymbolicLink());
  for(const name of readdirSync(directory)){
    const target=path.join(directory,name),stat=lstatSync(target);assert(!stat.isSymbolicLink());
    if(stat.isDirectory())dispose(target,boundary);else unlinkSync(target);
  }
  rmdirSync(directory);
}

test('Sites custom DDL keeps central checks, reuses its journal and refuses modified publication history',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'creezio-sites-schema-'));
  try {
    const input=plan(),first=prepareSitesSchema(input,directory);
    assert(first.addedObjects>0);assert.match(first.migration,/^drizzle\/0000_/);
    const sql=readFileSync(path.join(directory,first.migration),'utf8');
    assert.equal(sql.split('--> statement-breakpoint').length,input.objects.length);
    for(const object of input.objects)assert(sql.includes(object.sql));
    assert(sql.includes('WITHOUT ROWID'));assert(!/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)/i.test(sql));
    const journal=readFileSync(path.join(directory,'drizzle/meta/_journal.json'),'utf8');
    const repeat=prepareSitesSchema(input,directory);assert.equal(repeat.addedObjects,0);assert.equal(repeat.migration,null);
    assert.equal(readFileSync(path.join(directory,'drizzle/meta/_journal.json'),'utf8'),journal);
    assert.equal(readFileSync(path.join(directory,first.migration),'utf8'),sql);
    writeFileSync(path.join(directory,first.migration),sql+'-- unexpected edit\n');
    assert.throws(()=>prepareSitesSchema(input,directory),/artifact changed/);
  } finally {dispose(directory);}
});

test('Sites schema generation refuses a linked Drizzle directory without touching its target',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'creezio-sites-schema-'));
  const external=mkdtempSync(path.join(tmpdir(),'creezio-sites-external-'));
  const link=path.join(directory,'drizzle'),sentinel=path.join(external,'sentinel.txt');
  try {
    writeFileSync(sentinel,'preserve this external directory');
    symlinkSync(external,link,process.platform==='win32'?'junction':'dir');
    assert(lstatSync(link).isSymbolicLink());
    assert.throws(()=>prepareSitesSchema(plan(),directory),/Linked or non-regular Sites paths/);
    assert.deepEqual(readdirSync(external),['sentinel.txt']);
    assert.equal(readFileSync(sentinel,'utf8'),'preserve this external directory');
  } finally {
    if(lstatSync(link,{throwIfNoEntry:false})?.isSymbolicLink()){
      try {unlinkSync(link);} catch(error){if(error.code==='EPERM'||error.code==='EISDIR')rmdirSync(link);else throw error;}
    }
    dispose(directory);dispose(external);
  }
});
