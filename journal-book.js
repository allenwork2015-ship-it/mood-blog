/* Optional notebook format. Body remains ordinary Markdown; metadata travels in
   every existing save/queue/backup path as part of content. No separate cloud file. */
(() => {
 'use strict';
 if(window.JournalBookFormat)return;
 const marker=/<!-- shiguang-book: ([A-Za-z0-9+/=]+) -->/g;
 const pageMarker=/\n?<!-- shiguang-page: ([A-Za-z0-9-]+) -->\n?/g;
 const uid=()=>crypto.randomUUID();
 function decode(content='') {
  const match=[...content.matchAll(marker)];
  let meta=null,error='';
  if(match.length)try{
   meta=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(match[0][1]),c=>c.charCodeAt(0))));
   if(meta.version!==1||!Array.isArray(meta.pages)||!meta.pages.length||meta.pages.some(p=>!p||typeof p.id!=='string'||!Array.isArray(p.photos)))throw Error('編排格式尚不支援');
  }catch(e){error=e.message;meta=null;}
  const body=content.replace(marker,'').trim();
  return {meta,body,error};
 }
 function pagesOf(content) {
  const d=decode(content), markers=[...d.body.matchAll(pageMarker)];
  if(!markers.length)return [{id:d.meta?.pages[0]?.id||uid(),text:d.body,photos:d.meta?.pages[0]?.photos||[],autoFlow:!d.meta||d.meta.pages[0]?.flow===true}];
  const pages=markers.map((m,i)=>({id:m[1],text:d.body.slice(m.index+m[0].length,markers[i+1]?.index??d.body.length).trim(),photos:d.meta?.pages.find(p=>p.id===m[1])?.photos||[],autoFlow:!d.meta||d.meta.pages.find(p=>p.id===m[1])?.flow===true}));
  const leading=d.body.slice(0,markers[0].index).trim();if(leading)pages[0].text=leading+'\n\n'+pages[0].text;
  return pages;
 }
 const encode=meta=>{const bytes=new TextEncoder().encode(JSON.stringify(meta));let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);};
 function pack(pages,retained=[]) {
  const body=pages.map(p=>'<!-- shiguang-page: '+p.id+' -->\n'+p.text.trim()).join('\n\n');
  return body+'\n\n<!-- shiguang-book: '+encode({version:1,retained,pages:pages.map(p=>({id:p.id,photos:p.photos,flow:p.autoFlow===true}))})+' -->';
 }
 const visible=s=>decode(s).body.replace(pageMarker,'\n\n');
 window.JournalBookFormat={decode,pagesOf,pack,visible};
 const p=BlogJournalApp.prototype;
 const imagePaths=p.imagePaths;p.imagePaths=function(content){return [...new Set([...imagePaths.call(this,content),...(decode(content).meta?.retained||[]).filter(path=>typeof path==='string')])];};
 const parse=p.parseMarkdownPost;
 p.parseMarkdownPost=function(...args){const post=parse.apply(this,args);post.cleanExcerpt=visible(post.content).replace(/!\[.*?\]\(.*?\)/g,'').replace(/[#*`_>-]/g,'').trim();return post;};
 const esc=s=>escapeHtml(String(s));
 const byId=id=>document.getElementById(id);
 let state=null, generation=0, saveChain=Promise.resolve(), urls=[];
 const photoCache=new Map(),photoQueue=[];let photoWorkers=0,photoSession=0;
 const stats=window.JournalBookDiagnostics={draws:0,draftWrites:0,photoRequests:0,activePhotos:0};
 function release(){photoSession++;urls.forEach(URL.revokeObjectURL);urls=[];photoCache.clear();document.querySelectorAll('.book-photo-controls').forEach(menu=>menu.remove());while(photoQueue.length)photoQueue.shift().resolve('');}
 function resizePaper(host){if(!host)return;const paper=host.querySelector('.book-paper'),wrap=host.querySelector('.book-paper-wrap');if(!paper||!wrap)return;const scale=Math.min(1,Math.max(0.3,host.clientWidth/420));paper.style.transform='scale('+scale+')';wrap.style.height=(560*scale)+'px';}
 let resizeTimer;
 function requestResize(){clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{resizePaper(byId('bookCanvas'));resizePaper(byId('viewContent'));},120);}
 const store=(method,key,value)=>new Promise((resolve,reject)=>{
  let settled=false,db=null,transaction=null;
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);db?.close();error?reject(error):resolve(result);};
  const timer=setTimeout(()=>{try{transaction?.abort();}catch(error){}finish(Error('草稿資料庫逾時；編輯內容仍保留'));},8000);
  const r=indexedDB.open('shiguang_book_integration_drafts',1);
  r.onupgradeneeded=()=>r.result.createObjectStore('drafts');r.onerror=()=>finish(r.error);r.onblocked=()=>finish(Error('草稿資料庫被其他分頁占用；請關閉重複分頁後再試'));
  r.onsuccess=()=>{db=r.result;if(settled){db.close();return;}try{const t=transaction=db.transaction('drafts',method==='get'?'readonly':'readwrite'),s=t.objectStore('drafts');const q=method==='get'?s.get(key):method==='delete'?s.delete(key):s.put(value,key);t.oncomplete=()=>finish(null,q.result);t.onerror=t.onabort=()=>finish(t.error||Error('草稿儲存失敗'));}catch(e){finish(e);}};
 });
 const fields=['postTitle','postDate','postMood','postCategory'];
 function key(){const cloud=app.offlineNew||app.sourceMode==='drive';return JSON.stringify([cloud?'cloud':'local',cloud?(app.driveRoot?.id||app.getDriveConfig().folderId||'unconnected'):JournalPersistence.rootKey(app.rootDirHandle),byId('editPostId').value||app.offlineEditingId||'new']);}
 function legacyKey(){return [app.sourceMode,app.sourceMode==='local'?(app.rootDirHandle?.name||'local'):(app.driveRoot?.id||app.getDriveConfig().folderId||'cloud'),byId('editPostId').value||app.offlineEditingId||'new'].join(':');}
 function composed(){const body=decode(byId('postContent').value).body;return state?.transport?body+'\n\n<!-- shiguang-book: '+encode(state.transport)+' -->':byId('postContent').value;}
 const pendingDrafts=new Map();let draftRunning=false;
 function draft(){if(!state)return;const snapshot={content:composed(),fields:Object.fromEntries(fields.map(id=>[id,byId(id).value])),images:{...app.stagedImages},at:Date.now()};const k=state.key;pendingDrafts.set(k,snapshot);if(draftRunning)return;draftRunning=true;saveChain=(async()=>{try{while(pendingDrafts.size){const [key,value]=pendingDrafts.entries().next().value;pendingDrafts.delete(key);try{await store('put',key,value);stats.draftWrites++;if(state?.key===key&&!pendingDrafts.has(key))byId('bookStatus').textContent='草稿已保存；儲存日記後同步。';}catch(e){app.showToast('草稿未保存：'+e.message,'error');}}}finally{draftRunning=false;}})();}
 function flush(){if(state?.editing){const raw=pack(state.pages,state.retained),d=decode(raw);state.transport=d.meta;byId('postContent').value=d.body;draft();}}
 function drainPhotos(){while(photoWorkers<2&&photoQueue.length){const job=photoQueue.shift();if(job.token!==generation){job.resolve('');continue;}photoWorkers++;stats.activePhotos=photoWorkers;Promise.resolve().then(job.work).then(job.resolve,job.reject).finally(()=>{photoWorkers--;stats.activePhotos=photoWorkers;drainPhotos();});}}
 async function photoURL(path,post,token){
  const cacheKey=(post?.id||'draft')+'|'+path;
  if(photoCache.has(cacheKey)){const cached=photoCache.get(cacheKey);cached.job.token=token;return cached.promise;}
  const session=photoSession,job={token};
  const pending=new Promise((resolve,reject)=>{Object.assign(job,{resolve,reject,work:async()=>{
   if(session!==photoSession)return '';
  const file=app.stagedImages?.[path];if(file){const url=URL.createObjectURL(file);urls.push(url);return url;}
  if(post?.imagesMap?.[path])return post.imagesMap[path];
  if(post?.localImagePaths?.[path])return app.loadLocalPhoto(post,path);
  if(post?.driveImages?.[path]){stats.photoRequests++;const blob=await app.driveRequest('files/'+post.driveImages[path]+'?alt=media&supportsAllDrives=true',{},'blob');if(session!==photoSession)return '';const url=URL.createObjectURL(blob);urls.push(url);return url;}
  return '';
  }});photoQueue.push(job);});
  const record={promise:pending,job};photoCache.set(cacheKey,record);drainPhotos();
  try{const url=await pending;record.done=true;record.url=url;if(!url&&photoCache.get(cacheKey)===record)photoCache.delete(cacheKey);if(photoCache.size>32)for(const [key,old] of photoCache){if(photoCache.size<=32)break;if(old.done&&old.job.token!==generation){photoCache.delete(key);if(old.url&&urls.includes(old.url)){URL.revokeObjectURL(old.url);urls=urls.filter(u=>u!==old.url);}}}return url;}catch(e){if(photoCache.get(cacheKey)===record)photoCache.delete(cacheKey);throw e;}
 }
 function placements(page){
  const refs=app.imagePaths(page.text);
  page.photos=page.photos.filter(p=>refs.includes(p.path));
  refs.forEach((path,i)=>{if(!page.photos.some(p=>p.path===path))page.photos.push({id:uid(),path,x:25+(i%2)*150,y:250+Math.floor(i/2)*100,width:150,rotate:0,layer:'front',z:i});});
  return page.photos;
 }
 async function draw(host,pages,index,post,editing){
  const token=++generation;stats.draws++;document.querySelectorAll('.book-photo-controls').forEach(menu=>menu.remove());host.replaceChildren();
  const page=pages[index], wrap=document.createElement('div');wrap.className='book-paper-wrap';
  const paper=document.createElement('div');paper.className='book-paper';wrap.append(paper);host.append(wrap);
  const scale=Math.min(1,Math.max(0.3,host.clientWidth/420));paper.style.transform='scale('+scale+')';wrap.style.height=(560*scale)+'px';
  const text=document.createElement(editing?'textarea':'div');text.className='book-text';
  const plain=page.text.replace(/!\[.*?\]\(((?:[^()]|\([^()]*\))*)\)/g,'');
  if(editing){text.value=plain;text.setAttribute('aria-label','此頁文字');text.onchange=()=>{const refs=app.imagePaths(page.text);page.text=text.value+'\n'+refs.map(path=>'![照片]('+path+')').join('\n');flush();renderEditor();};let flowTimer;text.oninput=()=>{clearTimeout(flowTimer);flowTimer=setTimeout(()=>{if(!text.isConnected||!state?.editing)return;const refs=app.imagePaths(page.text);page.text=text.value+'\n'+refs.map(path=>'![照片]('+path+')').join('\n');const result=window.JournalPagination?.paginate(pages,{title:byId('postTitle').value,date:byId('postDate').value,mood:byId('postMood').value});flush();if(result?.added){renderEditor();const node=byId('bookCanvas').querySelector('textarea');node?.focus();}},180);};}
  else text.textContent=plain;paper.append(text);
  for(const item of placements(page).slice().sort((a,b)=>(b.z||0)-(a.z||0))){
   const node=document.createElement('div');node.className='book-photo';node.dataset.photo=item.id;
   const overlay=document.createElement('div');overlay.className='book-photo-overlay';overlay.dataset.photo=item.id;
   const img=document.createElement('img');img.alt='日記照片';img.draggable=false;node.append(img);
   const caption=document.createElement('span');caption.className='book-caption';node.append(caption);
   const style=()=>{node.style.cssText='left:'+Math.max(0,Math.min(390,item.x))+'px;top:'+Math.max(0,Math.min(520,item.y))+'px;width:'+Math.max(60,Math.min(380,item.width))+'px;transform:rotate('+item.rotate+'deg);z-index:'+(item.layer==='behind'?1:20+Math.max(0,Math.min(100,item.z)));node.classList.toggle('book-frameless',item.frame==='none');caption.textContent=item.caption||'';overlay.style.cssText='left:'+node.style.left+';top:'+node.style.top+';width:'+node.style.width+';height:'+node.offsetHeight+'px;transform:'+node.style.transform;};style();paper.append(node);style();
   img.onload=()=>{if(token===generation)style();};
   photoURL(item.path,post,token).then(url=>{if(token===generation){if(url)img.src=url;else img.alt='照片暫時無法載入';}}).catch(e=>{if(token===generation){img.alt='照片載入失敗；可重新開啟再試';app.showToast(e.message,'error');}});
   if(!editing)continue;
   const controls=document.createElement('div');controls.className='book-photo-controls';controls.hidden=true;
   const action=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=e=>{e.stopPropagation();fn();style();flush();controls.hidden=true;};controls.append(b);return b;};
   action('文字前／後',()=>{item.layer=item.layer==='behind'?'front':'behind';});
   action('移到最前',()=>{item.z=Math.max(...page.photos.map(p=>p.z||0))+1;});
   action('相框',()=>{item.frame=item.frame==='none'?'paper':'none';});
   action('說明',()=>{const value=prompt('照片說明',item.caption||'');if(value!==null)item.caption=value.slice(0,200);});
   const remove=action('移除',()=>{if(confirm('從此頁移除照片？照片檔案仍會保留。')){page.text=page.text.replace(/!\[.*?\]\(((?:[^()]|\([^()]*\))*)\)/g,(tag,path)=>path===item.path?'':tag);page.photos=page.photos.filter(p=>p!==item);flush();draw(host,pages,index,post,true);}});
   document.body.append(controls);
   const resize=document.createElement('button'),rotate=document.createElement('button'),menu=document.createElement('button'),del=document.createElement('button');resize.textContent='↔';rotate.textContent='↻';menu.textContent='☷';del.textContent='×';resize.className='book-resize';rotate.className='book-rotate';menu.className='book-menu';del.className='book-remove';resize.title='拖曳縮放';rotate.title='拖曳旋轉';menu.title='照片前後與相框';del.title='移除照片';overlay.append(resize,rotate,menu,del);paper.append(overlay);menu.onclick=e=>{e.stopPropagation();const open=controls.hidden;document.querySelectorAll('.book-photo-controls').forEach(n=>n.hidden=true);controls.hidden=!open;if(open){const rect=menu.getBoundingClientRect(),size=controls.getBoundingClientRect();controls.style.left=Math.max(8,Math.min(innerWidth-size.width-8,rect.left))+'px';controls.style.top=Math.max(8,Math.min(innerHeight-size.height-8,rect.bottom+6))+'px';}};del.onclick=e=>{e.stopPropagation();remove.click();};
   const select=()=>{paper.querySelectorAll('.selected').forEach(n=>n.classList.remove('selected'));node.classList.add('selected');overlay.classList.add('selected');};
   function gesture(event){
    if(event.target.closest('.book-photo-controls,.book-menu,.book-remove'))return;
    event.preventDefault();select();
    const start={x:item.x,y:item.y,width:item.width,rotate:item.rotate},sx=event.clientX,sy=event.clientY,gestureScale=paper.getBoundingClientRect().width/400,mode=event.target===resize?'resize':event.target===rotate?'rotate':'move';
    node.setPointerCapture(event.pointerId);
    const move=e=>{const dx=(e.clientX-sx)/gestureScale,dy=(e.clientY-sy)/gestureScale;if(mode==='move'){item.x=Math.min(400-item.width,Math.max(0,start.x+dx));item.y=Math.min(510,Math.max(0,start.y+dy));}else if(mode==='resize')item.width=Math.min(380,Math.max(60,start.width+dx));else item.rotate=Math.round(start.rotate+dx);style();};
    const end=e=>{node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',end);node.removeEventListener('pointercancel',cancel);node.removeEventListener('lostpointercapture',cancel);if(node.hasPointerCapture(event.pointerId))node.releasePointerCapture(event.pointerId);if(item.x!==start.x||item.y!==start.y||item.width!==start.width||item.rotate!==start.rotate)page.autoFlow=false;flush();};
    const cancel=()=>{Object.assign(item,start);style();end();};
    node.addEventListener('pointermove',move);node.addEventListener('pointerup',end);node.addEventListener('pointercancel',cancel);node.addEventListener('lostpointercapture',cancel);
   }
   node.onpointerdown=gesture;resize.onpointerdown=gesture;rotate.onpointerdown=gesture;
   paper.addEventListener('pointerdown',event=>{if(event.target.closest('.book-photo,.book-photo-overlay'))return;const rect=paper.getBoundingClientRect(),s=rect.width/400,x=(event.clientX-rect.left)/s,y=(event.clientY-rect.top)/s,a=-item.rotate*Math.PI/180,dx=x-item.x-item.width/2,dy=y-item.y-node.offsetHeight/2;if(item.layer==='behind'&&Math.abs(dx*Math.cos(a)-dy*Math.sin(a))<=item.width/2&&Math.abs(dx*Math.sin(a)+dy*Math.cos(a))<=node.offsetHeight/2){event.stopImmediatePropagation();gesture(event);}},true);
  }
 }
 function renderEditor(){
  if(!state?.editing)return;
  const pagination=window.JournalPagination?.paginate(state.pages,{title:byId('postTitle').value,date:byId('postDate').value,mood:byId('postMood').value});if(pagination?.added)flush();
  const tabs=byId('bookTabs');tabs.replaceChildren();if(state.pages.length>1){const select=document.createElement('select');select.setAttribute('aria-label','日記頁面');state.pages.forEach((page,i)=>{const option=document.createElement('option');option.value=i;option.textContent='第 '+(i+1)+'／'+state.pages.length+' 頁';select.append(option);});select.value=state.index;select.onchange=()=>{document.activeElement?.blur();state.index=Number(select.value);renderEditor();};tabs.append(select);}
  draw(byId('bookCanvas'),state.pages,state.index,state.post,true);
 }
 function setup(){
  generation++;release();const content=byId('postContent').value,d=decode(content);
  state={key:key(),pages:pagesOf(content),transport:d.meta,retained:app.imagePaths(content),index:0,editing:false,post:app.posts.find(p=>p.id===byId('editPostId').value)};
  if(!d.error)byId('postContent').value=d.body;
  byId('bookCanvas').replaceChildren();byId('bookTools').hidden=true;byId('postContent').hidden=false;
  byId('inlineImageInput').closest('label').style.display='';
  byId('bookToggle').textContent='日記本編排';byId('bookStatus').textContent=d.error?'編排資料無法解析，已保留原文：'+d.error:'點選照片即可調整，完成後自動保存草稿。';
  byId('bookToggle').disabled=!!d.error;
 }
 const open=p.openEditor;p.openEditor=function(...args){const result=open.apply(this,args);if(!byId('editorModal').classList.contains('hidden'))setup();return result;};
 const editOffline=p.editOfflineEntry;p.editOfflineEntry=async function(...args){const result=await editOffline.apply(this,args);if(!byId('editorModal').classList.contains('hidden'))setup();return result;};
 const close=p.closeEditor;p.closeEditor=function(...args){state=null;generation++;release();return close.apply(this,args);};
 const save=p.savePost;p.savePost=async function(...args){if(this.imageProcessing)return this.showToast('照片處理中，請稍候再儲存','error');document.activeElement?.blur();flush();const current=state,k=state?.key;await saveChain;if(state!==current)return;byId('postContent').value=composed();await save.apply(this,args);if(byId('editorModal').classList.contains('hidden')&&k)await store('delete',k).catch(()=>{});else if(state===current&&!decode(byId('postContent').value).error)byId('postContent').value=decode(byId('postContent').value).body;};
 const view=p.openViewModal;p.openViewModal=function(id){view.call(this,id);const post=this.displayPosts().find(p=>p.id===id);if(!post)return;const content=byId('viewContent');content.querySelectorAll('.book-read').forEach(n=>n.remove());if(!decode(post.content).meta)return;const b=document.createElement('button');b.className='book-read';b.textContent='以日記本模式閱讀';b.onclick=()=>{const pages=pagesOf(post.content);window.JournalPagination?.paginate(pages,post);let index=0;const panel=document.createElement('div'),nav=document.createElement('div'),host=document.createElement('div');nav.className='book-tabs';const prev=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');prev.textContent='上一頁';next.textContent='下一頁';const render=()=>{label.textContent=(index+1)+'／'+pages.length;prev.disabled=index===0;next.disabled=index===pages.length-1;draw(host,pages,index,post,false);};prev.onclick=()=>{index--;render();};next.onclick=()=>{index++;render();};nav.append(prev,label,next);panel.append(nav,host);content.replaceChildren(panel);render();};content.prepend(b);};
 const closeView=p.closeViewModal;p.closeViewModal=function(...args){generation++;release();return closeView.apply(this,args);};
 const compare=p.showConflictComparison;p.showConflictComparison=function(local,remote){compare.call(this,local,remote);const panels=byId('conflictComparison').querySelectorAll('section');[local,remote].forEach((v,i)=>{const d=decode(v.content);if(!d.meta)return;const info=document.createElement('p');info.textContent='日記本編排：'+JSON.stringify(d.meta);info.className='text-xs break-words';panels[i]?.append(info);});};
 // Hide transport markers in rendered text only, never in saved or compared data.
 const escape=window.escapeHtml;window.escapeHtml=function(value){return escape(typeof value==='string'?value.replace(marker,'').replace(pageMarker,'\n\n'):value);};
 document.head.insertAdjacentHTML('beforeend','<link rel="stylesheet" href="./journal-book.css?v=18">');
 byId('postContent').insertAdjacentHTML('beforebegin','<div class="book-tabs"><button type="button" id="bookToggle">日記本編排</button></div><p id="bookStatus" role="status" class="text-xs my-2"></p><div id="bookTools" hidden><div class="book-toolbar"><div id="bookTabs" class="book-tabs"></div><label class="book-upload-label">＋ 照片<input id="bookUpload" type="file" accept="image/*" multiple hidden></label><details class="book-more"><summary>更多</summary><div><button type="button" id="bookAdd">新增頁面</button><button type="button" id="bookDelete">刪除此頁</button><button type="button" id="bookRestore">恢復草稿</button></div></details></div><div id="bookCanvas"></div></div>');
 byId('bookToggle').onclick=()=>{if(!state)return;document.activeElement?.blur();if(state.editing){flush();state.editing=false;}else{state.pages=pagesOf(composed());state.editing=true;}byId('bookTools').hidden=!state.editing;byId('postContent').hidden=state.editing;byId('inlineImageInput').closest('label').style.display=state.editing?'none':'';byId('bookToggle').textContent=state.editing?'文字編輯':'日記本編排';renderEditor();};
 byId('bookAdd').onclick=()=>{state.pages.push({id:uid(),text:'',photos:[]});state.index=state.pages.length-1;flush();renderEditor();};
 byId('bookDelete').onclick=()=>{if(state.pages.length<2)return app.showToast('至少保留一頁','error');if(!confirm('刪除此頁文字與照片編排？照片檔案仍保留。'))return;state.pages.splice(state.index,1);state.index=Math.min(state.index,state.pages.length-1);flush();renderEditor();};
 byId('bookRestore').onclick=async()=>{const current=state;if(!current)return;try{let saved=await store('get',current.key),legacy=false;if(!saved){saved=await store('get',legacyKey());legacy=!!saved;}if(state!==current)return;if(!saved)return app.showToast('這篇沒有編排草稿','error');if(!confirm(legacy?'這是舊版草稿，無法自動確認磁碟。確定屬於目前資料夾與日記並恢復？':'以此裝置草稿取代目前編輯內容？尚未提交雲端。'))return;const d=decode(saved.content);byId('postContent').value=d.error?saved.content:d.body;current.transport=d.meta;for(const id of fields)byId(id).value=saved.fields[id];app.stagedImages=saved.images||{};current.pages=pagesOf(saved.content);current.retained=app.imagePaths(saved.content);current.index=0;renderEditor();draft();app.showToast('已恢復草稿；請確認後儲存日記');}catch(e){app.showToast(e.message,'error');}};
 byId('bookUpload').onchange=async event=>{const current=state,page=current?.pages[current.index];if(!page)return;const staged=app.stagedImages;await JournalPhotoBatch.run(event.target,{isCurrent:()=>state===current&&current.pages.includes(page)&&app.stagedImages===staged&&!byId('editorModal').classList.contains('hidden'),progress:message=>byId('bookStatus').textContent=message,insert:async compressed=>{const name='img_'+uid().slice(0,8)+'_'+compressed.name;staged[name]=compressed;current.retained.push(name);page.text+='\n![照片]('+name+')';placements(page);flush();renderEditor();}});};
 fields.forEach(id=>byId(id).addEventListener('change',()=>{if(state)draft();}));
 let draftTimer;byId('postContent').addEventListener('input',()=>{clearTimeout(draftTimer);draftTimer=setTimeout(()=>{if(state)draft();},400);});
 window.addEventListener('resize',requestResize);
 document.addEventListener('pointerdown',event=>{if(event.target.closest('.book-photo-controls,.book-photo-overlay,.book-photo'))return;document.querySelectorAll('.book-photo-controls').forEach(menu=>menu.hidden=true);document.querySelectorAll('.book-paper .selected').forEach(node=>node.classList.remove('selected'));});
 byId('bookTools').addEventListener('click',event=>{if(event.target.closest('.book-more button'))byId('bookTools').querySelector('details').open=false;});
})();
