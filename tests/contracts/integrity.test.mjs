import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {canonicalJson,contractIntegrity} from '../../sdk/contracts/semantics.mjs';

test('portable contract SHA-256 matches Node for canonical UTF-8 objects and Unicode',()=>{
  const values=[null,true,0,'é😀',
    {z:[1,'été',{β:'雪',a:true}],a:'😀'},
    {nested:{'é':'café',plain:'中文'},list:['🚀','e\u0301']}];
  assert.equal(canonicalJson(values[4]),'{"a":"😀","z":[1,"été",{"a":true,"β":"雪"}]}');
  for (const value of values) {
    const expected=`sha256-${createHash('sha256').update(canonicalJson(value),'utf8').digest('hex')}`;
    assert.equal(contractIntegrity(value),expected);
  }
});
