export const SYSTEMS=['Windows','macOS','Linux'];
export const BROWSERS=['Chrome','Edge','Firefox','Safari'];
export const compatible=(os,browser)=>browser!=='Safari'||os==='macOS';
const pick=list=>{const n=new Uint32Array(1),limit=Math.floor(4294967296/list.length)*list.length;do{crypto.getRandomValues(n);}while(n[0]>=limit);return list[n[0]%list.length];};
// Released historical templates, not invented patch/build components or latest-version claims.
const versions={Firefox:['140.0','128.0'],Safari:['18.6','17.6'],Edge:['134.0.3124.66','134.0.3124.83']};
export function generateIdentity(nativeUA,{os='random',browser='random',strategy='random'}={}){
  if(!['random',...SYSTEMS].includes(os)||!['random',...BROWSERS].includes(browser)||!['random','preferred'].includes(strategy))throw new Error('浏览器身份选项无效。');
  const pairs=SYSTEMS.flatMap(s=>BROWSERS.filter(b=>compatible(s,b)&&(os==='random'||os===s)&&(browser==='random'||browser===b)).map(b=>[s,b]));
  if(!pairs.length)throw new Error('该系统不支持所选浏览器；Safari 仅支持 macOS。');
  const [system,brand]=pick(pairs);
  const current=Number(nativeUA.match(/Chrome\/(\d+)/)?.[1])||135;
  const pool=brand==='Chrome'?[current,current-1,current-2].map(n=>`${n}.0.0.0`):versions[brand];
  const version=strategy==='preferred'?pool[0]:pick(pool);
  const platform={Windows:'Win32',macOS:'MacIntel',Linux:'Linux x86_64'}[system];
  let host={Windows:'Windows NT 10.0; Win64; x64',macOS:'Macintosh; Intel Mac OS X 10_15_7',Linux:'X11; Linux x86_64'}[system];
  let ua;
  if(brand==='Firefox'){
    if(system==='macOS')host='Macintosh; Intel Mac OS X 10.15';
    ua=`Mozilla/5.0 (${host}; rv:${version}) Gecko/20100101 Firefox/${version}`;
  }else if(brand==='Safari')ua=`Mozilla/5.0 (${host}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${version} Safari/605.1.15`;
  else ua=`Mozilla/5.0 (${host}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${brand==='Edge'?version.split('.')[0]+'.0.0.0':version} Safari/537.36${brand==='Edge'?' Edg/'+version:''}`;
  return {ua,platform,uaPlatform:system,identityOS:os,identityBrowser:browser,identityVersion:strategy,identitySummary:`${system} · ${brand} ${version}`};
}
