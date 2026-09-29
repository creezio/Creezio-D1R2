import test from 'node:test';
import assert from 'node:assert/strict';
import {admitFileRequest} from '../../core/files/admission.ts';

test('native and MCP linked reads share category and credential admission keys',async()=>{
  const calls=[],counts=new Map();
  const store={async consumeThrottle({key,limit,windowMs}){
    calls.push({key,limit,windowMs});
    const count=(counts.get(key)??0)+1;counts.set(key,count);
    return {allowed:count<=limit};
  }};
  for(let i=0;i<30;i++)assert.equal(await admitFileRequest(store,'creezio.catalog','images','app','same-token'),true);
  assert.equal(await admitFileRequest(store,'creezio.catalog','images','app','same-token'),false);
  assert.equal(calls[0].key,calls[2].key,'native and MCP use the same global key');
  assert.equal(calls[1].key,calls[3].key,'native and MCP use the same credential key');
  assert.equal(calls[0].limit,120);assert.equal(calls[1].limit,30);
  assert.equal(calls[0].windowMs,60000);assert.equal(calls[1].windowMs,60000);
  assert.equal(calls.some(item=>item.key.includes('same-token')),false,'raw bearer is absent from throttle keys');
  assert.equal(await admitFileRequest(store,'creezio.catalog','images','admin','same-token'),true,
    'audiences have distinct admission budgets');
});
