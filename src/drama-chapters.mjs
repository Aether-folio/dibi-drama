import {randomUUID} from 'node:crypto';
import {storyboardText,parseStoryboard,sourceRange} from './drama-storyboard.mjs';
import {shotDraft} from './drama-schema.mjs';
import {sourceUnits} from './drama-workflow.mjs';

export function linkShotAssets(project,shots){for(const shot of shots){shot.refs=shot.refs.filter(id=>{const a=project.assets.find(a=>a.id===id);return a&&(shot.members?.length||(a.kind==='character'?shot.characters.includes(a.name):a.kind==='scene'?shot.scene===a.name:true));});for(const [kind,name] of [...shot.characters.map(n=>['character',n]),['scene',shot.scene]]){if(!name?.trim())continue;let a=project.assets.find(a=>a.kind===kind&&a.name===name);if(!a){a={id:randomUUID(),name,kind,description:'',history:[]};project.assets.push(a);}if(!shot.refs.includes(a.id))shot.refs.push(a.id);}}}
export function createChapterFlow({read,write,publicState,conflict,sequential,readDocument,saveDocument,addJob,newShot}){
 const chapter=(s,id)=>{const c=s.project.chapters.find(c=>c.id===id);if(!c)throw Error('章节任务不存在。');return c;};
 async function storeDraft(s,c){const shots=sourceUnits(s.project).filter(x=>x.chapterId===c.id);const doc=await readDocument(c.draftPath);const saved=await saveDocument({path:c.draftPath,body:storyboardText(shots),revision:doc.revision});c.draftRevision=saved.revision;}
 async function adopt(s,c,items){
  const all=s.project.shots.filter(x=>!x.taskId&&x.chapterId===c.id),before=sourceUnits(s.project).filter(x=>x.chapterId===c.id),ids=new Set(all.map(x=>x.id));
  const added=items.map(item=>{if(item.id&&!ids.has(item.id))throw Error('分镜编号不属于当前章节，请移除外来的 shot 标记。');const prior=all.find(x=>x.id===item.id),draft=shotDraft.parse(item),shot={...(prior||newShot(draft)),...draft,chapterId:c.id,sourceRange:sourceRange(c.source,draft.sourceExcerpt),archived:false};return shot;});
  c.history=[...(c.history||[]),{createdAt:new Date().toISOString(),text:storyboardText(before)}].filter(x=>x.text).slice(-20);
  const kept=new Set(added.flatMap(x=>[x.id,...x.members]));
  const archived=all.filter(x=>!kept.has(x.id));for(const x of archived)x.archived=true;
  for(const t of s.project.tasks.filter(t=>t.chapterId===c.id)){const changed=t.sourceShotIds.some(id=>{const a=all.find(x=>x.id===id),b=added.find(x=>x.id===id)||all.find(x=>x.id===id&&kept.has(id));return !a||!b||JSON.stringify(shotDraft.parse(a))!==JSON.stringify(shotDraft.parse(b));})||added.some(b=>b.members.some(id=>t.sourceShotIds.includes(id))&&JSON.stringify(shotDraft.parse(all.find(a=>a.id===b.id)))!==JSON.stringify(shotDraft.parse(b)));if(changed)t.sourceStale=true;}
  const ordered=added.flatMap(x=>[...x.members.map(id=>({...all.find(a=>a.id===id),archived:false})),x]);
  s.project.shots=[...s.project.shots.filter(x=>x.taskId||x.chapterId!==c.id),...archived,...ordered];linkShotAssets(s.project,added);c.version++;return added;
 }
 return {
  storeDraft,adopt,
  startChapter:input=>sequential(async()=>{const s=await read(input);conflict(s,input.revision);if(typeof input.sourcePath!=='string'||!input.sourcePath.startsWith(s.workPath+'/正文/')||!/\.(md|txt)$/i.test(input.sourcePath))throw Error('请选择当前作品正文中的章节。');const doc=await readDocument(input.sourcePath);if(!doc.body.trim())throw Error('本章暂无正文。');if(doc.body.length>60000)throw Error('本章超过 6 万字，请先拆成较短章节。');let c=s.project.chapters.find(x=>x.sourcePath===input.sourcePath);
   if(!c){const id=randomUUID();c={id,name:doc.title||input.sourcePath.split('/').at(-1).replace(/\.(md|txt)$/i,''),sourcePath:input.sourcePath,source:doc.body,sourceRevision:doc.revision,direction:'',draftPath:s.workPath+'/草稿/漫剧分镜/'+id.slice(0,8)+'/'+(doc.title||'章节').replace(/[<>:"/\\|?*]/g,'_').slice(0,40)+' · 分镜稿.md',draftRevision:'',version:0,history:[]};await saveDocument({path:c.draftPath,body:'',title:c.name+' · 分镜稿'});s.project.chapters.push(c);}
   const direction=typeof input.direction==='string'?input.direction.slice(0,4000):c.direction;s.project.source=c.source;s.project.sourcePath=c.sourcePath;s.project.direction=c.direction;
   const existing=s.jobs.find(j=>j.kind==='board'&&j.context.chapterId===c.id&&j.context.source===doc.body&&j.context.direction===direction&&['pending','claimed','candidate'].includes(j.status));if(existing)return {...publicState(s),chapterId:c.id,jobId:existing.id,nextJobIds:existing.status==='pending'?[existing.id]:[]};
   const j=addJob(s,'board',{title:c.name+' · 拆分镜',chapterId:c.id,source:doc.body,sourceRevision:doc.revision,direction,draftRevision:(await readDocument(c.draftPath)).revision});return {...publicState(await write(s)),chapterId:c.id,jobId:j.id,nextJobIds:[j.id]};}),
  updateStoryboard:input=>sequential(async()=>{const s=await read(input);conflict(s,input.revision);const c=chapter(s,input.chapterId),doc=await readDocument(c.draftPath);if(input.documentRevision&&input.documentRevision!==doc.revision)throw Error('分镜稿已变化，请刷新后再更新。');const items=parseStoryboard(doc.body);const added=await adopt(s,c,items);await storeDraft(s,c,added);return publicState(await write(s));}),
  restoreStoryboard:input=>sequential(async()=>{const s=await read(input);conflict(s,input.revision);const c=chapter(s,input.chapterId),entry=c.history[input.index];if(!entry)throw Error('分镜版本不存在。');const added=await adopt(s,c,parseStoryboard(entry.text));await storeDraft(s,c,added);return publicState(await write(s));})
 };
}
