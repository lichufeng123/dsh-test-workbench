import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {DEFAULT_CONFIG,PublicationError,prepareReport,execFileRunner,publishReport,blocks,checkReadback,regionHash,referenceHash} from './report-publisher.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
export function reportDocumentId(value){
  if(typeof value!=='string'||value.length>1000)throw new PublicationError('INVALID_DOCUMENT_URL','请输入待核对报告的飞书文档链接。');
  let url;try{url=new URL(value);}catch{throw new PublicationError('INVALID_DOCUMENT_URL','请输入完整的飞书文档链接。');}
  const match=/^\/docx\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname);
  if(url.protocol!=='https:'||url.username||url.password||!['feishu.cn','larksuite.com'].some(s=>url.hostname===s||url.hostname.endsWith('.'+s))||!match)throw new PublicationError('INVALID_DOCUMENT_URL','只接受飞书或 Lark 的 docx 文档链接。');
  return match[1];
}

/** Adopt only a fully matching existing report. Never create, overwrite or clear an unresolved intent on mismatch. */
export async function reconcileReport(input,deps={}){
  const config={...DEFAULT_CONFIG,...deps.config},runner=deps.runner??execFileRunner,publication=input.publication;
  const stop=(code,message)=>{throw new PublicationError(code,message,{publication});};
  if(!publication?.pending||publication.pending.jobId!==input.jobId)stop('RECONCILIATION_REQUIRED','本次核对与已保存的发布任务不一致。');
  const documentId=reportDocumentId(input.documentURL);
  if(publication.documentId&&publication.documentId!==documentId)stop('PUBLICATION_IDENTITY_MISMATCH','报告已有绑定文档，不能改绑到另一个链接。');
  const prepared=prepareReport(input,config),root=await realpath(config.cwd),digests=[];
  for(const evidence of prepared.evidence){
    const resolved=await realpath(evidence.absolutePath),relative=path.relative(root,resolved);
    if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative))stop('EVIDENCE_OUTSIDE_ROOT','证据超出本次发布目录。');
    digests.push([evidence.id,hash(await readFile(resolved))]);
  }
  const sourceHash=digests.length?hash(JSON.stringify([prepared.sourceHash,digests])):prepared.sourceHash;
  if(publication.pending.sourceHash&&publication.pending.sourceHash!==sourceHash)stop('RECONCILIATION_SOURCE_MISMATCH','已保存的发布内容发生变化，保留原意图，请核对原快照。');
  async function call(args){
    let raw;try{raw=await runner(config.binary,[...(config.profile?['--profile',config.profile]:[]),...args,'--as','user'],{cwd:config.cwd,timeout:config.timeout});}catch(error){throw new PublicationError('RECONCILIATION_READ_FAILED','读取待核对文档失败，原发布意图仍保留。',{publication,diagnostics:{causeCode:error.code??'CLI_EXECUTION_FAILED'}});}
    let result;try{result=typeof raw==='string'?JSON.parse(raw):typeof raw?.stdout==='string'?JSON.parse(raw.stdout):raw;}catch{stop('CLI_INVALID_JSON','文档核对没有返回有效结果，原发布意图仍保留。');}
    if(result?.ok===false||(result?.code!==undefined&&result.code!==0))stop('RECONCILIATION_READ_FAILED','当前身份无法读取待核对文档，原发布意图仍保留。');
    return result;
  }
  const who=await call(['whoami']),user=who.onBehalfOf??who.data?.onBehalfOf;
  if(who.identity!=='user'||who.available!==true||who.tokenStatus!=='ready'||(config.expectedUserName&&user?.userName!==config.expectedUserName)||!user?.openId||(config.expectedOpenId&&user.openId!==config.expectedOpenId))stop('IDENTITY_MISMATCH','请使用报告所有者的已授权飞书用户身份核对。');
  const metaResponse=await call(['drive','metas','batch_query','--user-id-type','open_id','--data',JSON.stringify({request_docs:[{doc_token:documentId,doc_type:'docx'}],with_url:true})]);
  const metadata=metaResponse.data??metaResponse,meta=metadata.metas?.find(m=>m.doc_token===documentId&&m.doc_type==='docx');
  if(metadata.failed_list?.length||!meta||meta.owner_id!==user.openId||publication.ownerId&&publication.ownerId!==user.openId)stop('OWNER_MISMATCH','待核对文档不属于当前报告所有者，未修改或改绑文档。');
  if(reportDocumentId(meta.url)!==documentId)stop('PUBLICATION_IDENTITY_MISMATCH','文档元信息与输入链接不一致。');
  const response=await call(['docs','+fetch','--doc',documentId,'--doc-format','xml','--detail','full']),document=response.data?.document;
  if(document?.document_id!==documentId||!Number.isInteger(document.revision_id)||document.revision_id<0)stop('UNSUPPORTED_READBACK','文档读取缺少稳定身份或修订号。');
  const range=blocks(document.content);let media;
  try{media=checkReadback(prepared,range,document);}catch(error){throw new PublicationError('RECONCILIATION_CONTENT_MISMATCH','文档正文或图片与原报告快照不完全一致，保留原文和待核对状态。',{publication,diagnostics:{causeCode:error.code}});}
  // Do not adopt user additions as an AI-managed region: require all visible prose to match exactly.
  const decode=value=>value.replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&apos;',"'").replaceAll('&amp;','&');
  const visible=value=>decode(value.replace(/<[^>]*>/g,' ')).normalize('NFC').replace(/\s+/gu,'');
  const prose=prepared.content.replace(/<img\b[^>]*\/>/g,'').replace(/<figure\b[\s\S]*?<\/figure>/g,'');
  const expected=prepared.format==='xml'?visible(prose):prose.split('\n').map(line=>line.replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/^[\s#>*+\d.-]+/,'').replace(/[|*_`~]/g,' ')).filter(line=>line.trim()&&!/^[-: ]+$/.test(line)).map(visible).join('');
  if(visible(range.map(b=>b.raw).join(''))!==expected)stop('RECONCILIATION_CONTENT_MISMATCH','文档包含原快照以外的内容，保留人工补充，不自动接管该文档。');
  const adopted={...publication,documentId,url:meta.url,ownerId:user.openId,sourceHash,state:'verified',pending:null,status:'published_directory_pending',managed:{startBlockId:range[0].id,endBlockId:range.at(-1).id,hash:regionHash(range),referenceHash:referenceHash(document),revision:document.revision_id},readback:{status:'verified',revision:document.revision_id,ownerVerified:true,userReadable:true,media},reconciledAt:new Date().toISOString()};
  if(typeof deps.checkpoint!=='function')stop('CHECKPOINT_REQUIRED','核对成功后缺少持久回执，未解除待核对状态。');
  await deps.checkpoint(adopted);
  // Publisher re-reads the adopted report and resumes only directory synchronization.
  return (deps.publisher??publishReport)({...input,publication:adopted},{...deps,config});
}
