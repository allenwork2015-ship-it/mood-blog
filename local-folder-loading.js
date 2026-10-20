/* Local folder loader: read note.md first; never enumerate photo
   subtrees. File System Access promises cannot cancel OS I/O; cancellation only
   discards its late result and returns control to the application. */
(() => {
 'use strict';
 const p=BlogJournalApp.prototype;
 const diag=window.LocalFolderDiagnostics={status:'idle',folders:0,notes:0,photoReads:0,errors:[],step:''};
 const ui=document.createElement('div');ui.id='localLoadStatus';ui.hidden=true;
 ui.style.cssText='position:fixed;bottom:18px;left:18px;right:18px;z-index:90;padding:12px 16px;border-radius:14px;background:#514539;color:white;font-size:13px;box-shadow:0 3px 15px #0003';
 const label=document.createElement('span'),cancel=document.createElement('button');cancel.textContent='取消讀取';cancel.style.cssText='margin-left:14px;padding:5px 12px;border:1px solid;border-radius:15px';ui.append(label,cancel);document.body.append(ui);
 const abortError=()=>new DOMException('已取消資料夾讀取','AbortError');
 function bounded(work,step,signal){
  if(signal?.aborted)return Promise.reject(abortError());
  return new Promise((resolve,reject)=>{let done=false;const end=(e,v)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);e?reject(e):resolve(v);};const abort=()=>end(abortError());const timer=setTimeout(()=>end(Error(step+'逾時；原檔案未變動')),12000);signal?.addEventListener('abort',abort,{once:true});Promise.resolve().then(work).then(v=>end(null,v),e=>end(e));});
 }
 const yieldUI=()=>new Promise(r=>setTimeout(r,0));
 const pathParts=path=>{const parts=path.replace(/^\.\//,'').split('/');if(parts.length>16||parts.some(s=>!s||s==='.'||s==='..'||/[\\\0]/.test(s)))throw Error('不支援的照片路徑');return parts;};
 // Retain a bounded working set; visible covers and the open diary stay usable.
 p.trimLocalPhotoCache=function(keep=''){
  const cache=this.localPhotoCache ||= new Map(),visible=new Set([...document.querySelectorAll('#postsContainer img')].map(node=>node.src));
  if(keep)visible.add(keep);
  const viewing=!document.getElementById('viewModal').classList.contains('hidden');
  let bytes=[...cache.values()].reduce((sum,item)=>sum+item.bytes,0);
  for(const [url,item]of cache){if(cache.size<=48&&bytes<=32*1024*1024)break;if(visible.has(url)||(viewing&&item.post.id===this.viewPostId))continue;
   cache.delete(url);bytes-=item.bytes;if(item.post.imagesMap[item.path]===url)delete item.post.imagesMap[item.path];if(item.post.coverImage===url)item.post.coverImage='';URL.revokeObjectURL(url);
  }
  diag.photoCache={count:cache.size,bytes,limitBytes:32*1024*1024,limitCount:48};
 };
 const release=p.releasePostImages;p.releasePostImages=function(posts=this.posts){release.call(this,posts);const removed=new Set(posts);for(const [url,item]of this.localPhotoCache||[])if(removed.has(item.post))this.localPhotoCache.delete(url);this.trimLocalPhotoCache();};
 const render=p.renderPosts;p.renderPosts=function(...args){const result=render.apply(this,args);this.trimLocalPhotoCache();return result;};
 const closeView=p.closeViewModal;p.closeViewModal=function(...args){const result=closeView.apply(this,args);this.trimLocalPhotoCache();return result;};
 p.loadLocalPhoto=async function(post,path){
  if(post.imagesMap?.[path]){const url=post.imagesMap[path],cache=this.localPhotoCache,item=cache?.get(url);if(item){cache.delete(url);cache.set(url,item);}return url;}
  post.localPhotoPending ||= new Map();if(post.localPhotoPending.has(path))return post.localPhotoPending.get(path);
  const root=post.subDirHandle;if(!root)return '';
  const pending=(async()=>{const parts=pathParts(path);let dir=root;for(const name of parts.slice(0,-1))dir=await bounded(()=>dir.getDirectoryHandle(name),'讀取照片路徑');const handle=await bounded(()=>dir.getFileHandle(parts.at(-1)),'取得照片');diag.photoReads++;const file=await bounded(()=>handle.getFile(),'開啟照片');if(file.size>40*1024*1024)throw Error('此照片超過 40 MB，請另行縮小後再試');if(!this.localPosts?.includes(post)&&!this.posts?.includes(post))return '';const url=URL.createObjectURL(file);post.imagesMap[path]=url;this.localPhotoCache ||= new Map();this.localPhotoCache.set(url,{post,path,bytes:file.size});this.trimLocalPhotoCache(url);return url;})();
  post.localPhotoPending.set(path,pending);try{return await pending;}finally{post.localPhotoPending.delete(path);}
 };
 p.loadPostsFromFolder=async function(){
  if(!this.rootDirHandle)return;if(this.directoryLoading)return this.directoryLoadPromise;
  const started=Date.now(),root=this.rootDirHandle,controller=new AbortController(),signal=controller.signal;this.directoryLoading=true;this.directoryLoadController=controller;
  Object.assign(diag,{status:'reading',startedAt:new Date(started).toISOString(),elapsedMs:0,folders:0,notes:0,photoReads:0,errors:[],step:'準備讀取'});ui.hidden=true;label.textContent='本機日記讀取較久，您可以繼續等候或取消。';cancel.disabled=false;cancel.onclick=()=>controller.abort();
  const noticeTimer=setTimeout(()=>{if(this.directoryLoadController===controller&&!signal.aborted)ui.hidden=false;},8000);
  const report=step=>{diag.step=step;label.textContent='讀取本機日記：'+diag.notes+' 篇；'+step;};
  const loaded=[],failures=[];let seen=0;
  const enumerate=async function*(dir){const iterator=dir.entries()[Symbol.asyncIterator]();let count=0;while(true){const item=await bounded(()=>iterator.next(),'列出資料夾',signal);if(item.done)break;if(++count%32===0)await yieldUI();if(signal.aborted)throw abortError();yield item.value;}};
  const add=async(dir,year)=>{
   diag.folders++;report(dir.name);let file;
   try{const handle=await bounded(()=>dir.getFileHandle('note.md'),'取得 note.md',signal);file=await bounded(()=>handle.getFile(),'開啟 note.md',signal);}catch(e){if(e.name==='NotFoundError')return;throw e;}
   if(file.size>8*1024*1024)throw Error('note.md 超過 8 MB，已略過，原檔案保留');
   const text=await bounded(()=>file.text(),'讀取日記文字',signal);const post=this.parseMarkdownPost(dir.name,text);
   Object.assign(post,{folderName:dir.name,yearFolder:year,subDirHandle:dir,imagesMap:{},localImagePaths:Object.fromEntries(this.imagePaths(post.content).map(path=>[path,true]))});
   post.driveCoverPath=this.imagePaths(post.content)[0]||null;loaded.push(post);diag.notes++;
  };
  const attempt=async(dir,year)=>{try{await add(dir,year);}catch(e){if(e.name==='AbortError')throw e;failures.push({folder:dir.name,message:e.message});if(diag.errors.length<20)diag.errors.push(failures.at(-1));}if(++seen%8===0)await yieldUI();};
  this.directoryLoadPromise=(async()=>{try{
   for await(const [name,entry]of enumerate(root)){if(signal.aborted)throw abortError();if(entry.kind!=='directory'||name.startsWith('.'))continue;if(/^\d{4}$/.test(name)){report(name);for await(const [,child]of enumerate(entry)){if(child.kind==='directory'&&!child.name.startsWith('.'))await attempt(child,name);}}else await attempt(entry,null);}
   if(signal.aborted||this.rootDirHandle!==root)throw abortError();
   if(failures.length&&!loaded.length)throw Error('日記均未能讀取，保留原本已載入的資料；請查看效能紀錄');
   loaded.sort((a,b)=>b.date.localeCompare(a.date));const previous=this.localPosts||[];this.localPosts=loaded;if(this.sourceMode==='local')this.posts=loaded;this.releasePostImages(previous);this.renderPosts();this.updateStats();diag.status='complete';
   if(failures.length)this.showToast('已載入 '+loaded.length+' 篇；'+failures.length+' 個資料夾未讀取，請查看效能紀錄','error');
   return true;
  }catch(e){diag.status=e.name==='AbortError'?'cancelled':'failed';diag.errors.push({message:e.message});if(e.name!=='AbortError')this.showToast('資料夾讀取中止：'+e.message,'error');throw e;}
  finally{clearTimeout(noticeTimer);diag.elapsedMs=Date.now()-started;this.directoryLoading=false;this.directoryLoadController=null;ui.hidden=true;}})();return this.directoryLoadPromise;
 };
 p.activateDirectory=async function(handle){
  if(this.directoryLoading)throw Error('資料夾正在讀取，請先取消或等候完成');
  const previous={rootDirHandle:this.rootDirHandle,sourceMode:this.sourceMode,readOnly:this.readOnly,posts:this.posts};
  this.rootDirHandle=handle;this.sourceMode='local';this.readOnly=false;this.closeEditor();this.closeViewModal();this.checkPlatform();
  try{await this.loadPostsFromFolder();this.scheduleFolderAutoSync();document.getElementById('resumeDirectoryBtn').style.display='none';}
  catch(e){Object.assign(this,previous);this.checkPlatform();throw e;}
 };
 const pick=p.pickDirectory;p.pickDirectory=async function(...args){if(this.directoryPicking||this.directoryLoading)return;this.directoryPicking=true;const button=document.getElementById('dirBtn');button.disabled=true;try{return await pick.apply(this,args);}finally{this.directoryPicking=false;button.disabled=false;}};
 const sync=p.syncFoldersData;p.syncFoldersData=async function(...args){if(this.directoryLoading){if(!args[0])this.showToast('資料夾讀取中，請完成後再同步','error');return;}return sync.apply(this,args);};
 // Covers are loaded only for the displayed page, at most two at a time.
 const cover=p.queuePageCovers;p.queuePageCovers=function(posts){cover.call(this,posts.filter(post=>!post.localImagePaths));this.localCoverQueue ||= [];this.localCoverWorkers ||= 0;for(const post of posts){if(!post.localImagePaths||!post.driveCoverPath||post.coverImage||post.localCoverPending||post.coverFailed)continue;post.localCoverPending=true;this.localCoverQueue.push(post);}const drain=()=>{while(this.localCoverWorkers<2&&this.localCoverQueue.length){const post=this.localCoverQueue.shift();if(!this.posts.includes(post)){post.localCoverPending=false;continue;}this.localCoverWorkers++;this.loadLocalPhoto(post,post.driveCoverPath).then(url=>{if(url&&this.posts.includes(post)){post.coverImage=url;this.requestPostsRender();}}).catch(e=>{post.coverFailed=true;if(diag.errors.length<20)diag.errors.push({photo:post.driveCoverPath,message:e.message});}).finally(()=>{post.localCoverPending=false;this.localCoverWorkers--;drain();});}};drain();};
})();
