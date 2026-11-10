import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,unlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createExecutionStore} from '../core.js';
import {createReportJobs} from '../jobs.js';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'dsh-integration-review-'));
 t.after(async()=>{const target=resolve(root);assert.ok(target.startsWith(resolve(tmpdir())+'/dsh-integration-review-'));await rm(target,{recursive:true,force:true});});
 const directory=join(root,'.ai-test/work-items/REQ-R');
 await mkdir(join(directory,'requirements/v1'),{recursive:true});
 const sourcePath='.ai-test/work-items/REQ-R/requirements/v1/cases.json';
 const bytes=JSON.stringify({requirement_id:'REQ-R',cases:[{id:'C1',title:'资料保存与刷新',steps:[{action:'保存后刷新',expected:'资料仍完整'}]}]});
 await writeFile(join(root,sourcePath),bytes);
 await writeFile(join(directory,'manifest.json'),JSON.stringify({requirement_id:'REQ-R',title:'集成评审'}));
 await writeFile(join(directory,'artifacts.json'),JSON.stringify({requirement_id:'REQ-R',artifacts:[{artifact_id:'CASES',artifact_type:'test_case_review_draft',path:sourcePath,sha256:createHash('sha256').update(bytes).digest('hex'),status:'review_pending'}]}));
 const store=createExecutionStore(root);
 const round=await store.createRound({requirementId:'REQ-R',sourceVersion:'v1',environment:'SIT',version:'1',idempotencyKey:'review'});
 return {root,store,round};
}
const command=r=>({requirementId:r.requirementId,roundId:r.id,expectedRevision:r.revision});
const ai=()=>({available:()=>true,report:async()=>({summary:'本轮仍有未执行场景。',model:{provider:'test',model:'mock'}})});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=','base64');

test('known prepublish failure resumes EXACT persisted Markdown without another AI generation',async t=>{
 const {store,round}=await fixture(t);
 const queued=await store.queueReport({...command(round),mode:'publish'});
 let aiCalls=0;const model={available:()=>true,report:async()=>({summary:'生成说明'+(++aiCalls)})};
 const inputs=[];let first=true;
 const jobs=createReportJobs(store,{ai:model,publisher:async input=>{inputs.push(input.markdown);if(first){first=false;throw Object.assign(new Error('known validation failure'),{code:'INVALID_MARKDOWN'});}return {documentId:'DOC',url:'https://example.feishu.cn/docx/DOC',directory:{status:'verified'}};}});
 await jobs.run(round.requirementId,round.id,queued.job.id);
 const saved=await store.getJob(round.requirementId,round.id,queued.job.id);
 assert.equal(saved.status,'failed');assert.equal(saved.retryable,true);
 // Execute the same persisted job again; reservation itself is covered separately.
 await jobs.run(round.requirementId,round.id,queued.job.id);
 assert.equal(aiCalls,1);assert.equal(inputs[1],inputs[0]);
 assert.deepEqual((await store.getJob(round.requirementId,round.id,queued.job.id)).generation,saved.generation);
});

test('old-attempt missing media cannot block current-attempt report publication',async t=>{
 const {store,round,root}=await fixture(t);
 const withEvidence=await store.addEvidence({...command(round),caseId:'C1',caption:'旧尝试截图'},{bytes:png,name:'old.png',mime:'image/png'});
 const old=withEvidence.cases[0].evidence[0];
 const next=await store.newAttempt({...command(withEvidence),caseId:'C1'});
 const queued=await store.queueReport({...command(next),mode:'publish'});
 const base=await realpath(root),target=await realpath(resolve(root,old.path));assert.ok(target.startsWith(base+'/'));await unlink(target);
 let evidence;
 const jobs=createReportJobs(store,{ai:ai(),publisher:async input=>{evidence=input.evidence;return {documentId:'DOC',url:'https://example.feishu.cn/docx/DOC',directory:{status:'verified'}};}});
 await jobs.run(round.requirementId,round.id,queued.job.id);
 assert.deepEqual(evidence,[]);
 assert.equal((await store.getJob(round.requirementId,round.id,queued.job.id)).status,'published');
});

