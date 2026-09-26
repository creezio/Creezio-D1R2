import {test} from 'node:test';import assert from 'node:assert/strict';import {read_status,read_protected} from '../../module/operations.ts';
test('public metadata handler returns exact non-sensitive output',async()=>{const response=read_status();assert.equal(response.status,200);assert.deepEqual(await response.json(),{module:'example.witness',version:'1.0.0',status:'ready'});});
test('protected sentinel detects unauthorized invocation',()=>{assert.throws(()=>read_protected(),/must not execute/);});
