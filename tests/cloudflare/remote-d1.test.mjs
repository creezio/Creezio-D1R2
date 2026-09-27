import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteD1Client, RemoteD1Error} from '../../scripts/cloudflare/remote/d1.mjs';

const accountId = 'a'.repeat(32);
const databaseId = '11111111-2222-3333-4444-555555555555';
const token = 'token-operator-only-123456789';
const make = fetcher => createRemoteD1Client({accountId, databaseId, token, fetcher});
const reply = (result, status = 200) => new Response(JSON.stringify(result), {
  status, headers: {'content-type': 'application/json'}
});

test('D1 batch uses only the pinned Cloudflare endpoint and bounded query envelope', async () => {
  const calls = [];
  const client = make(async (url, init) => {
    calls.push({url, init});
    return reply({success: true, result: [
      {success: true, results: [{id: 'p1'}]}, {success: true, results: []}
    ]});
  });
  const result = await client.batch([
    {sql: 'SELECT id FROM principals WHERE id = ?', params: ['p1']},
    {sql: 'INSERT INTO principals(id) VALUES (?)', params: ['p2']}
  ]);
  assert.equal(result[0].results[0].id, 'p1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), {batch: [
    {sql: 'SELECT id FROM principals WHERE id = ?', params: ['p1']},
    {sql: 'INSERT INTO principals(id) VALUES (?)', params: ['p2']}
  ]});
});

test('D1 refuses invalid parameters and overlong SQL before any network call', async () => {
  let calls = 0;
  const client = make(async () => { calls++; throw new Error('should not fetch'); });
  for (const input of [
    {sql: 'SELECT ?', params: [Infinity]},
    {sql: 'SELECT ?', params: [true]},
    {sql: 'x'.repeat(100_001), params: []},
    {sql: 'SELECT 1', params: Array(101).fill('x')}
  ]) await assert.rejects(client.query(input), error => error instanceof RemoteD1Error && error.code === 'invalid_query');
  assert.equal(calls, 0);
});

test('D1 lost response is unknown and never retried; caller must inspect', async () => {
  let calls = 0;
  const client = make(async () => { calls++; throw new Error('socket lost after commit'); });
  await assert.rejects(client.query({sql: 'INSERT INTO t(id) VALUES (?)', params: ['x']}),
    error => error instanceof RemoteD1Error && error.code === 'unavailable' && !error.message.includes('socket'));
  assert.equal(calls, 1);
});

test('D1 rejects incomplete batch and verifies database UUID', async () => {
  const client = make(async (url) => url.endsWith('/query')
    ? reply({success: true, result: [{success: true, results: []}]})
    : reply({success: true, result: {uuid: '22222222-2222-2222-2222-222222222222'}}));
  await assert.rejects(client.batch([
    {sql: 'SELECT 1', params: []}, {sql: 'SELECT 2', params: []}
  ]), error => error.code === 'incomplete');
  await assert.rejects(client.metadata(), error => error.code === 'identity_mismatch');
});
