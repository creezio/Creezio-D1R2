// The root gate executes every native module family; a module cannot silently opt out.
import '../../extensions/native/access/tests/backend/contract.test.mjs';
import '../../extensions/native/access/tests/ui/contract.test.mjs';
import '../../extensions/native/access/tests/api-mcp/contract.test.mjs';
import '../../extensions/native/access/tests/widgets/contract.test.mjs';
import '../../extensions/native/access/tests/package/contract.test.mjs';
import '../../extensions/native/access/tests/docs/contract.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAccess} from '../../scripts/data/prepare-access.mjs';
import {ACCESS_TABLES} from '../../core/identity/d1-store.ts';
import {sqlTableName} from '../../scripts/data/d1-schema.mjs';

test('versioned access SQL and manifest match canonical models without rewriting sources',()=>{
  const report=prepareAccess();
  assert.equal(report.databaseChanged,false);
  assert.ok(report.models>=8);
  for(const [model,name] of Object.entries(ACCESS_TABLES))assert.equal(name,sqlTableName('creezio.access',model));
});
