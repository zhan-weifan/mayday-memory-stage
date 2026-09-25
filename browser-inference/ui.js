import {preparePhoto} from './photo.js?v=lite-1';
import {DEFAULT_LITE_BASE,normalizeModelBase,checkModelSource} from './model-source.js?v=usability-20260916-2';
import {inspectDesktopCache,requestDesktopPersistence} from './download.js?v=desktop-cache-20260916';
import {memoryBox} from '../viewer-loader.js?v=low-performance-20260925-2';
import {normalizeSettings} from '../settings.js';
import {FILES} from './mobile-model.js';
import {save,list,get,draft,pack,unpack,remove,normalizeTicket,patchMetadata,modelSize} from './library.js';
import {sidebar,markWelcomed} from '../ui-shell.js';
import {constrainedDevice,displayPolicy,executionCapabilities} from '../device-capabilities.js';
import {createTicketSaver} from './ticket-save.js';
const $=id=>document.getElementById(id);let selectionEpoch=0;let records=[],current=null,worker=null,busy=false,starting=false,epoch=0,urls=[],operation=null,cancelJob=null,watchdog=null,previousMemoryId=null;
let mobile=constrainedDevice();
let workerURL=new URL(mobile?'./mobile-worker.js?v=low-performance-20260925-2':'./worker.js?v=decode-1',import.meta.url);
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
const restorationPhases={card:0,projecting:1,generating:2,revealing:3,complete:4};
function updateRestorationStep(){
 const story=$('restoration-story');if(!story||story.hidden)return;
 const index=restorationPhases[$('stage').dataset.creation];if(index===undefined)return;
 [...$('restoration-steps').children].forEach((step,i)=>{step.dataset.state=i<index?'done':i===index?'active':'upcoming';if(i===index)step.setAttribute('aria-current','step');else step.removeAttribute('aria-current');});
}
function renderRestorationStory(restoration){
 const story=$('restoration-story');if(!story)return;
 story.hidden=!restoration;
 if(!restoration)return;
 $('restoration-eyebrow').textContent=restoration.eyebrow;
 $('restoration-title').textContent=restoration.title;
 $('restoration-caption').textContent=restoration.caption;
 $('restoration-steps').replaceChildren(...restoration.steps.map((label,index)=>{const item=document.createElement('li');item.textContent=label;item.dataset.state=index?'upcoming':'active';if(!index)item.setAttribute('aria-current','step');return item;}));
 updateRestorationStep();
}
new MutationObserver(updateRestorationStep).observe($('stage'),{attributes:true,attributeFilter:['data-creation']});
const idbSaveFailureNames=new Set(['AbortError','ConstraintError','DataError','InvalidStateError','ReadOnlyError','TransactionInactiveError','VersionError']);
function saveFailureMessage(error){
 if(error?.name==='QuotaExceededError')return '浏览器报告本机存储空间不足，无法保存到记忆库。';
 if(idbSaveFailureNames.has(error?.name)||error?.message==='本机存储写入失败')return '本机记忆库写入事务失败，无法确认已保存。';
 return '本机保存失败，具体原因无法确认。';
}
function unsavedViewMessage(result){
 if(result?.state==='displayed')return '3D 已在当前页面打开，但这份记忆未保存到本机；请立即导出 .still 文件备份。';
 if(result?.state==='over-budget')return '模型超过当前设备的保守显示预算，未启动 3D；文件仅在当前页面中，请立即导出 .still 文件备份。';
 if(result?.state==='render-error')return `当前设备无法显示 3D（${result.reason||'原因未确认'}）；原文件仅在当前页面中，请立即导出 .still 文件备份。`;
 return '当前页面未能确认 3D 显示状态；请立即导出 .still 文件备份，再关闭页面。';
}
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
function lock(on){busy=on;$('library').disabled=on;$('replay-creation').disabled=on;$('choose-photo').textContent=on?'取消制作':'＋ 新建记忆';$('import-memory').disabled=on;$('view-example').disabled=on;for(const id of ['welcome-example','welcome-create','ticket-city','ticket-venue','ticket-date','save-settings','download-memory','rename-memory','delete-memory']){const el=$(id);if(el)el.disabled=on;}document.querySelectorAll('.memory-card').forEach(b=>b.disabled=on);}
function stop(){draft(null).catch(()=>{});progressPanel.hidden=true;retryPhoto=null;epoch++;operation=null;cancelJob?.(Error('已取消'));cancelJob=null;clearTimeout(watchdog);watchdog=null;worker?.terminate();worker=null;memoryBox.setComputeOnly(false);memoryBox.setInferencePaused(false);memoryBox.setComputing(false);memoryBox.cancelCreation();lock(false);status('制作已取消 · 已有记忆保留');notice('制作已取消，已有记忆保留。');}
function status(text){$('job-message').textContent=text;$('connection').textContent=text;}
async function refresh(){try{records=await list();records.forEach(r=>savedIds.add(r.id));}catch{notice('浏览器存储不可用，生成后请立即导出记忆。');}const select=$('library');select.replaceChildren();const placeholder=new Option('选择一份记忆…','');select.append(placeholder);for(const r of records){const o=document.createElement('option');o.value=r.id;o.textContent=r.name;select.append(o);}$('library-section').hidden=!records.length;$('memory-count').textContent=records.length;if(current)select.value=current.id;renderLibrary();}
async function show(record,reveal=false){
 await flushPendingTicketSave();
 memoryBox.setRecordSettings(record.settings);
 const token=++epoch;if(!reveal)memoryBox.cancelCreation();current=record;restoreTicket(record.ticket);document.querySelector('.first-visit').hidden=true;renderRestorationStory(record.restoration);if(record.restoration)document.querySelector('.scene-heading h2').textContent=record.name;
 urls.forEach(URL.revokeObjectURL);urls=[];
 const photo=record.photo?URL.createObjectURL(record.photo):record.photo_url,model=record.model?URL.createObjectURL(new Blob([record.model])):record.model_url;if(record.photo)urls.push(photo);if(record.model)urls.push(model);
 $('current-memory').hidden=false;$('photo-preview').src=photo;$('memory-name').textContent=record.name;$('memory-date').textContent=new Date(record.created_at).toLocaleDateString('zh-CN');$('steps').hidden=true;$('retry').hidden=true;$('memory-actions').hidden=false;$('download-memory').hidden=!record.model;$('save-settings').textContent='保存设置到本机';$('library').value=record.id;for(const id of ['rename-memory','delete-memory'])$(id).hidden=!record.model;
 markWelcomed();
 if(record.model&&!displayPolicy(modelSize(record.model)).allowed){memoryBox.releaseLoadedMemory();status(storageStatus(record));notice('文件已打开；模型超过当前设备的保守显示预算，暂不启动 3D。'+(savedIds.has(record.id)?'原始数据保留，可收藏和导出备份。':'这份记忆尚未保存到本机，请立即导出备份。')+'此预算仍需真机验证。');renderLibrary();return {state:'over-budget'};}
 status('正在打开这段记忆…');try{await memoryBox.load(model,record.settings,reveal);if(token!==epoch)return {state:'superseded'};status(storageStatus(record));renderLibrary();return {state:'displayed'};}catch(e){if(token===epoch){memoryBox.releaseLoadedMemory();status(storageStatus(record));notice('当前设备无法显示 3D：'+e.message+(savedIds.has(record.id)?'。仍可查看原图、管理收藏和导出备份。':'。这份记忆尚未保存到本机，仍可查看原图并导出备份。'));sidebar(true);}return {state:'render-error',reason:e?.message};}

}
const nextAnimationFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
async function prepareMobileForNewCreation(){
 if(!mobile)return null;
 // Starting a new memory intentionally replaces the current one on mobile.
 // Do not block on whether the previous result was saved or exported.
 const discardedId=current?.model&&savedIds.has(current.id)?current.id:null;
 previousMemoryId=null;
 urls.forEach(URL.revokeObjectURL);urls=[];$('photo-preview')?.removeAttribute('src');
 memoryBox.releaseLoadedMemory();
 if(worker||operation){clearTimeout(watchdog);watchdog=null;worker?.terminate();worker=null;cancelJob?.(Error('旧制作已结束'));cancelJob=null;operation=null;}
 memoryBox.setComputeOnly(false);memoryBox.setInferencePaused(false);memoryBox.setComputing(false);
 current=null;$('current-memory').hidden=true;$('library').value='';
 retryPhoto=null;void draft(null).catch(()=>{});
 if(discardedId){savedIds.delete(discardedId);dirtyIds.delete(discardedId);void remove(discardedId).catch(()=>{});}
 // iOS Safari can suspend requestAnimationFrame while a modal file picker/dialog
 // is active. The renderer cleanup above is synchronous, so do not wait on frames
 // before allowing the next generation to start.
 await Promise.resolve();return previousMemoryId;
}
async function restorePreviousMemory(id){
 if(!id)return;
 await nextAnimationFrame();
 try{const record=await get(id);if(record){await show(record);status('已恢复上一份记忆，可继续新建。');}else await refresh();}
 catch{notice('上一份记忆恢复失败，请从收藏库重新打开。');await refresh().catch(()=>{});}
 if(previousMemoryId===id)previousMemoryId=null;
}
const dialog=document.createElement('dialog');dialog.className='local-generation';dialog.innerHTML=`<form method="dialog"><button class="dialog-close" aria-label="关闭制作说明">×</button></form><p class="eyebrow">MADE ON YOUR DEVICE</p><h2>在这里，留住一刻。</h2><p id="model-description">照片与生成过程留在你的设备。首次需下载约 1.31 GB 模型，优先镜像线路，失败自动切换；之后优先使用本机缓存。</p><aside id="mobile-generation-advice" hidden style="margin:18px 0;padding:14px 16px;background:#edf0e8;border-radius:10px;font-size:13px;line-height:1.7"><strong>制作前的小提醒</strong><br>手机建议使用 Google Chrome 浏览器。<br>想获得更好的效果，优先使用电脑版：电脑版使用完整模型，画面细节更丰富；手机版使用轻量模型。</aside><p id="gpu-status" role="status">正在检测设备…</p><button id="local-select" class="primary" disabled>选择照片并制作</button><button id="local-example" disabled>用示例风景试一试 ↗</button><small id="generation-explanation">请保持页面打开。生成会占用本机 GPU 和内存；关闭页面会停止制作。<br>本机保存可能被浏览器清理，重要记忆请导出备份。</small><p id="storage-status" role="status" aria-live="polite" hidden style="font-size:13px;line-height:1.7;margin:12px 0">正在读取浏览器可用存储额度估算…</p><details><summary>模型与缓存</summary><p>SHARP 的浏览器格式转换版本，用于非商业研究实验。<a href="./browser-inference/licenses/APPLE-SHARP.txt" target="_blank" rel="noopener">模型许可</a> · <a href="./browser-inference/licenses/NOTICE.txt" target="_blank" rel="noopener">来源与修改说明</a></p><button id="clear-model">清除本机模型缓存</button></details>`;document.body.append(dialog);const lowPerformanceSection=document.createElement('section');lowPerformanceSection.id='low-performance-mode-section';lowPerformanceSection.hidden=true;
lowPerformanceSection.style.cssText='margin:14px 0;padding:12px 14px;border:1px solid #d8ded9;border-radius:10px;line-height:1.6';
lowPerformanceSection.innerHTML='<label style="display:flex;align-items:center;gap:8px;min-height:44px"><input id="low-performance-mode" type="checkbox" role="switch" aria-describedby="low-performance-help">低性能模式</label><small id="low-performance-help">开启后先完成记忆计算再播放动效，使用标准模型初始化，并将舞台画质切到省电。生成可能更慢，仍受手机和浏览器资源限制。关闭后恢复常规制作和原画质。</small>';
$('local-select').before(lowPerformanceSection);
const lowPerformanceToggle=$('low-performance-mode');
const lowPerformanceQualityKey='still-low-performance-previous-quality';
const validRenderQuality=value=>['battery','smooth','high'].includes(value);
function preferredRenderQuality(){try{const saved=localStorage.getItem('palinode-quality');if(validRenderQuality(saved))return saved;}catch{}const select=$('render-quality');return window.__prismatic?.ready&&validRenderQuality(select?.value)?select.value:mobile?'smooth':'high';}
function setLowPerformanceMode(enabled,rememberQuality=false){
 const select=$('render-quality');
 if(enabled){
  if(rememberQuality){try{localStorage.setItem(lowPerformanceQualityKey,preferredRenderQuality());}catch{}}
  try{localStorage.setItem('still-low-performance-mode','1');localStorage.setItem('palinode-quality','battery');}catch{}
  lowPerformanceToggle.checked=true;
  if(select){select.value='battery';select.disabled=true;select.dispatchEvent(new Event('change',{bubbles:true}));}
  return;
 }
 let restored=mobile?'smooth':'high';
 try{const previous=localStorage.getItem(lowPerformanceQualityKey);if(validRenderQuality(previous))restored=previous;localStorage.setItem('still-low-performance-mode','0');localStorage.setItem('palinode-quality',restored);localStorage.removeItem(lowPerformanceQualityKey);}catch{}
 lowPerformanceToggle.checked=false;
 if(select){select.disabled=false;select.value=restored;select.dispatchEvent(new Event('change',{bubbles:true}));}
}
try{lowPerformanceToggle.checked=localStorage.getItem('still-low-performance-mode')==='1';}catch{}
if(lowPerformanceToggle.checked)setLowPerformanceMode(true);
lowPerformanceToggle.addEventListener('change',()=>setLowPerformanceMode(lowPerformanceToggle.checked,true));
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
 if(busy||modelImport)return;
 sidebar(false);if(!dialog.open)dialog.showModal();deviceReady=false;desktopStorageReady=false;readyControls();$('gpu-status').textContent='正在检测运行能力…';
 const capabilities=await executionCapabilities();
 mobile=constrainedDevice()||!capabilities.fp16;
 workerURL=new URL(mobile?'./mobile-worker.js?v=low-performance-20260925-2':'./worker.js?v=decode-1',import.meta.url);
 modelSection.hidden=!mobile;
 lowPerformanceSection.hidden=!mobile;
 if(mobile){$('model-description').textContent='本机使用 Lite 模型，首次约 '+mobileModelSize+'。下载和校验成功不代表设备一定能完成运行。';$('generation-explanation').textContent='请保持页面打开。执行结果取决于浏览器运行能力和可用资源；重要记忆请导出备份。';}
 if(!capabilities.worker||!capabilities.wasm){if(!dialog.open)dialog.showModal();$('gpu-status').textContent='当前浏览器无法执行本机模型；仍可导入和管理记忆文件。';return;}
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
async function loadExample(){
 const url=new URL('../memory.json',import.meta.url);
 const response=await fetch(url,{cache:'no-cache'});
 if(!response.ok)throw Error('示例信息未能加载，请重试。');
 const record=await response.json();
 record.photo_url=new URL(record.photo_url,url).href;
 record.model_url=new URL(record.model_url,url).href;
 return record;
}
$('local-example').onclick=async()=>{try{const meta=await loadExample();const response=await fetch(meta.photo_url);if(!response.ok)throw Error('示例照片未能加载');const blob=await response.blob();dialog.close();await create(new File([blob],`${meta.name}.png`,{type:blob.type}));}catch(e){$('gpu-status').textContent=e.message;notice(e.message);if(!dialog.open)sidebar(true);}};
$('clear-model').onclick=async()=>{if(modelImport||busy)return;try{const root=await navigator.storage.getDirectory();for await(const name of root.keys())if(name.startsWith('still-sharp-'))await root.removeEntry(name,{recursive:true});$('gpu-status').textContent='模型缓存与 ready 标记已清除';if(!mobile){desktopStorageReady=false;$('storage-status').hidden=false;$('storage-status').textContent='模型位置：当前浏览器的网站数据。保存状态：未安装；下次制作前会重新检查并保存完整模型。';readyControls();}void updateStorageStatus();if(mobile){mobileReady=false;mobileModelFile=null;sourceReady=false;await verifySource();}}catch{$('gpu-status').textContent='当前浏览器无法清除缓存';}};
async function create(file){
 if(busy||starting||modelImport)return;if(!file)return;
 const photoError=!['image/jpeg','image/png','image/webp'].includes(file.type)?'请选择 JPG、PNG 或 WebP 照片；HEIC 照片请先转换为 JPG。':file.size>25*1024*1024?'照片不能超过 25 MB':null;
 if(photoError){$('gpu-status').textContent=photoError;notice(photoError);if(!dialog.open)sidebar(true);return;}
 starting=true;
 $('local-select').disabled=$('local-example').disabled=true;
 $('gpu-status').textContent='已选择照片，正在准备新记忆…';
 try{
 // Close the preparation dialog before any IndexedDB or renderer work. Keeping
 // it open can suspend Safari's animation loop and hide the real progress panel.
 if(dialog.open)dialog.close();
 // A stalled ticket write must never prevent a new photo from starting. It is
 // flushed in the background and will be retried by the saver if needed.
 void flushPendingTicketSave().catch(()=>{});
 if(mobile&&(!deviceReady||(!mobileReady&&!sourceReady))){await setup();if(!deviceReady||(!mobileReady&&!sourceReady))return;}
  const lowPerformance=mobile&&lowPerformanceToggle.checked;
  const sequentialGeneration=lowPerformance;
  const previousId=mobile?await prepareMobileForNewCreation():null;if(previousId===false)return;
  dialog.close();notice();sidebar(false);lock(true);retryPhoto=file;progressPanel.querySelector('strong').textContent='正在制作记忆';$('generation-bar').hidden=false;$('generation-retry').hidden=true;$('generation-cancel').textContent='取消';updateProgress({text:'正在启动本机任务…'});if(sequentialGeneration)memoryBox.setComputeOnly(true);memoryBox.setComputing(true);const token=++epoch,op={};operation=op;
 let arrived=false,lastStatus='正在准备本机模型';
 let arrival;
 let runningWorker,completed=false;
 try{
 updateProgress({text:'正在保存照片草稿…'});try{await draft({photo:file,name:file.name,ticket:readTicket(),started_at:Date.now()});}catch{notice('无法保存制作草稿，页面关闭后需重新选择照片。');}if(operation!==op)return;
 const prepared=await preparePhoto(file,mobile?256:1536);if(operation!==op)return;
  if(!sequentialGeneration)arrival=Promise.resolve().then(()=>memoryBox.beginCreation(file,file.name.replace(/\.[^.]+$/,''))).then(()=>{arrived=true;if(token===epoch)memoryBox.waiting(lastStatus);});
 runningWorker=new Worker(workerURL,{type:'module'});worker=runningWorker;
  const result=new Promise((resolve,reject)=>{cancelJob=reject;const arm=(ms,text)=>{clearTimeout(watchdog);watchdog=setTimeout(()=>reject(Error(text)),ms);};arm(30000,'本机任务没有启动响应，请更新浏览器并刷新重试');runningWorker.onmessage=({data})=>{if(token!==epoch)return;if(data.type==='status'){if(!sequentialGeneration&&['initializing','inference','packing'].includes(data.phase))memoryBox.setInferencePaused(true);arm(['initializing','inference'].includes(data.phase)?(mobile?900000:300000):60000,'当前步骤长时间没有响应：'+data.text+'。请重试；若再次失败，请提供手机型号和浏览器。');lastStatus=data.text;updateProgress(data);status(data.text);if(arrived)memoryBox.waiting(data.text);}else if(data.type==='complete')resolve(data.buffer);else if(data.type==='error')reject(Error(data.text));};runningWorker.onerror=()=>reject(Error('后台任务意外中断，原因尚无法确认。已有记忆仍可管理。'));});
 runningWorker.postMessage({prepared,...(mobile?{file:mobileModelFile,modelBase}:{})},[prepared.pixels.buffer]);
  const buffer=await result;runningWorker.terminate();worker=null;if(!sequentialGeneration)memoryBox.setInferencePaused(false);void requestPersistentStorage();if(token!==epoch)return;
 const record={id:crypto.randomUUID(),name:file.name.replace(/\.[^.]+$/,'').slice(0,60)||'一段记忆',created_at:new Date().toISOString(),photo:file,model:buffer,settings:{designVersion:2,depthVolume:1},ticket:readTicket()};
 let saveError=null;try{await save(record);savedIds.add(record.id);void requestPersistentStorage();}catch(e){saveError=e;}
  await draft(null).catch(()=>{});progressPanel.hidden=true;retryPhoto=null;await refresh();completed=true;let displayResult;
  if(sequentialGeneration){memoryBox.setComputing(false);memoryBox.setComputeOnly(false);status('记忆文件已生成，正在播放还原动效…');let resolveCardReady,rejectCardReady;const cardReady=new Promise((resolve,reject)=>{resolveCardReady=resolve;rejectCardReady=reject;});const entrance=memoryBox.beginCreation(file,record.name,resolveCardReady).catch(rejectCardReady);await Promise.race([cardReady,entrance.then(()=>{throw Error('还原动效已取消');})]);displayResult=await show(record,true);await entrance;}
  else displayResult=await show(record,true);
  if(saveError)notice(`${saveFailureMessage(saveError)} ${unsavedViewMessage(displayResult)}`);previousMemoryId=null;
 }catch(e){if(operation===op){updateProgress({text:'制作未完成：'+e.message});progressPanel.querySelector('strong').textContent='制作已暂停';$('generation-bar').hidden=true;$('generation-detail').textContent='照片未上传 · 请根据上方原因重试';$('generation-retry').hidden=false;$('generation-cancel').textContent='关闭';notice('制作未完成：'+e.message);status('照片没有上传，可重试或换一台设备。');sidebar(true);}}
 finally{
  const ownsOperation=operation===op;
  const ownsWorker=worker===runningWorker;
  if(ownsOperation||ownsWorker||!operation){
   clearTimeout(watchdog);watchdog=null;
   runningWorker?.terminate();
   if(ownsWorker)worker=null;
    memoryBox.setComputeOnly(false);memoryBox.setInferencePaused(false);memoryBox.setComputing(false);
   if(!completed)memoryBox.cancelCreation();
  }
  if(ownsOperation||!operation){operation=null;cancelJob=null;lock(false);}
  else if(ownsWorker)worker=null;
 }
 if(previousId&&!completed&&!operation){lock(true);try{await restorePreviousMemory(previousId);}finally{lock(false);}}
 }catch(e){
  const message='新记忆未能启动：'+(e?.message||String(e));
  $('gpu-status').textContent=message;notice(message);status(message);
  if(!dialog.open)sidebar(true);
  if(!operation){lock(false);progressPanel.hidden=true;}
 }finally{starting=false;readyControls();}
}
$('choose-photo').onclick=()=>busy?stop():setup();$('photo-input').onchange=e=>{const file=e.target.files[0];e.target.value='';void create(file);};
const importButton=document.createElement('button');importButton.id='import-memory';importButton.textContent='打开记忆文件';importButton.className='quiet';$('creation').append(importButton);const input=document.createElement('input');input.type='file';input.accept='.still';input.hidden=true;document.body.append(input);importButton.onclick=()=>input.click();input.onchange=async()=>{if(!input.files[0]||busy)return;selectionEpoch++;lock(true);$('choose-photo').disabled=true;try{await flushPendingTicketSave();const r=await unpack(input.files[0]);let saveError=null;try{await save(r);savedIds.add(r.id);void requestPersistentStorage();}catch(e){saveError=e;}await refresh();const displayResult=await show(r);if(saveError)notice(`${saveFailureMessage(saveError)} ${unsavedViewMessage(displayResult)}`);}catch(e){notice(e.message);sidebar(true);}finally{input.value='';$('choose-photo').disabled=false;lock(false);}};
$('library').onchange=()=>openSaved($('library').value);
$('save-settings').onclick=async()=>{if(!current||busy)return;const record=current,settings=memoryBox.getSettings();await flushPendingTicketSave();record.settings=settings;record.exported_at=null;try{if(record.model){dirtyIds.add(record.id);await persistCurrent(record);savedIds.add(record.id);dirtyIds.delete(record.id);if(current===record)status(storageStatus(record));await refresh();}else localStorage.setItem(`still-demo-settings-${record.id}`,JSON.stringify(record.settings));notice('设置已保存在这台设备。');}catch(e){if(current===record)status('修改尚未保存，请立即导出');notice('保存失败：'+e.message);}};
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
$('download-memory').textContent='导出记忆文件 ↓';$('download-memory').onclick=async()=>{if(busy||!current)return;const record=current,settings=memoryBox.getSettings();try{await flushPendingTicketSave();}catch{notice('本机写入未完成，将导出包含当前修改的备份。');}if(record?.model){record.settings=settings;download(pack(record),`${record.name.replace(/[\\/:*?"<>|]/g,'_')}.still`);record.exported_at=new Date().toISOString();notice('已发起导出，请确认文件已下载后再删除记忆。');if(savedIds.has(record.id)){try{await persistCurrent(record);dirtyIds.delete(record.id);await refresh();}catch{notice('已发起导出，但未能更新本机备份记录，请确认下载文件。');}}}};
$('snapshot').onclick=()=>{try{const a=document.createElement('a');a.href=memoryBox.capture();a.download='still-memory.png';a.click();}catch(e){notice(e.message);}};
$('replay-creation').onclick=async()=>{if(busy||!current)return;lock(true);const r=current,op={};operation=op;try{const photo=r.photo||await(await fetch(r.photo_url)).blob();if(operation!==op)return;await memoryBox.beginCreation(photo,r.name);await new Promise(resolve=>setTimeout(resolve,1200));if(operation===op)await show(r,true);}catch(e){if(operation===op){memoryBox.cancelCreation();notice(e.message);}}finally{if(operation===op){operation=null;lock(false);}}};

