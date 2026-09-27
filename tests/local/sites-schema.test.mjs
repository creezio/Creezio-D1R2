import '../../scripts/local-environment.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,readdirSync,lstatSync,unlinkSync,rmdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Miniflare} from 'miniflare';
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
function taskPlan({snapshot=false,required=false,changedTitle=false,changedType=false,removedTitle=false,
  index=false,changedIndex=false}={}){
  const composition=json('../contracts/fixtures/valid-composition.json');
  const lock=json('../contracts/fixtures/valid-composition-lock.json');
  const module=json('../contracts/fixtures/valid-module.json');
  const task=module.contracts.models.find(model=>model.id==='task');
  if(changedTitle)task.fields.find(field=>field.id==='title').constraints.maxLength=201;
  if(changedType){const title=task.fields.find(field=>field.id==='title');title.type='integer';delete title.constraints;}
  if(removedTitle)task.fields=task.fields.filter(field=>field.id!=='title');
  if(snapshot)task.fields.push({id:'widget_context_snapshot',type:'json',nullable:!required,protected:true,computed:false});
  if(index)task.indexes.push({id:'snapshot',fields:['widget_context_snapshot'],unique:false});
  if(changedIndex)task.indexes[0].fields=['context_id','title'];
  lock.modules[0].contractIntegrity=contractIntegrity(module);
  lock.compositionIntegrity=contractIntegrity(composition);
  return compileCompositionSchema({composition,lock,modules:[module]});
}
const migrationStatements=sql=>sql.replace(/^--[^\n]*\n/,'').trim().split('\n--> statement-breakpoint\n');
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

test('Sites central journal adds a nullable column and index while preserving existing D1 rows',async()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'creezio-sites-schema-'));
  const runtime=new Miniflare({host:'127.0.0.1',port:0,cf:false,modules:true,
    script:'export default {fetch(){return new Response(null,{status:404});}};',
    compatibilityDate:'2026-05-15',d1Databases:['DB'],d1Persist:false});
  try{
    const db=await runtime.getD1Database('DB'),initial=taskPlan();
    const first=prepareSitesSchema(initial,directory);
    const firstSql=readFileSync(path.join(directory,first.migration),'utf8');
    await db.batch(migrationStatements(firstSql).map(statement=>db.prepare(statement)));
    const table=initial.runtimeCatalog.modules[0].models.find(model=>model.modelId==='task').table;
    await db.prepare(`INSERT INTO "${table}" (id,context_id,owner_id,title,record_version) VALUES (?,?,?,?,?)`)
      .bind('row-1','application','owner-1','preserved',1).run();
    const next=taskPlan({snapshot:true,index:true});
    const second=prepareSitesSchema(next,directory);
    assert.equal(second.addedColumns,1);assert.equal(second.addedObjects,1);
    const sql=readFileSync(path.join(directory,second.migration),'utf8');
    assert.match(sql,/ALTER TABLE "[^"]+" ADD COLUMN "widget_context_snapshot" TEXT CHECK \("widget_context_snapshot" IS NULL OR/);
    assert(!sql.includes('IF NOT EXISTS'));assert(!sql.includes('DROP TABLE'));
    assert.equal(migrationStatements(sql).length,2);
    await db.batch(migrationStatements(sql).map(statement=>db.prepare(statement)));
    const row=await db.prepare(`SELECT title,widget_context_snapshot FROM "${table}" WHERE id='row-1'`).first();
    assert.deepEqual(row,{title:'preserved',widget_context_snapshot:null});
    const actualSql=(await db.prepare('SELECT sql FROM sqlite_schema WHERE type=? AND name=?').bind('table',table).first()).sql;
    const canonicalSql=next.objects.find(object=>object.name===table).sql;
    assert.notEqual(actualSql,canonicalSql);
    assert.equal(second.objects.find(object=>object.name===table).sql,actualSql);
    const history=JSON.parse(readFileSync(path.join(directory,'db/creezio-schema-history.json'),'utf8'));
    assert.equal(history.objects.find(object=>object.name===table).canonicalSql,canonicalSql);
    const journal=readFileSync(path.join(directory,'drizzle/meta/_journal.json'),'utf8');
    assert.equal(JSON.parse(journal).entries.length,2);
    assert.equal(readFileSync(path.join(directory,first.migration),'utf8'),firstSql);
    assert(readFileSync(path.join(directory,'drizzle/meta/0001_snapshot.json'),'utf8').length>0);
    const repeat=prepareSitesSchema(next,directory);
    assert.equal(repeat.migration,null);assert.equal(repeat.addedColumns,0);assert.equal(repeat.addedObjects,0);
    assert.equal(readFileSync(path.join(directory,'drizzle/meta/_journal.json'),'utf8'),journal);
    assert.equal(readFileSync(path.join(directory,second.migration),'utf8'),sql);
  }finally{await runtime.dispose();dispose(directory);}
});

test('Sites central evolution rejects changed constraints and non-null column additions',()=>{
  const directory=mkdtempSync(path.join(tmpdir(),'creezio-sites-schema-'));
  try{
    prepareSitesSchema(taskPlan(),directory);
    assert.throws(()=>prepareSitesSchema(taskPlan({changedTitle:true}),directory),/Existing schema object changed/);
    assert.throws(()=>prepareSitesSchema(taskPlan({changedType:true}),directory),/Existing schema object changed/);
    assert.throws(()=>prepareSitesSchema(taskPlan({removedTitle:true}),directory),/Composition and lock are not valid|Existing schema object changed/);
    assert.throws(()=>prepareSitesSchema(taskPlan({changedIndex:true}),directory),/Existing schema object changed/);
    assert.throws(()=>prepareSitesSchema(taskPlan({snapshot:true,required:true}),directory),/Existing schema object changed/);
    const journal=JSON.parse(readFileSync(path.join(directory,'drizzle/meta/_journal.json'),'utf8'));
    assert.equal(journal.entries.length,1);
  }finally{dispose(directory);}
});
