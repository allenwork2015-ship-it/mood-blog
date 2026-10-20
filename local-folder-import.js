/* Read-only folder selection: index File objects once, then reuse the bounded
   text-first loader. No image URL is allocated while indexing. */
(() => {
 'use strict';
 const p=BlogJournalApp.prototype;
 function directory(name){
  const children=new Map();
  return {name,kind:'directory',readOnlyImport:true,children,
   async *entries(){yield* children.entries();},
   async getFileHandle(name){const child=children.get(name);if(child?.kind==='file')return child;throw new DOMException('找不到檔案','NotFoundError');},
   async getDirectoryHandle(name){const child=children.get(name);if(child?.kind==='directory')return child;throw new DOMException('找不到資料夾','NotFoundError');}
  };
 }
 p.loadPostsFromFiles=async function(event){
  const input=event.target;
  if(this.directoryLoading||this.directoryImporting||this.driveBusy){input.value='';return this.showToast('目前正在讀取資料，請完成後再試','error');}
  const files=Array.from(input.files||[]);if(!files.length)return;
  this.directoryImporting=true;
  const diag=window.LocalFolderDiagnostics,root=directory(files[0].webkitRelativePath.split('/')[0]);
  root.localSourceId=crypto.randomUUID();
  const previous={rootDirHandle:this.rootDirHandle,sourceMode:this.sourceMode,readOnly:this.readOnly,posts:this.posts,localPosts:this.localPosts,localDirectoryName:this.localDirectoryName};
  diag.import={phase:'indexing',files:files.length,indexed:0};
  try{
   for(const [index,file]of files.entries()){
    const parts=file.webkitRelativePath.split('/');
    if(parts[0]!==root.name||parts.length<2||parts.some(part=>!part||part==='.'||part==='..'))continue;
    let dir=root;for(const part of parts.slice(1,-1)){if(!dir.children.has(part))dir.children.set(part,directory(part));dir=dir.children.get(part);}
    dir.children.set(parts.at(-1),{name:parts.at(-1),kind:'file',async getFile(){return file;}});
    diag.import.indexed++;
    if(index%128===0)await new Promise(resolve=>setTimeout(resolve,0));
   }
   diag.import.phase='reading';this.rootDirHandle=root;this.sourceMode='local';this.readOnly=true;
   this.closeEditor();this.closeViewModal();
   await this.loadPostsFromFolder();
   this.rootDirHandle=null;this.localDirectoryName=root.name+'（唯讀）';this.checkPlatform();
   diag.import.phase='complete';this.showToast('唯讀載入 '+this.posts.length+' 篇日記');
  }catch(error){Object.assign(this,previous);this.checkPlatform();diag.import.phase=error.name==='AbortError'?'cancelled':'failed';if(error.name!=='AbortError')this.showToast('唯讀資料夾未載入：'+error.message,'error');}
  finally{this.directoryImporting=false;input.value='';}
 };
})();
