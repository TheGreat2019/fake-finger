import {generateIdentity,compatible} from './identity.js';
import {REGIONS, defaultProfile, validateProfile, patterns} from './core.js';
import {BUILD, MODE_OPTIONS, compatibleBackend} from './version.js';
import {CLEAN_PERMISSIONS} from './site-data.js';

const $ = id => document.getElementById(id);
let identityState={platform:'Win32',uaPlatform:'Windows',emoji:'native'};
let profiles = [], currentDomain = null, backendReady = false, saving = false;
let cleanPreview=null;
function resetCleanPreview(){cleanPreview=null;$('clear-site-data').hidden=true;$('clean-output').textContent='';}
const fields = Object.keys(defaultProfile());

// Add click ripple feedback to any button or interactive element
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
  const btn = e.target.closest('button, .profile-item');
  if (btn) addRipple({ currentTarget: btn, clientX: e.clientX, clientY: e.clientY });
});

// Flash element briefly to provide tactile visual feedback
function flashField(...elements) {
  for (const el of elements) {
    if (!el) continue;
    el.classList.remove('field-flash');
    void el.offsetWidth;
    el.classList.add('field-flash');
  }
}

// Flash button text briefly to confirm action
function flashButton(btn, tempText, duration = 1200) {
  if (!btn) return;
  const original = btn.innerHTML;
  btn.innerHTML = tempText;
  setTimeout(() => {
    btn.innerHTML = original;
  }, duration);
}

async function send(message) {
  const r = await chrome.runtime.sendMessage({...message, build: BUILD});
  if (!r?.ok) throw new Error(r?.error || '扩展后台未响应，请重新加载扩展。');
  return r;
}

function notice(text, error = false) {
  const statusEl = $('status');
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
  statusEl.classList.remove('notice-pulse');
  void statusEl.offsetWidth;
  statusEl.classList.add('notice-pulse');
}

function preview() {
  try {
    const locale = $('locale').value, timeZone = $('timezone').value;
    $('region-preview').textContent = new Intl.DateTimeFormat(locale, {timeZone, dateStyle: 'medium', timeStyle: 'medium'}).format(new Date());
    $('offset-preview').textContent = new Intl.DateTimeFormat('en', {timeZone, timeZoneName: 'longOffset'}).formatToParts(new Date()).find(p => p.type === 'timeZoneName').value;
  } catch {
    $('region-preview').textContent = '请填写有效的时区和区域';
    $('offset-preview').textContent = '';
  }
}

function fill(p) {
  resetCleanPreview();
  p = {...defaultProfile(), ...p};
  for (const key of fields) {
    const el = $(key);
    if(!el)continue;
    if(key==='webrtc')el.checked=p[key]==='block';
    else if (el.type === 'checkbox') el.checked = p[key];
    else el.value = Array.isArray(p[key]) ? p[key].join(', ') : p[key];
  }
  currentDomain = profiles.some(x => x.domain === p.domain) ? p.domain : null;
  $('domain').readOnly = !!currentDomain;
  $('delete').hidden = !currentDomain;
  $('region').value = '';
  identityState={platform:p.platform,uaPlatform:p.uaPlatform,emoji:'native'};
  const browser=p.ua.match(/(Firefox|Edg|Version|Chrome)\/([\d.]+)/g)?.pop()?.replace('Edg/','Edge ').replace('Version/','Safari ').replace('/',' ');
  $('identity-summary').textContent=p.ua?`当前身份：${p.uaPlatform} · ${browser||'自定义 UA'}`:'保持真实浏览器，点击按钮生成身份';
  updateIdentityChoices();
  preview();
  renderList();
}

function readDraft() {
  const p = {};
  for (const key of fields) {
    const el = $(key);
    if(!el){p[key]=identityState[key];continue;}
    p[key] = key==='webrtc'?(el.checked?'block':'native'):el.type === 'checkbox' ? el.checked : el.value;
  }
  p.languages = p.languages.split(',').map(x => x.trim()).filter(Boolean);
  return p;
}

function readForm() {
  const p=validateProfile(readDraft());
  const browser=/Edg\//.test(p.ua)?'Edge':/Firefox\//.test(p.ua)?'Firefox':/Chrome\//.test(p.ua)?'Chrome':/Version\/.*Safari\//.test(p.ua)?'Safari':'';
  if((p.identityOS!=='random'&&(!p.ua||p.identityOS!==p.uaPlatform))||(p.identityBrowser!=='random'&&p.identityBrowser!==browser))throw new Error('身份选择与当前 UA 不一致，请先点击“一键随机身份”生成后再保存。');
  return p;
}

