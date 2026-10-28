(() => {
 const p=BlogJournalApp.prototype;
 p.installViewPhotoLoading=function(post,generation){
  this.viewPhotoObserver?.disconnect();
  const nodes=[...document.querySelectorAll('#viewContent [data-view-photo]')],specs=this.viewPhotoSpecs;
  const queue=[];let workers=0;
  const valid=()=>this.viewGeneration===generation&&this.viewPostId===post.id&&!document.getElementById('viewModal').classList.contains('hidden');
  const paint=(node,spec,url)=>{
   if(!valid())return;
   node.textContent='';const image=document.createElement('img');image.alt=spec.alt;image.className='w-full h-full object-contain';
   image.onload=()=>{if(valid()){node.dataset.loaded='true';node.setAttribute('aria-label','照片：'+spec.alt);}};
   image.onerror=()=>failure(node,spec,'照片無法顯示');node.append(image);image.src=url;if(spec.remoteId&&!node.nextElementSibling?.matches('[data-original-photo]')){const button=document.createElement('button');button.type='button';button.dataset.originalPhoto='';button.textContent='查看原圖';button.className='border rounded-full px-3 py-2 text-xs';button.onclick=async()=>{button.disabled=true;try{const blob=await this.driveRequest('files/'+spec.remoteId+'?alt=media&supportsAllDrives=true',{},'blob');if(valid()){const full=URL.createObjectURL(blob);post.retainedPreviewURLs ||= new Set();if(post.imagesMap[spec.path])post.retainedPreviewURLs.add(post.imagesMap[spec.path]);post.imagesMap[spec.path]=full;image.src=full;button.textContent='已載入原圖';}}catch(error){button.textContent='原圖載入失敗，點此重試';}finally{button.disabled=false;}};node.after(button);}
  };
  const failure=(node,spec,message)=>{
   if(!valid())return;delete node.dataset.loaded;node.textContent=message+'，可重試。';const button=document.createElement('button');button.textContent='重試照片';button.className='border rounded-full px-3 py-2 m-2 text-xs';button.onclick=()=>{if(spec.path)delete post.imagesMap[spec.path];spec.url=null;enqueue(node,spec);};node.append(button);
  };
  const drain=()=>{
   while(workers<2&&queue.length&&valid()){
    const {node,spec}=queue.shift();workers++;
    (async()=>{
     try{
      let url=post.imagesMap[spec.path]||spec.url;
      if(!url){
       if(post.coverPromise&&post.driveCoverPath===spec.path)try{await post.coverPromise;}catch(error){}
       url=post.imagesMap[spec.path];
       if(!url&&post.localImagePaths?.[spec.path]){url=await this.loadLocalPhoto(post,spec.path);if(!valid())return;}
       if(!url&&!post.localImagePaths?.[spec.path]){const blob=await (this.readReadingPhoto?this.readReadingPhoto(post,spec.path):this.driveRequest('files/'+spec.remoteId+'?alt=media&supportsAllDrives=true',{},'blob'));if(!valid())return;url=URL.createObjectURL(blob);post.imagesMap[spec.path]=url;}
      }
      paint(node,spec,url);
     }catch(error){failure(node,spec,'照片載入失敗');}
     finally{workers--;node.dataset.loading='';drain();}
    })();
   }
  };
  const enqueue=(node,spec)=>{if(!valid()||node.dataset.loading==='yes')return;node.dataset.loading='yes';node.textContent='照片載入中…';queue.push({node,spec});drain();};
  if('IntersectionObserver'in window){
   this.viewPhotoObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){this.viewPhotoObserver.unobserve(entry.target);enqueue(entry.target,specs[Number(entry.target.dataset.viewPhoto)]);}},{root:document.getElementById('viewContent').parentElement,rootMargin:'180px'});
   for(const node of nodes)this.viewPhotoObserver.observe(node);
  }else for(const node of nodes)enqueue(node,specs[Number(node.dataset.viewPhoto)]);
 };
})();
