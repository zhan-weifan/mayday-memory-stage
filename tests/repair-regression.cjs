// Run with PLAYWRIGHT_MODULE pointing at an installed Playwright package.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=process.env.TEST_URL||'http://127.0.0.1:8768';
const results=[];
async function test(name,run){try{const detail=await run();results.push({name,status:'passed',detail});console.log('PASS '+name);}catch(error){results.push({name,status:'failed',error:error.stack});console.error('FAIL '+name+': '+error.message);}}
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 async function isolated(options={},init){const context=await browser.newContext(options);if(init)await context.addInitScript(init);const page=await context.newPage();page.setDefaultTimeout(15000);return {context,page};}
 try{
 await test('still-format / legacy compatibility / bounded header reads',async()=>{
  const {context,page}=await isolated();try{
   await page.route('**/test-harness',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated repair test</title>'}));await page.goto(base+'/test-harness');
   return await page.evaluate(async()=>{
    const {pack,unpack,inspectStill}=await import('/browser-inference/still-format.js');const {normalizeSettings}=await import('/settings.js');
    const check=(ok,message)=>{if(!ok)throw Error(message);};
    const photo=await (await fetch('/demo.png')).blob(),model=new Float32Array(1600).buffer;
    const record={id:'old',name:'旧版记忆',created_at:'2020-01-01',photo,model,ticket:{city:'上海'},settings:{}};
    const file=pack(record),copy=await unpack(file);check(copy.model instanceof Blob,'model must remain Blob');check(copy.model.size===6400&&copy.ticket.city==='上海','round trip');
    const make=meta=>{const json=new TextEncoder().encode(JSON.stringify({photoBytes:photo.size,modelBytes:6400,photoType:photo.type,...meta}));return new Blob([new Uint32Array([0x4c4c5453,1,json.length]),json,photo,model]);};
    const legacy=await unpack(make({settings:{designVersion:1}}));check(legacy.settings.contentScale===.65,'legacy defaults');
    for(const settings of [{zoom:'2'},{glow:NaN},{contentScale:2},{elevation:0},{designVersion:99},{fit:'stretch'},[],null]){let rejected=false;try{normalizeSettings(settings);}catch{rejected=true;}check(rejected,'invalid settings accepted: '+JSON.stringify(settings));}
    let bad=false;try{await unpack(new Blob(['bad']));}catch{bad=true;}check(bad,'bad header');
    const nonFinite=new Float32Array(1600);nonFinite[5]=Infinity;let invalid=false;try{await unpack(pack({...record,model:nonFinite.buffer}));}catch{invalid=true;}check(invalid,'nonfinite model accepted');
    const reads=[],largeBytes=100*1024*1024,json=new TextEncoder().encode(JSON.stringify({photoBytes:10,modelBytes:largeBytes,settings:{}}));
    class Probe extends Blob{get size(){return 12+json.length+10+largeBytes;}arrayBuffer(){throw Error('Full-file read attempted');}slice(a,b){reads.push([a,b]);if(a===0)return new Blob([new Uint32Array([0x4c4c5453,1,json.length])]);if(a===12)return new Blob([json]);throw Error('Payload read during preflight');}}
    const header=await inspectStill(new Probe());check(reads.length===2&&reads[0][1]===12,'unbounded preflight');check(header.display.count===largeBytes/64,'count');
    return {roundTrip:true,legacyDefaults:true,invalidCases:10,preflightReads:reads};
   });
  }finally{await context.close();}
 });
 await test('legacy library index / metadata-only edits / atomic deletion',async()=>{
  const {context,page}=await isolated();try{
   await page.route('**/test-harness',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated DB test</title>'}));await page.goto(base+'/test-harness');
   return await page.evaluate(async()=>{
    const check=(v,m)=>{if(!v)throw Error(m);};const photo=await(await fetch('/demo.png')).blob();
    const legacy={id:'legacy',name:'原收藏',created_at:'2020',photo,model:new Float32Array(1600).buffer,ticket:{city:'旧城市'},settings:{}};
    await new Promise((resolve,reject)=>{const r=indexedDB.open('still-local-memories',2);r.onupgradeneeded=()=>{r.result.createObjectStore('memories',{keyPath:'id'});r.result.createObjectStore('drafts');};r.onsuccess=()=>{const d=r.result,tx=d.transaction('memories','readwrite');tx.objectStore('memories').put(legacy);tx.oncomplete=()=>{d.close();resolve();};tx.onerror=()=>reject(tx.error);};});
    const lib=await import('/browser-inference/library.js'),{createTicketSaver}=await import('/browser-inference/ticket-save.js');
    const first=await lib.list();check(first[0].name==='原收藏'&&!('photo'in first[0])&&!('model'in first[0]),'legacy summary');
    let heavyReads=0;for(const method of ['get','openCursor','getAll']){const original=IDBObjectStore.prototype[method];IDBObjectStore.prototype[method]=function(...args){if(this.name==='memories')heavyReads++;return original.apply(this,args);};}
    await lib.draft({name:'pending-draft'});await lib.list();await lib.patchMetadata('legacy',{ticket:{city:'新城市'}});await lib.list();check(heavyReads===0,'lists or edits read heavy records');
    const opened=await lib.get('legacy');check(opened.ticket.city==='新城市'&&opened.model.byteLength===6400,'overlay read');check(opened.thumbnail instanceof Blob&&opened.thumbnail.size<photo.size,'thumbnail missing');
    let writes=0;const saver=createTicketSaver({write:async(id,changes)=>{writes++;return lib.patchMetadata(id,changes);},delay:10000});
    saver.schedule('legacy',{ticket:{city:'a'}});saver.schedule('legacy',{ticket:{city:'b'}});await saver.flush();check(writes===1,'debounce did not merge');check((await lib.get('legacy')).ticket.city==='b','latest ticket lost');
    let release,start;const started=new Promise(r=>start=r),gate=new Promise(r=>release=r);
    const late=createTicketSaver({write:async(id,changes)=>{start();await gate;return lib.patchMetadata(id,changes);},delay:10000});late.schedule('legacy',{ticket:{city:'late'}});const flushing=late.flush();await started;late.cancel('legacy');await lib.remove('legacy');release();await flushing;
    check(!await lib.get('legacy'),'deleted record resurrected');let blocked=false;try{await lib.save(legacy);}catch{blocked=true;}check(blocked,'stale full write resurrected');check((await lib.draft()).name==='pending-draft','draft namespace damaged');
    return {legacyRead:true,heavyReadsForListAndEdit:0,thumbnailBytes:opened.thumbnail.size,debouncedWrites:writes,deleteProtected:true};
   });
  }finally{await context.close();}
 });
 await test('thumbnail crops center square without stretching in both image paths',async()=>{
  const {context,page}=await isolated();try{
   await page.route('**/test-harness',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Thumbnail shape test</title>'}));await page.goto(base+'/test-harness');
   const result=await page.evaluate(async()=>{
    const {makeThumbnail}=await import('/browser-inference/thumbnail.js');
    async function make(width,height,shape,fallback=false){
     const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d'),data=ctx.createImageData(width,height);
     for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,n=(x*31+y*17+(x*y)%113)%9;let c=[22+n,145+n,24+n];
      if(shape==='landscape'&&x<50)c=[205+n,25+n,24+n];else if(shape==='landscape'&&x>=width-50)c=[25+n,35+n,205+n];
      if(shape==='portrait'&&y<50)c=[205+n,25+n,24+n];else if(shape==='portrait'&&y>=height-50)c=[25+n,35+n,205+n];
      if(shape==='nearPortrait'&&y<20)c=[205+n,25+n,24+n];else if(shape==='nearPortrait'&&y>=height-20)c=[25+n,35+n,205+n];
      if(shape==='square'){if(x<width/2&&y<height/2)c=[205+n,25+n,24+n];else if(x>=width/2&&y<height/2)c=[22+n,145+n,24+n];else if(x<width/2)c=[25+n,35+n,205+n];else c=[205+n,180+n,20+n];}
      data.data[i]=c[0];data.data[i+1]=c[1];data.data[i+2]=c[2];data.data[i+3]=255;
     }
     ctx.putImageData(data,0,0);const photo=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!photo)throw Error('PNG fixture creation failed');const before=new Uint8Array(await photo.arrayBuffer());let thumbnail;
     if(fallback){const descriptor=Object.getOwnPropertyDescriptor(globalThis,'createImageBitmap');try{globalThis.createImageBitmap=undefined;thumbnail=await makeThumbnail(photo);}finally{if(descriptor)Object.defineProperty(globalThis,'createImageBitmap',descriptor);else delete globalThis.createImageBitmap;}}
     else thumbnail=await makeThumbnail(photo);
     if(!thumbnail)throw Error('thumbnail output missing');const after=new Uint8Array(await photo.arrayBuffer());let unchanged=before.length===after.length;for(let i=0;unchanged&&i<before.length;i++)unchanged=before[i]===after[i];
     const bitmap=await createImageBitmap(thumbnail),out=document.createElement('canvas');out.width=bitmap.width;out.height=bitmap.height;const outCtx=out.getContext('2d');outCtx.drawImage(bitmap,0,0);bitmap.close();
     const pixel=(x,y)=>Array.from(outCtx.getImageData(x,y,1,1).data.slice(0,3));return {input:[width,height],output:[out.width,out.height],inputBytes:photo.size,outputBytes:thumbnail.size,edgeLeft:pixel(2,64),edgeRight:pixel(125,64),cornerTL:pixel(8,8),cornerBR:pixel(119,119),unchanged};
    }
    return {landscape:await make(512,288,'landscape'),portrait:await make(288,512,'portrait'),nearPortrait:await make(300,400,'nearPortrait'),square:await make(300,300,'square'),fallback:await make(512,288,'landscape',true)};
   });
   const green=p=>p[1]>p[0]+40&&p[1]>p[2]+40,red=p=>p[0]>p[1]+60&&p[0]>p[2]+60,blue=p=>p[2]>p[0]+60&&p[2]>p[1]+60,yellow=p=>p[0]>p[2]+60&&p[1]>p[2]+60;
   for(const name of ['landscape','portrait','nearPortrait','fallback']){const x=result[name];assert.deepEqual(x.output,[128,128]);assert.ok(green(x.edgeLeft)&&green(x.edgeRight),name+' did not center-crop while preserving source ratio');assert.ok(x.outputBytes<x.inputBytes,name+' thumbnail is not smaller than source');assert.equal(x.unchanged,true,name+' changed original bytes');}
   assert.deepEqual(result.square.output,[128,128]);assert.ok(red(result.square.cornerTL)&&yellow(result.square.cornerBR),'square image was not preserved');assert.ok(result.square.outputBytes<result.square.inputBytes);assert.equal(result.square.unchanged,true);return {ratios:['16:9','9:16','3:4','1:1'],paths:['createImageBitmap','Image fallback'],sourceUnchanged:true};
  }finally{await context.close();}
 });
 for(const [name,viewport,touch] of [['portrait',{width:390,height:844},true],['landscape',{width:844,height:390},true],['desktop',{width:1365,height:900},false]])await test('layout / focus / export defaults: '+name,async()=>{
  const {context,page}=await isolated({viewport,hasTouch:touch,isMobile:touch});try{
   const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.waitForSelector('#film-quality',{state:'attached'});
   const result=await page.evaluate(()=>({stage:document.querySelector('#stage').getBoundingClientRect().toJSON(),film:document.querySelector('#film-quality').value,webgl:!!window.__prismatic,heads:document.querySelectorAll('.mobile-panel-head').length,scrollWidth:document.documentElement.scrollWidth,width:innerWidth,hint:document.querySelector('#view-hint').textContent}));
   assert.equal(result.webgl,false,'WebGL initialized before demand');assert.equal(result.heads,1);assert.ok(result.stage.height>100);assert.ok(result.scrollWidth<=result.width);
   if(touch){assert.equal(result.film,'720p30');await page.locator('#toggle-sidebar').click();assert.equal(await page.evaluate(()=>document.querySelector('.object-view').inert),true);assert.equal(await page.evaluate(()=>document.querySelector('#memory-panel').contains(document.activeElement)),true);await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.querySelector('#memory-panel').contains(document.activeElement)),true);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'toggle-sidebar');assert.equal(await page.evaluate(()=>document.querySelector('.object-view').inert),false);await page.locator('#toggle-sidebar').click();await page.locator('.mobile-panel-head button').click();assert.equal(await page.locator('#toggle-sidebar').getAttribute('aria-expanded'),'false');}
   else assert.equal(result.film,'1080p60');assert.deepEqual(errors,[]);await page.screenshot({path:path.join(__dirname,'layout-'+name+'.png')});return result;
  }finally{await context.close();}
 });
 await test('WebGL failure / data import / export / ticket flush / retry cleanup',async()=>{
  const {context,page}=await isolated({viewport:{width:390,height:844},hasTouch:true,isMobile:true},()=>{
   window.__blockGL=true;window.__glAttempts=0;const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(String(type).startsWith('webgl')&&window.__blockGL){window.__glAttempts++;return null;}return original.call(this,type,...args);};
  });try{
   const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.waitForSelector('#view-example',{state:'attached'});
   await page.locator('#welcome-example').click();await page.waitForSelector('#app-error');assert.equal(await page.locator('#stage canvas').count(),0);assert.equal(await page.locator('.scene-scroll').count(),0);
   const before=await page.evaluate(()=>window.__glAttempts);await page.locator('#app-error [data-retry]').click();await page.waitForFunction(n=>window.__glAttempts>n,before);assert.equal(await page.locator('.scene-scroll').count(),0);
   await page.evaluate(async()=>{const lib=await import('/browser-inference/library.js');const photo=await(await fetch('/demo.png')).blob();const blob=lib.pack({id:'source',name:'导入测试',created_at:'2020',photo,model:new Float32Array(1600).buffer,settings:{},ticket:{city:'初始'}});const dt=new DataTransfer();dt.items.add(new File([blob],'test.still'));const input=document.querySelector('input[accept=".still"]');input.files=dt.files;input.dispatchEvent(new Event('change'));});
   await page.waitForFunction(()=>document.querySelector('#memory-name').textContent==='导入测试');await page.waitForFunction(()=>document.querySelector('#job-message').textContent.includes('已保存'));
   await page.locator('#ticket-city').fill('立即导出城市');const downloadPromise=page.waitForEvent('download');await page.locator('#download-memory').click();const downloaded=await downloadPromise;assert.ok(downloaded.suggestedFilename().endsWith('.still'));
   assert.equal(await page.evaluate(async()=>{const l=await import('/browser-inference/library.js');const rows=await l.list();return (await l.get(rows[0].id)).ticket.city;}),'立即导出城市');
   await page.locator('#photo-preview').click();await page.waitForSelector('.original-photo[open]');await page.locator('.original-photo button').click();
   page.once('dialog',dialog=>dialog.accept());await page.locator('#ticket-city').fill('删除前未等待');await page.locator('#delete-memory').click();await page.waitForFunction(async()=>!(await(await import('/browser-inference/library.js')).list()).length);
   const remaining=await page.evaluate(async()=>{await new Promise(r=>setTimeout(r,650));return (await(await import('/browser-inference/library.js')).list()).length;});assert.equal(remaining,0);assert.deepEqual(errors,[]);
   return {repeatedInitAttempts:await page.evaluate(()=>window.__glAttempts),dataSavedWithoutWebGL:true,export:true,originalPhoto:true,deleteProtected:true};
  }finally{await context.close();}
 });
 await test('module fetch failure has refresh fallback and working shell',async()=>{
  const {context,page}=await isolated({viewport:{width:390,height:844},hasTouch:true,isMobile:true});try{
   await page.route('**/main.js?v=repair-v2',r=>r.abort());await page.goto(base);await page.waitForSelector('#view-example',{state:'attached'});await page.locator('#welcome-example').click();await page.waitForSelector('#app-error');assert.ok(await page.getByRole('button',{name:'刷新页面重试'}).isVisible());
   await page.keyboard.press('Escape');await page.locator('#toggle-sidebar').click();assert.equal(await page.locator('#toggle-sidebar').getAttribute('aria-expanded'),'true');return {refreshFallback:true,drawer:true};
  }finally{await context.close();}
 });
 await test('viewer business retry succeeds after transient WebGL failure',async()=>{
  const {context,page}=await isolated({viewport:{width:844,height:390},hasTouch:true,isMobile:true},()=>{window.__blockGL=true;const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(String(type).startsWith('webgl')&&window.__blockGL)return null;return original.call(this,type,...args);};});try{
   await page.goto(base);await page.waitForSelector('#view-example',{state:'attached'});await page.locator('#welcome-example').click();await page.waitForSelector('#app-error');await page.evaluate(()=>window.__blockGL=false);
   await page.locator('#app-error [data-retry]').click();await page.waitForFunction(()=>window.__prismatic?.ready,{},{timeout:45000});await page.waitForFunction(()=>document.querySelector('#job-message').textContent.includes('正在查看示例'),{},{timeout:45000});
   assert.equal(await page.locator('#stage canvas').count(),1);assert.equal(await page.locator('.scene-scroll').count(),1);await page.keyboard.press('Escape');await page.waitForTimeout(500);await page.screenshot({path:path.join(__dirname,'viewer-recovered.png')});return {renderer:true,canvases:1,scrollControls:1};
  }finally{await context.close();}
 });
 await test('storage abort is atomic / failed ticket save remains retryable',async()=>{
  const {context,page}=await isolated();try{
   await page.route('**/test-harness',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Storage failure test</title>'}));await page.goto(base+'/test-harness');
   return await page.evaluate(async()=>{
    const check=(v,m)=>{if(!v)throw Error(m);};const lib=await import('/browser-inference/library.js'),{createTicketSaver}=await import('/browser-inference/ticket-save.js');await lib.list();
    const photo=await(await fetch('/demo.png')).blob(),record={id:'atomic',name:'test',created_at:'2020',photo,model:new Float32Array(1600).buffer,settings:{},ticket:{}};
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){if(this.name==='drafts')throw new DOMException('Injected quota failure','QuotaExceededError');return original.apply(this,args);};
    let failed=false;try{await lib.save(record);}catch{failed=true;}finally{IDBObjectStore.prototype.put=original;}
    check(failed,'write should abort');check(!(await lib.list()).length,'half-written summary');check(!await lib.get('atomic'),'half-written source');await lib.save(record);
    let attempts=0;const saver=createTicketSaver({write:(id,changes)=>{if(++attempts===1)throw Error('temporary storage error');return lib.patchMetadata(id,changes);},delay:10000});
    saver.schedule('atomic',{ticket:{city:'重试票根'}});try{await saver.flush();}catch{}await saver.flush();check((await lib.get('atomic')).ticket.city==='重试票根','pending edit lost after failure');
    saver.cancel('atomic');saver.resume('atomic');saver.schedule('atomic',{ticket:{city:'撤销删除失败后'}});await saver.flush();check((await lib.get('atomic')).ticket.city==='撤销删除失败后','save disabled after failed delete');return {atomicAbort:true,retryAttempts:attempts};
   });
  }finally{await context.close();}
 });
 await test('large mobile import preserves original model without starting viewer',async()=>{
  const {context,page}=await isolated({viewport:{width:390,height:844},hasTouch:true,isMobile:true});try{
   await page.goto(base);await page.waitForSelector('#import-memory',{state:'attached'});
   await page.evaluate(async()=>{const lib=await import('/browser-inference/library.js');const photo=await(await fetch('/demo.png')).blob(),model=new Float32Array(65537*16);model[0]=12.5;const blob=lib.pack({id:'large',name:'大记忆',created_at:'2020',photo,model:model.buffer,settings:{},ticket:{}});const dt=new DataTransfer();dt.items.add(new File([blob],'large.still'));const input=document.querySelector('input[accept=".still"]');input.files=dt.files;input.dispatchEvent(new Event('change'));});
   await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('保守显示预算'));
   const result=await page.evaluate(async()=>{const lib=await import('/browser-inference/library.js'),rows=await lib.list(),record=await lib.get(rows[0].id),roundtrip=await lib.unpack(lib.pack(record));return {bytes:lib.modelSize(roundtrip.model),first:new Float32Array(await roundtrip.model.slice(0,4).arrayBuffer())[0],viewer:!!window.__prismatic,thumbnail:!!rows[0].thumbnail};});
   assert.equal(result.bytes,65537*64);assert.equal(result.first,12.5);assert.equal(result.viewer,false);assert.equal(result.thumbnail,true);return result;
  }finally{await context.close();}
 });
 await test('ticket edits stay with their memory during immediate and reordered selection',async()=>{
  const {context,page}=await isolated({viewport:{width:390,height:844},hasTouch:true,isMobile:true},()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(String(type).startsWith('webgl'))return null;return original.call(this,type,...args);};});try{
   await page.route('**/test-harness',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Seed selection test</title>'}));await page.goto(base+'/test-harness');
   await page.evaluate(async()=>{const lib=await import('/browser-inference/library.js'),photo=await(await fetch('/demo.png')).blob();for(const id of ['A','B'])await lib.save({id,name:id,created_at:'2020',photo,model:new Float32Array(1600).buffer,settings:{},ticket:{city:id}});});
   await page.goto(base);await page.waitForSelector('#library option[value="A"]',{state:'attached'});await page.locator('#toggle-sidebar').click();await page.locator('#library').selectOption('A');await page.waitForFunction(()=>document.querySelector('#memory-name').textContent==='A');await page.waitForSelector('#app-error');
   await page.locator('#ticket-city').fill('A的最后一次输入');await page.locator('#library').selectOption('B');await page.waitForFunction(()=>document.querySelector('#memory-name').textContent==='B');
   assert.deepEqual(await page.evaluate(async()=>{const lib=await import('/browser-inference/library.js');return [(await lib.get('A')).ticket.city,(await lib.get('B')).ticket.city];}),['A的最后一次输入','B']);
   await page.evaluate(()=>{const original=IDBObjectStore.prototype.get,descriptor=Object.getOwnPropertyDescriptor(IDBRequest.prototype,'onsuccess');IDBObjectStore.prototype.get=function(id){const request=original.call(this,id);if(this.name==='memories'&&id==='A')Object.defineProperty(request,'onsuccess',{set(handler){descriptor.set.call(request,event=>setTimeout(()=>handler.call(request,event),200));}});return request;};});
   await page.locator('#library').selectOption('A');await page.locator('#library').selectOption('B');await page.waitForTimeout(400);assert.equal(await page.locator('#memory-name').textContent(),'B');return {flushToA:true,reorderedSelection:'B'};
  }finally{await context.close();}
 });
  await test('simulated inference completes and saves with WebGL unavailable',async()=>{
   const {context,page}=await isolated({viewport:{width:390,height:844},hasTouch:true,isMobile:true},()=>{
    const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(String(type).startsWith('webgl'))return null;return original.call(this,type,...args);};
    window.__savedMemoryTransactions=0;const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='memories')this.transaction.addEventListener('complete',()=>window.__savedMemoryTransactions++,{once:true});return put.call(this,value,...args);};
    window.Worker=class{postMessage(data){setTimeout(()=>{if(this.stopped)return;if(data.type==='probe')this.onmessage?.({data:{type:'probe-ready',cached:true}});else this.onmessage?.({data:{type:'complete',buffer:new Float32Array(1600).buffer}});},5);}terminate(){this.stopped=true;}};
   });try{
    await page.goto(base);await page.waitForSelector('#view-example',{state:'attached'});await page.locator('#welcome-create').click();await page.waitForFunction(()=>!document.querySelector('#local-select').disabled);
    await page.locator('#photo-input').setInputFiles(path.join(__dirname,'..','demo.png'));await page.waitForFunction(()=>window.__savedMemoryTransactions===1);await page.waitForFunction(()=>document.querySelector('#memory-name').textContent==='demo');
    const id=await page.evaluate(async()=>{const lib=await import('/browser-inference/library.js'),rows=await lib.list();if(rows.length!==1)throw Error('saved memory missing from list');const record=await lib.get(rows[0].id);if(!record?.photo?.size||lib.modelSize(record.model)!==6400)throw Error('saved photo or model missing');if(await lib.draft())throw Error('completed photo draft was not cleared');return record.id;});
    await page.locator('#ticket-city').fill('无 WebGL 记忆');const downloadPromise=page.waitForEvent('download');await page.locator('#download-memory').click();const download=await downloadPromise;assert.ok(download.suggestedFilename().endsWith('.still'));const stream=await download.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);const exported=Buffer.concat(chunks);assert.ok(exported.length>0);
    const roundtrip=await page.evaluate(async bytes=>{const lib=await import('/browser-inference/library.js'),record=await lib.unpack(new Blob([new Uint8Array(bytes)]));return {id:record.id,name:record.name,photoBytes:record.photo.size,modelBytes:lib.modelSize(record.model),city:record.ticket.city};},Array.from(exported));assert.ok(roundtrip.id);assert.equal(roundtrip.name,'demo');assert.ok(roundtrip.photoBytes>0);assert.equal(roundtrip.modelBytes,6400);assert.equal(roundtrip.city,'无 WebGL 记忆');
    const reopened=await page.evaluate(async memoryId=>{const lib=await import('/browser-inference/library.js'),record=await lib.get(memoryId);return {name:record?.name,photoBytes:record?.photo?.size,modelBytes:lib.modelSize(record?.model),city:record?.ticket?.city};},id);assert.equal(reopened.name,'demo');assert.ok(reopened.photoBytes>0);assert.equal(reopened.modelBytes,6400);assert.equal(reopened.city,'无 WebGL 记忆');assert.equal(await page.locator('#stage canvas').count(),0);
    return {simulatedWorker:true,savedWithoutViewer:true,reopened:true,exportedBytes:exported.length,photoBytes:roundtrip.photoBytes,modelBytes:roundtrip.modelBytes,ticket:roundtrip.city};
  }finally{await context.close();}
 });
 await test('initialization failure after renderer creation cleans up before retry',async()=>{
  const {context,page}=await isolated({viewport:{width:844,height:390},hasTouch:true,isMobile:true});try{
   await page.route('**/studio.js?v=repair-v2',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('export function createStudio(renderer){','export function createStudio(renderer){if(!window.__studioFailed){window.__studioFailed=true;throw Error("Injected studio failure");}')} );});
   await page.goto(base);await page.waitForSelector('#view-example',{state:'attached'});await page.locator('#welcome-example').click();await page.waitForSelector('#app-error');assert.equal(await page.locator('#stage canvas').count(),0);assert.equal(await page.locator('.scene-scroll').count(),0);
   await page.locator('#app-error [data-retry]').click();await page.waitForFunction(()=>window.__prismatic?.ready,{},{timeout:45000});assert.equal(await page.locator('#stage canvas').count(),1);assert.equal(await page.locator('.scene-scroll').count(),1);return {partialCleanup:true,retry:true};
  }finally{await context.close();}
 });
 await test('bootstrap dependency failure exposes a refresh control',async()=>{
  const {context,page}=await isolated();try{await page.route('**/ui-shell.js',r=>r.abort());await page.goto(base);await page.waitForSelector('#app-error');assert.ok(await page.getByRole('button',{name:'刷新页面重试'}).isVisible());return {staticFallback:true};}finally{await context.close();}
 });
 await test('welcome state restores across reloads and storage errors',async()=>{
  const noGL=()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(String(type).startsWith('webgl'))return null;return original.call(this,type,...args);};};
  const {context,page}=await isolated({viewport:{width:390,height:844},hasTouch:true,isMobile:true},noGL);try{
   await page.goto(base);assert.equal(await page.evaluate(()=>document.body.classList.contains('welcome-mode')),true);assert.equal(await page.evaluate(()=>localStorage.getItem('palinode-welcomed')),null);
   await page.locator('#welcome-example').click();await page.waitForSelector('#app-error');assert.equal(await page.evaluate(()=>localStorage.getItem('palinode-welcomed')),'1');assert.equal(await page.evaluate(()=>document.body.classList.contains('welcome-mode')),false);
   await page.reload();await page.waitForSelector('#view-example',{state:'attached'});assert.equal(await page.evaluate(()=>document.body.classList.contains('welcome-mode')),false);
   const reopened=await context.newPage();await reopened.goto(base);assert.equal(await reopened.evaluate(()=>document.body.classList.contains('welcome-mode')),false);await reopened.close();
  }finally{await context.close();}
  const getBlocked=await isolated({viewport:{width:390,height:844},hasTouch:true,isMobile:true},()=>{const get=Storage.prototype.getItem;Storage.prototype.getItem=function(key){if(key==='palinode-welcomed')throw Error('blocked read');return get.call(this,key);};const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(String(type).startsWith('webgl'))return null;return original.call(this,type,...args);};});try{
   await getBlocked.page.goto(base);assert.equal(await getBlocked.page.evaluate(()=>document.body.classList.contains('welcome-mode')),true);await getBlocked.page.locator('#welcome-example').click();await getBlocked.page.waitForSelector('#app-error');assert.equal(await getBlocked.page.evaluate(()=>document.body.classList.contains('welcome-mode')),false);
  }finally{await getBlocked.context.close();}
  const setBlocked=await isolated({viewport:{width:390,height:844},hasTouch:true,isMobile:true},()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='palinode-welcomed')throw Error('blocked write');return set.call(this,key,value);};const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(String(type).startsWith('webgl'))return null;return original.call(this,type,...args);};});try{
   const errors=[];setBlocked.page.on('pageerror',e=>errors.push(e.message));await setBlocked.page.goto(base);await setBlocked.page.locator('#welcome-example').click();await setBlocked.page.waitForSelector('#app-error');assert.equal(await setBlocked.page.evaluate(()=>document.body.classList.contains('welcome-mode')),false);assert.deepEqual(errors,[]);await setBlocked.page.reload();assert.equal(await setBlocked.page.evaluate(()=>document.body.classList.contains('welcome-mode')),true);
  }finally{await setBlocked.context.close();}
  return {firstVisit:true,refresh:true,newTab:true,readFailureSafe:true,writeFailureSafe:true};
 });
 await test('generated save errors are classified and export remains available',async()=>{
  const cases=[['QuotaExceededError','浏览器报告本机存储空间不足'],['AbortError','本机记忆库写入事务失败'],['UnknownError','本机保存失败，具体原因无法确认']];
  for(const [name,expected] of cases){
   const {context,page}=await isolated({viewport:{width:390,height:844},hasTouch:true,isMobile:true},()=>{window.__repairSaveFailureName='';const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(String(type).startsWith('webgl'))return null;return original.call(this,type,...args);};window.Worker=class{postMessage(data){setTimeout(()=>{if(this.stopped)return;if(data.type==='probe')this.onmessage?.({data:{type:'probe-ready',cached:true}});else this.onmessage?.({data:{type:'complete',buffer:new Float32Array(1600).buffer}});},5);}terminate(){this.stopped=true;};};});try{
    await page.addInitScript(nameValue=>{window.__repairSaveFailureName=nameValue;},name);await page.route('**/browser-inference/library.js**',async route=>{const response=await route.fetch();const source=await response.text(),needle='export async function save(record){';if(!source.includes(needle))throw Error('save injection point missing');const body=source.replace(needle,needle+"if(window.__repairSaveFailureName){if(window.__repairSaveFailureName==='UnknownError')throw Error('unknown save failure');throw new DOMException('injected save failure',window.__repairSaveFailureName);}");await route.fulfill({response,body});});
    await page.goto(base);await page.locator('#welcome-create').click();await page.waitForFunction(()=>!document.querySelector('#local-select').disabled);await page.locator('#photo-input').setInputFiles(path.join(__dirname,'..','demo.png'));await page.waitForFunction(expectedText=>document.querySelector('#notice').textContent.includes(expectedText),expected);
    const result=await page.evaluate(()=>({notice:document.querySelector('#notice').textContent,hasModel:!document.querySelector('#download-memory').hidden,downloadEnabled:!document.querySelector('#download-memory').disabled}));assert.ok(result.hasModel&&result.downloadEnabled);assert.ok(!result.notice.includes('仍可查看这份记忆'));assert.ok(!result.notice.includes('本机存储不足'));
   }finally{await context.close();}
  }
  return {quota:'distinct',transaction:'distinct',unknown:'distinct',exportFallback:true};
 });
 await test('import save failures describe render, budget, and visible fallback accurately',async()=>{
  const cases=[
   {kind:'render-error',name:'AbortError',blocked:true,count:100,expected:'本机记忆库写入事务失败',state:'原文件仅在当前页面中'},
   {kind:'over-budget',name:'QuotaExceededError',blocked:true,count:65537,expected:'浏览器报告本机存储空间不足',state:'超过当前设备的保守显示预算'},
   {kind:'displayed',name:'UnknownError',blocked:false,count:100,expected:'本机保存失败，具体原因无法确认',state:'3D 已在当前页面打开'}
  ];
  for(const item of cases){
   const {context,page}=await isolated({viewport:{width:390,height:844},hasTouch:true,isMobile:true},()=>{window.__repairSaveFailureName='';const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(window.__repairBlockGL&&String(type).startsWith('webgl'))return null;return original.call(this,type,...args);};window.Worker=class{postMessage(data){setTimeout(()=>{if(this.stopped)return;if(data.type==='probe')this.onmessage?.({data:{type:'probe-ready',cached:true}});else this.onmessage?.({data:{type:'complete',buffer:new Float32Array(1600).buffer}});},5);}terminate(){this.stopped=true;};};});try{
    await page.addInitScript(value=>{window.__repairSaveFailureName=value.name;window.__repairBlockGL=value.blocked;},item);await page.route('**/browser-inference/library.js**',async route=>{const response=await route.fetch();const source=await response.text(),needle='export async function save(record){';if(!source.includes(needle))throw Error('save injection point missing');const body=source.replace(needle,needle+"if(window.__repairSaveFailureName){if(window.__repairSaveFailureName==='UnknownError')throw Error('unknown save failure');throw new DOMException('injected save failure',window.__repairSaveFailureName);}");await route.fulfill({response,body});});await page.goto(base);
    await page.evaluate(async count=>{const lib=await import('/browser-inference/library.js'),photo=await(await fetch('/demo.png')).blob(),model=new Float32Array(count*16).buffer,packed=lib.pack({id:'import-source',name:'导入测试',created_at:'2026',photo,model,settings:{designVersion:2,depthVolume:1},ticket:{city:'原票面'}}),dt=new DataTransfer();dt.items.add(new File([packed],'import.still',{type:'application/octet-stream'}));const input=document.querySelector('input[accept=".still"]');input.files=dt.files;input.dispatchEvent(new Event('change'));},item.count);
    await page.waitForFunction(text=>document.querySelector('#notice').textContent.includes(text),item.expected,{timeout:20000});const notice=await page.locator('#notice').textContent();assert.ok(notice.includes(item.state),item.kind+': '+notice);assert.equal(await page.evaluate(()=>document.querySelector('#current-memory').hidden),false);assert.equal(await page.evaluate(()=>document.querySelector('#download-memory').hidden),false);if(item.kind==='displayed')assert.equal(await page.locator('#stage canvas').count(),1);else assert.equal(await page.locator('#stage canvas').count(),0);
   }finally{await context.close();}
  }
  return {renderError:true,overBudget:true,displayed:true,exportAvailable:true};
 });
 await test('encoder fallback advice checks actual landscape and portrait 720P30 capability',async()=>{
  async function scenario(settings,allow720){
   const {context,page}=await isolated();try{await page.addInitScript(allow=>{window.__encoderAllow720=allow;window.__encoderChecks=[];window.VideoEncoder=class{static async isConfigSupported(config){window.__encoderChecks.push({width:config.width,height:config.height,framerate:config.framerate});const is720=Math.min(config.width,config.height)===720&&Math.max(config.width,config.height)===1280&&config.framerate===30;return {supported:is720&&window.__encoderAllow720};}};},allow720);await page.route('**/test-harness',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Encoder capability test</title>'}));await page.goto(base+'/test-harness');return await page.evaluate(async settingsValue=>{const {checkExportSupport}=await import('/film-encoder.js?v=repair-v2');let message='';try{await checkExportSupport(settingsValue,false);}catch(e){message=e.message;}return {message,checks:window.__encoderChecks};},settings);}finally{await context.close();}
  }
  const horizontal=await scenario({width:1920,height:1080,fps:60,bitrate:9000000},true);assert.ok(horizontal.message.includes('可改选 720P · 30 帧'));assert.ok(horizontal.checks.some(x=>x.width===1920&&x.height===1080&&x.framerate===60));assert.ok(horizontal.checks.some(x=>x.width===1280&&x.height===720&&x.framerate===30));
  const vertical=await scenario({width:1080,height:1920,fps:60,bitrate:9000000},true);assert.ok(vertical.message.includes('可改选 720P · 30 帧'));assert.ok(vertical.checks.some(x=>x.width===720&&x.height===1280&&x.framerate===30));
  const unsupported=await scenario({width:1920,height:1080,fps:60,bitrate:9000000},false);assert.ok(unsupported.message.includes('720P · 30 帧也未通过编码检查'));assert.ok(unsupported.checks.some(x=>x.width===1280&&x.height===720&&x.framerate===30));
  const direct=await scenario({width:1280,height:720,fps:30,bitrate:6000000},false);assert.ok(direct.message.includes('未通过 720P · 30 帧 AVC 编码检查'));assert.ok(direct.checks.every(x=>x.width===1280&&x.height===720&&x.framerate===30));return {landscape:true,portrait:true,unsupported720NotRecommended:true,direct720Failure:true};
 });
 await test('720P30 encoder smoke / original 52-second timeline retained',async()=>{
  const {context,page}=await isolated();try{
   await page.route('**/test-harness',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Encoder test</title>'}));await page.goto(base+'/test-harness');
   return await page.evaluate(async()=>{const {FILM,exportSettings}=await import('/film-timeline.js'),{checkExportSupport,encodeFilm}=await import('/film-encoder.js');if(FILM.duration!==52||FILM.montageStart!==31.5)throw Error('timeline changed');const settings=exportSettings('720p30',false);await checkExportSupport(settings,false);const canvas=document.createElement('canvas');canvas.width=settings.width;canvas.height=settings.height;const ctx=canvas.getContext('2d');let frames=0;const blob=await encodeFilm({canvas,settings,duration:.1,audio:null,signal:new AbortController().signal,progress(){},draw(){ctx.fillStyle='#bc4336';ctx.fillRect(0,0,canvas.width,canvas.height);frames++;}});if(frames!==3||blob.size<100)throw Error('invalid smoke export');return {frames,bytes:blob.size,fullTimeline:FILM.duration,fullFilmTested:false};});
  }finally{await context.close();}
 });
 }finally{await browser.close();fs.writeFileSync(path.join(__dirname,'repair-results.json'),JSON.stringify({date:new Date().toISOString(),browser:'Headless Edge / isolated contexts / software GPU',results},null,2));}
 if(results.some(r=>r.status==='failed'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
