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
 p.renderPerformanceRecords=function(){
  document.getElementById('performanceRows').innerHTML=(this.performanceRecords||[]).map(r=>'<div class="border rounded-xl p-3 text-xs"><p>'+new Date(r.time).toLocaleTimeString('zh-TW')+'・'+r.operation+'</p><p>'+r.milliseconds+' ms・'+r.requests+' 次雲端請求・'+r.result+'</p></div>').join('')||'目前沒有量測紀錄。';

 };
 p.openPerformanceRecords=function(){this.openOperationLogs();this.selectSystemRecordTab('performance');};
 p.closePerformanceRecords=function(){this.closeOperationLogs();};
 p.clearPerformanceRecords=function(){this.performanceRecords=[];this.renderPerformanceRecords();};
 p.exportPerformanceRecords=function(){const url=URL.createObjectURL(new Blob([JSON.stringify({format:'shiguang-performance-v1',records:this.performanceRecords||[]},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='拾光手札效能紀錄.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);};
})();
