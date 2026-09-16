import {preparePhoto} from './photo.js?v=lite-1';
import {DEFAULT_LITE_BASE,normalizeModelBase,checkModelSource} from './model-source.js?v=usability-20260916-2';
import {inspectDesktopCache,requestDesktopPersistence} from './download.js?v=desktop-cache-20260916';
import {memoryBox} from '../main.js?v=usability-20260916';
import {FILES} from './mobile-model.js';
import {save,list,get,draft,pack,unpack,remove,normalizeTicket} from './library.js?v=usability-20260916';
const $=id=>document.getElementById(id);let records=[],current=null,worker=null,busy=false,starting=false,epoch=0,urls=[],operation=null,cancelJob=null,watchdog=null,previousMemoryId=null;
const mobile=navigator.userAgentData?.mobile||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
const workerURL=new URL(mobile?'./mobile-worker.js?v=lite-2':'./worker.js?v=decode-1',import.meta.url);
let mobileModelFile=null,mobileReady=false,modelImport=null,sourceReady=false,deviceReady=false,sourceEpoch=0;const savedIds=new Set(),dirtyIds=new Set();
let modelBase=DEFAULT_LITE_BASE;
try{modelBase=normalizeModelBase(localStorage.getItem('palinode-lite-source')||DEFAULT_LITE_BASE);}catch{}
let desktopConfig=null,desktopModelBytes=0,desktopPersisted=null,desktopStorageReady=false;
const formatDesktopBytes=bytes=>bytes>=1e9?`${(bytes/1e9).toFixed(2)} GB`:`${Math.ceil(bytes/1e6)} MB`;
const desktopModelSize=()=>desktopModelBytes?formatDesktopBytes(desktopModelBytes):'1.31 GB';
async function loadDesktopConfig(){
 if(desktopConfig)return desktopConfig;
 const response=await fetch(new URL('./model.json',import.meta.url),{cache:'no-store'});
 if(!response.ok)throw Error('模型配置加载失败，无法检查本机存储。');
 const config=await response.json();
 desktopModelBytes=Number(config.graphBytes)+Number(config.weightsBytes);
 if(!config.revision||!Number.isFinite(desktopModelBytes)||desktopModelBytes<=0)throw Error('模型配置缺少可验证的文件大小。');
 desktopConfig=config;return config;
}
function showDesktopStorage(cache=null,error=null){
 const node=$('storage-status');if(!node)return;node.hidden=false;
 const location='模型位置：当前浏览器的网站数据，不会进入 Windows“下载”文件夹。';
 if(error){node.dataset.risk='warning';node.textContent=`${location} 保存状态：无法可靠保存。${error.message}`;return;}
 const estimate=cache?.storage,estimateText=estimate?`估算可用空间约 ${formatDesktopBytes(estimate.available)} · 当前站点已使用约 ${formatDesktopBytes(estimate.usage)}`:'浏览器可用空间估算暂不可用';
 const persisted=desktopPersisted??estimate?.persisted;
 const persistenceText=persisted===true?'保存状态：已持久保存。浏览器已允许更持久地保留本站模型数据。':'保存状态：可以保存但浏览器可能清理。模型会保存在浏览器网站数据中，但空间不足时仍可能被清理。';
 const cacheText=cache?.ready?'✓ 已找到本机完整模型，无需重新下载。':`完整模型约 ${desktopModelSize()}，首次保存成功后，下次使用同一浏览器打开同一网址时会优先直接使用。`;
 node.dataset.risk='ok';node.textContent=`${location} ${estimateText} · ${persistenceText} ${cacheText}`;
}
async function prepareDesktopStorage(){
 $('storage-status').hidden=false;$('storage-status').textContent='正在检查浏览器存储空间与本机模型缓存…';
 const config=await loadDesktopConfig();desktopPersisted=await requestDesktopPersistence();
 const cache=await inspectDesktopCache(config);desktopStorageReady=true;showDesktopStorage(cache);return cache;
}
const mobileModelBytes=FILES.reduce((sum,file)=>sum+file.size,0);
const formatBytes=bytes=>bytes>=1024**3?`${(bytes/1024**3).toFixed(2)} GB`:`${Math.round(bytes/1000000)} MB`;
const mobileModelSize=formatBytes(mobileModelBytes);
const progressPanel=document.createElement('section');progressPanel.hidden=true;progressPanel.id='generation-progress';progressPanel.setAttribute('aria-label','本机制作进度');progressPanel.innerHTML=`<div><strong>正在制作记忆</strong><button id="generation-cancel" type="button">取消</button></div><p id="generation-status" role="status">正在启动本机任务…</p><progress id="generation-bar" max="1" aria-label="模型下载进度"></progress><small id="generation-detail">照片留在本机</small><button id="generation-retry" hidden>重试制作</button>`;document.body.append(progressPanel);
let retryPhoto=null;
$('generation-cancel').onclick=()=>{if(busy)stop();else progressPanel.hidden=true;};
$('generation-retry').onclick=()=>{if(retryPhoto)create(retryPhoto);};
function updateProgress(data){memoryBox.setGenerationProgress(data.phase==='download'&&data.total>0?data.loaded/data.total:null);progressPanel.hidden=false;$('generation-status').textContent=data.text;const bar=$('generation-bar');if(data.phase==='download'&&Number.isFinite(data.total)&&data.total>0){bar.value=Math.min(1,data.loaded/data.total);$('generation-detail').textContent=`${Math.floor(bar.value*100)}% · ${(data.loaded/1048576).toFixed(1)} / ${(data.total/1048576).toFixed(1)} MB · 照片未上传`;}else{bar.removeAttribute('value');$('generation-detail').textContent='照片留在本机 · 请保持页面打开';}}
function notice(text=''){ $('notice').textContent=text;$('notice').hidden=!text;}
async function storageEstimate(){
 const storage=navigator.storage;
 if(!storage?.estimate)return null;
 try{
  const result=await storage.estimate(),usage=Number(result?.usage),quota=Number(result?.quota);
  if(!Number.isFinite(usage)||!Number.isFinite(quota)||usage<0||quota<=0)return null;
  return {usage,available:Math.max(0,quota-usage)};
 }catch{return null;}
}
async function storagePersistence(request=false){
 const storage=navigator.storage;
 if(!storage?.persisted)return null;
 if(request&&storage.persist)try{await storage.persist();}catch{}
 try{return await storage.persisted();}catch{return false;}
}
async function updateStorageStatus(persisted=null){
 const node=$('storage-status');
 if(!node||!mobile)return;
 const estimate=await storageEstimate(),available=estimate?.available;
 const risk=Number.isFinite(available)&&available<mobileModelBytes;
 const estimateText=estimate?`浏览器可用存储额度估算约 ${formatBytes(available)} · 当前站点已使用约 ${formatBytes(estimate.usage)}`:'浏览器可用存储额度估算暂不可用';
 const persistenceText=persisted===true?'浏览器已允许更持久地保留本站数据':'浏览器仍可能清理本机保存，重要记忆请导出备份';
 node.dataset.risk=risk?'warning':'ok';node.style.color=risk?'#8a4a2e':'';node.style.fontWeight=risk?'600':'';
 node.textContent=`首次约需 ${mobileModelSize} 轻量模型 · 下载后优先保存在本机 · 照片不会上传 · ${estimateText} · ${risk?'⚠ 估算可用额度低于模型体积，可能不足':persistenceText}`;
}
function requestPersistentStorage(){return storagePersistence(true).then(updateStorageStatus);}
function sidebar(open){document.body.classList.toggle('sidebar-open',open);$('toggle-sidebar').textContent=open?'关闭':'调整';$('toggle-sidebar').setAttribute('aria-expanded',String(open));$('close-sidebar').hidden=!open;}
function lock(on){busy=on;$('library').disabled=on;$('replay-creation').disabled=on;$('choose-photo').textContent=on?'取消制作':'＋ 新建记忆';$('import-memory').disabled=on;$('view-example').disabled=on;for(const id of ['welcome-example','welcome-create','ticket-city','ticket-venue','ticket-date','save-settings','download-memory','rename-memory','delete-memory']){const el=$(id);if(el)el.disabled=on;}document.querySelectorAll('.memory-card').forEach(b=>b.disabled=on);}
function stop(){draft(null).catch(()=>{});progressPanel.hidden=true;retryPhoto=null;epoch++;operation=null;cancelJob?.(Error('已取消'));cancelJob=null;clearTimeout(watchdog);watchdog=null;worker?.terminate();worker=null;memoryBox.setInferencePaused(false);memoryBox.setComputing(false);memoryBox.cancelCreation();lock(false);status('制作已取消 · 已有记忆保留');notice('制作已取消，已有记忆保留。');}
function status(text){$('job-message').textContent=text;$('connection').textContent=text;}
async function refresh(){try{records=await list();records.forEach(r=>savedIds.add(r.id));}catch{notice('浏览器存储不可用，生成后请立即导出记忆。');}const select=$('library');select.replaceChildren();const placeholder=new Option('选择一份记忆…','');select.append(placeholder);for(const r of records){const o=document.createElement('option');o.value=r.id;o.textContent=r.name;select.append(o);}$('library-section').hidden=!records.length;$('memory-count').textContent=records.length;if(current)select.value=current.id;renderLibrary();}
async function show(record,reveal=false){
 const token=++epoch;if(!reveal)memoryBox.cancelCreation();current=record;restoreTicket(record.ticket);document.querySelector('.first-visit').hidden=true;
 urls.forEach(URL.revokeObjectURL);urls=[];
 const photo=record.photo?URL.createObjectURL(record.photo):record.photo_url,model=record.model?URL.createObjectURL(new Blob([record.model])):record.model_url;if(record.photo)urls.push(photo);if(record.model)urls.push(model);
 $('current-memory').hidden=false;$('photo-preview').src=photo;$('memory-name').textContent=record.name;$('memory-date').textContent=new Date(record.created_at).toLocaleDateString('zh-CN');$('steps').hidden=true;$('retry').hidden=true;$('memory-actions').hidden=false;$('download-memory').hidden=!record.model;$('save-settings').textContent='保存设置到本机';$('library').value=record.id;for(const id of ['rename-memory','delete-memory'])$(id).hidden=!record.model;
 status('正在打开这段记忆…');try{await memoryBox.load(model,record.settings,reveal);if(token!==epoch)return;status(storageStatus(record));renderLibrary();}catch(e){if(token===epoch){notice(e.message);sidebar(true);}throw e;}
}
const nextAnimationFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
async function prepareMobileForNewCreation(){
 if(!mobile)return null;
 if(current?.model&&!savedIds.has(current.id)){notice('当前记忆尚未保存，请先保存设置或导出记忆后再新建。');sidebar(true);return false;}
 previousMemoryId=current&&savedIds.has(current.id)?current.id:null;
 urls.forEach(URL.revokeObjectURL);urls=[];$('photo-preview')?.removeAttribute('src');
 memoryBox.releaseLoadedMemory();
 if(worker||operation){clearTimeout(watchdog);watchdog=null;worker?.terminate();worker=null;cancelJob?.(Error('旧制作已结束'));cancelJob=null;operation=null;}
 memoryBox.setInferencePaused(false);memoryBox.setComputing(false);
 if(previousMemoryId===current?.id){const {id,name,created_at,ticket,exported_at}=current;current={id,name,created_at,ticket,exported_at};}
 await nextAnimationFrame();await nextAnimationFrame();return previousMemoryId;
}
async function restorePreviousMemory(id){
 if(!id)return;
 await nextAnimationFrame();
 try{const record=await get(id);if(record){await show(record);status('已恢复上一份记忆，可继续新建。');}else await refresh();}
 catch{notice('上一份记忆恢复失败，请从收藏库重新打开。');await refresh().catch(()=>{});}
 if(previousMemoryId===id)previousMemoryId=null;
}
const dialog=document.createElement('dialog');dialog.className='local-generation';dialog.innerHTML=`<form method="dialog"><button class="dialog-close" aria-label="关闭制作说明">×</button></form><p class="eyebrow">MADE ON YOUR DEVICE</p><h2>在这里，留住一刻。</h2><p id="model-description">照片与生成过程留在你的设备。首次需下载约 1.31 GB 模型，优先镜像线路，失败自动切换；之后优先使用本机缓存。</p><aside id="mobile-generation-advice" hidden style="margin:18px 0;padding:14px 16px;background:#edf0e8;border-radius:10px;font-size:13px;line-height:1.7"><strong>制作前的小提醒</strong><br>手机建议使用 Google Chrome 浏览器。<br>想获得更好的效果，优先使用电脑版：电脑版使用完整模型，画面细节更丰富；手机版使用轻量模型。</aside><p id="gpu-status" role="status">正在检测设备…</p><button id="local-select" class="primary" disabled>选择照片并制作</button><button id="local-example" disabled>用示例风景试一试 ↗</button><small id="generation-explanation">请保持页面打开。生成会占用本机 GPU 和内存；关闭页面会停止制作。<br>本机保存可能被浏览器清理，重要记忆请导出备份。</small><p id="storage-status" role="status" aria-live="polite" hidden style="font-size:13px;line-height:1.7;margin:12px 0">正在读取浏览器可用存储额度估算…</p><details><summary>模型与缓存</summary><p>SHARP 的浏览器格式转换版本，用于非商业研究实验。<a href="./browser-inference/licenses/APPLE-SHARP.txt" target="_blank" rel="noopener">模型许可</a> · <a href="./browser-inference/licenses/NOTICE.txt" target="_blank" rel="noopener">来源与修改说明</a></p><button id="clear-model">清除本机模型缓存</button></details>`;document.body.append(dialog);
if(!mobile){$('model-description').textContent='完整模型约 1.31 GB，将保存在当前浏览器的网站数据中，不会进入 Windows“下载”文件夹。保存成功后，下次使用同一浏览器打开同一网址时会优先直接使用。';$('generation-explanation').textContent='请保持页面打开。生成会占用本机 GPU 和内存；关闭页面会停止制作。模型保存在当前浏览器的网站数据中，浏览器仍可能清理它；重要记忆请导出备份。';}
const modelInput=document.createElement('input');modelInput.type='file';modelInput.accept='.gemosmodel';modelInput.hidden=true;dialog.append(modelInput);
const modelSection=document.createElement('section');modelSection.hidden=!mobile;modelSection.style.cssText='margin:20px 0;padding:16px;background:#f2f3ef;border-radius:12px;line-height:1.7';modelSection.innerHTML=`<button id="import-lite-model" type="button" style="width:100%;min-height:44px;border:1px solid #b9bdb1;border-radius:8px;font-size:14px">导入轻量模型包</button><p style="font-size:13px;margin:8px 0">可选：如果你已有 APK 的模型包，可以导入以节省下载。下载源通过检查后才能自动下载；也可直接导入模型包。</p><a style="font-size:13px;color:inherit;text-underline-offset:4px" href="https://github.com/duoduoaiduoduo/gemos-still/releases/download/android-v0.4.0-lite/Gemos-Still-Lite-256.gemosmodel" target="_blank" rel="noopener">下载轻量模型包（${mobileModelSize}） ↗</a><progress id="model-import-progress" max="1" hidden style="width:100%"></progress>`;dialog.querySelector('details').append(modelSection);void updateStorageStatus();
function readyControls(){const blocked=!!modelImport||!deviceReady;$('local-select').disabled=blocked||(mobile&&!mobileReady&&!sourceReady)||(!mobile&&!desktopStorageReady);$('local-example').disabled=blocked||(mobile&&!mobileReady&&!sourceReady);}
const sourceSection=document.createElement('section');
sourceSection.innerHTML=`<label for="model-source-url">轻量模型下载目录</label><input id="model-source-url" type="url" spellcheck="false"><div class="source-actions"><button id="save-model-source" type="button">保存下载源</button><button id="check-model-source" type="button">检查连接</button></div><p id="source-status" role="status">自部署需配置模型文件，或导入已下载的模型包。</p>`;
modelSection.append(sourceSection);$('model-source-url').value=modelBase;
$('save-model-source').onclick=async()=>{try{modelBase=normalizeModelBase($('model-source-url').value);localStorage.setItem('palinode-lite-source',modelBase);$('model-source-url').value=modelBase;$('source-status').textContent='下载源已保存，正在检查…';sourceReady=false;readyControls();await verifySource();}catch(e){$('source-status').textContent=e.message;}};
async function verifySource(){const token=++sourceEpoch,base=modelBase;sourceReady=false;readyControls();try{await checkModelSource(base,FILES);if(token!==sourceEpoch)return;sourceReady=true;$('source-status').textContent='模型文件可访问，下载时会继续校验完整性。';$('gpu-status').textContent=mobileReady?'轻量模型已就绪':'下载源可用 · 首次需下载约 '+mobileModelSize;}catch(e){if(token!==sourceEpoch)return;$('source-status').textContent=e.message;$('gpu-status').textContent=mobileReady?'轻量模型已就绪 · 使用本机缓存':'当前仅支持查看示例或导入模型。自动下载源不可用。';}finally{readyControls();}}
$('check-model-source').onclick=async()=>{const button=$('check-model-source');button.disabled=true;try{const base=normalizeModelBase($('model-source-url').value);await checkModelSource(base,FILES);$('source-status').textContent='检查通过。点击「保存下载源」以使用此地址。';if(base===modelBase){sourceReady=true;readyControls();}}catch(e){$('source-status').textContent=e.message;}finally{button.disabled=false;}};
$('import-lite-model').onclick=()=>modelInput.click();
modelInput.onchange=async()=>{const file=modelInput.files[0];modelInput.value='';if(!file||modelImport)return;mobileReady=false;mobileModelFile=null;const w=new Worker(workerURL,{type:'module'});modelImport=w;readyControls();$('import-lite-model').disabled=true;$('model-import-progress').hidden=false;$('model-import-progress').value=0;$('gpu-status').textContent='正在导入并校验模型，请保持页面打开…';
try{const cached=await new Promise((resolve,reject)=>{w.onmessage=({data})=>{if(data.type==='model-ready')resolve(data.cached);else if(data.type==='error')reject(Error(data.text));else if(data.type==='status'&&data.total){$('model-import-progress').value=data.loaded/data.total;$('gpu-status').textContent=`正在校验模型 · ${Math.floor(data.loaded/data.total*100)}%`;}};w.onerror=()=>reject(Error('导入中断，请关闭其他标签后重试。'));w.postMessage({type:'import-model',file});});mobileModelFile=cached?null:file;mobileReady=true;deviceReady=true;$('gpu-status').textContent=cached?'轻量模型已就绪 · 本机 CPU 生成':'模型已就绪 · 本次可用，关闭页面后需要重新导入';void requestPersistentStorage();}
catch(e){$('gpu-status').textContent=e.message;}finally{w.terminate();modelImport=null;$('import-lite-model').disabled=false;$('model-import-progress').hidden=true;readyControls();}};
if(mobile){$('storage-status').hidden=false;$('model-description').textContent='制作前会检查本机缓存与模型下载源。首次需约 '+mobileModelSize+' 轻量模型；下载源不可用时，请先看示例或导入模型包。照片和结果不上传。';$('generation-explanation').textContent='实验功能：请保持页面在前台，并关闭其他标签。不同手机浏览器仍可能因内存限制中断；重要记忆请导出备份。';}
async function probeWorker(){
 let probe,timer;
 try{await new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('这个浏览器的后台计算未响应。请用最新版 Chrome 打开同一网址再试；已有记忆仍可查看。')),15000);probe=new Worker(workerURL,{type:'module'});probe.onmessage=({data})=>{if(data.type==='probe-ready'){if(mobile)mobileReady=!!data.cached||!!mobileModelFile;resolve();}else if(data.type==='error')reject(Error(data.text+'。请用最新版 Chrome 打开同一网址再试。'));};probe.onerror=()=>reject(Error('浏览器无法启动后台计算组件，请用最新版 Chrome 打开同一网址再试。'));probe.postMessage({type:'probe'});});}finally{clearTimeout(timer);probe?.terminate();}
}
async function setup(){
 if(!dialog.open)dialog.showModal();deviceReady=false;desktopStorageReady=false;readyControls();
 if(mobile){void updateStorageStatus();$('mobile-generation-advice').hidden=false;$('local-select').textContent='选择照片 · 轻量制作';$('gpu-status').textContent='正在检查本机模型…';$('local-select').disabled=$('local-example').disabled=true;try{await probeWorker();deviceReady=true;if(!modelImport){if(mobileReady){$('gpu-status').textContent='轻量模型已就绪 · 使用本机 CPU';readyControls();void requestPersistentStorage();}else await verifySource();}}catch(e){$('gpu-status').textContent=e.message;}return;}
 $('local-select').disabled=$('local-example').disabled=true;
 try{const cache=await prepareDesktopStorage();$('gpu-status').textContent=cache.ready?'✓ 已找到本机完整模型，无需重新下载。':'存储检查通过 · 首次需下载约 '+desktopModelSize()+' 完整模型';}
 catch(e){showDesktopStorage(null,e);$('gpu-status').textContent=e.message;}
 try{const a=await Promise.race([navigator.gpu?.requestAdapter({powerPreference:'high-performance'}),new Promise((_,reject)=>setTimeout(()=>reject(Error('GPU 检测超时，请更新浏览器后重试。')),15000))]);if(!a?.features.has('shader-f16'))throw Error('当前设备不支持所需的 WebGPU 半精度计算。请更新支持 WebGPU 的浏览器；你仍可查看示例、打开记忆文件。');$('gpu-status').textContent='正在检测浏览器后台计算…';await probeWorker();deviceReady=true;$('gpu-status').textContent='设备支持 · 使用你自己的 GPU';readyControls();}catch(e){$('gpu-status').textContent=e.message;readyControls();}
}
// Modal dialogs make controls outside them inert, including the header file input.
dialog.append($('photo-input'));
$('local-select').type='button';
$('local-select').onclick=()=>{
 try{
  const input=$('photo-input');
  if(typeof input.showPicker==='function')input.showPicker();else input.click();
 }catch(e){$('gpu-status').textContent='未能打开照片选择窗口：'+e.message;}
};
$('local-example').onclick=async()=>{try{const meta=await(await fetch('./memory.json')).json();const response=await fetch(meta.photo_url);if(!response.ok)throw Error('示例照片未能加载');const blob=await response.blob();dialog.close();await create(new File([blob],`${meta.name}.png`,{type:blob.type}));}catch(e){notice(e.message);sidebar(true);}};
$('clear-model').onclick=async()=>{if(modelImport||busy)return;try{const root=await navigator.storage.getDirectory();for await(const name of root.keys())if(name.startsWith('still-sharp-'))await root.removeEntry(name,{recursive:true});$('gpu-status').textContent='模型缓存与 ready 标记已清除';if(!mobile){desktopStorageReady=false;$('storage-status').hidden=false;$('storage-status').textContent='模型位置：当前浏览器的网站数据。保存状态：未安装；下次制作前会重新检查并保存完整模型。';readyControls();}void updateStorageStatus();if(mobile){mobileReady=false;mobileModelFile=null;sourceReady=false;await verifySource();}}catch{$('gpu-status').textContent='当前浏览器无法清除缓存';}};
async function create(file){
 if(busy||starting||modelImport)return;if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)){notice('请选择 JPG、PNG 或 WebP 照片');return;}if(file.size>25*1024*1024){notice('照片不能超过 25 MB');return;}
 starting=true;
 try{
 if(mobile&&(!deviceReady||(!mobileReady&&!sourceReady))){await setup();if(!deviceReady||(!mobileReady&&!sourceReady))return;}
 const previousId=mobile?await prepareMobileForNewCreation():null;if(previousId===false)return;
 dialog.close();notice();sidebar(false);lock(true);retryPhoto=file;progressPanel.querySelector('strong').textContent='正在制作记忆';$('generation-bar').hidden=false;$('generation-retry').hidden=true;$('generation-cancel').textContent='取消';updateProgress({text:'正在启动本机任务…'});memoryBox.setComputing(true);const token=++epoch,op={};operation=op;
 let arrived=false,lastStatus='正在准备本机模型';
 let arrival;
 let runningWorker,completed=false;
 try{
 updateProgress({text:'正在保存照片草稿…'});try{await draft({photo:file,name:file.name,ticket:readTicket(),started_at:Date.now()});}catch{notice('无法保存制作草稿，页面关闭后需重新选择照片。');}if(operation!==op)return;
 const prepared=await preparePhoto(file,mobile?256:1536);if(operation!==op)return;
 arrival=Promise.resolve().then(()=>memoryBox.beginCreation(file,file.name.replace(/\.[^.]+$/,''))).then(()=>{arrived=true;if(token===epoch)memoryBox.waiting(lastStatus);});
 runningWorker=new Worker(workerURL,{type:'module'});worker=runningWorker;
 const result=new Promise((resolve,reject)=>{cancelJob=reject;const arm=(ms,text)=>{clearTimeout(watchdog);watchdog=setTimeout(()=>reject(Error(text)),ms);};arm(30000,'本机任务没有启动响应，请更新浏览器并刷新重试');runningWorker.onmessage=({data})=>{if(token!==epoch)return;if(data.type==='status'){if(['initializing','inference','packing'].includes(data.phase))memoryBox.setInferencePaused(true);arm(['initializing','inference'].includes(data.phase)?(mobile?900000:300000):60000,'当前步骤长时间没有响应：'+data.text+'。请重试；若再次失败，请提供手机型号和浏览器。');lastStatus=data.text;updateProgress(data);status(data.text);if(arrived)memoryBox.waiting(data.text);}else if(data.type==='complete')resolve(data.buffer);else if(data.type==='error')reject(Error(data.text));};runningWorker.onerror=()=>reject(Error('浏览器未能完成推理，可能是内存不足或 GPU 不兼容。已有记忆仍可打开。'));});
 runningWorker.postMessage({prepared,...(mobile?{file:mobileModelFile,modelBase}:{})},[prepared.pixels.buffer]);
 const [buffer]=await Promise.all([result,arrival]);runningWorker.terminate();worker=null;memoryBox.setInferencePaused(false);void requestPersistentStorage();if(token!==epoch)return;
 const record={id:crypto.randomUUID(),name:file.name.replace(/\.[^.]+$/,'').slice(0,60)||'一段记忆',created_at:new Date().toISOString(),photo:file,model:buffer,settings:{designVersion:2,depthVolume:1},ticket:readTicket()};
 try{await save(record);savedIds.add(record.id);void requestPersistentStorage();}catch{notice('本机存储不足，请立即导出这份记忆。');}
 await draft(null).catch(()=>{});progressPanel.hidden=true;retryPhoto=null;await refresh();await show(record,true);completed=true;previousMemoryId=null;
 }catch(e){if(operation===op){updateProgress({text:'制作未完成：'+e.message});progressPanel.querySelector('strong').textContent='制作已暂停';$('generation-bar').hidden=true;$('generation-detail').textContent='照片未上传 · 请根据上方原因重试';$('generation-retry').hidden=false;$('generation-cancel').textContent='关闭';notice('制作未完成：'+e.message);status('照片没有上传，可重试或换一台设备。');sidebar(true);}}
 finally{
  const ownsOperation=operation===op;
  const ownsWorker=worker===runningWorker;
  if(ownsOperation||ownsWorker||!operation){
   clearTimeout(watchdog);watchdog=null;
   runningWorker?.terminate();
   if(ownsWorker)worker=null;
   memoryBox.setInferencePaused(false);memoryBox.setComputing(false);
   if(!completed)memoryBox.cancelCreation();
  }
  if(ownsOperation||!operation){operation=null;cancelJob=null;lock(false);}
  else if(ownsWorker)worker=null;
 }
 if(previousId&&!completed&&!operation){lock(true);try{await restorePreviousMemory(previousId);}finally{lock(false);}}
 }finally{starting=false;}
}
$('choose-photo').onclick=()=>busy?stop():setup();$('photo-input').onchange=e=>{create(e.target.files[0]);e.target.value='';};
const importButton=document.createElement('button');importButton.id='import-memory';importButton.textContent='打开记忆文件';importButton.className='quiet';$('creation').append(importButton);const input=document.createElement('input');input.type='file';input.accept='.still';input.hidden=true;document.body.append(input);importButton.onclick=()=>input.click();input.onchange=async()=>{try{const r=await unpack(input.files[0]);try{await save(r);savedIds.add(r.id);void requestPersistentStorage();}catch{notice('无法保存到浏览器，但仍可查看这份记忆。');}await refresh();await show(r);}catch(e){notice(e.message);sidebar(true);}input.value='';};
$('library').onchange=async()=>{if(busy)return;const id=$('library').value;await ticketQueue;try{const r=await get(id);if(r)await show(r);}catch(e){notice(e.message);}};
$('save-settings').onclick=async()=>{if(!current||busy)return;await ticketQueue;const record=current;if(!record)return;record.settings=memoryBox.getSettings();record.exported_at=null;try{if(record.model){record.ticket=readTicket();dirtyIds.add(record.id);await save(record);savedIds.add(record.id);dirtyIds.delete(record.id);if(current===record)status(storageStatus(record));await refresh();}else localStorage.setItem(`still-demo-settings-${record.id}`,JSON.stringify(record.settings));notice('设置已保存在这台设备。');}catch(e){if(current===record)status('修改尚未保存，请立即导出');notice('保存失败：'+e.message);}};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('download-memory').textContent='导出记忆文件 ↓';$('download-memory').onclick=async()=>{if(busy)return;await ticketQueue;const record=current;if(record?.model){record.settings=memoryBox.getSettings();record.ticket=readTicket();download(pack(record),`${record.name.replace(/[\\/:*?"<>|]/g,'_')}.still`);record.exported_at=new Date().toISOString();notice('已发起导出，请确认文件已下载后再删除记忆。');if(savedIds.has(record.id)){try{await save(record);dirtyIds.delete(record.id);await refresh();}catch{notice('已发起导出，但未能更新本机备份记录，请确认下载文件。');}}}};
$('snapshot').onclick=()=>{const a=document.createElement('a');a.href=memoryBox.capture();a.download='still-memory.png';a.click();};
$('replay-creation').onclick=async()=>{if(busy||!current)return;lock(true);const r=current,op={};operation=op;try{const photo=r.photo||await(await fetch(r.photo_url)).blob();if(operation!==op)return;await memoryBox.beginCreation(photo,r.name);await new Promise(resolve=>setTimeout(resolve,1200));if(operation===op)await show(r,true);}catch(e){if(operation===op){memoryBox.cancelCreation();notice(e.message);}}finally{if(operation===op){operation=null;lock(false);}}};
$('toggle-sidebar').onclick=()=>sidebar(!document.body.classList.contains('sidebar-open'));$('close-sidebar').onclick=()=>sidebar(false);
window.addEventListener('beforeunload',e=>{if(busy||modelImport){e.preventDefault();e.returnValue='';}});
for(const type of ['dragover','drop'])document.addEventListener(type,e=>e.preventDefault());document.addEventListener('drop',e=>{if(!busy){notice('请点击「新建记忆」检查设备后选择照片。');sidebar(true);}});
const example=document.createElement('button');example.id='view-example';example.className='quiet';example.textContent='查看示例';$('library-section').before(example);example.onclick=async()=>{if(busy)return;dialog.close();try{const demo=await(await fetch('./memory.json?v=gallery-20260913-1')).json();try{demo.settings=JSON.parse(localStorage.getItem(`still-demo-settings-${demo.id}`))||demo.settings;}catch{}await show(demo);}catch(e){notice(e.message);sidebar(true);}};
async function boot(){document.querySelector('.format-note').textContent='照片留在本机 · JPG / PNG / WebP';$('creation').hidden=false;await refresh();status('等待收藏 · 新建记忆或打开已有记忆');const pending=await draft().catch(()=>null);if(pending?.photo){restoreTicket(pending.ticket);retryPhoto=new File([pending.photo],pending.name||'未完成的记忆.jpg',{type:pending.photo.type});updateProgress({text:'上次制作中断了，可能是页面关闭或手机资源不足。照片已保留，可手动重试。'});progressPanel.querySelector('strong').textContent='发现未完成的记忆';$('generation-bar').hidden=true;$('generation-retry').hidden=false;$('generation-cancel').textContent='关闭';}}boot().catch(e=>{notice(e.message);sidebar(true);});