test('publication evidence metadata comes from frozen snapshot rather than later caption edits',async t=>{
 const {store,round}=await fixture(t);
 const withEvidence=await store.addEvidence({...command(round),caseId:'C1',caption:'快照创建时的图注'},{bytes:png,name:'current.png',mime:'image/png'});
 const queued=await store.queueReport({...command(withEvidence),mode:'publish'});
 const e=withEvidence.cases[0].evidence[0];
 await store.evidenceMeta({...command(queued.round),caseId:'C1',evidenceId:e.id,caption:'用户后续修改的图注',step:1});
 let received;
 const jobs=createReportJobs(store,{ai:ai(),publisher:async input=>{received=input;return {documentId:'DOC',url:'https://example.feishu.cn/docx/DOC',directory:{status:'verified'}};}});
 await jobs.run(round.requirementId,round.id,queued.job.id);
 assert.equal(received.evidence[0].caption,'快照创建时的图注');
 assert.match(received.markdown,/快照创建时的图注/);
 assert.doesNotMatch(received.markdown,/用户后续修改的图注/);
});

test('deleted evidence survives frozen publication after restart while new reports omit it',async t=>{
 const {store,round,root}=await fixture(t);
 const withEvidence=await store.addEvidence({...command(round),caseId:'C1',caption:'删除前冻结的原始图注',step:1},{bytes:png,name:'frozen.png',mime:'image/png'});
 const original=structuredClone(withEvidence.cases[0].evidence[0]);
 const queued=await store.queueReport({...command(withEvidence),mode:'publish'});
 const deleted=await store.removeEvidence({...command(queued.round),caseId:'C1',evidenceId:original.id});
 const restarted=createExecutionStore(root);
 assert.deepEqual(await restarted.readRound(round.requirementId,round.id),deleted);
 const frozen=await restarted.getJob(round.requirementId,round.id,queued.job.id);
 assert.deepEqual(frozen.snapshot,queued.job.snapshot);
 assert.deepEqual(frozen.snapshot.cases[0].evidence,[original]);
 const retained=await restarted.absoluteEvidence(frozen.snapshot,{currentOnly:true});
 assert.equal(retained.length,1);assert.deepEqual(await readFile(retained[0].path),png);
 assert.deepEqual(await restarted.absoluteEvidence(deleted,{currentOnly:true}),[]);
 const publications=[];
 const jobs=createReportJobs(restarted,{ai:ai(),publisher:async input=>{publications.push(input);for(const e of input.evidence)assert.deepEqual(await readFile(e.path),png);return {documentId:'DOC',url:'https://example.feishu.cn/docx/DOC',directory:{status:'verified'}};}});
 await jobs.run(round.requirementId,round.id,queued.job.id);
 assert.equal((await restarted.getJob(round.requirementId,round.id,queued.job.id)).status,'published');
 assert.equal(publications[0].evidence[0].id,original.id);
 assert.equal(publications[0].evidence[0].caption,original.caption);
 assert.equal(publications[0].evidence[0].attemptId,original.attemptId);
 assert.match(publications[0].markdown,new RegExp('evidence:'+original.id));
 assert.match(publications[0].markdown,/删除前冻结的原始图注/);
 const current=await restarted.readRound(round.requirementId,round.id);
 const fresh=await restarted.queueReport({...command(current),mode:'publish'});
 assert.deepEqual(fresh.job.snapshot.cases[0].evidence,[]);
 await jobs.run(round.requirementId,round.id,fresh.job.id);
 assert.equal((await restarted.getJob(round.requirementId,round.id,fresh.job.id)).status,'published');
 assert.deepEqual(publications[1].evidence,[]);
 assert.doesNotMatch(publications[1].markdown,new RegExp('evidence:'+original.id));
 assert.doesNotMatch(publications[1].markdown,/删除前冻结的原始图注/);
 assert.deepEqual((await restarted.getJob(round.requirementId,round.id,queued.job.id)).snapshot,frozen.snapshot);
 assert.deepEqual(await readFile(retained[0].path),png);
});

