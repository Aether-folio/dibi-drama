// Integer coordinates keep saved strokes compact and independent of window size.
export const boardLimit=10000000;
export const boardLimits={items:1000,stroke:4000,points:45000,note:1000,text:50000,image:2200000,images:7500000};
export const brushStyles={fine:{width:2},pen:{width:5},marker:{width:18,alpha:.32},eraser:{width:26}};
export const brushWidthRange={min:1,max:48};
export const strokeWidth=stroke=>stroke.width??brushStyles[stroke.brush]?.width??2;
export const shapes={line:'直线',dash:'虚线',arrow:'箭头',triangle:'三角形',circle:'圆形',rectangle:'矩形'};
export const boardFileExtension='.board.json';
export const noteWidthRange={min:48,max:2400};
export const noteSizeRange={min:9,max:96};

// Older boards could extend into negative coordinates. Shift the entire scene
// together so strokes, erasers and both ends of a lasso cut keep their alignment.
export function alignBoardToOrigin(items){
  let left=0,top=0;
  for(const item of items){
    if(item.x!==undefined){left=Math.min(left,item.x);top=Math.min(top,item.y);}
    for(const [x,y] of item.points??[]){left=Math.min(left,x);top=Math.min(top,y);}
  }
  if(!left&&!top)return items;
  return items.map(item=>({...item,...(item.x===undefined?{}:{x:item.x-left,y:item.y-top}),
    ...(item.points?{points:item.points.map(([x,y])=>[x-left,y-top])}:{})}));
}
