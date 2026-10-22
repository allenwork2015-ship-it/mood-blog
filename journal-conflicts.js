(() => {
 'use strict';
 const p=BlogJournalApp.prototype,P=window.JournalPersistence,entryCallbacks=new Map();
 async function images(folder,content,staged={}){const result={};for(const path of new Set(app.imagePaths(content))){if(staged[path]){result[path]=staged[path];continue;}const parts=path.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||/[\\\0]/.test(p)))throw Error('不安全的照片路徑');let dir=folder;for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);result[path]=await (await dir.getFileHandle(parts.at(-1))).getFile();}return result;}
 p.openJournalConflict=async function(conflict,onResolved){
  if(conflict.kind==='entry'){entryCallbacks.set(conflict.id,onResolved);return this.openEntryConflict(conflict.id);}
  const {m}=conflict;if(P.rootKey(this.rootDirHandle)!==P.rootKey(m.root))throw Error('請連回原資料夾後處理衝突');
  const handle=await m.post.subDirHandle.getFileHandle('note.md'),raw=await (await handle.getFile()).text(),remote=this.parseMarkdownPost(m.post.folderName||m.post.id,raw);
  const active={kind:'journal',m,raw,remote,local:conflict.local,async resolve(choice){
   if(P.rootKey(app.rootDirHandle)!==P.rootKey(m.root))throw Error('資料來源已切換，未處理衝突');
   const current=await (await handle.getFile()).text();if(current!==active.raw)throw Error('來源又有新版本，請重新開啟比較');
   document.getElementById('conflictResult').textContent='正在備份兩個版本及照片…';
   const localImages=await images(m.post.subDirHandle,active.local.content,active.local.images),remoteImages=await images(m.post.subDirHandle,remote.content);
   await app.saveConflictBackup({id:crypto.randomUUID(),source:'local-journal',sourceId:P.rootKey(m.root),...active.local,images:localImages,remote:{...P.meta(remote),content:remote.content,raw:active.raw},cacheImages:remoteImages});
   if(await (await handle.getFile()).text()!==active.raw)throw Error('備份期間來源已變更，未覆寫');
   let copy=null;
   if(choice==='local')await P.localSave({root:m.root,post:m.post,fields:active.local,base:remote.content,baseFields:P.meta(remote),backup:true,images:localImages},active.local.content);
   else if(choice==='both'){
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(P.serialize(active.local))))].map(n=>n.toString(16).padStart(2,'0')).join('');const id=await P.copyId(P.rootKey(m.root)+'|'+m.post.id+'|'+hash),value={...active.local,journalId:id,title:active.local.title+'（修改副本）'};
    const year=await m.root.getDirectoryHandle(value.date.slice(0,4),{create:true}),name=value.date+'-'+value.title.replace(/[\/\\?%*:|"<>]/g,'')+'-'+id.slice(0,8),folder=await year.getDirectoryHandle(name,{create:true});copy={...value,id:name,folderName:name,yearFolder:value.date.slice(0,4),subDirHandle:folder};await P.localSave({root:m.root,post:copy,fields:value,base:'',images:localImages},value.content);
   }
   await onResolved?.(choice,{remote,copy});
  }};
  this.activeConflict=active;this.showConflictComparison(active.local,remote);
 };
 const compare=p.showConflictComparison;p.showConflictComparison=function(...args){compare.apply(this,args);const local=this.activeConflict?.kind==='journal';document.querySelectorAll('#conflictComparison h4').forEach((node,i)=>node.textContent=local?(i?'檔案目前版本':'本次修改'):(i?'雲端目前版本':'本機修改'));const buttons=document.querySelectorAll('#conflictChoices button');if(buttons[0])buttons[0].textContent=local?'採用本次修改':'採用本機版';if(buttons[1])buttons[1].textContent=local?'採用檔案版本':'採用雲端版';};
 const resolve=p.resolveConflictChoice;p.resolveConflictChoice=async function(choice){const active=this.activeConflict;await resolve.call(this,choice);if(active?.kind==='entry'&&document.getElementById('conflictResult').textContent.startsWith('已處理')){const callback=entryCallbacks.get(active.entry.id);if(callback){entryCallbacks.delete(active.entry.id);await callback(choice);}}};
})();
