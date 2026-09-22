// Shared with the existing HTML controls and camera clamps; no second range table.
export const CONTROL_SETTINGS={
 contentScale:{id:'content-scale',min:.65,max:1.75,value:.65},
 depthVolume:{id:'depth-volume',min:.35,max:1,value:1},
 glow:{id:'glow',min:0,max:2,value:.12},
 frost:{id:'frost',min:0,max:1,value:.025},
 brightness:{id:'brightness',min:.4,max:3,value:1.05}
};
export const CAMERA={elevation:{min:.08,max:1.35,value:.13},zoom:{min:.6,max:4,value:1.65},azimuth:{value:.13}};
export function normalizeSettings(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('观看设置格式无效');
 for(const key of ['designVersion','renderVersion','stageVersion'])if(input[key]!==undefined&&(!Number.isSafeInteger(input[key])||input[key]<1||input[key]>({designVersion:2,renderVersion:2,stageVersion:3}[key])))throw Error('不支持的设置版本：'+key);
 if(input.fit!==undefined&&!['cover','contain'].includes(input.fit))throw Error('无效的构图方式');
 for(const [key,rule] of Object.entries({...CONTROL_SETTINGS,...CAMERA})){
  const value=input[key];
  if(value!==undefined&&(typeof value!=='number'||!Number.isFinite(value)||(rule.min!==undefined&&(value<rule.min||value>rule.max))))throw Error('观看设置超出允许范围：'+key);
 }
 const modern=input.designVersion===2,camera=input.stageVersion===3;
 const result={designVersion:2,renderVersion:2,stageVersion:3,fit:modern?(input.fit??'cover'):'cover'};
 for(const [key,rule] of Object.entries(CONTROL_SETTINGS))result[key]=(modern||key==='depthVolume')?(input[key]??rule.value):rule.value;
 for(const [key,rule] of Object.entries(CAMERA))result[key]=camera?(input[key]??rule.value):rule.value;
 // Orbit is periodic and intentionally unrestricted by pointer controls.
 result.azimuth=Math.atan2(Math.sin(result.azimuth),Math.cos(result.azimuth));
 return result;
}
export function syncSettingControls(){for(const rule of Object.values(CONTROL_SETTINGS)){const node=document.getElementById(rule.id);if(node){node.min=rule.min;node.max=rule.max;}}}
