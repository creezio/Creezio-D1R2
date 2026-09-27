import test from 'node:test';
import assert from 'node:assert/strict';
import {temporaryDirectory} from '../quality/temporary.mjs';
import {createFileTransferJournal} from '../../scripts/cloudflare/transfer/journal.ts';

const hash=`sha256-${'a'.repeat(64)}`;
const identity={transferId:'transfer-one',applicationId:'creezio.app',sourceSha:'b'.repeat(40),
  compositionDigest:hash,lockDigest:hash,modelDigest:hash,schemaObjectsDigest:hash,
  planDigest:hash,sourceSchemaReceiptId:hash,
  target:{accountId:'account-one',workerName:'worker-one',databaseId:'database-one',
    bucketName:'bucket-one',origin:'https://example.workers.dev'}};
const first={schemaVersion:1,revision:1,identity,manifestDigest:hash,phase:'captured',
  tableCursor:null,objectCursor:null,multipart:null,targetSchemaReceiptId:null,targetDeploymentId:null};

test('transfer checkpoints are bounded, atomic and compare-and-swap guarded',async t=>{
  const directory=temporaryDirectory(t,'creezio-transfer-journal-'),journal=createFileTransferJournal(directory);
  assert.equal(await journal.load(identity.transferId),null);
  await assert.rejects(journal.create({...first,cloudflareToken:'must-never-persist'}),
    error=>error.code==='invalid_state');
  await journal.create(first);
  assert.deepEqual(await journal.load(identity.transferId),first);
  await assert.rejects(journal.create(first),error=>error.code==='invalid_state');
  const next={...first,revision:2,phase:'schema-ready',targetSchemaReceiptId:hash};
  await journal.compareAndSave(first,next);
  assert.deepEqual(await journal.load(identity.transferId),next);
  await assert.rejects(journal.compareAndSave(first,{...next,revision:3}),error=>error.code==='invalid_state');
  await assert.rejects(journal.compareAndSave(next,{...next,revision:3,
    identity:{...identity,target:{...identity.target,databaseId:'foreign'}}}),error=>error.code==='invalid_state');
  const pending={...next,revision:3,phase:'r2-copying',multipart:{key:'object-one',uploadId:'upload-one',
    completedParts:[],pendingPart:{number:1,size:8*1024*1024,sha256:'c'.repeat(64),md5:'d'.repeat(32)}}};
  await journal.compareAndSave(next,pending);
  assert.deepEqual((await journal.load(identity.transferId))?.multipart?.pendingPart,pending.multipart.pendingPart);
  await assert.rejects(journal.compareAndSave(pending,{...pending,revision:4,
    multipart:{...pending.multipart,pendingPart:{...pending.multipart.pendingPart,md5:'invalid'}}}),
  error=>error.code==='invalid_state');
});
