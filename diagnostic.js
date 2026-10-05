const canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d');
const fonts=['Microsoft YaHei','微软雅黑','PingFang SC','MiSans','HarmonyOS Sans','OPPO Sans','DingTalk JinBuTi','SimSun','DengXian'];
const widths=Object.fromEntries(fonts.map(font=>{ctx.font=`20px "${font}"`;return [font,ctx.measureText('中文测试ABC😀').width];}));
const fontFallbacks=Object.fromEntries(['monospace','sans-serif','serif'].map(fallback=>{
  ctx.font=`72px ${fallback}`;
  const baseline=ctx.measureText('中文字体检测ABCabc012').width;
  const detected=fonts.filter(font=>{ctx.font=`72px "${font}", ${fallback}`;return Math.abs(ctx.measureText('中文字体检测ABCabc012').width-baseline)>0.5;});
  return [fallback,{baseline,detected}];
}));
ctx.font='28px Arial';ctx.fillText('中文字体 / Emoji  😀 ❤️ 🌍 🎉',10,45);
let rtc='可构造（未建立连接）';try{const pc=new RTCPeerConnection();pc.close();}catch(e){rtc=`${e.name}: ${e.message}`;}
const report={url:location.href,language:navigator.language,languages:navigator.languages,ua:navigator.userAgent,platform:navigator.platform,uaClientHints:navigator.userAgentData?.toJSON?.()??null,Intl日期:new Intl.DateTimeFormat().resolvedOptions(),Intl数字:new Intl.NumberFormat().resolvedOptions(),当前本地时间:new Date().toString(),当前偏移分钟:new Date().getTimezoneOffset(),isUTC8:new Date().getTimezoneOffset()===-480,一月偏移:new Date('2026-01-01T12:00:00Z').getTimezoneOffset(),七月偏移:new Date('2026-07-01T12:00:00Z').getTimezoneOffset(),格式化数字:(1234567.89).toLocaleString(),中文字体Canvas宽度:widths,字体检测:document.fonts.check('16px "Microsoft YaHei"'),WebRTC:rtc};
report.中文字体回退比较=fontFallbacks;
const flagCanvas=document.getElementById('flag-canvas'),flagContext=flagCanvas.getContext('2d');
const flagSamples=['🇹🇼','🇨🇳','🇭🇰','🇲🇴','🇺🇸','🇯🇵','🇸🇬','🇬🇧'];
flagContext.font='48px Arial';flagContext.textBaseline='top';
report.国旗像素=flagSamples.map((flag,index)=>{
  const x=index*66;flagContext.fillText(flag,x,5);
  const pixels=flagContext.getImageData(x,0,64,64).data;let colored=0;
  for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>64&&Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>25)colored++;
  return {flag,coloredPixels:colored,width:flagContext.measureText(flag).width};
});
document.getElementById('result').textContent=JSON.stringify(report,null,2);
fetch('/headers').then(r=>r.json()).then(data=>document.getElementById('headers').textContent=JSON.stringify(data,null,2)).catch(()=>document.getElementById('headers').textContent='请通过 node tools/server.mjs 启动本地检测服务。');
document.getElementById('locate').onclick=()=>navigator.geolocation.getCurrentPosition(p=>document.getElementById('geo').textContent=JSON.stringify({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy},null,2),e=>document.getElementById('geo').textContent=`${e.code}: ${e.message}`);
