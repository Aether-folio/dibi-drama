import {alignBoardToOrigin,boardLimit,boardLimits,brushStyles,brushWidthRange,noteSizeRange,noteWidthRange,shapes} from './draft-board.mjs';
import {bounds,clear,inkBounds,paint,pointPath} from './draft-board-canvas.mjs';
import {createBoardRenderer} from './draft-board-render.mjs';
import {icon} from './icons.mjs';

const holdTime=180,moveThreshold=4,historyLimit=50;
const $=id=>document.getElementById('draft-board-'+id);
const clamp=(value,min,max)=>Math.max(min,Math.min(value,max));
const coord=value=>Math.round(clamp(value,0,boardLimit)*100)/100;
const sameRect=(a,b)=>['x','y','w','h'].every(key=>a[key]===b[key]);

export function attachDraftBoard({workspace,callTool,notify}) {
  const panel=$('panel'),surface=$('surface'),scroll=$('scroll'),notes=$('notes'),status=$('status'),handles=$('handles');
  const ink=$('ink'),preview=$('preview'),textLayer=$('text');
  const ctx=ink.getContext('2d'),live=preview.getContext('2d'),textCtx=textLayer.getContext('2d');
  let items=[],revision='',brush='pen',selectedBrush=brush,color=$('color').value;
  let gesture=null,presses=[],edit=null,lastNoteMove=-Infinity;
  let busy=false,baseline=items,baselineName='',saveTimer,saving=null,leaving=false,scratchRevision=null,retryAction;
  let folder='',boardPath='',legacyRevision,defaultName='草稿1',selectedNote=null,shape='';
  let selection=null,selectionTimer,zoom=1,offsetX=0,offsetY=0,space=false,framePending=0;
  let dragging=null,noteRects=new Map();
  const widths=Object.fromEntries([...Object.keys(brushStyles),'shape'].map(name=>[name,brushStyles[name]?.width??2]));
  const dial=$('width'),brushButtons=[...panel.querySelectorAll('[data-board-brush]')];
  for(const control of panel.querySelectorAll('[data-board-icon]'))control.prepend(icon(control.dataset.boardIcon));
  const assets=new WeakMap(),renderer=createBoardRenderer(assets);
  const undo=[],redo=[];
  const isDirty=()=>items!==baseline||(!boardPath&&$('title').value!==baselineName);
  const editingBlocked=()=>busy||!revision||leaving;
  async function decode(item){
    if(item.kind!=='cut')return;
    const layers=await Promise.all(['ink','text'].map(key=>{
      if(!item[key])return null;
      const image=new Image();image.src=item[key];return image.decode().then(()=>image);
    }));
    assets.set(item,layers);
  }
  function screen([x,y]){return [x*zoom+offsetX,y*zoom+offsetY];}
  function panTo(x,y){offsetX=clamp(x,-boardLimit*zoom,0);offsetY=clamp(y,-boardLimit*zoom,0);}
  function redraw() {
    const width=surface.clientWidth,height=surface.clientHeight;if(!width||!height){noteRects.clear();return;}
    const dpr=Math.min(devicePixelRatio||1,Math.sqrt(12000000/(width*height)),8192/Math.max(width,height));
    const pixelWidth=Math.ceil(width*dpr),pixelHeight=Math.ceil(height*dpr);
    for(const context of [ctx,live,textCtx]){
      if(context.canvas.width!==pixelWidth||context.canvas.height!==pixelHeight){context.canvas.width=pixelWidth;context.canvas.height=pixelHeight;}
      context.setTransform(zoom*dpr,0,0,zoom*dpr,offsetX*dpr,offsetY*dpr);
    }
    const area={x:-offsetX/zoom,y:-offsetY/zoom,w:width/zoom,h:height/zoom};
    noteRects=renderer.frame(ctx,textCtx,items,selection,edit?.index,dragging,area,zoom*dpr);
    clear(live);
    if(gesture?.kind==='shape'&&gesture.item)paint(live,gesture.item);
    if(gesture?.active){
      if(gesture.brush==='eraser')paint(ctx,gesture);
      else if(gesture.brush!=='lasso')paint(live,gesture);
    }
    surface.style.setProperty('--board-grid',`${Math.max(12,24*zoom)}px`);
    surface.style.backgroundPosition=`${offsetX}px ${offsetY}px`;
    surface.style.setProperty('--board-left-edge',offsetX===0?'1px':'0');
    surface.style.setProperty('--board-top-edge',offsetY===0?'1px':'0');
    $('outline').setAttribute('viewBox',`0 0 ${width} ${height}`);
    if(selection)outline(selection.points.map(p=>transformedPoint(p,selection)),true);
    else if(gesture?.brush==='lasso'&&gesture.active)outline(gesture.points);else outline();
  }
  function render(){if(panel.hidden)return;redraw();renderNotes();if(edit)placeEditor(gesture?.kind==='resizeNote'?{...edit,note:gesture.item}:edit);}
  function queueRender(){if(!framePending)framePending=requestAnimationFrame(()=>{framePending=0;render();});}
  function placeRect(node,rect) {
    const [x,y]=screen([rect.x,rect.y]);node.style.left=`${x}px`;node.style.top=`${y}px`;
    node.style.width=`${rect.w*zoom}px`;node.style.height=`${rect.h*zoom}px`;
  }
  const allowsText=()=>['fine','pen','marker','text'].includes(brush)&&!space;
  const currentNote=()=>edit?.note??items[selectedNote];
  const activeColor=()=>currentNote()?.color??color;
  function placeGrip(rect){
    const grip=$('note-grip');
    grip.hidden=!rect||Boolean(selection)||!allowsText();
    if(grip.hidden)return;
    const [x,y]=screen([rect.x+rect.w,rect.y+Math.min(rect.h/2,14)]);
    grip.style.left=`${x}px`;grip.style.top=`${y}px`;
  }
  function placeEditor({input,note}){
    const rect=renderer.noteRect({...note,text:input.value}),s=rect.scale*zoom;
    const w=Math.max(42,(note.width===undefined?rect.w:(rect.wrapWidth+rect.padX*2)*rect.scale)*zoom+3*s)/zoom;
    placeRect(input,{...rect,w});
    input.style.fontFamily=rect.family;input.style.fontSize=`${rect.size*s}px`;
    input.style.lineHeight=`${rect.lineHeight*s}px`;input.style.padding=`${rect.padY*s}px ${rect.padX*s}px`;
    input.style.setProperty('--note-color',note.color);placeGrip({...rect,w});
  }
  function renderNotes() {
    const selected=noteRects.get(selectedNote),width=items[selectedNote]?.width;
    placeGrip(!edit&&selected?{...selected,w:width===undefined?selected.w:(width+selected.padX*2)*selected.scale}:null);
    const existing=new Map([...notes.querySelectorAll('[data-note]')].map(node=>[Number(node.dataset.note),node]));
    for(const [index,rect] of noteRects){
      if(!rect.editable)continue;
      const item=items[index];
      let note=existing.get(index);
      if(note)existing.delete(index);
      else {
        note=document.createElement('button');note.type='button';note.className='board-note';
        note.dataset.note=index;note.title='拖动移动 · 双击编辑';notes.append(note);
      }
      note.hidden=edit?.index===index;note.dataset.selected=String(selectedNote===index);note.setAttribute('aria-label',item.text);
      const x=Math.min(rect.padX*rect.scale,2),y=Math.min(rect.padY*rect.scale,2);
      placeRect(note,{x:rect.x+x,y:rect.y+y,w:rect.w-x*2,h:rect.h-y*2});
      if(selectedNote===index){note.style.clipPath='';continue;}
      const scale=rect.scale*zoom;
      const regions=rect.lineWidths.flatMap((width,line)=>{
        if(!width)return [];
        const left=Math.max(0,(rect.padX*rect.scale-x)*zoom-1);
        const top=Math.max(0,(rect.padY*rect.scale-y)*zoom+line*rect.lineHeight*scale);
        const right=left+width*scale+2,bottom=top+Math.min(rect.lineHeight,rect.size+3)*scale;
        return `M${left} ${top}H${right}V${bottom}H${left}Z`;
      });
      note.style.clipPath=regions.length?`path("${regions.join(' ')}")`:'';
    }
    for(const node of existing.values())node.remove();
  }
  function setStatus(message,error=false) {
    status.textContent=message;status.dataset.error=String(error);
    $('retry').hidden=!error;
  }
  function updateControls() {
    surface.dataset.brush=space?'pan':brush;panel.setAttribute('aria-busy',String(busy));
    surface.dataset.panning=String(gesture?.kind==='pan');
    $('eraser').setAttribute('aria-pressed',String(brush==='eraser'));
    $('lasso').setAttribute('aria-pressed',String(brush==='lasso'));
    $('pan').setAttribute('aria-pressed',String(brush==='pan'));
    $('add-note').setAttribute('aria-pressed',String(Boolean(edit)||brush==='text'));
    $('shape').dataset.active=String(brush==='shape');$('shape').value=brush==='shape'?shape:'';
    const note=currentNote();
    $('text-tools').hidden=!note||!allowsText();
    if(note){
      $('font').value=note.font??'system';
      if(document.activeElement!==$('font-size'))$('font-size').value=String(note.fontSize??21);
    }
    for(const control of $('text-tools').querySelectorAll('button,input,select'))control.disabled=editingBlocked();
    $('title').disabled=editingBlocked();$('title').readOnly=Boolean(boardPath);
    $('save').hidden=Boolean(boardPath);$('save').disabled=editingBlocked()||!items.length;
    $('clear').disabled=editingBlocked()||!items.length;
    $('color').value=activeColor();
    for(const button of brushButtons)button.setAttribute('aria-pressed',String(button.dataset.boardBrush===brush));
    for(const button of panel.querySelectorAll('[data-board-color]')) {
      button.style.setProperty('--swatch',button.dataset.boardColor);
      button.setAttribute('aria-pressed',String(button.dataset.boardColor===activeColor()));
    }
    for(const control of panel.querySelectorAll('.board-tools button,.board-tools input,.board-tools select'))control.disabled=editingBlocked();
    dial.tabIndex=canAdjustWidth()?0:-1;dial.setAttribute('aria-disabled',String(!canAdjustWidth()));
    updateWidth();
    $('retry').disabled=busy||leaving;
    for(const control of panel.querySelectorAll('#draft-board-transform button'))control.disabled=editingBlocked();
    $('undo').disabled=editingBlocked()||!undo.length;$('redo').disabled=editingBlocked()||!redo.length;
    $('zoom-out').disabled=editingBlocked()||zoom<=.1;$('zoom-in').disabled=editingBlocked()||zoom>=8;
    $('zoom-reset').textContent=`${Math.round(zoom*100)}%`;
    $('help').textContent=selection?'拖动选区 · 拖角点缩放 · Enter 落定':brush==='lasso'?'圈选笔迹和图形 · 文字单独移动':brush==='eraser'?'橡皮只擦笔迹 · 右键拖动画布':brush==='pan'?'拖动画布 · Ctrl＋滚轮缩放':brush==='shape'?'拖动绘制'+shapes[shape]:note?'双击编辑 · 拖右侧调宽度':'双击写字 · 右键按住拖动画布';
  }
  const canAdjustWidth=()=>!editingBlocked()&&Object.hasOwn(widths,brush)&&Boolean(workspace.features.draftBoardBrushWidth);
  function updateWidth(){
    const width=widths[brush]??widths[selectedBrush];$('width-value').textContent=String(width);dial.setAttribute('aria-valuenow',String(width));
    dial.setAttribute('aria-valuetext',`${width} 像素`);
    dial.style.setProperty('--dial-fill',`${(width-brushWidthRange.min)/(brushWidthRange.max-brushWidthRange.min)*100}%`);
    const label=brush==='eraser'?'橡皮粗细':brush==='shape'?'图形线宽':'画笔粗细';
    dial.setAttribute('aria-label',label);dial.title=`${label}：${width} px（滚轮或上下拖动）`;
  }
  function setWidth(value,pen=brush){widths[pen]=clamp(value,brushWidthRange.min,brushWidthRange.max);updateWidth();}
  dial.addEventListener('wheel',event=>{
    if(!canAdjustWidth()||event.ctrlKey||event.metaKey||!event.deltaY)return;
    event.preventDefault();
    const steps=event.deltaMode===0?clamp(Math.round(Math.abs(event.deltaY)/100),1,4):1;
    setWidth(widths[brush]-Math.sign(event.deltaY)*steps);
  },{passive:false});
  dial.addEventListener('keydown',event=>{
    if(!canAdjustWidth()||event.ctrlKey||event.metaKey||event.altKey)return;
    const current=widths[brush],steps={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1,PageUp:5,PageDown:-5};
    if(Object.hasOwn(steps,event.key))setWidth(current+steps[event.key]);
    else if(event.key==='Home')setWidth(brushWidthRange.min);else if(event.key==='End')setWidth(brushWidthRange.max);else return;
    event.preventDefault();
  });
  let dialDrag;
  dial.addEventListener('pointerdown',event=>{
    if(event.button!==0||!canAdjustWidth()||dialDrag)return;
    event.preventDefault();dial.focus({preventScroll:true});dial.setPointerCapture(event.pointerId);
    dialDrag={id:event.pointerId,y:event.clientY,start:widths[brush],pen:brush};
  });
  dial.addEventListener('pointermove',event=>{
    if(dialDrag?.id===event.pointerId)setWidth(dialDrag.start+Math.round((dialDrag.y-event.clientY)/4),dialDrag.pen);
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])dial.addEventListener(type,event=>{
    if(dialDrag?.id===event.pointerId)dialDrag=null;
  });
  function changed() {
    renderer.invalidate();scheduleSave();
  }
  function scheduleSave(){
    clearTimeout(saveTimer);
    if(!revision||!isDirty())return;
    setStatus(boardPath?'等待自动保存':'等待暂存');
    saveTimer=setTimeout(()=>void flush(),300);
  }
  async function flush(){
    clearTimeout(saveTimer);
    if(!revision)return false;
    if(saving){
      if(!await saving)return false;
      return flush();
    }
    if(!isDirty())return true;
    const snapshot=items,name=$('title').value,board={version:3,items:snapshot};
    setStatus(boardPath?'正在保存…':'正在暂存…');
    const target=boardPath?'update_board':'save_board_scratch';
    const args=boardPath?{path:boardPath,board,revision}:{folder,board,name,revision:scratchRevision,...(legacyRevision?{legacyRevision}:{})};
    const request=(async()=>{
      try{
        const result=await callTool(target,args);
        if(boardPath)revision=result.revision;else scratchRevision=result.revision;
        baseline=snapshot;baselineName=name;
        if(isDirty())scheduleSave();else setStatus(boardPath?'已自动保存':'已暂存');
        return true;
      }catch(error){
        retryAction=()=>flush();
        setStatus((boardPath?'自动保存失败：':'暂存失败：')+error.message,true);
        return false;
      }
    })();
    saving=request;
    try{return await request;}
    finally{if(saving===request)saving=null;}
  }
  async function save() {
    if(!items.length){setStatus('画板没有内容');return false;}
    setStatus('正在保存…');
    try {
      const result=await callTool('save_named_draft_board',{board:{version:3,items},folder,
        name:$('title').value.trim()||defaultName,scratchRevision,...(legacyRevision?{legacyRevision}:{})});
      if(!result.resetRevision){
        setStatus('已保存 · '+result.name+'，暂存画板仍保留。');
        workspace.revealBoardFolder(folder);void workspace.refreshFiles().catch(()=>{});return true;
      }
      resetBoard(result.defaultName);scratchRevision=result.resetRevision;
      setStatus('已保存 · '+result.name);
      workspace.revealBoardFolder(folder);
      void workspace.refreshFiles().catch(()=>{});
      return true;
    }catch(error){retryAction=()=>saveCurrent();setStatus('画板未保存：'+error.message,true);return false;}
  }
  function resetBoard(name){
    baseline=items=[];baselineName='';revision='ready';legacyRevision=undefined;scratchRevision=null;boardPath='';
    undo.length=0;redo.length=0;selectedNote=null;presses=[];brush=selectedBrush;
    defaultName=name;$('title').value='';$('title').title='默认保存为 '+defaultName;
    renderer.invalidate();fit();
  }
  function remember(previous) {
    undo.push(previous);if(undo.length>historyLimit)undo.shift();redo.length=0;updateControls();
  }
  function restore(from,to) {
    if(editingBlocked()||gesture)return;
    finishNote();if(selection){settleSelection(false);return;}if(!from.length)return;
    to.push(items);items=from.pop();selectedNote=null;changed();render();updateControls();
  }
  function point(event) {
    const rect=surface.getBoundingClientRect();
    return [coord((event.clientX-rect.left-offsetX)/zoom),coord((event.clientY-rect.top-offsetY)/zoom)];
  }
  function setZoom(value,clientX,clientY){
    if(editingBlocked()||gesture)return;
    const next=Math.round(clamp(value,.1,8)*100)/100;
    if(next===zoom)return;
    const view=surface.getBoundingClientRect();
    const x=clientX===undefined?view.width/2:clientX-view.left,y=clientY===undefined?view.height/2:clientY-view.top;
    const nextX=x-(x-offsetX)*next/zoom,nextY=y-(y-offsetY)*next/zoom;zoom=next;panTo(nextX,nextY);
    render();updateControls();
  }
  function fit(){
    if(!surface.clientWidth||!surface.clientHeight)return;
    const boxes=items.filter(i=>i.kind!=='stroke'||i.brush!=='eraser').map(i=>i.kind==='note'?renderer.noteRect(i):i.kind==='stroke'||i.kind==='shape'?inkBounds(i):i);
    if(!boxes.length){zoom=1;panTo(0,0);}
    else{
      const rect=bounds(boxes.flatMap(({x,y,w,h})=>[[x,y],[x+w,y+h]]));
      zoom=clamp(Math.floor(Math.min(1,(surface.clientWidth-60)/(rect.w||1),(surface.clientHeight-60)/(rect.h||1))*100)/100,.1,1);
      panTo(surface.clientWidth/2-(rect.x+rect.w/2)*zoom,surface.clientHeight/2-(rect.y+rect.h/2)*zoom);
    }
    render();updateControls();
  }
  $('zoom-out').onclick=()=>setZoom(zoom/1.25);
  $('zoom-in').onclick=()=>setZoom(zoom*1.25);
  $('zoom-reset').onclick=()=>setZoom(1);
  $('fit').onclick=()=>{if(!gesture&&!editingBlocked())fit();};
  scroll.addEventListener('wheel',event=>{
    if(event.target.closest('textarea')&&!(event.ctrlKey||event.metaKey))return;
    event.preventDefault();if(editingBlocked()||gesture)return;
    if(event.ctrlKey||event.metaKey){if(event.deltaY)setZoom(zoom*(event.deltaY<0?1.12:1/1.12),event.clientX,event.clientY);}
    else{const step=event.deltaMode===1?16:1;panTo(offsetX-(event.shiftKey?event.deltaY:event.deltaX)*step,offsetY-(event.shiftKey?0:event.deltaY)*step);queueRender();}
  },{passive:false});
  function beginNote(x,y,index=null) {
    if(editingBlocked()||gesture)return;
    if(!settleSelection(true))return;finishNote();
    if(index===null&&items.length>=boardLimits.items){setStatus('画板已满，可先撤销或删除一段文字。');return;}
    const original=index===null?null:items[index];
    const note=original??{kind:'note',x:coord(Math.min(x,(-offsetX+surface.clientWidth-52)/zoom)),y:coord(Math.min(y,(-offsetY+surface.clientHeight-35)/zoom)),color,text:'',font:'system',fontSize:21};
    selectedNote=index;
    const available=boardLimits.text-items.reduce((sum,item,i)=>sum+(item.kind==='note'&&i!==index?item.text.length:0),0);
    if(available<=0){setStatus('画板上的文字已达到容量上限。');return;}
    const input=document.createElement('textarea');
    input.className='board-note-input';input.setAttribute('aria-label','画板文字');input.placeholder='输入文字…';
    input.maxLength=Math.min(boardLimits.note,available);input.value=note.text;
    const element=index===null?null:notes.querySelector(`[data-note="${index}"]`);
    if(element)element.hidden=true;
    edit={input,index,note,before:items,applied:note,composing:false};
    input.addEventListener('input',()=>{if(edit?.input===input&&!edit.composing)refreshEditor();});
    input.addEventListener('compositionstart',()=>{if(edit?.input===input)edit.composing=true;});
    input.addEventListener('compositionend',()=>{if(edit?.input===input){edit.composing=false;refreshEditor();}});
    input.addEventListener('keydown',event=>{
      if(event.isComposing||edit?.composing)return;
      if(event.key==='Escape'||((event.ctrlKey||event.metaKey)&&event.key==='Enter')){
        event.preventDefault();event.stopPropagation();finishNote(event.key==='Escape');scroll.focus({preventScroll:true});
      }
    });
    notes.append(input);render();updateControls();
    input.focus({preventScroll:true});input.setSelectionRange(input.value.length,input.value.length);
  }
  function refreshEditor(){syncNote();placeEditor(edit);updateControls();}
  function syncNote() {
    if(!edit)return;
    const {input,note,index,before}=edit,text=input.value.trim()?input.value:'';
    if(text===edit.applied.text&&note===edit.applied)return;
    const next={...note,text};
    items=before.slice();
    if(index===null){if(text)items.push(next);}
    else items.splice(index,1,...(text?[next]:[]));
    edit.applied=next;edit.note=next;changed();
  }
  function finishNote(cancel=false) {
    if(!edit)return;
    if(!cancel)syncNote();
    const {input,before,index,applied}=edit;edit=null;
    if(cancel&&items!==before){items=before;changed();}
    else if(items!==before)remember(before);
    selectedNote=index===null?(!cancel&&applied.text?before.length:null):(items[index]?.kind==='note'&&(cancel||applied.text)?index:null);
    input.remove();render();updateControls();
  }
  const handleNodes=[...handles.querySelectorAll('[data-corner]')];
  function transformedPoint([x,y],{source,rect}) {
    return [rect.x+(x-source.x)*rect.w/source.w,rect.y+(y-source.y)*rect.h/source.h];
  }
  function outline(points=[],closed=false) {
    const d=points.length?`M${points.map(screen).map(([x,y])=>`${x},${y}`).join('L')}${closed?'Z':''}`:'';
    $('edge').setAttribute('d',d);$('edge-back').setAttribute('d',d);
    handles.hidden=!selection;$('transform').hidden=!selection;
    if(!selection)return;
    const {x,y,w,h}=selection.rect;
    for(const node of handleNodes){const corner=node.dataset.corner;
      const [px,py]=screen([x+(corner.includes('e')?w:0),y+(corner.includes('s')?h:0)]);
      node.style.left=`${px}px`;node.style.top=`${py}px`;
    }
  }
  function setSelectionRect(rect){
    selection.rect=rect;selection.cut={kind:'vectorCut',points:selection.points,...rect};

  }
  function startSelection(points) {
    const source=bounds(points);
    if(points.length<3||source.w<4||source.h<4){outline();return;}
    const hasInk=renderer.sampleInk(items,points,source);
    if(!hasInk){outline();setStatus('选区没有笔迹或图形');return;}
    selection={points,source,hasInk};setSelectionRect({...source});render();updateControls();
  }
  function settleSelection(commit) {
    clearTimeout(selectionTimer);
    if(!selection)return true;
    const {points,source,rect,cut}=selection;
    if(commit&&!sameRect(rect,source)){
      if(items.length>=boardLimits.items||items.reduce((n,i)=>n+(i.points?.length??0),points.length)>boardLimits.points){
        setStatus('画板容量已满，请取消选区后调整。');return false;
      }
      const before=items;
      items=[...items,cut];remember(before);changed();
    }
    selection=null;outline();render();updateControls();return true;
  }
  function armSelectionTimer(){clearTimeout(selectionTimer);selectionTimer=setTimeout(()=>settleSelection(true),4000);}
  function startTransform(event,start){
    if(!selection)return false;
    const corner=event.target.closest('[data-corner]')?.dataset.corner;
    if(!corner){
      ctx.save();ctx.resetTransform();
      const inside=ctx.isPointInPath(pointPath(selection.points.map(p=>transformedPoint(p,selection))),...start,'evenodd');ctx.restore();
      if(!inside)return false;
    }
    clearTimeout(selectionTimer);
    gesture={id:event.pointerId,kind:'transform',corner,start,initial:{...selection.rect}};
    surface.setPointerCapture(event.pointerId);return true;
  }
  function moveSelection(event,s){
    const [x,y]=point(event),[sx,sy]=s.start,old=s.initial,dx=x-sx,dy=y-sy;
    if(!s.corner)setSelectionRect({...old,x:coord(old.x+dx),y:coord(old.y+dy)});
    else{
      const east=s.corner.includes('e'),south=s.corner.includes('s'),ax=old.x+(east?0:old.w),ay=old.y+(south?0:old.h);
      const vx=east?old.w:-old.w,vy=south?old.h:-old.h;
      const maxScale=Math.min(12*selection.source.w/old.w,boardLimit/Math.max(old.w,old.h),east?Infinity:ax/old.w,south?Infinity:ay/old.h);
      const scale=clamp(1+(dx*vx+dy*vy)/(old.w**2+old.h**2),Math.min(maxScale,Math.max(4/old.w,4/old.h,selection.source.w*.12/old.w)),maxScale);
      const w=old.w*scale,h=old.h*scale;
      setSelectionRect({x:coord(east?ax:ax-w),y:coord(south?ay:ay-h),w,h});
    }
    queueRender();
  }
  function armStroke(s){
    if(gesture!==s||s.active)return;
    s.active=true;
    queueRender();
  }
  function addPoint(event,s) {
    const next=point(event),last=s.points.at(-1);
    if(s.points.length>=s.maxPoints||next[0]===last[0]&&next[1]===last[1])return;
    s.points.push(next);
    if(s.active)queueRender();
  }
  function endStroke(event,cancel=false) {
    const s=gesture;if(s?.id!==event.pointerId)return;
    clearTimeout(s.timer);
    if(s.kind==='transform'){
      if(cancel)setSelectionRect(s.initial);else moveSelection(event,s);
      gesture=null;
      if(surface.hasPointerCapture(s.id))surface.releasePointerCapture(s.id);
      render();if(selection&&!sameRect(selection.rect,selection.source))armSelectionTimer();
      return;
    }
    if(s.kind==='pan'||s.kind==='note'){
      if(!cancel)moveViewOrNote(event,s);
      gesture=null;
      if(surface.hasPointerCapture(s.id))surface.releasePointerCapture(s.id);
      if(s.kind==='pan'){
        if(cancel)panTo(s.offsetX,s.offsetY);
        delete surface.dataset.panning;
        if(selection&&!sameRect(selection.rect,selection.source))armSelectionTimer();
      }else if(!cancel&&dragging){
        lastNoteMove=performance.now();
        const before=items;items=items.map((item,index)=>index===s.index?dragging.note:item);remember(before);changed();
      }
      dragging=null;render();return;
    }
    if(s.kind==='shape'||s.kind==='resizeNote'){
      if(!cancel)moveShapeOrResize(event,s);
      gesture=null;
      if(surface.hasPointerCapture(s.id))surface.releasePointerCapture(s.id);
      if(s.kind==='shape'&&s.item&&!cancel){
        const before=items;items=[...items,s.item];remember(before);changed();
      }else if(s.kind==='resizeNote'&&s.item!==s.note&&!cancel&&s.item.width!==s.width)formatNote({width:s.item.width});
      dragging=null;render();updateControls();return;
    }
    if(!cancel){addPoint(event,s);if(!s.active&&s.moved)armStroke(s);}
    gesture=null;clear(live);
    if(surface.hasPointerCapture(s.id))surface.releasePointerCapture(s.id);
    if(cancel){if(s.brush==='eraser')redraw();if(s.brush==='lasso')outline();return;}
    presses.push(s.active);if(presses.length>2)presses.shift();
    if(!s.active)return;
    if(s.brush==='lasso'){startSelection(s.points);return;}
    const {brush,color,points,width}=s,previous=items,stroke={kind:'stroke',brush,color,points,...(width===undefined?{}:{width})};
    items=[...items,stroke];remember(previous);changed();render();
  }
  function moveViewOrNote(event,s){
    const dx=event.clientX-s.x,dy=event.clientY-s.y;
    if(s.kind==='pan')panTo(s.offsetX+dx,s.offsetY+dy);
    else if(dragging||Math.hypot(dx,dy)>=moveThreshold){
      if(!dragging){surface.setPointerCapture(s.id);s.target.blur();}
      dragging={index:s.index,note:{...s.note,x:coord(s.note.x+dx/zoom),y:coord(s.note.y+dy/zoom)}};
    }
    queueRender();
  }
  function moveShapeOrResize(event,s){
    if(s.kind==='shape'){
      const end=point(event);
      if(s.item||Math.hypot((end[0]-s.start[0])*zoom,(end[1]-s.start[1])*zoom)>=moveThreshold){
        s.item={kind:'shape',shape:s.shape,color:s.color,points:[s.start,end],width:s.width};
      }
    }else if(s.item!==s.note||Math.abs(event.clientX-s.x)>=2){
      const width=Math.round(clamp(s.width+(event.clientX-s.x)/s.scale,noteWidthRange.min,noteWidthRange.max));
      s.item={...s.note,width};
      if(edit)placeEditor({...edit,note:s.item});else dragging={index:s.index,note:s.item};
    }
    if(!edit)queueRender();
  }
  surface.addEventListener('pointerdown',event=>{
    if(editingBlocked()||gesture||event.button!==2&&event.target.closest('textarea'))return;
    if(event.button===2||event.button===1||event.button===0&&(brush==='pan'||space)){
      event.preventDefault();finishNote();scroll.focus({preventScroll:true});clearTimeout(selectionTimer);
      gesture={kind:'pan',id:event.pointerId,x:event.clientX,y:event.clientY,offsetX,offsetY};surface.dataset.panning='true';surface.setPointerCapture(event.pointerId);return;
    }
    if(event.button!==0)return;
    if(event.target===$('note-grip')){
      const note=currentNote(),rect=renderer.noteRect(note);
      event.preventDefault();
      gesture={kind:'resizeNote',id:event.pointerId,index:selectedNote,note,item:note,x:event.clientX,
        scale:rect.scale*zoom,width:note.width??rect.w/rect.scale-rect.padX*2};
      surface.setPointerCapture(event.pointerId);return;
    }
    const targetNote=event.target.closest('[data-note]');
    if(targetNote&&allowsText()&&!selection){
      finishNote();const index=Number(targetNote.dataset.note);
      if(items[index]?.kind!=='note')return;
      selectedNote=index;render();updateControls();
      gesture={kind:'note',id:event.pointerId,x:event.clientX,y:event.clientY,index,note:items[index],target:targetNote};return;
    }
    const start=point(event);
    event.preventDefault();scroll.focus({preventScroll:true});
    if(startTransform(event,start))return;
    if(selection){settleSelection(true);return;}
    finishNote();selectedNote=null;updateControls();render();
    if(brush==='text')return;
    // Let quick clicks go through untouched so the browser can detect a double click.
    const maxPoints=Math.min(boardLimits.stroke,boardLimits.points-items.reduce((n,item)=>n+(item.points?.length??0),0));
    if(items.length>=boardLimits.items||maxPoints<1){setStatus('画板已满，可先撤销一些笔迹。');return;}
    if(brush==='shape'){
      if(maxPoints<2){setStatus('画板已达到容量上限。');return;}
      gesture={kind:'shape',id:event.pointerId,start,shape,color,width:widths.shape};
      surface.setPointerCapture(event.pointerId);return;
    }
    const width=widths[brush]!==brushStyles[brush]?.width?widths[brush]:undefined;
    const s={id:event.pointerId,x:event.clientX,y:event.clientY,brush,color,width,points:[start],maxPoints};
    gesture=s;surface.setPointerCapture(s.id);
    if(brush==='eraser')armStroke(s);else s.timer=setTimeout(()=>armStroke(s),holdTime);
  });
  surface.addEventListener('pointermove',event=>{
    const s=gesture;if(s?.id!==event.pointerId)return;
    if(s.kind==='transform'){moveSelection(event,s);return;}
    if(s.kind==='shape'||s.kind==='resizeNote'){moveShapeOrResize(event,s);return;}
    if(s.kind==='note'||s.kind==='pan'){moveViewOrNote(event,s);return;}
    if(Math.hypot(event.clientX-s.x,event.clientY-s.y)>=moveThreshold){s.moved=true;armStroke(s);}
    for(const sample of event.getCoalescedEvents?.()??[])addPoint(sample,s);
    addPoint(event,s);
  });
  surface.addEventListener('pointerup',event=>endStroke(event));
  surface.addEventListener('contextmenu',event=>event.preventDefault());
  surface.addEventListener('pointerleave',event=>{if(gesture?.kind==='note'&&!dragging)endStroke(event,true);});
  for(const type of ['pointercancel','lostpointercapture'])surface.addEventListener(type,event=>endStroke(event,true));
  surface.addEventListener('dblclick',event=>{
    if(event.button!==0||!allowsText()||event.target.closest('textarea'))return;
    const node=event.target.closest('[data-note]');
    if(node||(!presses.some(Boolean)&&performance.now()-lastNoteMove>=280))beginNote(...point(event),node?Number(node.dataset.note):null);
    presses=[];
  });
  notes.addEventListener('click',event=>{
    const node=event.target.closest('[data-note]');if(node&&event.detail===0&&allowsText())beginNote(0,0,Number(node.dataset.note));
  });
  $('add-note').onclick=()=>{
    if(edit&&brush==='text'){switchTool(selectedBrush);return;}
    if(!switchTool('text'))return;
    const rect=scroll.getBoundingClientRect();
    beginNote(...point({clientX:rect.left+Math.min(120,scroll.clientWidth/3),clientY:rect.top+Math.min(96,scroll.clientHeight/3)}));
  };
  function switchTool(next){
    if(!settleSelection(true))return false;
    finishNote();selectedNote=null;brush=next;
    if(['fine','pen','marker'].includes(next))selectedBrush=next;
    presses=[];render();updateControls();return true;
  }
  for(const button of brushButtons)button.onclick=()=>switchTool(button.dataset.boardBrush);
  $('eraser').onclick=()=>switchTool(brush==='eraser'?selectedBrush:'eraser');
  $('lasso').onclick=()=>switchTool(brush==='lasso'?selectedBrush:'lasso');
  $('pan').onclick=()=>switchTool(brush==='pan'?selectedBrush:'pan');
  $('shape').onchange=()=>{shape=$('shape').value;switchTool(shape?'shape':selectedBrush);};
  function formatNote(style){
    if(edit){
      const {input}=edit,{selectionStart,selectionEnd,selectionDirection}=input;
      edit.note={...edit.note,...style};syncNote();placeEditor(edit);
      if(document.activeElement===input)input.setSelectionRange(selectionStart,selectionEnd,selectionDirection);
    }else if(selectedNote!==null&&items[selectedNote]?.kind==='note'){
      const before=items,note={...items[selectedNote],...style};
      items=items.map((item,index)=>index===selectedNote?note:item);remember(before);changed();render();
    }
    updateControls();
  }
  function chooseColor(value){
    if(currentNote())formatNote({color:value});
    else{color=value;updateControls();}
  }
  $('font').onchange=()=>formatNote({font:$('font').value});
  $('font-size').onchange=()=>{
    const value=Math.round(clamp($('font-size').valueAsNumber||21,noteSizeRange.min,noteSizeRange.max));
    $('font-size').value=value;formatNote({fontSize:value});
  };
  $('text-done').onclick=()=>{finishNote();selectedNote=null;if(brush==='text')brush=selectedBrush;render();updateControls();scroll.focus({preventScroll:true});};
  for(const swatch of panel.querySelectorAll('[data-board-color]'))swatch.onpointerdown=event=>{if(edit)event.preventDefault();};
  $('color').oninput=()=>chooseColor($('color').value);
  for(const swatch of panel.querySelectorAll('[data-board-color]'))swatch.onclick=()=>chooseColor(swatch.dataset.boardColor);
  $('undo').onclick=()=>restore(undo,redo);$('redo').onclick=()=>restore(redo,undo);
  document.addEventListener('keydown',event=>{
    if(panel.hidden||event.isComposing||event.defaultPrevented||document.querySelector('dialog[open]'))return;
    const key=event.key.toLowerCase();
    if(event.code==='Space'&&!event.target.closest('button:not(.board-note),textarea,input,select,[role="spinbutton"],[contenteditable]')){
      event.preventDefault();space=true;updateControls();return;
    }
    if(key==='escape'&&event.target.matches('textarea,input,select'))return;
    if(key==='escape'||key==='enter'&&selection&&!event.target.closest('button,textarea,select,input')){
      event.preventDefault();event.stopImmediatePropagation();
      if(gesture)endStroke({pointerId:gesture.id},true);
      if(selection)settleSelection(key==='enter');
      else if(edit)finishNote(true);
      else if(selectedNote!==null||brush==='text'){selectedNote=null;if(brush==='text')brush=selectedBrush;render();updateControls();}
      else if(key==='escape')void requestClose();
      return;
    }
    if(!(event.ctrlKey||event.metaKey))return;
    if(key==='s'){event.preventDefault();event.stopImmediatePropagation();if(boardPath){finishNote();if(settleSelection(true))void flush();}else void saveCurrent();}
    if(key==='f'){event.preventDefault();event.stopImmediatePropagation();}
    if((key==='z'||key==='y')&&!event.target.matches('textarea,input')){
      event.preventDefault();if(key==='y'||event.shiftKey)restore(redo,undo);else restore(undo,redo);
    }
  },true);
  document.addEventListener('keyup',event=>{if(event.code==='Space'&&space){space=false;updateControls();}});
  window.addEventListener('blur',()=>{if(space){space=false;updateControls();}});
  new ResizeObserver(queueRender).observe(surface);
  async function load() {
    busy=true;updateControls();setStatus('正在读取画板…');
    try {
      const data=await callTool('open_draft_board',{folder,...(boardPath?{path:boardPath}:{})});
      const loaded=alignBoardToOrigin(data.board.items);
      await Promise.all(loaded.map(decode));
      const loadedPath=boardPath;
      resetBoard(data.defaultName);
      boardPath=loadedPath;revision=boardPath?data.revision:'ready';scratchRevision=boardPath?null:data.revision;
      $('title').value=baselineName=data.name??'';legacyRevision=data.legacyRevision;baseline=items=loaded;fit();
      setStatus(items.length?'已从本机恢复':'');
    }catch(error){revision='';baseline=items=[];render();retryAction=()=>load();setStatus('画板未打开：'+error.message,true);}
    finally{busy=false;updateControls();}
  }
  $('retry').onclick=()=>void retryAction?.();
  async function open(nextFolder,nextPath=''){
    if(workspace.features.draftBoardVersion!==4){notify('请点击顶部“更新工作台”，加载新版画板服务。');return;}
    if(!panel.hidden){
      if(folder===nextFolder&&boardPath===nextPath){scroll.focus({preventScroll:true});return;}
      if(!await requestClose())return;
    }
    folder=nextFolder;boardPath=nextPath;
    workspace.setBoardView(true,folder,boardPath);scroll.focus({preventScroll:true});void load();
  }
  async function requestClose() {
    if(busy||leaving)return false;
    if(gesture)endStroke({pointerId:gesture.id},true);
    finishNote();if(!settleSelection(true))return false;
    leaving=true;updateControls();
    try{
      if(revision&&!await flush())return false;
      clearTimeout(saveTimer);space=false;selectedNote=null;noteRects.clear();notes.replaceChildren();
      workspace.setBoardView(false);
      return true;
    }finally{leaving=false;updateControls();}
  }
  async function saveCurrent() {
    if(busy||gesture)return false;
    finishNote();if(!settleSelection(true))return false;
    busy=true;updateControls();
    try{return await flush()&&await save();}
    finally{busy=false;updateControls();}
  }
  $('apply').onclick=()=>settleSelection(true);$('cancel-cut').onclick=()=>settleSelection(false);
  $('save').onclick=()=>void saveCurrent();
  $('title').oninput=scheduleSave;
  $('title').onkeydown=event=>{if(event.key==='Enter'&&!event.isComposing&&!boardPath){event.preventDefault();void saveCurrent();}};
  const clearDialog=$('clear-dialog');
  $('clear').onclick=()=>{
    if(editingBlocked()||gesture)return;
    finishNote();settleSelection(false);
    if(items.length)clearDialog.showModal();
  };
  $('clear-cancel').onclick=()=>clearDialog.close();
  $('clear-confirm').onclick=()=>{
    clearDialog.close();
    const before=items;items=[];selectedNote=null;remember(before);changed();render();updateControls();
  };
  function flushBeforeHide(){
    if(panel.hidden||!revision)return;
    if(edit&&!edit.composing)syncNote();
    if(!gesture&&selection&&!settleSelection(true))return;
    return flush();
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)flushBeforeHide();});
  window.addEventListener('pagehide',flushBeforeHide);
  window.addEventListener('beforeunload',event=>{
    if(panel.hidden||!revision||!isDirty())return;
    flushBeforeHide();event.preventDefault();event.returnValue='';
  });
  workspace.setBoardHandlers({open,close:requestClose});
  updateControls();
  return {flushBeforeHide,async flushForUpdate(){if(panel.hidden)return;if(busy||gesture||edit?.composing)throw Error('请先完成当前画板操作。');if(await flushBeforeHide()!==true)throw Error('画板尚未保存，更新已停止。');}};
}
