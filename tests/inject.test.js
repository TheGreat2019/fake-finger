import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installProfile} from '../inject.js';
import {defaultProfile,uaPresets} from '../core.js';
function realm(extra={},host='example.com'){
  const ctx=vm.createContext({setTimeout,clearTimeout,DOMException,location:{hostname:host}});
  vm.runInContext(`
    class Navigator {get language(){return 'zh-CN'} get languages(){return ['zh-CN']} get userAgent(){return 'nativeUA'} get platform(){return 'nativePlatform'} get userAgentData(){return {platform:'real'}}}
    class Geo {getCurrentPosition(cb){cb({native:true})}watchPosition(){return -1}clearWatch(){}}
    globalThis.navigator=new Navigator();navigator.geolocation=new Geo();
    globalThis.RTCPeerConnection=function NativeRTC(){};
    class CanvasRenderingContext2D {font='16px Arial'; measureText(text){return {width:this.font.includes('Microsoft YaHei')?99:20,font:this.font,text};}fillText(text){return {font:this.font,text};}strokeText(text){return {font:this.font,text};}}
    globalThis.CanvasRenderingContext2D=CanvasRenderingContext2D;
    globalThis.OffscreenCanvasRenderingContext2D=class extends CanvasRenderingContext2D {};
    globalThis.FontFaceSet=class {check(){return true}load(){return Promise.resolve(['native'])}};
    globalThis.styles=[];globalThis.document={createElement(){return {isConnected:false}},documentElement:{append(s){s.isConnected=true;styles.push(s.textContent)}}};
  `,ctx);
  const profile={...defaultProfile(),fonts:'normalize',emoji:'native',domain:'example.com',...extra};
  vm.runInContext(`(${installProfile.toString()})(${JSON.stringify([profile])})`,ctx);
  return code=>vm.runInContext(code,ctx);
}
test('不匹配或停用域名保留原环境',()=>{
  assert.equal(realm({},'not-example.com')('navigator.language'),'zh-CN');
  assert.equal(realm({enabled:false})('navigator.language'),'zh-CN');
  assert.equal(realm({subdomains:true},'a.example.com')('navigator.language'),'en-US');
});

