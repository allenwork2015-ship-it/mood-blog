/* One persistence path for ordinary editing and the notebook. UI callers own
   drafts; this module owns serialization, version checks, backups and queues. */
(() => {
 'use strict';
 const rootIds=new WeakMap();let database;
 const db=()=>database ||= new Promise((resolve,reject)=>{const r=indexedDB.open('shiguang_persistence',1);r.onupgradeneeded=()=>{r.result.createObjectStore('roots',{keyPath:'id'});r.result.createObjectStore('copies');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const meta=post=>({title:post.title,date:post.date,mood:post.mood,category:post.category||'note'});
 const sameMeta=(a,b)=>['title','date','mood','category'].every(k=>a[k]===b[k]);
 function rootKey(root){if(!root)return 'unconnected';if(!rootIds.has(root))rootIds.set(root,crypto.randomUUID());return rootIds.get(root);}
 async function identify(root){const fallback=rootKey(root);if(!root?.isSameEntry)return fallback;try{const store=await db(),rows=await new Promise((resolve,reject)=>{const r=store.transaction('roots').objectStore('roots').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});for(const row of rows){try{if(await root.isSameEntry(row.handle)){rootIds.set(root,row.id);return row.id;}}catch(error){}}
  await new Promise((resolve,reject)=>{const tx=store.transaction('roots','readwrite');tx.objectStore('roots').put({id:fallback,handle:root});tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);});return fallback;
 }catch(error){return fallback;}}
 function serialize(value){const mood=app.getMoodObj(value.mood),category=app.getCategoryObj(value.category||'note');return '<!-- shiguang-id: '+(value.journalId||value.id)+' -->\n# '+value.title+'\n\n- 日期：'+value.date+'\n- 心情：'+mood.emoji+' '+mood.name+'\n- 心情ID：'+value.mood+'\n- 分類：'+category.name+'\n- 分類ID：'+(value.category||'note')+'\n\n## 內文\n\n'+value.content+'\n';}
 const entry=(m,content)=>({...meta(m.fields||m.post),journalId:m.fields?.journalId||m.post.journalId||(m.post.driveNote?'drive-'+m.post.driveNote.id:(m.generatedJournalId ||= crypto.randomUUID())),content});
 function conflict(m,content,raw,remote,message){const error=Error(message);error.name='JournalConflictError';error.journalConflict={kind:'local',m,raw,remote,local:{...entry(m,content),images:{...m.images}}};return error;}
 async function writeImages(folder,images){for(const [path,image]of Object.entries(images||{})){let dir=folder;const parts=path.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||/[\\\0]/.test(p)))throw Error('不安全的照片路徑');for(const name of parts.slice(0,-1))dir=await dir.getDirectoryHandle(name,{create:true});const out=await (await dir.getFileHandle(parts.at(-1),{create:true})).createWritable();try{await out.write(image);await out.close();}catch(e){await out.abort().catch(()=>{});throw e;}}}
 async function localSave(m,content){if(rootKey(app.rootDirHandle)!==rootKey(m.root))throw Error('資料來源已切換，草稿保留；請連回原資料夾後重試');const handle=await m.post.subDirHandle.getFileHandle('note.md',{create:true}),file=await handle.getFile(),raw=await file.text(),latest=app.parseMarkdownPost(m.post.folderName||m.post.id,raw),value=entry(m,content);
  const normalized=raw.replace(/\r\n?/g,'\n'),split=normalized.indexOf('## 內文\n');const markdown=m.fields||split<0?serialize(value):normalized.slice(0,split)+'## 內文\n\n'+content+'\n';
  if(raw===markdown)return;
  if(latest.content!==m.base||(m.baseFields&&raw&& !sameMeta(meta(latest),m.baseFields)))throw conflict(m,content,raw,latest,'來源版本已變更，草稿保留，請處理版本差異');
  if(raw&&!m.backup){const folder=await m.root.getDirectoryHandle('.shiguang-backups',{create:true}),out=await (await folder.getFileHandle('journal-'+Date.now()+'-'+crypto.randomUUID().slice(0,8)+'.md',{create:true})).createWritable();await out.write(raw);await out.close();m.backup=true;}
  await writeImages(m.post.subDirHandle,m.images);
  const checked=await (await handle.getFile()).text();if(checked!==raw)throw conflict(m,content,checked,app.parseMarkdownPost(m.post.id,checked),'寫入前來源版本已變更，草稿保留');
  const out=await handle.createWritable();try{await out.write(markdown);await out.close();}catch(e){await out.abort().catch(()=>{});throw e;}
  return markdown;
 }
 async function queueSave(m,content){const post=m.post;if(app.offlineSyncing)throw Object.assign(Error('同步進行中，草稿已保存；完成後可重試'),{bookDeferred:!!m.bookManaged});const all=await app.offlineStore('all');
  if(post.localEntry){const stored=all.find(e=>e.id===post.localEntry.id);if(!stored||stored.ids||stored.target||stored.status==='synced')throw Error('已開始上傳，草稿保留；請同步完成後重新開啟');Object.assign(stored,entry(m,content),{images:{...stored.images,...m.images},error:m.bookManaged?(stored.error||''):'',retryAt:m.bookManaged?(stored.retryAt||0):0,bookManaged:!!m.bookManaged,bookQuietUntil:m.bookQuietUntil||0});await app.offlineStore('put',stored);post.localEntry=stored;return stored;}
  if(!app.driveRoot||app.driveRoot.id!==m.cloudRoot||!post.driveNote||app.driveReadOnly)throw Error('請連接原本的雲端資料夾，草稿已保留');
  let stored=all.find(e=>e.target?.folderId===post.id&&e.status!=='synced');if(stored&&(stored.published||stored.conflict||stored.content!==m.base)){const error=Error(stored.published?'先前上傳尚待完成；新修改已保留，請重試同步':'此篇已有其他待傳修改或衝突，草稿保留');if(stored.published&&m.bookManaged)error.bookPublishedPending=true;if(stored.conflict)error.journalConflict={kind:'entry',id:stored.id};throw error;}
  let remote=null;
  if(!stored&&!m.bookManaged){const state=await app.driveRequest('files/'+post.driveNote.id+'?fields=modifiedTime,trashed&supportsAllDrives=true');if(state.trashed)throw Error('來源日記已刪除，草稿保留');if(state.modifiedTime!==post.driveNote.modifiedTime){const raw=await app.driveRequest('files/'+post.driveNote.id+'?alt=media&supportsAllDrives=true',{},'text'),parsed=app.parseMarkdownPost(post.folderName||post.id,raw);if(parsed.content!==m.base||!sameMeta(meta(parsed),m.baseFields||meta(post)))remote={raw,state};else post.driveNote.modifiedTime=state.modifiedTime;}}
  stored ||= {id:crypto.randomUUID(),rootId:app.driveRoot.id,clientId:app.getDriveConfig().clientId,created:Date.now(),status:'pending',images:{},remoteImages:{...post.driveImages},cacheImages:{},target:{folderId:post.id,noteId:post.driveNote.id,version:m.baseCloudVersion||post.driveNote.modifiedTime,folder:post.driveFolder,originalContent:m.base,originalImages:post.driveImages||{}}};
  stored.cacheImages ||= {};
  for(const path of app.imagePaths(content)){if(!post.driveImages?.[path]||stored.cacheImages[path])continue;let preview=post.imagesMap?.[path];
   if(!preview){const image=[...document.querySelectorAll('#bookHomeSpread img[data-book-photo-path]')].find(img=>img.dataset.bookPhotoPath===path&&img.dataset.bookPhotoJournal===(post.journalId||post.id));if(image?.src.startsWith('blob:'))preview=image.src;}
   if(!preview)continue;try{const response=await fetch(preview);if(response.ok)stored.cacheImages[path]=await response.blob();}catch(error){/* Preview caching is optional; original remote photo IDs remain durable. */}
  }
  Object.assign(stored,entry(m,content),{images:{...stored.images,...m.images},error:m.bookManaged?(stored.error||''):'',retryAt:m.bookManaged?(stored.retryAt||0):0,retryManual:m.bookManaged?!!stored.retryManual:false,bookManaged:!!m.bookManaged,bookQuietUntil:m.bookQuietUntil||0});if(remote){stored.conflict=true;stored.remoteConflictContent=remote.raw;stored.error='其他裝置已修改日記';}await app.offlineStore('put',stored);
  if(remote){const error=Error('雲端版本已變更，請選擇要保留的版本');error.journalConflict={kind:'entry',id:stored.id};throw error;}return stored;
 }
 async function commit(m,content){const run=()=>m.post.subDirHandle?localSave(m,content):queueSave(m,content);if(!navigator.locks)return run();return navigator.locks.request('shiguang-offline-sync',{ifAvailable:true},lock=>{if(!lock)throw Object.assign(Error('目前正在同步，草稿已保留'),{bookDeferred:!!m.bookManaged});return run();});}
 async function copyId(key){const store=await db();return new Promise((resolve,reject)=>{const tx=store.transaction('copies','readwrite'),s=tx.objectStore('copies'),r=s.get(key);let id;r.onsuccess=()=>{id=r.result||crypto.randomUUID();if(!r.result)s.put(id,key);};tx.oncomplete=()=>resolve(id);tx.onerror=tx.onabort=()=>reject(tx.error);});}
 window.JournalPersistence={meta,serialize,rootKey,identify,localSave,queueSave,commit,copyId,writeImages};
 const p=BlogJournalApp.prototype,activate=p.activateDirectory;p.activateDirectory=async function(handle){await identify(handle);return activate.call(this,handle);};
})();
