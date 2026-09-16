// Byte-based progress across both ONNX files. Full desktop models must be stored in OPFS.
export async function bounded(p,ms,message){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),ms);})]);}finally{clearTimeout(timer);}}
const CACHE_PREFIX='still-sharp-',READY_FILE='ready.json';
const cacheTestBytes=Uint8Array.from([83,72,65,82,80]);
const modelSizeText=bytes=>bytes>=1e9?`${(bytes/1e9).toFixed(2)} GB`:`${Math.ceil(bytes/1e6)} MB`;
const cacheUnavailable=(total,reason,cause)=>{const error=Error(`当前浏览器无法可靠保存完整模型（约 ${modelSizeText(total)}）。${reason}本次未继续约 ${modelSizeText(total)} 完整下载。请退出无痕模式、释放空间、使用最新版 Chrome / Edge、允许网站存储后重试。`);error.code='CACHE_UNAVAILABLE';if(cause)error.cause=cause;return error;};
const isMissing=e=>e?.name==='NotFoundError';
const specsFor=config=>[{name:config.graph,size:Number(config.graphBytes)},{name:config.weights,size:Number(config.weightsBytes)}];
function validSpecs(config,total){const specs=specsFor(config);if(!config?.revision||specs.some(f=>!f.name||!Number.isSafeInteger(f.size)||f.size<=0))throw cacheUnavailable(total,'模型配置缺少可验证的文件名或大小。');return specs;}
function testName(){return `.__still-sharp-cache-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;}
async function storageSnapshot(total,timeout=8000){
 const storage=navigator.storage;
 if(!storage?.getDirectory)throw cacheUnavailable(total,'当前浏览器不支持可访问的网站数据存储。');
 if(!storage.estimate)throw cacheUnavailable(total,'当前浏览器无法读取可用存储空间。');
 let result;
 try{result=await bounded(storage.estimate(),timeout,'浏览器存储空间检查超时。');}catch(e){throw cacheUnavailable(total,'浏览器存储空间检查失败。',e);}
 const usage=Number(result?.usage),quota=Number(result?.quota);
 if(!Number.isFinite(usage)||!Number.isFinite(quota)||usage<0||quota<=0||quota<usage)throw cacheUnavailable(total,'浏览器返回的可用存储空间无法验证。');
 let persisted=null;
 if(typeof storage.persisted==='function')try{persisted=await bounded(storage.persisted(),timeout,'持久存储状态检查超时。');}catch{}
 return {usage,quota,available:Math.max(0,quota-usage),persisted};
}
export async function requestDesktopPersistence(){
 const storage=navigator.storage;
 if(!storage?.persisted)return null;
 let before=null;
 try{before=await storage.persisted();}catch{}
 if(typeof storage.persist==='function')try{await storage.persist();}catch{}
 try{return await storage.persisted();}catch{return before;}
}
async function verifyDirectory(dir,total,timeout=8000){
 const name=testName();let writer,error=null;
 try{
  const handle=await bounded(dir.getFileHandle(name,{create:true}),timeout,'OPFS 测试文件创建超时。');
  writer=await bounded(handle.createWritable(),timeout,'OPFS 测试文件写入准备超时。');
  await bounded(writer.write(cacheTestBytes),15000,'OPFS 测试写入超时。');
  await bounded(writer.close(),15000,'OPFS 测试文件关闭超时。');writer=null;
  const file=await bounded(handle.getFile(),timeout,'OPFS 测试文件读取超时。');
  const bytes=new Uint8Array(await bounded(file.arrayBuffer(),timeout,'OPFS 测试内容读取超时。'));
  if(bytes.length!==cacheTestBytes.length||bytes.some((value,index)=>value!==cacheTestBytes[index]))throw Error('OPFS 重读内容不一致。');
 }catch(e){error=e;try{await writer?.abort();}catch{}}
 try{await bounded(dir.removeEntry(name),timeout,'OPFS 测试文件删除超时。');}catch(e){if(!isMissing(e))throw cacheUnavailable(total,'OPFS 临时测试文件无法删除。',e);}
 if(error)throw cacheUnavailable(total,'OPFS 无法完成真实写入、关闭和重新读取测试。',error);
}
async function fileMatches(dir,spec,total,timeout=8000){
 try{const handle=await bounded(dir.getFileHandle(spec.name),timeout,'模型缓存读取超时。');const file=await bounded(handle.getFile(),timeout,'模型缓存读取超时。');return file.size===spec.size;}
 catch(e){if(isMissing(e))return false;throw cacheUnavailable(total,`模型缓存文件「${spec.name}」无法读取。`,e);}
}
async function readCachedFile(dir,spec,total,timeout=8000){
 let file;
 try{const handle=await bounded(dir.getFileHandle(spec.name),timeout,'模型缓存读取超时。');file=await bounded(handle.getFile(),timeout,'模型缓存读取超时。');}
 catch(e){if(isMissing(e))return null;throw cacheUnavailable(total,`模型缓存文件「${spec.name}」无法读取。`,e);}
 if(file.size!==spec.size)return null;
 let bytes;
 try{bytes=new Uint8Array(await bounded(file.arrayBuffer(),30000,'模型缓存内容读取超时。'));}
 catch(e){throw cacheUnavailable(total,`模型缓存文件「${spec.name}」无法重新读取。`,e);}
 if(bytes.byteLength!==spec.size)throw cacheUnavailable(total,`模型缓存文件「${spec.name}」重新读取后的大小不正确。`);
 return bytes;
}
function readyMatches(marker,config,specs){
 if(!marker||marker.revision!==config.revision||typeof marker.completedAt!=='string'||!Array.isArray(marker.files)||marker.files.length!==specs.length)return false;
 const expected=new Map(specs.map(file=>[file.name,file.size]));
 return marker.files.every(file=>expected.get(file?.name)===Number(file?.size))&&specs.every(file=>marker.files.some(entry=>entry.name===file.name&&Number(entry.size)===file.size));
}
async function readReady(dir,config,specs,total,timeout=8000){
 try{const handle=await bounded(dir.getFileHandle(READY_FILE),timeout,'完成标记读取超时。');const file=await bounded(handle.getFile(),timeout,'完成标记读取超时。');return JSON.parse(await bounded(file.text(),timeout,'完成标记读取超时。'));}
 catch(e){if(isMissing(e)||e instanceof SyntaxError)return null;throw cacheUnavailable(total,'模型完成标记无法读取。',e);}
}
async function writeReady(dir,config,specs,total,timeout=8000){
 const marker={revision:config.revision,files:specs.map(file=>({name:file.name,size:file.size})),completedAt:new Date().toISOString()};let writer;
 try{const handle=await bounded(dir.getFileHandle(READY_FILE,{create:true}),timeout,'完成标记创建超时。');writer=await bounded(handle.createWritable(),timeout,'完成标记写入准备超时。');await bounded(writer.write(JSON.stringify(marker)),15000,'完成标记写入超时。');await bounded(writer.close(),15000,'完成标记关闭超时。');writer=null;const saved=await readReady(dir,config,specs,total,timeout);if(!readyMatches(saved,config,specs))throw Error('完成标记复读校验失败。');}
 catch(e){try{await writer?.abort();}catch{}if(e.code==='CACHE_UNAVAILABLE')throw e;throw cacheUnavailable(total,'模型完成标记写入失败。',e);}
}
export async function inspectDesktopCache(config,{report=()=>{}}={}){
 const total=Number(config?.graphBytes)+Number(config?.weightsBytes),specs=validSpecs(config,total);
 report({type:'status',phase:'download',text:'正在检查浏览器存储空间与本机模型缓存…',loaded:0,total});
 const storage=await storageSnapshot(total);let root,dir;
 try{root=await bounded(navigator.storage.getDirectory(),8000,'OPFS 根目录读取超时。');dir=await bounded(root.getDirectoryHandle(CACHE_PREFIX+config.revision,{create:true}),8000,'模型缓存目录创建超时。');await verifyDirectory(dir,total);}
 catch(e){if(e.code==='CACHE_UNAVAILABLE')throw e;throw cacheUnavailable(total,'OPFS 根目录或 revision 缓存目录无法访问。',e);}
 const validFiles=new Set();for(const spec of specs)if(await fileMatches(dir,spec,total))validFiles.add(spec.name);
 const marker=await readReady(dir,config,specs,total),complete=validFiles.size===specs.length;
 if(complete&&!readyMatches(marker,config,specs)){await writeReady(dir,config,specs,total);report({type:'status',phase:'download',text:'已校验本机模型并恢复完成标记。',loaded:total,total});}
 const missingBytes=specs.filter(file=>!validFiles.has(file.name)).reduce((sum,file)=>sum+file.size,0);
 if(!complete){if(storage.available<missingBytes)throw cacheUnavailable(total,`估算可用空间仅约 ${modelSizeText(storage.available)}，不足以保存剩余模型。`);}
 return {dir,specs,total,storage,validFiles,ready:complete,revision:config.revision};
}
async function writeReadyIfComplete(cache){
 if(cache.ready)return;
 const complete=(await Promise.all(cache.specs.map(spec=>fileMatches(cache.dir,spec,cache.total)))).every(Boolean);
 if(!complete)return;
 await writeReady(cache.dir,{revision:cache.revision},cache.specs,cache.total);
 cache.ready=true;cache.validFiles=new Set(cache.specs.map(file=>file.name));
}
async function downloadFile(config,name,size,{offset=0,total=size,report=()=>{},cacheMs=8000,networkMs=30000,stallMs=45000,cache}={}){
 const emit=(text,loaded=0)=>report({type:'status',phase:'download',text,loaded:offset+loaded,total});
 if(!cache?.dir)throw cacheUnavailable(total,'当前模型没有可用的 OPFS revision 缓存目录。');
 const spec=cache.specs.find(file=>file.name===name&&file.size===size);if(!spec)throw cacheUnavailable(total,`模型文件「${name}」不在当前 revision 配置中。`);
 if(cache.validFiles.has(name)){
  emit('正在读取已缓存模型…');const data=await readCachedFile(cache.dir,spec,total,cacheMs);
  if(data){emit('✓ 已找到本机完整模型，无需重新下载。',size);return data;}
  cache.validFiles.delete(name);
 }
 emit('正在连接模型源，请稍候…');
 const controller=new AbortController();let reader,writer,handle;
 try{
  try{handle=await bounded(cache.dir.getFileHandle(name,{create:true}),cacheMs,'模型缓存文件创建超时。');writer=await bounded(handle.createWritable(),cacheMs,'模型缓存写入准备超时。');}
  catch(e){throw cacheUnavailable(total,`模型文件「${name}」无法创建可写缓存。`,e);}
  let response;
  for(let attempt=0;attempt<2;attempt++){
   try{const url=new URL(config.base+name);if(attempt)url.searchParams.set('retry',String(Date.now()));response=await bounded(fetch(url.href,{signal:controller.signal,cache:'no-store'}),networkMs,'连接模型源超时，请检查网络后重试。照片未上传。');break;}
   catch(e){if(attempt||!(e instanceof TypeError))throw e;emit('模型源连接失败，正在重新连接…');}
  }
  if(!response.ok)throw Error(`模型源返回 ${response.status}，请稍后重试。`);
  if(!response.body)throw Error('浏览器不支持流式下载，请换用新版 Chrome。');
  reader=response.body.getReader();let loaded=0,last=0;
  while(true){const {done,value}=await bounded(reader.read(),stallMs,'模型下载长时间无数据，请检查网络后重试。');if(done)break;
   if(loaded+value.length>size)throw Error('模型文件大小不符，请重新下载。');
   try{await bounded(writer.write(value),15000,'本机缓存写入超时，请清除模型缓存后重试。');}catch(e){throw cacheUnavailable(total,`模型文件「${name}」写入 OPFS 失败。`,e);}
   loaded+=value.length;
   if(performance.now()-last>200||loaded===size){emit(`正在下载模型 · ${Math.round((offset+loaded)/1048576)} / ${Math.round(total/1048576)} MB`,loaded);last=performance.now();}
  }
  if(loaded!==size)throw Error('模型下载不完整，请重试。');
  try{await bounded(writer.close(),15000,'模型缓存保存超时。');}catch(e){throw cacheUnavailable(total,`模型文件「${name}」保存到 OPFS 失败。`,e);}writer=null;
  const data=await readCachedFile(cache.dir,spec,total,cacheMs);if(!data)throw cacheUnavailable(total,`模型文件「${name}」落盘后大小校验失败。`);
  cache.validFiles.add(name);await writeReadyIfComplete(cache);emit(cache.ready?'✓ 完整模型已保存在当前浏览器。下次打开同一网址时将优先直接使用。':'✓ 完整模型文件已保存并通过大小校验。',size);return data;
 }catch(e){controller.abort();reader?.cancel().catch(()=>{});if(writer)writer.abort().catch(()=>{});if(e.code==='CACHE_UNAVAILABLE')throw e;if(e instanceof TypeError)throw Error('无法下载模型文件（'+name+'）。当前网络无法连接模型下载节点；请切换网络后重试。照片未上传。');throw e;}
}

export async function modelFile(config,name,size,options={}){
 const total=Number(options.total)||Number(config.graphBytes)+Number(config.weightsBytes),cache=await inspectDesktopCache(config,{report:options.report});
 const sources=config.sources?.length?config.sources:[{name:'原始线路',base:config.base}];
 let last;
 for(let i=0;i<sources.length;i++){
  const source=sources[i];
  const report=data=>options.report?.({...data,text:source.name+' · '+data.text});
  try{return await downloadFile({...config,base:source.base},name,size,{...options,total,report,cache});}
  catch(e){if(e.code==='CACHE_UNAVAILABLE')throw e;last=e;if(i+1<sources.length)report({type:'status',phase:'download',text:'连接未完成，正在切换下载线路…',loaded:options.offset||0,total});}
 }
 throw Error('模型下载线路均未完成。'+last.message);
}
