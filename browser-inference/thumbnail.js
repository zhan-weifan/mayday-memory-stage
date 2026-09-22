export async function makeThumbnail(photo){
 if(!photo)return null;
 let image,url;
 try{
  if(typeof createImageBitmap==='function')image=await createImageBitmap(photo);
  else{url=URL.createObjectURL(photo);image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=url;});}
  const canvas=document.createElement('canvas');canvas.width=canvas.height=128;
  const ctx=canvas.getContext('2d');if(!ctx)return null;
  const size=Math.min(image.width,image.height);ctx.drawImage(image,(image.width-size)/2,(image.height-size)/2,size,size,0,0,128,128);
  return await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.75));
 }catch{return null;}finally{image?.close?.();if(url)URL.revokeObjectURL(url);}
}
