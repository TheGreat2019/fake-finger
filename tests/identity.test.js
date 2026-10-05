import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateIdentity,SYSTEMS,BROWSERS,compatible} from '../identity.js';
test('随机身份遵守固定项与系统兼容性，平台和 UA 一致',()=>{
  for(const os of ['random',...SYSTEMS])for(const browser of ['random',...BROWSERS]){
    if(os!=='random'&&browser!=='random'&&!compatible(os,browser)){
      assert.throws(()=>generateIdentity('Chrome/140.0.0.0',{os,browser}));continue;
    }
    for(let i=0;i<30;i++){
      const r=generateIdentity('Chrome/140.0.0.0',{os,browser});
      if(os!=='random')assert.equal(r.uaPlatform,os);
      assert.equal(r.identityOS,os);assert.equal(r.identityBrowser,browser);
      assert.ok(!r.ua.includes('Mozilla/4'));assert.ok(r.ua.startsWith('Mozilla/5.0'));
      if(browser==='Firefox')assert.match(r.ua,/Gecko\/20100101 Firefox\/(128|140)\.0/);
      if(browser==='Safari'){assert.equal(r.platform,'MacIntel');assert.match(r.ua,/Version\/.*Safari/);}
      if(browser==='Edge')assert.match(r.ua,/Chrome\/134\.0\.0\.0.*Edg\/134\.0\.3124\.(66|83)/);
    }
  }
});
