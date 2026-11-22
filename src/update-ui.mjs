export function attachWorkbenchUpdate({callTool,flush,capture,notify,isComposing,retire}){
  const button=document.getElementById('workbench-update');
  const dialog=document.createElement('dialog');dialog.id='workbench-update-dialog';
  dialog.setAttribute('aria-labelledby','workbench-update-heading');
  dialog.innerHTML='<div class="simple-dialog"><h2 id="workbench-update-heading">更新工作台</h2><p id="workbench-update-status" role="status"></p><div class="dialog-footer"><button type="button">关闭</button></div></div>';
  document.body.append(dialog);
  const status=dialog.querySelector('[role=status]'),close=dialog.querySelector('button');
  let busy=false;
  close.onclick=()=>dialog.close();dialog.oncancel=event=>{if(busy)event.preventDefault();};
  button.onclick=async()=>{
    if(busy)return;
    if(isComposing()){notify('请先完成当前文字输入，再更新工作台。');return;}
    if(document.querySelector('dialog[open]')){notify('请先完成并关闭当前窗口，再更新工作台。');return;}
    busy=true;button.disabled=true;close.disabled=true;status.textContent='正在保存文稿、画板和设置…';dialog.showModal();
    let switched=false;
    try{
      await flush();
      status.textContent='正在检查本机新版…';
      let result;
      try{result=await callTool('update_workbench',{action:'check'});}catch(error){if(/unknown|not found|不存在|未找到/i.test(error.message))throw Error('当前后台尚未启用更新连接层。首次安装需重新连接工作台插件，以后可在这里更新。');throw error;}
      if(result.reconnectRequired)throw Error('这次更新涉及连接层本身，需要重新连接工作台插件。内容已保存，当前页面保持不变。');
      if(!result.available&&document.documentElement.dataset.workbenchBuild===result.buildId){status.textContent='已是最新版本，当前内容已保存。';return;}
      status.textContent='正在载入新版界面…';
      const chunks=[];
      for(let offset=0;offset!==null;){const chunk=await callTool('update_workbench',{action:'read',buildId:result.buildId,offset});chunks.push(chunk.data);offset=chunk.next;}
      const data=Uint8Array.from(atob(chunks.join('')),c=>c.charCodeAt(0));
      let html=await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      if(!html.includes('id="workbench-update"')||!html.includes('</head>'))throw Error('新版界面不完整，更新已停止。');
      html=html.replace('__WORKBENCH_BUILD__',result.buildId);
      const resume={...capture(),buildId:result.buildId};
      html=html.replace('</head>',()=>'<script>window.__workbenchResume='+JSON.stringify(resume).replace(/</g,'\\u003c')+';</script></head>');
      // Keep the host-owned frame URL. A blob: navigation can be blocked by
      // the host's frame policy even though the application update succeeded.
      status.textContent='正在切换工作台后台…';
      await callTool('update_workbench',{action:'apply',buildId:result.buildId});
      switched=true;
      await retire();
      // document.open removes the previous document/window event listeners.
      // retire also closes the old bridge and stops its timers and observers.
      document.open();document.write(html);document.close();
    }catch(error){status.textContent=(switched?'后台已更新，界面刷新未完成：':'更新未完成：')+error.message;notify(status.textContent);}
    finally{busy=false;button.disabled=false;close.disabled=false;}
  };
  return {ready(){button.disabled=false;}};
}
