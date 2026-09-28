import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommandJournal,readPendingCommand} from '../../sdk/operations/command-journal.ts';

const scope={sessionId:'session-1',audience:'app',contextId:'application'};
const command={...scope,bindingId:'creezio.support:app.ticket.create',requestKey:'request-1',
  intent:'create',targetId:'ticket-1'};
const persisted=[];
const save=value=>{persisted.push(value);return true;};
const succeeded={kind:'execution',execution:{state:'succeeded',output:{item:{id:'ticket-1'}}}};
const failed={kind:'execution',execution:{state:'failed',output:null,errorCode:'conflict'}};

test('uncertain commands retain metadata through reload and status never resends business input',async()=>{
  persisted.length=0;
  let sends=0,reads=0;
  const client={audience:'app',invoke:async request=>{sends++;
    assert.equal(request.input.requestKey,'request-1');
    assert.equal(request.input.body,'Private support text');
    return {kind:'unknown',code:'outcome_unknown'};},
  status:async request=>{reads++;assert.equal(request.requestKey,'request-1');
    return reads===1?{kind:'unknown',code:'execution_not_observed'}:
      reads===2?{kind:'rejected',code:'forbidden',status:403}:succeeded;}};
  const journal=createCommandJournal(scope);
  const first=await journal.execute(client,command,{body:'Private support text'},()=>true,save);
  assert.equal(first.result.kind,'unknown');
  assert.deepEqual(persisted[0],command);
  assert.equal(JSON.stringify(persisted).includes('Private support text'),false);
  const restored=createCommandJournal(scope,JSON.parse(JSON.stringify(journal.pending)));
  const blocked=await restored.execute(client,{...command,requestKey:'request-2'},{body:'Duplicate'},()=>true,save);
  assert.equal(blocked.result.code,'in_progress');assert.equal(sends,1);
  assert.equal((await restored.inspect(client,()=>true,save)).result.code,'execution_not_observed');
  assert.equal((await restored.inspect(client,()=>true,save)).result.code,'forbidden');
  assert.equal(restored.pending.requestKey,'request-1');
  const verified=await restored.inspect(client,()=>true,save);
  assert.equal(verified.result.execution.state,'succeeded');
  assert.equal(verified.pending,null);assert.equal(restored.pending,null);
  assert.equal(sends,1);assert.equal(reads,3);
  assert.equal(persisted.at(-1),null);
});

test('failed or throwing browser checkpoint blocks transmission before invoke',async()=>{
  let sends=0;
  const client={audience:'app',invoke:async()=>{sends++;return succeeded;}};
  for(const persist of [()=>false,()=>{throw new Error('quota');},async()=>true]){
    const journal=createCommandJournal(scope);
    const outcome=await journal.execute(client,command,{name:'Ticket'},()=>true,persist);
    assert.equal(outcome.result.code,'client_state_unavailable');
    assert.equal(outcome.pending,null);
  }
  assert.equal(sends,0);
});

test('a confirmed server result remains intact if clearing persistence fails',async()=>{
  let attempts=0;
  const saveSometimes=value=>{attempts++;if(value===null&&attempts===2)throw new Error('quota');return true;};
  const journal=createCommandJournal(scope);
  const client={audience:'app',invoke:async()=>succeeded,status:async()=>succeeded};
  const result=await journal.execute(client,command,{name:'Ticket'},()=>true,saveSometimes);
  assert.equal(result.result.execution.state,'succeeded');
  assert.equal(result.pending.requestKey,'request-1','failed release keeps the known key');
  const verified=await journal.inspect(client,()=>true,saveSometimes);
  assert.equal(verified.result.execution.state,'succeeded');
  assert.equal(verified.pending,null);
  const failure=createCommandJournal(scope);
  const failedResult=await failure.execute({...client,invoke:async()=>failed},command,{},()=>true,save);
  assert.equal(failedResult.result.execution.state,'failed');
  assert.equal(failedResult.pending,null);
});

test('wrong audience cannot send or inspect a pending command',async()=>{
  let sends=0,reads=0;
  const other={audience:'admin',invoke:async()=>{sends++;return succeeded;},
    status:async()=>{reads++;return succeeded;}};
  const journal=createCommandJournal(scope);
  assert.equal((await journal.execute(other,command,{},()=>true,save)).result.code,'audience_mismatch');
  const restored=createCommandJournal(scope,command);
  assert.equal((await restored.inspect(other,()=>true,save)).result.code,'audience_mismatch');
  assert.equal(restored.pending.requestKey,'request-1');
  assert.equal(sends,0);assert.equal(reads,0);
});

test('an inactive projection cannot send, inspect or adopt an old result',async()=>{
  let sends=0,reads=0,active=false;
  const client={audience:'app',invoke:async()=>{sends++;active=false;return succeeded;},
    status:async()=>{reads++;return succeeded;}};
  const journal=createCommandJournal(scope);
  assert.equal((await journal.execute(client,command,{},()=>active,save)).result.code,'stale');
  assert.equal(sends,0);
  active=true;
  const result=await journal.execute(client,command,{},()=>active,save);
  assert.equal(result.result.code,'stale','a response from an inactive projection is not adopted');
  assert.equal(result.pending.requestKey,'request-1');
  assert.equal(sends,1);
  assert.equal((await journal.inspect(client,()=>active,save)).result.code,'stale');
  assert.equal(reads,0);
  active=true;
  assert.equal((await journal.inspect(client,()=>active,save)).result.execution.state,'succeeded');
  assert.equal(journal.pending,null);
});

test('restoration rejects foreign scope, extra fields and unbounded metadata',()=>{
  assert.equal(readPendingCommand(command,{...scope,sessionId:'session-2'}),null);
  assert.equal(readPendingCommand(command,{...scope,contextId:'another'}),null);
  assert.equal(readPendingCommand(command,{...scope,audience:'admin'}),null);
  assert.equal(readPendingCommand({...command,body:'must not persist'},scope),null);
  assert.equal(readPendingCommand({...command,intent:'x'.repeat(65)},scope),null);
  assert.equal(readPendingCommand({...command,targetId:'x'.repeat(129)},scope),null);
  assert.equal(readPendingCommand({...command,requestKey:'é'.repeat(257)},scope),null,
    'request keys use the SDK byte limit, not just JS character count');
  assert.deepEqual(readPendingCommand(command,scope),command);
  assert.deepEqual(readPendingCommand(command,{...scope,secret:'must not persist'}),command);
});
