import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildSync} from 'esbuild';
import {compileWidgetCatalog} from '../../scripts/widgets/compile.mjs';
const moduleRoot=new URL('../../extensions/native/support/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('module/manifest.json',moduleRoot),'utf8'));
const {operations}=manifest.contracts;
function compileSupportWidgets(keyField='requestKey'){
  const id=manifest.identity.id,digest=`sha256-${'a'.repeat(64)}`;
  const composition={modules:[{moduleId:id,enabled:true}],exposure:{admin:{moduleIds:[id]},app:{moduleIds:[id]}}};
  const operationCatalog={modules:[{moduleId:id,operations:operations.map(operation=>({operation:
    operation.kind==='command'?{...operation,idempotency:{...operation.idempotency,keyField}}:operation,
    active:true,contractDigest:digest}))}]};
  return compileWidgetCatalog({composition,modules:[manifest],operationCatalog,
    readAsset:(_id,path)=>readFileSync(new URL(path,moduleRoot),'utf8'),
    bundleRenderer:(_id,reference)=>buildSync({entryPoints:[fileURLToPath(new URL(reference.path,
      moduleRoot))],bundle:true,write:false,platform:'browser',format:'iife',
      globalName:'__creezioWidget',target:'es2022',minify:true,
      footer:{js:`__creezioWidget.${reference.export}();`}}).outputFiles[0].text});
}

test('four real renderer bundles compile against existing operation bindings',()=>{
  const catalog=compileSupportWidgets();
  assert.equal(catalog.widgets.length,4);
  assert.equal(catalog.resources.length,4);
  for(const widget of catalog.widgets){
    assert.equal(widget.renderTools.length,widget.widgetId.includes('-list-')?3:2);
    assert.equal(widget.serverTools.length,widget.actions.length);
    assert.equal(widget.audiences.length,1);
    assert.ok(widget.resourceUri.startsWith(`ui://creezio/${manifest.identity.id}/${widget.widgetId}/`));
    assert.ok(widget.serverTools.every(action=>action.visibility.includes('app')));
  }
});

test('widget command key accepts JSON field names but rejects unsafe or invalid fields',()=>{
  for(const invalid of ['__proto__','line\n','bad/name','x'.repeat(129)])
    assert.throws(()=>compileSupportWidgets(invalid),{code:'compiled-catalog'});
});
