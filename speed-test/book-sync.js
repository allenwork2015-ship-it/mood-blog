/* Notebook edits are durable locally before the quiet-period upload starts. */
(() => {
 'use strict';
 const p=BlogJournalApp.prototype,QUIET=10000,records=new Map();let timer=null,running=false,manualFlush=false,resumeTimer=null,resumeScan=null;
 const now=()=>Date.now(),busy=()=>app.offlineSyncing||app.driveBusy||app.folderSyncBusy;
 const matches=(m,e)=>m.queueId===e.id||m.post.localEntry?.id===e.id||!!e.target&&m.cloudRoot===e.rootId&&m.post.id===e.target.folderId;
 const tracked=m=>{let r=records.get(m.id);if(!r||r.m!==m){r={m,active:false,armed:false};records.set(m.id,r);}return r;};
 const held=r=>r.active||r.m.dirty||r.m.writing||r.m.importing||now()<(r.m.bookQuietUntil||0);
 function schedule(delay){clearTimeout(timer);timer=setTimeout(run,Math.max(0,delay));}
 function next(){const waiting=[...records.values()].filter(r=>r.armed&&!r.active&&!r.m.needsRecovery);if(waiting.length)schedule(Math.min(...waiting.map(r=>Math.max(r.m.dirty||r.m.writing||r.m.importing?1000:0,(r.m.bookQuietUntil||0)-now()))));else{clearTimeout(timer);timer=null;}}
 function touch(m,work=false){const r=tracked(m);m.bookManaged=true;m.bookQuietUntil=now()+QUIET;if(work)r.work=true;r.armed=!!(r.work||r.waiting||m.dirty);next();return r;}
 async function run(){timer=null;if(running)return;if(busy()){schedule(1000);return;}const due=[...records.values()].filter(r=>r.armed&&!r.active&&now()>=(r.m.bookQuietUntil||0));if(!due.length){next();return;}running=true;
  try{await FreeBookEditor.saveAll(true);const ready=due.filter(r=>!held(r));for(const r of ready)r.armed=false;
   if(ready.some(r=>r.m.post.subDirHandle)&&app.isFolderSyncEnabled())await app.syncFolders(true);
   if(ready.some(r=>!r.m.post.subDirHandle))await app.syncOffline(false,'日記本停止操作後合併同步');
   for(const r of ready)if(r.m.post.subDirHandle&&!r.m.dirty&&!r.active)records.delete(r.m.id);
   for(const r of due)if(r.m.needsRecovery)r.armed=false;
  }catch(error){app.showToast('日記本同步未完成：'+error.message,'error');for(const r of due)r.armed=false;}
  finally{running=false;next();}
 }
 window.BookSync={
  changed(m){touch(m,true);},
  begin(m){const r=touch(m);r.active=true;clearTimeout(timer);next();},
  end(m){const r=touch(m);r.active=false;if(!r.work&&!r.waiting&&!m.dirty)records.delete(m.id);next();},
  active(m){return records.get(m.id)?.active||false;},
  saved(m){const r=tracked(m);r.work=true;r.armed=true;next();},
  defer(m){tracked(m).armed=true;if(!running)schedule(1000);},
  discard(m){records.delete(m.id);next();},
  pending(m){return !!records.get(m.id)?.waiting;},
  receipt(m,id){const r=tracked(m);m.queueId=id;r.waiting=true;},
  get diagnostics(){return{quietMs:QUIET,tracked:records.size,active:[...records.values()].filter(r=>r.active).length,waiting:[...records.values()].filter(r=>r.waiting).length};}
 };
 const eligible=p.canUploadEntry;p.canUploadEntry=function(e,manual){if(!eligible.call(this,e,manual))return false;if(manual)return true;return !(e.bookQuietUntil>now())&&![...records.values()].some(r=>matches(r.m,e)&&(r.active||r.m.writing||r.m.importing||(!e.published&&r.m.dirty)||now()<(r.m.bookQuietUntil||0)));};
 async function flush(){FreeBookEditor.finishGesture();await FreeBookEditor.saveAll();if(FreeBookEditor.dirty)await FreeBookEditor.saveAll();if(FreeBookEditor.dirty){const all=await app.offlineStore('all');if(all.some(e=>e.published&&e.status!=='synced'&&!e.conflict&&[...records.values()].some(r=>r.m.waitingPublished&&matches(r.m,e))))return true;app.showToast('修改仍保留在草稿，請先完成保存或處理衝突','error');return false;}return true;}
 const offline=p.syncOffline;p.syncOffline=async function(manual=false,...args){if(manual&&!manualFlush){manualFlush=true;try{if(!await flush())return{skipped:'編排草稿尚未提交'};}finally{manualFlush=false;}}
  try{return await offline.call(this,manual,...args);}finally{if([...records.values()].some(r=>r.m.dirty&&!r.m.needsRecovery))schedule(100);armPersisted();}
 };
 const folders=p.syncFoldersData;p.syncFoldersData=async function(automatic=false,...args){if(automatic&&[...records.values()].some(r=>r.m.post.subDirHandle&&held(r)))return{skipped:'日記本編排等待合併同步'};return folders.call(this,automatic,...args);};
 const folderRequest=p.syncFolders;p.syncFolders=async function(automatic=false,...args){if(!automatic&&!await flush())return{skipped:'編排草稿尚未提交'};return folderRequest.call(this,automatic,...args);};
 const refresh=p.refreshCloudListInBackground;p.refreshCloudListInBackground=function(...args){if([...records.values()].some(held)){this.cloudRefreshDeferred=true;return Promise.resolve({skipped:'日記本編排中'});}return refresh.apply(this,args);};
 function acknowledge(r,entry){if(entry.target?.version&&r.m.base===entry.content&&JSON.stringify(r.m.baseFields)===JSON.stringify(JournalPersistence.meta(entry)))r.m.baseCloudVersion=entry.target.version;}
 const apply=p.applyQueuedEdit;p.applyQueuedEdit=async function(entry){const matching=[...records.values()].filter(r=>matches(r.m,entry));const result=await apply.call(this,entry);FreeBookEditor.confirmUpload(entry);for(const r of matching)acknowledge(r,entry);return result;};
 const store=p.offlineStore;p.offlineStore=async function(method,value){const result=await store.call(this,method,value);if(method==='put'&&value.published)FreeBookEditor.confirmUpload(value);if(method==='put'&&value.published)for(const r of records.values())if(matches(r.m,value))acknowledge(r,value);if(method==='put'&&value.status==='synced')for(const r of records.values())if(matches(r.m,value)){r.waiting=false;if(!r.m.dirty&&!r.active)records.delete(r.m.id);}return result;};
 // The pending queue uses a separate display id; keep notebook edits on the original journal identity.
 const display=p.displayPosts;p.displayPosts=function(...args){const posts=display.apply(this,args);if(!window.BookHomeSurface?.enabled)return posts;return posts.map(post=>{const e=post.localEntry;if(!e?.target)return post;const original=(this.drivePosts||this.posts||[]).find(p=>p.id===e.target.folderId);return{...original,...post,id:e.target.folderId,journalId:e.journalId||original?.journalId,localEntry:undefined,driveNote:{id:e.target.noteId,modifiedTime:e.target.version},driveFolder:e.target.folder,driveImages:e.remoteImages||e.target.originalImages||{},bookPendingEntry:e,imagesMap:{...original?.imagesMap,...post.imagesMap}};});};
 function armPersisted(){if(resumeScan)return resumeScan;resumeScan=(async()=>{const all=await app.offlineStore('all');const future=all.filter(e=>e.bookManaged&&e.status!=='synced'&&!e.conflict&&!e.error&&e.bookQuietUntil>now());clearTimeout(resumeTimer);if(future.length)resumeTimer=setTimeout(()=>app.syncOffline(false,'恢復日記本待傳合併同步'),Math.max(1,Math.min(...future.map(e=>e.bookQuietUntil))-now()+20));})().catch(error=>console.warn('日記本待傳排程讀取未完成',error)).finally(()=>resumeScan=null);return resumeScan;}
 Promise.resolve(app.offlineReady).then(armPersisted);
 for(const event of ['online','focus'])window.addEventListener(event,()=>{for(const r of records.values())if(r.waiting||r.m.dirty)r.armed=true;next();armPersisted();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){FreeBookEditor.cancelGesture();FreeBookEditor.saveAll(true);}else next();});
})();
