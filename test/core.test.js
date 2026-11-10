import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createExecutionStore,renderReport} from '../core.js';
import {createDispatcher} from '../index.js';
import {createReportJobs} from '../jobs.js';

async function fixture(t){const root=await mkdtemp(join(tmpdir(),'dsh-test-workbench-'));
 t.after(async()=>{const path=resolve(root);assert.ok(path.startsWith(resolve(tmpdir())+'/dsh-test-workbench-'));await rm(path,{recursive:true,force:true});});
 const dir=join(root,'.ai-test/work-items/REQ-T');await mkdir(join(dir,'requirements/v1'),{recursive:true});
 const path='.ai-test/work-items/REQ-T/requirements/v1/cases.json';const bytes=JSON.stringify({requirement_id:'REQ-T',cases:[{id:'C1',title:'接待主流程',priority:'P0',kind:'end_to_end_smoke',steps:[{action:'打开',expected:'阶段正确'}]},{id:'C2',title:'排序',dependencies:['C1'],steps:[{action:'查看',expected:'顺序正确'}]},{id:'C3',title:'长内容',priority:'P2',steps:[{action:'滚动',expected:'末尾可达'}]}]});
 await writeFile(join(root,path),bytes);await writeFile(join(dir,'manifest.json'),JSON.stringify({requirement_id:'REQ-T',title:'测试需求'}));await writeFile(join(dir,'artifacts.json'),JSON.stringify({requirement_id:'REQ-T',artifacts:[{artifact_id:'CASES',artifact_type:'test_case_review_draft',path,sha256:createHash('sha256').update(bytes).digest('hex'),status:'review_pending'}]}));
 const s=createExecutionStore(root);const r=await s.createRound({requirementId:'REQ-T',sourceVersion:'v1',environment:'SIT',version:'1.0',idempotencyKey:'test-round'});return {s,r,root,dir,path,bytes};
}
const cmd=r=>({requirementId:r.requirementId,roundId:r.id,expectedRevision:r.revision});
test('导入来源校验、创建幂等与执行轮次不改用例原稿',async t=>{const {s,r,root,path,bytes}=await fixture(t);assert.equal((await s.sources())[0].versions[0].caseCount,3);assert.equal((await s.createRound({requirementId:'REQ-T',sourceVersion:'v1',idempotencyKey:'test-round'})).id,r.id);assert.equal(r.source.authority,'provisional');assert.deepEqual(r.order,['C1','C2','C3']);assert.equal(await readFile(join(root,path),'utf8'),bytes);await writeFile(join(root,path),'{}');await assert.rejects(s.createRound({requirementId:'REQ-T',sourceVersion:'v1',idempotencyKey:'new'}),/哈希/);});
test('并发revision阻止覆盖；失败恢复与新尝试保留历史',async t=>{const {s,r}=await fixture(t);const next=await s.updateCase({...cmd(r),caseId:'C1',status:'failed',actual:'打开后阶段不全',executor:'manual'});assert.equal(next.counts.failed,1);await assert.rejects(s.updateCase({...cmd(r),caseId:'C1',status:'passed',actual:'旧页面结果',executor:'manual'}),e=>e.status===409);const again=await s.newAttempt({...cmd(next),caseId:'C1'});assert.equal(again.cases[0].attempts[0].status,'failed');assert.equal(again.cases[0].execution.status,'not_started');await assert.rejects(s.updateCase({...cmd(again),caseId:'C1',status:'failed',actual:'',executor:'manual'}),/实际/);await assert.rejects(s.updateCase({...cmd(again),caseId:'C1',status:'passed',actual:'文本',executor:'ai'}),/AI 执行结果/);});
test('通过可留空且报告不误称未测，异常状态仍需原因',async t=>{const {s,r}=await fixture(t);const passed=await s.updateCase({...cmd(r),caseId:'C1',status:'passed',actual:'',executor:'manual'});assert.equal(passed.counts.passed,1);assert.equal(passed.cases[0].execution.actual,'');const report=renderReport(passed);assert.match(report,/已标记通过，未填写补充说明/);assert.match(report,/接待主流程 \| 已标记通过，未填写补充说明 \| 通过/);for(const status of ['failed','blocked','deferred'])await assert.rejects(s.updateCase({...cmd(passed),caseId:'C1',status,actual:' ',executor:'manual'}),/实际结果或原因/);});

