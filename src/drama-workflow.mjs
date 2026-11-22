// Task identity is independent of display names and storage filenames.
export const assetKinds={character:'角色',scene:'场景',prop:'道具',reference:'其他参考',start:'首帧',end:'尾帧',video:'视频'};
export const jobStatusNames={pending:'待处理',claimed:'处理中',submitting:'提交中',unknown:'待核对',submitted:'生成中',candidate:'待确认',adopted:'已完成',error:'失败',stale:'需更新',cancelled:'已取消'};
export function taskUnits(project,taskId='') {return project.shots.filter(s=>s.inPipeline&&(!taskId||s.taskId===taskId));}
export function sourceUnits(project){const children=new Set(project.shots.filter(s=>!s.archived).flatMap(s=>s.members));return project.shots.filter(s=>!s.archived&&!s.taskId&&!children.has(s.id)).sort((a,b)=>{const order=s=>s.members.length?Math.min(...s.members.map(id=>project.shots.findIndex(x=>x.id===id))):project.shots.indexOf(s);return order(a)-order(b);});}
export function hasVideo(state,shot){return Boolean(shot.video||state.jobs.some(j=>j.shotId===shot.id&&j.mediaKind==='video'&&j.result?.type==='media'&&['candidate','adopted'].includes(j.status)));}
export function sourceCompleted(state,id){const original=state.project.shots.find(s=>s.id===id);return Boolean(original&&hasVideo(state,original)||original?.members?.length&&original.members.every(x=>sourceCompleted(state,x))||state.project.shots.some(s=>s.sourceShotIds?.includes(id)&&hasVideo(state,s)));}
export function taskStatus(state,task){const shots=state.project.shots.filter(s=>task.unitIds.includes(s.id));const jobs=state.jobs.filter(j=>j.taskId===task.id||shots.some(s=>s.id===j.shotId));if(jobs.some(j=>['submitting','unknown'].includes(j.status)))return '待核对';if(jobs.some(j=>['pending','claimed','submitted'].includes(j.status)))return '处理中';if(shots.length&&shots.every(s=>hasVideo(state,s)))return '已输出';if(jobs.some(j=>j.status==='candidate'))return '待确认';if(jobs.some(j=>j.status==='error'))return '失败';return shots.some(s=>s.promptStale)?'需更新':'待制作';}
export function mediaCatalogue(project){
 const items=[],tasksFor=s=>[...new Set([s.taskId,...project.tasks.filter(t=>t.unitIds.includes(s.id)).map(t=>t.id)].filter(Boolean))];
 for(const a of project.assets)items.push({id:'reference:'+a.id,name:a.name,kind:a.kind,media:a.media||(a.localPath?{localPath:a.localPath}:null),assetId:a.id,taskIds:project.shots.filter(s=>s.refs.includes(a.id)).flatMap(tasksFor),role:'reference'});
 for(const a of project.assets)for(const [i,m] of (a.history||[]).entries())items.push({id:'asset-history:'+a.id+':'+i,name:a.name+' · 历史',kind:a.kind,media:m,taskIds:project.shots.filter(s=>s.refs.includes(a.id)).flatMap(tasksFor),historical:true});
 for(const s of project.shots){for(const kind of ['start','end','video'])if(s[kind])items.push({id:kind+':'+s.id,name:s.title+' · '+assetKinds[kind],kind,role:kind,media:s[kind],shotId:s.id,taskIds:tasksFor(s)});
  for(const [i,h] of (s.mediaHistory||[]).entries())items.push({id:'history:'+s.id+':'+i,name:s.title+' · '+assetKinds[h.kind]+' · 历史',kind:h.kind,role:h.kind,media:h.media,shotId:s.id,taskIds:tasksFor(s),historical:true});
 }
 return items;
}
export function archiveMedia(shot,kind){if(!shot[kind])return;shot.mediaHistory=[...(shot.mediaHistory||[]),{kind,media:structuredClone(shot[kind]),createdAt:new Date().toISOString()}].slice(-40);}
export function rememberPrompt(shot){if(!shot.prompt?.trim())return;const history=shot.promptHistory||[];if(history.at(-1)?.text===shot.prompt)return;shot.promptHistory=[...history,{text:shot.prompt,createdAt:new Date().toISOString()}].slice(-20);}
