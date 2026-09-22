export function createTicketSaver({write,onSaved=()=>{},onError=()=>{},delay=500}){
 const pending=new Map(),timers=new Map(),revisions=new Map(),deleted=new Set();
 let queue=Promise.resolve();
 function cancel(id){deleted.add(id);clearTimeout(timers.get(id));timers.delete(id);pending.delete(id);revisions.set(id,(revisions.get(id)||0)+1);}
 function flush(id){
  const ids=id===undefined?[...pending.keys()]:[id],tasks=[queue];
  for(const memoryId of ids){
   clearTimeout(timers.get(memoryId));timers.delete(memoryId);
   const item=pending.get(memoryId);if(!item)continue;pending.delete(memoryId);
   const task=queue.then(async()=>{
    if(deleted.has(memoryId))return;
    const saved=await write(memoryId,item.changes);
    if(saved&&!deleted.has(memoryId)&&revisions.get(memoryId)===item.revision)onSaved(memoryId,saved);
   }).catch(error=>{if(!deleted.has(memoryId)&&revisions.get(memoryId)===item.revision)pending.set(memoryId,item);onError(memoryId,error);throw error;});
   queue=task.catch(()=>{});tasks.push(task);
  }
  return Promise.all(tasks);
 }
 function schedule(id,changes){
  if(deleted.has(id))return;
  const revision=(revisions.get(id)||0)+1;revisions.set(id,revision);
  pending.set(id,{changes:structuredClone(changes),revision});clearTimeout(timers.get(id));
  timers.set(id,setTimeout(()=>{void flush(id).catch(()=>{});},delay));
 }
 return {schedule,flush,cancel,resume:id=>deleted.delete(id),settled:()=>queue};
}
