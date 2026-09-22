// Layout, input and execution capabilities deliberately have separate callers.
export const COMPACT_QUERY='(max-width:760px), (pointer:coarse) and (orientation:landscape) and (max-height:500px)';
export const compactLayout=()=>matchMedia(COMPACT_QUERY).matches;
export const touchInput=()=>matchMedia('(pointer:coarse)').matches||navigator.maxTouchPoints>0;
export const constrainedDevice=()=>touchInput()&&(Math.min(screen.width,screen.height)<=820||compactLayout());
export const MOBILE_PARTICLE_LIMIT=65536; // Experimental display budget, not a device guarantee.
export function displayPolicy(bytes){
 const count=bytes/64,limit=constrainedDevice()?MOBILE_PARTICLE_LIMIT:1500000;
 return {count,limit,allowed:Number.isSafeInteger(count)&&count<=limit};
}
export async function executionCapabilities(){
 let adapter=null;
 try{adapter=await Promise.race([navigator.gpu?.requestAdapter({powerPreference:'high-performance'}),new Promise(resolve=>setTimeout(()=>resolve(null),5000))]);}catch{}
 return {fp16:!!adapter?.features.has('shader-f16'),wasm:typeof WebAssembly==='object',worker:typeof Worker==='function',opfs:!!navigator.storage?.getDirectory,webCodecs:typeof VideoEncoder==='function'};
}
