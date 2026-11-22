// Completed outputs remain reviewable before adoption and after a new version replaces them.
export function videoCatalogue(state){
 const p=state.project,items=new Map(),rank={history:0,stale:1,candidate:2,adopted:3};
 function add(media,shot,status,date='',jobId=''){
  if(!media?.url&&!media?.localPath)return;
  const key=media.providerId?JSON.stringify([media.projectId||'',media.providerId]):media.url||media.localPath;
  let item=items.get(key);
  if(!item){item={key,media,title:shot?.title||'已生成视频',shotIds:[],taskIds:[],status,createdAt:date,jobId};items.set(key,item);}
  if(rank[status]>rank[item.status])Object.assign(item,{status,jobId});
  if(date>item.createdAt)item.createdAt=date;
  if(shot){item.shotIds=[...new Set([...item.shotIds,shot.id])];item.taskIds=[...new Set([...item.taskIds,shot.taskId,...(p.tasks||[]).filter(t=>t.unitIds.includes(shot.id)).map(t=>t.id)].filter(Boolean))];}
 }
 for(const s of p.shots){for(const h of s.mediaHistory||[])if(h.kind==='video')add(h.media,s,'history',h.createdAt);if(s.video)add(s.video,s,'adopted');}
 for(const j of state.jobs||[]){const c=j.context||j;if(c.mediaKind==='video'&&j.result?.type==='media'&&['candidate','adopted','stale'].includes(j.status)){
  const s=p.shots.find(s=>s.id===c.shotId),current=s?.video;
  const same=current&&(current.url===j.result.media.url||current.providerId&&current.providerId===j.result.media.providerId);
  add(j.result.media,s,j.status==='adopted'&&!same?'history':j.status,j.completedAt||j.createdAt,j.id);
 }}
 return [...items.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
