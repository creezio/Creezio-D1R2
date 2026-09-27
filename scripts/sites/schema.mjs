import {readFileSync,writeFileSync,mkdirSync,existsSync,lstatSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isCompositionSchemaPlan,schemaDigest} from '../data/composition-schema.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const normalized=sql=>sql.trim().replace(/;$/,'').trimEnd();
const identifier=/^[A-Za-z_][A-Za-z0-9_]*$/;
function tableParts(object) {
  const sql=normalized(object.sql),match=/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)" \(\n([\s\S]+)\n\) WITHOUT ROWID$/.exec(sql);
  if(!match||match[1]!==object.name||object.table!==object.name)return null;
  const columns=new Map(),constraints=[];
  for(const raw of match[2].split('\n')){
    if(!raw.startsWith('  '))return null;
    const line=raw.slice(2).replace(/,$/,'');
    const column=/^"([A-Za-z_][A-Za-z0-9_]*)" (.+)$/.exec(line);
    if(column){if(columns.has(column[1].toLowerCase()))return null;columns.set(column[1].toLowerCase(),{name:column[1],definition:column[2]});}
    else if(/^(?:PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK) \(/.test(line))constraints.push(line);
    else return null;
  }
  return {columns,constraints};
}
function addedNullableColumns(old,object) {
  const before=tableParts(old),after=tableParts(object);
  if(!before||!after||JSON.stringify(before.constraints)!==JSON.stringify(after.constraints))return null;
  const oldNames=[...before.columns.keys()],newNames=[...after.columns.keys()];
  if(JSON.stringify(oldNames)!==JSON.stringify(newNames.filter(name=>before.columns.has(name))))return null;
  for(const [name,column] of before.columns){
    const current=after.columns.get(name);
    if(!current||current.name!==column.name||current.definition!==column.definition)return null;
  }
  const additions=[];
  for(const [name,column] of after.columns){
    if(before.columns.has(name))continue;
    const quoted=`"${column.name}"`,type=/^(TEXT|INTEGER|REAL|BLOB)(?: |$)/.exec(column.definition)?.[1];
    const nullable=type&&(column.definition===type||column.definition.startsWith(`${type} CHECK (${quoted} IS NULL OR (`)
      &&column.definition.endsWith('))'));
    if(!identifier.test(column.name)||!nullable||/[;\r\n]/.test(column.definition))return null;
    additions.push({name:column.name,definition:column.definition});
  }
  return additions.length?additions:null;
}
function projectedAlteredSql(previousSql,columns) {
  let sql=normalized(previousSql);
  for(const column of columns){
    // SQLite appends a column immediately before the first table constraint, using a space
    // after the prior comma. Keep the exact sqlite_schema text expected after this DDL.
    const boundary=/,\n  (?:PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK) \(/.exec(sql);
    if(!boundary)throw new Error('Cannot project the centrally approved table alteration.');
    sql=sql.slice(0,boundary.index)+`, "${column.name}" ${column.definition}`+sql.slice(boundary.index);
  }
  return sql;
}
function assertSafePath(value,kind) {
  const absolute=path.resolve(value);
  for(let cursor=absolute;;cursor=path.dirname(cursor)){
    const stat=lstatSync(cursor,{throwIfNoEntry:false});
    if(stat&&(stat.isSymbolicLink()||(cursor===absolute
      ? kind==='directory'&&!stat.isDirectory()||kind==='file'&&!stat.isFile()
      : !stat.isDirectory())))
      throw new Error('Linked or non-regular Sites paths are refused.');
    if(cursor===path.dirname(cursor))break;
  }
  return absolute;
}
function safeDirectory(value) {
  const absolute=assertSafePath(value,'directory');
  mkdirSync(absolute,{recursive:true});return assertSafePath(absolute,'directory');
}
function safeFile(value) {return assertSafePath(value,'file');}
function assertSafeTree(directory) {
  for(const name of readdirSync(directory)){
    const entry=path.join(directory,name),stat=lstatSync(entry);
    if(stat.isSymbolicLink()||(!stat.isDirectory()&&!stat.isFile()))
      throw new Error('Linked or non-regular Sites paths are refused.');
    if(stat.isDirectory())assertSafeTree(entry);
  }
}
const json=file=>JSON.parse(readFileSync(safeFile(file),'utf8'));
const write=(file,value)=>writeFileSync(safeFile(file),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');

/** Drizzle owns the deployment journal. Its custom-DDL envelope retains the approved compiler's
 * checks and WITHOUT ROWID definitions, which a second ORM model compiler would otherwise change.
 * Only new objects and explicitly nullable columns are supported; applied files are never rewritten.
 */
export function prepareSitesSchema(plan,output,{drizzleCli=path.join(root,'node_modules/drizzle-kit/bin.cjs')}={}) {
  if(!isCompositionSchemaPlan(plan))throw new Error('An approved central composition schema is required.');
  const target=safeDirectory(output),db=safeDirectory(path.join(target,'db'));
  // Drizzle initializes its own directories and journal on the first generation.
  const drizzle=assertSafePath(path.join(target,'drizzle'),'directory');
  assertSafePath(path.join(drizzle,'meta'),'directory');
  if(existsSync(drizzle))assertSafeTree(drizzle);
  const historyPath=path.join(db,'creezio-schema-history.json');
  const previous=existsSync(historyPath)?json(historyPath):null;
  if(previous&&previous.applicationId!==plan.applicationId)throw new Error('Sites schema belongs to another application.');
  for(const item of previous?.files??[]){
    if(!/^(?:drizzle\/)[A-Za-z0-9_./-]+$/.test(item.path)||item.path.split('/').includes('..')
      ||schemaDigest(readFileSync(safeFile(path.join(target,item.path)),'utf8'))!==item.digest)
      throw new Error('An existing generated schema artifact changed; inspect before publication.');
  }
  const retained=previous?.objects??[],byName=new Map(retained.map(o=>[o.name,o])),additions=[],alterations=[],updates=new Map();
  for(const object of plan.objects){
    const old=byName.get(object.name);
    const canonical=old?.canonicalSql??old?.sql;
    if(old&&(old.type!==object.type||old.table!==object.table||normalized(canonical)!==normalized(object.sql))){
      const columns=old.type==='table'&&object.type==='table'?addedNullableColumns({...old,sql:canonical},object):null;
      if(!columns)throw new Error(`Existing schema object changed: ${object.name}. A centrally reviewed evolution is required.`);
      alterations.push(...columns.map(column=>`ALTER TABLE "${object.name}" ADD COLUMN "${column.name}" ${column.definition}`));
      updates.set(object.name,{...object,sql:projectedAlteredSql(old.sql,columns),canonicalSql:normalized(object.sql)});
    }
    if(!old)additions.push(object);
  }
  const historyObjects=[...retained.map(old=>updates.get(old.name)??old),...additions]
    .map(o=>({...o,sql:normalized(o.sql)}));
  // The install operator must compare the exact SQLite definition, while future compilation
  // compares the canonical model kept only in this central history.
  const objects=historyObjects.map(({canonicalSql:_canonicalSql,...object})=>object);
  const schemaPath=path.join(db,'schema.ts');
  const source='// Generated from Creezio current model declarations. Do not author a parallel ORM schema.\n'
    +'// Deployment uses Drizzle custom DDL generated by the central Creezio compiler.\n'
    +`export const currentModelDeclarations = ${JSON.stringify({host:plan.host,modules:plan.runtimeCatalog.modules},null,2)} as const;\n`;
  write(schemaPath,source);
  const config=path.join(target,'drizzle.config.cjs');
  write(config,"module.exports={dialect:'sqlite',schema:'./db/schema.ts',out:'./drizzle'};\n");
  let migration=null,files=[...(previous?.files??[])];
  if(additions.length||alterations.length){
    const journal=path.join(drizzle,'meta/_journal.json');
    const before=existsSync(journal)?json(journal).entries:[];
    execFileSync(process.execPath,[drizzleCli,'generate','--custom','--name',`creezio_${plan.modelDigest.slice(7,19)}`,'--config',config],
      {cwd:target,encoding:'utf8',timeout:30_000,stdio:['ignore','pipe','pipe'],windowsHide:true});
    assertSafePath(drizzle,'directory');
    assertSafePath(path.join(drizzle,'meta'),'directory');
    assertSafeTree(drizzle);
    const next=json(journal).entries;
    if(next.length!==before.length+1||JSON.stringify(next.slice(0,-1))!==JSON.stringify(before))throw new Error('Unexpected Drizzle journal change.');
    const entry=next.at(-1);if(!/^[A-Za-z0-9_-]+$/.test(entry.tag))throw new Error('Invalid Drizzle entry.');
    migration=`drizzle/${entry.tag}.sql`;
    const sql='-- Generated centrally from current Creezio declarations; schema only.\n'
      +[...alterations,...additions.map(o=>normalized(o.sql))].map(statement=>statement+';').join('\n--> statement-breakpoint\n')+'\n';
    write(path.join(target,migration),sql);
    files=files.filter(f=>f.path!=='drizzle/meta/_journal.json');
    const snapshot=`drizzle/meta/${String(entry.idx).padStart(4,'0')}_snapshot.json`;
    for(const relative of [migration,snapshot,'drizzle/meta/_journal.json'])if(existsSync(path.join(target,relative)))
      files.push({path:relative,digest:schemaDigest(readFileSync(safeFile(path.join(target,relative)),'utf8'))});
  }
  const history={schemaVersion:1,applicationId:plan.applicationId,compositionDigest:plan.compositionDigest,
    modelDigest:plan.modelDigest,objects:historyObjects,files};
  write(historyPath,history);
  return {migration,addedObjects:additions.length,addedColumns:alterations.length,retainedObjects:retained.length,objects,
    digest:schemaDigest(objects),historyPath};
}
