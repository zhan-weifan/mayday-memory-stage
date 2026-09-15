import * as THREE from './vendor/three.module.js';
import {RoundedBoxGeometry} from './vendor/addons/geometries/RoundedBoxGeometry.js';

// Keep the optical volume and card-slot contract of the original renderer.
export function buildComputer(glassMaterial) {
  const group = new THREE.Group();
  group.name = 'PALINODE optical archive';
  const silver = new THREE.MeshStandardMaterial({color:'#cbd1d0',metalness:.86,roughness:.26});
  const white = new THREE.MeshStandardMaterial({color:'#e6e9e7',metalness:.35,roughness:.32});
  const graphite = new THREE.MeshStandardMaterial({color:'#202726',metalness:.65,roughness:.33});
  const red = new THREE.MeshStandardMaterial({color:'#d44336',metalness:.35,roughness:.3});
  const light = new THREE.MeshBasicMaterial({color:'#a4e6d1'});
  function add(geometry,material,position,rotation) {
    const mesh=new THREE.Mesh(geometry,material);
    mesh.position.set(...position);
    // Lift all overhead fixtures together; the optical volume remains unchanged.
    if(position[1]>2.38)mesh.position.y+=1.1;
    if(rotation)mesh.rotation.set(...rotation);
    mesh.castShadow=material!==glassMaterial;mesh.receiveShadow=true;
    group.add(mesh);return mesh;
  }
  const box=(w,h,d,r=.035)=>new RoundedBoxGeometry(w,h,d,3,r);
  // Front glass keeps the same screen-space refraction and internal Gaussian scene.
  const glass=add(new THREE.BoxGeometry(3.31,2.935,3.305),glassMaterial,[0,.84,-1.015]);
  glass.userData.aoExcluded=true;
  for(const z of [.67,-2.7]){
    for(const x of [-1.7,1.7])add(box(.075,3.05,.085),silver,[x,.84,z]);
    for(const y of [-.66,2.34])add(box(3.47,.075,.085),silver,[0,y,z]);
  }
  for(const x of [-1.7,1.7])for(const y of [-.66,2.34]){
    add(box(.075,.075,3.45),silver,[x,y,-1.015]);
    add(new THREE.CylinderGeometry(.033,.033,.015,16),graphite,[x,y,.72],[Math.PI/2,0,0]);
  }
  group.name='Mayday fan memory stage';
  add(new THREE.CylinderGeometry(4,4.08,1.25,128),graphite,[0,-1.94,-.65]);
  add(new THREE.CylinderGeometry(4.03,4.03,.055,128),silver,[0,-1.3,-.65]);
  add(new THREE.CylinderGeometry(3.94,3.94,.025,128),graphite,[0,-1.26,-.65]);
  function rod(a,b,r=.025){
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start);
    const m=add(new THREE.CylinderGeometry(r,r,delta.length(),8),silver,start.clone().add(end).multiplyScalar(.5).toArray());
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
  }
  for(const x of [-3.04,3.04]){
    add(box(.48,.64,.45),graphite,[x,-.91,.7]);
    for(const y of [-1.04,-.79])add(new THREE.CylinderGeometry(.14,.14,.018,24),new THREE.MeshStandardMaterial({color:'#101413',roughness:.9}),[x,y,.936],[Math.PI/2,0,0]);
  }
  for(const y of [2.6,2.85])for(const z of [.15,-.2])rod([-3.16,y,z],[3.16,y,z]);
  for(let i=0;i<18;i++){rod([-3.16+i*.35,2.6,.15],[-2.81+i*.35,2.85,.15],.016);rod([-3.16+i*.35,2.85,-.2],[-2.81+i*.35,2.85,.15],.016);}
  const colors=['#ffda13','#ee5418','#df75b2','#25a7d8','#13ac6f'];
  const names=['玛莎','怪兽','阿信','冠佑','石头'];
  function sign(text,w,h,position,color='#edf6f4',bg='#111b22',font=80){
    const c=document.createElement('canvas');c.height=256;c.width=Math.round(256*w/h);const ctx=c.getContext('2d');
    ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,256);ctx.fillStyle=color;ctx.font=`600 ${font}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,c.width/2,128,c.width-32);
    const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;
    return add(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map}),position);
  }
  sign('MAYDAY  五月天',3.7,.55,[0,3.12,.18]);
  sign('FIVE OF US / ALL OF YOU',2.9,.20,[0,2.83,.23],'#91cdf0');
  const blueLED=new THREE.MeshBasicMaterial({color:'#48b9f4'});
  const warmLED=new THREE.MeshBasicMaterial({color:'#f0e4b9'});
  // A continuous arena perimeter gives the rear and wings their own architecture.
  for(const y of [-1.40,-1.64]){
    add(new THREE.TorusGeometry(4.035,.018,8,160),blueLED,[0,y,-.65],[Math.PI/2,0,0]);
  }
  for(let i=0;i<80;i++){
    const a=i/80*Math.PI*2;
    add(box(.018,.007,.12,.002),silver,[Math.sin(a)*3.83,-1.24,-.65+Math.cos(a)*3.83],[0,a,0]);
  }
  for(const y of [2.62,2.87]){
    add(new THREE.TorusGeometry(3.38,.035,10,128),silver,[0,y,-.65],[Math.PI/2,0,0]);
  }
  for(let i=0;i<48;i++){
    const a=i/48*Math.PI*2,b=a+Math.PI/24;
    rod([Math.sin(a)*3.38,2.62,-.65+Math.cos(a)*3.38],
      [Math.sin(b)*3.38,2.87,-.65+Math.cos(b)*3.38],.018);
    if(i%3===0){
      add(new THREE.CylinderGeometry(.08,.1,.15,16),graphite,[Math.sin(a)*3.23,2.51,-.65+Math.cos(a)*3.23]);
      add(new THREE.CircleGeometry(.073,16),i%2?blueLED:warmLED,[Math.sin(a)*3.23,2.425,-.65+Math.cos(a)*3.23],[-Math.PI/2,0,0]);
    }
  }
  // Four corner towers sit beyond both the front and side glass silhouettes.
  // Build these directly: rod() applies the overhead-fixture lift by midpoint.
  function supportRod(a,b,r=.022){
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b);
    const delta=end.clone().sub(start);
    const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r,r,delta.length(),10),silver);
    mesh.position.copy(start).add(end).multiplyScalar(.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
    mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  for(const x of [-2.35,2.35])for(const z of [1.78,-3.08]){
    add(box(.34,.085,.34,.02),graphite,[x,-1.20,z]);
    for(const dx of [-.085,.085])for(const dz of [-.085,.085]){
      supportRod([x+dx,-1.16,z+dz],[x+dx,3.96,z+dz]);
    }
    for(let i=0;i<12;i++){
      const low=-1.16+i*(5.12/12),high=low+5.12/12;
      supportRod([x-.085,low,z+.085],[x+.085,high,z+.085],.012);
      supportRod([x+.085,low,z-.085],[x+.085,high,z+.085],.012);
    }
  }
  // Rear marquee is intentionally different from the five-member front.
  const rear=sign('MAYDAY  /  五月天',3.55,.45,[0,3.16,-2.91],'#eef5ee');
  rear.rotation.y=Math.PI;
  const rearSub=sign('BACKSTAGE · MEMORY TOUR',3.55,.18,[0,2.83,-2.92],'#81c8ee');
  rearSub.rotation.y=Math.PI;
  add(box(3.7,.78,.12),graphite,[0,3.07,-2.84]);
  for(let i=0;i<5;i++){
    add(box(.48,.025,.04,.005),new THREE.MeshBasicMaterial({color:colors[i]}),[(i-2)*.65,2.72,-2.94]);
  }
  for(const x of [-1.35,1.35]){
    add(box(.8,.63,.51),graphite,[x,-.90,-3.11]);
    for(const dx of [-.39,.39])add(box(.035,.64,.53,.006),silver,[x+dx,-.90,-3.11]);
    for(const y of [-1.19,-.62])add(box(.8,.035,.53,.006),silver,[x,y,-3.11]);
    for(const dx of [-.27,.27])add(new THREE.CylinderGeometry(.055,.055,.06,12),graphite,[x+dx,-1.24,-3.11],[0,0,Math.PI/2]);
    const badge=sign('MAYDAY / CREW',.65,.16,[x,-.88,-3.38],'#e4e8db');
    badge.rotation.y=Math.PI;
  }
  add(box(1.4,.18,.65),graphite,[0,-.75,-3.15],[.15,0,0]);
  for(let i=0;i<12;i++){
    add(box(.016,.012,.28,.002),silver,[-.58+i*.105,-.645,-3.15]);
    add(box(.045,.023,.04,.004),i%3?white:red,[-.58+i*.105,-.623,-3.15+(i%4)*.045]);
  }
  for(const x of [-.55,.55])rod([x,-1.24,-3.15],[x,-.82,-3.15],.025);
  for(const side of [-1,1]){
    const wing=sign(side<0?'MAYDAY / WEST':'MAYDAY / EAST',2.0,.29,[side*3.30,-.97,-.75],'#e8f5f0');
    wing.rotation.y=side*Math.PI/2;
    for(let i=0;i<6;i++){
      const z=-2.5+i*.65;
      rod([side*3.48,-1.24,z],[side*3.48,-.82,z],.014);
      add(new THREE.SphereGeometry(.028,10,8),warmLED,[side*3.48,-.79,z]);
      if(i<5)rod([side*3.48,-.92,z],[side*3.48,-.92,z+.65],.013);
    }
  }
  for(const side of [-1,1]){
    // Low LED banks leave the side glass open rather than acting as opaque walls.
    add(box(.93,.43,.16),graphite,[side*2.38,-1.02,-.1]);
    for(let row=0;row<3;row++)for(let col=0;col<6;col++){
      add(new THREE.PlaneGeometry(.075,.045),((row+col)%9===0)?warmLED:blueLED,[side*2.38+(col-2.5)*.13,-1.14+row*.115,-.01]);
    }
    sign(side<0?'MAY':'DAY',.75,.18,[side*2.38,2.98,.01],'#ffffff');
    // Hanging line arrays: separate enclosures, grille ribs and rigging.
    for(let j=0;j<2;j++){
      add(box(.38,.22,.37),graphite,[side*3.45,2.83-j*.24,.5],[.05*j,0,0]);
      for(let k=0;k<4;k++)add(box(.31,.012,.012,.003),silver,[side*3.45,2.9-j*.24-k*.04,.7]);
    }
    for(let j=0;j<3;j++)add(box(.65,.12,1.0-j*.16),graphite,[side*2.35,-1.23+j*.12,1.03+j*.08]);
  }
  for(const y of [-1.36,-1.59])add(box(6.5,.018,.018,.004),blueLED,[0,y,1.78]);
  for(let i=0;i<25;i++)add(box(.012,.008,4.5,.002),silver,[-3.12+i*.26,-1.268,-.65]);
  for(const side of [-1,1])for(let i=0;i<9;i++){
    add(new THREE.SphereGeometry(.022,8,6),warmLED,[side*(1.98+i*.14),-1.05,1.58]);
  }
  function guitar(x,color){
    const material=new THREE.MeshPhysicalMaterial({color,roughness:.25,clearcoat:.7});
    for(const [y,r] of [[-.91,.14],[-.76,.105]])add(new THREE.SphereGeometry(r,20,16),material,[x,y,.86]).scale.z=.3;
    add(box(.045,.46,.028,.008),white,[x,-.48,.87]);
    add(box(.085,.13,.04,.012),material,[x,-.2,.87]);
    for(let j=0;j<6;j++)add(box(.055,.006,.009,.001),silver,[x,-.65+j*.065,.895]);
    for(const dx of [-.04,.04])for(let j=0;j<3;j++)add(new THREE.SphereGeometry(.014,8,6),silver,[x+dx,-.24+j*.04,.87]);
    rod([x,-1.26,.7],[x,-.61,.7],.012);
  }
  guitar(-2.5,'#e4c084');guitar(2.5,'#b83534');
  // Small drum riser in the wing, kept out of the reconstructed photo volume.
  add(new THREE.CylinderGeometry(.31,.31,.22,32),red,[2.23,-.89,.87],[Math.PI/2,0,0]);
  add(new THREE.CircleGeometry(.285,32),white,[2.23,-.89,.988]);
  for(const x of [2,2.48]){
    rod([x,-1.23,.75],[x,-.38,.75],.012);
    add(new THREE.CylinderGeometry(.19,.19,.012,32),new THREE.MeshStandardMaterial({color:'#cfb06b',metalness:.8,roughness:.3}),[x,-.38,.75]);
  }
  rod([-2.82,-1.25,1.43],[-2.82,-.35,1.43],.015);
  add(new THREE.CapsuleGeometry(.026,.14,4,12),graphite,[-2.82,-.33,1.43],[0,0,Math.PI/2]);
  const balls=[],stageLamps=[];
  function face(index){
    const cv=document.createElement('canvas');cv.width=256;cv.height=256;
    const c=cv.getContext('2d');c.lineCap='round';c.lineJoin='round';
    const ellipse=(x,y,rx,ry,color)=>{c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fill();};
    for(const x of [91,165]){
      ellipse(x,109,index===4?13:24,index===0?15:29,'#fff9ec');
      ellipse(x,110,index===4?8:13,index===0?10:22,['#d977b2','#20aa78','#23aad7','#161e21','#ee661b'][index]);
    }
    c.strokeStyle='#17201e';c.lineWidth=8;c.beginPath();
    if(index===0){c.fillStyle='#fff';c.ellipse(129,166,28,19,.2,0,Math.PI);c.fill();c.moveTo(148,165);c.lineTo(160,162);}
    if(index===1){c.moveTo(109,163);c.lineTo(151,163);}
    if(index===2){c.moveTo(99,165);c.bezierCurveTo(109,190,119,147,133,167);c.bezierCurveTo(143,181,151,175,159,165);}
    if(index===3){c.moveTo(118,163);c.lineTo(129,174);c.lineTo(139,164);}
    if(index===4){c.moveTo(95,155);c.lineTo(117,155);c.lineTo(131,163);c.lineTo(144,155);c.lineTo(161,155);}
    c.stroke();
    if(index===3){c.strokeStyle='#ffde2b';c.lineWidth=8;for(const x of [54,140]){c.beginPath();c.roundRect(x,72,64,73,6);c.stroke();}c.beginPath();c.moveTo(118,94);c.lineTo(140,94);c.stroke();}
    const texture=new THREE.CanvasTexture(cv);texture.colorSpace=THREE.SRGBColorSpace;return texture;
  }
  colors.forEach((color,i)=>{
    const x=(i-2)*.79;
    add(new THREE.CylinderGeometry(.35,.37,.07,48),silver,[x,-1.235,1.04]);
    add(new THREE.TorusGeometry(.335,.012,8,48),new THREE.MeshBasicMaterial({color}),[x,-1.19,1.04],[Math.PI/2,0,0]);
    const ball=new THREE.Group();ball.position.set(x,-.83,1.04);ball.userData.member=names[i];group.add(ball);
    const body=new THREE.Mesh(new THREE.SphereGeometry(.35,48,32),new THREE.MeshPhysicalMaterial({color,roughness:.42,clearcoat:.25,metalness:.03}));
    body.castShadow=true;ball.add(body);
    const expression=new THREE.Mesh(new THREE.PlaneGeometry(.65,.65),new THREE.MeshBasicMaterial({map:face(i),transparent:true,depthWrite:false}));
    expression.position.z=.349;ball.add(expression);balls.push(ball);
    add(box(.71,.28,.045,.012),graphite,[x,-1.08,1.65]);
    sign(names[i],.68,.25,[x,-1.08,1.68],'#ffffff','#202726',180);
    add(new THREE.CylinderGeometry(.11,.13,.22,24),graphite,[x,2.48,.17],[.5,0,0]);
    const lamp=add(new THREE.CircleGeometry(.095,24),new THREE.MeshBasicMaterial({color}),[x,2.40,.278],[.5,0,0]);
    stageLamps.push({lamp,color:new THREE.Color(color)});
  });
  const cv=document.createElement('canvas');cv.width=1400;cv.height=240;
  const ticketTexture=new THREE.CanvasTexture(cv);ticketTexture.colorSpace=THREE.SRGBColorSpace;
  add(box(4.6,.91,.10,.025),silver,[0,-1.99,3.44]);
  const ticket=add(new THREE.PlaneGeometry(4.44,.76),new THREE.MeshBasicMaterial({map:ticketTexture}),[0,-1.99,3.50]);
  function setTicket(city='某座城市',date='某一天'){
    const c=cv.getContext('2d');c.fillStyle='#ecefe6';c.fillRect(0,0,1400,240);
    colors.forEach((color,i)=>{c.fillStyle=color;c.fillRect(i*280,0,280,9);});
    c.fillStyle='#1e2925';c.font='bold 53px sans-serif';c.fillText('MAYDAY',45,86);
    c.font='25px sans-serif';c.fillText('五月天 / 私人记忆现场',47,133);
    c.font='21px monospace';c.fillText('FAN MADE   /   ADMIT ONE',47,194);
    c.font='34px sans-serif';c.fillText(city.slice(0,16),650,91);
    c.font='27px monospace';c.fillText(date.slice(0,16),650,144);
    c.strokeStyle='#929c92';c.setLineDash([8,8]);c.beginPath();c.moveTo(1100,24);c.lineTo(1100,220);c.stroke();c.setLineDash([]);
    for(let i=0;i<47;i++){c.fillStyle='#26372e';c.fillRect(1140+i*4,42,(i%3)+1,104);}
    c.font='21px monospace';c.fillText('NO. 000001',1140,191);ticketTexture.needsUpdate=true;
  }
  setTicket();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {group,glass,keys:[],setTicket,update(time,phase){
    stageLamps.forEach(({lamp,color},i)=>{
      const show=['card','projecting','generating','revealing'].includes(phase);
      const strength=show&&!reduced?.6+.4*Math.sin(time*1.5-i*.5)**2:1;
      lamp.material.color.copy(color).multiplyScalar(strength);
    });
    if(reduced)return;
    balls.forEach((ball,i)=>{ball.position.y=-.83+Math.sin(time*1.8+i*.8)*.025;ball.rotation.z=Math.sin(time*1.2+i)*.025;});
  }};
}
