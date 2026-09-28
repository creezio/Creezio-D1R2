import test from 'node:test';
import assert from 'node:assert/strict';
import {read} from '../helpers.mjs';

test('documentation names all missing host ports without claiming complete instrumentation',()=>{
  const todo=read('TODO.md'),readme=read('README.md');
  for(const text of ['requêtes API/MCP','Registre d’endpoints','Hooks de navigation',
    'Heartbeats','rétention'])assert.ok(todo.toLocaleLowerCase().includes(text.toLocaleLowerCase()),text);
  assert.match(readme,/exclusivement de `event\.record`/u);
  assert.match(readme,/absence d’événements n’atteste pas l’absence d’activité/u);
});