import('../mobile-ui.js?v=usability-20260916');

function readTicket(){return normalizeTicket({city:$('ticket-city').value,venue:$('ticket-venue').value,date:$('ticket-date').value});}
function restoreTicket(value){const t=normalizeTicket(value);$('ticket-city').value=t.city;$('ticket-venue').value=t.venue;$('ticket-date').value=t.date;window.dispatchEvent(new Event('ticket-restored'));}
function storageStatus(r){return !r.model?'正在查看示例':dirtyIds.has(r.id)?'修改尚未保存，请立即导出':savedIds.has(r.id)?'已保存到当前浏览器':'已生成，但尚未保存，请立即导出';}
let ticketQueue=Promise.resolve();
for(const id of ['ticket-city','ticket-venue','ticket-date'])$(id).addEventListener('input',()=>{if(!current||busy)return;const record=current;record.ticket=readTicket();record.exported_at=null;if(!savedIds.has(record.id))return;dirtyIds.add(record.id);const snapshot={...record};ticketQueue=ticketQueue.then(async()=>{try{await save(snapshot);if(record.ticket===snapshot.ticket)dirtyIds.delete(record.id);if(current===record)status('票根已保存到当前浏览器');await refresh();}catch{if(current===record){status('票根修改尚未保存，请立即导出');notice('票根保存失败，请导出记忆文件保留修改。');}}});});
$('welcome-example').onclick=()=>example.click();$('welcome-create').onclick=()=>setup();
const previewButton=document.createElement('button');previewButton.textContent='先看示例 · 无需模型';previewButton.type='button';previewButton.onclick=()=>example.click();$('gpu-status').after(previewButton);
const help=document.createElement('p');help.className='backup-help';help.textContent='保存设置：写入当前浏览器。导出备份：下载包含照片、3D 数据和票根的 .still 文件，可在其他设备打开。';$('memory-actions').append(help);
const manage=document.createElement('div');manage.className='memory-management';manage.innerHTML='<button id="rename-memory">重命名</button><button id="delete-memory">删除记忆</button>';$('memory-actions').append(manage);
$('rename-memory').onclick=async()=>{if(!current||busy)return;await ticketQueue;const record=current,name=prompt('记忆名称',record.name);if(!name?.trim())return;record.name=name.trim().slice(0,60);record.exported_at=null;dirtyIds.add(record.id);try{if(record.model){await save(record);savedIds.add(record.id);dirtyIds.delete(record.id);}if(current===record)$('memory-name').textContent=record.name;await refresh();}catch{status('修改尚未保存，请立即导出');notice('重命名未保存，请导出备份。');}};
$('delete-memory').onclick=async()=>{if(!current||busy)return;const record=current;if(!savedIds.has(record.id)){notice('这段记忆没有保存在收藏库。');return;}if(!confirm('删除「'+record.name+'」？只删除当前浏览器中的记忆，无法撤销。请先确认导出文件已下载。'))return;try{await ticketQueue;await remove(record.id);savedIds.delete(record.id);if(current===record){current=null;$('current-memory').hidden=true;memoryBox.cancelCreation();status('已从当前浏览器删除');example.click();}await refresh();}catch(e){notice('删除失败：'+e.message);}};
const grid=document.createElement('div');grid.className='memory-grid';$('library-section').append(grid);const storage=document.createElement('p');storage.id='storage-summary';grid.after(storage);let thumbnails=[];
function renderLibrary(){thumbnails.forEach(URL.revokeObjectURL);thumbnails=[];grid.replaceChildren();let bytes=0;for(const r of records){bytes+=r.bytes||0;const b=document.createElement('button');b.className='memory-card';b.disabled=busy;b.setAttribute('aria-pressed',String(current?.id===r.id));if(r.photo){const img=document.createElement('img');img.alt='';img.src=URL.createObjectURL(r.photo);thumbnails.push(img.src);b.append(img);}const label=document.createElement('span');label.textContent=r.name+'\n'+[r.ticket?.city,r.ticket?.date].filter(Boolean).join(' · ')+'\n'+(r.exported_at?'已发起导出（请确认下载）':'尚未导出备份');b.append(label);b.onclick=async()=>{if(busy)return;await ticketQueue;try{const record=await get(r.id);if(record){await show(record);renderLibrary();}}catch(e){notice(e.message);}};grid.append(b);}storage.textContent='记忆数据约 '+(bytes/1048576).toFixed(1)+' MB（不含模型缓存）';}
const hint=$('view-hint');try{if(localStorage.getItem('palinode-gesture-seen'))hint.classList.add('dismissed');}catch{}$('stage').addEventListener('pointerdown',()=>{setTimeout(()=>hint.classList.add('dismissed'),1800);try{localStorage.setItem('palinode-gesture-seen','1');}catch{}},{once:true});