function checkBackend(status) {
  backendReady = compatibleBackend(status);
  $('version-warning').hidden = backendReady;
  $('save').disabled = saving || !backendReady;
  $('retry').disabled = !backendReady;
  return backendReady;
}

function renderList() {
  $('count').textContent = String(profiles.length);
  $('profiles').replaceChildren();
  if (!profiles.length) {
    const el = document.createElement('p');
    el.className = 'empty';
    el.textContent = '还没有域名规则。\n点击下方添加第一个站点。';
    $('profiles').append(el);
    return;
  }
  const filterQuery = ($('profile-search')?.value || '').toLowerCase().trim();
  for (const p of [...profiles].sort((a, b) => a.domain.localeCompare(b.domain))) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'profile-item' + (p.domain === currentDomain ? ' selected' : '');
    if (filterQuery && !p.domain.toLowerCase().includes(filterQuery)) {
      b.style.display = 'none';
    }

    const domainSpan = document.createElement('span');
    domainSpan.className = 'profile-domain';
    domainSpan.textContent = p.domain;
    b.append(domainSpan);

    const small = document.createElement('small');
    small.className = 'profile-meta';

    const pill = document.createElement('span');
    pill.className = 'status-pill ' + (p.enabled ? 'on' : 'off');
    pill.textContent = p.enabled ? '已启用' : '已停用';
    small.append(pill);

    const desc = document.createElement('span');
    desc.className = 'meta-detail';
    desc.textContent = ` · ${p.locale}${p.subdomains ? ' · 含子域' : ''}`;
    small.append(desc);

    b.append(small);
    b.onclick = () => {
      fill(p);
      flashField($('domain'), $('timezone'), $('locale'), $('ua'));
      notice('已载入配置。修改并保存后，请刷新目标页。');
    };
    $('profiles').append(b);
  }
}

$('profile-search')?.addEventListener('input', () => {
  const query = $('profile-search').value.toLowerCase().trim();
  for (const item of $('profiles').querySelectorAll('.profile-item')) {
    item.style.display = (!query || item.textContent.toLowerCase().includes(query)) ? '' : 'none';
  }
});

$('editor').addEventListener('input',resetCleanPreview);
$('preview-clean').onclick=async()=>{
  resetCleanPreview();
  const domain=currentDomain;
  $('preview-clean').disabled=true;
  try{
    if(!backendReady)throw new Error('请先重载扩展到 v1.2。');
    if(!domain)throw new Error('请先保存并选择一个域名规则。');
    const saved=profiles.find(p=>p.domain===domain);
    if(saved.subdomains!==$('subdomains').checked)throw new Error('子域名范围已修改，请先保存配置。');
    if(!await chrome.permissions.request({permissions:CLEAN_PERMISSIONS}))throw new Error('未获得清理权限，没有删除任何数据。');
    const result=await send({type:'preview-clean',domain});
    if(currentDomain!==domain)return;
    cleanPreview={...result,domain};
    $('clean-output').textContent=`已保存范围：${domain}${result.plan.subdomains?'（含已发现子域名）':'（仅此域名的存储）'}\n将关闭 ${result.plan.tabIds.length} 个目标标签页；清理 ${result.plan.origins.length} 个来源：\n${result.plan.origins.join('\n')}\nCookie 还会按所属主域清理。${result.plan.historyLimited?'\n历史记录达到检索上限，发现范围可能不完整。':''}`;
    $('clear-site-data').hidden=false;
  }catch(e){notice(e.message,true);}finally{$('preview-clean').disabled=false;}
};
$('clear-site-data').onclick=async()=>{
  const preview=cleanPreview;
  if(!preview)return;
  if(!confirm(`清理 ${preview.domain} 的站点数据？\n将关闭 ${preview.plan.tabIds.length} 个目标标签页，删除缓存和离线数据，并退出登录。Cookie 清理也可能影响同一主域下其他子站。此操作无法撤销。`))return;
  $('clear-site-data').disabled=true;
  $('preview-clean').disabled=true;
  $('clean-output').textContent='正在清理，请勿重新打开目标网站…';
  try{
    const result=await send({type:'clear-site-data',domain:preview.domain,token:preview.token});
    if(currentDomain===preview.domain)$('clean-output').textContent=`${preview.domain}：已完成 ${result.origins} 个来源的清理。可以重新打开网站；浏览器恢复旧标签页可能恢复会话状态。`;
    notice(`${preview.domain} 站点数据清理完成，域名配置已保留。`);
  }catch(e){$('clean-output').textContent=e.message;notice(e.message,true);}
  finally{cleanPreview=null;$('clear-site-data').hidden=true;$('clear-site-data').disabled=false;$('preview-clean').disabled=false;}
};

