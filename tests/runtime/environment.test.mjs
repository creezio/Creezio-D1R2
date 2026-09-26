import test from 'node:test';
import assert from 'node:assert/strict';
import { isRuntimeProfile, RUNTIME_PROFILES, COMPOSITION_PROFILE_BY_RUNTIME } from '../../adapters/runtime-profiles.ts';
import { resolveBindings } from '../../adapters/storage/bindings.ts';
import { resolveRuntimeEnvironment } from '../../core/runtime/environment.ts';

const unused = () => { throw new Error('Structural checks must not execute storage operations.'); };
function bindings() { return { DB:{prepare:unused,batch:unused}, BUCKET:{get:unused,head:unused,put:unused,delete:unused} }; }

test('local, Sites and Cloudflare use the same explicit binding contract without probing storage',()=>{
  assert.deepEqual(RUNTIME_PROFILES,['local','sites','cloudflare']);
  assert.deepEqual(COMPOSITION_PROFILE_BY_RUNTIME,{local:'docker-local',sites:'sites',cloudflare:'cloudflare'});
  for(const profile of RUNTIME_PROFILES){
    const source={...bindings(),CREEZIO_RUNTIME_PROFILE:profile,PROVIDER_SECRET:'private-value'};
    const resolved=resolveRuntimeEnvironment(source);
    assert.equal(resolved.profile,profile);
    assert.equal(resolved.bindings.DB,source.DB);
    assert.equal(resolved.bindings.BUCKET,source.BUCKET);
    assert.deepEqual(Object.keys(resolved).sort(),['bindings','profile']);
    assert.deepEqual(Object.keys(resolved.bindings).sort(),['BUCKET','DB']);
    assert.ok(Object.isFrozen(resolved));assert.ok(Object.isFrozen(resolved.bindings));
    assert.equal(resolved.PROVIDER_SECRET,undefined);
  }
});

test('profile is mandatory and is never inferred from case, environment resemblance or host identity',()=>{
  for(const value of [undefined,null,'','production','Sites','cloudflare ',1,{},[]]){
    assert.equal(isRuntimeProfile(value),false);
    assert.equal(resolveRuntimeEnvironment({...bindings(),CREEZIO_RUNTIME_PROFILE:value,'oai-authenticated-user-id':'owner'}),null);
  }
});

test('missing or partial database and bucket bindings are rejected rather than replaced by mocks',()=>{
  for(const value of [null,undefined,{},[],{DB:{},BUCKET:{}},{DB:{prepare:unused},BUCKET:bindings().BUCKET},{DB:bindings().DB,BUCKET:{get:unused}}])assert.equal(resolveBindings(value),null);
  for(const [binding,method] of [['DB','prepare'],['DB','batch'],['BUCKET','get'],['BUCKET','head'],['BUCKET','put'],['BUCKET','delete']]){
    const source={...bindings(),CREEZIO_RUNTIME_PROFILE:'local'};source[binding][method]='not-callable';
    assert.equal(resolveRuntimeEnvironment(source),null);
  }
});

test('native binding methods may live on prototypes while throwing host properties fail closed',()=>{
  const source={DB:Object.create(bindings().DB),BUCKET:Object.create(bindings().BUCKET),CREEZIO_RUNTIME_PROFILE:'sites'};
  assert.ok(resolveRuntimeEnvironment(source));
  const dangerous={CREEZIO_RUNTIME_PROFILE:'local',get DB(){throw new Error('never disclose this credential');}};
  assert.equal(resolveBindings(dangerous),null);assert.equal(resolveRuntimeEnvironment(dangerous),null);
});