test('依赖保护、带原因移除/恢复且失败不消失',async t=>{const {s,r}=await fixture(t);await assert.rejects(s.order({...cmd(r),order:['C2','C1','C3']}),/必须/);await assert.rejects(s.remove({...cmd(r),caseId:'C1',reason:'改需求'}),/依赖/);await assert.rejects(s.remove({...cmd(r),caseId:'C3',reason:''}),/原因/);const fail=await s.updateCase({...cmd(r),caseId:'C3',status:'failed',actual:'末尾遮挡',executor:'manual'});const removed=await s.remove({...cmd(fail),caseId:'C3',reason:'本轮需求改版',category:'需求变更'});assert.equal(removed.counts.active,2);assert.equal(removed.cases[2].execution.status,'failed');assert.match(renderReport(removed),/保留原结果 失败/);const restored=await s.restore({...cmd(removed),caseId:'C3',reason:'恢复原范围'});assert.equal(restored.counts.failed,1);assert.equal(restored.cases[2].history.filter(x=>['removed','restored'].includes(x.event)).length,2);});
test('证据归属到当前尝试，媒体签名和路径受限，发布保留历史',async t=>{const {s,r}=await fixture(t);const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=','base64');await assert.rejects(s.addEvidence({...cmd(r),caseId:'C1'},{bytes:png,name:'x.jpg',mime:'image/jpeg'}),/文件头/);const saved=await s.addEvidence({...cmd(r),caseId:'C1',step:1,caption:'打开后阶段正确'},{bytes:png,name:'../../escape.png',mime:'image/png'});const e=saved.cases[0].evidence[0];assert.ok(!e.path.includes('escape'));assert.equal((await s.evidence('REQ-T',r.id,e.id)).bytes.length,png.length);assert.match(renderReport(saved),new RegExp('evidence:'+e.id));const next=await s.newAttempt({...cmd(saved),caseId:'C1'});assert.equal(next.cases[0].evidence.length,1);assert.doesNotMatch(renderReport(next),new RegExp('evidence:'+e.id));await assert.rejects(s.evidence('REQ-T',r.id,'../../etc'),/标识/);});
test('删除旧尝试证据只移除指定附件，原始元数据和文件在重启后仍可追溯',async t=>{
 const {s,r,root}=await fixture(t);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=','base64');
 const file={bytes:png,name:'original.png',mime:'image/png'};
 let before=await s.addEvidence({...cmd(r),caseId:'C1',step:1,caption:'原尝试的完整图注'},file);
 const original=structuredClone(before.cases[0].evidence[0]);
 before=await s.newAttempt({...cmd(before),caseId:'C1'});
 before=await s.updateCase({...cmd(before),caseId:'C1',status:'failed',actual:'保留当前执行结果',executor:'manual',issue:'保留问题',stepResults:[{step:1,status:'failed',actual:'保留步骤结果'}]});
 before=await s.addEvidence({...cmd(before),caseId:'C1',caption:'当前尝试保留附件'},file);
 before=await s.addEvidence({...cmd(before),caseId:'C2',caption:'其他用例保留附件'},file);
 const after=await s.removeEvidence({...cmd(before),caseId:'C1',evidenceId:original.id});
 assert.equal(after.revision,before.revision+1);
 assert.notEqual(original.attemptId,after.cases[0].execution.attemptId);
 assert.deepEqual(after.cases[0].evidence,before.cases[0].evidence.slice(1));
 const event=after.cases[0].history.at(-1);
 assert.equal(event.event,'evidence_removed');assert.equal(event.evidenceId,original.id);assert.equal(event.attemptId,original.attemptId);assert.ok(event.at);
 assert.deepEqual(event.before,original);
 assert.deepEqual(after.cases[0],{...before.cases[0],evidence:before.cases[0].evidence.slice(1),history:[...before.cases[0].history,event]});
 assert.deepEqual(after.cases.slice(1),before.cases.slice(1));assert.deepEqual(after.counts,before.counts);assert.deepEqual(after.order,before.order);
 const restarted=createExecutionStore(root);
 assert.deepEqual(await restarted.readRound(r.requirementId,r.id),after);
 await assert.rejects(restarted.evidence(r.requirementId,r.id,original.id),error=>error.status===404);
 const retained=(await restarted.absoluteEvidence(before)).find(e=>e.id===original.id);
 assert.ok(retained);assert.deepEqual(await readFile(retained.path),png);
});

test('删除证据严格校验用例归属和revision，已移除用例不允许删除且失败不写入',async t=>{
 const {s,r}=await fixture(t);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=','base64');
 const saved=await s.addEvidence({...cmd(r),caseId:'C3',caption:'保留证据'},{bytes:png,name:'current.png',mime:'image/png'});
 const evidenceId=saved.cases[2].evidence[0].id;
 await assert.rejects(s.removeEvidence({...cmd(saved),caseId:'C2',evidenceId}),error=>error.status===404&&error.message==='证据不存在');
 await assert.rejects(s.removeEvidence({...cmd(saved),caseId:'C404',evidenceId}),error=>error.status===404&&error.message==='未找到用例');
 await assert.rejects(s.removeEvidence({...cmd(saved),caseId:'C3',evidenceId:'EVID-missing'}),error=>error.status===404);
 for(const expectedRevision of [r.revision,undefined])await assert.rejects(s.removeEvidence({...cmd(saved),expectedRevision,caseId:'C3',evidenceId}),error=>error.status===409&&error.revision===saved.revision);
 assert.deepEqual(await s.readRound(r.requirementId,r.id),saved);
 const removed=await s.remove({...cmd(saved),caseId:'C3',reason:'本轮不适用'});
 await assert.rejects(s.removeEvidence({...cmd(removed),caseId:'C3',evidenceId}),error=>error.status===400&&error.message==='先恢复用例再删除证据');
 assert.deepEqual(await s.readRound(r.requirementId,r.id),removed);
});

test('POST evidence-remove返回完整轮次、409当前revision和删除后的404',async t=>{
 const {s,r}=await fixture(t);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=','base64');
 const saved=await s.addEvidence({...cmd(r),caseId:'C1'},{bytes:png,name:'api.png',mime:'image/png'});
 const evidenceId=saved.cases[0].evidence[0].id,dispatch=createDispatcher(s);
 const post=data=>dispatch(new Request('http://host/api/test-workbench/evidence-remove',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}));
 const stale=await post({...cmd(r),caseId:'C1',evidenceId});assert.equal(stale.status,409);assert.equal((await stale.json()).revision,saved.revision);
 const wrong=await post({...cmd(saved),caseId:'C2',evidenceId});assert.equal(wrong.status,404);assert.equal((await wrong.json()).error,'证据不存在');
 const response=await post({...cmd(saved),caseId:'C1',evidenceId});assert.equal(response.status,200);
 const {round}=await response.json();assert.deepEqual(round,await s.readRound(r.requirementId,r.id));assert.equal(round.cases[0].evidence.length,0);
 const duplicate=await post({...cmd(round),caseId:'C1',evidenceId});assert.equal(duplicate.status,404);
 const media=await dispatch(new Request('http://host/api/test-workbench/evidence?'+new URLSearchParams({id:r.requirementId,round:r.id,evidence:evidenceId})));assert.equal(media.status,404);
 assert.equal((await s.readRound(r.requirementId,r.id)).revision,round.revision);
});

test('未执行也生成阶段报告，移除与缺证不计通过，快照不随补测改变',async t=>{const {s,r}=await fixture(t);const q=await s.queueReport({...cmd(r),mode:'preview'});assert.equal(q.job.snapshotRevision,r.revision);assert.match(renderReport(q.job.snapshot),/阶段测试报告/);assert.match(renderReport(q.job.snapshot),/未执行 3 条/);await assert.rejects(s.queueReport({...cmd(q.round),mode:'preview'}),/已有/);const edited=await s.updateCase({...cmd(q.round),caseId:'C1',status:'passed',actual:'本次打开阶段正确',executor:'manual'});assert.equal(edited.counts.passed,1);assert.equal((await s.getJob('REQ-T',r.id,q.job.id)).snapshot.cases[0].execution.status,'not_started');const jobs=createReportJobs(s);await jobs.run('REQ-T',r.id,q.job.id);const ready=await s.getJob('REQ-T',r.id,q.job.id);assert.equal(ready.status,'preview_ready');assert.match(ready.markdown,/未执行 3 条/);});
test('报告首次创建身份持久化，后续更新同一文档，未知创建不重发',async t=>{const {s,r}=await fixture(t);let calls=0;const ai={available:()=>true,report:async()=>({summary:'当前还有未测场景。'})};const publisher=async(input,deps)=>{calls++;if(input.publication)assert.equal(input.publication.documentId,'DOC1');await deps.checkpoint({documentId:'DOC1',url:'https://example.feishu.cn/docx/DOC1',state:'ready'});return {documentId:'DOC1',url:'https://example.feishu.cn/docx/DOC1',state:'ready'};};const jobs=createReportJobs(s,{ai,publisher});let q=await s.queueReport({...cmd(r),mode:'publish'});await jobs.run('REQ-T',r.id,q.job.id);let next=await s.readRound('REQ-T',r.id);assert.equal(next.publication.documentId,'DOC1');q=await s.queueReport({...cmd(next),mode:'publish'});await jobs.run('REQ-T',r.id,q.job.id);assert.equal(calls,2);next=await s.readRound('REQ-T',r.id);q=await s.queueReport({...cmd(next),mode:'publish'});const bad=createReportJobs(s,{ai,publisher:async(input,deps)=>{await deps.checkpoint({state:'create_intent'});throw Object.assign(Error('连接中断'),{code:'CREATE_OUTCOME_UNKNOWN'});}});await bad.run('REQ-T',r.id,q.job.id);const unknown=await s.readRound('REQ-T',r.id);assert.equal(unknown.reportJobs[0].status,'unknown');await assert.rejects(s.queueReport({...cmd(unknown),mode:'publish'}),/未知/);});
test('AI编排保留已执行前缀，输出不全不落盘',async t=>{const {s,r}=await fixture(t);const started=await s.updateCase({...cmd(r),caseId:'C1',status:'in_progress',actual:'',executor:'manual'});await assert.rejects(s.replan({...cmd(started)},async()=>({order:['C3','C1','C2']})),/不得移动/);const result=await s.replan({...cmd(started)},async()=>({order:['C1','C3','C2'],reasoning:[{caseId:'C3',reason:'复用数据'}]}));assert.deepEqual(result.order,['C1','C3','C2']);assert.equal(result.plan.method,'ai');});
test('新建轮次自动AI编排，模型失败保留规则清单并明确提示',async t=>{const {s}=await fixture(t);const createBody=key=>({requirementId:'REQ-T',sourceVersion:'v1',environment:'SIT',version:'1',idempotencyKey:key});const request=body=>new Request('http://host/api/test-workbench/rounds',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const good=createDispatcher(s,{ai:{available:()=>true,plan:async()=>({order:['C1','C3','C2'],plan:{method:'ai',reasoning:[]}})}});const planned=(await (await good(request(createBody('ai-test')))).json()).round;assert.equal(planned.plan.method,'ai');assert.deepEqual(planned.order,['C1','C3','C2']);const bad=createDispatcher(s,{ai:{available:()=>true,plan:async()=>{throw Error('provider failure');}}});const fallback=(await (await bad(request(createBody('ai-fail')))).json()).round;assert.equal(fallback.plan.method,'rule_based');assert.match(fallback.plan.aiError,/AI 初次编排未完成/);});

test('API同源限制、上传表单、健康检查及409回传',async t=>{const {s,r}=await fixture(t);const dispatch=createDispatcher(s);const bad=await dispatch(new Request('http://host/api/test-workbench/rounds',{headers:{origin:'https://evil.example'}}));assert.equal(bad.status,403);const localCrossSite=await dispatch(new Request('http://host/api/test-workbench/rounds',{method:'POST',headers:{origin:'http://127.0.0.1:9999','sec-fetch-site':'same-site','content-type':'application/json'},body:'{}'}));assert.equal(localCrossSite.status,403);const health=await dispatch(new Request('http://host/api/test-workbench/health'));assert.equal((await health.json()).capabilities.partialReports,true);const ok=await dispatch(new Request('http://host/api/test-workbench/case',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...cmd(r),caseId:'C1',attemptId:r.cases[0].execution.attemptId,status:'passed',actual:'阶段正确',executor:'manual'})}));assert.equal(ok.status,200);const stale=await dispatch(new Request('http://host/api/test-workbench/case',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...cmd(r),caseId:'C1',attemptId:r.cases[0].execution.attemptId,status:'passed',actual:'旧数据',executor:'manual'})}));assert.equal(stale.status,409);assert.equal((await stale.json()).revision,2);});