window.addEventListener('beforeunload',e=>{if(busy||modelImport){e.preventDefault();e.returnValue='';}});
for(const type of ['dragover','drop'])document.addEventListener(type,e=>e.preventDefault());document.addEventListener('drop',e=>{if(!busy){notice('请点击「新建记忆」检查设备后选择照片。');sidebar(true);}});
const example=document.createElement('button');example.id='view-example';example.className='quiet';example.textContent='播放示例还原';$('library-section').before(example);example.onclick=async()=>{if(busy)return;const selection=++selectionEpoch;dialog.close();try{await flushPendingTicketSave();const demo=await loadExample();try{const saved=JSON.parse(localStorage.getItem(`still-demo-settings-${demo.id}`));if(saved)demo.settings=normalizeSettings(saved);}catch{/* Old or corrupt preferences must not block the built-in example. */}if(selection!==selectionEpoch)return;document.querySelector('.first-visit').hidden=true;markWelcomed();renderRestorationStory(demo.restoration);document.querySelector('.scene-heading h2').textContent=demo.name;const response=await fetch(demo.photo_url);if(!response.ok)throw Error('示例照片未能加载，请重试。');const photo=new File([await response.blob()],`${demo.name}.jpg`,{type:'image/jpeg'});await memoryBox.beginCreation(photo,demo.name);if(selection===selectionEpoch){memoryBox.waiting('正在调入预先还原的空间记忆');await show(demo,true);}}catch(e){if(selection===selectionEpoch){notice(e.message);sidebar(true);}}};
async function boot(){document.querySelector('.format-note').textContent='照片留在本机 · JPG / PNG / WebP';$('creation').hidden=false;await refresh();status('等待收藏 · 新建记忆或打开已有记忆');const pending=await draft().catch(()=>null);if(pending?.photo){restoreTicket(pending.ticket);retryPhoto=new File([pending.photo],pending.name||'未完成的记忆.jpg',{type:pending.photo.type});updateProgress({text:'上一次任务未正常完成，可能与页面关闭、浏览器资源限制或其他运行中断有关。照片已保留，可手动重试。'});progressPanel.querySelector('strong').textContent='发现未完成的记忆';$('generation-bar').hidden=true;$('generation-retry').hidden=false;$('generation-cancel').textContent='关闭';}}
export const ready=boot().catch(e=>{notice(e.message);sidebar(true);});

