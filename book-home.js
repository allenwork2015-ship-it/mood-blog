/* Shared notebook surface. Browsing alone never serializes notes. */
(() => {
 'use strict';
 const p=BlogJournalApp.prototype,format=window.JournalBookFormat;
 const root=document.createElement('section');root.id='bookHome';root.hidden=true;
 root.innerHTML='<div id="bookHomeSpread"></div><div class="book-home-nav"><button id="bookHomePrev" type="button">上一頁</button><span id="bookHomePosition" role="status"></span><button id="bookHomeNext" type="button">下一頁</button><label class="book-jump-label">跳至 <input id="bookHomeJump" type="number" min="1" value="1" aria-label="跳至頁碼"> 頁</label><button id="bookHomeJumpGo" type="button">前往</button></div><div class="book-home-quick"><select id="bookHomeJournal" aria-label="跳至日記"></select><button id="bookHomeCleanEmpty" type="button">清除本篇空白頁</button></div>';
 root.insertAdjacentHTML('afterbegin','<p class="book-touch-help">單指左右翻頁；先點照片再拖曳編排。放大後可移動內容。</p>');
 root.insertAdjacentHTML('beforeend','<p id="bookHomeEditHint" class="book-window-readonly" hidden>此日記為唯讀，無法清除空白頁。</p>');document.getElementById('postsContainer').before(root);
 const tabs=document.createElement('div');tabs.className='book-home-tabs';tabs.setAttribute('role','group');tabs.setAttribute('aria-label','日記瀏覽模式');tabs.innerHTML='<button id="bookListMode" type="button" aria-pressed="true">列表模式</button><button id="bookReadMode" type="button" aria-pressed="false">日記本模式</button>';root.before(tabs);
 let enabled=false,leaves=[],index=0,signature='',epoch=0,observer=null,timer,workers=0,renderedCount=0;
 const queue=[],cache=new Map(),ownedURLs=new Set(),readyPhotos=new Map(),remoteURLs=new Map(),remoteBytes=new Map();let warmTimer=null,warmBusy=false,readyBytes=0;const photoKey=(post,path)=>(post.journalId||post.id)+'|'+path;let journalSignature='';
 function updateQuick(){const select=document.getElementById('bookHomeJournal'),posts=[...new Map(leaves.map(leaf=>[leaf.post.id,leaf.post])).values()],signature=JSON.stringify(posts.map(post=>[post.id,post.date,post.title]));if(signature!==journalSignature){journalSignature=signature;select.replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent='選擇日記快速跳轉';select.append(blank);const fragment=document.createDocumentFragment();for(const post of posts){const option=document.createElement('option');option.value=post.id;option.textContent=post.date+'　'+post.title;fragment.append(option);}select.append(fragment);}select.value=leaves[index]?.post.id||'';const jump=document.getElementById('bookHomeJump');jump.max=leaves.length||1;if(document.activeElement!==jump)jump.value=index+1;jump.disabled=!leaves.length;document.getElementById('bookHomeJumpGo').disabled=!leaves.length;const post=leaves[index]?.post;const clean=document.getElementById('bookHomeCleanEmpty'),editable=!!post&&!!window.FreeBookEditor?.canEdit(post);clean.hidden=!post;clean.disabled=!editable;clean.title=editable?'清除本篇沒有文字或照片的空白頁':'此日記為唯讀，無法清除空白頁';if(editable)clean.removeAttribute('aria-describedby');else clean.setAttribute('aria-describedby','bookHomeEditHint');document.getElementById('bookHomeEditHint').hidden=!post||editable;}
 const metrics=window.BookHomeDiagnostics={mode:'list',pageRenders:0,photoRequests:0,photoCacheHits:0,prefetched:0};
 Object.defineProperties(metrics,{photoCacheEntries:{enumerable:true,get:()=>remoteURLs.size},decodedPhotoEntries:{enumerable:true,get:()=>readyPhotos.size},decodedPhotoBytes:{enumerable:true,get:()=>readyBytes}});
 const listeners=[];let flipping=false,activeAnimation=null;
 window.BookHomeSurface={get leaves(){return leaves;},get index(){return index;},get slotLeaves(){return spreadAt(index);},get visibleLeaves(){return spreadAt(index).filter(Boolean);},get zoomed(){return (window.visualViewport?.scale||Math.max(1,document.documentElement.clientWidth/(window.innerWidth||1)))>1.02;},get enabled(){return enabled;},onShow(fn){listeners.push(fn);},redraw(){show();},refresh(){signature='';collect();},go(pageId){const at=leaves.findIndex(leaf=>leaf.page.id===pageId);if(at>=0){index=at;show();}}};
 const count=()=>document.documentElement.clientWidth<900?1:2;
 const frontPadding=()=>count()===2&&leaves.length%2===1;
 const spreadAt=start=>frontPadding()&&start===0?[null,leaves[0]]:leaves.slice(start,start+count());
 const nextStart=direction=>direction>0?index+(frontPadding()&&index===0?1:count()):(frontPadding()&&index===1?0:index-count());
 const alignIndex=value=>frontPadding()?(value===0?0:1+Math.floor((value-1)/2)*2):Math.floor(value/count())*count();
 function release(){epoch++;clearTimeout(warmTimer);readyPhotos.clear();readyBytes=0;remoteURLs.clear();remoteBytes.clear();observer?.disconnect();observer=null;queue.splice(0);cache.clear();for(const url of ownedURLs)URL.revokeObjectURL(url);ownedURLs.clear();}
 function photo(post,path){
  if(post.localImagePaths?.[path])return app.loadLocalPhoto(post,path);
  const key=photoKey(post,path);if(cache.has(key))return cache.get(key);
  const token=epoch;
  const result=(async()=>{if(post.imagesMap?.[path])return post.imagesMap[path];if(post.localImagePaths?.[path])return app.loadLocalPhoto(post,path);if(post.driveImages?.[path]){metrics.photoRequests++;const blob=await app.driveRequest('files/'+post.driveImages[path]+'?alt=media&supportsAllDrives=true',{},'blob');if(token!==epoch)return '';const url=URL.createObjectURL(blob);ownedURLs.add(url);remoteURLs.set(key,url);remoteBytes.set(key,blob.size);trimPhotos(url);return url;}return '';})();
  cache.set(key,result);result.then(url=>{if(!url&&cache.get(key)===result)cache.delete(key);},()=>{if(cache.get(key)===result)cache.delete(key);});return result;
 }
 function cachedPhoto(post,path){const key=photoKey(post,path),url=post.imagesMap?.[path]||remoteURLs.get(key);if(url){metrics.photoCacheHits++;return url;}return '';}
 function trimPhotos(keep){let bytes=[...remoteBytes.values()].reduce((a,b)=>a+b,0);const protectedURLs=new Set([...document.querySelectorAll('#bookHomeSpread img')].map(n=>n.src));for(const entry of readyPhotos.values())protectedURLs.add(entry.url);for(const [key,url]of remoteURLs){if(remoteURLs.size<=24&&bytes<=32*1024*1024)break;if(url===keep||protectedURLs.has(url))continue;bytes-=remoteBytes.get(key)||0;remoteBytes.delete(key);remoteURLs.delete(key);cache.delete(key);ownedURLs.delete(url);URL.revokeObjectURL(url);}}
 function attachPhoto(job,url){if(job.token!==epoch||!job.node.isConnected)return;const node=job.node;node.onload=()=>{if(job.token===epoch&&node.isConnected)window.FreeBookEditor?.photoReady(job.post,job.path,node.naturalWidth,node.naturalHeight);};node.onerror=()=>{if(job.token===epoch&&node.isConnected)node.alt='照片載入失敗，重新切頁可再試';};node.dataset.bookPhotoPath=job.path;node.dataset.bookPhotoJournal=job.post.journalId||job.post.id;node.loading='eager';node.src=url;if(node.complete&&node.naturalWidth)node.onload();}
 function drain(){while(workers<2&&queue.length){const job=queue.shift();if(job.token!==epoch||!job.node.isConnected)continue;workers++;photo(job.post,job.path).then(url=>{if(url)attachPhoto(job,url);else if(job.token===epoch&&job.node.isConnected)job.node.alt='照片暫時無法讀取';}).catch(()=>{if(job.token===epoch&&job.node.isConnected)job.node.alt='照片載入失敗，重新切頁可再試';}).finally(()=>{workers--;drain();if(!workers&&!queue.length)scheduleWarm();});}}
 async function warmNeighbours(token){if(token!==epoch||!enabled||warmBusy||workers||queue.length||document.hidden||window.FreeBookEditor?.dirty||app.offlineSyncing||app.folderSyncBusy||app.driveBusy)return;warmBusy=true;try{const nearby=[nextStart(1),nextStart(-1)].filter(n=>n>=0&&n<leaves.length).flatMap(n=>spreadAt(n).filter(Boolean));let warmed=0;for(const leaf of nearby){for(const path of new Set(app.imagePaths(leaf.page.text))){if(token!==epoch||!enabled||workers||queue.length||warmed>=2)return;const key=photoKey(leaf.post,path);if(readyPhotos.has(key))continue;const url=await photo(leaf.post,path);if(!url||token!==epoch)return;const image=new Image();image.decoding='async';image.src=url;try{if(image.decode)await image.decode();else await new Promise((resolve,reject)=>{if(image.complete)return image.naturalWidth?resolve():reject();image.onload=resolve;image.onerror=reject;});}catch{continue;}if(token!==epoch)return;const bytes=image.naturalWidth*image.naturalHeight*4;warmed++;metrics.prefetched++;if(bytes<=16*1024*1024){while(readyPhotos.size&&(readyPhotos.size>=4||readyBytes+bytes>16*1024*1024)){const oldest=readyPhotos.keys().next().value;readyBytes-=readyPhotos.get(oldest).bytes;readyPhotos.delete(oldest);}readyPhotos.set(key,{url,image,bytes});readyBytes+=bytes;}trimPhotos(url);}}}catch(error){/* A failed speculative read is retried normally when its page opens. */}finally{warmBusy=false;if(token!==epoch&&enabled)scheduleWarm();}}
 function scheduleWarm(){clearTimeout(warmTimer);const token=epoch;warmTimer=setTimeout(()=>warmNeighbours(token),350);}
 let geometry={width:0,scale:1,count:1};
 function resize(){const host=document.getElementById('bookHomeSpread'),n=count(),available=host.clientWidth;
  if(!available)return geometry;
  const width=Math.min(400,Math.max(1,(available-28)/n)),scale=width/400;geometry={width,scale,count:n};
  host.style.setProperty('--book-scale',scale);host.style.setProperty('--book-width',(n*width)+'px');host.style.setProperty('--book-height',(560*scale)+'px');host.classList.toggle('book-home-double',n===2);
  host.querySelectorAll(':scope>.book-home-slot').forEach(slot=>sizeSlot(slot));return geometry;
 }
 function sizeSlot(slot){slot.style.width=geometry.width+'px';slot.style.height=(560*geometry.scale)+'px';slot.firstElementChild.style.transform='scale('+geometry.scale+')';}
 function show(){
  if(!enabled)return;metrics.pageRenders++;observer?.disconnect();queue.splice(0);
  const host=document.getElementById('bookHomeSpread');resize();const fragment=document.createDocumentFragment(),n=count();renderedCount=n;index=alignIndex(Math.min(Math.max(0,index),Math.max(0,leaves.length-1)));const visible=spreadAt(index);
  document.getElementById('bookHomePrev').disabled=index===0;document.getElementById('bookHomeNext').disabled=nextStart(1)>=leaves.length;
  document.getElementById('bookHomePosition').textContent=leaves.length?(index+1)+'－'+Math.min(index+visible.filter(Boolean).length,leaves.length)+'／'+leaves.length+' 頁':'尚無符合的日記';
  updateQuick();
  const pictures=[];
  for(const leaf of visible){
   if(!leaf){const slot=document.createElement('div');slot.className='book-home-slot book-home-padding-slot';slot.append(blankPaper());sizeSlot(slot);fragment.append(slot);continue;}
   const {post,page,pageNumber,total}=leaf,slot=document.createElement('div'),paper=document.createElement('article');slot.className='book-home-slot';paper.className='book-home-paper';paper.dataset.pageId=page.id;slot.append(paper);sizeSlot(slot);fragment.append(slot);
   const heading=document.createElement('header'),mood=app.getMoodObj(post.mood),date=document.createElement('span'),title=document.createElement('h3'),body=document.createElement('div'),footer=document.createElement('footer'),open=document.createElement('button');
   date.textContent=post.date+'　'+mood.emoji+' '+mood.name;title.textContent=post.title;heading.append(date,title);paper.append(heading);body.className='book-home-content';paper.append(body);open.textContent='閱讀全文';open.onclick=()=>app.openViewModal(post.id);footer.textContent=total>1?'第 '+pageNumber+'／'+total+' 頁　':'';footer.append(open);paper.append(footer);
   const text=document.createElement('div');text.className='book-home-text';text.textContent=JournalPagination.text(page.text);text.style.top=(page.textTop||115)+'px';body.append(text);
   const paths=[...new Set(app.imagePaths(page.text))];
   if(leaf.layout){body.classList.add('book-home-layout');text.style.position='relative';text.style.zIndex='10';}
   for(const [i,path]of paths.entries()){
    const image=document.createElement('img');image.alt='日記照片';image.loading='eager';image.decoding='async';
    if(leaf.layout){const placement=page.photos.find(p=>p.path===path),frame=document.createElement('figure');frame.className='book-home-placement'+(placement?.frame==='none'?' free-frameless':'');const value=(v,fallback)=>Number.isFinite(Number(v))?Number(v):fallback;frame.style.left=Math.max(0,Math.min(370,value(placement?.x,20+(i%2)*170)))+'px';frame.style.top=Math.max(0,Math.min(450,value(placement?.y,240)))+'px';frame.style.width=Math.max(60,Math.min(370,value(placement?.width,150)))+'px';frame.style.transform='rotate('+value(placement?.rotate,0)+'deg)';frame.style.zIndex=placement?.layer==='behind'?'1':String(20+Math.max(0,Math.min(100,value(placement?.z,i))));frame.append(image);if(placement?.caption){const caption=document.createElement('figcaption');caption.textContent=placement.caption;frame.append(caption);}body.append(frame);}else body.append(image);
    pictures.push({node:image,post,path,token:epoch});
   }
  }
  if(!leaves.length){const empty=document.createElement('p');empty.textContent='請先選擇資料夾或連接 Google Drive，日記會自動帶入。';fragment.append(empty);}
  host.replaceChildren(fragment);listeners.forEach(fn=>fn());
  for(const job of pictures){const url=cachedPhoto(job.post,job.path);if(url)attachPhoto(job,url);else queue.push(job);}drain();scheduleWarm();
 }
 function collect(){
  const available=app.displayPosts(),remoteIds=new Set(available.filter(post=>!post.localEntry).map(post=>post.id));
  const posts=available.filter(post=>!post.localEntry?.target||!remoteIds.has(post.localEntry.target.folderId)).filter(post=>(app.currentFilter==='all'||post.mood===app.currentFilter)&&(!app.searchQuery||(post.title+' '+post.content).toLowerCase().includes(app.searchQuery))).sort((a,b)=>b.date.localeCompare(a.date));
  const next=JSON.stringify(posts.map(post=>[post.id,post.localSourceId||app.driveRoot?.id||window.JournalPersistence?.rootKey(app.rootDirHandle),post.title,post.date,post.mood,post.content]));if(next===signature)return;const selected=leaves[index]?.post.id,selectedPage=leaves[index]?.page.id;signature=next;release();leaves=posts.flatMap(post=>{const layout=true;const pages=window.FreeBookEditor?FreeBookEditor.pages(post):format.pagesOf(post.content);return pages.map((page,i)=>({post,page,layout,pageNumber:i+1,total:pages.length}));});let at=leaves.findIndex(leaf=>leaf.page.id===selectedPage);if(at<0)at=leaves.findIndex(leaf=>leaf.post.id===selected);index=at<0?0:at;show();
 }
 function setMode(book){activeAnimation?.cancel();enabled=book;metrics.mode=book?'book':'list';document.getElementById('bookListMode').setAttribute('aria-pressed',String(!book));document.getElementById('bookReadMode').setAttribute('aria-pressed',String(book));root.hidden=!book;document.getElementById('postsContainer').hidden=book;if(book){document.getElementById('pagination').hidden=true;document.getElementById('emptyState').classList.add('hidden');signature='';collect();if(!leaves.length)show();}else{release();app.renderPosts();}}
 function blankPaper(){const paper=document.createElement('article');paper.className='book-home-paper book-home-padding';paper.setAttribute('aria-label','空白書頁');return paper;}
 function snapshot(leaf,scale){
  if(!leaf){const paper=blankPaper();paper.style.transform='scale('+scale+')';return paper;}
  const existing=leaf?[...document.querySelectorAll('#bookHomeSpread>.book-home-slot>.book-home-paper')].find(paper=>paper.dataset.pageId===leaf.page.id):null;
  if(existing){const copy=existing.cloneNode(true);copy.querySelectorAll('button,input,label,.free-selected').forEach(node=>node.matches('.free-selected')?node.classList.remove('free-selected'):node.remove());copy.querySelectorAll('[contenteditable]').forEach(node=>node.contentEditable='false');copy.style.transform='scale('+scale+')';return copy;}
  const paper=document.createElement('article');paper.className='book-home-paper free-book-paper';paper.style.transform='scale('+scale+')';if(!leaf)return paper;
  const {post,page}=leaf,head=document.createElement('header'),date=document.createElement('span'),title=document.createElement('h3'),body=document.createElement('div'),text=document.createElement('div');date.textContent=post.date+'　'+app.getMoodObj(post.mood).name;title.textContent=post.title;head.append(date,title);paper.append(head);body.className='book-home-content book-home-layout';text.className='book-home-text';text.textContent=page.text.replace(/!\[[^\]]*\]\(([^)]+)\)/g,'');body.append(text);paper.append(body);
  app.imagePaths(page.text).forEach((path,i)=>{const item=page.photos.find(p=>p.path===path)||{x:26+(i%2)*175,y:205,width:145,rotate:0},frame=document.createElement('figure'),img=document.createElement('img');frame.className='book-home-placement';frame.style.cssText='left:'+item.x+'px;top:'+item.y+'px;width:'+item.width+'px;transform:rotate('+(item.rotate||0)+'deg);z-index:'+(item.layer==='behind'?1:20+(item.z||0));img.alt='日記照片';frame.append(img);body.append(frame);const job={node:img,post,path,token:epoch},url=cachedPhoto(post,path);if(url){img.loading='eager';img.src=url;}else queue.push(job);});return paper;
 }
 async function flip(direction){if(flipping)return;const next=nextStart(direction);if(next<0||next>=leaves.length)return;flipping=true;window.FreeBookEditor?.finishGesture();const host=document.getElementById('bookHomeSpread');let card=null,animation=null;try{if(matchMedia('(prefers-reduced-motion: reduce)').matches){index=next;show();return;}
  if(count()===1){
   const previous=snapshot(leaves[index],geometry.scale),slot=host.querySelector('.book-home-slot'),left=slot.offsetLeft,top=slot.offsetTop;
   host.inert=true;index=next;show();card=document.createElement('div');card.className='book-home-mobile-leaf';card.setAttribute('aria-hidden','true');card.style.cssText='left:'+left+'px;top:'+top+'px;width:'+geometry.width+'px;height:'+(560*geometry.scale)+'px';card.append(previous);host.append(card);
   animation=activeAnimation=card.animate([{transform:'translateX(0)',opacity:1},{transform:'translateX('+(-direction*12)+'px)',opacity:0}],{duration:340,easing:'ease',fill:'both'});await animation.finished;return;
  }
  const slots=host.querySelectorAll(':scope>.book-home-slot'),right=slots[1]||slots[0],width=right.offsetWidth,height=right.offsetHeight,scale=width/400;
  const current=spreadAt(index),target=spreadAt(next),front=snapshot(direction>0?current[1]:target[1],scale),back=snapshot(direction>0?target[0]:current[0],scale),under=snapshot(direction>0?target[1]:target[0],scale);
  card=document.createElement('div');card.className='book-home-flip-card';card.setAttribute('aria-hidden','true');card.style.cssText='left:'+right.offsetLeft+'px;top:'+right.offsetTop+'px;width:'+width+'px;height:'+height+'px';const face=document.createElement('div'),reverse=document.createElement('div');face.className='book-home-flip-face';reverse.className='book-home-flip-face book-home-flip-back';face.append(front);reverse.append(back);card.append(face,reverse);(direction>0?right:slots[0]).replaceChildren(under);host.append(card);host.inert=true;drain();
  animation=activeAnimation=card.animate([{transform:'rotateY('+(direction>0?0:-180)+'deg)'},{transform:'rotateY('+(direction>0?-180:0)+'deg)'}],{duration:800,easing:'cubic-bezier(0.645,0.045,0.355,1)',fill:'both'});await animation.finished;index=next;show();
 }catch(e){if(e.name!=='AbortError')throw e;}finally{animation?.cancel();card?.remove();activeAnimation=null;host.inert=false;flipping=false;}}
 const jump=()=>{if(flipping)return;const value=Number(document.getElementById('bookHomeJump').value);if(!Number.isInteger(value)||value<1||value>leaves.length)return app.showToast('請輸入 1 至 '+leaves.length+' 的頁碼','error');window.FreeBookEditor?.finishGesture();index=value-1;show();};document.getElementById('bookHomeJumpGo').onclick=jump;document.getElementById('bookHomeJump').onkeydown=event=>{if(event.key==='Enter')jump();};document.getElementById('bookHomeJournal').onchange=event=>{if(flipping)return;const at=leaves.findIndex(leaf=>leaf.post.id===event.target.value);if(at>=0){window.FreeBookEditor?.finishGesture();index=at;show();}};document.getElementById('bookHomeCleanEmpty').onclick=()=>{const leaf=leaves[index];if(leaf)window.FreeBookEditor?.cleanEmpty(leaf.post);};
 document.getElementById('bookListMode').onclick=()=>{window.FreeBookEditor?.finishGesture();setMode(false);};document.getElementById('bookReadMode').onclick=()=>setMode(true);document.getElementById('bookHomePrev').onclick=()=>flip(-1);document.getElementById('bookHomeNext').onclick=()=>flip(1);
 const render=p.renderPosts;p.renderPosts=function(...args){if(!enabled)return render.apply(this,args);document.getElementById('postsContainer').hidden=true;document.getElementById('pagination').hidden=true;document.getElementById('emptyState').classList.add('hidden');collect();};
 // Observe inline width only: Safari toolbar/keyboard height changes must not rebuild pages.
 let observedWidth=0;
 const layout=()=>{if(!enabled)return;const width=document.getElementById('bookHomeSpread').clientWidth;if(Math.abs(width-observedWidth)<.5&&count()===renderedCount)return;observedWidth=width;activeAnimation?.cancel();if(count()!==renderedCount)show();else resize();};
 if('ResizeObserver'in window){const observer=new ResizeObserver(()=>{clearTimeout(timer);timer=setTimeout(layout,120);});observer.observe(root);}
 else window.addEventListener('resize',()=>{clearTimeout(timer);timer=setTimeout(layout,120);});
 // One reading gesture controller; photo editing owns selected photos only.
 const touchHost=document.getElementById('bookHomeSpread');let swipe=null,pointerReading=null,multiTouch=false,suppressClickUntil=0;
 const zoomed=()=>window.BookHomeSurface.zoomed;
 const resetGesture=()=>{swipe=null;pointerReading=null;multiTouch=false;};
 const syncZoom=()=>{touchHost.classList.toggle('book-home-zoomed',zoomed());if(zoomed()){swipe=null;window.FreeBookEditor?.cancelGesture();}};
 if(window.visualViewport)window.visualViewport.addEventListener('resize',syncZoom);else window.addEventListener('resize',syncZoom);syncZoom();
 const readingTarget=target=>{
  if(!(target instanceof Element)||target.closest('button,input,label,select,a,.free-selected,.free-layer,.free-resize,.free-rotate'))return false;
  const text=target.closest('[contenteditable=true]');return !text||!(document.activeElement===text||text.contains(document.activeElement));
 };
 touchHost.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch')return;suppressClickUntil=0;
  if(event.isPrimary===false){multiTouch=true;swipe=null;window.FreeBookEditor?.cancelGesture();event.stopPropagation();return;}
  pointerReading=readingTarget(event.target);
 },{capture:true});
 touchHost.addEventListener('touchstart',event=>{
  if(event.touches.length!==1){multiTouch=true;swipe=null;window.FreeBookEditor?.cancelGesture();return;}
  if(!enabled||flipping||zoomed()||multiTouch||!(pointerReading??readingTarget(event.target)))return;
  const t=event.touches[0];if(!touchHost.contains(t.target)||t.clientX<20||t.clientX>document.documentElement.clientWidth-20)return;
  swipe={id:t.identifier,x:t.clientX,y:t.clientY,dx:0,dy:0,started:performance.now(),claimed:false,rejected:false};
 },{passive:true,capture:true});
 touchHost.addEventListener('touchmove',event=>{
  if(!swipe)return;if(event.touches.length!==1||zoomed()||multiTouch){swipe=null;return;}if(swipe.rejected)return;
  const t=[...event.touches].find(t=>t.identifier===swipe.id);if(!t){swipe=null;return;}
  swipe.dx=t.clientX-swipe.x;swipe.dy=t.clientY-swipe.y;const x=Math.abs(swipe.dx),y=Math.abs(swipe.dy);
  if(!swipe.claimed){if(y>12&&y>=x*.8){swipe.rejected=true;return;}if(x>=12&&x>y*1.7){if(!event.cancelable){swipe.rejected=true;return;}swipe.claimed=true;}}
  if(swipe.claimed&&event.cancelable){event.preventDefault();event.stopPropagation();}
 },{passive:false,capture:true});
 touchHost.addEventListener('touchend',event=>{
  const gesture=swipe;if(!event.touches.length){swipe=null;pointerReading=null;const wasMulti=multiTouch;multiTouch=false;
   if(!gesture||wasMulti||gesture.rejected||zoomed())return;
   if(gesture.claimed&&event.cancelable)event.preventDefault();
   if(gesture.claimed&&Math.abs(gesture.dx)>=48&&Math.abs(gesture.dx)>Math.abs(gesture.dy)*1.7&&performance.now()-gesture.started<900&&enabled&&!flipping){suppressClickUntil=performance.now()+500;flip(gesture.dx<0?1:-1);}
  }
 },{passive:false,capture:true});
 touchHost.addEventListener('click',event=>{if(event.detail!==0&&event.pointerType!=='mouse'&&performance.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
 touchHost.addEventListener('touchcancel',resetGesture,{passive:true});window.addEventListener('blur',resetGesture);window.addEventListener('pagehide',resetGesture);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)resetGesture();});
 document.head.insertAdjacentHTML('beforeend','<link rel="stylesheet" href="./book-home.css?v=22">');
})();
