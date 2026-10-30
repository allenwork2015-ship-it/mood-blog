(() => {
 'use strict';
 window.compressJournalPhoto = async file => {
  if (!file.size) throw Error('照片沒有內容');
  if (file.size > 20*1024*1024) throw Error('原照片超過 20 MB，請先縮小');
  if (!file.type.startsWith('image/')) throw Error('請選擇圖片檔案');
  const preserve = () => {if(file.size>10*1024*1024)throw Error('保留原格式的圖片超過 10 MB，請先縮小');return file;};
  // Preserve GIF and WebP animations, SVG, and formats not decoded reliably here.
  if (!['image/jpeg','image/png','image/heic','image/heif'].includes(file.type)) return preserve();
  const url=URL.createObjectURL(file), image=new Image();
  let canvas;
  try {
   await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('無法讀取此照片，請轉為 JPEG 或 PNG 後重試'));image.src=url;});
   if(!image.naturalWidth||!image.naturalHeight)throw Error('照片尺寸無效');
   const scale=Math.min(1,1920/Math.max(image.naturalWidth,image.naturalHeight));
   canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   const ctx=canvas.getContext('2d');if(!ctx)throw Error('此瀏覽器無法壓縮照片');
   ctx.drawImage(image,0,0,canvas.width,canvas.height);
   if(file.type==='image/png'){
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    for(let i=3;i<pixels.length;i+=4)if(pixels[i]<255)return preserve();
   }
   const encode=quality=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('照片壓縮失敗')),'image/jpeg',quality));
   let blob;
   for(const quality of [.82,.72,.62,.52]){blob=await encode(quality);if(blob.size<=800*1024)break;}
   while(blob.size>800*1024&&Math.max(canvas.width,canvas.height)>960){
    canvas.width=Math.max(1,Math.round(canvas.width*.8));canvas.height=Math.max(1,Math.round(canvas.height*.8));
    ctx.drawImage(image,0,0,canvas.width,canvas.height);blob=await encode(.65);
   }
   if(!blob.size||blob.size>10*1024*1024)throw Error('壓縮後仍過大，請選擇較小照片');
   if(file.type==='image/jpeg'&&scale===1&&file.size<=blob.size)return file;
   return new File([blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg',lastModified:file.lastModified});
  } finally {URL.revokeObjectURL(url);image.src='';if(canvas){canvas.width=0;canvas.height=0;}}
 };
})();
