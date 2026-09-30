import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {sharedWidgetScriptSources} from '../../scripts/build/compose-runtime.mjs';

const digest=text=>`sha256-${createHash('sha256').update(text).digest('hex')}`;

test('generated widget resources share only identical plain scripts and keep every HTML byte',()=>{
  const common='<script>const title="Shared widget"; const slash="\\";</script>';
  const texts=[
    `<!doctype html><main>first</main>${common}<p>after</p>`,
    `<!doctype html><main>second</main>${common}<p>other\uD800</p>`,
    '<!doctype html><script>unique()</script>',
    '<!doctype html><script type="module">attribute()</script>',
    '<!doctype html><script type="module">attribute()</script>',
    '<!doctype html><script>one()</script><script>two()</script>',
  ];
  const resources=texts.map((text,index)=>({uri:`ui://example/${index}`,digest:digest(text),text}));
  const {sharedScripts,resourceSources}=sharedWidgetScriptSources(resources);
  assert.deepEqual(sharedScripts,[common]);
  assert.equal(resourceSources.filter(source=>source.includes('widgetSharedScripts[0]')).length,2);
  const emitted=Buffer.from(`[${resourceSources.join(',')}]`,'utf8').toString('utf8');
  const reconstructed=runInNewContext(emitted,{widgetSharedScripts:sharedScripts});
  assert.equal(JSON.stringify(reconstructed),JSON.stringify(resources));
  for(const resource of reconstructed)assert.equal(digest(resource.text),resource.digest);
});
