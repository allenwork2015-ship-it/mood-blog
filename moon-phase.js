(() => {
 const lunar = date => {const parts=new Intl.DateTimeFormat('zh-TW-u-ca-chinese',{timeZone:'Asia/Taipei',year:'numeric',month:'long',day:'numeric'}).formatToParts(date);return {day:Number(parts.find(p=>p.type==='day')?.value),label:parts.map(p=>p.value).join('')};};
 const name=day=>day===1?'新月':day<8?'眉月':day===8?'上弦月':day<15?'盈凸月':day===15?'滿月':day<22?'虧凸月':day===22?'下弦月':'殘月';
 const draw=(canvas,day)=>{
  const n=canvas.width,r=n*.46,c=n/2,ctx=canvas.getContext('2d'),data=ctx.createImageData(n,n),phase=(day-1)/29.53,theta=2*Math.PI*phase;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   const nx=(x+.5-c)/r,ny=(y+.5-c)/r,d=nx*nx+ny*ny;if(d>1)continue;
   const z=Math.sqrt(1-d),dot=nx*Math.sin(theta)-z*Math.cos(theta),lit=dot>0,shade=lit?.82+.18*z:1,base=lit?[253,224,135]:[37,46,65],i=(y*n+x)*4;
   data.data[i]=base[0]*shade;data.data[i+1]=base[1]*shade;data.data[i+2]=base[2]*shade;data.data[i+3]=Math.min(1,(1-Math.sqrt(d))*r)*255;
  }ctx.putImageData(data,0,0);return Math.round((1-Math.cos(theta))/2*100);
 };
 window.ShiguangMoon={lunar,name,draw};
})();
