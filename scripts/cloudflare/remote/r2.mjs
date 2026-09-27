/** Operator-only R2 S3 transport. Credentials are never sent to a redirected origin. */
import {createHash} from 'node:crypto';

const ACCOUNT = /^[a-f0-9]{32}$/;
const BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const SHA = /^[a-f0-9]{64}$/;
const MAX_XML = 2_000_000;
const MAX_SINGLE = 32 * 1024 * 1024;
const MAX_PART = 32 * 1024 * 1024;
const HTTP_META = new Map([
  ['contentType', 'content-type'], ['contentDisposition', 'content-disposition'],
  ['contentEncoding', 'content-encoding'], ['contentLanguage', 'content-language'],
  ['cacheControl', 'cache-control'], ['cacheExpiry', 'expires']
]);

export class RemoteR2Error extends Error {
  constructor(code, status = null) {
    super(`Remote R2 ${code}.`);
    this.name = 'RemoteR2Error'; this.code = code; this.status = status;
  }
}
const fail = (code, status) => { throw new RemoteR2Error(code, status); };
const oneOrMany = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const digest = value => createHash('sha256').update(value).digest('hex');
const safeValue = value => typeof value === 'string' && value.length <= 1024 && !/[\r\n\0]/.test(value);
const keyOK = key => typeof key === 'string' && key.length > 0 &&
  Buffer.byteLength(key, 'utf8') <= 1024 && !/[\x00-\x1f\x7f?#]/.test(key) &&
  key.split('/').every(part => part && part !== '.' && part !== '..');
const uploadOK = value => typeof value === 'string' && /^[A-Za-z0-9+/_=.-]{1,512}$/.test(value);
const etagOK = value => typeof value === 'string' && /^"?[a-fA-F0-9-]{16,128}"?$/.test(value);

function checkedEntry(entry) {
  if (!entry || !keyOK(entry.key) || !Number.isSafeInteger(entry.size) || entry.size < 0 ||
      !SHA.test(entry.sha256) || !entry.httpMetadata || !entry.customMetadata ||
      Array.isArray(entry.httpMetadata) || Array.isArray(entry.customMetadata)) fail('invalid_object');
  const headers = {};
  for (const [name, value] of Object.entries(entry.httpMetadata)) {
    const header = HTTP_META.get(name);
    if (!header || !safeValue(value)) fail('invalid_object');
    headers[header] = value;
  }
  for (const [name, value] of Object.entries(entry.customMetadata)) {
    if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name) || !safeValue(value) ||
        Object.hasOwn(headers, `x-amz-meta-${name.toLowerCase()}`)) fail('invalid_object');
    headers[`x-amz-meta-${name.toLowerCase()}`] = value;
  }
  return headers;
}

