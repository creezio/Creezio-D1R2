import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountService} from '../../core/identity/accounts.ts';

test('native account boundaries reject malformed shapes before database admission',async()=>{
  let calls=0;
  const service=createAccountService({prepare(){calls++;throw new Error('Database must not be called');},batch(){calls++;throw new Error('Database must not be called');}});
  const accessor=Object.defineProperty({},'password',{get(){throw new Error('Getter must not run');}});
  for(const value of [null,undefined,[],false,12,'text',{},accessor,new Date()]){
    assert.deepEqual(await service.login(value),{ok:false,code:'invalid_input'});
    assert.deepEqual(await service.bootstrap(value),{ok:false,code:'invalid_input'});
  }
  assert.deepEqual(await service.login({loginIdentifier:'alice',password:'a sufficiently long phrase',audience:'app',role:'admin'}),{ok:false,code:'invalid_input'});
  assert.equal(calls,0);
});