test('recover restores orphaned document checkpoint and blocks a second creation',async t=>{
 const {store,round}=await fixture(t);
 const queued=await store.queueReport({...command(round),mode:'publish'});
 // Model the real two-file commit crash: job JSON advanced before round JSON.
 await store.writeJob(round.requirementId,round.id,queued.job.id,j=>{j.status='publishing';j.publicationCheckpoint={documentId:'KNOWN-DOC',url:'https://example.feishu.cn/docx/KNOWN-DOC',pending:{operation:'readback',jobId:j.id}};});
 assert.equal((await store.readRound(round.requirementId,round.id)).publication,null);
 await store.recover();
 const recovered=await store.readRound(round.requirementId,round.id);
 assert.equal(recovered.reportJobs[0].status,'unknown');
 assert.equal(recovered.publication?.documentId,'KNOWN-DOC');
 await assert.rejects(store.queueReport({...command(recovered),mode:'publish'}),error=>error.status===409);
});

test('recover installs unknown sentinel even when crash preceded document identity return',async t=>{
 const {store,round}=await fixture(t);
 const queued=await store.queueReport({...command(round),mode:'publish'});
 await store.writeJob(round.requirementId,round.id,queued.job.id,j=>{j.status='publishing';j.publicationCheckpoint={pending:{operation:'create',jobId:j.id}};});
 await store.recover();
 const recovered=await store.readRound(round.requirementId,round.id);
 assert.ok(recovered.publication?.pending||recovered.publication?.state==='unknown');
 await assert.rejects(store.queueReport({...command(recovered),mode:'publish'}),error=>error.status===409);
});

