import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
assert.equal(pkg.private,undefined,'Release package cannot be private');
assert.equal(pkg.license,'MIT');
assert.ok(pkg.repository.url.startsWith('git+https://github.com/'));
assert.ok(pkg.dsh.bundle.patch && fs.existsSync(path.join(root,pkg.dsh.bundle.patch)));
assert.ok(pkg.engines.dsh && pkg.engines.node);
for(const file of ['LICENSE','README.md','README.zh-CN.md','CONTRIBUTING.md','SECURITY.md','examples/cases.json'])assert.ok(fs.existsSync(path.join(root,file)),`Missing ${file}`);
const files=JSON.parse(execFileSync(process.platform==='win32'?'npm.cmd':'npm',['pack','--dry-run','--json','--ignore-scripts'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}))[0].files;
for(const file of files){
  assert.ok(!/(^|\/)(\.ai-test|\.env|\.npmrc|node_modules|write\.lock)(\/|$)/.test(file.path),`Private runtime path in package: ${file.path}`);
  assert.ok(!/\.(png|jpe?g|webp|mp4|webm|pdf)$/i.test(file.path),`Runtime media must not be bundled: ${file.path}`);
  const text=fs.readFileSync(path.join(root,file.path),'utf8');
  assert.ok(!/-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----/.test(text),`Private key in ${file.path}`);
  assert.ok(!/(?:ghp|github_pat|npm)_[A-Za-z0-9]{30,}/.test(text),`Credential-like string in ${file.path}`);
}
const {Config}=await import('../config.js');
const defaults=Config({});assert.equal(defaults.report.enabled,false);assert.equal(defaults.workspaceRoot,'');
const {createExecutionStore}=await import('../core.js');
const os=await import('node:os');
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-package-smoke-'));
try{
  const store=createExecutionStore(fixture);assert.deepEqual(await store.sources(),[]);await store.recover();
  const doc=JSON.parse(fs.readFileSync(path.join(root,'examples/cases.json'),'utf8'));
  const imported=await store.importCases({requirementId:doc.requirement_id,title:doc.title,cases:doc.cases,idempotencyKey:'package-validation'});
  assert.equal(imported.authority,'provisional');
  const round=await store.createRound({requirementId:doc.requirement_id,sourceVersion:imported.version,environment:'isolated-demo',version:'demo-build',idempotencyKey:'package-round'});
  assert.equal(round.cases.length,doc.cases.length);assert.ok(round.cases.every(c=>c.execution.status==='not_started'));
  assert.ok(round.cases[0].oracle,'Example Oracle was not retained');
  console.log(JSON.stringify({package:pkg.name,version:pkg.version,packageFiles:files.length,exampleCases:round.cases.length,authority:round.source.authority,externalWrites:0}));
}finally{
  const resolved=fs.realpathSync(fixture);assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'dsh-package-smoke-'));
  fs.rmSync(resolved,{recursive:true,force:true});
}
