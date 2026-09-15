import {FILM} from './film-timeline.js';
const ease=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
export async function prepareMontage(fps,signal){
 signal.throwIfAborted();const current=new Image();current.src=document.getElementById('photo-preview').src;await current.decode();signal.throwIfAborted();
 return {async draw(ctx,w,h,t){if(t<FILM.montageStart||t>=FILM.montageEnd)return;signal.throwIfAborted();
 const u=t-FILM.montageStart,alpha=ease(u)*ease(FILM.montageEnd-t);ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
 const portrait=h>w,size=portrait?w*.92:h*.87,gap=size*.012,tile=(size-2*gap)/3,x=portrait?(w-size)/2:w-size-w*.05,y=(h-size)/2;
 ctx.fillStyle='#f5f5f7';ctx.textBaseline='middle';ctx.textAlign=portrait?'center':'left';ctx.font=`500 ${Math.min(w,h)*.037}px -apple-system, BlinkMacSystemFont, sans-serif`;
 if(portrait)ctx.fillText('每一刻，都有不同的世界。',w/2,y-w*.11);else{ctx.fillText('每一刻，',w*.07,h*.46);ctx.fillText('都有不同的世界。',w*.07,h*.52);}
 for(let i=0;i<9;i++){const col=i%3,row=Math.floor(i/3),dx=x+col*(tile+gap),dy=y+row*(tile+gap);ctx.save();ctx.beginPath();ctx.rect(dx,dy,tile,tile);ctx.clip();const scale=Math.min(tile/current.width,tile/current.height)*(1+.025*Math.sin(u*.6+i)),iw=current.width*scale,ih=current.height*scale;ctx.drawImage(current,dx+(tile-iw)/2,dy+(tile-ih)/2,iw,ih);ctx.restore();}ctx.restore();},async close(){current.src='';}};
}
