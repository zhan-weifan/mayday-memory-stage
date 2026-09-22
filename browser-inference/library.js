import {makeThumbnail} from './thumbnail.js';
import {modelSize} from './still-format.js';
export {pack,unpack,normalizeTicket,inspectStill,modelSize} from './still-format.js';
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
let database,opening;
function storageNotice(text){document.dispatchEvent(new CustomEvent('storage-notice',{detail:text}));}
async function db(){
 if(database)return database;
 if(!opening)opening=new Promise((resolve,reject)=>{
  const r=indexedDB.open('still-local-memories',2);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('memories'))r.result.createObjectStore('memories',{keyPath:'id'});if(!r.result.objectStoreNames.contains('drafts'))r.result.createObjectStore('drafts');};
  r.onblocked=()=>storageNotice('本机收藏库等待其他标签页关闭后才能打开。');
  r.onerror=()=>{opening=null;reject(r.error);};
  r.onsuccess=()=>{database=r.result;database.onversionchange=()=>{database.close();database=null;opening=null;storageNotice('收藏库版本已变化，请刷新页面。');};resolve(database);};
 });
 return opening;
}
const metaKey=id=>['memory-meta-v1',id];
const deletedKey=id=>['memory-deleted-v1',id];
function summary(record){return {id:record.id,name:record.name,created_at:record.created_at,ticket:record.ticket,exported_at:record.exported_at,settings:record.settings,thumbnail:record.thumbnail||null,bytes:(record.photo?.size||0)+modelSize(record.model)};}
function completion(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error||Error('本机存储写入失败'));});}
// Compatibility index in the EXISTING drafts store, no schema upgrade or data removal.
// Legacy full records are visited once. Subsequent lists only read small summaries.
async function ensureIndex(){
 const d=await db(),tx=d.transaction(['memories','drafts'],'readwrite'),done=completion(tx),meta=tx.objectStore('drafts');
 const marker=meta.get('memory-meta-index-v1');
 marker.onsuccess=()=>{if(marker.result)return;const cursor=tx.objectStore('memories').openCursor();cursor.onsuccess=()=>{const row=cursor.result;if(!row){meta.put(true,'memory-meta-index-v1');return;}const key=metaKey(row.key),existing=meta.get(key);existing.onsuccess=()=>{if(!existing.result)meta.put(summary(row.value),key);row.continue();};};};
 await done;return d;
}
export async function save(record){
 const thumbnail=record.thumbnail||await makeThumbnail(record.photo),d=await db();
 const tx=d.transaction(['memories','drafts'],'readwrite'),done=completion(tx),meta=tx.objectStore('drafts');
 const tombstone=meta.get(deletedKey(record.id));
 tombstone.onsuccess=()=>{try{if(tombstone.result){tx.abort();return;}tx.objectStore('memories').put({...record,thumbnail});meta.put(summary({...record,thumbnail}),metaKey(record.id));}catch{tx.abort();}};
 await done;record.thumbnail=thumbnail;
}
export async function patchMetadata(id,changes){
 const d=await ensureIndex(),tx=d.transaction('drafts','readwrite'),done=completion(tx),store=tx.objectStore('drafts');let updated=null;
 const r=store.get(metaKey(id));
 r.onsuccess=()=>{try{if(!r.result)return;updated={...r.result};for(const key of ['name','ticket','settings','exported_at','thumbnail'])if(Object.hasOwn(changes,key))updated[key]=changes[key];store.put(updated,metaKey(id));}catch{tx.abort();}};
 await done;return updated;
}
export async function get(id){
 const d=await ensureIndex(),tx=d.transaction(['memories','drafts']),done=completion(tx);
 const [record,meta]=await Promise.all([request(tx.objectStore('memories').get(id)),request(tx.objectStore('drafts').get(metaKey(id)))]);await done;
 if(!record||!meta)return undefined;
 const merged={...record,...meta};
 if(!merged.thumbnail){const thumbnail=await makeThumbnail(record.photo);if(thumbnail){const updated=await patchMetadata(id,{thumbnail});if(!updated)return undefined;Object.assign(merged,updated);}}
 return merged;
}
export async function list(){
 const d=await ensureIndex(),range=IDBKeyRange.bound(['memory-meta-v1'],['memory-meta-v1',[]]);
 const rows=await request(d.transaction('drafts').objectStore('drafts').getAll(range));
 return rows.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
}
export async function draft(value){const d=await db();if(value===undefined)return request(d.transaction('drafts').objectStore('drafts').get('pending'));return new Promise((resolve,reject)=>{const tx=d.transaction('drafts','readwrite'),store=tx.objectStore('drafts');if(value===null)store.delete('pending');else store.put(value,'pending');tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error);});}

export async function remove(id){
 const d=await db(),tx=d.transaction(['memories','drafts'],'readwrite'),done=completion(tx);
 tx.objectStore('memories').delete(id);const meta=tx.objectStore('drafts');meta.delete(metaKey(id));meta.put(true,deletedKey(id));await done;
}
