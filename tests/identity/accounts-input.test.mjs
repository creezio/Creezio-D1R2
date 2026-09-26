import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountService} from '../../core/identity/accounts.ts';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {hashPassword, verifyPassword} from '../../core/identity/password.ts';
import {issueOpaqueToken} from '../../core/identity/tokens.ts';

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

test('login uses the password and audience validated before asynchronous admission',async()=>{
  const password='Synthetic password before await';
  const input={loginIdentifier:'alice',password,audience:'admin'};
  const snapshot={principalId:'alice',loginIdentifier:'alice',authVersion:1,accountVersion:1,
    credentialVersion:1,passwordRecord:hashPassword(password)};
  let issuedAudience, mutations=0;
  const result=(rows=[],changes=0)=>({success:true,results:rows,meta:{changes}});
  const db={prepare(sql){return{bind(...values){return{sql,values,async first(){
    if(sql.includes('AS passwordRecord'))return snapshot;
    return {id:'session-1',principalId:'alice',audience:issuedAudience,authVersion:1,
      displayName:'Alice',createdAtMs:0,expiresAtMs:Date.now()+60000};
  }};}};},async batch(statements){
    if(statements.some(s=>s.sql.includes(`INSERT INTO "${ACCESS_TABLES.sessions}"`))){
      issuedAudience=statements[0].values[2];return [result([],1),result([],1)];
    }
    input.password='changed password must not be used'; input.audience='app';mutations++;
    return [result(),result([{attempts:1,retryAtMs:Date.now()+60000}])];
  }};
  const outcome=await createAccountService(db).login(input);
  assert.equal(outcome.ok,true);assert.equal(outcome.session.audience,'admin');assert.equal(mutations,2);
});

test('bootstrap captures the validated password before checking capability availability',async()=>{
  const password='Synthetic bootstrap before await', issued=await issueOpaqueToken('bootstrap');
  const input={token:issued.token,loginIdentifier:'alice',displayName:'Alice',password};
  let storedRecord;
  const db={prepare(sql){return{bind(...values){return{sql,values,async first(){
    input.password='changed after capability read';return{available:1};
  }};}};},async batch(statements){
    const credential=statements.find(s=>s.sql.includes(`INSERT INTO "${ACCESS_TABLES.password_credentials}"`));
    if(credential){storedRecord=credential.values[1];return statements.map((_,i)=>({success:true,results:[],meta:{changes:i===0?1:0}}));}
    return [{success:true,results:[],meta:{changes:0}},
      {success:true,results:[{attempts:1,retryAtMs:Date.now()+60000}],meta:{changes:1}}];
  }};
  assert.equal((await createAccountService(db).bootstrap(input)).ok,true);
  assert.equal(verifyPassword(password,storedRecord),true);
  assert.equal(verifyPassword(input.password,storedRecord),false);
});
