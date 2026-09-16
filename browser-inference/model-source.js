// Empty means same-origin hosting. A custom endpoint must serve the verified files with CORS.
export const DEFAULT_LITE_BASE = new URL('../models/gemos-still-lite-v1/',import.meta.url).href;
export function normalizeModelBase(value) {
  const url=new URL(value || DEFAULT_LITE_BASE);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))){
    throw Error('模型源必须为 HTTPS 地址，本机测试可使用 localhost。');
  }
  if(url.username||url.password||url.search||url.hash)throw Error('请填写不含登录信息、查询参数或片段的模型目录地址。');
  url.pathname=url.pathname.replace(/\/?$/,'/');
  return url.href;
}

const CHECK_TIMEOUT=10000;
const sourceError=file=>Error('模型下载暂不可用：'+file.name+'。请查看示例，或在「模型与缓存」中导入模型包。');

async function checkHead(url,file){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),CHECK_TIMEOUT);
 try{
  const response=await fetch(url,{method:'HEAD',signal:controller.signal,cache:'no-store'});
  const length=Number(response.headers.get('Content-Length')),encoded=!!response.headers.get('Content-Encoding');
  return response.ok&&Number.isFinite(length)&&length>0&&(encoded||length===file.size);
 }catch{return false;}
 finally{clearTimeout(timer);controller.abort();}
}

async function checkRange(url,file){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),CHECK_TIMEOUT);
 try{
  const response=await fetch(url,{method:'GET',headers:{Range:'bytes=0-0'},signal:controller.signal,cache:'no-store'});
  if(response.status!==206){await response.body?.cancel?.();return false;}
  const match=/^bytes\s+0-0\/(\d+)$/.exec(response.headers.get('Content-Range')?.trim()||'');
  const total=match?Number(match[1]):NaN;
  await response.body?.cancel?.();
  return Number.isSafeInteger(total)&&total===file.size;
 }catch{return false;}
 finally{clearTimeout(timer);controller.abort();}
}

export async function checkFile(base,file){
 const url=normalizeModelBase(base)+file.name;
 if(await checkHead(url,file))return true;
 if(await checkRange(url,file))return true;
 throw sourceError(file);
}

export async function checkModelSource(base,files){
 const normalized=normalizeModelBase(base);
 for(const file of files)await checkFile(normalized,file);
 return true;
}

