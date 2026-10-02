import test from 'node:test';
import assert from 'node:assert/strict';
import {manifest,read} from '../helpers.mjs';
import {checkoutResult,offerPage} from '../../ui/widgets/commerce.ts';

test('billing status widget is a read-only view with one explicit refresh action',()=>{
  const widget=manifest.contracts.widgets[0];
  assert.equal(widget.id,'sync-status');
  assert.deepEqual(widget.audiences,['admin']);
  assert.deepEqual(widget.actions.map(row=>row.target.operation.id),['sync.state']);
  assert.equal(manifest.contracts.mcp.tools.find(row=>row.id==='sync.state').widget.id,'sync-status');
  assert.equal(manifest.contracts.schemas.find(row=>row.id==='sync-states-output').schema.properties.states.maxItems,6);
  const source=read('ui/widgets/sync-status.ts');
  assert.match(source,/stripe_sync_state/u);
  assert.doesNotMatch(source,/stripe_sync_page|stripe_sync_start|fetch\(/u);
  assert.match(source,/pages partielles|Lecture partielle/u);
  assert.match(source,/prices_inactive/u);
});
test('app widgets declare bounded reads and an explicit purchase action under app permissions',()=>{
  const widgets=new Map(manifest.contracts.widgets.map(row=>[row.id,row]));
  const offers=widgets.get('offers'),status=widgets.get('checkout-status');
  assert.deepEqual(offers.audiences,['app']);assert.deepEqual(status.audiences,['app']);
  assert.deepEqual(offers.actions.map(row=>row.target.operation.id),
    ['app.offer.list','app.checkout.create','app.checkout.read']);
  assert.deepEqual(status.actions.map(row=>row.target.operation.id),['app.checkout.read']);
  assert.equal(manifest.contracts.mcp.tools.find(row=>row.id==='app.offer.list').widget.id,'offers');
  assert.equal(manifest.contracts.mcp.tools.find(row=>row.id==='app.checkout.create').widget.id,'checkout-status');
  const source=read('ui/widgets/commerce.ts');
  assert.match(source,/selectedOffer=item;render\(\)/u);
  assert.match(source,/Confirmer l’achat test/u);
  assert.doesNotMatch(source,/window\.confirm|target='_blank'|fetch\(/u);
  assert.match(source,/app\.openLink\(\{url:href\}\)/u);
  assert.match(source,/sessionStorage\.setItem\(pendingKey,value\)/u);
  assert.match(source,/uncertain=true;say\('Résultat incertain/u);
});
test('widget results accept exact TEST offer/session envelopes and reject forged payment hints',()=>{
  const row={id:'offer_a',productId:'prod_a',priceId:'price_a',name:'Exemple',mode:'subscription',
    enabled:true,unitAmountMinor:1299,currency:'EUR',interval:'month',intervalCount:1,revision:2};
  const page={items:[row],nextCursor:null};
  assert.deepEqual(offerPage({kind:'creezio.widget.render.v1',input:page}),page);
  assert.equal(offerPage({...page,items:[{...row,enabled:false}]}),null);
  assert.equal(offerPage({...page,items:[{...row,unitAmountMinor:0}]}),null);
  assert.equal(offerPage({...page,items:[{...row,currency:'EURO'}]}),null);
  const checkout={offerId:'offer_a',productId:'prod_a',subscriptionId:null,
    session:{id:'cs_test_abc123',url:'https://checkout.stripe.com/c/pay/cs_test_abc123',
      mode:'subscription',status:'open',paymentStatus:'unpaid',livemode:false}};
  assert.deepEqual(checkoutResult({kind:'creezio.widget.action.v1',state:'succeeded',output:checkout}),checkout);
  assert.equal(checkoutResult({...checkout,session:{...checkout.session,livemode:true}}),null);
  assert.equal(checkoutResult({...checkout,session:{...checkout.session,id:'cs_live_bad'}}),null);
  assert.equal(checkoutResult({kind:'creezio.widget.action.v1',state:'unknown',output:checkout}),null);
});
