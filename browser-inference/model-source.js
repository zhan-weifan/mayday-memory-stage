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
