import {MODE_VALUES} from './version.js';
export const REGIONS = {
  US: ['美国 · 纽约', 'America/New_York', 'en-US', ['en-US','en'], 40.7128,-74.006],
  GB: ['英国 · 伦敦','Europe/London','en-GB',['en-GB','en'],51.5074,-0.1278],
  DE: ['德国 · 柏林','Europe/Berlin','de-DE',['de-DE','de','en'],52.52,13.405],
  FR: ['法国 · 巴黎','Europe/Paris','fr-FR',['fr-FR','fr','en'],48.8566,2.3522],
  JP: ['日本 · 东京','Asia/Tokyo','ja-JP',['ja-JP','ja','en'],35.6762,139.6503],
  KR: ['韩国 · 首尔','Asia/Seoul','ko-KR',['ko-KR','ko','en'],37.5665,126.978],
  SG: ['新加坡','Asia/Singapore','en-SG',['en-SG','en','zh-CN'],1.3521,103.8198],
  CN: ['中国 · 上海','Asia/Shanghai','zh-CN',['zh-CN','zh','en'],31.2304,121.4737],
  TW: ['中国台湾 · 台北','Asia/Taipei','zh-TW',['zh-TW','zh','en'],25.033,121.5654],
  HK: ['中国香港','Asia/Hong_Kong','zh-HK',['zh-HK','zh','en'],22.3193,114.1694],
  AU: ['澳大利亚 · 悉尼','Australia/Sydney','en-AU',['en-AU','en'],-33.8688,151.2093],
  IN: ['印度 · 加尔各答','Asia/Kolkata','en-IN',['en-IN','en','hi'],22.5726,88.3639]
};
export function uaPresets(nativeUA = '') {
  const version = nativeUA.match(/Chrome\/([\d.]+)/)?.[1] || '135.0.0.0';
  return [
    ['Windows · Chrome',`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,'Win32','Windows'],
    ['macOS · Chrome',`Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,'MacIntel','macOS'],
    ['Linux · Chrome',`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,'Linux x86_64','Linux'],
    ['Windows · Firefox 128 ESR','Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0','Win32','Windows'],
    ['macOS · Firefox 128 ESR','Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0','MacIntel','macOS'],
    ['Linux · Firefox 128 ESR','Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0','Linux x86_64','Linux'],
    ['macOS · Safari 17.6','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15','MacIntel','macOS'],
    ['Windows · Edge',`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36 Edg/${version}`,'Win32','Windows']
  ];
}
export function defaultProfile() {
  return {domain:'', subdomains:false, enabled:true, timezone:'America/New_York', locale:'en-US', languages:['en-US','en'], identityOS:'random', identityBrowser:'random', identityVersion:'random', fonts:'strict', emoji:'native', webrtc:'block', ua:'', platform:'Win32', uaPlatform:'Windows', locationEnabled:false, latitude:40.7128, longitude:-74.006, accuracy:100};
}
export function randomUA(nativeUA='',options={}) {
  const current=Number(nativeUA.match(/Chrome\/(\d+)/)?.[1])||135;
  const min=Number(options.minMajor??Math.max(100,current-5)),max=Number(options.maxMajor??current);
  if(!Number.isInteger(min)||!Number.isInteger(max)||min<100||max>999||min>max)throw new Error('Chrome 主版本范围需为 100–999，且最小值不大于最大值。');
  const integer=(lo,hi)=>{const range=hi-lo+1,limit=Math.floor(0x100000000/range)*range;let n;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=limit);return lo+n%range;};
  const pick=list=>list[integer(0,list.length-1)];
  const os=options.os&&options.os!=='random'?options.os:pick(['Windows','macOS','Linux']);
  if(!['Windows','macOS','Linux'].includes(os))throw new Error('随机系统类型无效。');
  const deep=options.mode==='parameters';
  if(options.mode && !['compatible','parameters'].includes(options.mode))throw new Error('随机模式无效。');
  const chromium=deep?`${integer(min,max)}.${integer(0,9)}.${integer(1000,9999)}.${integer(1,250)}`:`${integer(min,max)}.0.0.0`;
  const webkit=deep?`${integer(535,537)}.${integer(1,99)}`:'537.36';
  const mozilla=deep?`${integer(4,5)}.${integer(0,9)}`:'5.0';
  let system,platform;
  if(os==='Windows'){system=`Windows NT ${deep?pick(['6.1','6.2','6.3','10.0']):'10.0'}; ${deep?pick(['Win64; x64','WOW64','Win64; ARM64']):'Win64; x64'}`;platform='Win32';}
  if(os==='macOS'){system=`Macintosh; Intel Mac OS X ${deep?`${integer(10,15)}_${integer(0,7)}_${integer(0,9)}`:'10_15_7'}`;platform='MacIntel';}
  if(os==='Linux'){const arch=deep?pick(['x86_64','aarch64','i686']):'x86_64';system=`X11; Linux ${arch}`;platform=`Linux ${arch}`;}
  return {ua:`Mozilla/${mozilla} (${system}) AppleWebKit/${webkit} (KHTML, like Gecko) Chrome/${chromium} Safari/${webkit}`,platform,uaPlatform:os};
}
export function normalizeDomain(input) {
  const raw = String(input).trim();
  if (!raw || /[\s*]/.test(raw)) throw new Error('请输入单个域名，不要包含通配符或空格。');
  const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  if (raw.replace(/^https?:\/\//i,'').split('/')[0].includes(':')) throw new Error('请只填写域名，不包含端口。');
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') throw new Error('请只填写域名（不含端口、路径、账号或查询参数）。');
  const host = url.hostname.replace(/\.$/,'').toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host)) throw new Error('域名格式不正确，暂不支持 IPv6 地址。');
  return host;
}
export function validateProfile(raw) {
  const p = {...defaultProfile(), ...raw, domain:normalizeDomain(raw.domain)};
  if(!['native','flags','text'].includes(p.emoji))throw new Error('Emoji模式无效');
  p.emoji='native';
  for (const key of ['enabled','subdomains','locationEnabled']) if (typeof p[key] !== 'boolean') throw new Error('开关配置无效。');
  if (typeof p.timezone !== 'string' || !p.timezone) throw new Error('时区不能为空。');
  new Intl.DateTimeFormat('en', {timeZone:p.timezone});
  if (typeof p.locale !== 'string' || !p.locale) throw new Error('Intl 区域不能为空。');
  p.locale = Intl.getCanonicalLocales(p.locale)[0];
  if (!Intl.DateTimeFormat.supportedLocalesOf(p.locale).length || !Intl.NumberFormat.supportedLocalesOf(p.locale).length) throw new Error('当前浏览器不支持该 Intl 区域，请选择常用的语言地区标签。');
  if (!Array.isArray(p.languages) || !p.languages.length || p.languages.length > 10) throw new Error('请填写 1–10 个语言标签。');
  p.languages = Intl.getCanonicalLocales(p.languages);
  for(const [key,values]of Object.entries(MODE_VALUES))if(!values.includes(p[key])){
    const name={fonts:'中文字体',emoji:'Emoji',webrtc:'WebRTC'}[key];
    throw new Error(`${name}模式无效（${String(p[key]??'未选择')}）。请重新选择；若刚更新过文件，请重载扩展后台。`);
  }
  for (const k of ['ua','platform','uaPlatform']) if (typeof p[k] !== 'string' || /[\r\n]/.test(p[k]) || p[k].length > 1024) throw new Error('UA 配置无效。');
  if (!['Windows','macOS','Linux','Android','iOS'].includes(p.uaPlatform)) throw new Error('UA 系统平台无效。');
  for (const [key,min,max] of [['latitude',-90,90],['longitude',-180,180],['accuracy',1,100000]]) {
    if (p[key] === '' || p[key] == null || !Number.isFinite(Number(p[key])) || Number(p[key]) < min || Number(p[key]) > max) throw new Error(`${key} 超出有效范围。`);
    p[key] = Number(p[key]);
  }
  return p;
}
export function matches(host, p) { return host === p.domain || (p.subdomains && host.endsWith('.'+p.domain)); }
export function selectProfile(host, profiles) { return profiles.filter(p=>matches(host,p)).sort((a,b)=>b.domain.length-a.domain.length)[0]; }
export function patterns(p) { return [`http://${p.subdomains?'*.':''}${p.domain}/*`,`https://${p.subdomains?'*.':''}${p.domain}/*`]; }
export function acceptLanguage(languages) { return languages.map((l,i)=>i?`${l};q=${(1-i*0.1).toFixed(1)}`:l).join(','); }
export function headerRules(profiles) {
  return profiles.map((p,i)=>{
    const headers = p.enabled ? [{header:'Accept-Language',operation:'set',value:acceptLanguage(p.languages)}] : [];
    if (p.enabled && p.ua) {
      headers.push({header:'User-Agent',operation:'set',value:p.ua});
      for (const header of ['sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform','sec-ch-ua-platform-version','sec-ch-ua-arch','sec-ch-ua-bitness','sec-ch-ua-model','sec-ch-ua-full-version','sec-ch-ua-full-version-list','sec-ch-ua-wow64','sec-ch-ua-form-factors']) headers.push({header,operation:'remove'});
    }
    const domain = p.domain.replace(/\./g,'\\.');
    return {id:i+1,priority:p.domain.length+1,action:headers.length?{type:'modifyHeaders',requestHeaders:headers}:{type:'allow'},condition:{regexFilter:`^https?://${p.subdomains?'([a-z0-9-]+\\.)*':''}${domain}(:[0-9]+)?/`,isUrlFilterCaseSensitive:false}};
  });
}
export function profileFromIP(data) {
  if (!data || data.success === false || !data.timezone?.id || !data.country_code || !Number.isFinite(data.latitude) || !Number.isFinite(data.longitude)) throw new Error('IP 服务未返回完整的位置与时区信息。');
  const region = REGIONS[data.country_code];
  return {timezone:data.timezone.id, locale:region?.[2] || 'en-US', languages:region?.[3] || ['en-US','en'], latitude:data.latitude,longitude:data.longitude,accuracy:10000,fonts:'strict', locationEnabled:true, regionKnown:!!region};
}
