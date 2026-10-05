import {validateProfile, patterns, headerRules, profileFromIP, matches} from './core.js';
import {installProfile} from './inject.js';
import {BUILD,MODE_VALUES} from './version.js';
import {auditEnvironment} from './audit.js';
import {previewSiteData,clearSiteData} from './site-data.js';

const cleaningPlans=new Map();

let queue = Promise.resolve();
function serialize(fn) { const task = queue.then(fn); queue = task.catch(()=>{}); return task; }
async function read() { return ((await chrome.storage.local.get('profiles')).profiles || []).map(p=>({...p,emoji:'native'})); }
async function scriptsAvailable() {
  try { await chrome.userScripts.getScripts(); return true; } catch { return false; }
}
async function apply(profiles) {
  profiles=profiles.map(p=>({...p,emoji:'native'}));
  const oldScripts = await chrome.userScripts.getScripts();
  const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
  // Each matching document receives only its own profile; disabled rules inject nothing.
  const source=installProfile.toString();
  const scripts=profiles.filter(p=>p.enabled).map((p,i)=>({id:`disguise-profile-${i}`,matches:patterns(p),allFrames:true,runAt:'document_start',world:'MAIN',js:[{code:`(${source})(${JSON.stringify([p])});`}]}));
  // Roll back both registries if Chrome rejects either part of a save.
  try {
    const removed=oldScripts.filter(s=>!scripts.some(n=>n.id===s.id)).map(s=>s.id);
    const added=scripts.filter(s=>!oldScripts.some(o=>o.id===s.id));
    const changed=scripts.filter(s=>oldScripts.some(o=>o.id===s.id));
    if(removed.length)await chrome.userScripts.unregister({ids:removed});
    if(changed.length)await chrome.userScripts.update(changed);
    if(added.length)await chrome.userScripts.register(added);
    await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:oldRules.map(r=>r.id),addRules:headerRules(profiles)});
    await chrome.storage.local.set({profiles, lastError:null});
  } catch(error) {
    try {
      await chrome.userScripts.unregister();
      if (oldScripts.length) await chrome.userScripts.register(oldScripts);
      const now = await chrome.declarativeNetRequest.getDynamicRules();
      await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:now.map(r=>r.id),addRules:oldRules});
    } catch(rollback) { throw new Error(`${error.message}；回滚失败：${rollback.message}，请重新加载插件。`); }
    throw error;
  }
}
async function handle(message) {
  if(message.type==='sync-ip'){
    if(message.build!==BUILD)throw new Error('界面与后台版本不同，请重载扩展。');
    const result=await handle({type:'ip'});
    return serialize(async()=>{
      const profiles=await read();
      const index=profiles.findIndex(p=>p.domain===message.domain);
      if(index<0||!profiles[index].enabled)throw new Error('请先保存并启用当前域名规则。');
      if(!await scriptsAvailable())throw new Error('请先开启允许用户脚本。');
      if(!await chrome.permissions.contains({origins:patterns(profiles[index])}))throw new Error('站点权限已失效，请在工作台重新保存并授权。');
      const {regionKnown,fonts,...region}=result.profile;
      if(!regionKnown)throw new Error('该 IP 所在国家暂无语言预设，请在工作台手动匹配；未修改配置。');
      profiles[index]=validateProfile({...profiles[index],...region});
      await apply(profiles);
      return {profile:profiles[index],ip:result.ip,country:result.country,city:result.city};
    });
  }
  if(message.type==='preview-clean' || message.type==='clear-site-data')return serialize(async()=>{
    if(message.build!==BUILD)throw new Error('界面与后台版本不一致，请重载扩展。');
    const p=(await read()).find(p=>p.domain===message.domain);
    if(!p)throw new Error('请先保存并选择域名规则。');
    if(!await chrome.permissions.contains({origins:patterns(p)}))throw new Error('该域名访问权限已失效，请重新保存并授权。');
    const plan=await previewSiteData(chrome,p);
    if(message.type==='preview-clean'){
      const token=crypto.randomUUID();
      cleaningPlans.clear();cleaningPlans.set(token,{plan,expires:Date.now()+300000});
      return {plan,token};
    }
    const prior=cleaningPlans.get(message.token);cleaningPlans.delete(message.token);
    if(!prior || prior.expires<Date.now())throw new Error('清理预览已过期，请重新预览。');
    if(JSON.stringify(prior.plan)!==JSON.stringify(plan))throw new Error('站点或标签页范围发生变化，请重新预览后确认。');
    try{return await clearSiteData(chrome,plan);}catch(e){throw new Error(`清理未全部完成，部分数据或标签页可能已删除：${e.message}。请重新预览后重试。`);}
  });
  if (message.type === 'status') return {build:BUILD,modes:MODE_VALUES,profiles:await read(), scriptsAvailable:await scriptsAvailable(), ...(await chrome.storage.local.get('lastError'))};
  if(message.type==='audit'){
    const p=(await read()).find(p=>p.domain===message.domain);
    if(!p?.enabled)throw new Error('请先保存并启用该域名规则。');
    const tabs=await chrome.tabs.query({url:patterns(p)});
    const tab=tabs.filter(t=>t.id&&t.url&&matches(new URL(t.url).hostname,p)).sort((a,b)=>Number(b.active)-Number(a.active)||(b.lastAccessed||0)-(a.lastAccessed||0))[0];
    if(!tab)throw new Error('请先在另一个标签页打开目标网站，刷新后再检测。');
    const results=await chrome.userScripts.execute({target:{tabId:tab.id},world:'MAIN',js:[{code:`(${auditEnvironment.toString()})()`}]});
    if(results[0]?.error||!results[0]?.result)throw new Error(results[0]?.error||'页面检测没有返回结果，请刷新目标页重试。');
    return {report:results[0].result};
  }
  if (message.type === 'save' || message.type === 'delete' || message.type === 'retry') {
    return serialize(async()=>{
      if(message.build && message.build!==BUILD)throw new Error(`界面版本 ${message.build} 与后台 ${BUILD} 不一致，请保存草稿并重载扩展。`);
      if (!await scriptsAvailable()) throw new Error('请在 chrome://extensions → 插件详情中开启“允许用户脚本”，再重新打开设置页。');
      let profiles = await read();
      if (message.type === 'save') {
        const p = validateProfile(message.profile);
        if (!await chrome.permissions.contains({origins:patterns(p)})) throw new Error('尚未获得该域名访问权限，请再次点击保存并允许授权。');
        profiles = profiles.filter(x=>x.domain!==p.domain);
        if (profiles.some(x=>matches(x.domain,p)||matches(p.domain,x))) throw new Error('该域名与现有规则的作用范围重叠。请编辑现有规则，或取消包含子域名后分别配置。');
        if (profiles.length >= 100) throw new Error('最多支持 100 条域名规则。');
        profiles.push(p);
      } else if (message.type === 'delete') profiles = profiles.filter(p=>p.domain!==message.domain);
      await apply(profiles);
      return {profiles};
    });
  }
  if (message.type === 'ip') {
    const response = await fetch('https://ipwho.is/',{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error(`IP 查询失败：HTTP ${response.status}`);
    const data = await response.json();
    return {profile:profileFromIP(data),ip:data.ip,country:data.country,city:data.city};
  }
  throw new Error('未知操作。');
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  handle(message).then(data=>reply({ok:true,...data}),error=>reply({ok:false,error:error.message}));
  return true;
});
async function restore() {
  try { await serialize(()=>read().then(apply)); }
  catch(error) {
    // Avoid leaving header-only masking after script access has been revoked.
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds:rules.map(r=>r.id)});
    await chrome.storage.local.set({lastError:error.message});
  }
}
chrome.runtime.onInstalled.addListener(async()=>{
  await restore();
  const {editorDraft}=await chrome.storage.local.get('editorDraft');
  if(editorDraft?.reopen){
    await chrome.storage.local.set({editorDraft:{...editorDraft,reopen:false}});
    await chrome.tabs.create({url:chrome.runtime.getURL('options.html?restoreDraft=1')});
  }
});
chrome.runtime.onStartup.addListener(restore);
