import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const sample = () => ({id:'ROUND-1',requirementId:'REQ-TEST',title:'隔离 UI 轮次',environment:'SIT',version:'build-test',scope:'UI fixture only',revision:1,source:{version:'v1'},order:['CASE-1','CASE-2'],counts:{total:2,not_started:2,removed:0},reportJobs:[],cases:[1,2].map(n=>({id:`CASE-${n}`,title:`业务用例 ${n}`,priority:'P1',preconditions:'已准备隔离对象',steps:[{action:'打开详情',expected:'业务字段可见'}],execution:{attemptId:`ATTEMPT-${n}`,status:'not_started',actual:'',executor:'manual',issue:'',stepResults:[]},attempts:[],evidence:[],removed:null,history:[]}))});

function runtime(fetch,storage=new Map()) {
  const instances = new Map(); let current, effects = [], component, tree, visited;
  const timers = new Map(); let timerId=0;
  const React={Fragment:'fragment',createElement(type,props,...children){return {type,props:{...props,children},children}},
    useState(initial){const i=current.cursor++;if(!(i in current.hooks))current.hooks[i]=typeof initial==='function'?initial():initial;const instance=current;return [instance.hooks[i],value=>{instance.hooks[i]=typeof value==='function'?value(instance.hooks[i]):value}]},
    useRef(value){const i=current.cursor++;if(!(i in current.hooks))current.hooks[i]={current:value};return current.hooks[i]},
    useMemo(fn,deps){const i=current.cursor++,prev=current.hooks[i];if(!prev||deps.some((d,n)=>d!==prev.deps[n]))current.hooks[i]={deps,value:fn()};return current.hooks[i].value},
    useEffect(fn,deps){const i=current.cursor++,prev=current.hooks[i];if(!prev||!deps||deps.some((d,n)=>d!==prev.deps[n])){const instance=current;effects.push(()=>{prev?.cleanup?.();instance.hooks[i]={deps,cleanup:fn()}})}}};
  const listeners=[];
  const sandbox={window:{fetch,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},__ModuleLoader__:{load(value){sandbox.definition=value}},addEventListener(...args){listeners.push(args)},removeEventListener(){},location:{origin:'http://localhost'}},document:{createElement(){return {remove(){},click(){}}},head:{appendChild(){}},getElementById(){return {focus(){}}}},URL,URLSearchParams,FormData,Blob,File,Set,console,crypto:globalThis.crypto,setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id},clearTimeout(id){timers.delete(id)}};
  vm.runInNewContext(source.replace('    return {\n      inject:', '    window.__test = { mergeDraft, execution, safeRetry, safeDocument, createAPI, Evidence, ReportPanel };\n    return {\n      inject:'),sandbox);
  const plugin=sandbox.definition.factory(()=>React),registrations=[];
  const ctx={effect:fn=>fn(),get:()=>({register(item){registrations.push(item);return ()=>{}}}),slots:{register(options,value){component=value;return ()=>{}}}};
  plugin.apply(ctx);
  function expand(node,path='root'){
    if(Array.isArray(node))return node.map((child,i)=>expand(child,path+'/'+(child?.props?.key??i)));
    if(!node||typeof node!=='object')return node;
    if(typeof node.type==='function'){
      const id=path+'/'+node.type.name+'/'+(node.props.key||'');visited.add(id);let instance=instances.get(id);if(!instance){instance={hooks:[],cursor:0};instances.set(id,instance)}instance.cursor=0;const previous=current;current=instance;const out=node.type(node.props);current=previous;return expand(out,id);
    }
    return {...node,children:expand(node.children,path)};
  }
  function render(){visited=new Set();tree=expand(React.createElement(component,{ctx}));for(const [id,instance]of instances){if(!visited.has(id)){instance.hooks.forEach(hook=>hook?.cleanup?.());instances.delete(id)}}const batch=effects;effects=[];batch.forEach(fn=>fn());return tree}
  function nodes(predicate,root=tree){const list=[];function walk(node){if(Array.isArray(node)){node.forEach(walk);return}if(!node||typeof node!=='object')return;if(predicate(node))list.push(node);walk(node.children)}walk(root);return list}
  function content(node){if(Array.isArray(node))return node.map(content).join('');if(node&&typeof node==='object')return content(node.children);return node===false||node==null?'':String(node)}
  const button=label=>nodes(n=>n.type==='button'&&content(n)===label)[0];
  function field(label){const wrapper=nodes(n=>n.type==='label'&&content(n.children[0])===label)[0];assert.ok(wrapper,`field ${label} exists`);return nodes(n=>['input','textarea','select'].includes(n.type),wrapper)[0]}
  async function settle(){for(let n=0;n<8;n++){render();await new Promise(resolve=>setImmediate(resolve))}return tree}
  return {sandbox,plugin,ctx,registrations,listeners,timers,render,nodes,content,button,field,settle,get tree(){return tree}};
}
function backend(){let round=sample(),failCase=0,delayCase,uploadCalls=0,failUploadAt=0,loseUpload=false,loseDraft=false;const mediaDrafts=new Map();const requests=[];const fetch=async(url,options={})=>{const method=options.method||'GET';const body=typeof options.body==='string'?JSON.parse(options.body):null;requests.push({url,method,body,options});
    if(method==='POST'&&url.endsWith('/case')){if(delayCase)await delayCase;if(failCase){round.revision++;round.cases[0].execution.actual='其他执行者填写';const status=failCase;failCase=0;return {ok:false,status,json:async()=>({error:'revision conflict',revision:round.revision})}}assert.equal(body.expectedRevision,round.revision,'every serialized write uses the latest revision');round={...round,revision:round.revision+1,cases:round.cases.map(c=>c.id===body.caseId?{...c,execution:{...c.execution,...Object.fromEntries(['status','actual','executor','issue','stepResults','runReference'].map(k=>[k,body[k]]))}}:c)};return {ok:true,json:async()=>({round:copy(round)})}}
    if(method==='POST'&&url.endsWith('/evidence-draft')){const d=Object.fromEntries(options.body.entries());const draft=mediaDrafts.get(d.draftId)||{...d,id:d.draftId,revision:1,step:Number(d.step)||null,mime:d.file.type,name:d.file.name};mediaDrafts.set(d.draftId,draft);if(loseDraft){loseDraft=false;throw Error('lost initial draft response');}return {ok:true,json:async()=>({draft:{...draft,file:undefined}})};}
    if(method==='POST'&&url.endsWith('/evidence-draft-meta')){const d=JSON.parse(options.body);const draft=mediaDrafts.get(d.draftId);if(!draft)return {ok:false,status:409,json:async()=>({error:'草稿已经上传'})};if(d.expectedDraftRevision!==draft.revision)return {ok:false,status:409,json:async()=>({error:'草稿说明已更新',draftRevision:draft.revision,currentDraft:{...draft,file:undefined}})};Object.assign(draft,{caption:d.caption,step:d.step,revision:draft.revision+1});return {ok:true,json:async()=>({draft:{...draft,file:undefined}})};}
    if(method==='POST'&&url.endsWith('/evidence-draft-remove')){mediaDrafts.delete(JSON.parse(options.body).draftId);return {ok:true,json:async()=>({ok:true})};}
    if(method==='POST'&&url.endsWith('/evidence-draft-upload')){uploadCalls++;if(uploadCalls===failUploadAt)return {ok:false,status:500,json:async()=>({error:'isolated upload failure'})};const d=JSON.parse(options.body);if(round.cases.some(c=>c.evidence.some(e=>e.sourceDraftId===d.draftId)))return {ok:true,json:async()=>({round:copy(round)})};assert.equal(d.expectedRevision,round.revision);const draft=mediaDrafts.get(d.draftId),c=round.cases.find(c=>c.id===draft.caseId);c.evidence.push({id:'EVID-'+uploadCalls,sourceDraftId:d.draftId,name:draft.name,mime:draft.mime,caption:d.caption||draft.caption,step:draft.step,attemptId:c.execution.attemptId});round.revision++;mediaDrafts.delete(d.draftId);if(loseUpload){loseUpload=false;throw Error('lost final upload response');}return {ok:true,json:async()=>({round:copy(round)})};}
    if(method==='GET'&&url.includes('/evidence-drafts?'))return {ok:true,json:async()=>({drafts:[...mediaDrafts.values()].map(d=>({...d,file:undefined}))})};
    if(method==='GET'&&url.includes('/evidence-draft?')){const id=new URL(url,'http://test').searchParams.get('draft');return {ok:true,blob:async()=>mediaDrafts.get(id).file};}
    if(method==='POST'&&url.endsWith('/evidence')){
      uploadCalls++;if(uploadCalls===failUploadAt)return {ok:false,status:500,json:async()=>({error:'isolated upload failure'})};
      const data=Object.fromEntries(options.body.entries());assert.equal(Number(data.expectedRevision),round.revision);
      const c=round.cases.find(c=>c.id===data.caseId);c.evidence.push({id:'EVID-'+uploadCalls,name:data.file.name,mime:data.file.type,caption:data.caption,step:Number(data.step)||null,attemptId:c.execution.attemptId});round.revision++;
      return {ok:true,json:async()=>({round:copy(round)})};
    }
    if(method==='POST'&&(url.endsWith('/remove')||url.endsWith('/restore'))){assert.equal(body.expectedRevision,round.revision);const c=round.cases.find(c=>c.id===body.caseId);c.removed=url.endsWith('/remove')?{category:body.category,reason:body.reason,at:'2026-11-09T07:00:00Z'}:null;round.revision++;round.counts.removed=round.cases.filter(c=>c.removed).length;round.counts.active=round.cases.length-round.counts.removed;return {ok:true,json:async()=>({round:copy(round)})};}
    if(method==='POST'&&url.endsWith('/evidence-remove')){assert.equal(body.expectedRevision,round.revision);const c=round.cases.find(c=>c.id===body.caseId);assert.ok(c.evidence.some(e=>e.id===body.evidenceId));c.evidence=c.evidence.filter(e=>e.id!==body.evidenceId);round.revision++;return {ok:true,json:async()=>({round:copy(round)})};}
    const data=url.endsWith('/sources')?{items:[{id:'REQ-TEST',title:'UI test source',versions:[{version:'v1',caseCount:2,status:'approved'}]}]}:url.endsWith('/health')?{version:'0.1.0',capabilities:{rounds:true,evidence:true,partialReports:true,evidenceDrafts:true,reportPublish:false}}:url.includes('/rounds?')?{rounds:[copy(round)]}:url.includes('/round?')?{round:copy(round)}:url.includes('/jobs?')?{jobs:[]}:{};
    return {ok:true,status:200,json:async()=>data,text:async()=>'# isolated preview',blob:async()=>new Blob(['fixture'],{type:'image/png'})};
  };
  return {fetch,requests,get round(){return round},set round(value){round=value},fail(status){failCase=status},delay(promise){delayCase=promise},failUpload(n){failUploadAt=n},loseNextUpload(){loseUpload=true},loseNextDraft(){loseDraft=true}};
}

