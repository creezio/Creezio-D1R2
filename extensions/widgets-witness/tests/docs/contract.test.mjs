import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('installed and validation docs state the optional MCP Apps witness scope and evidence limits',()=>{
  const base=new URL('../../',import.meta.url);
  for(const name of ['README.md','prd.md','interview.md','TODO.md','CHANGELOG.md','AGENTS.md','FILES.md'])
    assert.ok(readFileSync(new URL(name,base),'utf8').trim().length>50,name);
  const readme=readFileSync(new URL('README.md',base),'utf8');
  assert.match(readme,/hors composition par défaut/);
  assert.match(readme,/alpha/);assert.match(readme,/beta/);
  assert.match(readme,/ChatGPT réel/);
  assert.match(readme,/SHA-256/);
});
