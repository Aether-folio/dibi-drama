// Human-facing @ mentions and provider-facing image slots share one ordered map.
export function videoInputs(project,shot){
 const entry=(key,label,media)=>({key,label,mention:`@【${label}】`,media});
 if(shot.settings.mode==='text')return [];
 const frames=shot.settings.mode==='first-last'||shot.settings.mode==='first'?[entry('start:'+shot.id,'首帧',shot.start),...(shot.settings.mode==='first-last'?[entry('end:'+shot.id,'尾帧',shot.end)]:[])]:[];
 const refs=(shot.settings.mode==='reference'?shot.refs:[]).map(id=>{const a=project.assets.find(a=>a.id===id);if(!a)throw Error('引用素材已删除。');return {...entry('reference:'+id,a.name+'·'+id.slice(0,8),a.media||(a.localPath?{localPath:a.localPath}:a.libraryId?{libraryId:a.libraryId}:null)),name:a.name,kind:a.kind};});
 return [...frames,...refs];
}
export function videoRoute(shot){
 const mode={'first-last':'first_last_frame',first:'image_to_video',reference:'reference',text:'text_to_video'}[shot.settings.mode];
 return {mode,label:{first_last_frame:'严格首尾帧',image_to_video:'首帧驱动',reference:'多图参考',text_to_video:'纯文本'}[mode],notice:['first','first-last'].includes(shot.settings.mode)?'仅提交所选首尾帧，不自动添加其他参考图。':''};
}
export function displayVideoPrompt(project,shot){
 const inputs=videoInputs(project,shot),body=shot.prompt||[shot.view,shot.action,shot.timeline,shot.dialogue,shot.sound].filter(Boolean).join('\n');
 const missing=inputs.filter(x=>!body.includes(x.mention));
 return [...missing.map(x=>x.key.startsWith('start:')?`以 ${x.mention} 作为视频开场画面。`:x.key.startsWith('end:')?`以 ${x.mention} 作为视频结束画面。`:x.kind==='character'?`“${x.name}”的外貌、服装与身体特征参考 ${x.mention}，动作和姿态按下文执行。`:`“${x.name}”的空间布局、环境细节与光照参考 ${x.mention}，保持场景连续。`),body].join('\n');
}
export function compileVideoPrompt(project,shot){
 const inputs=videoInputs(project,shot),display=displayVideoPrompt(project,shot);
 if(inputs.length>30)throw Error('最多同时提交30张图片，首尾帧也占用名额，请减少勾选素材。');
 if(new Set(inputs.map(x=>x.mention)).size!==inputs.length)throw Error('图片引用名称冲突，请调整素材名称。');
 const prompt=display.replace(/@【[^】]*】/g,mention=>{const index=inputs.findIndex(x=>x.mention===mention);if(index<0)throw Error('提示词中有不属于当前制作路径的图片引用：'+mention);return '{{Image '+(index+1)+'}}';});
 if(/\{\{Image\s+\d+\}\}/.test(display))throw Error('请使用界面中的 @图片 引用，后台会自动编译图片序号。');
 return {display,prompt,inputs};
}