test('native sidebar, four tabs, light colors and partial-report capability',async()=>{
  const api=backend(),ui=runtime(api.fetch);await ui.settle();
  assert.equal(ui.registrations[0].title(),'测试执行台');
  assert.equal(ui.sandbox.definition.id,'dsh-test-workbench');
  assert.deepEqual(ui.nodes(n=>n.props.role==='tab').map(n=>ui.content(n)),['全部用例','执行顺序','已移除','测试报告']);
  assert.match(source,/color-scheme:light/);assert.doesNotMatch(source,/var\(--dsw/);
  assert.ok(ui.content(ui.tree).includes('已准备隔离对象'));assert.ok(ui.content(ui.tree).includes('业务字段可见'));
  ui.button('测试报告').props.onClick();await ui.settle();
  assert.equal(ui.button('生成本地预览').props.disabled,false);
  assert.equal(ui.button('发布到飞书…').props.disabled,true);
  assert.equal(api.requests.filter(r=>r.method==='POST').length,0,'UI rendering/tests never publish externally');
});

test('unknown publication exposes guarded reconciliation and keeps link after a failed request',async()=>{
 const api=backend(),job={id:'REPORT-1',mode:'publish',status:'unknown',unknownOutcome:true,snapshotRevision:1,errorCode:'CREATE_STATUS_UNKNOWN',error:'old generic English error',generation:{model:{model:'recorded-model'}}};api.round.reportJobs=[job];api.round.publication={state:'unknown',pending:{operation:'create',jobId:job.id}};
 const posts=[];const fetch=async(url,options={})=>{if(url.endsWith('/health'))return {ok:true,json:async()=>({capabilities:{partialReports:true,aiReport:true,reportPublish:true,reportReconcile:true}})};if(url.includes('/jobs?'))return {ok:true,json:async()=>({jobs:[job]})};if(url.endsWith('/report-reconcile')){posts.push(JSON.parse(options.body));return {ok:false,status:409,json:async()=>({error:'正文与原快照不一致'})};}return api.fetch(url,options);};
 const ui=runtime(fetch);await ui.settle();ui.button('测试报告').props.onClick();await ui.settle();assert.equal(ui.button('先核对已有报告').props.disabled,true);assert.ok(ui.content(ui.tree).includes('recorded-model'));assert.equal(ui.button('重试已知失败'),undefined);
 ui.field('已有飞书报告链接').props.onChange({target:{value:'https://example.feishu.cn/docx/EXISTING'}});ui.render();const form=ui.nodes(n=>n.type==='form'&&ui.content(n).includes('核对已有报告并继续'))[0];await form.props.onSubmit({preventDefault(){}});await ui.settle();assert.equal(posts.length,1);assert.equal(posts[0].jobId,'REPORT-1');assert.equal(posts[0].expectedRevision,1);assert.equal(ui.field('已有飞书报告链接').props.value,'https://example.feishu.cn/docx/EXISTING');assert.ok(ui.content(ui.tree).includes('正文与原快照不一致'));assert.equal(api.round.publication.state,'unknown');
});

test('typing during a save retains newer input and serialized saves advance revisions',async()=>{
  const api=backend(),ui=runtime(api.fetch);await ui.settle();
  ui.field('实际结果（通过时选填；失败 / 阻塞 / 暂缓时必填）').props.onChange({target:{value:'第一份本地记录'}});ui.render();
  let release;api.delay(new Promise(resolve=>{release=resolve}));
  const saving=ui.button('保存结果').props.onClick();await new Promise(resolve=>setImmediate(resolve));
  ui.render();ui.field('实际结果（通过时选填；失败 / 阻塞 / 暂缓时必填）').props.onChange({target:{value:'保存途中继续输入'}});ui.render();
  release();await saving;await ui.settle();
  assert.equal(ui.field('实际结果（通过时选填；失败 / 阻塞 / 暂缓时必填）').props.value,'保存途中继续输入');
  assert.ok(ui.content(ui.tree).includes('有未保存更改'));
  api.delay(null);await ui.button('保存结果').props.onClick();await ui.settle();
  assert.equal(api.round.cases[0].execution.actual,'保存途中继续输入');
  assert.deepEqual(api.requests.filter(r=>r.url.endsWith('/case')).map(r=>r.body.expectedRevision),[1,2]);
});

test('409 keeps local inputs, compares conflicts, and requires explicit resolution',async()=>{
  const api=backend(),ui=runtime(api.fetch);await ui.settle();
  ui.field('实际结果（通过时选填；失败 / 阻塞 / 暂缓时必填）').props.onChange({target:{value:'本地未保存内容'}});ui.render();
  api.fail(409);await ui.button('保存结果').props.onClick();await ui.settle();
  assert.equal(ui.field('实际结果（通过时选填；失败 / 阻塞 / 暂缓时必填）').props.value,'本地未保存内容');
  assert.ok(ui.content(ui.tree).includes('其他执行者填写'));assert.equal(ui.button('保存结果').props.disabled,true);
  const posts=api.requests.filter(r=>r.method==='POST').length;await ui.button('刷新').props.onClick();await ui.settle();
  assert.equal(api.requests.filter(r=>r.method==='POST').length,posts,'refresh never silently replays a conflicting write');
  assert.equal(ui.field('实际结果（通过时选填；失败 / 阻塞 / 暂缓时必填）').props.value,'本地未保存内容');
  ui.button('保留本地内容').props.onClick();ui.render();await ui.button('保存结果').props.onClick();await ui.settle();
  assert.equal(api.round.cases[0].execution.actual,'本地未保存内容');assert.equal(api.requests.at(-1).body.expectedRevision,2);
});

test('three-way merge preserves independent server edits and safe retry rejects unknown publishing',()=>{
  const ui=runtime(backend().fetch),{mergeDraft,execution,safeRetry,safeDocument}=ui.sandbox.window.__test;
  const base=execution(sample().cases[0]),draft={base,values:{...base,actual:'local'},conflicts:{}};
  const merged=mergeDraft(draft,{...base,issue:'remote bug'},null);
  assert.equal(merged.values.actual,'local');assert.equal(merged.values.issue,'remote bug');assert.deepEqual(Object.keys(merged.conflicts),[]);
  const ownNormalized=mergeDraft({base,values:{...base,actual:'  saved text  '},conflicts:{}},{...base,actual:'saved text'},{...base,actual:'  saved text  '});
  assert.equal(ownNormalized.values.actual,'saved text');assert.deepEqual(Object.keys(ownNormalized.conflicts),[]);
  const newerTyping=mergeDraft({base,values:{...base,actual:'newer typing'},conflicts:{}},{...base,actual:'saved text'},{...base,actual:'  saved text  '});
  assert.equal(newerTyping.values.actual,'newer typing');assert.deepEqual(Object.keys(newerTyping.conflicts),[]);
  assert.equal(safeRetry({status:'failed',retryable:true}),true);
  assert.equal(safeRetry({status:'unknown',retryable:true}),false);
  assert.equal(safeRetry({status:'failed',retryable:true,unknownCreate:true}),false);
  assert.equal(safeDocument('javascript:alert(1)'), '');assert.equal(safeDocument('https://user:pass@example.com'), '');
  assert.equal(safeDocument('https://example.feishu.cn/docx/demo'),'https://example.feishu.cn/docx/demo');
});

test('step results edited out of order have valid numbered rows and AI requires a run reference',async()=>{
  const api=backend();api.round.cases[0].steps.push({action:'刷新详情',expected:'结果保留'});
  const ui=runtime(api.fetch);await ui.settle();
  ui.field('步骤 2 实际结果').props.onChange({target:{value:'刷新后记录保留'}});ui.render();await ui.button('保存结果').props.onClick();await ui.settle();
  assert.deepEqual(api.round.cases[0].execution.stepResults,[{step:1,status:'',actual:''},{step:2,status:'',actual:'刷新后记录保留'}]);
  ui.field('执行人').props.onChange({target:{value:'ai'}});ui.render();assert.equal(ui.button('保存结果').props.disabled,true);
  ui.field('本轮 AI 执行记录引用（必填）').props.onChange({target:{value:'runs/isolated-run/execution.json'}});ui.render();
  await ui.button('保存结果').props.onClick();await ui.settle();assert.equal(api.round.cases[0].execution.runReference,'runs/isolated-run/execution.json');
});

const imageFile=name=>Object.assign(new Blob(['isolated-image-data'],{type:'image/png'}),{name});
const editor=(ui,step=1)=>ui.nodes(n=>n.props['aria-label']===`步骤 ${step} 实际结果与截图`)[0];
function pasteImages(ui,files,step=1){let prevented=false;editor(ui,step).props.onPaste({clipboardData:{items:files.map(file=>({kind:'file',type:file.type,getAsFile:()=>file}))},preventDefault(){prevented=true}});return prevented;}

test('multiple step screenshots and captions survive case switching with no silent upload',async()=>{
 const api=backend(),ui=runtime(api.fetch);await ui.settle();
 assert.equal(pasteImages(ui,[imageFile('one.png'),imageFile('two.png')]),true);await ui.settle();
 const captions=ui.nodes(n=>n.type==='textarea'&&n.props.placeholder==='补充画面说明（选填）');assert.equal(captions.length,2);
 captions[0].props.onChange({target:{value:'步骤1操作前'}});ui.render();
 assert.ok(ui.button('上传 2 个文件'));assert.equal(ui.nodes(n=>n.type==='input'&&n.props.type==='file').every(n=>n.props.multiple),true);
 ui.nodes(n=>n.props.className==='dshtw-case'&&ui.content(n).includes('CASE-2'))[0].props.onClick();await ui.settle();assert.equal(ui.button('上传 2 个文件'),undefined);
 ui.nodes(n=>n.props.className==='dshtw-case'&&ui.content(n).includes('CASE-1'))[0].props.onClick();await ui.settle();
 assert.equal(ui.nodes(n=>n.type==='textarea'&&n.props.placeholder==='补充画面说明（选填）')[0].props.value,'步骤1操作前');
 assert.ok(ui.button('上传 2 个文件'));assert.equal(api.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/evidence-draft-upload')).length,0);
});

test('batch upload serializes revisions and retains failed remainder without replaying successes',async()=>{
 const api=backend(),ui=runtime(api.fetch);await ui.settle();pasteImages(ui,[imageFile('one.png'),imageFile('two.png'),imageFile('three.png')]);await ui.settle();
 api.failUpload(2);await ui.button('上传 3 个文件').props.onClick();await ui.settle();
 assert.equal(api.round.cases[0].evidence.length,1);assert.equal(api.round.cases[0].evidence[0].step,1);assert.equal(api.round.cases[0].evidence[0].attemptId,'ATTEMPT-1');assert.ok(ui.button('上传 2 个文件'));
 assert.ok(ui.content(ui.tree).includes('其余图片仍在此处'));
 await ui.button('上传 2 个文件').props.onClick();await ui.settle();assert.equal(api.round.cases[0].evidence.length,3);
 assert.equal(new Set(api.round.cases[0].evidence.map(e=>e.id)).size,3);assert.equal(ui.button('上传 2 个文件'),undefined);
 assert.equal(ui.nodes(n=>n.type==='img'&&n.props.alt.includes('步骤 1')).length,3);
});

test('passed saves with blank actual; failure blocked and deferred still require explanation',async()=>{
 const api=backend(),ui=runtime(api.fetch);await ui.settle();
 ui.field('执行状态').props.onChange({target:{value:'passed'}});ui.render();assert.equal(ui.button('保存结果').props.disabled,false);
 await ui.button('保存结果').props.onClick();await ui.settle();assert.equal(api.round.cases[0].execution.status,'passed');assert.equal(api.round.cases[0].execution.actual,'');
 for(const status of ['failed','blocked','deferred']){ui.field('执行状态').props.onChange({target:{value:status}});ui.render();assert.equal(ui.button('保存结果').props.disabled,true);}
 ui.field('实际结果（通过时选填；失败 / 阻塞 / 暂缓时必填）').props.onChange({target:{value:'等待可用设备'}});ui.render();assert.equal(ui.button('保存结果').props.disabled,false);
});

test('images can save while result text is incomplete without discarding that draft',async()=>{
 const api=backend(),ui=runtime(api.fetch);await ui.settle();
 ui.field('执行状态').props.onChange({target:{value:'failed'}});ui.render();assert.equal(ui.button('保存结果').props.disabled,true);
 pasteImages(ui,[imageFile('first.png')]);await ui.settle();await ui.button('上传 1 个文件').props.onClick();await ui.settle();
 assert.equal(api.round.cases[0].evidence.length,1);assert.equal(ui.field('执行状态').props.value,'failed');assert.equal(ui.field('实际结果（通过时选填；失败 / 阻塞 / 暂缓时必填）').props.value,'');assert.ok(ui.content(ui.tree).includes('有未保存更改'));
});

test('removed cases retain read-only actual results and evidence without an upload form',async()=>{
  const api=backend();api.round.cases[0].removed={category:'out_of_scope',reason:'本轮范围调整',at:'2026-11-07T00:00:00Z'};
  api.round.cases[0].execution={...api.round.cases[0].execution,status:'failed',actual:'移除前发现的失败保留'};
  api.round.cases[0].evidence=[{id:'EVID-TEST',name:'historical.png',mime:'image/png',caption:'失败现场证据',attemptId:'ATTEMPT-1'}];
  const ui=runtime(api.fetch);await ui.settle();ui.button('已移除').props.onClick();await ui.settle();
  assert.ok(ui.content(ui.tree).includes('移除前发现的失败保留'));assert.ok(ui.content(ui.tree).includes('失败现场证据'));
  assert.equal(ui.nodes(n=>n.type==='img'&&n.props.alt==='失败现场证据').length,1);
  assert.equal(ui.nodes(n=>n.type==='form'&&n.props.className==='dshtw-drop').length,0);
  assert.equal(ui.button('修改图注 / 步骤').props.disabled,true);assert.ok(ui.button('恢复到本轮'));
});

test('paste is scoped to result region, plain text preserved and disabled editors reject files',async()=>{
 const api=backend(),ui=runtime(api.fetch);await ui.settle();assert.equal(ui.listeners.some(([type])=>type==='paste'),false);
 let prevented=false;editor(ui).props.onPaste({clipboardData:{items:[{kind:'string',type:'text/plain'}]},preventDefault(){prevented=true}});assert.equal(prevented,false);
 assert.equal(ui.nodes(n=>n.type==='input'&&n.props['aria-label']==='步骤 1 添加截图 / 文件')[0].props.accept,'image/png,image/jpeg,image/webp,video/mp4,video/webm,application/pdf');
 assert.equal(api.requests.some(r=>r.url.endsWith('/report')&&r.method==='POST'),false);
});


test('pending originals captions and incomplete text drafts survive editor remount',async()=>{
 const api=backend(),storage=new Map(),first=runtime(api.fetch,storage);await first.settle();
 first.field('步骤 1 实际结果').props.onChange({target:{value:'未提交的步骤观察'}});first.render();
 pasteImages(first,[imageFile('recover-me.png')]);await first.settle();
 first.nodes(n=>n.type==='textarea'&&n.props.placeholder==='补充画面说明（选填）')[0].props.onChange({target:{value:'恢复用图片说明'}});first.render();
 await first.button('上传 1 个文件').props.onClick();await first.settle();
 assert.equal(api.round.cases[0].evidence[0].caption,'恢复用图片说明');
 pasteImages(first,[imageFile('still-pending.png')]);await first.settle();
 const second=runtime(api.fetch,storage);await second.settle();
 assert.ok(second.button('上传 1 个文件'),second.content(second.tree));assert.ok(second.content(second.tree).includes('草稿已保存'));
 assert.equal(second.field('步骤 1 实际结果').props.value,'未提交的步骤观察');
 assert.equal(api.round.cases[0].evidence.length,1);
});


test('lost finalize response retries the immutable draft receipt without metadata preflight',async()=>{
 const api=backend(),ui=runtime(api.fetch);await ui.settle();pasteImages(ui,[imageFile('once.png')]);await ui.settle();api.loseNextUpload();
 await ui.button('上传 1 个文件').props.onClick();await ui.settle();assert.equal(api.round.cases[0].evidence.length,1);assert.ok(ui.button('上传 1 个文件'));
 await ui.button('上传 1 个文件').props.onClick();await ui.settle();assert.equal(api.round.cases[0].evidence.length,1);assert.equal(ui.button('上传 1 个文件'),undefined);
});

test('lost first draft response reconciles later caption before reporting saved',async()=>{
 const api=backend(),ui=runtime(api.fetch);await ui.settle();api.loseNextDraft();pasteImages(ui,[imageFile('caption.png')]);await ui.settle();
 ui.nodes(n=>n.type==='textarea'&&n.props.placeholder==='补充画面说明（选填）')[0].props.onChange({target:{value:'重试前补充的图片说明'}});ui.render();
 await ui.button('上传 1 个文件').props.onClick();await ui.settle();assert.equal(api.round.cases[0].evidence[0].caption,'重试前补充的图片说明');
 assert.ok(api.requests.some(r=>r.url.endsWith('/evidence-draft-meta')));
});

test('accepting a changed attempt never carries old unsaved observations into it',async()=>{
 const api=backend(),storage=new Map(),ui=runtime(api.fetch,storage);await ui.settle();ui.field('步骤 1 实际结果').props.onChange({target:{value:'旧尝试观察'}});ui.render();
 api.round.cases[0].execution={...api.round.cases[0].execution,attemptId:'ATTEMPT-NEW',stepResults:[],actual:''};api.round.revision++;
 await ui.button('刷新').props.onClick();await ui.settle();assert.equal(ui.field('步骤 1 实际结果').props.value,'');assert.ok([...storage.keys()].some(k=>k.includes('-old-')));
 await ui.button('保存结果').props.onClick();await ui.settle();assert.deepEqual(api.round.cases[0].execution.stepResults,[]);
});


test('unuploaded image captions persist after debounce and restore without formal evidence',async()=>{
 const api=backend(),storage=new Map(),ui=runtime(api.fetch,storage);await ui.settle();pasteImages(ui,[imageFile('draft-only.png')]);await ui.settle();
 ui.nodes(n=>n.type==='textarea'&&n.props.placeholder==='补充画面说明（选填）')[0].props.onChange({target:{value:'未正式上传但已保存的图注'}});ui.render();
 for(const [id,timer]of [...ui.timers])if(timer.delay===450){ui.timers.delete(id);timer.fn();}await ui.settle();
 assert.equal(api.round.cases[0].evidence.length,0);assert.ok(ui.content(ui.tree).includes('草稿已保存'));
 const restored=runtime(api.fetch,storage);await restored.settle();assert.equal(restored.nodes(n=>n.type==='textarea'&&n.props.placeholder==='补充画面说明（选填）')[0].props.value,'未正式上传但已保存的图注');assert.equal(api.round.cases[0].evidence.length,0);
});


test('editing an uploaded step image supports cancel then exact deletion and refresh persistence',async()=>{
 const api=backend();api.round.cases[0].evidence=[{id:'STEP-IMAGE',name:'step.png',mime:'image/png',caption:'步骤原图',step:1,attemptId:'ATTEMPT-1'},{id:'CASE-IMAGE',name:'case.png',mime:'image/png',caption:'整例保留原图',step:null,attemptId:'ATTEMPT-1'}];
 const ui=runtime(api.fetch);await ui.settle();assert.equal(ui.button('删除图片'),undefined);
 ui.button('修改图注 / 步骤').props.onClick();ui.render();ui.button('删除图片').props.onClick();ui.render();
 assert.ok(ui.content(ui.tree).includes('确认删除这张图片？'));assert.equal(api.requests.filter(r=>r.url.endsWith('/evidence-remove')).length,0);
 ui.button('保留附件').props.onClick();ui.render();assert.equal(api.round.cases[0].evidence.length,2);
 ui.field('步骤 1 实际结果').props.onChange({target:{value:'保留尚未保存的步骤观察'}});ui.render();
 ui.button('删除图片').props.onClick();ui.render();await ui.button('确认删除').props.onClick();await ui.settle();
 const req=api.requests.find(r=>r.url.endsWith('/evidence-remove'));assert.equal(req.body.caseId,'CASE-1');assert.equal(req.body.evidenceId,'STEP-IMAGE');assert.equal(req.body.expectedRevision,1);
 assert.deepEqual(api.round.cases[0].evidence.map(e=>e.id),['CASE-IMAGE']);assert.equal(ui.field('步骤 1 实际结果').props.value,'保留尚未保存的步骤观察');
 assert.equal(api.requests.filter(r=>r.url.endsWith('/case')&&r.method==='POST').length,0,'attachment removal does not force-save incomplete execution fields');
 assert.ok(ui.content(ui.tree).includes('证据附件已删除。'));assert.equal(ui.nodes(n=>n.type==='img'&&n.props.alt==='步骤原图').length,0);assert.equal(ui.nodes(n=>n.type==='img'&&n.props.alt==='整例保留原图').length,1);
 await ui.button('刷新').props.onClick();await ui.settle();assert.equal(ui.nodes(n=>n.type==='img'&&n.props.alt==='步骤原图').length,0);assert.equal(ui.field('步骤 1 实际结果').props.value,'保留尚未保存的步骤观察');
 const reopened=runtime(api.fetch);await reopened.settle();assert.equal(reopened.nodes(n=>n.type==='img'&&n.props.alt==='步骤原图').length,0);assert.equal(reopened.nodes(n=>n.type==='img'&&n.props.alt==='整例保留原图').length,1);
});

test('failed deletion keeps the image and its caption, disables actions while pending, and can retry',async()=>{
 const api=backend();api.round.cases[0].evidence=[{id:'RETRY-IMAGE',name:'retry.png',mime:'image/png',caption:'保留图注',step:1,attemptId:'ATTEMPT-1'}];
 let release,fail=true;const gate=new Promise(resolve=>{release=resolve});const ui=runtime(async(url,options)=>{if(url.endsWith('/evidence-remove')&&fail){await gate;return {ok:false,status:500,json:async()=>({error:'删除请求失败'})};}return api.fetch(url,options)});await ui.settle();
 ui.button('修改图注 / 步骤').props.onClick();ui.render();ui.field('图注').props.onChange({target:{value:'未保存的图片说明'}});ui.render();ui.button('删除图片').props.onClick();ui.render();
 const pending=ui.button('确认删除').props.onClick();await ui.settle();assert.equal(ui.button('正在删除…').props.disabled,true);assert.equal(ui.button('取消修改').props.disabled,true);assert.equal(ui.button('保留附件').props.disabled,true);release();await pending;await ui.settle();
 assert.equal(api.round.cases[0].evidence.length,1);assert.equal(ui.field('图注').props.value,'未保存的图片说明');assert.ok(ui.content(ui.tree).includes('未确认删除成功，请刷新核对后再试。'));assert.equal(ui.button('确认删除').props.disabled,false);
 fail=false;await ui.button('确认删除').props.onClick();await ui.settle();assert.equal(api.round.cases[0].evidence.length,0);
});

test('evidence deletion revision conflicts retain the image and unsaved step text',async()=>{
 const api=backend();api.round.cases[0].evidence=[{id:'STALE-IMAGE',name:'stale.png',mime:'image/png',caption:'并发原图',step:1,attemptId:'ATTEMPT-1'}];
 const ui=runtime(async(url,options)=>{if(url.endsWith('/evidence-remove')){api.round.revision++;return {ok:false,status:409,json:async()=>({error:'记录已有更新',revision:api.round.revision})};}return api.fetch(url,options)});await ui.settle();
 ui.field('步骤 1 实际结果').props.onChange({target:{value:'我的步骤观察'}});ui.render();ui.button('修改图注 / 步骤').props.onClick();ui.render();ui.button('删除图片').props.onClick();ui.render();await ui.button('确认删除').props.onClick();await ui.settle();
 assert.equal(api.round.cases[0].evidence.length,1);assert.equal(ui.field('步骤 1 实际结果').props.value,'我的步骤观察');assert.ok(ui.content(ui.tree).includes('409：记录已有更新'));assert.equal(api.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/case')).length,0);
});


const submitReason=ui=>ui.nodes(n=>n.type==='form'&&n.props.className==='dshtw-form')[0].props.onSubmit({preventDefault(){}});

test('removing a saved case is independent of incomplete drafts on other cases',async()=>{
 const api=backend(),ui=runtime(api.fetch);await ui.settle();
 ui.field('执行状态').props.onChange({target:{value:'failed'}});ui.render();
 ui.nodes(n=>n.props.className==='dshtw-case'&&ui.content(n).includes('CASE-2'))[0].props.onClick();await ui.settle();
 ui.button('移出本轮').props.onClick();ui.render();ui.field('移除原因（必填）').props.onChange({target:{value:'不需要考虑这种场景'}});ui.render();
 await submitReason(ui);await ui.settle();
 assert.equal(api.round.cases[1].removed?.reason,'不需要考虑这种场景');assert.equal(api.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/remove')).length,1);
 assert.equal(api.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/case')).length,0);assert.equal(api.round.cases[0].execution.status,'not_started');assert.equal(ui.field('执行状态').props.value,'failed','other case draft remains intact');
 assert.ok(ui.content(ui.tree).includes('用例已移出本轮'));ui.button('已移除').props.onClick();await ui.settle();assert.ok(ui.content(ui.tree).includes('不需要考虑这种场景'));
});

test('removal shows pending and local failure feedback, preserves the reason, and can retry',async()=>{
 const api=backend();let release,fail=true;const gate=new Promise(resolve=>{release=resolve});const ui=runtime(async(url,options)=>{if(url.endsWith('/remove')&&fail){await gate;return {ok:false,status:500,json:async()=>({error:'移除请求失败'})};}return api.fetch(url,options)});await ui.settle();
 ui.button('移出本轮').props.onClick();ui.render();ui.field('移除原因（必填）').props.onChange({target:{value:'不需要考虑这种场景'}});ui.render();const pending=submitReason(ui);await ui.settle();assert.equal(ui.button('正在移出…').props.disabled,true);assert.equal(ui.button('取消').props.disabled,true);release();await pending;await ui.settle();
 const form=ui.nodes(n=>n.type==='form'&&n.props.className==='dshtw-form')[0];assert.ok(ui.nodes(n=>n.props.role==='alert',form).some(n=>ui.content(n).includes('移除请求失败')),'failure must be next to confirmation instead of only above the viewport');assert.equal(ui.field('移除原因（必填）').props.value,'不需要考虑这种场景');assert.equal(ui.button('确认移出本轮').props.disabled,false);
 fail=false;await submitReason(ui);await ui.settle();assert.equal(api.round.cases[0].removed?.reason,'不需要考虑这种场景');
});

test('incomplete current result blocks removal with an inline actionable message instead of silence',async()=>{
 const api=backend(),ui=runtime(api.fetch);await ui.settle();ui.field('执行状态').props.onChange({target:{value:'failed'}});ui.render();
 ui.button('移出本轮').props.onClick();ui.render();ui.field('移除原因（必填）').props.onChange({target:{value:'保留当前结果后移除'}});ui.render();await submitReason(ui);await ui.settle();
 const form=ui.nodes(n=>n.type==='form'&&n.props.className==='dshtw-form')[0];assert.ok(ui.nodes(n=>n.props.role==='alert',form).some(n=>ui.content(n).includes('当前用例')));assert.equal(ui.field('移除原因（必填）').props.value,'保留当前结果后移除');assert.equal(api.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/remove')).length,0);
});


test('dependency rejection is shown inline without pretending an execution revision conflict',async()=>{
 const api=backend(),ui=runtime(async(url,options)=>url.endsWith('/remove')?{ok:false,status:409,json:async()=>({error:'请先处理依赖此用例的范围：CASE-2'})}:api.fetch(url,options));await ui.settle();
 ui.button('移出本轮').props.onClick();ui.render();ui.field('移除原因（必填）').props.onChange({target:{value:'调整范围'}});ui.render();await submitReason(ui);await ui.settle();
 const form=ui.nodes(n=>n.type==='form'&&n.props.className==='dshtw-form')[0];assert.ok(ui.nodes(n=>n.props.role==='alert',form).some(n=>ui.content(n).includes('请先处理依赖此用例的范围：CASE-2')));assert.ok(!ui.content(ui.tree).includes('请刷新并核对冲突字段'));assert.equal(ui.field('移除原因（必填）').props.value,'调整范围');assert.equal(api.round.cases[0].removed,null);
});

test('the shared reason form still restores removed cases and reports success',async()=>{
 const api=backend();api.round.cases[0].removed={category:'out_of_scope',reason:'暂不覆盖',at:'2026-11-09T07:00:00Z'};const ui=runtime(api.fetch);await ui.settle();ui.button('已移除').props.onClick();await ui.settle();
 ui.button('恢复到本轮').props.onClick();ui.render();ui.field('恢复原因（必填）').props.onChange({target:{value:'重新纳入本轮'}});ui.render();await submitReason(ui);await ui.settle();assert.equal(api.round.cases[0].removed,null);assert.equal(api.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/restore')).length,1);assert.ok(ui.content(ui.tree).includes('用例已恢复到本轮。'));
});


test('JSON import retains invalid input, then imports cases with a stable retry key',async()=>{
  const api=backend(),posts=[];
  const ui=runtime(async(url,options={})=>{
    if(url.endsWith('/health'))return {ok:true,json:async()=>({capabilities:{caseImport:true,rounds:true}})};
    if(url.endsWith('/cases/import')){posts.push(JSON.parse(options.body));return {ok:true,json:async()=>({source:{requirementId:'REQ-TEST',version:'v2',caseCount:1}})}};
    return api.fetch(url,options);
  });await ui.settle();
  ui.button('导入 JSON 用例').props.onClick();await ui.settle();
  ui.field('用例 JSON').props.onChange({target:{value:'{broken'}});ui.render();
  const form=()=>ui.nodes(n=>n.type==='form'&&n.props['aria-label']==='导入 JSON 用例')[0];
  await form().props.onSubmit({preventDefault(){}});await ui.settle();
  assert.equal(ui.field('用例 JSON').props.value,'{broken');assert.equal(posts.length,0);
  ui.field('用例来源编号').props.onChange({target:{value:'REQ-TEST'}});ui.field('用例来源名称').props.onChange({target:{value:'Synthetic tests'}});ui.field('用例 JSON').props.onChange({target:{value:JSON.stringify([{id:'C1',title:'Save settings',steps:[]}])}});ui.render();
  await form().props.onSubmit({preventDefault(){}});await ui.settle();
  assert.equal(posts.length,1);assert.equal(posts[0].cases[0].id,'C1');assert.ok(posts[0].idempotencyKey);assert.ok(ui.content(ui.tree).includes('已导入 1 条用例'));
});