import('../mobile-ui.js?v=repair-v2').catch(e=>notice('手机布局组件未加载：'+e.message+'。可刷新重试。'));
document.addEventListener('storage-notice',e=>notice(e.detail));
document.addEventListener('viewer-retry',()=>{if(current)void show(current).catch(e=>notice(e.message));});

function readTicket(){return normalizeTicket({city:$('ticket-city').value,venue:$('ticket-venue').value,date:$('ticket-date').value});}
function restoreTicket(value){const t=normalizeTicket(value);$('ticket-city').value=t.city;$('ticket-venue').value=t.venue;$('ticket-date').value=t.date;window.dispatchEvent(new Event('ticket-restored'));}
function storageStatus(r){return !r.model?'正在查看示例':dirtyIds.has(r.id)?'修改尚未保存，请立即导出':savedIds.has(r.id)?'已保存到当前浏览器':'已生成，但尚未保存，请立即导出';}
const ticketSaver=createTicketSaver({write:patchMetadata,
 onSaved(id,row){dirtyIds.delete(id);const index=records.findIndex(r=>r.id===id);if(index>=0)records[index]=row;if(current?.id===id)status('票根已保存到当前浏览器');renderLibrary();},
 onError(id){if(current?.id===id){status('票根修改尚未保存，请立即导出');notice('票根保存失败，请导出记忆文件保留修改。');}}
});
export function flushPendingTicketSave(){return ticketSaver.flush();}
for(const id of ['ticket-city','ticket-venue','ticket-date'])$(id).addEventListener('input',()=>{
 if(!current||busy)return;const record=current;record.ticket=readTicket();record.exported_at=null;
 if(!savedIds.has(record.id))return;dirtyIds.add(record.id);ticketSaver.schedule(record.id,{ticket:record.ticket,exported_at:null});
});
window.addEventListener('pagehide',()=>{void flushPendingTicketSave().catch(()=>{});});
document.addEventListener('visibilitychange',()=>{if(document.hidden)void flushPendingTicketSave().catch(()=>{});});
async function persistCurrent(record){
 if(savedIds.has(record.id)){const row=await patchMetadata(record.id,{name:record.name,ticket:record.ticket,settings:record.settings,exported_at:record.exported_at});if(!row)throw Error('这份记忆已在其他操作中删除');}
 else await save(record);
}
$('welcome-example').textContent='播放还原示例';$('welcome-example').onclick=()=>example.click();$('welcome-create').onclick=()=>setup();$('replay-restoration').onclick=()=>example.click();
const previewButton=document.createElement('button');previewButton.textContent='播放还原示例 · 无需模型';previewButton.type='button';previewButton.onclick=()=>example.click();$('gpu-status').after(previewButton);
const help=document.createElement('p');help.className='backup-help';help.textContent='保存设置：写入当前浏览器。导出备份：下载包含照片、3D 数据和票根的 .still 文件，可在其他设备打开。';$('memory-actions').append(help);
const manage=document.createElement('div');manage.className='memory-management';manage.innerHTML='<button id="rename-memory">重命名</button><button id="delete-memory">删除记忆</button>';$('memory-actions').append(manage);
$('rename-memory').onclick=async()=>{if(!current||busy)return;const record=current;await flushPendingTicketSave();const name=prompt('记忆名称',record.name);if(!name?.trim())return;record.name=name.trim().slice(0,60);record.exported_at=null;dirtyIds.add(record.id);try{if(record.model){await persistCurrent(record);savedIds.add(record.id);dirtyIds.delete(record.id);}if(current===record)$('memory-name').textContent=record.name;await refresh();}catch{status('修改尚未保存，请立即导出');notice('重命名未保存，请导出备份。');}};
$('delete-memory').onclick=async()=>{if(!current||busy)return;const record=current;if(!savedIds.has(record.id)){notice('这段记忆没有保存在收藏库。');return;}if(!confirm('删除「'+record.name+'」？只删除当前浏览器中的记忆，无法撤销。请先确认导出文件已下载。'))return;try{ticketSaver.cancel(record.id);await ticketSaver.settled();await remove(record.id);savedIds.delete(record.id);if(current===record){current=null;$('current-memory').hidden=true;memoryBox.cancelCreation();status('已从当前浏览器删除');example.click();}await refresh();}catch(e){ticketSaver.resume(record.id);if(dirtyIds.has(record.id))ticketSaver.schedule(record.id,{ticket:record.ticket,exported_at:record.exported_at});notice('删除失败：'+e.message);}};
const grid=document.createElement('div');grid.className='memory-grid';$('library-section').append(grid);const storage=document.createElement('p');storage.id='storage-summary';grid.after(storage);let thumbnails=[];
function renderLibrary(){thumbnails.forEach(URL.revokeObjectURL);thumbnails=[];grid.replaceChildren();let bytes=0;for(const r of records){bytes+=r.bytes||0;const b=document.createElement('button');b.className='memory-card';b.disabled=busy;b.setAttribute('aria-pressed',String(current?.id===r.id));if(r.thumbnail){const img=document.createElement('img');img.alt='';img.src=URL.createObjectURL(r.thumbnail);thumbnails.push(img.src);b.append(img);}const label=document.createElement('span');label.textContent=r.name+'\n'+[r.ticket?.city,r.ticket?.date].filter(Boolean).join(' · ')+'\n'+(r.exported_at?'已发起导出（请确认下载）':'尚未导出备份');b.append(label);b.onclick=()=>openSaved(r.id);grid.append(b);}storage.textContent='记忆数据约 '+(bytes/1048576).toFixed(1)+' MB（不含模型缓存）';}
const hint=$('view-hint');try{if(localStorage.getItem('palinode-gesture-seen'))hint.classList.add('dismissed');}catch{}$('stage').addEventListener('pointerdown',()=>{setTimeout(()=>hint.classList.add('dismissed'),1800);try{localStorage.setItem('palinode-gesture-seen','1');}catch{}},{once:true});


