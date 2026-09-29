import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';

const {operations,mcp,widgets}=manifest.contracts;
const operationById=new Map(operations.map(operation=>[operation.id,operation]));
const toolById=new Map(mcp.tools.map(tool=>[tool.id,tool]));

test('four audience-specific Support cards bind existing reads and commands',()=>{
  const names=['ticket-list-app','ticket-list-admin','ticket-thread-app','ticket-thread-admin'];
  assert.deepEqual(widgets.map(widget=>widget.id),names);
  assert.deepEqual(mcp.resources.map(resource=>resource.id),names.map(name=>`${name}-ui`));
  assert.equal(manifest.validation.suites.widgets.mode,'required');
  for(const widget of widgets){
    assert.deepEqual(widget.audiences,[widget.id.endsWith('-app')?'app':'admin']);
    assert.equal(widget.transport.uncertainResult,'reconcile-before-retry');
    assert.deepEqual(widget.permissions,[{moduleId:'creezio.support',kind:'permission',id:'use'}]);
    for(const action of widget.actions){
      const operation=operationById.get(action.target.operation.id);
      assert.ok(operation);
      assert.deepEqual(action.input,operation.input);
      const tool=[...toolById.values()].find(candidate=>candidate.widget?.id===widget.id&&
        candidate.operation.id===operation.id);
      assert.ok(tool,`${widget.id}/${action.id}`);
      assert.equal(tool.textFallback,true);
    }
  }
  assert.deepEqual(widgets[0].actions.map(action=>action.id),['list','open','messages','create']);
  assert.deepEqual(widgets[1].actions.map(action=>action.id),['list','open','messages']);
  assert.deepEqual(widgets[2].actions.map(action=>action.id),['read','messages','send']);
  assert.deepEqual(widgets[3].actions.map(action=>action.id),['read','messages','send']);
  assert.deepEqual(operationById.get('ticket.create').audiences,['app']);
  assert.deepEqual(operationById.get('message.customer').audiences,['app']);
  assert.deepEqual(operationById.get('message.reply').audiences,['admin']);
});

test('skill is bound and original UI files are retained beside self-contained renderers',()=>{
  assert.equal(mcp.skills.length,1);
  assert.equal(mcp.skills[0].path,'plugin/skills/support.md');
  assert.match(read('plugin/skills/support.md'),/issue inconnue/);
  assert.ok(manifest.packaging.runtime.files.includes('ui/index.tsx'));
  assert.ok(manifest.packaging.runtime.files.includes('ui/widgets/runtime.ts'));
  assert.ok(manifest.packaging.validation.files.includes('tests/widgets/runtime.test.mjs'));
});

test('message-page envelope fits its declared bound with maximum escaped bodies',()=>{
  const long='"\\'.repeat(1000);
  const output={items:Array.from({length:40},(_,i)=>({id:`m${i}`,ticketId:'ticket-1',origin:'client',
    authorId:'actor-1',body:long,createdAt:'2026-09-29T00:00:00Z'})),nextCursor:'cursor'};
  const envelope={content:[{type:'text',text:JSON.stringify({state:'succeeded',output})}],
    structuredContent:{kind:'creezio.widget.action.v1',state:'succeeded',output}};
  const bytes=Buffer.byteLength(JSON.stringify(envelope));
  assert.ok(bytes>200000);
  assert.ok(bytes<widgets[2].transport.maxPayloadBytes,`${bytes} bytes`);
});
