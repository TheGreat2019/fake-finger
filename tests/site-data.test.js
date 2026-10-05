import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectOrigins,previewSiteData,clearSiteData} from '../site-data.js';

test('清理范围保留端口、严格域名边界及子域名开关',()=>{
  const p={domain:'example.com',subdomains:false};
  const urls=['https://a.example.com/x','http://example.com:8080/a','https://evil-example.com','https://example.com.evil.org','file:///example.com','bad'];
  assert.deepEqual(collectOrigins(p,urls),['http://example.com','http://example.com:8080','https://example.com']);
  const all=collectOrigins({...p,subdomains:true},urls,[{domain:'.b.example.com'},{domain:'evil-example.com'}]);
  assert.ok(all.includes('https://a.example.com'));assert.ok(all.includes('https://b.example.com'));
  assert.ok(all.every(o=>!o.includes('evil')));
});

test('清理只关闭仍匹配的标签，始终带来源过滤，先停止 Service Worker',async()=>{
  const calls=[];
  const api={permissions:{contains:async()=>true},history:{search:async()=>[{url:'https://a.example.com:8443/x'}]},cookies:{getAll:async()=>[]},tabs:{query:async()=>[{id:1,url:'https://a.example.com'},{id:2,url:'https://example.com'},{id:3,url:'https://other.org'}],get:async id=>({url:id===1?'https://other.org':'https://example.com'}),remove:async id=>calls.push(['close',id])},browsingData:{remove:async(o,t)=>calls.push(['remove',o,t])}};
  const plan=await previewSiteData(api,{domain:'example.com',subdomains:true});
  assert.deepEqual(plan.tabIds,[1,2]);assert.ok(plan.origins.includes('https://a.example.com:8443'));
  await clearSiteData(api,plan);
  assert.deepEqual(calls[0],['close',2]);assert.equal(calls.length,3);
  assert.deepEqual(calls[1][2],{serviceWorkers:true});
  assert.deepEqual(calls[2][1].origins,plan.origins);assert.equal(calls[2][2].cookies,true);
  assert.equal(calls[2][2].history,undefined);assert.equal(calls[2][2].passwords,undefined);
  await assert.rejects(clearSiteData(api,{origins:[]}),/范围为空/);
  api.permissions.contains=async()=>false;
  await assert.rejects(previewSiteData(api,plan),/授权/);
});
