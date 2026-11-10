import {renderReport,fault} from './core.js';
import {publishReport,publicationDiagnostics} from './report-publisher.js';
import {reconcileReport,reportDocumentId} from './report-recovery.js';

export function createReportJobs(store,{ai,publisher=publishReport,reconciler=reconcileReport,publisherConfig={},onError=()=>{}}={}){
 const running=new Map();
 async function run(req,rid,jid,recovery){const key=req+rid+jid;if(running.has(key))return running.get(key);const task=execute(req,rid,jid,recovery).catch(onError).finally(()=>running.delete(key));running.set(key,task);return task;}
 async function execute(req,rid,jid,recovery){const job=await store.getJob(req,rid,jid);try{
  await store.writeJob(req,rid,jid,j=>{j.status=recovery?'reconciling':'generating';j.retryable=false;});
  let markdown=job.markdown;
  if(typeof markdown!=='string'||!markdown.trim()){
   if(recovery)throw fault('缺少原报告内容，不能重新生成后核对旧发布',409);
   let generated={summary:''};
   const modelAvailable=Boolean(ai?.available());
   if(modelAvailable)generated=await ai.report(job.snapshot);
   else if(job.mode==='publish')throw fault('AI 模型服务不可用；已保存快照，可先生成本地预览，模型就绪后重试',503);
   markdown=renderReport(job.snapshot,generated);
   await store.writeJob(req,rid,jid,j=>{j.markdown=markdown;j.generation={method:modelAvailable?'ai_summary_with_source_ledger':'source_ledger',model:generated.model};});
  }
  if(job.mode==='preview'){
   await store.writeJob(req,rid,jid,j=>{j.status='preview_ready';j.retryable=false;});return;
  }
  const evidence=await store.absoluteEvidence(job.snapshot,{currentOnly:true});
  const current=await store.readRound(req,rid);
  await store.writeJob(req,rid,jid,j=>{j.status=recovery?'reconciling':'publishing';});
  const publication=await (recovery?reconciler:publisher)({snapshot:job.snapshot,markdown,title:job.snapshot.title+'｜测试报告',publication:current.publication,jobId:jid,evidence,...(recovery?{documentURL:recovery.documentURL}:{})},{config:{...publisherConfig,cwd:store.root},checkpoint:async next=>{
   await store.writeJob(req,rid,jid,(j,r)=>{r.publication=next;j.publicationCheckpoint=next;});
  }});
  await store.writeJob(req,rid,jid,(j,r)=>{r.publication={...publication,snapshotRevision:job.snapshotRevision,updatedAt:new Date().toISOString()};j.status='published';j.url=publication.url;j.directoryStatus=publication.directory?.status;j.retryable=false;j.unknownOutcome=false;j.error='';delete j.errorCode;delete j.errorDetails;j.publishedAt=new Date().toISOString();});
 }catch(error){
  await store.writeJob(req,rid,jid,(j,r)=>{
   if(error.publication&&(error.publication.documentId||error.publication.pending)){
    r.publication=structuredClone(error.publication);j.publicationCheckpoint=structuredClone(error.publication);
   }
   const unknown=['RECONCILIATION_REQUIRED','CREATE_OUTCOME_UNKNOWN','UPDATE_OUTCOME_UNKNOWN','CREATE_STATUS_UNKNOWN','UPDATE_STATUS_UNKNOWN'].includes(error.code)||Boolean(r.publication?.pending)||['create_intent','unknown'].includes(r.publication?.state);
   j.status=unknown?'unknown':error.code==='CONTENT_CONFLICT'?'conflict':'failed';j.error=error.message;j.errorCode=error.code;j.errorDetails=publicationDiagnostics({...error.diagnostics,...error});j.retryable=!unknown&&j.status!=='conflict';
   if(unknown){j.unknownOutcome=true;if(r.publication)r.publication.state='unknown';}
  });
 }}
 async function retry(data){
  await store.reserveRetry(data);void run(data.requirementId,data.roundId,data.jobId);
  return {round:await store.readRound(data.requirementId,data.roundId),job:await store.getJob(data.requirementId,data.roundId,data.jobId)};
 }
 async function reconcile(data){
  reportDocumentId(data.documentURL);
  await store.reserveReconciliation(data);void run(data.requirementId,data.roundId,data.jobId,{documentURL:data.documentURL});
  return {round:await store.readRound(data.requirementId,data.roundId),job:await store.getJob(data.requirementId,data.roundId,data.jobId)};
 }
 return {run,retry,reconcile,running};
}
