import {resolve} from 'node:path';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createExecutionStore,fault,VERSION} from './core.js';
import {createAiAdapter} from './ai.js';
import {createReportJobs} from './jobs.js';
export {Config} from './config.js';

const PREFIX='/api/test-workbench';
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
function guard(request){const url=new URL(request.url);if(!url.pathname.startsWith(PREFIX+'/'))throw fault('无效执行台路径',404);const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');let local=false;if(origin){const o=new URL(origin);local=o.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(o.hostname)&&site==='same-origin';if(o.origin!==url.origin&&!local)throw fault('拒绝跨站请求',403);}if(site&&!['same-origin','none'].includes(site)&&!local)throw fault('拒绝跨站请求',403);return url;}
async function body(request){if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))throw fault('需要 JSON 请求',415);const buf=await request.text();if(buf.length>2_000_000)throw fault('请求过大',413);try{return JSON.parse(buf);}catch{throw fault('JSON 请求无效');}}
export function createDispatcher(store,{ai,jobs,reportPublish=false}={}){return async request=>{try{
 const url=guard(request),part=url.pathname.slice(PREFIX.length);const req=url.searchParams.get('id'),rid=url.searchParams.get('round');
 if(request.method==='GET'){
  if(part==='/health')return response({version:VERSION,capabilities:{rounds:true,evidence:true,evidenceDrafts:true,partialReports:true,caseImport:true,reportPublish,reportReconcile:reportPublish,aiPlanning:Boolean(ai?.available()),aiReport:Boolean(ai?.available())}});
  if(part==='/sources')return response({items:await store.sources()});
  if(part==='/rounds')return response({rounds:await store.listRounds(req)});
  if(part==='/round')return response({round:await store.readRound(req,rid)});
  if(part==='/jobs'){const r=await store.readRound(req,rid);return response({jobs:r.reportJobs});}
  if(part==='/report'){const j=await store.getJob(req,rid,url.searchParams.get('job'));if(!j.markdown)throw fault('报告尚未生成',409);return new Response(j.markdown,{headers:{'content-type':'text/markdown; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});}
  if(part==='/evidence-drafts')return response({drafts:await store.listEvidenceDrafts(req,rid)});
   if(part==='/evidence-draft'){const e=await store.evidenceDraft(req,rid,url.searchParams.get('draft'));return new Response(e.bytes,{headers:{'content-type':e.mime,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-disposition':`${e.mime.startsWith('image/')||e.mime.startsWith('video/')?'inline':'attachment'}; filename="evidence-draft"`,'content-security-policy':"default-src 'none'; sandbox"}});}
   if(part==='/evidence'){const e=await store.evidence(req,rid,url.searchParams.get('evidence'));return new Response(e.bytes,{headers:{'content-type':e.mime,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-disposition':`${e.mime.startsWith('image/')||e.mime.startsWith('video/')?'inline':'attachment'}; filename="evidence"`,'content-security-policy':"default-src 'none'; sandbox"}});}
 }
 if(request.method==='POST'){
  if(part==='/evidence'||part==='/evidence-draft'){
   if(!/^multipart\/form-data;/i.test(request.headers.get('content-type')||''))throw fault('需要上传表单',415);
   const bytes=await request.arrayBuffer();if(bytes.byteLength>34_000_000)throw fault('上传过大',413);
   const form=await new Request(request.url,{method:'POST',headers:request.headers,body:bytes}).formData();
   const file=form.get('file');if(!file||typeof file==='string')throw fault('未选择文件');
   const data=Object.fromEntries(['requirementId','roundId','caseId','attemptId','caption','step','draftId','position'].map(k=>[k,form.get(k)]));
    if(part==='/evidence-draft')return response({draft:await store.saveEvidenceDraft(data,{bytes:await file.arrayBuffer(),name:file.name,mime:file.type})});
    data.expectedRevision=Number(form.get('expectedRevision'));
   return response({round:await store.addEvidence(data,{bytes:await file.arrayBuffer(),name:file.name,mime:file.type})});
  }
  const data=await body(request);
   if(part==='/evidence-draft-meta')return response({draft:await store.evidenceDraftMeta(data)});
   if(part==='/evidence-draft-remove')return response(await store.removeEvidenceDraft(data));
   if(part==='/evidence-draft-upload')return response({round:await store.uploadEvidenceDraft(data)});
  if(part==='/cases/import')return response({source:await store.importCases(data)},201);
  if(part==='/rounds'){
   let round=await store.createRound(data);
   if(ai?.available()&&round.plan.method==='rule_based'&&!round.cases.some(c=>c.execution.status!=='not_started'||c.removed)){
    try{round=await store.replan({requirementId:round.requirementId,roundId:round.id,expectedRevision:round.revision},r=>ai.plan(r));}
    catch(error){try{round=await store.mutate(round.requirementId,round.id,round.revision,r=>{r.plan.aiError='AI 初次编排未完成，保留可解释规则顺序；可稍后重试。';});}catch{round=await store.readRound(round.requirementId,round.id);}}
   }
   return response({round});
  }
  const ops={'/round-meta':store.metadata,'/case':store.updateCase,'/attempt':store.newAttempt,'/remove':store.remove,'/restore':store.restore,'/order':store.order,'/evidence-meta':store.evidenceMeta,'/evidence-remove':store.removeEvidence};
  if(part==='/case'&&(typeof data.attemptId!=='string'||!data.attemptId))throw fault('保存结果需要 attemptId');
   if(ops[part])return response({round:await ops[part](data)});
  if(part==='/replan')return response({round:await store.replan(data,ai?.available()?r=>ai.plan(r):null)});
  if(part==='/report'){if(data.mode==='publish'&&!reportPublish)throw fault('外部报告发布未配置；可先生成本地预览',503);if(!jobs)throw fault('报告服务未就绪',503);const result=await store.queueReport(data);void jobs.run(data.requirementId,data.roundId,result.job.id);return response({round:result.round,job:{...result.job,snapshot:undefined}},202);}
  if(part==='/report-retry'){if(!reportPublish&&(await store.getJob(data.requirementId,data.roundId,data.jobId)).mode==='publish')throw fault('外部报告发布未配置',503);if(!jobs)throw fault('报告服务未就绪',503);const result=await jobs.retry(data);return response({round:result.round,job:{...result.job,snapshot:undefined}},202);}
   if(part==='/report-reconcile'){if(!reportPublish)throw fault('外部报告发布未配置',503);if(!jobs)throw fault('报告服务未就绪',503);const result=await jobs.reconcile(data);return response({round:result.round,job:{...result.job,snapshot:undefined}},202);}
 }
 throw fault('未找到执行台接口',404);
 }catch(error){return response({error:error.message||'操作失败',revision:error.revision,draftRevision:error.draftRevision,currentDraft:error.currentDraft},error.status||400);}};}

export const inject=['connection','llm','agentDefaultModel'];
export function apply(ctx,config={}){const projectRoot=resolve(config.workspaceRoot||process.cwd()),store=createExecutionStore(projectRoot),ai=createAiAdapter(ctx),reportPublish=config.report?.enabled===true,jobs=createReportJobs(store,{ai,publisherConfig:{...config.report,cwd:projectRoot,maxEvidenceBytes:32_000_000}});const dispatch=createDispatcher(store,{ai,jobs,reportPublish});
 const ready=(async()=>{await store.recover();await ai.initialize();const dir=resolve(projectRoot,'.ai-test/plugin-state');await mkdir(dir,{recursive:true,mode:0o700});const tmp=resolve(dir,randomUUID()+'.tmp');await writeFile(tmp,JSON.stringify({plugin:'dsh-test-workbench',version:VERSION,pid:process.pid,startedAt:new Date().toISOString(),aiBindingReady:ai.available(),aiDiagnostics:ai.diagnostics(),registeredRoutes:true,reportReconcileReady:typeof jobs.reconcile==='function',publicationRecoveryVersion:1,startupPublishesReports:false},null,2),{mode:0o600});await rename(tmp,resolve(dir,'test-workbench.json'));})();
 ctx.effect(()=>()=>Promise.allSettled([...jobs.running.values()]),'test-workbench: drain report jobs before reload');
 for(const [path,methods] of [['/health',['GET']],['/sources',['GET']],['/cases/import',['POST']],['/rounds',['GET','POST']],['/round',['GET']],['/round-meta',['POST']],['/case',['POST']],['/attempt',['POST']],['/remove',['POST']],['/restore',['POST']],['/order',['POST']],['/replan',['POST']],['/evidence',['GET','POST']],['/evidence-meta',['POST']],['/evidence-remove',['POST']],['/evidence-draft',['GET','POST']],['/evidence-drafts',['GET']],['/evidence-draft-meta',['POST']],['/evidence-draft-remove',['POST']],['/evidence-draft-upload',['POST']],['/report',['GET','POST']],['/jobs',['GET']],['/report-retry',['POST']],['/report-reconcile',['POST']]]){
  ctx.effect(()=>ctx.connection.fetch.register({path:PREFIX+path,methods,requestBody:'buffered',fetch:async request=>{await ready;return dispatch(request);}}),'test-workbench: '+path);
 }
}
