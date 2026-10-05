// Read actual MAIN-world APIs on the selected saved domain. Never alters the
// detector's DOM, functions, scoring, or its displayed result.
export function auditEnvironment(){
  const candidates=['Microsoft YaHei','Microsoft YaHei UI','SimSun','NSimSun','SimHei','KaiTi','FangSong','DengXian','PingFang SC','Hiragino Sans GB','STHeiti','STSong','Songti SC','Source Han Sans CN','Source Han Sans SC','Noto Sans CJK SC','Noto Serif CJK SC','WenQuanYi Micro Hei','WenQuanYi Zen Hei','Microsoft JhengHei','PMingLiU','MingLiU','DFKai-SB','PingFang TC','PingFang HK','Source Han Sans TW','Noto Sans CJK TC','DingTalk JinBuTi','HarmonyOS Sans','MiSans','OPPO Sans','Alibaba PuHuiTi'];
  const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)throw new Error('页面无法创建 Canvas 2D 上下文。');
  const detected=[];
  for(const font of candidates){
    if(['monospace','sans-serif','serif'].some(base=>{
      ctx.font=`72px ${base}`;const reference=ctx.measureText('中文字体检测ABCabc012').width;
      ctx.font=`72px "${font}", ${base}`;return Math.abs(ctx.measureText('中文字体检测ABCabc012').width-reference)>.5;
    }))detected.push(font);
  }
  return {origin:location.origin,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,locale:Intl.DateTimeFormat().resolvedOptions().locale,languages:[...navigator.languages],offset:new Date().getTimezoneOffset(),ua:navigator.userAgent,platform:navigator.platform,fontCandidates:candidates.length,detectedFonts:detected,scope:'当前文档；不包含 Worker 或其他框架。不代表网站总评分。'};
}
