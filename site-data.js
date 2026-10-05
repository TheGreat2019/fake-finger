import {matches, normalizeDomain} from './core.js';

export const CLEAN_PERMISSIONS = ['browsingData', 'history', 'cookies'];
export const CLEAN_TYPES = {cache:true, cacheStorage:true, fileSystems:true, indexedDB:true, localStorage:true, serviceWorkers:true, webSQL:true};

// No wildcard origins and never fall back to a browser-wide deletion.
export function collectOrigins(profile, urls=[], cookies=[]) {
  const domain=normalizeDomain(profile.domain);
  const scope={domain,subdomains:profile.subdomains===true};
  const origins=new Set([`http://${domain}`,`https://${domain}`]);
  for(const raw of urls) {
    try { const u=new URL(raw); if(['http:','https:'].includes(u.protocol)&&matches(u.hostname,scope))origins.add(u.origin); } catch {}
  }
  for(const cookie of cookies) {
    const host=cookie.domain.replace(/^\./,'').toLowerCase();
    if(matches(host,scope)){origins.add(`http://${host}`);origins.add(`https://${host}`);}
  }
  return [...origins].sort();
}

export async function previewSiteData(api, profile) {
  if(!await api.permissions.contains({permissions:CLEAN_PERMISSIONS}))throw new Error('请先授权站点数据清理权限。');
  const [history,cookies,tabs]=await Promise.all([
    api.history.search({text:profile.domain,startTime:0,maxResults:10000}),
    api.cookies.getAll({domain:profile.domain}),
    api.tabs.query({})
  ]);
  const origins=collectOrigins(profile,[...history.map(x=>x.url),...tabs.flatMap(t=>[t.url,t.pendingUrl])],cookies);
  const tabIds=tabs.filter(t=>[t.url,t.pendingUrl].some(raw=>{try{const u=new URL(raw);return ['http:','https:'].includes(u.protocol)&&matches(u.hostname,profile);}catch{return false;}})).map(t=>t.id);
  return {domain:profile.domain,subdomains:profile.subdomains,origins,tabIds,historyLimited:history.length>=10000};
}

export async function clearSiteData(api, plan) {
  if(!plan.origins?.length)throw new Error('清理范围为空，已取消。');
  // Close only the reviewed tabs; closing destroys their live sessionStorage.
  for(const id of plan.tabIds){
    let tab;try{tab=await api.tabs.get(id);}catch{continue;}
    if([tab.url,tab.pendingUrl].some(raw=>{try{const u=new URL(raw);return ['http:','https:'].includes(u.protocol)&&matches(u.hostname,plan);}catch{return false;}}))await api.tabs.remove(id);
  }
  const options={since:0,origins:plan.origins,originTypes:{unprotectedWeb:true,protectedWeb:true,extension:false}};
  await api.browsingData.remove(options,{serviceWorkers:true});
  await api.browsingData.remove(options,{...CLEAN_TYPES,cookies:true});
  return {origins:plan.origins.length};
}
