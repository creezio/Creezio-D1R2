import test from 'node:test';
import assert from 'node:assert/strict';
import {read} from '../helpers.mjs';

test('documentation separates delivered diagnostics from uncollected telemetry',()=>{
  const todo=read('TODO.md'),readme=read('README.md');
  for(const text of ['requêtes API/MCP','registre des routes HTTP compilées','Hooks de navigation',
    'Heartbeats','rétention'])assert.ok(todo.toLocaleLowerCase().includes(text.toLocaleLowerCase()),text);
  assert.match(readme,/exclusivement de `event\.record`/u);
  assert.match(readme,/`diagnostics\.executions`/u);
  assert.match(readme,/absence d’événements n’atteste pas l’absence d’activité/u);
});