test('历史时区在同一个 15 分钟区间内改变，不得共用缓存',()=>{
  const run=realm({timezone:'Africa/Monrovia'});
  const inputs=['1972-01-07T00:44:29Z','1972-01-07T00:44:30Z'];
  const expected=inputs.map(t=>new Intl.DateTimeFormat('en-US',{timeZone:'Africa/Monrovia',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(t)));
  assert.notEqual(expected[0].slice(0,5),expected[1].slice(0,5));
  for(const i of [0,1,0,1])assert.equal(run(`(()=>{const d=new Date('${inputs[i]}');return [d.getHours(),d.getMinutes(),d.getSeconds()].map(x=>String(x).padStart(2,'0')).join(':')})()`),expected[i]);
});

test('Firefox、Safari、Edge 预设同步 UA 平台与厂商',()=>{
  for(const [label,ua,platform,uaPlatform] of uaPresets().slice(3)){
    const run=realm({ua,platform,uaPlatform});
    assert.equal(run('navigator.userAgent'),ua);assert.equal(run('navigator.platform'),platform);
    assert.equal(run('navigator.vendor'),label.includes('Firefox')?'':label.includes('Safari')?'Apple Computer, Inc.':'Google Inc.');
    assert.equal(run('navigator.userAgentData'),undefined);
  }
});
test('时区、夏令时、半小时时区和默认 Intl 一致',()=>{
  const run=realm();
  assert.equal(run(`new Date('2026-01-01T12:00:00Z').getTimezoneOffset()`),300);
  assert.equal(run(`new Date('2026-07-01T12:00:00Z').getTimezoneOffset()`),240);
  assert.equal(run(`new Date('2026-01-01T12:00:00Z').getHours()`),7);
  assert.equal(run(`new Intl.DateTimeFormat().resolvedOptions().timeZone`),'America/New_York');
  assert.equal(run(`new Intl.NumberFormat().resolvedOptions().locale`),'en-US');
  assert.equal(run(`new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo'}).resolvedOptions().timeZone`),'Asia/Tokyo');
  const india=realm({timezone:'Asia/Kolkata'});assert.equal(india(`new Date('2026-01-01').getTimezoneOffset()`),-330);
  const china=realm({timezone:'Asia/Shanghai'});assert.equal(china(`new Date().getTimezoneOffset() === -480`),true);
});
test('Date 本地构造、解析、setters 与 UTC API',()=>{
  const run=realm();
  assert.equal(run(`new Date(2026,0,1,7).toISOString()`),'2026-01-01T12:00:00.000Z');
  assert.equal(run(`new Date('2026-01-01T07:00:00').toISOString()`),'2026-01-01T12:00:00.000Z');
  assert.equal(run(`new Date('2026-01-01').toISOString()`),'2026-01-01T00:00:00.000Z');
  assert.equal(run(`(()=>{const d=new Date('2026-01-01T12:00:00Z');d.setHours(8);return d.toISOString()})()`),'2026-01-01T13:00:00.000Z');
  assert.equal(run(`new Date('2026-01-01T12:00:00Z').getUTCHours()`),12);
  assert.equal(run(`Date.parse('2026-01-01T07:00:00')`),Date.parse('2026-01-01T12:00:00Z'));
  assert.match(run(`new Date('2026-01-01T12:00:00Z').toString()`),/07:00:00 GMT-0500/);
  assert.equal(run(`new Date(NaN).toString()`),'Invalid Date');
  assert.equal(run(`class D extends Date{}; new D(2026,0,1) instanceof D`),true);
});
test('DST 重叠选择较早实例、缺口向后顺延',()=>{
  const run=realm();
  assert.equal(run(`new Date(2026,2,8,2,30).toISOString()`),'2026-03-08T07:30:00.000Z');
  assert.equal(run(`new Date(2026,10,1,1,30).toISOString()`),'2026-11-01T05:30:00.000Z');
});
test('语言列表不可修改，UA / Client Hints 与连接阻断',()=>{
  const run=realm({ua:'Mozilla/5.0 Custom',platform:'MacIntel'});
  assert.equal(run('navigator.language'),'en-US');assert.equal(run('Object.isFrozen(navigator.languages)'),true);
  assert.equal(run('navigator.userAgent'),'Mozilla/5.0 Custom');assert.equal(run('navigator.platform'),'MacIntel');assert.equal(run('navigator.userAgentData'),undefined);
  assert.throws(()=>run('new RTCPeerConnection()'),{name:'NotAllowedError'});
  assert.doesNotThrow(()=>realm({webrtc:'native'})('new RTCPeerConnection()'));
});
test('指定中文字体宽度归一、绘制一致、字体状态恢复',()=>{
  const run=realm();
  assert.equal(run(`(()=>{const c=new CanvasRenderingContext2D();c.font='16px "Microsoft YaHei"';return c.measureText('中文').width})()`),20);
  assert.equal(run(`(()=>{const c=new CanvasRenderingContext2D();c.font='16px "Microsoft YaHei"';c.fillText('中文');return c.font})()`),'16px "Microsoft YaHei"');
  assert.equal(run(`new FontFaceSet().check('16px "PingFang SC"')`),false);
  assert.equal(run(`new FontFaceSet().check('16px Arial')`),true);
});

test('强化字体模式拒绝未知家族，保留常见拉丁字体',()=>{
  const run=realm({fonts:'strict'});
  assert.equal(run(`new FontFaceSet().check('16px "Some Private CJK Font", serif')`),false);
  assert.equal(run(`new FontFaceSet().check('16px "Arial", serif')`),true);
});
test('字体回退链保持，覆盖新增字体、别名与 CSS 转义',()=>{
  const run=realm();
  for(const font of ['DingTalk JinBuTi','NSimSun','Hiragino Sans GB','PMingLiU','Noto Sans CJK TC']){
    assert.equal(run(`new FontFaceSet().check(${JSON.stringify('72px "'+font+'", monospace')})`),false,font);
  }
  assert.equal(run(`new FontFaceSet().check('16px "Custom Microsoft YaHei"')`),true);
  assert.equal(run(`new FontFaceSet().check(${JSON.stringify('16px "Microsoft \\59 aHei"')})`),false);
  for(const fallback of ['monospace','sans-serif','serif']){
    const result=run(`(()=>{const c=new CanvasRenderingContext2D();c.font=${JSON.stringify('bold 72px "Microsoft YaHei", '+fallback)};return c.measureText('abc').font})()`);
    assert.ok(result.endsWith(', '+fallback));assert.ok(!result.includes('Arial'));assert.ok(result.startsWith('bold 72px '));
  }
});
test('模拟位置回调、watch 取消，不请求真实坐标',async()=>{
  const run=realm({locationEnabled:true,latitude:12.34,longitude:56.78});
  const pos=await run('new Promise(resolve=>navigator.geolocation.getCurrentPosition(resolve))');
  assert.equal(pos.coords.latitude,12.34);assert.equal(pos.coords.longitude,56.78);
  assert.equal(await run(`new Promise(resolve=>{let called=false;const id=navigator.geolocation.watchPosition(()=>called=true);navigator.geolocation.clearWatch(id);setTimeout(()=>resolve(called),15)})`),false);
});
