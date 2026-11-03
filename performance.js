(() => {
 const p=BlogJournalApp.prototype;
 p.runBackgroundWork=function(key,work){
  this.backgroundJobs ||= new Map();
  if(this.backgroundJobs.has(key))return this.backgroundJobs.get(key);
  const job=[...(this.performanceActive?.values()||[])].reverse().find(job=>job.name===key),queued=performance.now();
  if(job){job.stage='等待背景工作';job.queueStarted=queued;}
  const result=(this.backgroundTail||Promise.resolve()).catch(()=>{}).then(async()=>{if(job){job.queueMilliseconds=Math.round(performance.now()-queued);job.executionStarted=performance.now();job.stage='實際執行';job.backgroundRequests=0;}const previous=this.executingBackgroundJob;this.executingBackgroundJob=job;try{return await work();}finally{this.executingBackgroundJob=previous;}});
  this.backgroundTail=result.catch(()=>{});this.backgroundJobs.set(key,result);
  result.then(()=>this.backgroundJobs.delete(key),()=>this.backgroundJobs.delete(key));return result;
 };
 for(const name of ['syncOffline','syncFolders','refreshCloudListInBackground']){
  const original=p[name];p[name]=function(...args){return this.runBackgroundWork(name,()=>original.apply(this,args));};
 }
 p.requestPostsRender=function(){
  if(this.postsRenderPending)return;this.postsRenderPending=true;
  requestAnimationFrame(()=>{this.postsRenderPending=false;this.renderPosts();});
 };
 p.adoptDrivePosts=function(incoming){
  const old=this.drivePosts||[],kept=new Set(),byId=new Map(old.map(p=>[p.id,p]));
  const fingerprint=p=>JSON.stringify([p.driveNote?.modifiedTime,p.content,p.title,p.date,p.mood,p.category,p.driveImages]);
  const posts=incoming.map(post=>{
   const previous=byId.get(post.id);
   if(previous&&fingerprint(previous)===fingerprint(post)){
    previous.driveFolder=post.driveFolder;previous.driveNote=post.driveNote;previous.folderName=post.folderName;previous.yearFolder=post.yearFolder;
    this.releasePostImages([post]);kept.add(previous);return previous;
   }
   return post;
  });
  for(const post of old)if(!kept.has(post)){
   if(this.viewPostId===post.id){this.retiredViewPosts ||= [];this.retiredViewPosts.push(post);}
   else this.releasePostImages([post]);
  }
  this.drivePosts=posts;return posts;
 };
})();
