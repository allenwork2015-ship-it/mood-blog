(() => {
 const p=BlogJournalApp.prototype;
 document.body.insertAdjacentHTML('beforeend',`<div id="conflictModal" role="dialog" aria-modal="true" aria-labelledby="conflictTitle" class="hidden fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"><div class="bg-white dark:bg-darkCard rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5"><div class="flex justify-between"><h3 id="conflictTitle" class="font-semibold">處理版本衝突</h3><button onclick="app.closeConflictModal()" aria-label="關閉版本衝突" class="p-2">✕</button></div><p class="text-xs my-2">採用版本前保留備份並重新確認資料。照片以檔名列出，不自動合併。</p><div id="conflictComparison" class="grid sm:grid-cols-2 gap-4 my-4"></div><div id="conflictChoices" class="flex flex-wrap gap-2"><button class="border rounded-full px-3 py-2" onclick="app.resolveConflictChoice('local')">採用本機版</button><button class="border rounded-full px-3 py-2" onclick="app.resolveConflictChoice('remote')">採用雲端版</button><button class="border rounded-full px-3 py-2" onclick="app.resolveConflictChoice('both')">兩版都保留</button><button class="border rounded-full px-3 py-2" onclick="app.closeConflictModal()">稍後處理</button></div><p id="conflictResult" class="text-xs my-3" role="status"></p><button id="conflictBackupBtn" hidden class="border rounded-full px-3 py-2" onclick="app.exportConflictBackup()">下載本次版本備份</button></div></div>`);
 p.closeConflictModal=function(){if(this.conflictResolving)return;document.getElementById('conflictModal').classList.add('hidden');};
 p.showConflictComparison=function(local,remote){
  document.getElementById('conflictComparison').innerHTML=[['本機修改',local],['雲端目前版本',remote]].map(([label,value])=>'<section class="border rounded-xl p-3 min-w-0"><h4 class="font-semibold">'+label+'</h4><p>'+escapeHtml(value.title||'')+'</p><pre class="whitespace-pre-wrap break-words text-sm my-2">'+escapeHtml(value.content||'')+'</pre><p class="text-xs">照片：'+escapeHtml(Object.keys(value.images||value.driveImages||{}).join('、')||'無')+'</p></section>').join('');
  document.getElementById('conflictChoices').hidden=false;document.getElementById('conflictResult').textContent='';document.getElementById('conflictBackupBtn').hidden=true;
  document.getElementById('conflictModal').classList.remove('hidden');
 };
 p.saveConflictBackup=async function(value){
  const packed=await this.packOfflinePhotos(value);
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('shiguang_conflict_backups',1);r.onupgradeneeded=()=>r.result.createObjectStore('versions',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{await new Promise((resolve,reject)=>{const tx=db.transaction('versions','readwrite');tx.objectStore('versions').put(packed);tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);});}finally{db.close();}
  this.lastConflictBackup=value;document.getElementById('conflictBackupBtn').hidden=false;
 };
 p.exportConflictBackup=async function(){
  if(!this.lastConflictBackup)return;
  const value=structuredClone(this.lastConflictBackup), images={};
  for(const [name,blob]of Object.entries(value.images||{})){const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));images[name]={type:blob.type,data:btoa(binary)};}
  for(const [name,blob]of Object.entries(value.cacheImages||{})){const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));images['雲端/'+name]={type:blob.type,data:btoa(binary)};}delete value.cacheImages;value.images=images;const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='日記衝突備份-'+value.id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 };
 p.openEntryConflict=async function(id){
  if(this.driveBusy)return this.showToast('同步進行中，請稍候','error');
  try{
   const entry=(await this.offlineStore('all')).find(e=>e.id===id&&e.conflict&&e.target);if(!entry)throw Error('衝突已變更，請重新查看');
   if(!this.driveRoot||this.driveRoot.id!==entry.rootId)throw Error('請連接原雲端資料夾');
   const posts=await this.fetchDrivePosts(entry.rootId);const remote=posts.find(p=>p.id===entry.target.folderId);if(!remote){this.releasePostImages(posts);throw Error('雲端日記無法存取');}
   this.releasePostImages(posts);this.activeConflict={kind:'entry',entry,remote};this.showConflictComparison(entry,remote);
  }catch(error){this.showToast(error.message,'error');}
 };
 p.viewConflictBackups=async function(){
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('shiguang_conflict_backups',1);r.onupgradeneeded=()=>r.result.createObjectStore('versions',{keyPath:'id'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try{const values=await new Promise((resolve,reject)=>{const r=db.transaction('versions').objectStore('versions').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   this.conflictBackupList=values.map(v=>this.unpackOfflinePhotos(v));
   document.getElementById('conflictComparison').innerHTML=values.length?values.map((v,i)=>'<button class="border rounded-xl p-3" onclick="app.selectConflictBackup('+i+')">'+escapeHtml(v.title||'版本備份')+'</button>').join(''):'目前沒有版本備份。';
   document.getElementById('conflictChoices').hidden=true;document.getElementById('conflictBackupBtn').hidden=true;document.getElementById('conflictResult').textContent='選擇備份後可下載保存。';document.getElementById('conflictModal').classList.remove('hidden');
  }finally{db.close();}
 };
 p.selectConflictBackup=function(index){const v=this.conflictBackupList[index];if(!v)return;this.lastConflictBackup=v;this.showConflictComparison(v,v.remote||{});document.getElementById('conflictChoices').hidden=true;document.getElementById('conflictBackupBtn').hidden=false;};
 p.openFolderConflicts=function(){
  const entries=[...(this.folderConflicts?.values()||[])];if(!entries.length)return this.showToast('目前沒有已讀取的同步衝突','error');
  document.getElementById('conflictComparison').innerHTML=entries.map((c,i)=>'<button class="border rounded-xl p-3 text-left" onclick="app.selectFolderConflict('+i+')">'+escapeHtml(c.local.title||'日記')+'</button>').join('');
  this.folderConflictSelection=entries;document.getElementById('conflictChoices').hidden=true;document.getElementById('conflictResult').textContent='請選擇要處理的日記';document.getElementById('conflictModal').classList.remove('hidden');
 };
 p.selectFolderConflict=function(index){const c=this.folderConflictSelection?.[index];if(!c)return;this.activeConflict={kind:'folder',...c};this.showConflictComparison(c.local,c.remote);};
 p.resolveConflictChoice=async function(choice){
  if(this.conflictResolving||this.driveBusy||!this.activeConflict)return;
  if(!confirm(choice==='local'?'採用本機版更新雲端？兩個版本會先備份。':choice==='remote'?'採用雲端版取代本機修改？本機修改會先備份。':'保留雲端並另存本機修改副本？'))return;
  const perform=async()=>{
   this.conflictResolving=true;this.driveBusy=true;
   document.querySelectorAll('#conflictChoices button').forEach(b=>b.disabled=true);
   try{
    const active=this.activeConflict;
    if(active.kind==='folder'){await active.resolve(choice);}
    else{
     const entry=(await this.offlineStore('all')).find(e=>e.id===active.entry.id);
     if(!entry?.conflict||JSON.stringify([entry.content,entry.title,entry.mood,entry.date])!==JSON.stringify([active.entry.content,active.entry.title,active.entry.mood,active.entry.date]))throw Error('本機修改已變更，請重新開啟比較');
     if(this.driveRoot?.id!==entry.rootId)throw Error('雲端目的地已變更');
     const state=await this.driveRequest('files/'+entry.target.noteId+'?fields=modifiedTime,trashed&supportsAllDrives=true');
     if(state.trashed||state.modifiedTime!==active.remote.driveNote.modifiedTime)throw Error('雲端又有新版本，請重新開啟比較');
     const images={...entry.cacheImages,...entry.images};
     for(const [name,id]of Object.entries(entry.remoteImages||{}))if(!images[name])images[name]=await this.driveRequest('files/'+id+'?alt=media&supportsAllDrives=true',{},'blob');
     const remoteImages={};for(const [name,id]of Object.entries(active.remote.driveImages||{}))remoteImages[name]=await this.driveRequest('files/'+id+'?alt=media&supportsAllDrives=true',{},'blob');
     await this.saveConflictBackup({id:crypto.randomUUID(),title:entry.title,content:entry.content,date:entry.date,mood:entry.mood,category:entry.category,images,remote:{title:active.remote.title,content:active.remote.content,date:active.remote.date,mood:active.remote.mood},cacheImages:remoteImages});
     const check=await this.driveRequest('files/'+entry.target.noteId+'?fields=modifiedTime,trashed&supportsAllDrives=true');if(check.trashed||check.modifiedTime!==state.modifiedTime)throw Error('備份期間雲端已變更，未覆寫');
     if(choice==='remote'){await this.offlineStore('delete',entry.id);await this.reloadDrivePosts();}
     else if(choice==='both'){this.driveBusy=false;await this.keepConflictCopy(entry.id);this.driveBusy=true;}
     else{
      entry.target={...entry.target,version:state.modifiedTime,folder:active.remote.driveFolder,originalContent:active.remote.content,originalImages:active.remote.driveImages};
      entry.images=images;entry.remoteImages={};entry.cacheImages={};entry.editImageIds={};entry.published=false;entry.conflict=false;entry.error='';
      await this.offlineStore('put',entry);await this.applyQueuedEdit(entry);await this.reloadDrivePosts();
     }
     await this.refreshOffline();
    }
    document.getElementById('conflictChoices').hidden=true;document.getElementById('conflictResult').textContent='已處理，原版本備份保留。';
    this.recordOperation('版本衝突','選擇 '+choice,'成功');
   }catch(error){document.getElementById('conflictResult').textContent='未完成：'+error.message;this.showToast(error.message,'error');}
   finally{this.conflictResolving=false;this.driveBusy=false;document.querySelectorAll('#conflictChoices button').forEach(b=>b.disabled=false);}
  };
  if(navigator.locks)return navigator.locks.request('shiguang-offline-sync',{ifAvailable:true},lock=>lock?perform():this.showToast('目前同步中，請稍候','error'));
  return perform();
 };
})();
