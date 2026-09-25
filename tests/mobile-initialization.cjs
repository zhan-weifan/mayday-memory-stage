// Run: node --test tests/mobile-initialization.cjs
// Uses the shipped WASM runtime and a tiny external-weight model. This is not
// a Lite-256 compatibility benchmark or an iPhone peak-memory measurement.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const fs=require('node:fs');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const moduleUrl=file=>pathToFileURL(path.join(root,file)).href;
const optionsModule=import(moduleUrl('browser-inference/mobile-session-options.js'));

test('off restores the original profile; switching on does not mutate it',async()=>{
  const {mobileSessionOptions}=await optionsModule;
  const weights=new Blob([new Uint8Array(12)]);
  const standard=mobileSessionOptions('weights',weights);
  assert.deepEqual(standard,{executionProviders:['wasm'],externalData:[{path:'weights',data:weights}],graphOptimizationLevel:'all',enableCpuMemArena:true,enableMemPattern:true,executionMode:'sequential',extra:{session:{disable_prepacking:'1'}}});
  const lean=mobileSessionOptions('weights',weights,true);
  assert.equal(lean.graphOptimizationLevel,'disabled');
  assert.equal(lean.enableCpuMemArena,false);
  assert.equal(lean.enableMemPattern,true);
  lean.extra.session.disable_prepacking='0';
  assert.deepEqual(mobileSessionOptions('weights',weights,false),standard);
  assert.deepEqual(mobileSessionOptions('weights',weights,'true'),standard);
});

test('worker forwards the selected profile, releases sessions, and never silently retries',async()=>{
  const {mobileSessionOptions}=await optionsModule;
  const sessions=[],messages=[];let released=0,fail=false;
  const ort={env:{wasm:{}},Tensor:class{dispose(){}},InferenceSession:{create:async(graph,options)=>{
    sessions.push(options);if(fail)throw Error('initialization failed');
    return {run:async()=>({result:{dispose(){}}}),release:async()=>{released++;}};
  }}};
  const context=vm.createContext({URL,Blob,Uint8Array,Float32Array,ArrayBuffer,self:{},postMessage:message=>messages.push(message),cached:async()=>({graph:new Blob([new Uint8Array(1)]),weights:new Blob([new Uint8Array(12)])}),FILES:[{name:'graph'},{name:'weights'}],mobileSessionOptions,prepare:()=>new ArrayBuffer(16),ort});
  let source=fs.readFileSync(path.join(root,'browser-inference/mobile-worker.js'),'utf8');
  source=source.replace(/^import .*;\r?\n/gm,'').replace("const ort=await import('./ort-cpu/ort.wasm.min.js');",'const ort=globalThis.ort;').replaceAll('import.meta.url',JSON.stringify('https://example.test/mobile-worker.js'));
  vm.runInContext(source,context);
  const run=enabled=>context.self.onmessage({data:{lowMemoryInitialization:enabled,prepared:{pixels:new Uint8Array(256*256*4),width:640,height:480}}});
  await context.self.onmessage({data:{type:'probe'}});assert.equal(sessions.length,0);
  await run(true);await run(false);
  assert.deepEqual(sessions.map(s=>s.graphOptimizationLevel),['disabled','all']);
  assert.equal(released,2);assert.equal(messages.filter(m=>m.type==='complete').length,2);
  fail=true;await run(true);
  assert.equal(sessions.length,3,'failed initialization must not trigger another large allocation');
  assert.match(messages.at(-1).text,/关闭“低性能模式”/);
  fail=false;await run(false);assert.equal(messages.at(-1).type,'complete');
});

const varint=value=>{const bytes=[];do{let byte=value&127;value=Math.floor(value/128);bytes.push(byte|(value?128:0));}while(value);return Buffer.from(bytes);};
const integer=(field,value)=>Buffer.concat([varint(field*8),varint(value)]);
const bytes=(field,value)=>{value=Buffer.from(value);return Buffer.concat([varint(field*8+2),varint(value.length),value]);};
const join=(...parts)=>Buffer.concat(parts);
const info=name=>bytes(1,name); // ValueInfo name is followed by a tensor type.
const valueInfo=name=>join(info(name),bytes(2,bytes(1,join(integer(1,1),bytes(2,bytes(1,integer(1,3)))))));
function externalWeightModel(){
  const entry=(key,value)=>bytes(13,join(bytes(1,key),bytes(2,value)));
  const weight=join(integer(1,3),integer(2,1),bytes(8,'bias'),entry('location','weights.bin'),entry('offset','0'),entry('length','12'),integer(14,1));
  const node=join(bytes(1,'x'),bytes(1,'bias'),bytes(2,'y'),bytes(4,'Add'));
  const graph=join(bytes(1,node),bytes(2,'initialization-smoke'),bytes(5,weight),bytes(11,valueInfo('x')),bytes(12,valueInfo('y')));
  return new Uint8Array(join(integer(1,8),bytes(7,graph),bytes(8,integer(2,13))));
}

test('the shipped WASM runtime initializes and runs external weights with both profiles',async()=>{
  const {mobileSessionOptions}=await optionsModule;
  const ort=await import(moduleUrl('browser-inference/ort-cpu/ort.wasm.min.js'));
  ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
  ort.env.wasm.wasmPaths={mjs:moduleUrl('browser-inference/ort-cpu/ort-wasm-simd-threaded.js'),wasm:moduleUrl('browser-inference/ort-cpu/ort-wasm-simd-threaded.wasm')};
  const weights=new Blob([new Float32Array([1,2,3])]);
  for(const lean of [false,true,false]){
    const session=await ort.InferenceSession.create(externalWeightModel(),mobileSessionOptions('weights.bin',weights,lean));
    const input=new ort.Tensor('float32',new Float32Array([10,20,30]),[3]);let output;
    try{output=await session.run({x:input});assert.deepEqual([...output.y.data],[11,22,33]);}
    finally{input.dispose();output?.y.dispose();await session.release();}
  }
});
