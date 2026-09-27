import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalRuntimeSupervisor} from '../../scripts/local/runtime-supervisor.mjs';

test('local supervisor waits for actual runtime closure before allowing another launch',async()=>{
  let starts=0,finish,seenStop;
  const stopped=new Promise(resolve=>{seenStop=resolve;});
  const supervisor=createLocalRuntimeSupervisor({}, {run:async(_command,_config,{signal})=>{
    starts++;signal.addEventListener('abort',seenStop,{once:true});
    return new Promise(resolve=>{finish=resolve;});
  }});
  supervisor.start();supervisor.start();await Promise.resolve();assert.equal(starts,1);
  let closed=false;const stopping=supervisor.stop().then(()=>{closed=true;});await stopped;
  supervisor.start();assert.equal(starts,1);assert.equal(closed,false);
  finish(0);await stopping;assert.equal(supervisor.running,false);
  supervisor.start();await Promise.resolve();assert.equal(starts,2);
  const closing=supervisor.close();finish(0);await closing;
  assert.throws(()=>supervisor.start(),/closing/);
});

test('startup failure reaches the service supervisor and does not claim a running application',async()=>{
  let notice;const failed=new Promise(resolve=>{notice=resolve;});
  const supervisor=createLocalRuntimeSupervisor({}, {run:async()=>{throw new Error('locked');},onFailure:notice});
  supervisor.start();assert.equal((await failed).message,'locked');
  await assert.rejects(()=>supervisor.close(),/locked/);assert.equal(supervisor.running,false);
});
