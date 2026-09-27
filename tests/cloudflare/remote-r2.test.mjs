import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {createRemoteR2Client, RemoteR2Error} from '../../scripts/cloudflare/remote/r2.mjs';

const accountId = 'a'.repeat(32);
const bucketName = 'creezio-transfer';
const origin = `https://${accountId}.r2.cloudflarestorage.com`;
const signer = {sign: async (url, init) => new Request(url, init)};
const make = fetcher => createRemoteR2Client({accountId, bucketName,
  accessKeyId: 'r2-token-id', secretAccessKey: 'r2-secret-at-least-20-characters', signer, fetcher});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const xml = body => new Response(body, {headers: {'content-type': 'application/xml'}});
const entry = (key, data, httpMetadata = {}, customMetadata = {}) =>
  ({key, size: data.byteLength, sha256: hash(data), httpMetadata, customMetadata});

test('R2 production signer uses aws4fetch SigV4 on the pinned account origin', async () => {
  const client = await createRemoteR2Client({accountId, bucketName,
    accessKeyId: 'r2-token-id', secretAccessKey: 'r2-secret-at-least-20-characters',
    fetcher: async (request, init) => {
      assert.equal(new URL(request.url).origin, origin);
      assert.match(request.headers.get('authorization') ?? '', /^AWS4-HMAC-SHA256 /);
      assert.equal(init.redirect, 'error');
      return xml('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>');
    }});
  assert.deepEqual(await client.listPage(), {objects: [], nextContinuationToken: null});
});

test('R2 SigV4 signs conditional PUT bytes without changing the payload', async () => {
  const data = Buffer.from('signed payload');
  const expected = entry('creezio/files/v1/signed', data);
  let stored = null;
  const client = await createRemoteR2Client({accountId, bucketName,
    accessKeyId: 'r2-token-id', secretAccessKey: 'r2-secret-at-least-20-characters',
    fetcher: async request => {
      assert.match(request.headers.get('authorization') ?? '', /^AWS4-HMAC-SHA256 /);
      if (request.method === 'HEAD') return stored === null
        ? new Response(null, {status: 404})
        : new Response(null, {headers: {'content-length': String(stored.length),
          etag: '"0123456789abcdef0123456789abcdef"'}});
      if (request.method === 'PUT') {
        assert.equal(request.headers.get('if-none-match'), '*');
        stored = Buffer.from(await request.arrayBuffer());
        return new Response(null);
      }
      if (request.method === 'GET') return new Response(stored);
      throw new Error('unexpected request');
    }});
  let outcome;
  try { outcome = await client.putObject(expected, data); }
  finally { assert.deepEqual(stored, data); }
  assert.equal(outcome, 'uploaded');
});

test('conditional R2 PUT sends no cache metadata through real Node fetch', async () => {
  const data = Buffer.from('signed payload'), expected = entry('creezio/files/v1/no-cache-leak', data,
    {contentType: 'application/octet-stream'});
  let stored = null, putHeaders = null;
  const server = createServer((request, response) => {
    if (request.method === 'HEAD') {
      if (!stored) {response.writeHead(404); response.end(); return;}
      response.writeHead(200, {'content-length': String(stored.length),
        'content-type': 'application/octet-stream', etag: '"0123456789abcdef0123456789abcdef"'});
      response.end(); return;
    }
    if (request.method === 'GET') {
      response.writeHead(200, {'content-type': 'application/octet-stream'});
      response.end(stored); return;
    }
    if (request.method !== 'PUT') {response.writeHead(405); response.end(); return;}
    putHeaders = request.headers;
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {stored = Buffer.concat(chunks); response.writeHead(200); response.end();});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const loopback = `http://127.0.0.1:${server.address().port}/object`;
    const client = await createRemoteR2Client({accountId, bucketName,
      accessKeyId: 'fake-access', secretAccessKey: 'fake-secret-at-least-20-characters',
      fetcher: async (request, init) => {
        const outbound = new Request(loopback, {method: request.method, headers: request.headers,
          body: request.method === 'PUT' ? Buffer.from(await request.arrayBuffer()) : undefined});
        return fetch(outbound, init);
      }});
    assert.equal(await client.putObject(expected, data), 'uploaded');
    assert.deepEqual(stored, data);
    assert.equal(putHeaders['if-none-match'], '*');
    assert.equal(putHeaders['cache-control'], undefined);
    assert.equal(putHeaders.pragma, undefined);
    assert.equal(await client.inspectObject(expected), 'matching');
  } finally {await new Promise(resolve => server.close(resolve));}
});

test('R2 lists a bounded URL-encoded page without forwarding credentials or following redirects', async () => {
  const calls = [];
  const client = await make(async (request, init) => {
    calls.push({request, init});
    return xml('<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>next+token</NextContinuationToken><Contents><Key>creezio%2Ffiles%2Fv1%2Fa%20b</Key><Size>3</Size></Contents></ListBucketResult>');
  });
  const page = await client.listPage({maxKeys: 1});
  assert.deepEqual(page, {objects: [{key: 'creezio/files/v1/a b', size: 3}], nextContinuationToken: 'next+token'});
  assert.equal(new URL(calls[0].request.url).origin, origin);
  assert.equal(new URL(calls[0].request.url).searchParams.get('list-type'), '2');
  assert.equal(calls[0].init.redirect, 'error');
});

