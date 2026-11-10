import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,realpath,symlink,rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createExecutionStore,renderReport} from '../core.js';
import {createDispatcher} from '../index.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr1sAAAAASUVORK5CYII=','base64');
const file={bytes:png,name:'../../clipboard.png',mime:'image/png'};
const command=r=>({requirementId:r.requirementId,roundId:r.id,expectedRevision:r.revision});
const draftCommand=r=>({...command(r),caseId:'C1',attemptId:r.cases[0].execution.attemptId,draftId:'DRAFT-'+randomUUID(),expectedDraftRevision:1,caption:'Original pending caption',step:1});
const errorStatus=status=>error=>error.status===status;
async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'dsh-evidence-drafts-')));
 t.after(async()=>{const target=resolve(root);assert.ok(target.startsWith(resolve(await realpath(tmpdir()))+'/dsh-evidence-drafts-'));await rm(target,{recursive:true,force:true});});
 const dir=join(root,'.ai-test/work-items/REQ-DRAFT');await mkdir(join(dir,'requirements/v1'),{recursive:true});
 const path='.ai-test/work-items/REQ-DRAFT/requirements/v1/cases.json';
 const source=JSON.stringify({requirement_id:'REQ-DRAFT',cases:[{id:'C1',title:'Pending evidence isolation',steps:[{action:'Paste screenshot',expected:'Retained before final upload'},{action:'Upload',expected:'Final evidence exactly once'}]},{id:'C2',title:'Other case',steps:[{action:'Open',expected:'Visible'}]}]});
 await writeFile(join(root,path),source);
 await writeFile(join(dir,'manifest.json'),JSON.stringify({requirement_id:'REQ-DRAFT',title:'Draft fixture'}));
 await writeFile(join(dir,'artifacts.json'),JSON.stringify({requirement_id:'REQ-DRAFT',artifacts:[{artifact_id:'CASES',artifact_type:'test_case_review_draft',path,sha256:createHash('sha256').update(source).digest('hex'),status:'review_pending'}]}));
 const s=createExecutionStore(root),r=await s.createRound({requirementId:'REQ-DRAFT',sourceVersion:'v1',idempotencyKey:'isolated-round'});
 const roundDir=join(dir,'execution-workbench/rounds',r.id),draftDir=join(roundDir,'evidence-drafts');
 return {s,r,root,roundDir,draftDir,manifest:join(draftDir,'manifest.json')};
}
const post=(path,data)=>new Request('http://fixture/api/test-workbench'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
const get=path=>new Request('http://fixture/api/test-workbench'+path);
function multipart(d,media=file){const form=new FormData();for(const [k,v] of Object.entries(d))if(k!=='expectedRevision'&&v!==undefined)form.set(k,v==null?'':String(v));form.set('file',new Blob([media.bytes],{type:media.mime}),media.name);return new Request('http://fixture/api/test-workbench/evidence-draft',{method:'POST',body:form});}

test('paste bytes and caption survive a new store; pending drafts do not change round or reports',async t=>{
 const {s,r,root,roundDir,draftDir}=await fixture(t),d=draftCommand(r),before=await readFile(join(roundDir,'round.json'),'utf8');
 const saved=await s.saveEvidenceDraft(d,file);assert.equal(saved.id,d.draftId);assert.equal(saved.draftId,d.draftId);assert.equal(saved.caseId,'C1');assert.equal(saved.attemptId,d.attemptId);assert.equal(saved.path,undefined);assert.equal(saved.file,undefined);
 const restarted=createExecutionStore(root);await restarted.recover();const listed=await restarted.listEvidenceDrafts(r.requirementId,r.id);assert.equal(listed.length,1);assert.equal(listed[0].caption,d.caption);assert.deepEqual((await restarted.evidenceDraft(r.requirementId,r.id,d.draftId)).bytes,png);
 const mediaFiles=await readdir(join(draftDir,'files'));assert.deepEqual(mediaFiles,[d.draftId+'.png']);assert.equal(await readFile(join(roundDir,'round.json'),'utf8'),before);
 const current=await restarted.readRound(r.requirementId,r.id);assert.deepEqual(current,r);assert.deepEqual(await restarted.absoluteEvidence(current),[]);assert.doesNotMatch(renderReport(current),/Original pending caption/);
 const queued=await restarted.queueReport({...command(r),mode:'preview'});assert.equal(queued.job.snapshot.cases[0].evidence.length,0);assert.doesNotMatch(renderReport(queued.job.snapshot),/Original pending caption/);
});

test('durable draft positions preserve input order when create completion is reversed',async t=>{
 const {s,r,root}=await fixture(t),second={...draftCommand(r),position:2},first={...draftCommand(r),position:1};
 const savedSecond=await s.saveEvidenceDraft(second,file);assert.equal(savedSecond.position,2);const savedFirst=await s.saveEvidenceDraft(first,file);assert.equal(savedFirst.position,1);
 const restarted=createExecutionStore(root),listed=await restarted.listEvidenceDrafts(r.requirementId,r.id);assert.deepEqual(listed.map(d=>d.id),[first.draftId,second.draftId]);assert.deepEqual(listed.map(d=>d.position),[1,2]);
 const retry=await restarted.saveEvidenceDraft({...first,position:99},file);assert.equal(retry.position,1);assert.equal(retry.revision,1);assert.deepEqual((await restarted.listEvidenceDrafts(r.requirementId,r.id)).map(d=>d.id),[first.draftId,second.draftId]);
 for(const position of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'',true,'not-a-number'])await assert.rejects(s.saveEvidenceDraft({...draftCommand(r),position},file),/顺序/);
 const defaultPosition=await s.saveEvidenceDraft(draftCommand(r),file);assert.ok(Number.isSafeInteger(defaultPosition.position)&&defaultPosition.position>0);
 const dispatch=createDispatcher(s),multipartResult=await dispatch(multipart({...draftCommand(r),position:3}));assert.equal(multipartResult.status,200);assert.equal((await multipartResult.json()).draft.position,3);
});

