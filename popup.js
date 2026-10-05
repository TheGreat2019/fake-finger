import {selectProfile} from './core.js';
import {BUILD,compatibleBackend} from './version.js';

const $ = id => document.getElementById(id);
let domain = '';
let ipBusy=false;
$('sync-ip').onclick=async()=>{
  if(ipBusy)return;ipBusy=true;$('sync-ip').disabled=true;
  $('state').textContent='正在查询 IP 并更新规则…';
  try{
    if(!await chrome.permissions.request({origins:['https://ipwho.is/*']}))throw new Error('未授权 IP 查询，配置未修改。');
    const r=await chrome.runtime.sendMessage({type:'sync-ip',build:BUILD,domain});
    if(!r?.ok)throw new Error(r?.error||'后台未响应，请重新打开检查配置。');
    $('state').textContent='已保存 IP 匹配配置，请刷新目标网页。';
    $('summary').textContent=`${r.ip} · ${r.country||''} ${r.city||''} · ${r.profile.timezone} · ${r.profile.languages.join(', ')} · 位置 ${r.profile.latitude}, ${r.profile.longitude}`;
  }catch(e){$('state').textContent=e.message;}
  finally{ipBusy=false;$('sync-ip').disabled=false;}
};

// Click ripple feedback
function addRipple(e) {
  const target = e.currentTarget;
  if (!target || target.disabled) return;
  const rect = target.getBoundingClientRect();
  const circle = document.createElement('span');
  const d = Math.max(rect.width, rect.height);
  circle.style.width = circle.style.height = `${d}px`;
  circle.style.left = `${e.clientX - rect.left - d / 2}px`;
  circle.style.top = `${e.clientY - rect.top - d / 2}px`;
  circle.className = 'ripple';
  const existing = target.querySelector('.ripple');
  if (existing) existing.remove();
  target.appendChild(circle);
  circle.addEventListener('animationend', () => circle.remove());
}

document.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (btn) addRipple({ currentTarget: btn, clientX: e.clientX, clientY: e.clientY });
});

$('configure').onclick = () => {
  chrome.tabs.create({url: chrome.runtime.getURL('options.html') + (domain ? `?domain=${encodeURIComponent(domain)}` : '')});
};

$('dashboard').onclick = () => {
  chrome.runtime.openOptionsPage();
};

try {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  const url = new URL(tab.url || 'about:blank');
  if (['https:', 'http:'].includes(url.protocol)) domain = url.hostname;
  $('host').textContent = domain || '当前页面不支持注入';
  
  const r = await chrome.runtime.sendMessage({type: 'status'});
  if (!r?.ok) throw new Error(r?.error || '无法读取配置');
  
  const p = selectProfile(domain, r.profiles);
  $('sync-ip').disabled=!p?.enabled||!compatibleBackend(r)||!r.scriptsAvailable;
  if (p) domain = p.domain;
  
  const stateEl = $('state');
  if (!r.scriptsAvailable) {
    stateEl.textContent = '需要开启「允许用户脚本」';
    stateEl.className = 'notice warning';
  } else if (r.lastError) {
    stateEl.textContent = '配置恢复异常，请打开规则管理';
    stateEl.className = 'notice warning';
  } else if (p?.enabled) {
    stateEl.textContent = '● 已配置 · 新加载的页面生效';
    stateEl.className = 'notice';
  } else {
    stateEl.textContent = '○ 当前域名未启用伪装';
    stateEl.className = 'notice';
  }

  $('summary').textContent = p?.enabled
    ? `${p.timezone} · ${p.languages.join(', ')}。WebRTC ${p.webrtc === 'block' ? '阻断' : '保持原始'}。修改后请刷新网页。`
    : '仅在已保存并启用规则的域名上修改浏览器环境。';
} catch (e) {
  const stateEl = $('state');
  stateEl.textContent = e.message;
  stateEl.className = 'notice error';
}
