import {randomUUID} from 'node:crypto';
import {SCHEMA_RECEIPT_OBJECT,SCHEMA_RECEIPT_TABLE} from '../../../scripts/data/apply-schema.mjs';
import {schemaDigest} from '../../../scripts/data/composition-schema.mjs';
import {canonicalJson} from '../../../sdk/contracts/validate.mjs';

const HASH=/^sha256-[a-f0-9]{64}$/;

/** A synthetic receipt chain for routed D1 tests, using the installer's exact table DDL. */
export async function appendStorageCompositionReceipt(db,compositionDigest,lockDigest){
  if(!HASH.test(compositionDigest)||!HASH.test(lockDigest))
    throw new Error('Invalid fixture composition or lock digest.');
  let latest;
  try{latest=await db.prepare(`SELECT sequence,id FROM "${SCHEMA_RECEIPT_TABLE}"
    ORDER BY sequence DESC LIMIT 1`).first();}
  catch{
    await db.prepare(SCHEMA_RECEIPT_OBJECT.sql).run();
    latest=null;
  }
  const sequence=latest?latest.sequence+1:1;
  const payload=canonicalJson({schemaVersion:1,applicationId:'t33.fixture',sequence,
    previousId:latest?.id??null,nonce:randomUUID(),compositionDigest,lockDigest,
    modelDigest:compositionDigest,sqlDigest:compositionDigest,planDigest:compositionDigest,objects:[]});
  const id=schemaDigest(payload);
  await db.prepare(`INSERT INTO "${SCHEMA_RECEIPT_TABLE}"
    (sequence,id,previous_id,payload) VALUES (?,?,?,?)`)
    .bind(sequence,id,latest?.id??null,payload).run();
  return id;
}
