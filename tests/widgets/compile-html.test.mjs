import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {embedWidgetRenderer} from '../../scripts/widgets/compile.mjs';

test('widget HTML embeds bundled JavaScript without interpreting replacement tokens',()=>{
  const html='<!doctype html><html><body>Widget</body></html>';
  const script=`const tokens = ["$&", "$\`", "$'"];`;
  const embedded=embedWidgetRenderer(html,script);
  const matches=[...embedded.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(matches.length,1);
  assert.equal(matches[0][1],script);
  assert.equal(embedded,`<!doctype html><html><body>Widget<script>${script}</script></body></html>`);
  assert.doesNotThrow(()=>new Script(matches[0][1]));
});
