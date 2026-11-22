import {iconButton} from './icons.mjs';
import {workflowPath} from './drama-workflow-path.mjs';
import {uuid} from './core.mjs';

export function attachDramaWorkflow({callTool,workspace,editor,drama,canMessage,sendMessage,notify}){
  const $=id=>document.getElementById(id);
  const shelf=$('workflow-shelf'),grid=$('workflow-grid'),page=$('workflow-editor');
  const add=$('drama-launch-open'),title=$('workflow-page-title');
  const name=$('workflow-name'),source=$('workflow-source');
  const scriptHost=$('workflow-script-editor'),content=$('draft-body'),panel=$('document-panel');
  const mounted=[panel,$('selection-menu'),$('pen-toolbar')];
  const homes=mounted.map(element=>{const home=document.createComment('剧本编辑器');element.before(home);return home;});
  const scriptText=()=>panel.parentNode===scriptHost?editor.value:state?.script||'';
  const convert=$('workflow-convert'),split=$('workflow-split'),production=$('workflow-production');
  const adopt=$('workflow-adopt'),retry=$('workflow-retry');
  const trash=$('workflow-trash'),deleteDialog=$('workflow-delete-dialog');
  let showingTrash=false,deleteEntry,removing=false;
  let state,saving,creating,polling,timer,poller,busy=false,dirty=false,editing=false;

  function render(){
    const job=state.job;
    title.textContent=editing?'剧本编辑':'剧本创作';
    $('workflow-source-page').hidden=editing;
    $('workflow-script-page').hidden=!editing;
    $('workflow-conversion').hidden=!job;
    $('workflow-job-status').textContent={pending:'等待聊天返回剧本',candidate:'剧本候选已返回',error:job?.message}[job?.status]||'';
    const candidate=$('workflow-candidate');
    candidate.hidden=job?.status!=='candidate';
    candidate.textContent=job?.text||'';
    adopt.hidden=candidate.hidden;
    adopt.textContent=scriptText().trim()?'用这版替换剧本草稿':'使用这版剧本';
    retry.hidden=job?.status!=='pending';
    convert.disabled=busy||!source.value.trim()||job?.status==='pending'||job?.status==='candidate';
    split.disabled=production.disabled=busy||!scriptText().trim();
    for(const control of [name,source,$('workflow-back'),$('workflow-manual'),$('workflow-novel'),adopt,retry])control.disabled=busy;
  }

  function parkScript(){
    if(panel.parentNode!==scriptHost)return;
    if(state)state={...state,script:editor.value,scriptRevision:workspace.revision};
    for(const [index,element] of mounted.entries())homes[index].after(element);
    $('selection-menu').hidden=true;
    $('pen-toolbar').hidden=true;
    workspace.loadDocument({title:'剧本',body:''});
  }

  async function ensureSaved(){
    if(state.persisted)return;
    if(!creating)creating=callTool('create_drama_workflow',{id:state.workPath.slice('漫剧工作流-'.length)})
      .then(saved=>{state={...state,revision:saved.revision,persisted:true};})
      .finally(()=>{creating=null;});
    await creating;
  }

  async function saveScript({path,body,revision}){
    if(body.length>60000)throw Error('剧本超过 6 万字，请分段制作。');
    if(!body.trim()&&!revision&&!state.script.trim())return {revision};
    if(!state.persisted){
      await ensureSaved();
      dirty=true;
      await flush(true);
    }
    const saved=await callTool('save_document',{path,body,...(revision?{revision}:{})});
    state={...state,script:body,scriptRevision:saved.revision};
    return saved;
  }

  function mountScript(){
    if(panel.parentNode===scriptHost)return;
    scriptHost.append(...mounted);
    panel.hidden=false;
    workspace.loadDocument({path:state.workPath+'/正文/剧本.md',title:'剧本',body:state.script,revision:state.scriptRevision},{start:0,end:0,scrollTop:0},saveScript);
    $('draft-title').readOnly=true;
  }

  function loadEditor(next){
    parkScript();
    state=next;
    name.value=next.name;
    source.value=next.source;
    editing=next.editing;
    shelf.hidden=true;
    page.hidden=false;
    if(editing)mountScript();
    render();
    title.focus();
  }

  async function flush(force=false){
    clearTimeout(timer);
    if(saving)await saving;
    if(!state||!dirty||(!force&&!state.persisted&&!source.value.trim()))return;
    const payload={name:name.value.trim()||'未命名工作流',source:source.value,editing};
    dirty=false;
    saving=(async()=>{
      await ensureSaved();
      return callTool('save_drama_workflow',{...payload,workPath:state.workPath,revision:state.revision,script:state.script});
    })();
    try{const saved=await saving;state={...state,revision:saved.revision,job:saved.job,persisted:true};notify('已保存');render();}
    catch(error){dirty=true;throw error;}
    finally{saving=null;}
    if(dirty)await flush();
  }

  function changed(){
    dirty=true;
    notify('待保存…');
    render();
    clearTimeout(timer);
    timer=setTimeout(()=>flush().catch(error=>notify(error.message)),500);
  }

  async function refreshShelf(){
    const {workflows}=await callTool('list_drama_workflows',{removed:showingTrash});
    trash.setAttribute('aria-pressed',String(showingTrash));
    trash.textContent=showingTrash?'返回工作流':'已删除';
    grid.replaceChildren(...(showingTrash?[]:[add]));
    for(const entry of workflows){
      const card=document.createElement('button'),label=document.createElement('strong'),stage=document.createElement('small');
      card.type='button';
      card.className='workflow-card';
      label.textContent=entry.name;
      stage.textContent=entry.stage;
      card.append(label,stage);
      if(showingTrash){
        const restore=document.createElement('button'),item=document.createElement('div');
        item.className='workflow-card';
        restore.type='button';
        restore.textContent='恢复';
        restore.setAttribute('aria-label','恢复 '+entry.name);
        restore.onclick=()=>run(async()=>{
          await callTool('set_drama_workflow_removed',{workPath:entry.workPath,removed:false});
          await refreshShelf();
          trash.focus();
          notify('已恢复工作流');
        });
        item.append(label,restore);
        grid.append(item);
        continue;
      }
      card.onclick=()=>{
        if(entry.legacy)void run(()=>drama.open(entry.workPath,{displayName:entry.name}));
        else void run(async()=>{
          loadEditor({...await callTool('load_drama_workflow',{workPath:entry.workPath}),persisted:true});
          if(entry.resumeProduction)await openProduction();
        });
      };
      const item=document.createElement('div');
      item.className='workflow-card-item';
      const remove=iconButton('删除 '+entry.name,'trash',()=>{
        deleteEntry=entry;
        $('workflow-delete-copy').textContent='将「'+entry.name+'」移出书架。剧本、小说正文和素材会保留，可以在「已删除」中恢复。';
        $('workflow-delete-error').textContent='';
        deleteDialog.showModal();
      });
      remove.classList.add('workflow-delete');
      item.append(card,remove);
      grid.append(item);
    }
    notify(showingTrash&&!workflows.length?'没有已删除的工作流。':'');
  }

  trash.onclick=()=>run(async()=>{
    showingTrash=!showingTrash;
    try{await refreshShelf();}
    catch(error){showingTrash=!showingTrash;throw error;}
  });
  const cancelDelete=$('workflow-delete-cancel'),confirmDelete=$('workflow-delete-confirm');
  cancelDelete.onclick=()=>deleteDialog.close();
  deleteDialog.addEventListener('cancel',event=>{if(removing)event.preventDefault();});
  confirmDelete.onclick=async()=>{
    if(removing||!deleteEntry)return;
    removing=confirmDelete.disabled=cancelDelete.disabled=true;
    try{
      await callTool('set_drama_workflow_removed',{workPath:deleteEntry.workPath,removed:true});
      deleteDialog.close();
      await refreshShelf();
      add.focus();
      notify('已删除工作流');
    }catch(error){
      if(deleteDialog.open)$('workflow-delete-error').textContent=error.message;
      else notify(error.message);
    }finally{removing=confirmDelete.disabled=cancelDelete.disabled=false;}
  };

  async function run(action){
    if(busy)return;
    busy=true;
    add.disabled=true;
    if(state)render();
    try{if(panel.parentNode===scriptHost)await workspace.flushDocument();await flush();await action();}
    catch(error){notify(error.message);}
    finally{busy=false;add.disabled=false;if(state)render();}
  }

  async function sendConversion(){
    if(!canMessage())throw Error('聊天尚未连接。任务已保存，可重新发送。');
    await sendMessage({
      role:'user',
      content:[{type:'text',text:`【递笔漫剧制作 · 小说转剧本】\nworkPath: ${state.workPath}\njobId: ${state.job.id}\n先调用 get_drama_script_request 读取素材，再使用 short-drama-write 技能改写成可拍摄的单集 Markdown 剧本。保持小说的人物、因果和结局。用 publish_drama_script_result 回传候选，等待用户采用。`}],
      _meta:{'openai/message':{target:'active',send:true}},
    });
    notify('已发送转换任务');
  }

  async function openProduction(options={}){
    parkScript();
    await drama.open(state.workPath,{...options,displayName:name.value.trim()||state.name,
      onClose:()=>run(async()=>loadEditor({...await callTool('load_drama_workflow',{workPath:state.workPath}),persisted:true})),
    });
    if(editing&&!document.getElementById('drama-dialog').open){mountScript();render();}
  }

  async function enterProduction(startSplit){
    const {path}=await callTool('prepare_drama_script',{workPath:state.workPath,revision:state.revision});
    await openProduction({scriptPath:path,startSplit});
  }

  add.onclick=()=>run(async()=>{
    loadEditor({workPath:workflowPath(uuid()),name:'未命名工作流',source:'',script:'',editing:false});
    notify('');
    source.focus();
  });
  for(const field of [name,source])field.addEventListener('input',changed);
  function updateScriptActions(){
    if(panel.parentNode!==scriptHost)return;
    split.disabled=production.disabled=busy||!editor.value.trim();
  }
  content.addEventListener('input',updateScriptActions);
  content.addEventListener('compositionend',updateScriptActions);
  document.addEventListener('workbench:documentchange',updateScriptActions);
  $('workflow-back').onclick=()=>run(async()=>{
    await refreshShelf();
    parkScript();
    state=null;dirty=false;
    page.hidden=true;
    shelf.hidden=false;
    add.focus();
  });
  $('workflow-manual').onclick=()=>run(async()=>{
    editing=true;
    dirty=true;
    await flush();
    mountScript();editor.focus();
  });
  $('workflow-novel').onclick=()=>run(async()=>{
    parkScript();
    editing=false;
    dirty=true;
    await flush();
    source.focus();
  });
  convert.onclick=()=>run(async()=>{
    const {job}=await callTool('start_drama_script_conversion',{workPath:state.workPath,revision:state.revision});
    state={...state,job};
    await sendConversion();
  });
  retry.onclick=()=>run(sendConversion);
  adopt.onclick=()=>run(async()=>{
    loadEditor({...await callTool('use_drama_script_candidate',{workPath:state.workPath,revision:state.revision,jobId:state.job.id}),persisted:true});
    mountScript();editor.focus();
  });
  split.onclick=()=>run(()=>enterProduction(true));
  production.onclick=()=>run(()=>enterProduction(false));

  document.addEventListener('visibilitychange',()=>{if(document.hidden)void flush().catch(error=>notify(error.message));});

  return {
    flush,
    async start(){
      await run(refreshShelf);
      poller=setInterval(async()=>{
        if(document.hidden||busy||dirty||saving||polling||state?.job?.status!=='pending')return;
        polling=true;
        const current=state;
        try{
          const next=await callTool('load_drama_workflow',{workPath:current.workPath});
          if(state!==current||busy||dirty||saving||next.revision!==current.revision)return;
          if(next.job?.status!==current.job?.status){state={...current,job:next.job};render();}
        }catch(error){notify(error.message);}finally{polling=false;}
      },1800);
    },
    stop(){clearInterval(poller);},
  };
}
