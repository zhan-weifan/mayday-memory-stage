import * as THREE from './vendor/three.module.js';
const smooth=t=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
const image=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('无法读取风景卡图片。'));im.src=src;});
/** A suspended photograph dissolves in front of the stage's optical volume. */
export function createCeremony(scene,inside,camera,stage){
 let card=null,start=0,resolveArrival=null,epoch=0,active=false,phase='idle',revealStart=0,revealing=null,fadeTarget=0,previousTime=0;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const label=document.createElement('div');label.className='ceremony-status';label.setAttribute('role','status');label.setAttribute('aria-live','polite');label.hidden=true;stage.append(label);
 let progress=-1;
 let particles=null,ticketTexture=null;
 const dissolveUniform={value:0};
 const mat=new THREE.ShaderMaterial({transparent:true,depthWrite:false,toneMapped:false,uniforms:{time:{value:0},fade:{value:0},progress:{value:-1}},vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,fragmentShader:`varying vec2 vUv;uniform float time,fade,progress;
 void main(){float edge=1.-smoothstep(.30,.48,abs(vUv.y-.5));float fill=progress<0.?exp(-pow((vUv.x-(.5+.36*sin(time*1.4)))*9.,2.)):1.-smoothstep(progress,progress+max(fwidth(vUv.x),.002),vUv.x);gl_FragColor=vec4(vec3(.94,.96,.89),fade*edge*(.18+.7*fill));}`});
 const waiting=new THREE.Mesh(new THREE.PlaneGeometry(1.85,.026),mat);waiting.name='glass-generation-progress';waiting.position.set(0,-.34,.73);waiting.visible=false;waiting.renderOrder=20;scene.add(waiting);
 function setProgress(value){progress=Number.isFinite(value)?THREE.MathUtils.clamp(value,0,1):-1;}
 function disposeCard(){
  if(card){scene.remove(card);card.geometry.dispose();card.material.dispose();card=null;}
  if(particles){inside.remove(particles);particles.geometry.dispose();particles.material.dispose();particles=null;}
  ticketTexture?.dispose();ticketTexture=null;
 }
 function state(value,text){if(phase===value&&label.textContent===text)return;phase=value;stage.dataset.creation=value;label.textContent=text;label.hidden=!text;}
 function cancel(){epoch++;active=false;fadeTarget=0;progress=-1;disposeCard();if(revealing)revealing.material.uniforms.reveal.value=1;revealing=null;resolveArrival?.();resolveArrival=null;state('idle','');}
 function wait(text='正在重建这一刻'){active=true;fadeTarget=1;state('generating',text);}
 async function begin(file,name,onReady){
  cancel();const ticket=epoch;active=true;state('card','这一刻，即将登场');const url=URL.createObjectURL(file);
  let photo;try{photo=await image(url);}finally{URL.revokeObjectURL(url);}
  if(ticket!==epoch)return;
  const cv=document.createElement('canvas');cv.width=1500;cv.height=720;
  const c=cv.getContext('2d'),colors=['#f3d521','#ec561e','#dc72ad','#24a4d2','#13ae70'];
  c.fillStyle='#f4f3e9';c.beginPath();c.roundRect(0,0,1500,720,24);c.fill();
  colors.forEach((color,i)=>{c.fillStyle=color;c.fillRect(i*300,0,300,16);});
  const scale=Math.min(520/photo.width,600/photo.height);
  c.fillStyle='#15231d';c.fillRect(30,48,540,620);
  c.drawImage(photo,40+(520-photo.width*scale)/2,58+(600-photo.height*scale)/2,photo.width*scale,photo.height*scale);
  c.fillStyle='#21382b';c.font='bold 68px sans-serif';c.fillText('MAYDAY',615,140);
  c.font='30px sans-serif';c.fillText('五月天 / 记忆入场券',620,200);
  const fit=(text,width)=>{let value=String(text);while(c.measureText(value).width>width&&value.length>1)value=value.slice(0,-2)+'…';return value;};
  c.font='34px sans-serif';c.fillText(fit(name,570),620,325);
  c.font='28px sans-serif';c.fillText(fit(document.getElementById('ticket-city')?.value||'某座城市',570),620,390);
  c.font='26px monospace';c.fillText(document.getElementById('ticket-date')?.value||new Date().toLocaleDateString('sv-SE'),620,445);
  c.font='21px monospace';c.fillText('FAN MEMORY / ADMIT ONE',620,610);
  c.strokeStyle='#8c978b';c.setLineDash([12,12]);c.beginPath();c.moveTo(1240,28);c.lineTo(1240,692);c.stroke();c.setLineDash([]);
  for(let i=0;i<40;i++){c.fillStyle='#203128';c.fillRect(1280+i*4.5,110,i%3+1,370);}
  c.font='22px monospace';c.fillText('NO. 000001',1270,555);
  c.globalCompositeOperation='destination-out';
  for(const y of [0,720]){c.beginPath();c.arc(1240,y,25,0,Math.PI*2);c.fill();}
  c.globalCompositeOperation='source-over';
  const texture=new THREE.CanvasTexture(cv);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
  ticketTexture=texture;dissolveUniform.value=0;
  const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,side:THREE.DoubleSide,toneMapped:false});
  material.onBeforeCompile=shader=>{
   shader.uniforms.ticketDissolve=dissolveUniform;
   shader.fragmentShader='uniform float ticketDissolve;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
    float grain=fract(sin(dot(floor(vMapUv*vec2(100.,48.)),vec2(12.9898,78.233)))*43758.5453);
    float threshold=(1.-vMapUv.x)*.72+grain*.08;
    if(ticketDissolve>threshold)discard;
   `);
  };
  card=new THREE.Mesh(new THREE.PlaneGeometry(3.1,1.488),material);card.name='memory-admission-ticket';scene.add(card);
  card.position.set(0,.95,.88);material.opacity=0;
  // GPU particles sample the same ticket cells as the dissolving paper.
  const nx=reduced?32:100,ny=reduced?16:48,positions=[],uvs=[],seeds=[];
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
   const u=(x+.5)/nx,v=(y+.5)/ny;
   positions.push((u-.5)*3.1,.95+(v-.5)*1.488,.88);uvs.push(u,v);seeds.push((x*73+y*31)%101/101);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('ticketUV',new THREE.Float32BufferAttribute(uvs,2));
  geometry.setAttribute('seed',new THREE.Float32BufferAttribute(seeds,1));
  const particleMaterial=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{ticket:{value:texture},travel:dissolveUniform},
   vertexShader:`attribute vec2 ticketUV;attribute float seed;uniform float travel;varying vec2 vTicketUV;varying float alpha;
    void main(){
     vTicketUV=ticketUV;
     float grain=fract(sin(dot(floor(ticketUV*vec2(100.,48.)),vec2(12.9898,78.233)))*43758.5453);
     float depart=(1.-ticketUV.x)*.72+grain*.08;
     float t=clamp((travel-depart)/.42,0.,1.);
     vec3 destination=vec3((ticketUV.x-.5)*1.6,.85+(ticketUV.y-.5)*1.5,-1.0-seed*.7);
     vec3 p=mix(position,destination,t*t*(3.-2.*t));
     p.xy+=vec2(sin(t*6.283+seed*6.283),cos(t*6.283+seed*6.283))*.27*sin(t*3.14159);
     alpha=step(depart,travel)*(1.-smoothstep(.75,1.,t));
     gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
     gl_PointSize=3.+seed*2.;
    }`,
   fragmentShader:`uniform sampler2D ticket;varying vec2 vTicketUV;varying float alpha;
    void main(){vec4 color=texture2D(ticket,vTicketUV);float dotShape=1.-smoothstep(.28,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(color.rgb,color.a*alpha*dotShape);}`
  });
  particles=new THREE.Points(geometry,particleMaterial);particles.frustumCulled=false;inside.add(particles);
  start=performance.now();onReady?.(start);
  return new Promise(resolve=>{resolveArrival=resolve;});
 }
 function reveal(mesh,now=performance.now()){fadeTarget=0;revealing=mesh;revealStart=now;mesh.material.uniforms.reveal.value=0;state('revealing','记忆，正在浮现');active=true;}
 function update(now){
  const dt=previousTime?Math.min((now-previousTime)/1000,.1):0;previousTime=now;
  mat.uniforms.fade.value=THREE.MathUtils.damp(mat.uniforms.fade.value,fadeTarget,4.5,dt);
  waiting.visible=mat.uniforms.fade.value>.005;
  mat.uniforms.progress.value=progress;
  mat.uniforms.time.value=reduced?0:now/1000;
  if(card){const t=(now-start)/1000,hold=reduced?.25:2.4,dissolve=reduced?.2:3.5;
   const entrance=smooth(t/(reduced?.1:.8));
   card.scale.setScalar(1);
   card.material.opacity=entrance;
   if(t>=hold){
    const k=Math.min(1,(t-hold)/dissolve);dissolveUniform.value=k*1.24;card.material.opacity=1;
    state('projecting','票根化作微光，进入记忆');
    if(k===1){disposeCard();wait();resolveArrival?.();resolveArrival=null;}
   }
  }
  if(revealing){const p=Math.min(1,(now-revealStart)/(reduced?350:5200));revealing.material.uniforms.reveal.value=p;if(p===1){revealing=null;active=false;fadeTarget=0;state('complete','这一刻，已收藏');setTimeout(()=>{if(phase==='complete')state('idle','');},2400);}}
 }
 return {begin,cancel,wait,reveal,update,setProgress,get active(){return active;},get phase(){return phase;}};
}
