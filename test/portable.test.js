import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CONFIG} from '../report-publisher.js';
import {createDispatcher} from '../index.js';

test('public defaults contain no account, organization directory or machine path',()=>{
  assert.equal(DEFAULT_CONFIG.binary,'lark-cli');
  assert.equal(DEFAULT_CONFIG.expectedUserName,'');
  assert.equal(DEFAULT_CONFIG.productDirectory,'');
  assert.equal(DEFAULT_CONFIG.historyDirectory,'');
});

test('external publishing is opt-in and rejected before queuing any write',async()=>{
  let queued=0;
  const dispatch=createDispatcher({queueReport:async()=>{queued++;return {round:{},job:{id:'job'}}}},{jobs:{run(){throw Error('must not publish')}}});
  const health=await (await dispatch(new Request('http://localhost/api/test-workbench/health'))).json();
  assert.equal(health.capabilities.reportPublish,false);
  assert.equal(health.capabilities.caseImport,true);
  const response=await dispatch(new Request('http://localhost/api/test-workbench/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({mode:'publish'})}));
  assert.equal(response.status,503);
  assert.equal(queued,0);
});


test('JSON import endpoint forwards the case source and returns HTTP 201',async()=>{
 let received;const source={requirementId:'DEMO',version:'v1',caseCount:1,authority:'provisional'};
 const dispatch=createDispatcher({importCases:async value=>{received=value;return source}});
 const input={requirementId:'DEMO',title:'Synthetic cases',cases:[{id:'C1',title:'Save'}],idempotencyKey:'retry-key'};
 const response=await dispatch(new Request('http://localhost/api/test-workbench/cases/import',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));
 assert.equal(response.status,201);assert.deepEqual((await response.json()).source,source);assert.deepEqual(received,input);
});
