/* Finite, forward-only page splitting. Browsing changes only the in-memory
   layout; persistence remains owned by the existing editor save flow. */
(() => {
 'use strict';
 const image=/!\[[^\]]*\]\(([^)]+)\)/g,metricsCache=new Map(),widthCache=new Map();
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
 const uid=()=>crypto.randomUUID();
 function text(value){return value.replace(/^[ \t]*!\[[^\]]*\]\(([^)]+)\)[ \t]*\n?/gm,'').replace(image,'').trimEnd();}
 function metrics(post){
  const key=[post.title,post.date,post.mood].join('|');if(metricsCache.has(key))return metricsCache.get(key);
  const paper=document.createElement('article');paper.className='book-home-paper free-book-paper';paper.style.cssText='position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;';
  const header=document.createElement('header'),date=document.createElement('span'),title=document.createElement('h3'),body=document.createElement('div'),sample=document.createElement('div');
  date.textContent=post.date+'　'+app.getMoodObj(post.mood).emoji;title.textContent=post.title;header.append(date,title);paper.append(header);body.className='book-home-content';sample.className='book-home-text';body.append(sample);paper.append(body);document.body.append(paper);
  const style=getComputedStyle(sample),top=Math.max(115,header.offsetTop+header.offsetHeight+12),line=parseFloat(style.lineHeight)||26.6;
  const value={top,bottom:512,line,width:352,font:style.fontWeight+' '+style.fontSize+' '+style.fontFamily,lines:Math.max(1,Math.floor((512-top-8)/line))};paper.remove();
  if(metricsCache.size>512)metricsCache.clear();metricsCache.set(key,value);return value;
 }
 function charWidth(char,font){let widths=widthCache.get(font);if(!widths){widths=new Map();widthCache.set(font,widths);}if(!widths.has(char)){ctx.font=font;widths.set(char,ctx.measureText(char).width);}return widths.get(char);}
 function* pieces(value,m){
  let head='',lines=1,width=0,emitted=false;
  for(const char of value){
   if(char==='\n'){
    if(lines>=m.lines){yield {head,lines};emitted=true;head='';lines=1;width=0;continue;}
    head+=char;lines++;width=0;continue;
   }
   const next=charWidth(char,m.font);
   if(width&&width+next>m.width-4){
    if(lines>=m.lines){yield {head,lines};emitted=true;head='';lines=1;}else lines++;
    width=0;
   }
   head+=char;width+=next;
  }
  if(head||!emitted)yield {head,lines:head?lines:0};
 }
 function photoHeight(item){const ratio=Number(item.aspect)>0?Number(item.aspect):1.45;return Math.min(270,item.width/ratio)+22+(item.caption?26:0);}
 function geometry(item){const angle=(Number(item.rotate)||0)*Math.PI/180,w=Number(item.width)||145,h=photoHeight(item);return {w,h,width:Math.abs(w*Math.cos(angle))+Math.abs(h*Math.sin(angle)),height:Math.abs(h*Math.cos(angle))+Math.abs(w*Math.sin(angle))};}
 function fits(item,m){const g=geometry(item);return item.x+(g.w-g.width)/2>=0&&item.x+(g.w+g.width)/2<=400&&item.y+(g.h-g.height)/2>=0&&item.y+(g.h+g.height)/2<=m.bottom-4;}
 function constrain(item,post){const m=metrics(post);let g=geometry(item);for(let i=0;i<30&&(g.width>380||g.height>m.bottom-4)&&item.width>60;i++){item.width=Math.max(60,item.width*.9);g=geometry(item);}const dx=(g.width-g.w)/2,dy=(g.height-g.h)/2;item.x=Math.max(Math.max(0,dx)+4,Math.min(396-g.w-Math.max(0,dx),Number(item.x)||0));item.y=Math.max(Math.max(0,dy)+4,Math.min(m.bottom-g.h-Math.max(0,dy)-4,Number(item.y)||0));return item;}
 function tags(page){return new Map([...page.text.matchAll(image)].map(match=>[match[1],match[0]]));}
 function compose(page,plain,tagMap){page.text=plain+(page.photos.length?'\n'+page.photos.map(photo=>tagMap.get(photo.path)||'![照片]('+photo.path+')').join('\n'):'');}
 function ordered(pages,post){
  const source=pages[0],m=metrics(post),result=[];let page,used;
  const start=()=>{page={id:result.length?uid():source.id,text:'',photos:[],autoFlow:false,textTop:m.top};result.push(page);used=0;};start();
  const tokens=source.text.split(/(!\[[^\]]*\]\([^)]+\))/g);
  for(const token of tokens){const match=token.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
   if(match){const item=source.photos.find(p=>p.path===match[1]);if(!item)continue;item.width=Math.min(300,Math.max(120,item.width||200));let h=photoHeight(item),lines=Math.ceil((h+18)/m.line);if(used+lines>m.lines)start();item.x=(400-item.width)/2;item.y=m.top+used*m.line+6;delete item.autoPlace;page.photos.push(item);page.text+='\n'+match[0]+'\n'+'\n'.repeat(lines);used+=lines;}
   else if(token.trim()){let remaining=token.trim();while(remaining){if(used>=m.lines)start();const chunks=[...pieces(remaining,{...m,lines:Math.max(1,m.lines-used)})],part=chunks[0];page.text+=(page.text&&!page.text.endsWith('\n')?'\n':'')+part.head;used+=part.lines;remaining=chunks.slice(1).map(p=>p.head).join('');if(remaining)start();}}
  }
  pages.splice(0,pages.length,...result);return {added:result.length-1,metrics:m};
 }
 function paginate(pages,post){
  if(pages.length===1&&pages[0].orderedFlow)return ordered(pages,post);
  const m=metrics(post),result=[];let added=0;
  for(const source of pages){
   const tagMap=tags(source),plain=text(source.text),parts=[];let first=true;
   for(const piece of pieces(plain,m)){const page=first?source:{id:uid(),text:'',photos:[],autoFlow:true};page.textTop=m.top;parts.push({page,plain:piece.head,lines:piece.lines});if(!first)added++;first=false;}
   const photos=[...source.photos];source.photos=[];
   if(m.bottom-m.top<80){source.photos=photos;for(const part of parts){compose(part.page,part.plain,tagMap);result.push(part.page);}continue;}
   if(source.autoFlow){
    let slot=parts.at(-1),rowY=m.top+(slot.lines?slot.lines*m.line+14:0),column=0,rowHeight=0;
    for(const photo of photos){
     const item=photo;item.width=Math.min(160,Math.max(60,Number(item.width)||145));const h=photoHeight(item);
     if(rowY+h>m.bottom-4){const page={id:uid(),text:'',photos:[],autoFlow:true,textTop:m.top};slot={page,plain:'',lines:0};parts.push(slot);added++;rowY=m.top;column=0;rowHeight=0;}
     item.x=26+column*175;item.y=rowY;delete item.autoPlace;slot.page.photos.push(item);rowHeight=Math.max(rowHeight,h);column++;
     if(column===2){column=0;rowY+=rowHeight+14;rowHeight=0;}
    }
   }else{
    let overflow=null,column=0,rowY=m.top,rowHeight=0;
    const occupied=photos.filter(item=>!item.autoPlace&&fits(item,m));
    for(const item of photos){
     if(!item.autoPlace){constrain(item,post);source.photos.push(item);continue;}
     if(m.bottom-m.top<80){source.photos.push(item);continue;}
     if(item.autoPlace){
      const w=Math.min(160,Math.max(60,Number(item.width)||145)),h=photoHeight({...item,width:w}),start=m.top+(parts[0].lines?parts[0].lines*m.line+14:0);let position=null;
      for(let y=start;y+h<=m.bottom-4&&!position;y+=h+14)for(const x of [26,201]){
       if(!occupied.some(other=>x<other.x+other.width+8&&x+w+8>other.x&&y<other.y+photoHeight(other)+8&&y+h+8>other.y)){position={x,y};break;}
      }
      if(position){Object.assign(item,position,{width:w});delete item.autoPlace;source.photos.push(item);occupied.push(item);continue;}
     }
     item.width=Math.min(348,Math.max(60,Number(item.width)||145));let g=geometry(item);
     while((g.width>348||g.height>m.bottom-m.top-4)&&item.width>60){item.width=Math.max(60,item.width*.9);g=geometry(item);}
     if(g.width>170&&column){column=0;rowY+=rowHeight+14;rowHeight=0;}
     const h=g.height;
     if(!overflow||rowY+h>m.bottom-4){const page={id:uid(),text:'',photos:[],autoFlow:false,textTop:m.top};overflow={page,plain:'',lines:0};parts.push(overflow);added++;column=0;rowY=m.top;rowHeight=0;}
     item.x=26+column*175+Math.max(0,(g.width-g.w)/2);item.y=rowY+Math.max(0,(g.height-g.h)/2);delete item.autoPlace;overflow.page.photos.push(item);rowHeight=Math.max(rowHeight,h);column++;
     if(column===2||g.width>170){column=0;rowY+=rowHeight+14;rowHeight=0;}
    }
   }
   for(const part of parts){compose(part.page,part.plain,tagMap);result.push(part.page);}
  }
  pages.length=0;for(const page of result)pages.push(page);return {added,metrics:m};
 }
 window.JournalPagination={paginate,text,metrics,constrain};
})();

