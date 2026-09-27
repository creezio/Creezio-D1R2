import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('ChatGPT-like theme declares no HTTP, MCP or conversational capability',()=>{
  const base=new URL('../../',import.meta.url);
  const manifest=JSON.parse(readFileSync(new URL('module/manifest.json',base)));
  assert.deepEqual(manifest.contracts.api,[]);
  for(const value of Object.values(manifest.contracts.mcp)) assert.deepEqual(value,[]);
  assert.deepEqual(JSON.parse(readFileSync(new URL('plugin/mcp.json',base))),{mcpServers:{}});
});
