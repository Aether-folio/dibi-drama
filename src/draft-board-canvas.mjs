import {brushStyles,strokeWidth} from './draft-board.mjs';
import {fonts} from './font-choices.mjs';

export const blankCanvas=(width,height)=>Object.assign(document.createElement('canvas'),{width,height});
export const clear=context=>{context.save();context.resetTransform();context.clearRect(0,0,context.canvas.width,context.canvas.height);context.restore();};
export const pointPath=(points,closed=true)=>{
  const path=new Path2D();path.moveTo(...points[0]);
  for(let i=1;i<points.length;i++)path.lineTo(...points[i]);
  if(closed)path.closePath();return path;
};
export function paint(context,stroke) {
  if(stroke.kind==='shape'){paintShape(context,stroke);return;}
  const {brush,color,points}=stroke,style=brushStyles[brush],width=strokeWidth(stroke);
  context.save();
  context.globalAlpha=style.alpha??1;
  context.globalCompositeOperation=brush==='eraser'?'destination-out':'source-over';
  context.fillStyle=context.strokeStyle=color;
  context.lineWidth=width;context.lineCap=context.lineJoin='round';
  if(points.length===1){context.beginPath();context.arc(...points[0],width/2,0,Math.PI*2);context.fill();}
  else context.stroke(pointPath(points,false));
  context.restore();
}
function paintShape(context,{shape,color,points:[[x1,y1],[x2,y2]],width}) {
  const x=Math.min(x1,x2),y=Math.min(y1,y2),w=Math.abs(x2-x1),h=Math.abs(y2-y1);
  context.save();
  context.strokeStyle=color;context.lineWidth=width;context.lineCap=context.lineJoin='round';
  context.beginPath();
  if(shape==='rectangle')context.rect(x,y,w,h);
  else if(shape==='circle'){
    const d=Math.max(w,h);
    context.arc(x1+(x2<x1?-d:d)/2,y1+(y2<y1?-d:d)/2,d/2,0,2*Math.PI);
  }else if(shape==='triangle'){
    context.moveTo(x+w/2,y);context.lineTo(x+w,y+h);context.lineTo(x,y+h);context.closePath();
  }else{
    if(shape==='dash')context.setLineDash([width*4,width*3]);
    context.moveTo(x1,y1);context.lineTo(x2,y2);
    if(shape==='arrow'){
      const angle=Math.atan2(y2-y1,x2-x1),head=Math.min(Math.hypot(w,h)*.45,Math.max(11,width*3.5));
      context.moveTo(x2-head*Math.cos(angle-.52),y2-head*Math.sin(angle-.52));context.lineTo(x2,y2);
      context.lineTo(x2-head*Math.cos(angle+.52),y2-head*Math.sin(angle+.52));
    }
  }
  context.stroke();context.restore();
}
export function inkBounds(item){
  if(item.kind==='shape'&&item.shape==='circle'){
    const [[x,y],[endX,endY]]=item.points,d=Math.max(Math.abs(endX-x),Math.abs(endY-y));
    return {x:endX<x?x-d:x,y:endY<y?y-d:y,w:d,h:d};
  }
  const box=bounds(item.points);
  if(item.kind==='shape'&&item.shape==='arrow'){
    const padding=Math.max(11,item.width*3.5);
    return {x:box.x-padding,y:box.y-padding,w:box.w+2*padding,h:box.h+2*padding};
  }
  return box;
}
export function bounds(points) {
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const [x,y] of points){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}
  return {x:left,y:top,w:right-left,h:bottom-top};
}
export function removeRegion(context,points){
  context.save();context.globalCompositeOperation='destination-out';
  context.fill(pointPath(points),'evenodd');context.restore();
}
// Check each segment, rather than the entire bounding box of a long diagonal stroke.
export function pathTouchesRect(context,points,{x,y,w,h},radius=0){
  const left=x-radius,right=x+w+radius,top=y-radius,bottom=y+h+radius;
  if(points.some(([px,py])=>px>=left&&px<=right&&py>=top&&py<=bottom))return true;
  for(let i=1;i<points.length;i++){
    const [ax,ay]=points[i-1],[bx,by]=points[i];
    if(ax!==bx)for(const edge of [left,right]){
      const t=(edge-ax)/(bx-ax),y=ay+t*(by-ay);
      if(t>=0&&t<=1&&y>=top&&y<=bottom)return true;
    }
    if(ay!==by)for(const edge of [top,bottom]){
      const t=(edge-ay)/(by-ay),x=ax+t*(bx-ax);
      if(t>=0&&t<=1&&x>=left&&x<=right)return true;
    }
  }
  return !radius&&context.isPointInPath(pointPath(points),(left+right)/2,(top+bottom)/2,'evenodd');
}
const legacyNoteFont='500 21px "Segoe UI", "Microsoft YaHei", sans-serif';
export function noteStyle(note){
  const legacy=note.width===undefined&&note.font===undefined&&note.fontSize===undefined;
  const size=note.fontSize??21,family=fonts[note.font??'system'];
  return {size,family,font:legacy?legacyNoteFont:`500 ${size}px ${family}`,
    lineHeight:legacy?31:Math.ceil(size*1.32),padX:legacy?5:2,padY:legacy?4:2,wrapWidth:note.width??335};
}
export function layoutNote(context,note){
  const style=noteStyle(note),{font,lineHeight,padX,padY,wrapWidth}=style;
  context.font=font;
  const lines=[];
  for(const paragraph of note.text.split('\n')){
    let line='';
    for(const char of paragraph){
      if(line&&context.measureText(line+char).width>wrapWidth){lines.push(line);line='';}
      line+=char;
    }
    lines.push(line);
  }
  const lineWidths=lines.map(line=>context.measureText(line).width);
  const w=Math.ceil(Math.max(14,...lineWidths))+padX*2;
  const h=lines.length*lineHeight+padY*2;
  const scale=note.scale??1;
  return {...style,lines,lineWidths,x:note.x,y:note.y,w:w*scale,h:h*scale,scale};
}
export function paintNote(context,rect,color){
  context.save();context.translate(rect.x,rect.y);context.scale(rect.scale,rect.scale);
  context.font=rect.font;context.textBaseline='top';context.fillStyle=color;
  rect.lines.forEach((line,i)=>context.fillText(line,rect.padX,rect.padY+i*rect.lineHeight));context.restore();
}
