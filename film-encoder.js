import {Output,Mp4OutputFormat,BufferTarget,CanvasSource,AudioBufferSource,Quality,canEncodeVideo,canEncodeAudio} from './vendor/mediabunny.js';
export async function checkExportSupport(settings,music){
 if(!globalThis.VideoEncoder)throw Error('此浏览器不支持逐帧视频导出，请用最新版 Chrome 或 Safari');
 let supported;
 try{supported=await canEncodeVideo('avc',{width:settings.width,height:settings.height,framerate:settings.fps,quality:new Quality({bitrate:settings.bitrate})});}catch{throw Error('无法确认此设备是否支持所选视频规格，请换用其他浏览器或设备后重试');}
 if(!supported){
  const portrait=settings.height>settings.width,is720p30=settings.fps===30&&Math.min(settings.width,settings.height)===720&&Math.max(settings.width,settings.height)===1280;
  if(is720p30)throw Error('此设备未通过 720P · 30 帧 AVC 编码检查，请换用支持该规格的浏览器或设备');
  let supports720p30;
  try{supports720p30=await canEncodeVideo('avc',{width:portrait?720:1280,height:portrait?1280:720,framerate:30,quality:new Quality({bitrate:6000000})});}catch{throw Error('所选规格未通过编码检查，但无法确认 720P · 30 帧是否可用；请换用其他浏览器或设备后重试');}
  if(supports720p30)throw Error('此设备不支持所选视频规格；可改选 720P · 30 帧后重试');
  throw Error('此设备不支持所选视频规格，且 720P · 30 帧也未通过编码检查；请换用其他浏览器或设备');
 }
 if(music&&!await canEncodeAudio('aac',{sampleRate:44100,numberOfChannels:2}))throw Error('此浏览器无法编码配乐，请关闭配乐或换用支持 AAC 编码的浏览器');
}
export async function encodeFilm({canvas,settings,duration,audio,draw,signal,progress}){
 const target=new BufferTarget(),output=new Output({target,format:new Mp4OutputFormat({fastStart:'in-memory'})});
 const video=new CanvasSource(canvas,{codec:'avc',quality:new Quality({bitrate:settings.bitrate}),keyFrameInterval:2});output.addVideoTrack(video,{frameRate:settings.fps});
 const sound=audio?new AudioBufferSource({codec:'aac',quality:new Quality({bitrate:192000})}):null;if(sound)output.addAudioTrack(sound);
 try{await output.start();if(sound){await sound.add(audio);sound.close();}
 const count=Math.round(duration*settings.fps);
 for(let i=0;i<count;i++){signal?.throwIfAborted();await draw(i/settings.fps);await video.add(i/settings.fps,1/settings.fps);if(i%8===0){progress((i+1)/count);await new Promise(r=>setTimeout(r,0));}}
 signal?.throwIfAborted();video.close();await output.finalize();progress(1);return new Blob([target.buffer],{type:'video/mp4'});
 }catch(e){if(output.state!=='finalized'&&output.state!=='canceled')await output.cancel();throw e;}
}
