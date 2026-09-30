import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMeiliTask,parseEnqueuedTask} from '../../module/task.ts';

const indexUid='cz_0123456789abcdef0123456789abcdef0123456789abcdef';
test('202 acknowledgement and later status bind the exact UID and index without exposing provider errors',()=>{
  const ack=parseEnqueuedTask({taskUid:12,indexUid,status:'enqueued',type:'documentAdditionOrUpdate',
    error:{message:'secret'}},indexUid,'documentAdditionOrUpdate');
  assert.deepEqual(ack,{taskUid:12,indexUid,status:'enqueued',type:'documentAdditionOrUpdate'});
  const failed=parseMeiliTask({uid:12,indexUid,status:'failed',type:'documentAdditionOrUpdate',
    error:{message:'private provider body'}},{taskUid:12,indexUid});
  assert.equal(failed.status,'failed');
  assert.doesNotMatch(JSON.stringify(failed),/private|secret/u);
  assert.throws(()=>parseMeiliTask({uid:12,indexUid:'other',status:'succeeded',type:'documentAdditionOrUpdate'},
    {taskUid:12,indexUid}),{code:'unavailable'});
  assert.throws(()=>parseEnqueuedTask({taskUid:12,indexUid,status:'succeeded',type:'documentAdditionOrUpdate'},
    indexUid,'documentAdditionOrUpdate'),{code:'unavailable'});
});
