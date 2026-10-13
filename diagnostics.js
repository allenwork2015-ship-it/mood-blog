(() => {
 const p=BlogJournalApp.prototype;
 p.addPerformanceRecord=function(label,start,before,result){
  this.performanceRecords ||= [];
  this.performanceRecords.unshift({time:Date.now(),operation:label,milliseconds:Math.round(performance.now()-start),requests:(this.performanceRequestCount||0)-before,result});
  this.performanceRecords.length=Math.min(this.performanceRecords.length,100);
 };
 const toast=p.showToast;
 p.showToast=function(message,type){if(type==='error')this.performanceErrorCount=(this.performanceErrorCount||0)+1;return toast.apply(this,arguments);};
 const raw=p.driveRequestRaw;
 p.driveRequestRaw=function(...args){this.performanceRequestCount=(this.performanceRequestCount||0)+1;return raw.apply(this,args);};
 const labels={connectDrive:'連接雲端（含登入等待）',fetchDrivePosts:'載入雲端列表',showSource:'切換來源',savePost:'儲存日記',syncOffline:'上傳待傳（含排隊）',syncFolders:'雙向同步（含排隊）',refreshCloudListInBackground:'背景更新列表（含排隊）',loadPostsFromFolder:'載入本機列表',loadViewImages:'載入文章照片'};
 for(const [name,label]of Object.entries(labels)){
  const original=p[name];
  p[name]=function(...args){
   const start=performance.now(),before=this.performanceRequestCount||0,errors=this.performanceErrorCount||0;
   const done=failed=>this.addPerformanceRecord(label,start,before,failed?'例外':(this.performanceErrorCount||0)>errors?'有錯誤提示':'流程返回');
   try{const result=original.apply(this,args);if(result&&typeof result.then==='function')return result.then(value=>{done(false);return value;},error=>{done(true);throw error;});done(false);return result;}
   catch(error){done(true);throw error;}
  };
 }
 document.body.insertAdjacentHTML('beforeend','<div id="performanceModal" role="dialog" aria-modal="true" aria-labelledby="performanceTitle" class="hidden fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4"><div class="bg-white dark:bg-darkCard rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5"><div class="flex justify-between"><h3 id="performanceTitle" class="font-semibold">效能紀錄</h3><button onclick="app.closePerformanceRecords()" aria-label="關閉效能紀錄" class="p-2">✕</button></div><p class="text-xs my-3">最近 100 筆，僅保留本次開啟期間。耗時包含排隊與網路等待；請求數是期間總量，可能含重疊背景工作。流程返回不代表上傳成功，請以操作日誌為準。</p><div class="flex gap-2 mb-3"><button onclick="app.exportPerformanceRecords()" class="border rounded-full px-3 py-2 text-xs">匯出量測紀錄</button><button onclick="app.clearPerformanceRecords()" class="border rounded-full px-3 py-2 text-xs">清除量測紀錄</button></div><div id="performanceRows" class="space-y-2"></div></div></div>');
 p.openPerformanceRecords=function(){
  document.getElementById('performanceRows').innerHTML=(this.performanceRecords||[]).map(r=>'<div class="border rounded-xl p-3 text-xs"><p>'+new Date(r.time).toLocaleTimeString('zh-TW')+'・'+r.operation+'</p><p>'+r.milliseconds+' ms・'+r.requests+' 次雲端請求・'+r.result+'</p></div>').join('')||'目前沒有量測紀錄。';
  document.getElementById('performanceModal').classList.remove('hidden');
 };
 p.closePerformanceRecords=function(){document.getElementById('performanceModal').classList.add('hidden');};
 p.clearPerformanceRecords=function(){this.performanceRecords=[];this.openPerformanceRecords();};
 p.exportPerformanceRecords=function(){const url=URL.createObjectURL(new Blob([JSON.stringify({format:'shiguang-performance-v1',records:this.performanceRecords||[]},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='拾光手札效能紀錄.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);};
})();
