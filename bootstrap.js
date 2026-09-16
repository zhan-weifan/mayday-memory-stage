let appPromise=null;
const appVersion='lazy-20260916-1';
const entryIds=['welcome-example','welcome-create','choose-photo'];
const entries=entryIds.map(id=>document.getElementById(id)).filter(Boolean);
let pendingEntry=null;
let interceptors=[];

function markWelcomed(){
  document.body.classList.remove('welcome-mode');
  try{localStorage.setItem('palinode-welcomed','1');}catch{}
  for(const button of entries)button.removeEventListener('click',markWelcomed,true);
}

function loadApp(){
  if(!appPromise){
    appPromise=Promise.all([
      import(`./browser-inference/ui.js?v=${appVersion}`),
      import(`./film.js?v=${appVersion}`),
      import(`./observatory-ui.js?v=${appVersion}`)
    ]);
  }
  return appPromise;
}

function removeInterceptors(){
  for(const {button,handler} of interceptors)button.removeEventListener('click',handler,true);
  interceptors=[];
}

function handleEarlyEntry(event){
  event.preventDefault();
  event.stopImmediatePropagation();
  if(pendingEntry)return;
  pendingEntry=event.currentTarget;
  markWelcomed();
  loadApp().then(()=>{
    const button=pendingEntry;
    pendingEntry=null;
    removeInterceptors();
    button?.click();
  }).catch(error=>{
    pendingEntry=null;
    console.error('Unable to load the application',error);
  });
}

for(const button of entries){
  button.addEventListener('click',markWelcomed,true);
  const handler=handleEarlyEntry;
  button.addEventListener('click',handler,true);
  interceptors.push({button,handler});
}

try{if(localStorage.getItem('palinode-welcomed')==='1')markWelcomed();}catch{}

const mobile=window.matchMedia?.('(pointer:coarse), (max-width:760px)').matches??false;
const schedule=window.requestIdleCallback
  ? callback=>window.requestIdleCallback(callback,{timeout:1200})
  : callback=>window.setTimeout(callback,700);
if(!document.body.classList.contains('welcome-mode')||!mobile)schedule(()=>loadApp());