for (const [key, options] of Object.entries(MODE_OPTIONS)) {
  if(key!=='fonts')continue;
  $(key).replaceChildren(...options.map(([value, label]) => new Option(label, value)));
}
for (const [key, region] of Object.entries(REGIONS)) {
  $('region').add(new Option(region[0], key));
}
for (const zone of Intl.supportedValuesOf('timeZone')) {
  $('timezones').append(new Option(zone, zone));
}


$('region').onchange = () => {
  const r = REGIONS[$('region').value];
  if (!r) return;
  $('timezone').value = r[1];
  $('locale').value = r[2];
  $('languages').value = r[3].join(', ');
  $('latitude').value = r[4];
  $('longitude').value = r[5];
  preview();
  flashField($('timezone'), $('locale'), $('languages'), $('latitude'), $('longitude'));
};

function updateIdentityChoices(){
  const os=$('identityOS').value,browser=$('identityBrowser').value;
  for(const option of $('identityBrowser').options)option.disabled=os!=='random'&&option.value!=='random'&&!compatible(os,option.value);
  for(const option of $('identityOS').options)option.disabled=browser!=='random'&&option.value!=='random'&&!compatible(option.value,browser);
}
$('identityOS').onchange=updateIdentityChoices;
$('identityBrowser').onchange=updateIdentityChoices;
$('native-identity').onclick=()=>{
  $('ua').value='';
  $('identityOS').value='random';$('identityBrowser').value='random';
  updateIdentityChoices();
  $('identity-summary').textContent='原生身份：不改写 UA、平台、厂商、Client Hints 或身份请求头';
  notice('已恢复原生身份。保存后重新加载目标页面；其他隐私配置保留。真实系统信息将可被网站读取。');
};
$('random-ua').onclick=()=>{
  try{
    const result=generateIdentity(navigator.userAgent,{os:$('identityOS').value,browser:$('identityBrowser').value,strategy:$('identityVersion').value});
    identityState={platform:result.platform,uaPlatform:result.uaPlatform,emoji:'native'};
    $('ua').value=result.ua;$('identity-summary').textContent=result.identitySummary;
    notice('已生成匹配的系统、浏览器与版本。保存后固定生效。');
  }catch(e){notice(e.message,true);}
};

$('apply-environment').onclick = () => {
  $('timezone').value = 'America/Los_Angeles';
  $('locale').value = 'en-US';
  $('languages').value = 'en-US, en';
  $('fonts').value = 'strict';
  $('webrtc').checked = true;
  preview();
  flashField($('timezone'), $('locale'), $('languages'), $('fonts'), $('webrtc'));
  flashButton($('apply-environment'), '✓ 已应用配置');
  notice('已填写英文、美西时区、字体保护与 WebRTC 阻断；保留当前系统和浏览器身份。核对位置是否一致后保存。');
};

$('audit-page').onclick = async () => {
  $('audit-page').disabled = true;
  const originalText = $('audit-page').innerHTML;
  $('audit-page').innerHTML = '⟳ 检测中…';
  try {
    if (!backendReady) throw new Error('请先重载旧版后台。');
    if (!currentDomain) throw new Error('请先保存规则，再打开并刷新目标网站。');
    const {report} = await send({type: 'audit', domain: currentDomain});
    $('audit-output').textContent = `${report.origin}\n中文字体：${report.detectedFonts.length} / ${report.fontCandidates} 项命中\n时区：${report.timezone}；Intl：${report.locale}；偏移：${report.offset} 分钟\n语言：${report.languages.join(', ')}\n平台：${report.platform}\n${report.scope}`;
    notice(report.detectedFonts.length?'仍检测到部分中文字体，请核对设置并刷新。':'字体宽度自检通过；不代表 Claude 官方判定。',report.detectedFonts.length>0);
  } catch (e) {
    notice(e.message, true);
  } finally {
    $('audit-page').disabled = false;
    $('audit-page').innerHTML = originalText;
  }
};

$('timezone').oninput = preview;
$('locale').oninput = preview;

$('new').onclick = () => {
  fill(defaultProfile());
  flashField($('domain'));
  notice('新规则只在保存并授权后生效。');
  $('domain').focus();
};

