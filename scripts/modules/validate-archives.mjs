import {execFileSync,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,realpathSync,rmSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {packModuleArtifacts} from './archives.mjs';
import {safePackagePath} from '../../sdk/contracts/references.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const quality=resolve(root,'.quality');
const stages=resolve(quality,'archive-validation');
const within=(base,target)=>target===base||target.startsWith(`${base}${sep}`);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

export function parseArchiveValidationArgs(args){
  if(args.length<5||args[0]!=='--sdk-archive'||args[2]!=='--sdk-sha256')
    throw Error('Usage: validate-archives.mjs --sdk-archive <path> --sdk-sha256 <64 hex> <module paths...>');
  const [,sdkArchive,,sdkSha256,...modules]=args;
  if(!/^[a-f0-9]{64}$/i.test(sdkSha256))throw Error('Invalid SDK SHA-256');
  if(modules.length>32||modules.length===0||new Set(modules).size!==modules.length)
    throw Error('Invalid module list');
  for(const directory of modules){
    if(!/^(?:extensions\/native|extensions\/common|extensions\/connectors)\/[a-z][a-z0-9-]*$/.test(directory))
      throw Error(`Unsupported module directory: ${directory}`);
  }
  return {sdkArchive:resolve(sdkArchive),sdkSha256:sdkSha256.toLowerCase(),modules};
}

function regularFile(path){
  const info=lstatSync(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size>100*1024*1024)
    throw Error(`Invalid archive file: ${path}`);
}
function directoryWithoutLinks(path){
  if(!existsSync(path))throw Error(`Missing directory: ${path}`);
  const info=lstatSync(path);
  if(!info.isDirectory()||info.isSymbolicLink())throw Error(`Unsafe directory: ${path}`);
}
function scanNoLinks(path){
  const info=lstatSync(path);
  if(info.isSymbolicLink())throw Error(`Assembly contains a link: ${path}`);
  if(info.isDirectory())for(const entry of readdirSync(path))scanNoLinks(join(path,entry));
  else if(!info.isFile())throw Error(`Assembly contains a non-file: ${path}`);
}
export function assertArchiveValidationStage(stage,base=stages){
  const resolvedBase=resolve(base),resolvedStage=resolve(stage);
  if(!within(resolvedBase,resolvedStage)||resolvedStage===resolvedBase)
    throw Error(`Unsafe validation stage: ${stage}`);
  directoryWithoutLinks(resolvedBase);
  directoryWithoutLinks(resolvedStage);
  if(!within(realpathSync(resolvedBase),realpathSync(resolvedStage)))
    throw Error(`Validation stage escaped: ${stage}`);
  scanNoLinks(resolvedStage);
  return resolvedStage;
}
function cleanupStage(stage){
  assertArchiveValidationStage(stage);
  if(process.platform!=='win32')rmSync(stage,{recursive:true});
  else{
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      'Remove-Item -LiteralPath $env:CREEZIO_ARCHIVE_VALIDATION_STAGE -Recurse -Force -ErrorAction Stop'],
    {encoding:'utf8',timeout:30000,env:{...process.env,CREEZIO_ARCHIVE_VALIDATION_STAGE:stage}});
    if(result.status!==0)throw Error(`Validation stage preserved after cleanup refusal: ${stage}; ${result.stderr||result.error?.message||''}`);
  }
  if(existsSync(stage))throw Error(`Validation stage preserved after cleanup: ${stage}`);
}
export function inspectSdkTarEntries(namesText,verboseText){
  const names=namesText.trimEnd().split(/\r?\n/),types=verboseText.trimEnd().split(/\r?\n/);
  if(names.length<2||names.length>2000||names.length!==types.length||new Set(names).size!==names.length
    ||!names.includes('package/package.json'))throw Error('SDK archive inventory refused');
  for(const [index,name] of names.entries()){
    if(!name.startsWith('package/')||!safePackagePath(name)||types[index]?.[0]!=='-')
      throw Error(`SDK archive entry refused: ${name}`);
  }
  return names.length;
}
function sdkDescriptor(sdkArchive,sdkSha256){
  regularFile(sdkArchive);
  if(sha256(readFileSync(sdkArchive))!==sdkSha256)throw Error('SDK archive digest mismatch');
  inspectSdkTarEntries(
    execFileSync('tar',['-tf',sdkArchive],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024}),
    execFileSync('tar',['-tvf',sdkArchive],{encoding:'utf8',timeout:30000,maxBuffer:1024*1024}));
  const sdk=JSON.parse(execFileSync('tar',['-xOf',sdkArchive,'package/package.json'],
    {encoding:'utf8',timeout:30000,maxBuffer:1024*1024}));
  if(sdk.name!=='@creezio/sdk'||typeof sdk.version!=='string'||!sdk.exports)
    throw Error('SDK archive identity mismatch');
  return sdk;
}
export function packArchiveValidationArtifacts({root,moduleDirectory,descriptor}){
  return packModuleArtifacts({root,moduleDirectory,moduleId:descriptor.identity.id,
    descriptor,writeCache:true});
}
export function moduleSpecifiers(body,file){
  const scriptKind=/\.tsx$/.test(file)?ts.ScriptKind.TSX:/\.tsx?$/.test(file)?ts.ScriptKind.TS:ts.ScriptKind.JS;
  const source=ts.createSourceFile(file,body,ts.ScriptTarget.Latest,true,scriptKind);
  const specs=[];
  const visit=node=>{
    if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))
      &&node.moduleSpecifier&&ts.isStringLiteralLike(node.moduleSpecifier))
      specs.push(node.moduleSpecifier.text);
    else if(ts.isImportEqualsDeclaration(node)&&ts.isExternalModuleReference(node.moduleReference)
      &&node.moduleReference.expression&&ts.isStringLiteralLike(node.moduleReference.expression))
      specs.push(node.moduleReference.expression.text);
    else if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword
      &&node.arguments.length===1&&ts.isStringLiteralLike(node.arguments[0]))
      specs.push(node.arguments[0].text);
    ts.forEachChild(node,visit);
  };
  visit(source);
  return specs;
}
function checkModule(directory,sdk){
  const source=resolve(root,directory),manifest=JSON.parse(readFileSync(join(source,'module/manifest.json'),'utf8'));
  let artifacts;
  try{artifacts=packArchiveValidationArtifacts({root,moduleDirectory:source,descriptor:manifest});}
  catch(error){throw Error(`${directory}: ${error.message}`,{cause:error});}
  const names=new Set([...manifest.packaging.runtime.files,...manifest.packaging.validation.files]);
  let imports=0;
  for(const name of names){
    if(!/\.(?:ts|tsx|mjs|js)$/.test(name))continue;
    const file=resolve(source,name),body=readFileSync(file,'utf8');
    for(const spec of moduleSpecifiers(body,name)){
      if(spec.startsWith('.')){
        const target=resolve(dirname(file),spec),inside=relative(source,target).replaceAll('\\','/');
        if(inside.startsWith('..')||!names.has(inside))throw Error(`${directory}: ${name} imports absent ${spec}`);
      }else if(spec.startsWith('@creezio/sdk/')){
        if(!Object.hasOwn(sdk.exports,`.${spec.slice('@creezio/sdk'.length)}`))
          throw Error(`${directory}: ${name} imports nonpublic ${spec}`);
      }else if(!spec.startsWith('node:')){
        const packageName=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];
        if(!existsSync(resolve(root,'node_modules',packageName,'package.json')))
          throw Error(`${directory}: ${name} imports missing dependency ${spec}`);
      }
      imports++;
    }
  }
  for(const kind of ['runtime','validation']){
    const declared=manifest.packaging[kind].files;
    const candidates=execFileSync('tar',['-tf',resolve(root,artifacts[kind].path)],
      {encoding:'utf8',timeout:30000}).trim().split(/\r?\n/);
    if(candidates.length!==declared.length||candidates.some(name=>!declared.includes(name)))
      throw Error(`${directory}: ${kind} inventory mismatch`);
  }
  return {directory,manifest,artifacts,imports};
}
// Archive code runs as Node children; pass only the OS paths needed by Node and
// a temporary directory owned by this validation run. Nested test children
// inherit this same restricted environment.
export function runClosedArchiveNode(stage,args,options){
  const temporary=join(stage,'child-tmp');
  mkdirSync(temporary,{recursive:true});
  const env={PATH:dirname(process.execPath),TMP:temporary,TEMP:temporary,TMPDIR:temporary};
  if(process.platform==='win32'){
    if(process.env.SystemRoot)env.SystemRoot=process.env.SystemRoot;
    if(process.env.WINDIR)env.WINDIR=process.env.WINDIR;
  }
  return execFileSync(process.execPath,args,{...options,env});
}
function executeClosed(stage,sdkArchive,sdk,checked,results){
  const scoped=join(stage,'node_modules/@creezio');
  mkdirSync(scoped,{recursive:true});
  execFileSync('tar',['-xf',sdkArchive,'-C',scoped],{timeout:30000});
  const extracted=join(scoped,'package'),sdkDirectory=join(scoped,'sdk');
  if(!existsSync(extracted)||existsSync(sdkDirectory))throw Error('SDK extraction collision');
  renameSync(extracted,sdkDirectory);
  scanNoLinks(sdkDirectory);
  const installed=JSON.parse(readFileSync(join(sdkDirectory,'package.json'),'utf8'));
  if(installed.name!==sdk.name||installed.version!==sdk.version)throw Error('Assembled SDK mismatch');
  const modules=join(stage,'modules');mkdirSync(modules);
  for(const {directory,manifest,artifacts,imports} of checked){
    const assembled=resolve(modules,manifest.identity.id);
    if(!within(modules,assembled)||existsSync(assembled))throw Error(`Assembly collision: ${assembled}`);
    mkdirSync(assembled);
    for(const kind of ['runtime','validation'])
      execFileSync('tar',['-xf',resolve(root,artifacts[kind].path),'-C',assembled],{timeout:30000});
    scanNoLinks(assembled);
    const modelsFile=join(assembled,'module/models.json');
    const hasModelsFile=existsSync(modelsFile);
    const files=['module/manifest.json',
      ...(manifest.contracts.models.length>0||hasModelsFile?['module/models.json']:[])];
    const before=files.map(name=>sha256(readFileSync(join(assembled,name))));
    runClosedArchiveNode(stage,['module/generate-manifest.mjs'],{cwd:assembled,timeout:30000});
    if(existsSync(modelsFile)!==hasModelsFile
      ||files.some((name,index)=>sha256(readFileSync(join(assembled,name)))!==before[index]))
      throw Error(`${directory}: generator changed packaged contract`);
    const gate=JSON.parse(runClosedArchiveNode(stage,['gate.mjs'],{cwd:assembled,encoding:'utf8',
      timeout:90000,maxBuffer:8*1024*1024}));
    const suites=['backend','ui','api-mcp','widgets','package','docs'];
    if(!Array.isArray(gate.results)||gate.results.length!==suites.length
      ||gate.results.some((item,index)=>item.suite!==suites[index]
        ||!['passed','not-applicable'].includes(item.status)||!Number.isInteger(item.tests)||item.tests<1))
      throw Error(`${directory}: incomplete closed gate`);
    results.push({moduleId:manifest.identity.id,imports,
      runtimeIntegrity:artifacts.runtime.integrity,validationIntegrity:artifacts.validation.integrity,
      closedGate:gate.results});
  }
}
export function runArchiveValidation(args){
  const parsed=parseArchiveValidationArgs(args);
  const sdk=sdkDescriptor(parsed.sdkArchive,parsed.sdkSha256);
  const checked=parsed.modules.map(directory=>checkModule(directory,sdk));
  directoryWithoutLinks(quality);
  if(!existsSync(stages))mkdirSync(stages);
  directoryWithoutLinks(stages);
  const stage=resolve(stages,randomUUID());
  mkdirSync(stage);
  const results=[];
  let result,error;
  try{
    executeClosed(stage,parsed.sdkArchive,sdk,checked,results);
    result={sdkVersion:sdk.version,sdkSha256:parsed.sdkSha256,results};
  }catch(caught){error=caught;}
  try{cleanupStage(stage);}catch(caught){
    if(error)error.message+=`\n${caught.message}`;
    else error=caught;
  }
  if(error)throw error;
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(runArchiveValidation(process.argv.slice(2)),null,2));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
