/* Explicit folder reconciliation: no automatic propagation of deletions. */
BlogJournalApp.prototype.syncFolders = async function () {
    if(navigator.locks)return navigator.locks.request('shiguang-offline-sync',{ifAvailable:true},lock=>lock?this.syncFoldersData():this.showToast('其他分頁正在同步，請稍後重試','error'));
    return this.syncFoldersData();
};
BlogJournalApp.prototype.syncFoldersData = async function () {
    if (this.folderSyncBusy || this.driveBusy) return this.showToast('目前同步進行中，請稍候', 'error');
    if (!this.rootDirHandle || !this.driveRoot || !navigator.onLine || this.driveReadOnly || Date.now() >= this.driveExpires) return this.showToast('請連接可寫入的本機資料夾與 Google Drive，並確認授權有效', 'error');
    if((await this.offlineStore('all')).some(e=>e.status!=='synced'&&e.rootId===this.driveRoot.id))return this.showToast('請先完成目前待傳日記，再執行本機雲端同步，避免重複匯入','error');
    const localRoot = this.rootDirHandle, cloudRoot = this.driveRoot.id;
    const safe = value => typeof value === 'string' && value.length && !['.', '..'].includes(value) && !/[\\/\0]/.test(value);
    const split = path => { const parts = path.split('/'); if (!parts.every(safe)) throw Error('不安全的檔案路徑'); return parts; };
    const directory = async (path, create = false) => {let d = localRoot; for (const part of split(path)) d = await d.getDirectoryHandle(part, {create}); return d;};
    const file = async (dir, path, create = false) => {const parts = split(path); let d = dir; for (const part of parts.slice(0,-1)) d = await d.getDirectoryHandle(part, {create}); return d.getFileHandle(parts.at(-1), {create});};
    const write = async (dir, path, data) => {const handle = await file(dir,path,true), stream = await handle.createWritable(); await stream.write(data); await stream.close();};
    const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : await data.arrayBuffer())), v=>v.toString(16).padStart(2,'0')).join('');
    const sign = async snap => {const list=[await hash(snap.md)];for(const name of Object.keys(snap.images).sort())list.push(name,await hash(snap.images[name]));return hash(JSON.stringify(list));};
    const localSnapshot = async path => {
        const dir = await directory(path), md = await (await (await dir.getFileHandle('note.md')).getFile()).text();
        const parsed = this.parseMarkdownPost(path.split('/').at(-1),md), images={};
        for(const name of new Set(this.imagePaths(parsed.content))) {
            if (/^(https?:|data:)/i.test(name)) continue;
            images[name]=await (await file(dir,name)).getFile();
        }
        const snap={md,images,parsed};snap.signature=await sign(snap);return snap;
    };
    const remoteSnapshot = async post => {
        const md=await this.driveRequest('files/'+post.driveNote.id+'?alt=media&supportsAllDrives=true',{},'text'), images={};
        const parsed=this.parseMarkdownPost(post.folderName,md);
        for(const name of new Set(this.imagePaths(parsed.content))) {
            if (/^(https?:|data:)/i.test(name)) continue;
            if (!post.driveImages[name]) throw Error('雲端照片缺失：'+name);
            split(name);images[name]=await this.driveRequest('files/'+post.driveImages[name]+'?alt=media&supportsAllDrives=true',{},'blob');
        }
        const version=await this.driveRequest('files/'+post.driveNote.id+'?fields=modifiedTime&supportsAllDrives=true');
        if(version.modifiedTime!==post.driveNote.modifiedTime)throw Error('雲端正在更新，請稍後重新同步');
        const snap={md,images,parsed,version:version.modifiedTime};snap.signature=await sign(snap);return snap;
    };
    let manifest, remotePosts=[], summary={download:0,upload:0,conflict:0,deleted:0};
    const saveManifest = () => write(localRoot,'.shiguang-sync.json',JSON.stringify(manifest,null,2));
    const backup = async (path,snap) => {const dir=await directory('.shiguang-backups/'+Date.now()+'-'+crypto.randomUUID().slice(0,8),true);await write(dir,'原位置.txt',path);
        // Local rollback must retain attachments and unused photos as well as referenced images.
        let original;try{original=await directory(path);}catch(error){if(error.name!=='NotFoundError')throw error;}
        if(original){const copy=async(source,prefix='')=>{for await(const [name,handle]of source.entries()){if(!safe(name))throw Error('備份檔名無效');if(handle.kind==='directory')await copy(handle,prefix+name+'/');else await write(dir,prefix+name,await handle.getFile());}};await copy(original);}
        for(const [name,blob] of Object.entries(snap.images))await write(dir,name,blob);await write(dir,'note.md',snap.md);};
    const download = async (path,snap,previous) => {
        if(previous) {const check=await localSnapshot(path);if(check.signature!==previous.signature)throw Error('本機文章在同步期間改變，未覆寫');await backup(path,previous);}
        const dir=await directory(path,true);for(const [name,blob] of Object.entries(snap.images))await write(dir,name,blob);await write(dir,'note.md',snap.md);
        summary.download++;
    };
    const upload = async (pair,snap,post,remote) => {
        if(!pair.cloudId){const ids=await this.driveRequest('files/generateIds?count=2&space=drive&type=files');pair.cloudId=ids.ids[0];pair.noteId=ids.ids[1];await saveManifest();}
        if(post)await backup('雲端原版／'+pair.path,remote);
        const year=await this.driveFolder(cloudRoot,snap.parsed.date.slice(0,4));
        const name=snap.parsed.date+'-'+snap.parsed.title.replace(/[\/\\?%*:|"<>]/g,'');
        if(post){const latest=await this.driveRequest('files/'+pair.noteId+'?fields=modifiedTime&supportsAllDrives=true');if(latest.modifiedTime!==remote.version)throw Error('雲端版本改變，未覆寫');}
        else await this.ensureOfflineFile(pair.cloudId,name,year.id,'application/vnd.google-apps.folder');
        pair.imageIds ||= {};
        for(const [imagePath,blob] of Object.entries(snap.images)){
            const location=await this.driveImageLocation(pair.cloudId,imagePath);
            const children=await this.driveChildren(location.parent);
            const matches=children.filter(f=>f.name===location.name);
            if(matches.length>1)throw Error('雲端同名照片重複：'+imagePath);
            if(!pair.imageIds[imagePath]){
                pair.imageIds[imagePath]=matches[0]?.id || (await this.driveRequest('files/generateIds?count=1&space=drive&type=files')).ids[0];
                await saveManifest();
            }
            await this.ensureOfflineFile(pair.imageIds[imagePath],location.name,location.parent,blob.type||'application/octet-stream');
            await this.driveUpload(location.parent,location.name,blob,pair.imageIds[imagePath]);
        }
        if(post){const check=await this.driveRequest('files/'+pair.noteId+'?fields=modifiedTime&supportsAllDrives=true');if(check.modifiedTime!==remote.version)throw Error('上傳期間雲端版本改變，未覆寫文字');}
        else await this.ensureOfflineFile(pair.noteId,'note.md',pair.cloudId,'text/markdown');
        await this.driveUpload(pair.cloudId,'note.md',new Blob([snap.md],{type:'text/markdown'}),pair.noteId);
        pair.base=snap.signature;await saveManifest();summary.upload++;
    };
    this.folderSyncBusy=true;this.driveBusy=true;
    try {
        if(await localRoot.queryPermission({mode:'readwrite'})!=='granted' && await localRoot.requestPermission({mode:'readwrite'})!=='granted')throw Error('未取得本機寫入權限');
        this.closeEditor();this.closeViewModal();
        try {manifest=JSON.parse(await (await (await localRoot.getFileHandle('.shiguang-sync.json')).getFile()).text());}
        catch(error){if(error.name!=='NotFoundError')throw error;manifest={version:1,rootId:cloudRoot,pairs:[]};}
        if(manifest.version!==1||manifest.rootId!==cloudRoot||!Array.isArray(manifest.pairs))throw Error('此本機資料夾已對應另一個雲端目的地，請使用原設定');
        for(const pair of manifest.pairs){split(pair.path);if(pair.cloudId&&!/^[\w-]+$/.test(pair.cloudId))throw Error('同步對應識別碼無效');if(pair.noteId&&!/^[\w-]+$/.test(pair.noteId))throw Error('同步筆記識別碼無效');}
        const localPaths=[];
        const inspect=async(dir,path)=>{try{await dir.getFileHandle('note.md');localPaths.push(path);}catch(e){if(e.name!=='NotFoundError')throw e;}};
        for await(const [name,entry] of localRoot.entries()){
            if(entry.kind!=='directory'||name.startsWith('.'))continue;
            if(/^\d{4}$/.test(name)){for await(const [child,dir]of entry.entries())if(dir.kind==='directory')await inspect(dir,name+'/'+child);}
            else await inspect(entry,name);
        }
        remotePosts=await this.fetchDrivePosts(cloudRoot);
        const locals=new Map();for(const path of localPaths)locals.set(path,await localSnapshot(path));
        const remotes=new Map();for(const post of remotePosts)remotes.set(post.id,{post,snap:await remoteSnapshot(post)});
        for(const pair of manifest.pairs){
            if(pair.retired)continue;
            split(pair.path);const local=locals.get(pair.path),remote=remotes.get(pair.cloudId);
            if(local&&remote){
                if(local.signature===remote.snap.signature){pair.base=local.signature;await saveManifest();continue;}
                if(!pair.base){summary.conflict++;continue;}
                const l=local.signature!==pair.base,r=remote.snap.signature!==pair.base;
                if(l&&r){summary.conflict++;continue;}
                if(l)await upload(pair,local,remote.post,remote.snap);
                else if(r){await download(pair.path,remote.snap,local);pair.base=remote.snap.signature;await saveManifest();}
            }else if(local&&!remote&&!pair.base){await upload(pair,local);
            }else if(!local&&remote&&pair.base){
                if(confirm('本機已刪除「'+remote.snap.parsed.title+'」。是否將雲端文章與照片移至垃圾桶？')){await this.driveRequest('files/'+pair.cloudId+'?supportsAllDrives=true',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({trashed:true})});pair.retired=true;await saveManifest();summary.deleted++;}
            }else if(local&&!remote&&pair.base){
                let gone=false;try{const state=await this.driveRequest('files/'+pair.cloudId+'?fields=trashed&supportsAllDrives=true');gone=state.trashed===true;}catch(e){if(e.status===404)throw Error('雲端文章無法存取，未判定刪除');throw e;}
                if(gone&&confirm('雲端已刪除「'+local.parsed.title+'」。是否備份後刪除本機文章？')){
                    const check=await localSnapshot(pair.path);if(check.signature!==local.signature)throw Error('本機已改變，未刪除');await backup(pair.path,local);
                    const parts=split(pair.path),parent=parts.length===1?localRoot:await directory(parts.slice(0,-1).join('/'));await parent.removeEntry(parts.at(-1),{recursive:true});pair.retired=true;await saveManifest();summary.deleted++;
                }
            }else if(!local&&remote&&!pair.base){await download(pair.path,remote.snap);pair.base=remote.snap.signature;await saveManifest();}
        }
        // Establish first-time identity only when contents (including photos) match exactly.
        for(const [id,{post,snap}]of remotes){
            if(manifest.pairs.some(p=>p.cloudId===id))continue;
            const matching=[...locals].filter(([path,l])=>l.signature===snap.signature&&!manifest.pairs.some(p=>p.path===path));
            let path;
            if(matching.length===1)path=matching[0][0];
            else {const folder=post.folderName;if(!safe(folder))throw Error('雲端資料夾名稱無法儲存');path=(post.yearFolder||snap.parsed.date.slice(0,4))+'/'+folder;
                try{await directory(path);path+='-drive-'+id.slice(-8);await directory(path);throw Error('匯入目的地已存在，未覆寫');}catch(e){if(e.name!=='NotFoundError')throw e;}
                await download(path,snap);
            }
            manifest.pairs.push({cloudId:id,noteId:post.driveNote.id,path,base:snap.signature});await saveManifest();
        }
        for(const [path,snap]of locals){if(manifest.pairs.some(p=>p.path===path))continue;const pair={path};manifest.pairs.push(pair);await saveManifest();await upload(pair,snap);}
        this.showToast(`同步完成：下載 ${summary.download}、上傳 ${summary.upload}、刪除 ${summary.deleted}、雙邊修改 ${summary.conflict} 篇（保留兩邊，請手動比較）`);
    } catch(error){this.showToast('同步停止，既有資料保留：'+error.message,'error');}
    finally {
        this.releasePostImages(remotePosts);this.folderSyncBusy=false;this.driveBusy=false;
        try{if(this.sourceMode==='local')await this.loadPostsFromFolder();await this.reloadDrivePosts();}catch(e){this.showToast('請重新讀取列表：'+e.message,'error');}
    }
};
