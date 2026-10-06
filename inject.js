// Serialized into a document_start MAIN-world user script. Keep this function self-contained.
export function installProfile(profiles) {
  const host = location.hostname.toLowerCase().replace(/\.$/,'');
  const p = profiles.filter(x=>host===x.domain || (x.subdomains && host.endsWith('.'+x.domain))).sort((a,b)=>b.domain.length-a.domain.length)[0];
  if (!p?.enabled) return;
  const define = (object,key,descriptor)=>{ try { Object.defineProperty(object,key,{configurable:true,...descriptor}); } catch {} };
  const getter = (object,key,get)=>define(object,key,{get,enumerable:true});
  const method = (object,key,value)=>define(object,key,{value,writable:true});
  const defaultLocale = value=>value===undefined || (Array.isArray(value)&&!value.length) ? p.locale : value;
  const NativeDate = Date;
  const NativeDTF = Intl.DateTimeFormat;
  const dateProto = NativeDate.prototype;
  const nativeGetTime = dateProto.getTime;
  const nativeSetTime = dateProto.setTime;
  let partsFormatter;
  const nativeTimezone = new NativeDTF().resolvedOptions().timeZone;
  
  // Cache exact UTC seconds, matching Intl precision without assuming transition boundaries.
  const offsetCache = new Map();
  const offset = value=>{
    const time = Number(value);
    if (!Number.isFinite(time)) return NaN;
    const bucket = Math.floor(time / 1000);
    const cached = offsetCache.get(bucket);
    if (cached !== undefined) return cached;
    partsFormatter ||= new NativeDTF('en-US-u-ca-gregory-nu-latn',{timeZone:p.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    const parts = Object.fromEntries(partsFormatter.formatToParts(new NativeDate(time)).map(x=>[x.type,x.value]));
    const utc = new NativeDate(0);
    utc.setUTCFullYear(Number(parts.year),Number(parts.month)-1,Number(parts.day));
    utc.setUTCHours(Number(parts.hour)%24,Number(parts.minute),Number(parts.second),0);
    const res = (Math.floor(time/1000)*1000-nativeGetTime.call(utc))/60000;
    if (offsetCache.size > 2048) offsetCache.clear();
    offsetCache.set(bucket, res);
    return res;
  };
  // Reuse converted timestamps across consecutive getters; UTC setters still invalidate.
  const localDates = new WeakMap();
  const localDate = date=>{
    const time = nativeGetTime.call(date), cached=localDates.get(date);
    if(cached?.time===time)return cached.value;
    const value=new NativeDate(time-offset(time)*60000);
    localDates.set(date,{time,value});
    return value;
  };
  const fromLocal = time=>{
    if (!Number.isFinite(time)) return NaN;
    // Earlier instance in a DST overlap; move forward across a DST gap.
    const candidates = [...new Set([offset(time-86400000),offset(time),offset(time+86400000)])].map(o=>time+o*60000);
    const exact = candidates.filter(t=>Math.abs(t-offset(t)*60000-time)<1);
    return exact.length ? Math.min(...exact) : Math.max(...candidates);
  };
  // Preserve native Date fast paths when the requested zone already matches.
  if(p.timezone!==nativeTimezone){
    method(dateProto,'getTimezoneOffset',function(){return offset(nativeGetTime.call(this));});
    for (const suffix of ['FullYear','Month','Date','Day','Hours','Minutes','Seconds','Milliseconds']) {
      method(dateProto,`get${suffix}`,function(){return localDate(this)[`getUTC${suffix}`]();});
    }
    method(dateProto,'getYear',function(){return localDate(this).getUTCFullYear()-1900;});
    for (const suffix of ['FullYear','Month','Date','Hours','Minutes','Seconds','Milliseconds']) {
      method(dateProto,`set${suffix}`,function(...args){
        const value = nativeGetTime.call(this);
        const d = !Number.isFinite(value) && suffix==='FullYear' ? new NativeDate(0) : localDate(this);
        return nativeSetTime.call(this,fromLocal(d[`setUTC${suffix}`](...args)));
      });
    }
    method(dateProto,'setYear',function(year){
      year = Number(year);
      return this.setFullYear(year>=0 && year<=99 ? year+1900:year);
    });
    const dateString = date=>{
      if (!Number.isFinite(nativeGetTime.call(date))) return 'Invalid Date';
      const d = localDate(date), pad = n=>String(n).padStart(2,'0');
      return `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getUTCDay()]} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]} ${pad(d.getUTCDate())} ${String(d.getUTCFullYear()).padStart(4,'0')}`;
    };
    const zoneNameFormatter=new NativeDTF('en-US',{timeZone:p.timezone,timeZoneName:'long'});
    const timeString = date=>{
      const time = nativeGetTime.call(date);
      if (!Number.isFinite(time)) return 'Invalid Date';
      const d = localDate(date), o = -offset(time), pad = n=>String(n).padStart(2,'0');
      const name = zoneNameFormatter.formatToParts(date).find(x=>x.type==='timeZoneName')?.value || p.timezone;
      return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} GMT${o>=0?'+':'-'}${pad(Math.floor(Math.abs(o)/60))}${pad(Math.abs(o)%60)} (${name})`;
    };
    method(dateProto,'toDateString',function(){return dateString(this);});
    method(dateProto,'toTimeString',function(){return timeString(this);});
    method(dateProto,'toString',function(){return Number.isFinite(nativeGetTime.call(this))?`${dateString(this)} ${timeString(this)}`:'Invalid Date';});
    const nativeParse = NativeDate.parse;
    const parse = value=>{
      const text = String(value);
      // ISO date-only strings are UTC by specification. Zone-less date-times are local.
      const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(text);
      if (m) {
        const utc = nativeParse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]||'00'}.${(m[7]||'0').padEnd(3,'0')}Z`);
        return fromLocal(utc);
      }
      return nativeParse(text);
    };
    const WrappedDate = new Proxy(NativeDate,{
      apply(){return new NativeDate().toString();},
      construct(target,args,newTarget){
        let next = args;
        if (args.length>=2) next = [fromLocal(NativeDate.UTC(...args))];
        else if (args.length===1 && typeof args[0]==='string') next = [parse(args[0])];
        return Reflect.construct(target,next,newTarget);
      },
      get(target,key,receiver){ return key==='parse' ? parse : Reflect.get(target,key,receiver); }
    });
    method(globalThis,'Date',WrappedDate);
    method(dateProto,'constructor',WrappedDate);
  }
  for (const name of ['DateTimeFormat','NumberFormat','Collator','PluralRules','RelativeTimeFormat','ListFormat','DisplayNames','Segmenter']) {
    const Original = Intl[name];
    if (!Original) continue;
    const argsFor = args=>{
      const next = [...args];
      next[0]=defaultLocale(next[0]);
      if (name==='DateTimeFormat') next[1]={...(next[1] || {}),timeZone:next[1]?.timeZone ?? p.timezone};
      return next;
    };
    const Wrapped = new Proxy(Original,{
      construct(target,args,newTarget){return Reflect.construct(target,argsFor(args),newTarget);},
      apply(target,thisArg,args){return Reflect.apply(target,thisArg,argsFor(args));}
    });
    method(Intl,name,Wrapped);
    method(Original.prototype,'constructor',Wrapped);
  }
  for (const name of ['toLocaleString','toLocaleDateString','toLocaleTimeString']) {
    const original = dateProto[name];
    method(dateProto,name,function(locales,options){return original.call(this,defaultLocale(locales),{...options,timeZone:options?.timeZone??p.timezone});});
  }
  for (const proto of [Number.prototype,BigInt.prototype]) {
    const original = proto.toLocaleString;
    method(proto,'toLocaleString',function(locales,options){return original.call(this,defaultLocale(locales),options);});
  }
  const localeCompare = String.prototype.localeCompare;
  method(String.prototype,'localeCompare',function(other,locales,options){return localeCompare.call(this,other,defaultLocale(locales),options);});
  const navProto = Object.getPrototypeOf(navigator);
  const languages = Object.freeze([...p.languages]);
  getter(navProto,'languages',()=>languages);
  getter(navProto,'language',()=>languages[0]);
  if (p.ua) {
    const vendor=/Firefox\//i.test(p.ua)?'':/Version\/.*Safari\//i.test(p.ua)&&!/Chrome\//i.test(p.ua)?'Apple Computer, Inc.':/Chrome\//i.test(p.ua)?'Google Inc.':null;
    if(vendor!==null)getter(navProto,'vendor',()=>vendor);
    getter(navProto,'userAgent',()=>p.ua);
    getter(navProto,'appVersion',()=>p.ua.replace(/^Mozilla\//,''));
    getter(navProto,'platform',()=>p.platform);
    // Suppress UA-CH consistently with stripped request headers. Custom UA does not change the engine.
    getter(navProto,'userAgentData',()=>undefined);
  }
  if (p.webrtc==='block') {
    const blocked = function(){throw new DOMException('WebRTC 已由浏览器伪装大师阻断','NotAllowedError');};
    for (const key of ['RTCPeerConnection','webkitRTCPeerConnection','RTCDataChannel','RTCIceGatherer','RTCIceTransport']) if (key in globalThis) method(globalThis,key,blocked);
  }
  if (p.locationEnabled && navigator.geolocation) {
    const proto = Object.getPrototypeOf(navigator.geolocation);
    const watches = new Map(); let nextId = 1;
    const position = ()=>({coords:{latitude:p.latitude,longitude:p.longitude,accuracy:p.accuracy,altitude:null,altitudeAccuracy:null,heading:null,speed:null},timestamp:NativeDate.now(),toJSON(){return {coords:this.coords,timestamp:this.timestamp};}});
    method(proto,'getCurrentPosition',function(success){
      if (typeof success!=='function') throw new TypeError('success callback required');
      setTimeout(()=>success(position()),0);
    });
    method(proto,'watchPosition',function(success){
      if (typeof success!=='function') throw new TypeError('success callback required');
      const id = nextId++;
      const timer = setTimeout(()=>{if(watches.has(id)) success(position());},0);
      watches.set(id,timer); return id;
    });
    method(proto,'clearWatch',function(id){clearTimeout(watches.get(id));watches.delete(id);});
  }
  // Native font mode does not install font hooks, caches or observers.
  if(p.fonts==='native')return;
  const blockedFamily = /^(?:microsoft\s*(?:yahei|jhenghei)(?:\s*ui)?|微软雅黑|微软正黑体|pingfang(?:\s*(?:sc|tc|hk))?|苹方(?:-?(?:简|繁|港))?|mi\s*sans(?:\s*(?:vf|normal|latin))?|harmonyos\s*sans(?:\s*(?:sc|tc|regular))?|oppo\s*sans(?:\s*(?:regular|medium))?|dingtalk\s*(?:jinbuti|sans)|钉钉进步体|alibaba\s*puhuiti(?:\s*\d+(?:\.\d+)?)?|阿里巴巴普惠体|nsimsun|simsun(?:-extb)?|simhei|fangsong|kaiti|dengxian|宋体|新宋体|黑体|仿宋|楷体|等线|hiragino\s*sans\s*gb|st(?:heiti|song|kaiti|fangsong)|songti\s*sc|source\s*han\s*(?:sans|serif)\s*(?:cn|sc|tc|tw|hk)|noto\s*(?:sans|serif)\s*cjk\s*(?:sc|tc|hk)|wenquanyi\s*(?:micro\s*hei|zen\s*hei)|p?mingliu|dfkai-sb)$/i;
  const familyName = name=>name.trim().replace(/^(["'])(.*)\1$/s,'$2').replace(/\\([0-9a-f]{1,6}\s?|.)/gi,(_,escape)=>{
    const hex=/^[0-9a-f]{1,6}\s?$/i.test(escape);
    const code=hex?parseInt(escape,16):0;
    return hex ? String.fromCodePoint(code>0 && code<=0x10ffff ? code : 0xfffd) : escape;
  }).replace(/\s+/g,' ');
  const safeFamily=/^(?:serif|sans-serif|monospace|system-ui|cursive|fantasy|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|arial|arial black|helvetica|times new roman|times|courier new|courier|georgia|verdana|tahoma|trebuchet ms|impact|segoe ui|segoe ui emoji|apple color emoji|noto color emoji)$/i;
  const hiddenFamily=name=>blockedFamily.test(familyName(name)) || (p.fonts==='strict'&&!safeFamily.test(familyName(name)));
  
  // Bounded memoization avoids reparsing repeated font strings.
  const fontCache = new Map();
  const splitFont = font=>{
    // Canvas serializes font sizes as CSS lengths. Keep the shorthand prefix and
    // parse quoted/escaped family names without splitting commas inside quotes.
    const match=/^(.*?\b\d*\.?\d+(?:px|pt|pc|in|cm|mm|q|em|rem|%)(?:\s*\/\s*(?:normal|\d*\.?\d+(?:[a-z%]+)?))?\s+)(.+)$/i.exec(String(font));
    if(!match) return null;
    const families=[];let start=0,quote='';
    for(let i=0;i<match[2].length;i++){
      const ch=match[2][i];
      if(ch==='\\'){i++;continue;}
      if(quote){if(ch===quote)quote='';}
      else if(ch==='"'||ch==="'")quote=ch;
      else if(ch===','){families.push(match[2].slice(start,i));start=i+1;}
    }
    families.push(match[2].slice(start));
    return {prefix:match[1],families};
  };
  const hasBlockedFont = font=>{
    const key = String(font);
    const cached = fontCache.get(key);
    if (cached) return cached.blocked;
    const parsed = splitFont(key);
    const blocked = parsed?.families.some(hiddenFamily) || false;
    let normalized = key;
    if (blocked && parsed) {
      normalized = parsed.prefix + parsed.families.map(name=>hiddenFamily(name)?'"__bdm_unavailable_cjk_7cf2e01a__"':name).join(',');
    }
    if (fontCache.size > 1000) fontCache.clear();
    fontCache.set(key, { blocked, normalized });
    return blocked;
  };
  const normalizeFont = font=>{
    const key = String(font);
    const cached = fontCache.get(key);
    if (cached) return cached.normalized;
    hasBlockedFont(key);
    return fontCache.get(key)?.normalized || key;
  };
  
  for (const proto of [globalThis.CanvasRenderingContext2D?.prototype,globalThis.OffscreenCanvasRenderingContext2D?.prototype].filter(Boolean)) {
    for (const name of ['measureText','fillText','strokeText']) {
      const original = proto[name];
      if (!original) continue;
      method(proto,name,function(){
        const originalFont = this.font;
        const normalized = normalizeFont(originalFont);
        // Performance optimization: if font is safe, do NOT call this.font setter!
        // Avoids costly Canvas text-engine invalidations on every draw call.
        if (normalized === originalFont) {
          return Reflect.apply(original,this,arguments);
        }
        try {
          this.font = normalized;
          return Reflect.apply(original,this,arguments);
        } finally {
          this.font = originalFont;
        }
      });
    }
  }
  if (p.fonts!=='native' && globalThis.FontFaceSet) {
    const proto = FontFaceSet.prototype, check = proto.check, load = proto.load;
    method(proto,'check',function(font,text){return hasBlockedFont(font)?false:check.call(this,font,text);});
    method(proto,'load',function(font,text){return hasBlockedFont(font)?Promise.resolve([]):load.call(this,font,text);});
  }
  // Restrict DOM protection to short, explicitly styled, positioned font probes.
  // Normal app geometry must not read computed styles or mutate live elements.
  if(p.fonts==='strict' && globalThis.HTMLElement && globalThis.CSSStyleDeclaration){
    const nativeRect=Element.prototype.getBoundingClientRect;
    const nativeComputed=globalThis.getComputedStyle.bind(globalThis);
    const metrics=new Map();
    let probeHost,probe;
    const typography=['fontFamily','fontSize','fontStyle','fontWeight','fontStretch','fontVariant','fontFeatureSettings','fontVariationSettings','fontKerning','fontOpticalSizing','fontSizeAdjust','letterSpacing','wordSpacing','lineHeight','textTransform','textIndent','textRendering','whiteSpace','wordBreak','overflowWrap','writingMode','direction','tabSize','boxSizing','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderTopStyle','borderRightStyle','borderBottomStyle','borderLeftStyle'];
    const candidate=element=>{
      if(!(element instanceof HTMLElement)||!element.isConnected||element.childElementCount)return false;
      const style=element.style;
      if(style.position!=='absolute'&&style.position!=='fixed')return false;
      return !!style.fontFamily && hasBlockedFont(`16px ${style.fontFamily}`) && element.textContent.length>0 && element.textContent.length<=256;
    };
    const measure=(element,key,read)=>{
      if(!candidate(element))return read.call(element);
      const computed=nativeComputed(element);
      // Avoid imitating widgets, transforms and explicitly sized layout boxes.
      if(computed.transform!=='none'||computed.display==='none'||element.style.width||element.style.height)return read.call(element);
      const font=normalizeFont(`16px ${computed.fontFamily}`).slice(5);
      if(font===computed.fontFamily)return read.call(element);
      const values=typography.map(name=>computed[name]);
      const signature=JSON.stringify([key,element.textContent,element.style.cssText,values,devicePixelRatio,document.fonts?.status]);
      let value=metrics.get(signature);
      if(value===undefined){
        // Only this shadow tree changes; page observers never see probe mutations.
        // The live source element's styles and layout are never rewritten.
        if(!probeHost?.isConnected){
          probeHost=document.createElement('div');
          probeHost.style.cssText='all:initial!important;position:fixed!important;left:-100000px!important;top:0!important;width:0!important;height:0!important;contain:strict!important;visibility:hidden!important;pointer-events:none!important;';
          const root=probeHost.attachShadow({mode:'closed'});
          probe=document.createElement('span');root.append(probe);
          document.documentElement.append(probeHost);
        }
        probe.style.cssText='all:initial;position:absolute;width:max-content;height:auto;visibility:hidden;';
        for(let i=0;i<typography.length;i++)probe.style[typography[i]]=values[i];
        probe.style.fontFamily=font;
        probe.textContent=element.textContent;
        const result=read.call(probe);
        value=key==='rect'?[result.width,result.height]:result;
        if(metrics.size>=256)metrics.delete(metrics.keys().next().value);
        metrics.set(signature,value);
      }
      if(key!=='rect')return value;
      const original=nativeRect.call(element);
      return new DOMRect(original.x,original.y,...value);
    };
    method(Element.prototype,'getBoundingClientRect',function(){return measure(this,'rect',nativeRect);});
    for(const [proto,names]of [[HTMLElement.prototype,['offsetWidth','offsetHeight']],[Element.prototype,['clientWidth','clientHeight','scrollWidth','scrollHeight']]]){
      for(const name of names){const descriptor=Object.getOwnPropertyDescriptor(proto,name);if(descriptor?.get)define(proto,name,{...descriptor,get:function(){return measure(this,name,descriptor.get);}});}
    }
    // Bounded cache; no document-wide observer or animation-frame polling.
    document.fonts?.addEventListener('loadingdone',()=>metrics.clear());
    document.fonts?.addEventListener('loadingerror',()=>metrics.clear());
  }
  if(globalThis.FontFace){
    const Original=FontFace;
    const Wrapped=new Proxy(Original,{construct(target,args,newTarget){
      const next=[...args];
      if(typeof next[1]==='string')next[1]=next[1].replace(/local\(([^)]*)\)/gi,(whole,name)=>hiddenFamily(name)?'local("__bdm_unavailable_cjk_7cf2e01a__")':whole);
      return Reflect.construct(target,next,newTarget);
    }});
    method(globalThis,'FontFace',Wrapped);
  }
  if(globalThis.queryLocalFonts){const original=globalThis.queryLocalFonts;method(globalThis,'queryLocalFonts',async function(...args){return (await Reflect.apply(original,this,args)).filter(font=>!hiddenFamily(font.family));});}
}
