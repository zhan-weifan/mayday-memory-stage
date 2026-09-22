import {normalizeSettings,CONTROL_SETTINGS} from './settings.js';
import {showAppError,clearAppError} from './ui-shell.js';
let instance=null,pending=null,settings=normalizeSettings(),displayed=false,ticket=null,loadToken=0;
export async function ensureViewer(){
 if(instance)return instance;
 if(!pending)pending=import('./main.js?v=mobile-20260922').then(module=>module.initViewer()).then(viewer=>{instance=viewer;if(ticket)viewer.setTicket(...ticket);return viewer;}).catch(error=>{pending=null;showAppError(error,async()=>{await ensureViewer();document.dispatchEvent(new Event('viewer-retry'));},'3D 查看器');throw error;});
 return pending;
}
export const memoryBox={
 setRecordSettings(value){settings=normalizeSettings(value);displayed=false;
  for(const [key,rule] of Object.entries(CONTROL_SETTINGS)){const node=document.getElementById(rule.id);node.value=settings[key];const output=document.getElementById(rule.id+'Value');if(output)output.textContent=['contentScale','depthVolume'].includes(key)?Math.round(settings[key]*100)+'%':settings[key].toFixed(2);}
  for(const fit of ['cover','contain'])document.getElementById('fit-'+fit).setAttribute('aria-pressed',String(settings.fit===fit));
 },
 async load(...args){const token=++loadToken;const viewer=await ensureViewer();if(token!==loadToken)return;await viewer.load(...args);if(token===loadToken){displayed=true;clearAppError();}},
 async beginCreation(...args){const token=++loadToken;try{const viewer=await ensureViewer();if(token!==loadToken)return;return await viewer.beginCreation(...args);}catch{ /* Data generation does not require the optional ceremony. */ }},
 async beginFilm(...args){if(!displayed)throw Error('请先成功打开一份可显示的 3D 记忆');return (await ensureViewer()).beginFilm(...args);},
 getSettings(){if(displayed&&instance)return instance.getSettings();const value={...settings};for(const [key,rule] of Object.entries(CONTROL_SETTINGS))value[key]=Number(document.getElementById(rule.id).value);return normalizeSettings(value);},
 setTicket(...args){ticket=args;instance?.setTicket(...args);},
 cancelCreation(){loadToken++;instance?.cancelCreation();},
 releaseLoadedMemory(){loadToken++;displayed=false;return instance?.releaseLoadedMemory();},
 capture(){if(!displayed||!instance)throw Error('当前设备尚未显示 3D 画面，仍可导出记忆文件');return instance.capture();}
};
for(const method of ['setView','setAutoOrbit','setGenerationProgress','setInferencePaused','setComputing','waiting','endFilm','filmFrame','beginShowcase','showcaseFrame'])memoryBox[method]=(...args)=>instance?.[method](...args);

for(const fit of ['cover','contain'])document.getElementById('fit-'+fit).addEventListener('click',()=>{settings.fit=fit;if(!displayed)for(const name of ['cover','contain'])document.getElementById('fit-'+name).setAttribute('aria-pressed',String(name===fit));});
