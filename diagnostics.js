(() => {
 const p=BlogJournalApp.prototype;
 const labels={connectDrive:'連接雲端',fetchDrivePosts:'載入雲端列表',showSource:'切換來源',savePost:'儲存日記',syncOffline:'上傳待傳（含排隊）',syncFolders:'雙向同步（含排隊）',refreshCloudListInBackground:'背景更新列表（含排隊）',loadPostsFromFolder:'載入本機列表'};
 const environment=()=>{
  const ua=navigator.userAgent;
  const ios=/iPhone|iPad|iPod/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1);
  return {device:/iPad|Tablet/.test(ua)||(ios&&!/iPhone|iPod/.test(ua))?'平板':/iPhone|iPod|Android.*Mobile/.test(ua)||navigator.userAgentData?.mobile?'手機':/Android/.test(ua)?'平板':'電腦',os:ios?'iOS／iPadOS':/Android/.test(ua)?'Android':/Windows/.test(ua)?'Windows':/Mac/.test(ua)?'macOS':/Linux/.test(ua)?'Linux':'未知',browser:/Line\//i.test(ua)?'LINE 內建瀏覽器':/Edg/.test(ua)?'Edge':/CriOS|Chrome/.test(ua)?'Chrome':/FxiOS|Firefox/.test(ua)?'Firefox':/Safari/.test(ua)?'Safari':'其他',version:document.querySelector('[data-release-version]')?.textContent.split('｜')[0].trim()||'未知'};
 };
 p.setConnectionStage=function(stage){
  this.connectionStage=stage;
  for(const button of document.querySelectorAll('#driveBtn,[data-drive-connect]')){
   button.disabled=!!stage;button.setAttribute('aria-busy',String(!!stage));
   button.textContent=stage|| (button.id==='driveBtn'?'Google Drive':'登入並連接');
   button.title=stage||'登入並連接 Google Drive';
  }
  const job=[...(this.performanceActive?.values()||[])].find(r=>r.name==='connectDrive');
  if(job&&stage){job.stage=stage;job.stages.push({stage,time:Date.now()});}
 };
 p.addPerformanceRecord=function(label,start,before,result,details={}){
  this.performanceRecords ||= [];
  this.performanceRecords.unshift({time:Date.now(),operation:label,milliseconds:Math.round(performance.now()-start),requests:(this.performanceRequestCount||0)-before,result,...environment(),...details});
  this.performanceRecords.length=Math.min(this.performanceRecords.length,100);
 };
 p.recordUploadDiagnostic=function(result,details={}){
  const context=this.uploadContext;if(!context)return;
  this.addPerformanceRecord('待傳上傳診斷',performance.now(),this.performanceRequestCount||0,result,{...context,visibility:document.visibilityState,online:navigator.onLine,authorizationSeconds:Math.max(0,Math.floor(((this.driveExpires||0)-Date.now())/1000)),...details});
 };
 const toast=p.showToast;
 p.showToast=function(message,type){if(type==='error')this.performanceErrorCount=(this.performanceErrorCount||0)+1;return toast.apply(this,arguments);};
 const raw=p.driveRequestRaw;
 p.driveRequestRaw=function(path,options={},format,upload){
  this.performanceRequestCount=(this.performanceRequestCount||0)+1;
  const method=options.method||'GET';
  const stage=upload?'上傳檔案內容':path.includes('alt=media')?'讀取日記或照片':path.startsWith('files/generateIds')?'建立上傳識別碼':method==='GET'?'讀取雲端檔案資訊':method==='POST'?'建立雲端檔案':'更新雲端檔案';
  const started=performance.now(),context=this.uploadContext?{...this.uploadContext}:{};
  const state={visibility:document.visibilityState,online:navigator.onLine,authorizationSeconds:Math.max(0,Math.floor(((this.driveExpires||0)-Date.now())/1000))};
  const request={name:'request',operation:stage,time:Date.now(),started,stage,stages:[]};
  this.performanceActive ||= new Map();const key=Symbol();this.performanceActive.set(key,request);
  return raw.apply(this,arguments).catch(error=>{
   this.addPerformanceRecord(stage,started,(this.performanceRequestCount||0)-1,error.status===401?'授權失效':/逾時/.test(error.message)?'逾時':error.status?'HTTP '+error.status:'連線失敗',{stage,...context,method,...state,endVisibility:document.visibilityState,endOnline:navigator.onLine,failureKind:error.failureKind||'unknown',status:error.status||null,retryable:!!error.retryable,uncertain:!!error.uncertain});throw error;
  }).finally(()=>this.performanceActive.delete(key));
 };
 for(const [name,label]of Object.entries(labels)){
  const original=p[name];
  p[name]=function(...args){
   const start=performance.now(),before=this.performanceRequestCount||0,errors=this.performanceErrorCount||0;
   this.performanceActive ||= new Map();const key=Symbol();
   const job={name,operation:label,time:Date.now(),started:start,stage:name==='connectDrive'?'準備連線':'執行中',stages:[]};
   const busy=[...this.performanceActive.values()].find(r=>r.name!=='request');
   this.performanceActive.set(key,job);
   const done=(failed,value)=>{
    this.performanceActive.delete(key);
    const skipped=value?.skipped;
    const result=failed?'例外':value?.failed|| (skipped?'略過：'+skipped:(this.performanceErrorCount||0)>errors?'有錯誤提示':'流程結束');
    if(name==='syncOffline'&&!args[0]&&!(this.performanceRequestCount-before)&&!failed&&(this.performanceErrorCount||0)===errors){
     if(skipped==='沒有可上傳的待傳資料')return;
     const reason=skipped||'未發出雲端請求';
     if(this.lastIdleSyncReason===reason)return;
     this.lastIdleSyncReason=reason;
    }else if(name==='syncOffline')this.lastIdleSyncReason=null;
    this.addPerformanceRecord(label,start,before,result,{stage:job.stage,stages:job.stages,...(skipped&&busy?{busyOperation:busy.operation,busyMilliseconds:Math.round(performance.now()-busy.started)}:{})});
   };
   try{const result=original.apply(this,args);if(result&&typeof result.then==='function')return result.then(value=>{done(false,value);return value;},error=>{done(true);throw error;});done(false,result);return result;}
   catch(error){done(true);throw error;}
  };
 }
 p.getActivePerformanceRecords=function(){return [...(this.performanceActive?.values()||[])].map(r=>({time:r.time,operation:r.operation,stage:r.stage,milliseconds:Math.round(performance.now()-r.started),result:'進行中',...environment(),stages:r.stages}));};
 p.renderPerformanceRecords=function(){
  const records=[...this.getActivePerformanceRecords(),...(this.performanceRecords||[])];
  document.getElementById('performanceRows').innerHTML=records.map(r=>{
   const device=r.device?[r.device,r.os,r.browser,r.version].join('／'):'舊紀錄，未記錄裝置';
   const stage=r.stage?'・'+r.stage:'';
   const busy=(r.busyOperation?'・忙碌工作：'+r.busyOperation+'（'+Math.round(r.busyMilliseconds/1000)+' 秒）':'')+(r.attempt?'・第 '+r.attempt+' 次嘗試':'')+(r.entryId?'・識別碼 '+r.entryId.slice(0,8):'')+(r.retryAt?'・預計重試 '+new Date(r.retryAt).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei'}):'')+(r.retryManual?'・需手動處理':'');
   return '<div class="border rounded-xl p-3 text-xs"><p>'+escapeHtml(new Date(r.time).toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei'})+'・'+device+'・'+r.operation)+'</p><p>'+escapeHtml(r.milliseconds+' ms・'+(r.requests??'—')+' 次雲端請求・'+r.result+stage+busy)+'</p></div>';
  }).join('')||'目前沒有量測紀錄。';
 };
 p.openPerformanceRecords=function(){this.openOperationLogs();this.selectSystemRecordTab('performance');};
 p.closePerformanceRecords=function(){this.closeOperationLogs();};
 p.clearPerformanceRecords=function(){this.performanceRecords=[];this.lastIdleSyncReason=null;this.renderPerformanceRecords();};
 p.getMoonDiagnostics=function(){const module=window.ShiguangMoon,visible=document.querySelector('#celestialObjects [data-renderer-version]'),today=module?.lunar(new Date());return{moduleVersion:module?.rendererVersion||'unknown',visibleRenderer:visible?.dataset.rendererVersion||null,visibleLunarDay:visible?.dataset.lunarDay||null,lunarToday:today?.day??null,calendarSource:today?.source||'unknown',weatherMode:this.weatherMode};};
 p.exportPerformanceRecords=function(){const data={format:'shiguang-performance-v2',exportedAt:new Date().toISOString(),timeZone:'Asia/Taipei',environment:environment(),moon:this.getMoonDiagnostics(),book:window.JournalBookDiagnostics||null,bookHome:window.BookHomeDiagnostics||null,bookEditor:window.FreeBookEditor?.diagnostics||null,bookSync:window.BookSync?.diagnostics||null,localFolder:window.LocalFolderDiagnostics||null,active:this.getActivePerformanceRecords(),records:this.performanceRecords||[]};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='拾光手札效能紀錄.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);};
})();
