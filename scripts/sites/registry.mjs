import {constants} from 'node:fs';
import {lstat, mkdir, open} from 'node:fs/promises';
import path from 'node:path';
import {createRegistryClient} from '../../core/registry/client.ts';
import {createPublicationGate} from '../../core/registry/publication.ts';
import {createFilePublicationJournal} from '../../core/registry/file-journal.ts';

const id = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const token = /^cz1d_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
function fail() {throw Object.assign(new Error('Registry registration is required.'), {code: 'registry_registration_required'});}

async function directory(location) {
  const stat = await lstat(location);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
}

async function readPrivate(file) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 8192) fail();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8192 || stat.ino !== before.ino || stat.dev !== before.dev) fail();
    const bytes = Buffer.alloc(8193), {bytesRead} = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 8192) fail();
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(0, bytesRead));
  } finally {await handle.close();}
}

/** Official Sites publisher context: private registration, shared gate and durable journal. */
export async function createSitesRegistryContext({root, fetcher} = {}) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root
    || fetcher !== undefined && typeof fetcher !== 'function') fail();
  const parent = path.join(root, '.creezio');
  const registryDirectory = path.join(parent, 'registry');
  const registration = path.join(registryDirectory, 'installation.json');
  let value;
  try {
    await directory(root); await directory(parent); await directory(registryDirectory);
    value = JSON.parse(await readPrivate(registration));
  } catch {fail();}
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'installationId,installationToken,origin,projectId'
    || typeof value.projectId !== 'string' || !id.test(value.projectId)
    || typeof value.installationId !== 'string' || !id.test(value.installationId)
    || typeof value.installationToken !== 'string' || !token.test(value.installationToken)) fail();
  let origin;
  try {origin = new URL(value.origin);} catch {fail();}
  if (origin.protocol !== 'https:' || origin.origin !== value.origin || origin.username || origin.password) fail();

  const journalDirectory = path.join(registryDirectory, 'sites-journal');
  try {await mkdir(journalDirectory, {mode: 0o700});}
  catch (error) {if (error.code !== 'EEXIST') fail();}
  await directory(journalDirectory);
  const registryClient = createRegistryClient({origin: value.origin, installationToken: value.installationToken,
    ...(fetcher ? {fetch: fetcher} : {})});
  const publicationJournal = createFilePublicationJournal(journalDirectory);
  return Object.freeze({
    registryIdentity: Object.freeze({projectId: value.projectId, installationId: value.installationId}),
    registryClient,
    publicationJournal,
    publicationGate: createPublicationGate({client: registryClient, journal: publicationJournal}),
  });
}
