(() => {
 const parseDay=value=>{
  const text=String(value??'').normalize('NFKC').replace(/[\s日號]/g,'');
  if(/^\d{1,2}$/.test(text)){const n=Number(text);return n>=1&&n<=30?n:null;}
  const digits={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  const s=text.replace(/^初/,'');
  let n=digits[s]||({十:10,二十:20,三十:30,廿:20,卅:30}[s]);
  if(!n&&/^十[一二三四五六七八九]$/.test(s))n=10+digits[s.slice(1)];
  if(!n&&/^廿[一二三四五六七八九]$/.test(s))n=20+digits[s.slice(1)];
  if(!n&&/^二十[一二三四五六七八九]$/.test(s))n=20+digits[s.slice(2)];
  return n>=1&&n<=30?n:null;
 };
 // Offline Chinese-calendar month lengths, generated with ICU, 2019-01-06 to 2101-01-28.
 const monthStarts=[17902];
 for(const bit of '1101010010011011101001010101101010101010101101010101001101101010100101101101010010101110101001001111010100100110111010010011011010101001011011010101001101011010101001011011010100101011101010010101101101001001101110100100101111010010010111010101001011011010101001011010110100101011011010100101011011010010011011101001001011110100100101110101010010110110101001010110110100101010110110100101010110110100100110111010010010111101001001011101100100101101101010010101110101001010110101100101010101101100101010101110100100101110110010010111011001001011011010100101011101010010101101101001010101101010101010101101010101001101101010100101110110010010110110101001010111010100101011011010010101011010101010101011010101010101011010101001011101010100101101101010010101110101001001110110100100110111001010011011010101010101011010101010011011010101001011011010100101011101010010011101101000101101110100100110110101010010110110101010011010110101001010110110101001010111010100100111011010001011011101000101011101100100101110101010010')monthStarts.push(monthStarts.at(-1)+(bit==='1'?30:29));
 const fallbackDay=date=>{
  const stamp=Math.floor((date.getTime()+28800000)/86400000);
  if(!Number.isFinite(stamp))return null;
  if(stamp<monthStarts[0]||stamp>=monthStarts.at(-1))return null;
  let low=0,high=monthStarts.length-1;
  while(low+1<high){const mid=(low+high)>>1;if(monthStarts[mid]<=stamp)low=mid;else high=mid;}
  return stamp-monthStarts[low]+1;
 };
 let formatter;
 try{formatter=new Intl.DateTimeFormat('en-u-ca-chinese-nu-latn',{calendar:'chinese',numberingSystem:'latn',timeZone:'Asia/Taipei',day:'numeric'});if(formatter.resolvedOptions().calendar!=='chinese')formatter=null;}catch(error){}
 const lunar=date=>{
  let day=fallbackDay(date),label='',source='離線農曆表';
  if(day===null){source='Intl';try{if(formatter)day=parseDay(formatter.formatToParts(date).find(p=>p.type==='day')?.value);}catch(error){}}
  try{const labelFormatter=new Intl.DateTimeFormat('zh-TW-u-ca-chinese',{calendar:'chinese',timeZone:'Asia/Taipei',year:'numeric',month:'long',day:'numeric'});if(labelFormatter.resolvedOptions().calendar==='chinese')label=labelFormatter.format(date);}catch(error){}
  return {day,label:label||(day?'農曆 '+day+' 日':'月相日期暫不可用'),source};
 };
 const name=day=>day===1?'新月':day<8?'眉月':day===8?'上弦月':day<15?'盈凸月':day===15?'滿月':day<22?'虧凸月':day===22?'下弦月':'殘月';
 const draw=(canvas,value)=>{
  const day=parseDay(value)??lunar(new Date()).day;
  const n=canvas.width,r=n*.46,c=n/2,ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(day===null)return null;
  const data=ctx.createImageData(n,n),phase=(day-1)/29.53,theta=2*Math.PI*phase;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   const nx=(x+.5-c)/r,ny=(y+.5-c)/r,d=nx*nx+ny*ny;if(d>1)continue;
   const z=Math.sqrt(1-d),dot=nx*Math.sin(theta)-z*Math.cos(theta),lit=dot>0,shade=lit?.82+.18*z:1,base=lit?[253,224,135]:[37,46,65],i=(y*n+x)*4;
   data.data[i]=base[0]*shade;data.data[i+1]=base[1]*shade;data.data[i+2]=base[2]*shade;data.data[i+3]=Math.min(1,(1-Math.sqrt(d))*r)*255;
  }
  ctx.putImageData(data,0,0);canvas.dataset.lunarDay=String(day);
  return Math.round((1-Math.cos(theta))/2*100);
 };
 let sequence=0;
 const create=(value,size=64)=>{
  const day=parseDay(value)??lunar(new Date()).day;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 0 128 128');svg.setAttribute('width',size);svg.setAttribute('height',size);
  svg.setAttribute('role','img');svg.style.cssText='display:block;flex:none;overflow:visible;color-scheme:only light;isolation:isolate';
  svg.dataset.rendererVersion='svg-v11';
  if(day===null){svg.setAttribute('aria-label','月相日期暫不可用');return svg;}
  svg.dataset.lunarDay=String(day);svg.setAttribute('aria-label','農曆 '+day+' 日 '+name(day));
  const circle=document.createElementNS(ns,'circle');circle.setAttribute('cx','64');circle.setAttribute('cy','64');circle.setAttribute('r','58.88');circle.setAttribute('fill','#252e41');svg.append(circle);
  const theta=2*Math.PI*(day-1)/29.53,cos=Math.cos(theta),waxing=Math.sin(theta)>=0;
  svg.dataset.illumination=String(Math.round((1-cos)/2*100));
  if(day!==1){
   const id='shiguang-moon-'+(++sequence),defs=document.createElementNS(ns,'defs'),gradient=document.createElementNS(ns,'radialGradient');
   for(const [key,val]of Object.entries({id,gradientUnits:'userSpaceOnUse',cx:'64',cy:'64',r:'58.88'}))gradient.setAttribute(key,val);
   for(const [offset,color]of [['0%','#fde087'],['100%','#cfb86f']]){const stop=document.createElementNS(ns,'stop');stop.setAttribute('offset',offset);stop.setAttribute('stop-color',color);gradient.append(stop);}
   defs.append(gradient);svg.append(defs);
   const inner=waxing?cos:-cos,path=document.createElementNS(ns,'path');
   const terminator=Math.abs(inner)<.000001?'L 64 5.12':`A ${(Math.abs(inner)*58.88).toFixed(5)} 58.88 0 0 ${inner>=0?0:1} 64 5.12`;
   path.setAttribute('d',`M 64 5.12 A 58.88 58.88 0 0 ${waxing?1:0} 64 122.88 ${terminator} Z`);
   path.setAttribute('fill','url(#'+id+')');path.dataset.moonLit='true';svg.append(path);
  }
  return svg;
 };
 window.ShiguangMoon={lunar,name,draw,create,rendererVersion:'svg-v11'};
})();
