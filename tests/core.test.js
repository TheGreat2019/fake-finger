import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultProfile,validateProfile,normalizeDomain,patterns,matches,headerRules,profileFromIP,acceptLanguage,randomUA} from '../core.js';
test('域名规范化与输入边界',()=>{
  assert.equal(normalizeDomain('HTTPS://Example.COM/'),'example.com');
  assert.equal(normalizeDomain('例子.测试'),'xn--fsqu00a.xn--0zwm56d');
  for(const value of ['', '*.com','https://user:pass@example.com','example.com:443','example.com/path','example.com?q=1','file:///test','a b.com'])assert.throws(()=>normalizeDomain(value),value);
});
test('精确域名、子域名边界、非匹配站点',()=>{
  const p={...defaultProfile(),domain:'example.com'};
  assert.ok(matches('example.com',p));assert.ok(!matches('sub.example.com',p));
  p.subdomains=true;assert.ok(matches('sub.example.com',p));assert.ok(!matches('evil-example.com',p));assert.ok(!matches('example.com.evil.org',p));
  assert.deepEqual(patterns(p),['http://*.example.com/*','https://*.example.com/*']);
});

test('原生身份不改写 UA 或删除 Client Hints，保留语言规则',()=>{
  const rule=headerRules([{...defaultProfile(),domain:'example.com',ua:''}])[0];
  assert.deepEqual(rule.action.requestHeaders.map(h=>h.header),['Accept-Language']);
});
test('有效配置、非法时区、经纬度与语言',()=>{
  const p={...defaultProfile(),domain:'example.com'};
  assert.equal(validateProfile(p).locale,'en-US');
  for(const change of [{timezone:'Mars/Olympus'},{latitude:91},{longitude:-181},{latitude:''},{languages:[]},{languages:['bad tag']},{ua:'bad\r\nheader'},{locale:''},{accuracy:0},{enabled:'false'}])assert.throws(()=>validateProfile({...p,...change}));
});
test('请求头按目标域名隔离并同步语言权重',()=>{
  const p={...defaultProfile(),domain:'example.com',ua:'test UA'};
  const rule=headerRules([p])[0],re=new RegExp(rule.condition.regexFilter,'i');
  assert.ok(re.test('https://example.com:8443/path'));assert.ok(!re.test('https://sub.example.com/path'));assert.ok(!re.test('https://example.com.evil.org/'));assert.ok(!re.test('https://evil.org/?x=https://example.com/'));
  assert.equal(acceptLanguage(['en-US','en','de']),'en-US,en;q=0.9,de;q=0.8');
  assert.equal(rule.action.requestHeaders.find(h=>h.header==='sec-ch-ua').operation,'remove');
  assert.equal(headerRules([{...p,enabled:false}])[0].action.type,'allow');
});
test('IP 结果验证与未知地区回退',()=>{
  const data={timezone:{id:'Asia/Tokyo'},country_code:'JP',latitude:35,longitude:139};
  assert.equal(profileFromIP(data).locale,'ja-JP');assert.equal(profileFromIP(data).locationEnabled,true);
  assert.equal(profileFromIP({...data,country_code:'XX'}).regionKnown,false);
  assert.throws(()=>profileFromIP({success:false}));
});
test('参数随机覆盖四段版本、系统、架构，并同步 WebKit / Safari',()=>{
  const generated=new Set();
  for(const os of ['Windows','macOS','Linux'])for(let i=0;i<100;i++){
    const p=randomUA('Chrome/154.0.0.0',{mode:'parameters',os,minMajor:150,maxMajor:154});
    const version=p.ua.match(/Chrome\/(\d+)\.(\d+)\.(\d+)\.(\d+)/).slice(1).map(Number);
    assert.ok(version[0]>=150&&version[0]<=154);assert.ok(version[2]>=1000);assert.ok(version[3]>=1);
    assert.equal(p.ua.match(/AppleWebKit\/([\d.]+)/)[1],p.ua.match(/Safari\/([\d.]+)/)[1]);
    assert.equal(p.uaPlatform,os);assert.equal(p.platform,os==='Windows'?'Win32':os==='macOS'?'MacIntel':p.ua.match(/Linux [^)]*/)[0]);
    generated.add(p.ua);
  }
  assert.equal(generated.size,300);
});
test('兼容模板与范围校验',()=>{
  const p=randomUA('Chrome/154.0.0.0',{mode:'compatible',os:'Windows',minMajor:154,maxMajor:154});
  assert.match(p.ua,/Mozilla\/5\.0 .*Windows NT 10\.0; Win64; x64.*AppleWebKit\/537\.36.*Chrome\/154\.0\.0\.0 Safari\/537\.36/);
  for(const options of [{minMajor:155,maxMajor:154},{minMajor:1},{os:'bad'},{mode:'bad'}])assert.throws(()=>randomUA('Chrome/154',options));
});
