/* Shared sequential import for notebook photo controls. */
(() => {
 'use strict';
 window.JournalPhotoBatch={async run(input,options){
  if(app.imageProcessing){app.showToast('照片處理中，請稍候','error');return;}
  const files=Array.from(input.files||[]);if(!files.length)return;
  app.imageProcessing=true;input.disabled=true;
  let inserted=0;const failures=[];
  try{
   for(const [index,file]of files.entries()){
    if(!options.isCurrent())break;
    options.progress?.('正在處理照片 '+(index+1)+'／'+files.length);
    let image;
    try{image=await compressJournalPhoto(file);}catch(error){if(!options.isCurrent())break;failures.push(file.name+'：'+error.message);continue;}
    if(!options.isCurrent())break;
    await options.insert(image,file);inserted++;
    await new Promise(resolve=>setTimeout(resolve,0));
   }
   if(options.isCurrent()){
    const message='已插入 '+inserted+' 張照片'+(failures.length?'；'+failures.length+' 張失敗：'+failures[0]:'（已壓縮）');
    options.progress?.(message);app.showToast(message,failures.length?'error':'success');
   }
   return {inserted,failures};
  }finally{app.imageProcessing=false;input.disabled=false;input.value='';}
 }};
})();