$('editor').onsubmit = async event => {
  event.preventDefault();
  if (saving) return;
  saving = true;
  $('save').disabled = true;
  const originalSaveText = $('save').innerHTML;
  $('save').innerHTML = '⟳ 保存中…';
  try {
    if (!backendReady) throw new Error('检测到旧版扩展后台。请点击上方“保存草稿并重载扩展”，不要降低保护模式来绕过此错误。');
    const profile = readForm();
    if (!await chrome.permissions.request({origins: patterns(profile)})) throw new Error('未授权站点访问，配置未保存。');
    if (!checkBackend(await send({type: 'status'}))) throw new Error('后台版本已发生变化，请保存草稿并重载扩展。');
    const r = await send({type: 'save', profile});
    profiles = r.profiles;
    fill(profile);
    notice('配置已保存并注册。请刷新目标网页，使新配置生效。');
    await chrome.storage.local.remove('editorDraft');
    $('save').textContent = '保存域名配置 ↗';
  } catch (error) {
    notice(error.message, true);
    $('save').innerHTML = originalSaveText;
  } finally {
    saving = false;
    $('save').disabled = !backendReady;
    $('save').textContent = '保存域名配置 ↗';
  }
};

$('reload-extension').onclick = async () => {
  $('reload-extension').disabled = true;
  try {
    await chrome.storage.local.set({editorDraft: {profile: readDraft(), reopen: true, savedAt: Date.now()}});
    notice('草稿已保存，正在重载扩展；设置页将重新打开并恢复表单。');
    chrome.runtime.reload();
  } catch (e) {
    notice(`无法自动重载：${e.message}。请在 chrome://extensions 手动重载，再打开设置页恢复草稿。`, true);
    $('reload-extension').disabled = false;
  }
};

$('delete').onclick = async () => {
  if (!currentDomain) return;
  $('delete').disabled = true;
  try {
    const r = await send({type: 'delete', domain: currentDomain});
    profiles = r.profiles;
    fill(defaultProfile());
    notice('规则已删除。请刷新原目标页以恢复原始环境。');
  } catch (e) {
    notice(e.message, true);
  } finally {
    $('delete').disabled = false;
  }
};

$('match-ip').onclick = async () => {
  $('match-ip').disabled = true;
  const originalMatchText = $('match-ip').innerHTML;
  $('match-ip').innerHTML = '⟳ 查询中…';
  try {
    if (!await chrome.permissions.request({origins: ['https://ipwho.is/*']})) throw new Error('IP 查询访问权限未授予。');
    notice('正在查询当前出口 IP…');
    const r = await send({type: 'ip'});
    for (const [key, value] of Object.entries(r.profile)) {
      const el = $(key);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = value;
      else el.value = Array.isArray(value) ? value.join(', ') : value;
    }
    preview();
    flashField($('timezone'), $('locale'), $('languages'), $('latitude'), $('longitude'), $('accuracy'));
    $('match-ip').textContent = '◎ 根据当前 IP 匹配';
    notice(`已匹配 ${r.ip} · ${r.country || ''} ${r.city || ''}。请核对语言和位置后保存。${r.profile.regionKnown ? '' : '该地区暂无语言预设，暂填英语，请手动调整。'}`);
  } catch (e) {
    notice(e.message, true);
    $('match-ip').innerHTML = originalMatchText;
  } finally {
    $('match-ip').disabled = false;
    $('match-ip').textContent = '◎ 根据当前 IP 匹配';
  }
};

$('retry').onclick = async () => {
  try {
    await send({type: 'retry'});
    await load();
    notice('脚本与请求头规则已重新应用。请刷新目标页。');
  } catch (e) {
    notice(e.message, true);
  }
};

async function load() {
  const r = await send({type: 'status'});
  profiles = r.profiles;
  checkBackend(r);
  $('api-warning').hidden = r.scriptsAvailable;
  if (r.lastError) notice(`上次恢复配置时出现问题：${r.lastError}`, true);
  renderList();
  return r;
}

try {
  await load();
  const host = new URLSearchParams(location.search).get('domain');
  const p = profiles.find(p => p.domain === host);
  fill(p || {...defaultProfile(), domain: host || ''});
  const {editorDraft} = await chrome.storage.local.get('editorDraft');
  if (editorDraft?.profile && (!host || host === editorDraft.profile.domain)) {
    fill(editorDraft.profile);
    notice('已恢复重载前的草稿。请核对后点击保存，尚未自动应用。');
  }
} catch (e) {
  notice(e.message, true);
}