test('caption autosave and optional step persist without round revision or timestamp updates',async t=>{
 const {s,r,root,roundDir}=await fixture(t),d=draftCommand(r);await s.saveEvidenceDraft(d,file);const before=await readFile(join(roundDir,'round.json'),'utf8');
 let edited=await s.evidenceDraftMeta({requirementId:r.requirementId,roundId:r.id,draftId:d.draftId,expectedDraftRevision:1,caption:' Edited caption '});assert.equal(edited.caption,'Edited caption');assert.equal(edited.step,1);
 edited=await s.evidenceDraftMeta({requirementId:r.requirementId,roundId:r.id,draftId:d.draftId,expectedDraftRevision:2,caption:'Second caption',step:2});assert.equal(edited.step,2);
 const restarted=createExecutionStore(root);assert.equal((await restarted.listEvidenceDrafts(r.requirementId,r.id))[0].caption,'Second caption');assert.equal(await readFile(join(roundDir,'round.json'),'utf8'),before);
 const retry=await restarted.saveEvidenceDraft(d,file);assert.equal(retry.caption,'Second caption');assert.equal(retry.step,2);assert.equal((await restarted.listEvidenceDrafts(r.requirementId,r.id)).length,1);
});

test('draft caption and step compare-and-swap rejects stale tabs and survives remount without overwrites',async t=>{
 const {s,r,root,roundDir}=await fixture(t),d=draftCommand(r),dispatch=createDispatcher(s);const saved=await s.saveEvidenceDraft(d,file);assert.equal(saved.revision,1);const before=await readFile(join(roundDir,'round.json'),'utf8');
 for(const invalid of [undefined,null,'1',0,-1,1.5]){const result=await dispatch(post('/evidence-draft-meta',{...d,expectedDraftRevision:invalid,caption:'Invalid revision'}));assert.equal(result.status,400);}
 const confirmed=await s.evidenceDraftMeta({...d,caption:'New confirmed caption',step:2});assert.equal(confirmed.revision,2);
 const restarted=createExecutionStore(root),stale=await createDispatcher(restarted)(post('/evidence-draft-meta',{...d,caption:'Older inflight caption',step:1}));assert.equal(stale.status,409);const conflict=await stale.json();assert.equal(conflict.draftRevision,2);assert.equal(conflict.currentDraft.revision,2);assert.equal(conflict.currentDraft.caption,'New confirmed caption');assert.equal(conflict.currentDraft.step,2);assert.equal(conflict.currentDraft.file,undefined);
 const restored=(await restarted.listEvidenceDrafts(r.requirementId,r.id))[0];assert.equal(restored.revision,2);assert.equal(restored.caption,'New confirmed caption');
 const results=await Promise.allSettled([restarted.evidenceDraftMeta({...d,expectedDraftRevision:2,caption:'Tab A',step:2}),restarted.evidenceDraftMeta({...d,expectedDraftRevision:2,caption:'Tab B',step:1})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);const rejected=results.find(x=>x.status==='rejected').reason;assert.equal(rejected.status,409);assert.equal(rejected.draftRevision,3);assert.equal(rejected.currentDraft.revision,3);
 const current=(await restarted.listEvidenceDrafts(r.requirementId,r.id))[0];assert.equal(current.caption,'Tab A');assert.equal(current.step,2);assert.equal(current.revision,3);assert.equal(await readFile(join(roundDir,'round.json'),'utf8'),before);
});

test('final upload rejects changed draft metadata but existing receipt ignores stale draft revision',async t=>{
 const {s,r}=await fixture(t),d=draftCommand(r),dispatch=createDispatcher(s);await s.saveEvidenceDraft(d,file);await s.evidenceDraftMeta({...d,caption:'Other tab confirmed caption',step:2});
 const stale=await dispatch(post('/evidence-draft-upload',{...command(r),draftId:d.draftId,expectedDraftRevision:1,caption:'Old tab final caption'}));assert.equal(stale.status,409);const conflict=await stale.json();assert.equal(conflict.draftRevision,2);assert.equal(conflict.currentDraft.caption,'Other tab confirmed caption');assert.equal(conflict.currentDraft.step,2);assert.deepEqual(await s.readRound(r.requirementId,r.id),r);
 const finalized=await dispatch(post('/evidence-draft-upload',{...command(r),draftId:d.draftId,expectedDraftRevision:2}));assert.equal(finalized.status,200);const round=(await finalized.json()).round;assert.equal(round.cases[0].evidence[0].caption,'Other tab confirmed caption');assert.equal(round.cases[0].evidence[0].step,2);
 const retry=await dispatch(post('/evidence-draft-upload',{...command(r),draftId:d.draftId,expectedDraftRevision:1,caption:'Stale retry caption'}));assert.equal(retry.status,200);assert.deepEqual((await retry.json()).round,round);assert.equal(round.cases[0].evidence.length,1);
});

test('case result save rejects an old attempt even with the latest round revision',async t=>{
 const {s,r}=await fixture(t),oldAttempt=r.cases[0].execution.attemptId,next=await s.newAttempt({...command(r),caseId:'C1'}),dispatch=createDispatcher(s);
 const data={...command(next),caseId:'C1',attemptId:oldAttempt,status:'passed',actual:'Stale old attempt input',executor:'manual'};
 await assert.rejects(s.updateCase(data),errorStatus(409));assert.deepEqual(await s.readRound(r.requirementId,r.id),next);
 const stale=await dispatch(post('/case',data));assert.equal(stale.status,409);assert.equal((await stale.json()).revision,next.revision);
 const missing=await dispatch(post('/case',{...data,attemptId:undefined}));assert.equal(missing.status,400);
 const valid=await dispatch(post('/case',{...data,attemptId:next.cases[0].execution.attemptId,actual:'Current attempt input'}));assert.equal(valid.status,200);const current=(await valid.json()).round;assert.equal(current.cases[0].execution.actual,'Current attempt input');assert.equal(current.cases[0].attempts[0].attemptId,oldAttempt);assert.equal(current.cases[0].attempts[0].status,'not_started');
});

test('draft binding is immutable and creation checks current attempt and step',async t=>{
 const {s,r}=await fixture(t),d=draftCommand(r);await s.saveEvidenceDraft(d,file);
 await assert.rejects(s.saveEvidenceDraft({...d,caseId:'C2'},file),errorStatus(409));
 await assert.rejects(s.saveEvidenceDraft({...d,attemptId:'ATT-other'},file),errorStatus(409));
 await assert.rejects(s.saveEvidenceDraft(d,{...file,bytes:Buffer.concat([png,Buffer.from('different')])}),errorStatus(409));
 await assert.rejects(s.evidenceDraftMeta({...d,caseId:'C2',caption:'Rebind'}),errorStatus(409));
 await assert.rejects(s.evidenceDraftMeta({...d,attemptId:'ATT-other',caption:'Rebind'}),errorStatus(409));
 await assert.rejects(s.saveEvidenceDraft({...d,draftId:'DRAFT-'+randomUUID(),attemptId:'ATT-other'},file),errorStatus(409));
 await assert.rejects(s.saveEvidenceDraft({...d,draftId:'DRAFT-'+randomUUID(),step:3},file),/步骤/);
 await assert.rejects(s.evidenceDraftMeta({...d,caption:'Bad step',step:0}),/步骤/);
 assert.equal((await s.listEvidenceDrafts(r.requirementId,r.id))[0].caption,d.caption);
});

test('status changes and new attempts preserve pending drafts; stale final upload cannot rebind',async t=>{
 const {s,r}=await fixture(t),d=draftCommand(r);await s.saveEvidenceDraft(d,file);
 const passed=await s.updateCase({...command(r),caseId:'C1',status:'passed',actual:'',executor:'manual'});
 assert.equal((await s.listEvidenceDrafts(r.requirementId,r.id))[0].attemptId,d.attemptId);
 const next=await s.newAttempt({...command(passed),caseId:'C1'});
 await s.evidenceDraftMeta({...d,caption:'Old attempt retained'});
 await assert.rejects(s.uploadEvidenceDraft({...command(next),draftId:d.draftId}),errorStatus(409));
 assert.equal((await s.listEvidenceDrafts(r.requirementId,r.id))[0].caption,'Old attempt retained');assert.equal((await s.readRound(r.requirementId,r.id)).revision,next.revision);
 const removed=await s.remove({...command(next),caseId:'C1',reason:'Excluded temporarily'});
 await s.evidenceDraftMeta({...d,expectedDraftRevision:2,caption:'Still retained after removal'});assert.equal((await s.readRound(r.requirementId,r.id)).revision,removed.revision);
});

test('draft removal archives metadata, retains recoverable media, never changes round',async t=>{
 const {s,r,root,manifest,roundDir}=await fixture(t),d=draftCommand(r);await s.saveEvidenceDraft(d,file);const before=await readFile(join(roundDir,'round.json'),'utf8');
 assert.deepEqual(await s.removeEvidenceDraft(d),{ok:true});assert.deepEqual(await s.removeEvidenceDraft(d),{ok:true});
 assert.deepEqual(await createExecutionStore(root).listEvidenceDrafts(r.requirementId,r.id),[]);assert.deepEqual((await s.evidenceDraft(r.requirementId,r.id,d.draftId)).bytes,png);
 const m=JSON.parse(await readFile(manifest,'utf8'));assert.ok(m.drafts[0].archivedAt);assert.equal(await readFile(join(roundDir,'round.json'),'utf8'),before);
 await assert.rejects(s.uploadEvidenceDraft({...command(r),draftId:d.draftId}),errorStatus(409));
});

test('final upload copies latest metadata, binds sourceDraftId once and preserves report snapshots',async t=>{
 const {s,r}=await fixture(t),d=draftCommand(r);await s.saveEvidenceDraft(d,file);await s.evidenceDraftMeta({...d,caption:'Final visible result',step:2});
 const queued=await s.queueReport({...command(r),mode:'preview'});
 const final=await s.uploadEvidenceDraft({...command(queued.round),draftId:d.draftId});const e=final.cases[0].evidence[0];
 assert.equal(final.revision,r.revision+1);assert.equal(final.cases[0].execution.status,'not_started');assert.equal(e.caption,'Final visible result');assert.equal(e.step,2);assert.equal(e.sourceDraftId,d.draftId);assert.equal(e.attemptId,d.attemptId);
 assert.equal(final.cases[0].history.filter(h=>h.event==='evidence_added').length,1);assert.deepEqual((await s.evidence(r.requirementId,r.id,e.id)).bytes,png);assert.deepEqual((await s.evidenceDraft(r.requirementId,r.id,d.draftId)).bytes,png);
 assert.deepEqual(await s.listEvidenceDrafts(r.requirementId,r.id),[]);assert.match(renderReport(final),/Final visible result/);assert.doesNotMatch(renderReport((await s.getJob(r.requirementId,r.id,queued.job.id)).snapshot),/Final visible result/);
});

test('blank pending caption finalizes with factual scene label; explicit final caption is supported',async t=>{
 const {s,r}=await fixture(t),d={...draftCommand(r),caption:''};const dispatch=createDispatcher(s);
 await s.saveEvidenceDraft(d,file);assert.equal((await s.listEvidenceDrafts(r.requirementId,r.id))[0].caption,'');
 const final=await s.uploadEvidenceDraft({...command(r),draftId:d.draftId});assert.equal(final.cases[0].evidence[0].caption,'Pending evidence isolation · 步骤1：Paste screenshot');assert.equal(final.cases[0].execution.status,'not_started');
 const second={...draftCommand(final),caption:'',step:null};await s.saveEvidenceDraft(second,file);
 const result=await dispatch(post('/evidence-draft-upload',{...command(final),draftId:second.draftId,caption:'Custom factual scene caption'}));assert.equal(result.status,200);const secondRound=(await result.json()).round;assert.equal(secondRound.cases[0].evidence[1].caption,'Custom factual scene caption');
 const retry=await s.uploadEvidenceDraft({...command(final),draftId:second.draftId,caption:'Different retry caption'});assert.equal(retry.cases[0].evidence[1].caption,'Custom factual scene caption');
 const third={...draftCommand(retry),caption:'',step:null};await s.saveEvidenceDraft(third,file);const thirdRound=await s.uploadEvidenceDraft({...command(retry),draftId:third.draftId});assert.equal(thirdRound.cases[0].evidence[2].caption,'Pending evidence isolation');
});

test('lost HTTP upload response retries with old revision after restart without duplicate evidence',async t=>{
 const {s,r,root}=await fixture(t),d=draftCommand(r),dispatch=createDispatcher(s);assert.equal((await dispatch(multipart(d))).status,200);
 const data={...command(r),draftId:d.draftId};const lost=await dispatch(post('/evidence-draft-upload',data));assert.equal(lost.status,200); // Deliberately discard response body.
 const restarted=createExecutionStore(root),retry=await createDispatcher(restarted)(post('/evidence-draft-upload',data));assert.equal(retry.status,200);const round=(await retry.json()).round;
 assert.equal(round.revision,r.revision+1);assert.equal(round.cases[0].evidence.length,1);assert.equal(round.cases[0].evidence[0].sourceDraftId,d.draftId);
 const next=await restarted.newAttempt({...command(round),caseId:'C1'});await restarted.removeEvidenceDraft(data);
 const lateRetry=await restarted.uploadEvidenceDraft(data);assert.equal(lateRetry.revision,next.revision);assert.equal(lateRetry.cases[0].evidence.length,1);
});

test('round receipt recovers crash between round commit and draft manifest completion',async t=>{
 const {s,r,root,manifest}=await fixture(t),d=draftCommand(r);await s.saveEvidenceDraft(d,file);const pendingManifest=await readFile(manifest,'utf8');
 const final=await s.uploadEvidenceDraft({...command(r),draftId:d.draftId});await writeFile(manifest,pendingManifest); // Crash fixture: only durable round commit survived.
 const restarted=createExecutionStore(root);assert.deepEqual(await restarted.listEvidenceDrafts(r.requirementId,r.id),[]);
 const retry=await restarted.uploadEvidenceDraft({...command(r),draftId:d.draftId});assert.equal(retry.revision,final.revision);assert.equal(retry.cases[0].evidence.length,1);
 await assert.rejects(restarted.evidenceDraftMeta({...d,caption:'Cannot edit final via draft'}),errorStatus(409));
});

test('stale revision leaves pending file untouched; concurrent uploads cannot duplicate',async t=>{
 const {s,r,root}=await fixture(t),d=draftCommand(r);await s.saveEvidenceDraft(d,file);
 const changed=await s.updateCase({...command(r),caseId:'C1',status:'in_progress',executor:'manual'});
 await assert.rejects(s.uploadEvidenceDraft({...command(r),draftId:d.draftId}),e=>e.status===409&&e.revision===changed.revision);
 assert.equal((await s.listEvidenceDrafts(r.requirementId,r.id)).length,1);
 const results=await Promise.all([s.uploadEvidenceDraft({...command(changed),draftId:d.draftId}),s.uploadEvidenceDraft({...command(changed),draftId:d.draftId})]);assert.equal(results[0].revision,results[1].revision);assert.equal(results[1].cases[0].evidence.length,1);
 const d2={...draftCommand(results[1]),draftId:'DRAFT-'+randomUUID()};await s.saveEvidenceDraft(d2,file);
 const second=createExecutionStore(root),parallel=await Promise.allSettled([s.uploadEvidenceDraft({...command(results[1]),draftId:d2.draftId}),second.uploadEvidenceDraft({...command(results[1]),draftId:d2.draftId})]);
 for(const result of parallel)if(result.status==='rejected')assert.equal(result.reason.status,409);
 const read=await s.readRound(r.requirementId,r.id);assert.equal(read.cases[0].evidence.length,2);assert.equal((await second.uploadEvidenceDraft({...command(results[1]),draftId:d2.draftId})).revision,read.revision);
});

test('MIME, size, IDs, manifest identity and checksum reject unsafe pending media',async t=>{
 const {s,r,draftDir,manifest}=await fixture(t),d=draftCommand(r);
 await assert.rejects(s.saveEvidenceDraft({...d,draftId:'../../escape'},file),/标识/);
 await assert.rejects(s.saveEvidenceDraft(d,{...file,mime:'image/jpeg'}),/文件头/);
 await assert.rejects(s.saveEvidenceDraft(d,{...file,bytes:Buffer.concat([png,Buffer.alloc(16_000_001)])}),errorStatus(413));
 await s.saveEvidenceDraft(d,file);const original=await readFile(manifest,'utf8'),m=JSON.parse(original);m.requirementId='OTHER';await writeFile(manifest,JSON.stringify(m));await assert.rejects(s.listEvidenceDrafts(r.requirementId,r.id),/身份/);await writeFile(manifest,original);
 await writeFile(join(draftDir,'files',d.draftId+'.png'),Buffer.concat([png,Buffer.from('tamper')]));await assert.rejects(s.evidenceDraft(r.requirementId,r.id,d.draftId),/摘要/);await assert.rejects(s.uploadEvidenceDraft({...command(r),draftId:d.draftId}),/摘要/);assert.equal((await s.readRound(r.requirementId,r.id)).revision,r.revision);
});

test('symlinked draft directory, media and manifest are rejected without external writes',async t=>{
 const {s,r,root,draftDir,manifest}=await fixture(t),d=draftCommand(r);const outside=join(root,'unrelated');await mkdir(outside);
 await symlink(outside,draftDir);await assert.rejects(s.saveEvidenceDraft(d,file),/路径/);assert.deepEqual(await readdir(outside),[]);
 const moved=join(root,'draft-link');assert.equal(resolve(draftDir),join(root,'.ai-test/work-items',r.requirementId,'execution-workbench/rounds',r.id,'evidence-drafts'));await rename(draftDir,moved);
 await s.saveEvidenceDraft(d,file);const media=join(draftDir,'files',d.draftId+'.png'),otherMedia=join(outside,'original.png');await rename(media,otherMedia);await symlink(otherMedia,media);await assert.rejects(s.evidenceDraft(r.requirementId,r.id,d.draftId),/路径/);
 const otherManifest=join(outside,'manifest.json');await rename(manifest,otherManifest);await symlink(otherManifest,manifest);await assert.rejects(s.listEvidenceDrafts(r.requirementId,r.id),/路径/);
});

test('orphan draft media from interrupted save can be recovered by same ID and bytes',async t=>{
 const {s,r,manifest}=await fixture(t),d=draftCommand(r);await s.saveEvidenceDraft(d,file);const m=JSON.parse(await readFile(manifest,'utf8'));m.drafts=[];await writeFile(manifest,JSON.stringify(m));
 const recovered=await s.saveEvidenceDraft(d,file);assert.equal(recovered.id,d.draftId);assert.equal((await s.listEvidenceDrafts(r.requirementId,r.id)).length,1);
});

test('dispatcher exposes draft contract and private media; legacy req JSON alias is rejected',async t=>{
 const {s,r}=await fixture(t),d=draftCommand(r),dispatch=createDispatcher(s);assert.equal((await (await dispatch(get('/health'))).json()).capabilities.evidenceDrafts,true);
 const saved=await dispatch(multipart(d));assert.equal(saved.status,200);const draft=(await saved.json()).draft;
 const list=await dispatch(get('/evidence-drafts?id='+r.requirementId+'&round='+r.id));assert.equal((await list.json()).drafts[0].id,d.draftId);
 const media=await dispatch(new Request('http://fixture'+draft.mediaUrl));assert.equal(media.status,200);assert.equal(media.headers.get('cache-control'),'private, no-store');assert.equal(media.headers.get('x-content-type-options'),'nosniff');assert.match(media.headers.get('content-security-policy'),/sandbox/);assert.deepEqual(Buffer.from(await media.arrayBuffer()),png);
 const edit=await dispatch(post('/evidence-draft-meta',{requirementId:r.requirementId,roundId:r.id,draftId:d.draftId,expectedDraftRevision:1,caption:'Persisted API edit'}));assert.equal(edit.status,200);assert.equal((await edit.json()).draft.caption,'Persisted API edit');
 const alias=await dispatch(post('/evidence-draft-meta',{req:r.requirementId,roundId:r.id,draftId:d.draftId,expectedDraftRevision:2,caption:'Invalid alias'}));assert.equal(alias.status,400);
 const wrongOrigin=await dispatch(new Request('http://fixture/api/test-workbench/evidence-drafts?id='+r.requirementId+'&round='+r.id,{headers:{origin:'https://untrusted.invalid'}}));assert.equal(wrongOrigin.status,403);
 const wrongType=await dispatch(post('/evidence-draft',d));assert.equal(wrongType.status,415);
 const removed=await dispatch(post('/evidence-draft-remove',{requirementId:r.requirementId,roundId:r.id,draftId:d.draftId}));assert.deepEqual(await removed.json(),{ok:true});
});
