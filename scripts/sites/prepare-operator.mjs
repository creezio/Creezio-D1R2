import {readFileSync,writeFileSync,mkdirSync,lstatSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {loadCompositionSchema,schemaDigest} from '../data/composition-schema.mjs';
import {prepareSitesSchema} from './schema.mjs';
import {loadSitesBuildConfiguration} from './config.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const [targetArg,providerObjectsFile,...extra]=process.argv.slice(2);
if(!targetArg||extra.length||!path.isAbsolute(targetArg))throw new Error('Expected an absolute selected Site directory and optional inspected provider-schema JSON.');
const target=path.resolve(targetArg);
if(target===path.resolve(root)||target.startsWith(path.resolve(root)+path.sep))throw new Error('Operator source must be separate from the application checkout.');
const configuration=loadSitesBuildConfiguration({root,hostingPath:path.join(target,'.openai/hosting.json')});
for(const name of ['operator.mjs','build.mjs','package.json','.gitignore','operator-provenance.json']){
  const file=path.join(target,name);
  const stat=lstatSync(file,{throwIfNoEntry:false});
  if(stat&&(!stat.isFile()||stat.isSymbolicLink()))throw new Error('Unsafe operator output.');
}
const plan=await loadCompositionSchema({root,compositionPath:process.env.CREEZIO_COMPOSITION??'configuration/composition.json',
  ...(process.env.CREEZIO_COMPOSITION_LOCK?{lockPath:process.env.CREEZIO_COMPOSITION_LOCK}:{})});
const schema=prepareSitesSchema(plan,target);
const providerObjects=providerObjectsFile?JSON.parse(readFileSync(providerObjectsFile,'utf8')):[];
if(!Array.isArray(providerObjects)||providerObjects.length>16)throw new Error('Invalid inspected provider schema.');
const operatorPlan={schemaVersion:1,applicationId:plan.applicationId,digest:plan.planDigest,
  objects:schema.objects,providerObjects};
const contents=`import {createHostedInstallOperator} from './adapters/sites/operator.ts';\nexport default createHostedInstallOperator(${JSON.stringify(operatorPlan)});\n`;
const bundled=await build({absWorkingDir:root,bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:'es2022',
  minify:false,legalComments:'inline',sourcemap:false,logLevel:'silent',
  stdin:{contents,resolveDir:root,sourcefile:'creezio-hosted-operator.ts',loader:'ts'}});
if(Object.values(bundled.metafile.outputs).some(output=>output.imports.length))throw new Error('Operator contains unresolved imports.');
const code=bundled.outputFiles[0].text;
writeFileSync(path.join(target,'operator.mjs'),code);
writeFileSync(path.join(target,'build.mjs'),
  readFileSync(new URL('./artifacts.mjs',import.meta.url),'utf8')+'\nawait buildOperator();\n');
writeFileSync(path.join(target,'package.json'),JSON.stringify({name:'creezio-hosted-installer',private:true,type:'module',
  scripts:{build:'node build.mjs'}},null,2)+'\n');
if(!existsSync(path.join(target,'.gitignore')))writeFileSync(path.join(target,'.gitignore'),'.env*\n.dev.vars*\n*.clixml\nnode_modules/\ndist/\n.sites-runtime/\n.wrangler/\n');
const provenance={schemaVersion:1,kind:'temporary-native-installer',projectId:configuration.projectId,
  applicationId:plan.applicationId,compositionDigest:plan.compositionDigest,planDigest:plan.planDigest,
  operatorDigest:schemaDigest(code),sourceFiles:Object.keys(bundled.metafile.inputs).filter(p=>p!=='creezio-hosted-operator.ts')
    .map(relative=>({path:relative,digest:schemaDigest(readFileSync(path.join(root,relative),'utf8'))})),
  schemaObjects:schema.objects.length,providerObjects:providerObjects.length};
writeFileSync(path.join(target,'operator-provenance.json'),JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({projectId:configuration.projectId,planDigest:plan.planDigest,operatorDigest:provenance.operatorDigest,
  schemaObjects:schema.objects.length,providerObjects:providerObjects.length,bytes:Buffer.byteLength(code),sourcePath:target}));
