import {COMPACT_QUERY,touchInput} from './device-capabilities.js';
import {syncSettingControls,CONTROL_SETTINGS} from './settings.js';
let initialized=false,returnFocus=null;
const background=new Map();
export function markWelcomed(){document.body.classList.remove('welcome-mode');try{localStorage.setItem('palinode-welcomed','1');}catch{}}
export function sidebar(open){
 const panel=document.getElementById('memory-panel'),toggle=document.getElementById('toggle-sidebar');
 const modal=open&&matchMedia(COMPACT_QUERY).matches;
 const errorBox=document.getElementById('app-error');if(errorBox)(modal?panel:document.body).append(errorBox);
 if(modal&&!document.body.classList.contains('sidebar-open'))returnFocus=document.activeElement;
 document.body.classList.toggle('sidebar-open',open);toggle.textContent=open?'关闭':'调整';toggle.setAttribute('aria-expanded',String(open));document.getElementById('close-sidebar').hidden=!modal;
 if(modal){
  panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
  for(const node of [document.querySelector('.object-view'),document.querySelector('.topbar')]){if(!background.has(node))background.set(node,node.inert);node.inert=true;}
  panel.querySelector('button,input,select,a')?.focus();
 }else{
  panel.removeAttribute('role');panel.removeAttribute('aria-modal');
  for(const [node,inert] of background)node.inert=inert;background.clear();
  if(!open&&returnFocus){(returnFocus.isConnected?returnFocus:toggle).focus();returnFocus=null;}
 }
}
export function showAppError(error,retry,kind='应用'){
 const box=document.getElementById('app-error');box.hidden=false;
 box.querySelector('p').textContent=`${kind}未能启动：${error.message||error}。文件仍可保存和管理；3D 可在支持的设备中查看。`;
 const button=box.querySelector('[data-retry]');button.onclick=async()=>{button.disabled=true;try{await retry();box.hidden=true;}catch(e){box.querySelector('p').textContent=`重试未完成：${e.message}。可刷新页面重试。`;}finally{button.disabled=false;}};
}
export function clearAppError(){document.getElementById('app-error').hidden=true;}
export function initShell(){
 if(initialized)return;
 const panel=document.getElementById('memory-panel');
 if(!panel||!document.getElementById('toggle-sidebar')||!document.getElementById('close-sidebar')||!document.getElementById('view-hint'))throw Error('基础界面未加载');
 const head=document.createElement('div');head.className='mobile-panel-head';head.innerHTML='<strong>记忆与调整</strong><button type="button" aria-label="关闭调整面板">完成</button>';panel.prepend(head);head.querySelector('button').onclick=()=>sidebar(false);
 document.getElementById('toggle-sidebar').onclick=()=>sidebar(!document.body.classList.contains('sidebar-open'));
 document.getElementById('close-sidebar').onclick=()=>sidebar(false);
 document.addEventListener('keydown',event=>{
  if(!document.body.classList.contains('sidebar-open')||!matchMedia(COMPACT_QUERY).matches)return;
  if(document.querySelector('dialog[open]'))return;
  if(event.key==='Escape'){event.preventDefault();sidebar(false);}
  if(event.key==='Tab'){
   const nodes=[...panel.querySelectorAll('button,input,select,a,summary,[tabindex]')].filter(node=>!node.disabled&&node.tabIndex>=0&&node.getClientRects().length&&!node.closest('[hidden]'));
   if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);
   if(event.shiftKey&&(document.activeElement===first||!panel.contains(document.activeElement))){event.preventDefault();last.focus();}
   else if(!event.shiftKey&&(document.activeElement===last||!panel.contains(document.activeElement))){event.preventDefault();first.focus();}
  }
 });
 matchMedia(COMPACT_QUERY).addEventListener('change',()=>sidebar(false));
 document.getElementById('view-hint').textContent=touchInput()?'单指旋转视角 · 双指缩放':'拖动旋转视角 · 滚轮缩放 · 右侧滚动条上下移动';
 syncSettingControls();
 for(const [key,rule] of Object.entries(CONTROL_SETTINGS))document.getElementById(rule.id)?.addEventListener('input',event=>{const output=document.getElementById(rule.id+'Value');if(output)output.textContent=['contentScale','depthVolume'].includes(key)?Math.round(Number(event.target.value)*100)+'%':Number(event.target.value).toFixed(2);});
 initialized=true;
}
