// Preserve registry vulnerability reporting while verifying the exact installed
// local mitigation for GHSA-fc5q-39xc-vjpf. No general audit ignore is allowed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const vendored='vendor/onesa-picomatch-redos-4.0.8-onesa.1';
const advisory='https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const parse=join(root,vendored,'lib/parse.js');
const sourceSha='526b223084caa8bc76ab5706d3257b90af0cf762';

function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function gitBlob(bytes){return createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');}
function installedMitigation(){
  const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  assert.equal(manifest.pnpm?.overrides?.['picomatch@>=4.0.0'],'file:'+vendored);
  const lock=readFileSync(join(root,'pnpm-lock.yaml'),'utf8');
  assert.ok(lock.includes('picomatch@file:'+vendored+':'));
  assert.ok(!/^\s{2}picomatch@4\.[0-9]+\.[0-9]+:/m.test(lock),'Unpatched 4.x source is still installed');
  const vendorPkg=JSON.parse(readFileSync(join(root,vendored,'package.json'),'utf8'));
  assert.equal(vendorPkg.name,'picomatch');
  assert.equal(vendorPkg.version,'4.0.8-onesa.1');
  assert.equal(gitBlob(readFileSync(parse)),sourceSha,'Mitigated parser differs from the reviewed source');
  const requireFromVite=createRequire(import.meta.resolve('vite'));
  const installedPkg=requireFromVite('picomatch/package.json');
  assert.equal(installedPkg.name,'picomatch');
  assert.equal(installedPkg.version,vendorPkg.version);
  const installedParse=join(dirname(requireFromVite.resolve('picomatch/package.json')),'lib/parse.js');
  assert.equal(realpathSync(installedParse),realpathSync(parse),'Vite resolves an unreviewed parser');
  const match=requireFromVite('picomatch');
  for(const pattern of ['+(*)','+(*a)','+(a*)','*(a*|b)','+(ab|abab)']){
    assert.equal(match.makeRe(pattern).test('a'.repeat(150)+'!'),false,pattern);
    assert.equal(match.isMatch(pattern,pattern),true,'High-risk glob remains literal');
  }
}
export function classifyAudit(report,status){
  if(!object(report)||object(report.error)||!object(report.advisories))throw Error('Incomplete pnpm advisory report');
  const advisories=Object.values(report.advisories);
  if(!advisories.length){
    if(status!==0)throw Error('Audit exit disagrees with an empty report');
    return 'Registry audit clear';
  }
  if(status!==1||advisories.length!==1)throw Error('Unreviewed dependency security findings');
  const issue=advisories[0];
  if(!object(issue)||issue.module_name!=='picomatch'||issue.url!==advisory||
     !['high','critical'].includes(issue.severity)||!Array.isArray(issue.findings)||
     !issue.findings.length||issue.findings.some(f=>!object(f)||!Array.isArray(f.paths)||
       !f.paths.length||f.paths.some(p=>typeof p!=='string'||!p.includes('picomatch'))))
    throw Error('Unrecognized or additional dependency advisory');
  return 'One known registry picomatch advisory; exact installed patched source independently verified';
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{
    installedMitigation();
    const run=spawnSync('pnpm',['audit','--json','--audit-level=moderate'],
      {cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
    if(run.error||![0,1].includes(run.status))throw Error('Registry audit did not complete');
    let report;
    try{report=JSON.parse(run.stdout);}catch{throw Error('Invalid pnpm audit JSON');}
    console.log(classifyAudit(report,run.status));
  }catch(e){
    console.error('Dependency security refused: '+e.message);
    process.exitCode=1;
  }
}
