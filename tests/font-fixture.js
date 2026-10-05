// Font names from the supplied screenshot and the public IPPure detector.
export const fontCandidates = ['Microsoft YaHei','Microsoft YaHei UI','SimSun','NSimSun','SimHei','KaiTi','FangSong','DengXian','PingFang SC','Hiragino Sans GB','STHeiti','STSong','Songti SC','Source Han Sans CN','Source Han Sans SC','Noto Sans CJK SC','Noto Serif CJK SC','WenQuanYi Micro Hei','WenQuanYi Zen Hei','Microsoft JhengHei','PMingLiU','MingLiU','DFKai-SB','PingFang TC','PingFang HK','Source Han Sans TW','Noto Sans CJK TC','DingTalk JinBuTi','HarmonyOS Sans','MiSans','OPPO Sans','Alibaba PuHuiTi'];
// Independent width probe: compare each candidate against the same generic
// fallback. The old Arial substitution fails this test for serif / monospace.
export function probeFonts(candidates, offscreen=false) {
  const canvas=offscreen?new OffscreenCanvas(600,120):document.createElement('canvas');
  const ctx=canvas.getContext('2d'),detected=[],differences=[];
  for(const name of candidates){
    let found=false;
    for(const fallback of ['monospace','sans-serif','serif']){
      ctx.font=`72px ${fallback}`;
      const base=ctx.measureText('中文字体检测ABCabc012').width;
      ctx.font=`72px "${name}", ${fallback}`;
      const width=ctx.measureText('中文字体检测ABCabc012').width;
      const delta=Math.abs(base-width);
      if(delta>0.5)found=true;
      differences.push({name,fallback,delta});
    }
    if(found)detected.push(name);
  }
  return {detected,differences};
}
