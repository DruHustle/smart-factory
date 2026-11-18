import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyAudit} from './audit-patched-picomatch.mjs';

const patch={
  module_name:'picomatch',
  url:'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  severity:'high',
  findings:[{paths:['.>vitest>picomatch']}]
};
test('allow a genuinely clear audit only with a successful registry result',()=>{
  assert.match(classifyAudit({advisories:{}},0),/clear/);
  assert.throws(()=>classifyAudit({advisories:{}},1));
});
test('a single advisory requires independently pinned local mitigation',()=>{
  assert.match(classifyAudit({advisories:{'1':patch}},1),/verified/);
  for(const report of [
    {error:'registry unavailable'},
    {advisories:{'1':{...patch,module_name:'different'}}},
    {advisories:{'1':{...patch,url:'https://example.test/advisory'}}},
    {advisories:{'1':{...patch,findings:[]}}},
    {advisories:{'1':patch,'2':{...patch,module_name:'other'}}}
  ])assert.throws(()=>classifyAudit(report,1));
  assert.throws(()=>classifyAudit({advisories:{'1':patch}},0));
});
