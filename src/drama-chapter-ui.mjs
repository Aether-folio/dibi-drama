import {controlIcon} from './drama-navigation.mjs';
import {parseStoryboard,sourceRange} from './drama-storyboard.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn=(label,action,attrs='')=>`<button type="button" data-drama-action="${action}" ${attrs}>${label}</button>`;
export function attachChapterUI({root,workspace,editor,callTool,openPen,getState,setState,navigate,dispatch,render}){
 let sourceDoc=null,view='text',sourceShot='',showOriginal=true,docRevision='',sourceChanged=false,mountToken=0;
 const panel=document.getElementById('document-panel'),home=document.createComment('writing-editor-home');panel.before(home);
 const extras=['selection-menu','pen-toolbar'].map(id=>document.getElementById(id)).filter(Boolean),homes=extras.map(el=>{const h=document.createComment(el.id+'-home');el.before(h);return h;});
 function decorate(){if(!panel.closest('#drama-dialog'))return;for(const el of document.getElementById('draft-body').children){if(el.hasAttribute('data-editor-decoration'))continue;el.classList.toggle('dr-shot-anchor',/^<!--\s*shot:[0-9a-f-]{36}\s*-->$/.test(el.textContent.trim()));el.classList.toggle('dr-shot-heading',/^##\s/.test(el.textContent));}}
 new MutationObserver(decorate).observe(document.getElementById('draft-body'),{childList:true,subtree:true,characterData:true});
 const current=()=>getState().value.project.chapters.find(c=>c.id===getState().activeChapter);
 const sources=()=>workspace.files.filter(f=>f.path.startsWith(getState().workPath+'/正文/')&&/\.(md|txt)$/i.test(f.path));
 const pendingBoard=()=>getState().value.jobs.filter(j=>j.kind==='board'&&j.chapterId===current()?.id&&!['adopted','cancelled','stale'].includes(j.status)).at(-1);
 const draftPath=()=>pendingBoard()?.status==='candidate'?pendingBoard().candidateDraftPath:current()?.draftPath;
 function park(){++mountToken;document.getElementById('selection-menu').hidden=true;if(panel.closest('#drama-dialog'))home.after(panel);document.getElementById('draft-title').readOnly=false;extras.forEach((el,i)=>{if(el.closest('#drama-dialog'))homes[i].after(el);});}
 function sourcePage(){return sourceDoc?`<div class="dr-row dr-between dr-source-heading"><h3>${esc(sourceDoc.title)}</h3>${btn('拆分镜','chapter-start','class="primary"')}</div><label class="dr-field"><span>拆镜要求 / 画风</span><textarea data-chapter-direction rows="2" placeholder="画风、节奏或希望重点处理的段落">${esc(current()?.direction||'')}</textarea></label><article class="dr-manuscript">${esc(sourceDoc.body)}</article>`:'<div class="dr-empty-work"><h3>从一章正文开始</h3><p>在左侧原文库选择章节，阅读正文后点击“拆分镜”。</p><p>章节任务、分镜稿和制作结果会保存在工作区。</p></div>';}
 function review(cards){const c=current();if(!c)return '<div class="dr-empty-work"><h3>选择章节任务</h3><p>在原文库打开章节并拆分镜，或在工作区选择已有章节。</p></div>';
  const pending=pendingBoard();
  const toggle=`<div class="dr-row dr-between dr-board-toolbar"><div class="dr-row" aria-label="分镜展示格式">${btn('文本稿','board-view','data-view="text" aria-pressed="'+(view==='text')+'"')}${btn('分镜卡片','board-view','data-view="cards" aria-pressed="'+(view==='cards')+'"')}</div>${controlIcon('compare','toggle-original',showOriginal?'切换到素材库':'显示原文对照','aria-pressed="'+showOriginal+'"')}</div>`;
  if(pending?.status==='candidate')return `<section class="dr-board-candidate"><div class="dr-row dr-board-actions"><h3>${esc(c.name)} · 分镜候选</h3>${btn('采用到分镜稿','accept','data-id="'+pending.id+'" class="primary"')}${btn('取消候选','cancel','data-id="'+pending.id+'"')}</div><p class="dr-muted">选中文字后点击“递笔”，可修改候选；确认后采用到分镜稿。</p><div class="dr-storyboard-editor"></div></section>`;
  if(pending&&['pending','claimed'].includes(pending.status))return toggle+`<div class="dr-empty-work"><h3>正在拆分镜</h3><p>当前章节：${esc(c.name)}。完成后先审核文本候选。</p>${btn('查看处理记录','tab','data-tab="tasks"')}</div>`;
  const history=c.history.length?`<details class="dr-board-history"><summary>分镜历史 · ${c.history.length} 版</summary>${c.history.map((h,i)=>`<div class="dr-row"><span>${esc(new Date(h.createdAt).toLocaleString())}</span>${btn('恢复到文本稿','restore-board','data-index="'+i+'"')}</div>`).join('')}</details>`:'';
  return toggle+`<div class="dr-row dr-board-actions"><h3>${esc(c.name)} · 分镜</h3><span class="dr-muted" data-board-revision>第 ${c.version} 版</span>${btn('更新分镜卡片','apply-board','class="primary"')}${btn('重新拆本章','chapter-again')}</div>`+history+(view==='text'?'<p class="dr-muted">选中文字或放置光标，使用递笔调整；修改完成后更新分镜卡片。切换视图不会调用 AI。</p><div class="dr-storyboard-editor"></div>':cards());
 }
 function originalPane(){const c=current();if(!c)return '';const s=getState().value.project.shots.find(s=>s.id===sourceShot),range=s?.sourceRange??sourceRange(c.source,s?.sourceExcerpt);let body=esc(c.source);if(range)body=esc(c.source.slice(0,range.start))+'<mark data-source-highlight>'+esc(c.source.slice(range.start,range.end))+'</mark>'+esc(c.source.slice(range.end));
  return `<aside id="drama-right-panel" class="dr-original" aria-label="原文对照"><div class="dr-side-heading"><h3>原文对照</h3>${controlIcon('right','toggle-library','收起原文对照','aria-controls="drama-right-panel" aria-expanded="true"')}</div><strong>${esc(c.name)}</strong>${sourceChanged?'<p class="dr-state-missing">章节原文已变化；当前显示本次拆镜使用的原文版本。</p>':''}<p class="dr-muted">${sourceShot?(range?'已定位对应原文':'此镜头的原文位置待核对'):'点击分镜空白处，定位对应原文。'}</p><div class="dr-original-body">${body}</div></aside>`;
 }
 async function mount(){const host=root.querySelector('.dr-storyboard-editor'),c=current(),path=draftPath();if(!root.open||!host||!c)return;if(!path)throw Error('候选编辑需要新版服务，请点击顶部“更新工作台”。');const token=++mountToken;
  if(workspace.path!==path){const isCurrent=()=>root.open&&token===mountToken&&host.isConnected&&draftPath()===path;const opened=await workspace.openDocument(path,{shouldOpen:isCurrent});if(!isCurrent())return;if(!opened)throw Error('未能打开分镜文本稿，请刷新后重试。');}host.append(panel);document.getElementById('draft-title').readOnly=true;if(pendingBoard()?.status==='candidate')document.getElementById('draft-title').value=c.name+' · 分镜候选';extras.forEach(el=>root.append(el));panel.hidden=false;decorate();docRevision=workspace.revision;
  const badge=root.querySelector('[data-board-revision]');if(badge&&workspace.revision!==c.draftRevision)badge.textContent='文本已修改 · 分镜卡片待更新';
 }
 async function switchView(next){
  await workspace.flushDocument();park();view=next;
  const c=current();
  if(next==='text'&&c&&workspace.path===c.draftPath){
   const doc=await callTool('read_document',{path:c.draftPath});
   if(doc.revision!==workspace.revision&&!await workspace.openDocument(c.draftPath))throw Error('未能刷新分镜文本稿，请重试。');
  }
 }
 async function openShotPen(chapterId,shotId){
  const c=current();
  if(!root.open||c?.id!==chapterId||!panel.closest('.dr-storyboard-editor')||workspace.path!==c.draftPath)return;
  const text=editor.value,shot=parseStoryboard(text).find(s=>s.id===shotId);
  if(!shot)throw Error('这镜在文本稿中已改动，请先更新分镜卡片。');
  const section=text.slice(shot.textStart,shot.textEnd);
  const marker=/^<!--\s*shot:[0-9a-f-]{36}\s*-->[ \t]*\r?\n/m.exec(section);
  if(!marker)throw Error('无法定位这镜，请在文本稿里选中文字后递笔。');
  const start=shot.textStart+marker.index+marker[0].length,end=shot.textStart+section.trimEnd().length;
  editor.focus();editor.setSelectionRange(start,end);
  await openPen();
 }
 async function chapterSelected(){const c=current();if(!c)return;sourceShot='';sourceChanged=false;try{const doc=await callTool('read_document',{path:c.sourcePath});sourceChanged=doc.revision!==c.sourceRevision;}catch{sourceChanged=true;}}
 async function action(action,b){const state=getState(),c=current();
  if(action==='source-file'){await workspace.flushDocument();park();sourceDoc=await callTool('read_document',{path:b.dataset.path});navigate({tab:'source',activeTask:'',activeShot:''});return true;}
  if(action==='chapter-start'||action==='chapter-again'){await workspace.flushDocument();const path=action==='chapter-again'?c?.sourcePath:sourceDoc?.path;if(!path)throw Error('请先选择正文中的章节。');const direction=root.querySelector('[data-chapter-direction]')?.value??c?.direction??'';const next=await callTool('start_drama_chapter',{workPath:state.workPath,revision:state.value.revision,sourcePath:path,direction});setState(next);view='text';navigate({tab:'review',activeChapter:next.chapterId,activeTask:'',activeShot:'',collapseSource:true});await chapterSelected();await dispatch(next.nextJobIds);return true;}
  if(action==='board-view'){await switchView(b.dataset.view);return true;}
  if(action==='apply-board'){if(!c)throw Error('请选择章节。');await workspace.flushDocument();const doc=await callTool('read_document',{path:c.draftPath});setState(await callTool('update_drama_storyboard',{workPath:state.workPath,revision:state.value.revision,chapterId:c.id,documentRevision:doc.revision}));view='cards';park();return true;}
  if(action==='restore-board'){if(!c)return true;await workspace.flushDocument();const doc=await callTool('read_document',{path:c.draftPath});await callTool('save_document',{path:c.draftPath,body:c.history[Number(b.dataset.index)].text,revision:doc.revision});view='text';if(workspace.path===c.draftPath)await workspace.openDocument(c.draftPath);return true;}
  if(action==='toggle-original'){showOriginal=!showOriginal;return true;}return false;
 }
 function highlight(id){sourceShot=id;showOriginal=true;const pane=root.querySelector('.dr-original');if(pane){pane.outerHTML=originalPane();root.querySelector('[data-source-highlight]')?.scrollIntoView({block:'center'});}else {render();root.querySelector('[data-source-highlight]')?.scrollIntoView({block:'center'});}}
 root.addEventListener('click',e=>{const card=e.target.closest('[data-review-id]');if(card&&!e.target.closest('input,textarea,select,button,label,a,summary'))highlight(card.dataset.reviewId);});
 editor.addEventListener('input',()=>{if(panel.closest('#drama-dialog')){const badge=root.querySelector('[data-board-revision]');if(badge)badge.textContent='文本已修改 · 分镜卡片待更新';}});
 function selectionPen(event){
  if(!panel.closest('#drama-dialog')||editor.readOnly||editor.isDecorationEvent(event))return false;
  const selection=document.getSelection();if(!selection?.rangeCount||selection.isCollapsed||!editor.contains(selection.anchorNode)||!editor.contains(selection.focusNode))return false;
  const rect=selection.getRangeAt(0).getBoundingClientRect(),menu=document.getElementById('selection-menu');
  document.getElementById('menu-pen').disabled=false;menu.hidden=false;const bounds=menu.getBoundingClientRect();
  menu.style.left=Math.max(8,Math.min(rect.right,innerWidth-bounds.width-8))+'px';
  menu.style.top=Math.max(8,Math.min(rect.bottom+6,innerHeight-bounds.height-8))+'px';return true;
 }
 editor.addEventListener('pointerup',event=>{if(selectionPen(event)||!panel.closest('#drama-dialog')||pendingBoard()?.status==='candidate')return;try{const s=parseStoryboard(editor.value).find(s=>editor.selectionStart>=s.textStart&&editor.selectionStart<s.textEnd);if(s?.id)highlight(s.id);}catch{}});
 editor.addEventListener('keyup',event=>{if(event.key==='Shift'||event.shiftKey)selectionPen(event);});
 editor.addEventListener('scroll',()=>{document.getElementById('selection-menu').hidden=true;});
 return {sourcePage,review,originalPane,mount,park,action,switchView,openShotPen,chapterSelected,sources,get sourcePath(){return sourceDoc?.path||'';},get original(){return showOriginal&&getState().tab==='review'&&!!current();},get boardView(){return view;},reset(boardView='text'){park();sourceDoc=null;view=boardView;sourceShot='';showOriginal=true;},showMaterials(){showOriginal=false;},useText(){view='text';}};
}
