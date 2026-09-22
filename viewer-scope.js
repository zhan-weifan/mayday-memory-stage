// Every initialization attempt owns its listeners, observers, frames and GPU resources.
export function createViewerScope(stage){
 const cleanups=[],resources=[],frames=new Set(),children=new Set(stage.children);
 let disposed=false;
 const own=value=>{resources.push(value);return value;};
 const cleanup=fn=>cleanups.push(fn);
 for(const id of ['render-quality','content-scale','depth-volume','fit-cover','fit-contain','motion']){
  const node=document.getElementById(id);if(!node)continue;
  const previous={onclick:node.onclick,oninput:node.oninput,onchange:node.onchange};cleanup(()=>Object.assign(node,previous));
 }
 const style=stage.style.touchAction,creation=stage.dataset.creation,lighting=stage.dataset.lighting;
 cleanup(()=>{stage.style.touchAction=style;for(const [key,value] of Object.entries({creation,lighting})){if(value===undefined)delete stage.dataset[key];else stage.dataset[key]=value;}});
 function dispose(){
  if(disposed)return;disposed=true;
  for(const frame of frames)cancelAnimationFrame(frame);frames.clear();
  for(const fn of cleanups.reverse())try{fn();}catch{}
  const seen=new Set();
  function release(value){
   if(!value||seen.has(value))return;seen.add(value);
   if(value.isObject3D)value.traverse(node=>{if(node!==value)release(node);release(node.geometry);for(const mat of Array.isArray(node.material)?node.material:[node.material])release(mat);node.shadow?.dispose?.();});
   if(value.isMaterial){for(const item of Object.values(value))if(item?.isTexture)release(item);for(const uniform of Object.values(value.uniforms||{}))if(uniform.value?.isTexture)release(uniform.value);}
   try{value.dispose?.();}catch{}
   if(value.isWebGLRenderer){value.forceContextLoss();value.domElement.remove();}
  }
  for(const resource of resources.reverse())release(resource);
  for(const child of [...stage.children])if(!children.has(child))child.remove();
 }
 return {own,cleanup,dispose,
  node(node){cleanup(()=>node.remove());return node;},
  listen(target,type,handler,options){target.addEventListener(type,handler,options);cleanup(()=>target.removeEventListener(type,handler,options));},
  observe(target,handler){const observer=new ResizeObserver(handler);observer.observe(target);cleanup(()=>observer.disconnect());},
  frame(handler){if(disposed)return;const id=requestAnimationFrame(now=>{frames.delete(id);if(!disposed)handler(now);});frames.add(id);return id;}
 };
}