async function boundedText(response, max = MAX_XML) {
  const reader = response.body?.getReader();
  if (!reader) fail('unavailable', response.status);
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max || chunks.length >= 4096) fail('response_too_large', response.status);
      chunks.push(value);
    }
    return new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks, size));
  } catch (error) {
    if (error instanceof RemoteR2Error) throw error;
    fail('unavailable', response.status);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Factory is async only to keep aws4fetch and XML parsing in the operator installation. */
export async function createRemoteR2Client({accountId, bucketName, accessKeyId, secretAccessKey,
  jurisdiction = 'default', fetcher = fetch, signer, xmlParser}) {
  if (!ACCOUNT.test(accountId ?? '') || !BUCKET.test(bucketName ?? '') ||
      !['default', 'eu', 'us'].includes(jurisdiction) ||
      typeof accessKeyId !== 'string' || !accessKeyId || /\s/.test(accessKeyId) ||
      typeof secretAccessKey !== 'string' || secretAccessKey.length < 20 || /\s/.test(secretAccessKey) ||
      typeof fetcher !== 'function') fail('invalid_configuration');
  if (!signer) {
    const {AwsClient} = await import('aws4fetch');
    signer = new AwsClient({accessKeyId, secretAccessKey, service: 's3', region: 'auto'});
  }
  if (!xmlParser) {
    const {XMLParser, XMLValidator} = await import('fast-xml-parser');
    const parser = new XMLParser({ignoreAttributes: false, processEntities: false,
      parseTagValue: false, parseAttributeValue: false});
    xmlParser = value => {
      if (XMLValidator.validate(value) !== true) fail('invalid_xml');
      return parser.parse(value);
    };
  }
  if (typeof signer.sign !== 'function' || typeof xmlParser !== 'function') fail('invalid_configuration');
  const suffix = jurisdiction === 'default' ? '' : `${jurisdiction}.`;
  const origin = `https://${accountId}.${suffix}r2.cloudflarestorage.com`;
  const bucketURL = `${origin}/${bucketName}`;
  const objectURL = key => {
    if (!keyOK(key)) fail('invalid_object');
    return `${bucketURL}/${key.split('/').map(encodeURIComponent).join('/')}`;
  };
  const parse = async (response, root) => {
    const xml = await boundedText(response);
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) fail('invalid_xml');
    let value;
    try { value = xmlParser(xml); } catch (error) {
      if (error instanceof RemoteR2Error) throw error;
      fail('invalid_xml');
    }
    if (!value || typeof value[root] !== 'object') fail('invalid_xml');
    return value[root];
  };
  async function signed(url, {method = 'GET', headers = {}, body, timeoutMs = 30_000} = {}) {
    const target = new URL(url);
    if (target.origin !== origin ||
        target.pathname !== `/${bucketName}` && !target.pathname.startsWith(`/${bucketName}/`))
      fail('invalid_destination');
    const signal = AbortSignal.timeout(timeoutMs);
    let request, response;
    try {
      // aws4fetch's Request overload omits a body without Content-Type. Its URL/init
      // overload keeps the exact bytes, including objects with no HTTP metadata.
      request = await signer.sign(url, {method, headers, body});
      if (new URL(request.url).origin !== origin) fail('invalid_destination');
      // Undici adds Cache-Control/Pragma: no-cache to conditional requests in its
      // default mode. On PUT/POST, R2 stores the injected Cache-Control as object
      // metadata. Node does not cache mutations; force-cache suppresses that header.
      const conditionalMutation = (method === 'PUT' || method === 'POST') &&
        headers['if-none-match'] === '*';
      response = await fetcher(request, {redirect: 'error', signal,
        ...(conditionalMutation ? {cache: 'force-cache'} : {})});
    } catch (error) {
      if (error instanceof RemoteR2Error) throw error;
      fail('unavailable');
    }
    if (!response || response.redirected || response.status >= 300 && response.status < 400) fail('refused', response?.status);
    return response;
  }
  const status = response => {
    if (!response.ok) fail('refused', response.status);
    return response;
  };
  function metadata(response) {
    const httpMetadata = {}, customMetadata = {};
    for (const [name, header] of HTTP_META) {
      const value = response.headers.get(header);
      if (value !== null) httpMetadata[name] = value;
    }
    for (const [name, value] of response.headers) {
      if (name.startsWith('x-amz-meta-')) customMetadata[name.slice(11)] = value;
    }
    return {httpMetadata, customMetadata};
  }
  function sameMetadata(expected, observed) {
    const custom = value => Object.entries(value).map(([name, item]) => [name.toLowerCase(), item]).sort();
    return JSON.stringify(Object.entries(expected.httpMetadata).sort()) ===
      JSON.stringify(Object.entries(observed.httpMetadata).sort()) &&
      JSON.stringify(custom(expected.customMetadata)) === JSON.stringify(custom(observed.customMetadata));
  }
  async function head(key) {
    const response = await signed(objectURL(key), {method: 'HEAD'});
    if (response.status === 404) return null;
    status(response);
    const length = response.headers.get('content-length');
    const size = Number(length), etag = response.headers.get('etag');
    if (length === null || !Number.isSafeInteger(size) || size < 0 || !etagOK(etag)) fail('invalid_response');
    return {key, size, etag, ...metadata(response)};
  }
  async function inspectObject(entry) {
    checkedEntry(entry);
    const observed = await head(entry.key);
    if (!observed) return 'absent';
    if (observed.size !== entry.size || !sameMetadata(entry, observed)) return 'conflict';
    const response = await signed(objectURL(entry.key), {method: 'GET', timeoutMs: 120_000,
      headers: {'if-match': observed.etag}});
    if (response.status === 412 || response.status === 404) return 'conflict';
    status(response);
    if (!sameMetadata(entry, metadata(response))) return 'conflict';
    const reader = response.body?.getReader();
    if (!reader) fail('unavailable');
    const hasher = createHash('sha256'); let size = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > entry.size) return 'conflict';
        hasher.update(value);
      }
      return size === entry.size && hasher.digest('hex') === entry.sha256 ? 'matching' : 'conflict';
    } catch { fail('unavailable'); }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  async function listPage({continuationToken = null, maxKeys = 1000} = {}) {
    if (continuationToken !== null && (typeof continuationToken !== 'string' ||
        continuationToken.length > 4096) || !Number.isInteger(maxKeys) || maxKeys < 1 || maxKeys > 1000)
      fail('invalid_request');
    const url = new URL(bucketURL);
    url.searchParams.set('list-type', '2'); url.searchParams.set('encoding-type', 'url');
    url.searchParams.set('max-keys', String(maxKeys));
    if (continuationToken) url.searchParams.set('continuation-token', continuationToken);
    const value = await parse(status(await signed(url.toString())), 'ListBucketResult');
    const truncated = value.IsTruncated === 'true';
    const nextContinuationToken = truncated ? value.NextContinuationToken : null;
    if (truncated && (typeof nextContinuationToken !== 'string' || !nextContinuationToken ||
        nextContinuationToken === continuationToken)) fail('invalid_response');
    const objects = oneOrMany(value.Contents).map(item => {
      let key;
      try { key = decodeURIComponent(item?.Key ?? ''); } catch { fail('invalid_response'); }
      const size = Number(item?.Size);
      if (!keyOK(key) || !Number.isSafeInteger(size) || size < 0) fail('invalid_response');
      return {key, size};
    });
    if (objects.length > maxKeys || new Set(objects.map(item => item.key)).size !== objects.length) fail('invalid_response');
    return {objects, nextContinuationToken};
  }
  async function putObject(entry, data) {
    const headers = checkedEntry(entry);
    if (!(data instanceof Uint8Array) || data.byteLength !== entry.size ||
        data.byteLength > MAX_SINGLE || digest(data) !== entry.sha256) fail('invalid_object');
    const before = await inspectObject(entry);
    if (before === 'matching') return 'matching';
    if (before !== 'absent') fail('conflict');
    const response = await signed(objectURL(entry.key), {method: 'PUT',
      headers: {...headers, 'if-none-match': '*'}, body: data});
    if (response.status === 409 || response.status === 412) fail('conflict', response.status);
    status(response);
    if (await inspectObject(entry) !== 'matching') fail('verification_failed');
    return 'uploaded';
  }
  async function createMultipart(entry) {
    const headers = checkedEntry(entry);
    if (await inspectObject(entry) !== 'absent') fail('conflict');
    const value = await parse(status(await signed(objectURL(entry.key) + '?uploads',
      {method: 'POST', headers})), 'InitiateMultipartUploadResult');
    if (!uploadOK(value.UploadId)) fail('invalid_response');
    return {uploadId: value.UploadId};
  }
  async function listParts(key, uploadId, {marker = 0} = {}) {
    if (!keyOK(key) || !uploadOK(uploadId) || !Number.isInteger(marker) || marker < 0 || marker > 10_000)
      fail('invalid_request');
    const url = new URL(objectURL(key));
    url.searchParams.set('uploadId', uploadId);
    url.searchParams.set('max-parts', '1000');
    if (marker) url.searchParams.set('part-number-marker', String(marker));
    const value = await parse(status(await signed(url.toString())), 'ListPartsResult');
    const parts = oneOrMany(value.Part).map(item => {
      const number = Number(item?.PartNumber), size = Number(item?.Size);
      if (!Number.isInteger(number) || number < 1 || number > 10_000 ||
          !Number.isSafeInteger(size) || size < 0 || !etagOK(item?.ETag)) fail('invalid_response');
      return {number, size, etag: item.ETag};
    });
    const nextMarker = value.IsTruncated === 'true' ? Number(value.NextPartNumberMarker) : null;
    if (nextMarker !== null && (!Number.isInteger(nextMarker) || nextMarker <= marker)) fail('invalid_response');
    return {parts, nextMarker};
  }
  async function uploadPart(key, uploadId, number, data, sha256) {
    if (!keyOK(key) || !uploadOK(uploadId) || !Number.isInteger(number) || number < 1 || number > 10_000 ||
        !(data instanceof Uint8Array) || data.byteLength > MAX_PART || !SHA.test(sha256) || digest(data) !== sha256)
      fail('invalid_part');
    const existing = await listParts(key, uploadId);
    if (existing.nextMarker !== null || existing.parts.some(part => part.number === number)) fail('conflict');
    const url = new URL(objectURL(key));
    url.searchParams.set('partNumber', String(number)); url.searchParams.set('uploadId', uploadId);
    const response = status(await signed(url.toString(), {method: 'PUT', body: data}));
    const etag = response.headers.get('etag');
    if (!etagOK(etag)) fail('invalid_response');
    return {number, size: data.byteLength, sha256, etag};
  }
  async function completeMultipart(entry, uploadId, parts) {
    checkedEntry(entry);
    if (!uploadOK(uploadId) || !Array.isArray(parts) || !parts.length || parts.length > 10_000 ||
        parts.some((part, index) => part.number !== index + 1 || !etagOK(part.etag) ||
          !SHA.test(part.sha256) || !Number.isSafeInteger(part.size) || part.size < 0 ||
          index < parts.length - 1 && part.size < 5 * 1024 * 1024) ||
        parts.reduce((total, part) => total + part.size, 0) !== entry.size) fail('invalid_part');
    if (await inspectObject(entry) !== 'absent') fail('conflict');
    let marker = 0, remote = [];
    do {
      const page = await listParts(entry.key, uploadId, {marker});
      remote.push(...page.parts); marker = page.nextMarker;
    } while (marker !== null && remote.length <= 10_000);
    if (remote.length !== parts.length || remote.some((item, i) =>
      item.number !== parts[i].number || item.size !== parts[i].size || item.etag !== parts[i].etag)) fail('conflict');
    const xml = `<CompleteMultipartUpload>${parts.map(part =>
      `<Part><PartNumber>${part.number}</PartNumber><ETag>${part.etag}</ETag></Part>`
    ).join('')}</CompleteMultipartUpload>`;
    const url = new URL(objectURL(entry.key)); url.searchParams.set('uploadId', uploadId);
    const response = status(await signed(url.toString(), {method: 'POST',
      headers: {'content-type': 'application/xml', 'if-none-match': '*'}, body: xml}));
    await parse(response, 'CompleteMultipartUploadResult');
    if (await inspectObject(entry) !== 'matching') fail('verification_failed');
    return 'uploaded';
  }
  return Object.freeze({listPage, head, inspectObject, putObject, createMultipart,
    listParts, uploadPart, completeMultipart});
}
