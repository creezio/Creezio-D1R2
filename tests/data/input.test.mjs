import test from 'node:test';
import assert from 'node:assert/strict';
import {copyJson} from '../../core/data/input.ts';

const invalidInput={code:'invalid_input'};

test('ordinary JSON capture retains its 100000-node default',()=>{
  const value={left:Array(50_001).fill(0),right:Array(50_001).fill(0)};
  assert.throws(()=>copyJson(value,1_000_000),invalidInput);
  assert.throws(()=>copyJson(value,1_000_000,100_000),invalidInput);
  const captured=copyJson(value,1_000_000,300_000);
  assert.equal(captured.left.length,50_001);
  assert.equal(captured.right.length,50_001);
  assert.ok(Object.isFrozen(captured.left));
});

test('static JSON node override is bounded and keeps structural guards',()=>{
  const tooMany={parts:Array.from({length:4},()=>Array(75_000).fill(0))};
  assert.throws(()=>copyJson(tooMany,1_000_000,300_000),invalidInput);
  for(const maximumNodes of [0,-1,1.5,NaN,Infinity,300_001])
    assert.throws(()=>copyJson({ok:true},1_000_000,maximumNodes),invalidInput);
  let called=0;
  assert.throws(()=>copyJson({get value(){called++;return 1;}},1_000_000,300_000),invalidInput);
  const altered={value:1};Object.setPrototypeOf(altered,{inherited:true});
  assert.throws(()=>copyJson(altered,1_000_000,300_000),invalidInput);
  assert.equal(called,0);
});
