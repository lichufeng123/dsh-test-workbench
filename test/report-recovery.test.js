import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileReport,reportDocumentId} from '../report-recovery.js';
import {prepareReport,DEFAULT_CONFIG} from '../report-publisher.js';

function setup(options={}){
 const snapshot={id:'ROUND-X',requirementId:'REQ-X',title:'测试报告',cases:[{id:'C1',title:'保存后回读',steps:[],execution:{status:'passed',actual:'保存后保持正确'},evidence:[]}]};
 const prepared=prepareReport({snapshot}),document={document_id:'doc123',revision_id:3,reference_map:{},content:prepared.content.replace(/<(p|h1)\b/g,(_,tag)=>`<${tag} id="b${Math.random()}"`)+(options.extra||'')};
 if(options.body)document.content=options.body;
 const publication={state:'unknown',pending:{jobId:'JOB-X',operation:'create',sourceHash:prepared.sourceHash}};
 const calls=[],saved=[],published=[];
 const runner=async(binary,args)=>{calls.push(args);assert.equal(args.at(-1),'user');if(args[0]==='whoami')return {identity:'user',available:true,tokenStatus:'ready',onBehalfOf:{userName:'Test Maintainer',openId:'owner'}};if(args.includes('metas'))return {ok:true,data:{metas:[{doc_token:'doc123',doc_type:'docx',owner_id:options.foreign?'other':'owner',url:'https://example.feishu.cn/docx/doc123'}]}};if(args.includes('+fetch'))return {ok:true,data:{document}};throw new Error('Recovery must not create or write through reader');};
 const input={snapshot,jobId:'JOB-X',publication,documentURL:'https://example.feishu.cn/docx/doc123'};
 const deps={runner,config:{cwd:DEFAULT_CONFIG.cwd},checkpoint:async p=>saved.push(p),publisher:async i=>{published.push(i);return {...i.publication,directory:{status:'verified'},status:'published'};}};
 return {input,deps,calls,saved,published};
}

test('verified matching report adopts identity and continues same report, never creates',async()=>{const h=setup();const result=await reconcileReport(h.input,h.deps);assert.equal(result.documentId,'doc123');assert.equal(result.pending,null);assert.equal(result.state,'verified');assert.equal(result.readback.ownerVerified,true);assert.equal(h.saved.length,1);assert.equal(h.published[0].publication.documentId,'doc123');assert.equal(h.calls.some(a=>a.includes('+create')||a.includes('+update')),false);});
test('foreign owner leaves unknown intent intact and performs no write',async()=>{const h=setup({foreign:true});await assert.rejects(reconcileReport(h.input,h.deps),{code:'OWNER_MISMATCH'});assert.equal(h.input.publication.state,'unknown');assert.equal(h.saved.length,0);assert.equal(h.published.length,0);});
test('human added prose is preserved instead of silently adopting whole document',async()=>{const h=setup({extra:'<p id="human">人工补充未测说明</p>'});await assert.rejects(reconcileReport(h.input,h.deps),{code:'RECONCILIATION_CONTENT_MISMATCH'});assert.equal(h.saved.length,0);assert.equal(h.published.length,0);});
test('partial report does not clear original unknown state',async()=>{const h=setup({body:'<p id="partial">上传中</p>'});await assert.rejects(reconcileReport(h.input,h.deps),{code:'RECONCILIATION_CONTENT_MISMATCH'});assert.ok(h.input.publication.pending);assert.equal(h.saved.length,0);});
test('job and frozen content mismatch stop before reading remote document',async()=>{const h=setup();h.input.publication.pending.jobId='another-job';await assert.rejects(reconcileReport(h.input,h.deps),{code:'RECONCILIATION_REQUIRED'});assert.equal(h.calls.length,0);h.input.publication.pending.jobId='JOB-X';h.input.publication.pending.sourceHash='changed';await assert.rejects(reconcileReport(h.input,h.deps),{code:'RECONCILIATION_SOURCE_MISMATCH'});assert.equal(h.calls.length,0);});
test('known document identity cannot be rebound to another document',async()=>{const h=setup();h.input.publication.documentId='different';await assert.rejects(reconcileReport(h.input,h.deps),{code:'PUBLICATION_IDENTITY_MISMATCH'});assert.equal(h.calls.length,0);});
test('recovery accepts only HTTPS Feishu docx links without embedded credentials',()=>{assert.equal(reportDocumentId('https://example.feishu.cn/docx/doc123'),'doc123');for(const value of ['doc123','https://example.com/docx/id','http://example.feishu.cn/docx/id','https://user:pass@example.feishu.cn/docx/id','https://example.feishu.cn/wiki/id','https://example.feishu.cn.evil.example/docx/id'])assert.throws(()=>reportDocumentId(value));});
