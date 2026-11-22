import {blankCanvas,bounds,clear,inkBounds,layoutNote,paint,paintNote,pathTouchesRect,pointPath,removeRegion} from './draft-board-canvas.mjs';
import {strokeWidth} from './draft-board.mjs';

export const overlaps=(a,b)=>a.x<=b.x+b.w&&b.x<=a.x+a.w&&a.y<=b.y+b.h&&b.y<=a.y+a.h;
const expand=(r,n)=>({x:r.x-n,y:r.y-n,w:r.w+n*2,h:r.h+n*2});
export function createBoardRenderer(assets){
  const metrics=blankCanvas(1,1).getContext('2d');
  const strokeBounds=new WeakMap(),sourceBounds=new WeakMap(),noteLayouts=new WeakMap(),cache=new Map();
  let pixels=0,frameResolution=0;
  const pathBounds=item=>{
    if(!sourceBounds.has(item))sourceBounds.set(item,bounds(item.points));return sourceBounds.get(item);
  };
  function noteRect(note){
    if(!noteLayouts.has(note))noteLayouts.set(note,layoutNote(metrics,note));return noteLayouts.get(note);
  }
  function drawInk(context,items,area,end=items.length){
    for(let i=0;i<end;i++){
      const item=items[i];
      if(item.kind==='stroke'||item.kind==='shape'){
        if(!strokeBounds.has(item))strokeBounds.set(item,expand(inkBounds(item),strokeWidth(item)/2+1));
        if(overlaps(strokeBounds.get(item),area))paint(context,item);
      }else if(item.kind==='cut'||item.kind==='vectorCut'){
        if(overlaps(pathBounds(item),area))removeRegion(context,item.points);
        if(!overlaps(item,area))continue;
        const layer=item.kind==='cut'?assets.get(item)?.[0]:lift(item,items,i);
        if(layer)context.drawImage(layer,item.x,item.y,item.w,item.h);
      }
    }
  }
  function lift(item,items,end){
    const cached=cache.get(item);
    if(cached){cache.delete(item);cache.set(item,cached);return cached.canvas;}
    const source=pathBounds(item);
    const density=Math.min(frameResolution*Math.max(1,item.w/source.w),4096/Math.max(source.w,source.h),Math.sqrt(5000000/(source.w*source.h)));
    const canvas=blankCanvas(Math.max(1,Math.ceil(source.w*density)),Math.max(1,Math.ceil(source.h*density))),ctx=canvas.getContext('2d');
    ctx.setTransform(canvas.width/source.w,0,0,canvas.height/source.h,-source.x*canvas.width/source.w,-source.y*canvas.height/source.h);
    ctx.clip(pointPath(item.points),'evenodd');drawInk(ctx,items,source,end);
    const size=canvas.width*canvas.height;
    while(pixels+size>12000000&&cache.size){const [key,entry]=cache.entries().next().value;pixels-=entry.size;cache.delete(key);}
    cache.set(item,{canvas,size});pixels+=size;return canvas;
  }
  function frame(ctx,textCtx,items,selection,editIndex,dragging,area,resolution){
    // Cached cuts are reconstructed from earlier vector strokes at the active zoom.
    // Item identity can be shared across undo, so clear the cache when the scene changes.
    const resolutionBucket=Math.max(1,Math.ceil(resolution*2)/2);
    if(resolutionBucket!==frameResolution){frameResolution=resolutionBucket;invalidate();}
    clear(ctx);clear(textCtx);
    drawInk(ctx,items,area);
    if(selection?.hasInk){
      if(overlaps(pathBounds(selection.cut),area))removeRegion(ctx,selection.cut.points);
      if(overlaps(selection.cut,area))ctx.drawImage(lift(selection.cut,items,items.length),selection.cut.x,selection.cut.y,selection.cut.w,selection.cut.h);
    }
    const rects=new Map();
    for(let i=0;i<items.length;i++){
      const item=items[i];
      if(item.kind==='note'){
        const shown=dragging?.index===i?dragging.note:item,rect=noteRect(shown);
        if(overlaps(rect,area)){
          if(editIndex!==i)paintNote(textCtx,rect,item.color);rects.set(i,{...rect,editable:true});
        }
      }else if(item.kind==='cut'&&item.text){
        if(overlaps(pathBounds(item),area)){
          removeRegion(textCtx,item.points);
          for(const rect of rects.values())if(pathTouchesRect(metrics,[...item.points,item.points[0]],rect))rect.editable=false;
        }
        const layer=assets.get(item)?.[1];if(layer&&overlaps(item,area))textCtx.drawImage(layer,item.x,item.y,item.w,item.h);
      }else if(item.kind==='stroke'&&item.throughText&&item.brush==='eraser'&&overlaps(expand(pathBounds(item),strokeWidth(item)/2+1),area))paint(textCtx,item);
    }
    return rects;
  }
  function invalidate(){cache.clear();pixels=0;}
  function sampleInk(items,points,source){
    const density=Math.min(1,768/Math.max(source.w,source.h));
    const canvas=blankCanvas(Math.max(1,Math.ceil(source.w*density)),Math.max(1,Math.ceil(source.h*density))),ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.setTransform(density,0,0,density,-source.x*density,-source.y*density);
    ctx.clip(pointPath(points),'evenodd');drawInk(ctx,items,source);
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
    for(let i=3;i<data.length;i+=4)if(data[i])return true;
    return false;
  }
  return {frame,noteRect,invalidate,sampleInk};
}
