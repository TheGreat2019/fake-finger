import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultProfile} from '../core.js';
import {BUILD,MODE_VALUES,compatibleBackend} from '../version.js';
let listener, scripts=[],rules=[],store={},failRules=false,authorized=true,available=true;
const clone=structuredClone;
globalThis.chrome={
  runtime:{id:'unit-test',getURL:p=>`chrome-extension://unit-test/${p}`,onMessage:{addListener:fn=>listener=fn},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
  permissions:{contains:async()=>authorized},
  storage:{local:{get:async key=>Object.fromEntries((Array.isArray(key)?key:[key]).map(k=>[k,clone(store[k])])),set:async value=>Object.assign(store,clone(value))}},
  userScripts:{getScripts:async()=>{if(!available)throw Error('disabled');return clone(scripts);},register:async value=>{scripts.push(...clone(value));},update:async value=>{for(const s of value)scripts=scripts.map(x=>x.id===s.id?clone(s):x);},unregister:async filter=>{scripts=filter?scripts.filter(s=>!filter.ids.includes(s.id)):[];}},
  declarativeNetRequest:{getDynamicRules:async()=>clone(rules),updateDynamicRules:async({removeRuleIds=[],addRules=[]})=>{if(failRules){failRules=false;throw Error('DNR rejected');}rules=rules.filter(r=>!removeRuleIds.includes(r.id)).concat(clone(addRules));}}
};
await import('../background.js');
const send=message=>new Promise(resolve=>listener(message,{id:'unit-test',url:'chrome-extension://unit-test/options.html'},resolve));
test('后台保存、隔离、停用、回滚、删除与授权',async()=>{
  const p={...defaultProfile(),domain:'example.com'};
  let r=await send({type:'save',profile:p});assert.equal(r.ok,true);assert.equal(store.profiles.length,1);assert.equal(scripts[0].runAt,'document_start');assert.equal(scripts[0].world,'MAIN');assert.equal(rules.length,1);
  r=await send({type:'save',profile:{...p,subdomains:true,emoji:'flags'}});assert.equal(r.ok,true);
  assert.equal(store.profiles[0].emoji,'native');assert.ok(!scripts[0].js[0].code.includes('Path2D'));
  r=await send({type:'save',profile:{...p,domain:'sub.example.com'}});assert.equal(r.ok,false);assert.match(r.error,/重叠/);assert.equal(store.profiles.length,1);
  const before=clone({scripts,rules,profiles:store.profiles});failRules=true;
  r=await send({type:'save',profile:{...p,locale:'de-DE'}});assert.equal(r.ok,false);assert.deepEqual({scripts,rules,profiles:store.profiles},before);
  authorized=false;r=await send({type:'save',profile:{...p,domain:'second.com'}});assert.equal(r.ok,false);authorized=true;
  available=false;r=await send({type:'save',profile:p});assert.equal(r.ok,false);assert.match(r.error,/允许用户脚本/);available=true;
  r=await send({type:'save',profile:{...p,enabled:false}});assert.equal(r.ok,true);assert.equal(rules[0].action.type,'allow');
  r=await send({type:'delete',domain:p.domain});assert.equal(r.ok,true);assert.equal(rules.length,0);assert.equal(scripts.length,0);assert.deepEqual(store.profiles,[]);
});
test('拒绝非扩展页面的配置消息',()=>{
  assert.equal(listener({type:'delete',domain:'example.com'},{id:'unit-test',url:'https://example.com'},()=>{throw Error('unexpected callback');}),false);
});

test('每个域名只注入自身配置，停用规则不注入脚本',async()=>{
  store.profiles=[];scripts=[];rules=[];
  for(const domain of ['first.example','second.example'])assert.equal((await send({type:'save',profile:{...defaultProfile(),domain}})).ok,true);
  assert.equal(scripts.length,2);
  const first=scripts.find(s=>s.matches.includes('https://first.example/*'));
  assert.ok(first.js[0].code.includes('first.example'));assert.ok(!first.js[0].code.includes('second.example'));
  await send({type:'save',profile:{...defaultProfile(),domain:'first.example',enabled:false}});
  assert.equal(scripts.length,1);assert.ok(scripts[0].matches.includes('https://second.example/*'));
  store.profiles=[];scripts=[];rules=[];
});

test('IP 同步保存地区快照，保留隐私与身份；失败不覆盖规则',async()=>{
  const oldFetch=globalThis.fetch;
  const p={...defaultProfile(),domain:'ip.example',fonts:'native',ua:'custom',subdomains:true};
  store.profiles=[p];
  try{
    globalThis.fetch=async()=>({ok:true,json:async()=>({success:true,ip:'203.0.113.1',country_code:'JP',timezone:{id:'Asia/Tokyo'},latitude:35,longitude:139})});
    let r=await send({type:'sync-ip',build:BUILD,domain:p.domain});
    assert.equal(r.ok,true);assert.equal(r.profile.timezone,'Asia/Tokyo');assert.equal(r.profile.locale,'ja-JP');assert.equal(r.profile.locationEnabled,true);assert.equal(r.profile.fonts,'native');assert.equal(r.profile.ua,'custom');assert.equal(r.profile.subdomains,true);
    const before=clone(store.profiles);
    globalThis.fetch=async()=>{throw Error('IP 服务不可用');};
    r=await send({type:'sync-ip',build:BUILD,domain:p.domain});assert.equal(r.ok,false);assert.deepEqual(store.profiles,before);
  }finally{globalThis.fetch=oldFetch;store.profiles=[];}
});

test('清理需要正确版本和一次性预览，范围变化拒绝删除',async()=>{
  store.profiles=[{...defaultProfile(),domain:'clean.example'}];
  let urls=[],removed=0;
  chrome.history={search:async()=>urls};chrome.cookies={getAll:async()=>[]};chrome.tabs={query:async()=>[]};
  chrome.browsingData={remove:async()=>{removed++;}};
  const msg={domain:'clean.example',build:BUILD};
  let r=await send({...msg,type:'clear-site-data',token:'invented'});assert.equal(r.ok,false);assert.equal(removed,0);
  r=await send({...msg,type:'preview-clean',build:'old'});assert.equal(r.ok,false);
  r=await send({...msg,type:'preview-clean'});assert.equal(r.ok,true);
  urls=[{url:'https://clean.example:8443'}];
  r=await send({...msg,type:'clear-site-data',token:r.token});assert.equal(r.ok,false);assert.match(r.error,/范围发生变化/);assert.equal(removed,0);
  const preview=await send({...msg,type:'preview-clean'});
  r=await send({...msg,type:'clear-site-data',token:preview.token});assert.equal(r.ok,true);assert.equal(removed,2);assert.equal(store.profiles.length,1);
  r=await send({...msg,type:'clear-site-data',token:preview.token});assert.equal(r.ok,false);assert.equal(removed,2);
  store.profiles=[];
});
test('状态握手、旧版错误复现与全部 18 种保护组合可保存',async()=>{
  assert.equal(compatibleBackend(await send({type:'status'})),true);
  assert.equal(compatibleBackend({profiles:[],scriptsAvailable:true}),false);
  assert.equal(compatibleBackend({build:'1.0.1',modes:{fonts:['normalize','native'],emoji:['native','text'],webrtc:['block','native']}}),false);
  // This is the old validator that rejects the new default form values.
  const legacyAccepts=p=>['normalize','native'].includes(p.fonts)&&['native','text'].includes(p.emoji);
  assert.equal(legacyAccepts(defaultProfile()),false);
  for(const fonts of MODE_VALUES.fonts)for(const emoji of MODE_VALUES.emoji)for(const webrtc of MODE_VALUES.webrtc){
    const r=await send({type:'save',build:BUILD,profile:{...defaultProfile(),domain:'modes.example',fonts,emoji,webrtc}});
    assert.equal(r.ok,true,JSON.stringify({fonts,emoji,webrtc,error:r.error}));
  }
  let r=await send({type:'save',build:'old-ui',profile:{...defaultProfile(),domain:'modes.example'}});assert.equal(r.ok,false);assert.match(r.error,/版本/);
  r=await send({type:'save',profile:{...defaultProfile(),domain:'modes.example',emoji:''}});assert.equal(r.ok,false);assert.match(r.error,/Emoji模式无效/);
  await send({type:'delete',domain:'modes.example'});
});
