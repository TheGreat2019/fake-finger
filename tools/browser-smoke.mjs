import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,rm,cp,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {startServer} from './server.mjs';
import {installProfile} from '../inject.js';
import {defaultProfile,uaPresets} from '../core.js';
import {fontCandidates,probeFonts} from '../tests/font-fixture.js';
import {probeDOMFonts,measureDOMCost,checkMeasurementCache} from '../tests/render-fixture.js';
import {BUILD,MODE_VALUES} from '../version.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const qa=path.join(root,'.qa');await mkdir(qa,{recursive:true});
const userData=path.join(qa,`chrome-${Date.now()}`);
const server=await startServer(0),base=`http://127.0.0.1:${server.address().port}`;
const chromePath=process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const child=spawn(chromePath,['--headless=new','--no-sandbox','--disable-gpu','--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${userData}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let socket;
try{
  const endpoint=await new Promise((resolve,reject)=>{
    let text='';const timer=setTimeout(()=>reject(Error('Chrome 启动超时')),20000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.stderr.on('data',data=>{text+=data;const m=/DevTools listening on (ws:\/\/[^\s]+)/.exec(text);if(m){clearTimeout(timer);resolve(m[1]);}});
    child.on('exit',code=>{clearTimeout(timer);reject(Error(`Chrome 提前退出 ${code}: ${text}`));});
  });
  socket=new WebSocket(endpoint);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map();
  socket.onmessage=event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const {resolve,reject,timer}=pending.get(m.id);clearTimeout(timer);pending.delete(m.id);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);}};
  function send(method,params={},sessionId){return new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error(`CDP timeout: ${method}`));},15000);pending.set(n,{resolve,reject,timer});socket.send(JSON.stringify({id:n,method,params,sessionId}));});}
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const cmd=(method,params={})=>send(method,params,sessionId);
  await cmd('Page.enable');await cmd('Runtime.enable');
  const evaluate=async expression=>{
    const r=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
    return r.result.value;
  };
  const waitReady=async expression=>{for(let i=0;i<80;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error(`页面未就绪: ${expression}`);};
  const p={...defaultProfile(),domain:'127.0.0.1',ua:'Mozilla/5.0 TestChrome',locationEnabled:true,emoji:'flags'};
  const {identifier}=await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`globalThis.__activeFontObservers=new Set();const NativeObserver=MutationObserver;globalThis.MutationObserver=class extends NativeObserver{observe(...args){__activeFontObservers.add(this);return super.observe(...args)}disconnect(){__activeFontObservers.delete(this);return super.disconnect()}};(${installProfile.toString()})(${JSON.stringify([p])});globalThis.MutationObserver=NativeObserver;`});
  await cmd('Page.navigate',{url:base+'/diagnostic.html'});
  await waitReady(`!!document.getElementById('result')?.textContent`);
  const report=await evaluate(`JSON.parse(document.getElementById('result').textContent)`);
  const domCost=await evaluate(`(${measureDOMCost.toString()})()`);
  console.log('DOM benchmark '+JSON.stringify(domCost));
  assert.equal(await evaluate('__activeFontObservers.size'),0,'No persistent DOM observer after measurements');
  const cacheCheck=await evaluate(`(${checkMeasurementCache.toString()})()`);
  assert.equal(cacheCheck.first,cacheCheck.base);assert.equal(cacheCheck.repeat,cacheCheck.base);
  assert.ok(cacheCheck.isolated);assert.notEqual(cacheCheck.changed,cacheCheck.first);
  for(const key of ['changed','restored','nextTask'])assert.equal(cacheCheck[key],cacheCheck.expected);
  await writeFile(path.join(qa,'dom-performance-latest.json'),JSON.stringify(domCost,null,2));
  assert.equal(report.language,'en-US');assert.equal(report.ua,p.ua);assert.equal(report.一月偏移,300);assert.equal(report.七月偏移,240);assert.match(report.WebRTC,/NotAllowedError/);
  const fontProbe=()=>evaluate(`(${probeFonts.toString()})(${JSON.stringify(fontCandidates)})`);
  const fontResult=await fontProbe();assert.deepEqual(fontResult.detected,[]);
  assert.deepEqual((await evaluate(`(${probeFonts.toString()})(${JSON.stringify(fontCandidates)},true)`)).detected,[]);
  assert.deepEqual((await evaluate(`(${probeFonts.toString()})(['Arial'])`)).detected,['Arial'],'Unrelated real fonts remain detectable');
  assert.equal(await evaluate(`new Promise(r=>navigator.geolocation.getCurrentPosition(p=>r(p.coords.latitude)))`),p.latitude);
  const dom=await evaluate(`(${probeDOMFonts.toString()})(${JSON.stringify([...fontCandidates,'Private CN Font Test'])})`);
  for(const r of dom)assert.ok(r.delta<.01&&r.offsetDelta===0&&r.restored,JSON.stringify(r));
  for(const mode of ['class','inherited']){
    const result=await evaluate(`(${probeDOMFonts.toString()})(['Microsoft YaHei'],'${mode}')`);
    for(const r of result)assert.ok(r.delta<.01&&r.offsetDelta===0&&r.restored,`${mode}: ${JSON.stringify(r)}`);
  }
  assert.equal(await evaluate(`new FontFace('Alias','local("Microsoft YaHei")').load().then(()=>false,()=>true)`),true);
  await cmd('Page.removeScriptToEvaluateOnNewDocument',{identifier});
  await cmd('Page.navigate',{url:base+'/diagnostic.html'});await waitReady(`!!document.getElementById('result')?.textContent`);
  assert.notEqual(await evaluate('navigator.userAgent'),p.ua);
  const nativeFonts=await fontProbe();assert.ok(nativeFonts.detected.includes('Microsoft YaHei'),'Windows positive control requires installed Microsoft YaHei');
  // Render the actual options module using an explicit extension-API fixture.
  const stub=`globalThis.__store={};globalThis.chrome={storage:{local:{get:async key=>({[key]:__store[key]}),set:async value=>Object.assign(__store,value),remove:async key=>delete __store[key]}},runtime:{reload:()=>globalThis.__reloaded=true,sendMessage:async m=>m.type==='status'?{ok:true,profiles:[],scriptsAvailable:true,...(location.search.includes('legacy=1')?{}:{build:${JSON.stringify(BUILD)},modes:${JSON.stringify(MODE_VALUES)}})}:m.type==='save'?{ok:true,profiles:[m.profile]}:{ok:true,profiles:[]}},permissions:{request:async()=>true}};`;
  const stubScript=await cmd('Page.addScriptToEvaluateOnNewDocument',{source:stub});
  await cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await cmd('Page.navigate',{url:base+'/options.html?domain=example.com'});
  await waitReady(`document.getElementById('domain')?.value==='example.com'`);
  await evaluate(`document.getElementById('identityOS').value='Windows';document.getElementById('identityBrowser').value='Firefox';document.getElementById('random-ua').click()`);
  assert.match(await evaluate(`document.getElementById('ua').value`),/Windows.*Firefox/);
  const preservedUA=await evaluate(`document.getElementById('ua').value`);
  await evaluate(`document.getElementById('apply-environment').click()`);
  assert.equal(await evaluate(`document.getElementById('ua').value`),preservedUA);
  assert.equal(await evaluate(`document.getElementById('webrtc').checked`),true);
  assert.equal(await evaluate(`!!document.getElementById('platform')`),false);
  await evaluate(`document.getElementById('random-ua').click();document.getElementById('region').value='JP';document.getElementById('region').dispatchEvent(new Event('change'));document.getElementById('save').click();`);
  await waitReady(`document.getElementById('status').textContent.includes('配置已保存')`);
  assert.equal(await evaluate(`document.getElementById('timezone').value`),'Asia/Tokyo');
  await new Promise(r=>setTimeout(r,1400));
  assert.ok(!(await evaluate(`document.getElementById('save').textContent`)).includes('保存中'));
  assert.equal(await evaluate(`document.getElementById('save').disabled`),false);
  await evaluate(`document.getElementById('random-ua').closest('.card').scrollIntoView({block:'start',behavior:'instant'})`);
  const shot=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(path.join(qa,'options-preview.png'),Buffer.from(shot.data,'base64'));
  await writeFile(path.join(qa,'browser-report.json'),JSON.stringify({passed:true,report,scope:'Real Chrome page shim + options UI fixture. Not a loaded-extension E2E test.'},null,2));
  console.log('PASS: Chrome 真实页面时区 / UA / 语言 / 字体 / WebRTC / 位置，刷新恢复，以及工作台预设 / 保存交互。');
  console.log(`界面截图：${path.join(qa,'options-preview.png')}`);
  await cmd('Page.navigate',{url:base+'/options.html?domain=legacy.example&legacy=1'});
  await waitReady(`document.getElementById('domain')?.value==='legacy.example'`);
  assert.equal(await evaluate(`document.getElementById('version-warning').hidden`),false);
  assert.equal(await evaluate(`document.getElementById('save').disabled`),true);
  await evaluate(`document.getElementById('reload-extension').click()`);await waitReady(`globalThis.__reloaded===true`);
  assert.equal(await evaluate(`__store.editorDraft.profile.domain`),'legacy.example');assert.equal(await evaluate(`__store.editorDraft.profile.emoji`),'native');
  if(process.argv.includes('--extension')){
    const popupFixture=await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.pathname.endsWith('/popup.html')){globalThis.chrome.tabs={query:async()=>[{url:'https://sub.example.com/'}]};chrome.runtime.sendMessage=async m=>m.type==='status'?{ok:true,build:${JSON.stringify(BUILD)},modes:${JSON.stringify(MODE_VALUES)},scriptsAvailable:true,profiles:[{domain:'example.com',enabled:true,subdomains:true,timezone:'America/New_York',languages:['en-US'],webrtc:'block'}]}:(globalThis.__sync=m,{ok:true,ip:'203.0.113.1',country:'Japan',city:'Tokyo',profile:{timezone:'Asia/Tokyo',languages:['ja-JP'],latitude:35,longitude:139}});}`});
    await cmd('Page.navigate',{url:base+'/popup.html'});await waitReady(`document.getElementById('sync-ip')?.disabled===false`);
    await evaluate(`document.getElementById('sync-ip').click()`);await waitReady(`document.getElementById('state').textContent.includes('已保存')`);
    assert.equal(await evaluate(`__sync.domain`),'example.com');assert.equal(await evaluate(`__sync.type`),'sync-ip');
    assert.ok((await evaluate(`document.getElementById('summary').textContent`)).includes('Asia/Tokyo'));
    await cmd('Page.removeScriptToEvaluateOnNewDocument',{identifier:popupFixture.identifier});
    console.log('PASS: popup 子域名匹配与 IP 更新交互（IP 响应使用固定测试数据）。');
    await cmd('Page.removeScriptToEvaluateOnNewDocument',{identifier:stubScript.identifier});
    // Headless Chrome cannot accept the native optional-permission dialog.
    // Load identical source in a fixture with these permissions pregranted.
    const fixture=path.join(qa,'extension-clean-fixture');await mkdir(fixture,{recursive:true});
    for(const entry of await readdir(root,{withFileTypes:true})){
      if(entry.isFile()&&/\.(js|html|css)$/.test(entry.name)||['assets','icons'].includes(entry.name))await cp(path.join(root,entry.name),path.join(fixture,entry.name),{recursive:true});
    }
    const fixtureManifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
    fixtureManifest.permissions.push(...fixtureManifest.optional_permissions);delete fixtureManifest.optional_permissions;
    await writeFile(path.join(fixture,'manifest.json'),JSON.stringify(fixtureManifest));
    const {id:extensionId}=await send('Extensions.loadUnpacked',{path:fixture});
    console.log(`已在隔离测试配置中加载插件：${extensionId}`);
    await cmd('Page.navigate',{url:'chrome://extensions/'});
    await waitReady(`!!globalThis.chrome?.developerPrivate`);
    await evaluate(`chrome.developerPrivate.updateProfileConfiguration({inDeveloperMode:true})`);
    await evaluate(`chrome.developerPrivate.updateExtensionConfiguration({extensionId:${JSON.stringify(extensionId)},userScriptsAccess:true})`);
    for(const origin of ['http://127.0.0.1/*','https://127.0.0.1/*'])await evaluate(`chrome.developerPrivate.addHostPermission(${JSON.stringify(extensionId)},${JSON.stringify(origin)})`);
    const optionsURL=`chrome-extension://${extensionId}/options.html?domain=127.0.0.1`;
    await cmd('Page.navigate',{url:optionsURL});
    await waitReady(`document.getElementById('domain')?.value==='127.0.0.1'`);
    const grant=await cmd('Runtime.evaluate',{expression:`chrome.permissions.request({origins:['http://127.0.0.1/*','https://127.0.0.1/*']})`,userGesture:true,awaitPromise:true,returnByValue:true});
    assert.equal(grant.result?.value,true,JSON.stringify(grant));
    // Reproduce the user's actual path: new rule + default selects + UI Save.
    await cmd('Runtime.evaluate',{expression:`document.getElementById('new').click();document.getElementById('domain').value='127.0.0.1';document.getElementById('save').click()`,userGesture:true});
    await waitReady(`document.getElementById('status').textContent.includes('配置已保存')`);
    const uiSaved=await evaluate(`chrome.storage.local.get('profiles')`);
    assert.equal(uiSaved.profiles[0].fonts,'strict');assert.equal(uiSaved.profiles[0].emoji,'native');
    await cmd('Page.reload');await waitReady(`document.getElementById('domain')?.value==='127.0.0.1'`);
    assert.equal(await evaluate(`!!document.getElementById('emoji')`),false);
    const saved=await evaluate(`chrome.runtime.sendMessage({type:'save',profile:${JSON.stringify(p)}})`);
    assert.equal(saved.ok,true,JSON.stringify(saved));
    const rules=await evaluate('chrome.declarativeNetRequest.getDynamicRules()');assert.equal(rules.length,1);
    await cmd('Page.navigate',{url:base+'/diagnostic.html'});
    await waitReady(`!!document.getElementById('result')?.textContent && document.getElementById('headers').textContent.includes('user-agent')`);
    const actual=await evaluate(`JSON.parse(document.getElementById('result').textContent)`);
    const headers=await evaluate(`JSON.parse(document.getElementById('headers').textContent)`);
    assert.equal(actual.ua,p.ua);assert.equal(actual.一月偏移,300);assert.equal(headers['user-agent'],p.ua);assert.equal(headers['accept-language'],'en-US,en;q=0.9');assert.equal(headers['sec-ch-ua'],undefined);
    assert.deepEqual((await fontProbe()).detected,[]);
    const realDOM=await evaluate(`(${probeDOMFonts.toString()})(${JSON.stringify(fontCandidates)})`);for(const r of realDOM)assert.ok(r.delta<.01&&r.offsetDelta===0&&r.restored,JSON.stringify(r));
    const {targetId:auditTarget}=await send('Target.createTarget',{url:optionsURL});
    const {sessionId:auditSession}=await send('Target.attachToTarget',{targetId:auditTarget,flatten:true});
    let auditReady=false;
    for(let i=0;i<60;i++){
      const r=await send('Runtime.evaluate',{expression:`document.getElementById('domain')?.value==='127.0.0.1'`,returnByValue:true},auditSession);
      if(r.result?.value){auditReady=true;break;}await new Promise(r=>setTimeout(r,50));
    }
    assert.ok(auditReady);
    await send('Runtime.evaluate',{expression:`document.getElementById('audit-page').click()`},auditSession);
    let auditText='';
    for(let i=0;i<60;i++){
      const r=await send('Runtime.evaluate',{expression:`document.getElementById('audit-output').textContent`,returnByValue:true},auditSession);auditText=r.result?.value||'';
      if(auditText)break;await new Promise(r=>setTimeout(r,50));
    }
    assert.match(auditText,/中文字体：0 \/ 32/);
    await send('Target.closeTarget',{targetId:auditTarget});
    await cmd('Page.navigate',{url:base.replace('127.0.0.1','localhost')+'/diagnostic.html'});
    await waitReady(`!!document.getElementById('result')?.textContent && document.getElementById('headers').textContent.includes('user-agent')`);
    assert.notEqual(await evaluate('navigator.userAgent'),p.ua);
    assert.notEqual(await evaluate(`JSON.parse(document.getElementById('headers').textContent)['user-agent']`),p.ua);
    await cmd('Page.navigate',{url:optionsURL});await waitReady(`document.getElementById('domain')?.value==='127.0.0.1'`);
    const mac=uaPresets()[1];
    const macProfile={...p,ua:mac[1],platform:mac[2],uaPlatform:mac[3]};
    assert.equal((await evaluate(`chrome.runtime.sendMessage({type:'save',profile:${JSON.stringify(macProfile)}})`)).ok,true);
    await cmd('Page.navigate',{url:base+'/diagnostic.html'});await waitReady(`!!document.getElementById('result')?.textContent && document.getElementById('headers').textContent.includes('user-agent')`);
    assert.match(await evaluate('navigator.userAgent'),/Macintosh/);assert.equal(await evaluate('navigator.platform'),'MacIntel');
    assert.equal(await evaluate(`JSON.parse(document.getElementById('headers').textContent)['user-agent']`),mac[1]);
    assert.deepEqual((await fontProbe()).detected,[]);
    await cmd('Page.navigate',{url:optionsURL});await waitReady(`document.getElementById('domain')?.value==='127.0.0.1'`);
    await evaluate(`document.getElementById('native-identity').click()`);
    await cmd('Runtime.evaluate',{expression:`document.getElementById('save').click()`,userGesture:true});
    await waitReady(`document.getElementById('status').textContent.includes('配置已保存')`);
    await cmd('Page.navigate',{url:base+'/diagnostic.html'});await waitReady(`document.getElementById('headers')?.textContent.includes('user-agent')`);
    const nativeIdentity=await evaluate(`({ua:navigator.userAgent,header:JSON.parse(document.getElementById('headers').textContent)['user-agent'],hints:!!navigator.userAgentData,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone})`);
    assert.equal(nativeIdentity.ua,nativeIdentity.header);assert.ok(nativeIdentity.hints);assert.notEqual(nativeIdentity.ua,mac[1]);assert.equal(nativeIdentity.timezone,p.timezone);
    await cmd('Page.navigate',{url:optionsURL});await waitReady(`document.getElementById('domain')?.value==='127.0.0.1'`);
    // v1.2: actual browsingData API, with unrelated-origin preservation.
    const cleanGrant=await cmd('Runtime.evaluate',{expression:`chrome.permissions.request({permissions:['browsingData','history','cookies']})`,userGesture:true,awaitPromise:true,returnByValue:true});
    assert.equal(cleanGrant.result?.value,true,JSON.stringify(cleanGrant));
    await cmd('Page.navigate',{url:base.replace('127.0.0.1','localhost')+'/diagnostic.html'});await waitReady(`!!document.getElementById('result')?.textContent`);
    await evaluate(`localStorage.setItem('keep','yes');document.cookie='keep=yes; path=/'`);
    const controlCache=await evaluate(`fetch('/cache-fixture').then(r=>r.text())`);
    await cmd('Page.navigate',{url:base+'/diagnostic.html'});await waitReady(`!!document.getElementById('result')?.textContent`);
    await evaluate(`(async()=>{localStorage.setItem('erase','yes');sessionStorage.setItem('erase','yes');document.cookie='erase=yes; path=/';await (await caches.open('erase')).put('/fixture',new Response('erase'));await new Promise((resolve,reject)=>{const q=indexedDB.open('erase');q.onsuccess=()=>{q.result.close();resolve()};q.onerror=reject;});})()`);
    await evaluate(`navigator.serviceWorker.register('/clean-test-worker.js').then(()=>navigator.serviceWorker.ready).then(()=>true)`);
    const targetCache=await evaluate(`fetch('/cache-fixture').then(r=>r.text())`);
    assert.equal(await evaluate(`fetch('/cache-fixture').then(r=>r.text())`),targetCache);
    await cmd('Page.navigate',{url:optionsURL});await waitReady(`document.getElementById('domain')?.value==='127.0.0.1'`);
    const {targetId:cleanTarget}=await send('Target.createTarget',{url:base+'/diagnostic.html'});
    await new Promise(r=>setTimeout(r,300));
    await cmd('Runtime.evaluate',{expression:`document.getElementById('preview-clean').click()`,userGesture:true});
    await waitReady(`!document.getElementById('clear-site-data').hidden`);
    assert.ok((await evaluate(`document.getElementById('clean-output').textContent`)).includes(base));
    const cleanShot=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(path.join(qa,'v1.2-clean-preview.png'),Buffer.from(cleanShot.data,'base64'));
    await evaluate(`globalThis.confirm=()=>true;document.getElementById('clear-site-data').click()`);
    await waitReady(`document.getElementById('status').textContent.includes('站点数据清理完成')`);
    assert.ok(!(await send('Target.getTargets')).targetInfos.some(t=>t.targetId===cleanTarget));
    assert.equal((await evaluate(`chrome.storage.local.get('profiles')`)).profiles.length,1);
    await cmd('Page.navigate',{url:base+'/diagnostic.html'});await waitReady(`!!document.getElementById('result')?.textContent`);
    assert.equal(await evaluate(`localStorage.getItem('erase')`),null);assert.equal(await evaluate(`document.cookie.includes('erase=')`),false);
    assert.deepEqual(await evaluate(`caches.keys()`),[]);assert.deepEqual(await evaluate(`indexedDB.databases()`),[]);
    assert.equal(await evaluate(`navigator.serviceWorker.getRegistrations().then(r=>r.length)`),0);
    assert.notEqual(await evaluate(`fetch('/cache-fixture').then(r=>r.text())`),targetCache);
    await cmd('Page.navigate',{url:base.replace('127.0.0.1','localhost')+'/diagnostic.html'});await waitReady(`!!document.getElementById('result')?.textContent`);
    assert.equal(await evaluate(`localStorage.getItem('keep')`),'yes');assert.equal(await evaluate(`document.cookie.includes('keep=yes')`),true);
    assert.equal(await evaluate(`fetch('/cache-fixture').then(r=>r.text())`),controlCache);
    console.log('PASS: v1.2 实际清理 Cookie / LocalStorage / IndexedDB / CacheStorage，关闭目标页、保留其他站点和配置。');
    await cmd('Page.navigate',{url:optionsURL});await waitReady(`document.getElementById('domain')?.value==='127.0.0.1'`);
    assert.equal((await evaluate(`chrome.runtime.sendMessage({type:'delete',domain:'127.0.0.1'})`)).ok,true);
    await cmd('Page.navigate',{url:base+'/diagnostic.html'});await waitReady(`!!document.getElementById('result')?.textContent && document.getElementById('headers').textContent.includes('user-agent')`);
    assert.notEqual(await evaluate('navigator.userAgent'),p.ua);assert.notEqual(await evaluate(`JSON.parse(document.getElementById('headers').textContent)['user-agent']`),p.ua);
    await writeFile(path.join(qa,'extension-report.json'),JSON.stringify({passed:true,build:BUILD,permissionScope:'Isolated source-identical fixture with optional API permissions pregranted; native permission dialog not automated.',cleanupChecks:['HTTP cache removed; control cache preserved','Cookies','LocalStorage','IndexedDB','CacheStorage','ServiceWorker','Target tabs closed','Profiles retained'],extensionId,actual,headers,fontResult,nativeFonts,realDOM,auditText,checks:['load actual manifest','grant test profile host permissions','enable userScripts','new rule via UI form','document_start injection','DNR headers','unmatched domain isolation','32 fonts against 3 fallbacks','DOM metrics and local FontFace','macOS UA + platform + headers','page audit via real extension API','delete and refresh restoration']},null,2));
    console.log('PASS: 真实扩展加载 / 授权 / userScripts / DNR / 域名隔离 / 删除后恢复。');
    // Reload the actual extension, preserving an unsaved new-rule draft.
    const {targetId:editorId}=await send('Target.createTarget',{url:optionsURL});
    const {sessionId:editorSession}=await send('Target.attachToTarget',{targetId:editorId,flatten:true});
    for(let i=0;i<60;i++){
      const r=await send('Runtime.evaluate',{expression:`document.getElementById('domain')?.value==='127.0.0.1'`,returnByValue:true},editorSession);
      if(r.result?.value)break;await new Promise(r=>setTimeout(r,50));
    }
    await send('Runtime.evaluate',{expression:`document.getElementById('timezone').value='Asia/Tokyo';document.getElementById('reload-extension').click()`},editorSession);
    let restoredTarget;
    for(let i=0;i<100;i++){restoredTarget=(await send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${extensionId}/options.html?restoreDraft=1`);if(restoredTarget)break;await new Promise(r=>setTimeout(r,100));}
    assert.ok(restoredTarget,'Reload must reopen the settings page');
    const {sessionId:restoredSession}=await send('Target.attachToTarget',{targetId:restoredTarget.targetId,flatten:true});
    let restored;
    for(let i=0;i<60;i++){
      const r=await send('Runtime.evaluate',{expression:`({domain:document.getElementById('domain')?.value,timezone:document.getElementById('timezone')?.value,emoji:'native',notice:document.getElementById('status')?.textContent})`,returnByValue:true},restoredSession);restored=r.result?.value;
      if(restored?.notice?.includes('已恢复'))break;await new Promise(r=>setTimeout(r,50));
    }
    assert.equal(restored.domain,'127.0.0.1');assert.equal(restored.timezone,'Asia/Tokyo');assert.equal(restored.emoji,'native');
    await send('Runtime.evaluate',{expression:`chrome.storage.local.remove('editorDraft')`,awaitPromise:true},restoredSession);
    console.log('PASS: 新建规则实际表单保存 / 重新打开 / 旧后台提示 / 重载扩展后草稿恢复。');
    if(process.argv.includes('--live')){
      await cmd('Page.navigate',{url:'chrome://extensions/'});await waitReady(`!!globalThis.chrome?.developerPrivate`);
      for(const origin of ['http://ippure.com/*','https://ippure.com/*'])await evaluate(`chrome.developerPrivate.addHostPermission(${JSON.stringify(extensionId)},${JSON.stringify(origin)})`);
      await cmd('Page.navigate',{url:`chrome-extension://${extensionId}/options.html?domain=ippure.com`});await waitReady(`document.getElementById('domain')?.value==='ippure.com'`);
      const grant=await cmd('Runtime.evaluate',{expression:`chrome.permissions.request({origins:['http://ippure.com/*','https://ippure.com/*']})`,userGesture:true,awaitPromise:true,returnByValue:true});assert.equal(grant.result?.value,true);
      const liveProfile={...macProfile,domain:'ippure.com',timezone:'America/Los_Angeles'};
      assert.equal((await evaluate(`chrome.runtime.sendMessage({type:'save',profile:${JSON.stringify(liveProfile)}})`)).ok,true);
      await cmd('Page.navigate',{url:'https://ippure.com/claude'});
      // Network-dependent check, enabled only by the explicit --live test flag.
      for(let i=0;i<100;i++){if(await evaluate(`!!document.body?.innerText.includes('none detected') && document.body.innerText.includes('Apple style')`))break;await new Promise(r=>setTimeout(r,250));}
      const site=await evaluate(`({text:document.body?.innerText.slice(document.body.innerText.indexOf('检测哪些信号'),document.body.innerText.indexOf('一、 功能模块')),ua:navigator.userAgent,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,version:document.title})`);
      await writeFile(path.join(qa,'ippure-live-report.json'),JSON.stringify(site,null,2));
      await evaluate(`Array.from(document.querySelectorAll('*')).find(e=>e.textContent.trim()==='已安装中文字体')?.scrollIntoView({block:'center',behavior:'instant'})`);
      const screenshot=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(qa,'ippure-live.png'),Buffer.from(screenshot.data,'base64'));
      assert.ok(site.text.includes('none detected'),'Live IPPure font result must report none detected');assert.ok(site.text.includes('Apple style'),'Live Emoji result must settle to Apple style');
      console.log('PASS: Live IPPure shows none detected for fonts and Apple style for UA-inferred Emoji. Emoji score is not zero.');
    }
  }
  await send('Browser.close').catch(()=>{});
}finally{
  socket?.close();child.kill();server.close();
  // Only remove this run's isolated browser profile under the known workspace QA directory.
  if(path.dirname(path.resolve(userData))===path.resolve(qa))await rm(userData,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{});
}