const photoDialog=document.createElement('dialog');photoDialog.className='local-generation original-photo';
photoDialog.innerHTML='<form method="dialog"><button aria-label="关闭原图">关闭</button></form><img alt="记忆原始照片" style="max-width:100%;height:auto">';document.body.append(photoDialog);
$('photo-preview').tabIndex=0;$('photo-preview').setAttribute('role','button');$('photo-preview').setAttribute('aria-label','打开原始照片');
function openOriginal(){photoDialog.querySelector('img').src=$('photo-preview').src;photoDialog.showModal();}
$('photo-preview').onclick=openOriginal;$('photo-preview').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openOriginal();}};

// Report rejected UI actions without leaving unhandled promise rejections.
for(const id of ['library','save-settings','download-memory','rename-memory','delete-memory','welcome-example','welcome-create','choose-photo']){
 const node=$(id),property=id==='library'?'onchange':'onclick',handler=node[property];
 if(handler)node[property]=event=>{try{Promise.resolve(handler.call(node,event)).catch(error=>notice(error.message));}catch(error){notice(error.message);}};
}

async function openSaved(id){
 if(busy||!id)return;const selection=++selectionEpoch;
 try{await flushPendingTicketSave();const record=await get(id);if(selection!==selectionEpoch)return;if(record){await show(record);renderLibrary();}else{notice('这份记忆已不存在，请刷新收藏库。');await refresh();}}catch(error){notice(error.message);}
}
