// Validate old in-flight dependencies before upgrading their fingerprint.
// Never bless an already stale result merely because the schema changed.
export function legacyProject(project){return {...project,
 shots:project.shots.map(({taskId,sourceShotIds,archived,promptStale,promptHistory,mediaHistory,...shot})=>shot),
 assets:project.assets.map(({history,...asset})=>asset)};}
export function legacyBasis(p,kind,c,digest){
 if(kind==='prepare')return digest([p.source,p.direction,p.shots.map(({start,end,video,prompt,...x})=>x),p.assets.map(({media,libraryId,libraryProjectId,librarySaved,...x})=>x)]);
 if(kind==='sync-library')return digest(c.item.sha256);
 if(kind==='assets')return digest([p.source,p.direction,c.assetIds.map(id=>p.assets.find(a=>a.id===id))]);
 if(kind==='board')return digest([p.source,p.direction,p.shots]);
 if(kind==='merge')return digest([p.direction,c.unitIds.map(id=>p.shots.find(s=>s.id===id)),c.memberIds.map(id=>p.shots.find(s=>s.id===id))]);
 if(c.mediaKind==='reference')return digest([p.direction,p.assets.find(a=>a.id===c.assetId)]);
 const shot=p.shots.find(x=>x.id===c.shotId);if(!shot)return digest(null);
 const {start,end,video,inPipeline,prompt,...content}=shot;
 return digest([p.direction,content,shot.refs.map(id=>p.assets.find(a=>a.id===id)),...(c.mediaKind==='video'?[start,end,prompt,...(p.videoProvider==='seedance'?['seedance']:[])]:[])]);
}
