import {selectProfile} from './core.js';
import {BUILD,compatibleBackend} from './version.js';

const $ = id => document.getElementById(id);
let domain = '';
let ipBusy = false;

// 绑定跳转事件：确保无论后台服务状态如何，点击按钮均能 100% 打开设置页面
$('configure').onclick = () => {
  chrome.tabs.create({url: chrome.runtime.getURL('options.html') + (domain ? `?domain=${encodeURIComponent(domain)}` : '')});
};

$('dashboard').onclick = () => {
  chrome.tabs.create({url: chrome.runtime.getURL('options.html')});
};

$('sync-ip').onclick = async () => {
  if (ipBusy) return;
  ipBusy = true;
  $('sync-ip').disabled = true;
  $('state').textContent = '正在查询 IP 并更新规则…';
  try {
    if (!await chrome.permissions.request({origins: ['https://ipwho.is/*']})) throw new Error('未授权 IP 查询，配置未修改。');
    const r = await chrome.runtime.sendMessage({type: 'sync-ip', build: BUILD, domain});
    if (!r?.ok) throw new Error(r?.error || '后台未响应，请重新打开检查配置。');
    $('state').textContent = '已保存 IP 匹配配置，请刷新目标网页。';
    $('summary').textContent = `${r.ip} · ${r.country || ''} ${r.city || ''} · ${r.profile.timezone} · ${r.profile.languages.join(', ')} · 位置 ${r.profile.latitude}, ${r.profile.longitude}`;
  } catch (e) {
    $('state').textContent = e.message;
  } finally {
    ipBusy = false;
    $('sync-ip').disabled = false;
  }
};

async function initPopup() {
  const stateEl = $('state');
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
    if (tab?.url) {
      try {
        const url = new URL(tab.url);
        if (['https:', 'http:'].includes(url.protocol)) domain = url.hostname;
      } catch {}
    }
    $('host').textContent = domain || '当前页面不支持注入';

    let r = null;
    try {
      r = await chrome.runtime.sendMessage({type: 'status'});
    } catch {
      // 容错机制：若后台 Service Worker 正在唤醒，直接从本地存储读取规则，防止界面卡死
      const local = await chrome.storage.local.get(['profiles', 'lastError']);
      r = {ok: true, profiles: local?.profiles || [], scriptsAvailable: true, lastError: local?.lastError};
    }

    const profiles = r?.profiles || [];
    const p = selectProfile(domain, profiles);
    $('sync-ip').disabled = !p?.enabled || !r?.scriptsAvailable;
    if (p) domain = p.domain;

    if (!r?.scriptsAvailable) {
      stateEl.textContent = '需要开启「允许用户脚本」';
      stateEl.className = 'notice warning';
    } else if (r?.lastError) {
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
    if (stateEl) {
      stateEl.textContent = e.message || '加载状态失败';
      stateEl.className = 'notice error';
    }
  }
}

initPopup();
