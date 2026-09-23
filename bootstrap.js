import {initShell,markWelcomed,showAppError} from './ui-shell.js';
let appPromise=null;
const entries=['welcome-example','welcome-create','choose-photo'].map(id=>document.getElementById(id));
let pendingEntry=null;
export function loadApp(){
 if(!appPromise)appPromise=(async()=>{
  initShell();
  const ui=await import('./browser-inference/ui.js?v=example-20260923-3');
  await ui.ready;
  for(const path of ['./film.js?v=mobile-20260922-3','./observatory-ui.js?v=mobile-20260922-3'])import(path).catch(error=>showAppError(error,()=>import(path),'附加界面'));
  return ui;
 })().catch(error=>{appPromise=null;showAppError(error,loadApp);throw error;});
 return appPromise;
}
function intercept(event){
 event.preventDefault();event.stopImmediatePropagation();
 if(pendingEntry)return;pendingEntry=event.currentTarget;
 loadApp().then(()=>{const button=pendingEntry;pendingEntry=null;for(const node of entries)node.removeEventListener('click',intercept,true);markWelcomed();button?.click();}).catch(()=>{pendingEntry=null;});
}
for(const button of entries)button.addEventListener('click',intercept,true);
try{initShell();}catch(error){showAppError(error,loadApp,'基础界面');}
void loadApp().catch(()=>{});
// Start the empty stage on entry, independently of model downloads and library I/O.
void import('./viewer-loader.js?v=mobile-20260922-3').then(({ensureViewer})=>ensureViewer()).catch(()=>{});
