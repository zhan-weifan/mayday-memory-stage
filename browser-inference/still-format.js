import {normalizeSettings} from '../settings.js';
import {displayPolicy} from '../device-capabilities.js';
export const modelSize=model=>model instanceof Blob?model.size:model?.byteLength||0;
export const normalizeTicket=value=>({city:String(value?.city||'').slice(0,32),venue:String(value?.venue||'').slice(0,60),date:/^\d{4}-\d{2}-\d{2}$/.test(value?.date||'')?value.date:''});
export function pack(record){
 const {photo,model}=record;
 const meta={id:record.id,name:record.name,created_at:record.created_at,settings:normalizeSettings(record.settings),ticket:normalizeTicket(record.ticket),exported_at:record.exported_at,photoType:photo.type,photoBytes:photo.size,modelBytes:modelSize(model)};
 const json=new TextEncoder().encode(JSON.stringify(meta)),head=new DataView(new ArrayBuffer(12));
 head.setUint32(0,0x4c4c5453,true);head.setUint32(4,1,true);head.setUint32(8,json.length,true);
 return new Blob([head.buffer,json,photo,model],{type:'application/octet-stream'});
}
export async function inspectStill(file){
 if(!(file instanceof Blob)||file.size<12)throw Error('不是有效的 Still 记忆文件');
 if(file.size>150*1024*1024)throw Error('记忆文件过大');
 const head=new DataView(await file.slice(0,12).arrayBuffer());
 if(head.getUint32(0,true)!==0x4c4c5453||head.getUint32(4,true)!==1)throw Error('不是有效的 Still 记忆文件');
 const size=head.getUint32(8,true);
 if(size<2||size>100000||size+12>file.size)throw Error('记忆文件元数据长度无效');
 let meta;try{meta=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await file.slice(12,12+size).arrayBuffer()));}catch{throw Error('记忆文件元数据无效');}
 if(!meta||typeof meta!=='object'||Array.isArray(meta))throw Error('记忆文件元数据无效');
 if(!Number.isSafeInteger(meta.photoBytes)||meta.photoBytes<1||!Number.isSafeInteger(meta.modelBytes)||meta.modelBytes<6400||meta.modelBytes%64||12+size+meta.photoBytes+meta.modelBytes!==file.size)throw Error('记忆文件不完整');
 if(meta.format!==undefined&&!['still','STILL'].includes(meta.format))throw Error('记忆格式不支持');
 if(meta.formatVersion!==undefined&&meta.formatVersion!==1)throw Error('记忆格式版本不支持');
 const settings=normalizeSettings(meta.settings);
 return {meta,settings,photoStart:12+size,modelStart:12+size+meta.photoBytes,display:displayPolicy(meta.modelBytes)};
}
// Bounded CPU validation is independent of GPU creation and never reads the full file.
export async function validateModel(blob){
 for(let offset=0;offset<blob.size;offset+=1024*1024){
  const values=new Float32Array(await blob.slice(offset,Math.min(offset+1024*1024,blob.size)).arrayBuffer());
  for(const value of values)if(!Number.isFinite(value))throw Error('记忆模型包含无效数值');
 }
}
export async function unpack(file){
 const header=await inspectStill(file),{meta,settings,photoStart,modelStart}=header;
 const model=file.slice(modelStart,file.size,'application/octet-stream');
 await validateModel(model);
 return {id:crypto.randomUUID(),name:String(meta.name||'一段记忆').slice(0,60),created_at:new Date().toISOString(),settings,ticket:normalizeTicket(meta.ticket),photo:file.slice(photoStart,modelStart,['image/jpeg','image/png','image/webp'].includes(meta.photoType)?meta.photoType:'image/jpeg'),model};
}
