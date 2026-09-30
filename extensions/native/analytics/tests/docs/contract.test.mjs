import test from 'node:test';
import assert from 'node:assert/strict';
import {read} from '../helpers.mjs';

test('documentation distinguishes optional collection, installation refusals and deferred presence',()=>{
  const todo=read('TODO.md'),readme=read('README.md');
  for(const text of ['HTTP/MCP','hooks workspace/front','présence','rétention'])
    assert.ok(todo.toLocaleLowerCase().includes(text.toLocaleLowerCase()),text);
  assert.match(readme,/exclusivement de `event\.record`/u);
  assert.match(readme,/`diagnostics\.executions`/u);
  assert.match(readme,/désactivée par défaut/u);
  assert.match(readme,/ni contexte métier ni principal/u);
  assert.match(readme,/absence d’événements n’atteste pas l’absence d’activité/u);
});
