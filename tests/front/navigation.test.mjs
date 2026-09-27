import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldNavigateFromPanel} from '../../sdk/front/navigation.ts';

test('login from a public link keeps the requested protected URL instead of replaying the initial public pane',()=>{
  assert.equal(shouldNavigateFromPanel('/witness/alpha',null,'/welcome',true),false);
  assert.equal(shouldNavigateFromPanel('/witness/alpha','/welcome','/welcome',true),false);
  assert.equal(shouldNavigateFromPanel('/witness/alpha','/welcome','/witness/alpha',true),false);
});

test('an active protected pane can navigate to another declared record',()=>{
  assert.equal(shouldNavigateFromPanel('/witness','/witness','/witness/alpha',true),true);
  assert.equal(shouldNavigateFromPanel('/witness','/witness','/witness/alpha',false),false);
});

test('browser history and projection refresh do not replace the requested URL',()=>{
  assert.equal(shouldNavigateFromPanel('/','/witness','/witness',true),false);
  assert.equal(shouldNavigateFromPanel('/witness/alpha','/witness','/witness',true),false);
  assert.equal(shouldNavigateFromPanel('/witness','/witness','/witness',true),false);
});