test('retry reservation excludes a concurrent new report in the same round transaction',async t=>{
 const {store,round}=await fixture(t);
 const queued=await store.queueReport({...command(round),mode:'publish'});
 await store.writeJob(round.requirementId,round.id,queued.job.id,j=>{j.status='failed';j.retryable=true;});
 const before=await store.readRound(round.requirementId,round.id);
 const results=await Promise.allSettled([
  store.reserveRetry({...command(before),jobId:queued.job.id}),
  store.queueReport({...command(before),mode:'publish'}),
 ]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
 const after=await store.readRound(round.requirementId,round.id);
 assert.equal(after.reportJobs.filter(j=>['queued','generating','publishing'].includes(j.status)).length,1);
});

test('new known document id on a failed adapter checkpoint is rescued from the exception',async t=>{
 const {store,round}=await fixture(t);
 const queued=await store.queueReport({...command(round),mode:'publish'});
 const jobs=createReportJobs(store,{ai:ai(),publisher:async()=>{throw Object.assign(new Error('checkpoint temporarily unavailable'),{code:'CHECKPOINT_FAILED',publication:{documentId:'RESCUED',url:'https://example.feishu.cn/docx/RESCUED',pending:{operation:'readback'}}});}});
 await jobs.run(round.requirementId,round.id,queued.job.id);
 const after=await store.readRound(round.requirementId,round.id);
 assert.equal(after.publication.documentId,'RESCUED');
 assert.equal(after.reportJobs[0].status,'unknown');
 assert.equal(after.reportJobs[0].retryable,false);
 assert.equal((await store.getJob(round.requirementId,round.id,queued.job.id)).publicationCheckpoint.documentId,'RESCUED');
});

test('reconciliation reservation is exclusive and crash recovery keeps unknown intent',async t=>{
 const {store,round}=await fixture(t);const queued=await store.queueReport({...command(round),mode:'publish'});
 await store.writeJob(round.requirementId,round.id,queued.job.id,(j,r)=>{j.status='unknown';j.markdown='# 原冻结内容';r.publication={state:'unknown',pending:{operation:'create',jobId:j.id,sourceHash:'frozen'}};j.publicationCheckpoint=structuredClone(r.publication);});
 const current=await store.readRound(round.requirementId,round.id);const data={...command(current),jobId:queued.job.id};
 const attempts=await Promise.allSettled([store.reserveReconciliation(data),store.reserveReconciliation(data)]);assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
 await assert.rejects(store.queueReport({...command(current),mode:'publish'}),e=>e.status===409);
 await store.recover();const recovered=await store.readRound(round.requirementId,round.id);assert.equal(recovered.reportJobs[0].status,'unknown');assert.equal(recovered.publication.pending.jobId,queued.job.id);
});

test('verified reconciliation resumes original Markdown without AI regeneration and clears unknown state',async t=>{
 const {store,round}=await fixture(t);const queued=await store.queueReport({...command(round),mode:'publish'});
 await store.writeJob(round.requirementId,round.id,queued.job.id,(j,r)=>{j.status='unknown';j.markdown='# 原快照，不重新生成';r.publication={state:'unknown',pending:{operation:'create',jobId:j.id}};});
 let called=0;const jobs=createReportJobs(store,{ai:{available:()=>{throw new Error('AI must not be called');}},reconciler:async(input,deps)=>{called++;assert.equal(input.markdown,'# 原快照，不重新生成');assert.equal(input.documentURL,'https://example.feishu.cn/docx/KNOWN');const result={state:'verified',pending:null,documentId:'KNOWN',url:input.documentURL,directory:{status:'verified'}};await deps.checkpoint(result);return result;}});
 await jobs.reconcile({...command(await store.readRound(round.requirementId,round.id)),jobId:queued.job.id,documentURL:'https://example.feishu.cn/docx/KNOWN'});await jobs.run(round.requirementId,round.id,queued.job.id);
 const saved=await store.getJob(round.requirementId,round.id,queued.job.id);assert.equal(called,1);assert.equal(saved.status,'published');assert.equal(saved.unknownOutcome,false);assert.equal(saved.error,'');const current=await store.readRound(round.requirementId,round.id);assert.equal(current.publication.state,'verified');await store.queueReport({...command(current),mode:'publish'});
});

test('failed recovery remains unknown and stores only allowlisted diagnostics',async t=>{
 const {store,round}=await fixture(t);const queued=await store.queueReport({...command(round),mode:'publish'});
 await store.writeJob(round.requirementId,round.id,queued.job.id,(j,r)=>{j.status='unknown';j.markdown='# 原冻结内容';r.publication={state:'unknown',pending:{operation:'create',jobId:j.id}};});
 const jobs=createReportJobs(store,{reconciler:async()=>{throw Object.assign(new Error('核对内容不一致'),{code:'RECONCILIATION_CONTENT_MISMATCH',causeCode:'CLI_REJECTED',stage:'docs_fetch',secret:'DO_NOT_STORE'});}});
 await jobs.reconcile({...command(await store.readRound(round.requirementId,round.id)),jobId:queued.job.id,documentURL:'https://example.feishu.cn/docx/KNOWN'});await jobs.run(round.requirementId,round.id,queued.job.id);
 const saved=await store.getJob(round.requirementId,round.id,queued.job.id);assert.equal(saved.status,'unknown');assert.equal(saved.retryable,false);assert.deepEqual(saved.errorDetails,{stage:'docs_fetch',causeCode:'CLI_REJECTED'});assert.equal(JSON.stringify(saved).includes('DO_NOT_STORE'),false);
});

test('unchanged saved generation can resume publishing when the AI service is unavailable',async t=>{
 const {store,round}=await fixture(t);
 const queued=await store.queueReport({...command(round),mode:'publish'});
 await store.writeJob(round.requirementId,round.id,queued.job.id,j=>{j.markdown='# 已保存报告\n\n快照内容';j.generation={method:'ai_summary_with_source_ledger',model:'previous'};j.status='failed';j.retryable=true;});
 let received;
 const jobs=createReportJobs(store,{ai:{available:()=>false},publisher:async input=>{received=input;return {documentId:'DOC',url:'https://example.feishu.cn/docx/DOC',directory:{status:'pending'}};}});
 await jobs.run(round.requirementId,round.id,queued.job.id);
 assert.equal(received.markdown,'# 已保存报告\n\n快照内容');
 const job=await store.getJob(round.requirementId,round.id,queued.job.id);
 assert.equal(job.status,'published');assert.equal(job.directoryStatus,'pending');
 assert.equal(job.generation.model,'previous');
});
