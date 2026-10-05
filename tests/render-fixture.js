export function probeDOMFonts(candidates,mode='inline'){
  const results=[];
  for(const name of candidates)for(const fallback of ['monospace','serif','sans-serif']){
    const element=document.createElement('span');element.textContent='中文字体检测ABCabc012';
    element.style.cssText=`position:absolute;white-space:nowrap;font:72px ${fallback};`;
    const parent=document.createElement('div'),style=document.createElement('style');
    parent.append(element);document.body.append(parent,style);
    const base=element.getBoundingClientRect().width,offset=element.offsetWidth;
    if(mode==='inline')element.style.fontFamily=`"${name}",${fallback}`;
    else if(mode==='inherited'){element.style.removeProperty('font-family');parent.style.fontFamily=`"${name}",${fallback}`;}
    else {element.className='bdm-font-regression';style.textContent=`.bdm-font-regression {font-family:"${name}",${fallback} !important;}`;}
    const saved=element.getAttribute('style');
    const rect=element.getBoundingClientRect(),width=element.offsetWidth;
    results.push({name,fallback,delta:Math.abs(rect.width-base),offsetDelta:Math.abs(width-offset),restored:saved===element.getAttribute('style')});
    parent.remove();style.remove();
  }
  return results;
}

export function measureDOMCost(){
  const el=document.createElement('span');el.textContent='中文字体检测ABCabc012';
  el.style.cssText='position:absolute;white-space:nowrap;font:32px "Microsoft YaHei",monospace';document.body.append(el);
  const observer=new MutationObserver(()=>{});observer.observe(el,{attributes:true});
  let total=0;const start=performance.now();
  for(let i=0;i<2000;i++)total+=el.offsetWidth;
  const ms=performance.now()-start,mutations=observer.takeRecords().length;observer.disconnect();el.remove();
  return {reads:2000,ms,mutations,total};
}

export async function checkMeasurementCache(){
  const el=document.createElement('span');el.style.cssText='position:absolute;white-space:nowrap;font:32px monospace';
  el.textContent='ABC中文';document.body.append(el);
  const base=el.offsetWidth;el.style.fontFamily='"Microsoft YaHei",monospace';
  const first=el.offsetWidth,repeat=el.offsetWidth;
  const rect=el.getBoundingClientRect(),x=rect.x;rect.x=999999;
  const isolated=el.getBoundingClientRect().x===x;
  el.textContent='ABC中文ABC中文';const changed=el.offsetWidth;
  el.style.fontFamily='monospace';const expected=el.offsetWidth;
  el.style.fontFamily='"Microsoft YaHei",monospace';const restored=el.offsetWidth;
  await Promise.resolve();const nextTask=el.offsetWidth;
  el.remove();return {base,first,repeat,isolated,changed,expected,restored,nextTask};
}