test('R2 checks full bytes and metadata; ETag is never treated as SHA-256', async () => {
  const data = Buffer.from('file content');
  const expected = entry('creezio/files/v1/object', data, {contentType: 'text/plain'}, {Origin: 'local'});
  const client = await make(async request => {
    if (request.method === 'HEAD') return new Response(null, {headers: {
      'content-length': String(data.length), 'content-type': 'text/plain',
      'x-amz-meta-origin': 'local', etag: '"00000000000000000000000000000000"'
    }});
    if (request.method === 'GET') {
      assert.equal(request.headers.get('if-match'), '"00000000000000000000000000000000"');
      return new Response(data, {headers: {'content-type': 'text/plain', 'x-amz-meta-origin': 'local'}});
    }
    throw new Error('unexpected mutation');
  });
  assert.equal(await client.inspectObject(expected), 'matching');
  assert.equal(await client.inspectObject({...expected, sha256: '0'.repeat(64)}), 'conflict');
  assert.equal(await client.inspectObject({...expected, customMetadata: {Origin: 'foreign'}}), 'conflict');
});

test('R2 PUT is conditional and verifies the object after upload', async () => {
  const data = Buffer.from('new bytes');
  const expected = entry('creezio/files/v1/new', data, {contentType: 'text/plain'});
  let stored = null, writes = 0;
  const client = await make(async request => {
    if (request.method === 'HEAD') return stored === null ? new Response(null, {status: 404}) :
      new Response(null, {headers: {'content-length': String(stored.length), 'content-type': 'text/plain',
        etag: '"0123456789abcdef0123456789abcdef"'}});
    if (request.method === 'GET') return new Response(stored, {headers: {'content-type': 'text/plain'}});
    if (request.method === 'PUT') {
      writes++;
      assert.equal(request.headers.get('if-none-match'), '*');
      stored = Buffer.from(await request.arrayBuffer());
      return new Response(null, {status: 200});
    }
    throw new Error('unexpected request');
  });
  assert.equal(await client.putObject(expected, data), 'uploaded');
  assert.equal(await client.putObject(expected, data), 'matching');
  assert.equal(writes, 1);
});

test('R2 lost PUT response is not retried, and an occupied multipart part is not replaced', async () => {
  const data = Buffer.from('small part');
  const expected = entry('creezio/files/v1/part', data);
  let writes = 0;
  const client = await make(async request => {
    if (request.method === 'HEAD') return new Response(null, {status: 404});
    if (request.method === 'PUT' && !new URL(request.url).searchParams.has('uploadId')) {
      writes++; throw new Error('response lost after upload');
    }
    if (request.method === 'GET') return xml('<ListPartsResult><IsTruncated>false</IsTruncated><Part><PartNumber>1</PartNumber><Size>10</Size><ETag>"0123456789abcdef0123456789abcdef"</ETag></Part></ListPartsResult>');
    throw new Error('unexpected request');
  });
  await assert.rejects(client.putObject(expected, data),
    error => error instanceof RemoteR2Error && error.code === 'unavailable');
  assert.equal(writes, 1);
  await assert.rejects(client.uploadPart(expected.key, 'upload-123', 1, data, hash(data)),
    error => error instanceof RemoteR2Error && error.code === 'conflict');
});

test('R2 multipart completes only journaled parts and verifies final SHA-256', async () => {
  const data = Buffer.from('part bytes');
  const expected = entry('creezio/files/v1/multipart', data);
  const etag = '"0123456789abcdef0123456789abcdef"';
  let part = null, stored = null, completions = 0;
  const client = await make(async request => {
    const url = new URL(request.url);
    if (request.method === 'HEAD') return stored === null
      ? new Response(null, {status: 404})
      : new Response(null, {headers: {'content-length': String(stored.length), etag}});
    if (request.method === 'GET' && !url.searchParams.has('uploadId')) return new Response(stored);
    if (request.method === 'POST' && url.searchParams.has('uploads'))
      return xml('<InitiateMultipartUploadResult><UploadId>upload-123</UploadId></InitiateMultipartUploadResult>');
    if (request.method === 'GET' && url.searchParams.has('uploadId'))
      return xml('<ListPartsResult><IsTruncated>false</IsTruncated>' +
        (part ? `<Part><PartNumber>1</PartNumber><Size>${part.length}</Size><ETag>${etag}</ETag></Part>` : '') +
        '</ListPartsResult>');
    if (request.method === 'PUT' && url.searchParams.has('uploadId')) {
      part = Buffer.from(await request.arrayBuffer());
      return new Response(null, {headers: {etag}});
    }
    if (request.method === 'POST' && url.searchParams.has('uploadId')) {
      completions++;
      assert.equal(request.headers.get('if-none-match'), '*');
      assert.match(await request.text(), /<PartNumber>1<\/PartNumber>/);
      stored = part;
      return xml('<CompleteMultipartUploadResult><Key>creezio/files/v1/multipart</Key></CompleteMultipartUploadResult>');
    }
    throw new Error('unexpected request');
  });
  const {uploadId} = await client.createMultipart(expected);
  const receipt = await client.uploadPart(expected.key, uploadId, 1, data, hash(data));
  assert.deepEqual(receipt, {number: 1, size: data.length, sha256: hash(data), etag});
  assert.equal(await client.completeMultipart(expected, uploadId, [receipt]), 'uploaded');
  assert.equal(completions, 1);
});
