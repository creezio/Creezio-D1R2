import test from 'node:test';
import assert from 'node:assert/strict';
import {createHostOpenLinkGate,normalizeWidgetOpenLink} from '../../sdk/widgets/host-open-link.ts';

test('MCP Apps links accept only bounded canonical HTTPS without credentials or controls',()=>{
  assert.equal(normalizeWidgetOpenLink('https://checkout.stripe.com/c/pay/cs_test_1'),
    'https://checkout.stripe.com/c/pay/cs_test_1');
  assert.equal(normalizeWidgetOpenLink('HTTPS://EXAMPLE.TEST/path'), 'https://example.test/path');
  for(const value of ['http://example.test','javascript:alert(1)','//example.test',
    'https:///example.test','https://user:password@example.test/',
    'https://@example.test/','https://example.test\\@other.test/',
    'https://example.test/\nother','https://example.test/ bad',
    `https://example.test/${'x'.repeat(2048)}`,null,{}])
    assert.equal(normalizeWidgetOpenLink(value),null,String(value));
});

test('host link gate waits for one explicit accept and rejects stale, cancelled or replaced requests',async()=>{
  let current=true,prompt=null,callback=null,cancelled=0;
  const make=()=>createHostOpenLinkGate({isCurrent:()=>current,show:value=>{prompt=value;},
    nextId:()=>`request-${++cancelled}`,schedule:run=>{callback=run;return 1;},
    unschedule:()=>{callback=null;}});
  const first=make();
  const opened=first.request('https://checkout.stripe.com/pay');
  assert.equal(prompt.url,'https://checkout.stripe.com/pay');
  assert.equal(first.accept('other'),false);
  assert.equal(prompt.url,'https://checkout.stripe.com/pay');
  assert.equal(await first.request('https://example.test/'),false);
  current=false;
  assert.equal(first.accept(prompt.id),false);
  assert.equal(await opened,false);
  assert.equal(prompt,null);
  current=true;
  const accepted=first.request('https://example.test/');
  assert.equal(first.accept(prompt.id),true);
  assert.equal(await accepted,true);
  assert.equal(prompt,null);
  const cancelledRequest=first.request('https://example.test/');
  first.cancel(prompt.id);
  assert.equal(await cancelledRequest,false);
  assert.equal(callback,null);
  const timed=first.request('https://example.test/');
  callback();
  assert.equal(await timed,false);
  assert.equal(prompt,null);
  const aborter=new AbortController();
  const aborted=first.request('https://example.test/',aborter.signal);
  aborter.abort();
  assert.equal(await aborted,false);
  assert.equal(prompt,null);
  assert.equal(await first.request('https://example.test/',aborter.signal),false);
  const replaced=first.request('https://example.test/');
  first.dispose();
  assert.equal(await replaced,false);
  assert.equal(await first.request('https://example.test/'),false);
  const second=make();
  const fresh=second.request('https://example.test/');
  assert.equal(second.accept(prompt.id),true);
  assert.equal(await fresh,true);
  second.dispose();
});
