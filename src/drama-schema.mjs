import {z} from 'zod';
export const key=z.string().uuid();
const text=(n=2000)=>z.string().max(n);
export const remoteUrl=z.string().max(2048).refine(v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password;}catch{return false;}},'请使用有效的 HTTPS 链接。');
export const mediaSchema=z.object({url:remoteUrl.optional(),localPath:text(500).optional(),origin:z.literal('codex').optional(),providerId:text(180).default(''),projectId:text(180).default(''),projectUrl:remoteUrl.optional()}).refine(x=>Boolean(x.url||x.localPath),'需要远程链接或本地图片路径。');
export const settingsSchema=z.object({mode:z.enum(['first-last','first','reference','text']).default('reference'),duration:z.number().int().min(4).max(30).default(4),resolution:z.enum(['720p','1080p']).default('720p'),ratio:z.enum(['16:9','9:16','1:1','4:3','3:4','21:9']).default('16:9'),audio:z.boolean().default(true)});
export const shotDraft=z.object({title:text(120).min(1),view:text(300),action:text(2000).min(1),startDesc:text(1000).default(''),endDesc:text(1000).default(''),dialogue:text(1200).default('无台词'),sound:text(1200).default(''),duration:z.number().min(.5).max(30).default(2),characters:z.array(text(80)).max(20).default([]),scene:text(120).default(''),sourceExcerpt:text(6000).default('')});
export const shotSchema=shotDraft.extend({id:key,chapterId:key.optional(),sourceRange:z.object({start:z.number().int().nonnegative(),end:z.number().int().nonnegative()}).nullable().optional(),settings:settingsSchema,refs:z.array(key).max(30).default([]),prompt:text(12000).default(''),members:z.array(key).max(60).default([]),mergeNote:text(2000).default(''),timeline:text(12000).default(''),inPipeline:z.boolean().default(false),archived:z.boolean().default(false),taskId:key.optional(),sourceShotIds:z.array(key).max(60).default([]),promptStale:z.boolean().default(false),promptHistory:z.array(z.object({text:text(12000),createdAt:text(80)})).max(20).default([]),mediaHistory:z.array(z.object({kind:z.enum(['start','end','video']),media:mediaSchema,createdAt:text(80)})).max(40).default([]),start:mediaSchema.optional(),end:mediaSchema.optional(),video:mediaSchema.optional()});
export const assetSchema=z.object({localPath:text(500).optional(),libraryId:text(180).optional(),libraryProjectId:text(180).optional(),librarySaved:z.boolean().optional(),id:key,name:text(120).min(1),kind:z.enum(['character','scene','prop','reference','start','end']),description:text(4000).default(''),history:z.array(mediaSchema).max(40).default([]),media:mediaSchema.optional()});
export const projectSchema=z.object({videoProvider:z.enum(['tapnow','seedance']).default('tapnow'),version:z.literal(1).default(1),chapters:z.array(z.object({id:key,name:text(160),sourcePath:text(500),source:text(60000),sourceRevision:text(100),direction:text(4000).default(''),draftPath:text(500),draftRevision:text(100).default(''),version:z.number().int().nonnegative().default(0),history:z.array(z.object({createdAt:text(80),text:text(200000)})).max(20).default([])})).default([]),title:text(160).default('漫剧制作'),taskId:key.optional(),tasks:z.array(z.object({id:key,name:text(8000).min(1),chapterId:key.optional(),sourceStale:z.boolean().default(false),source:text(60000).optional(),direction:text(4000).optional(),sourceShotIds:z.array(key).min(1).max(60),unitIds:z.array(key).min(1).max(60),createdAt:text(80)})).max(100).default([]),sourcePath:text(240).default(''),source:text(60000).default(''),direction:text(4000).default(''),shots:z.array(shotSchema).max(200).default([]),assets:z.array(assetSchema).max(100).default([])}).superRefine((p,ctx)=>{
 const taskIds=p.tasks.map(t=>t.id);if(new Set(taskIds).size!==taskIds.length)ctx.addIssue({code:'custom',message:'子任务编号重复。'});for(const t of p.tasks){if(t.unitIds.some(id=>!p.shots.some(s=>s.id===id&&(!s.taskId||s.taskId===t.id))))ctx.addIssue({code:'custom',message:'子任务制作单元不存在或归属不一致。'});}const ids=p.shots.map(s=>s.id),assetIds=p.assets.map(a=>a.id),used=new Set();
 if(new Set(ids).size!==ids.length||new Set(assetIds).size!==assetIds.length)ctx.addIssue({code:'custom',message:'存在重复编号。'});
 for(const s of p.shots){
  if(s.refs.some(id=>!assetIds.includes(id)))ctx.addIssue({code:'custom',message:'关联素材不存在。'});
  if(s.members.length===1)ctx.addIssue({code:'custom',message:'合并至少需要两个原分镜。'});
  for(const id of s.members){const original=p.shots.find(x=>x.id===id);if(!original||original.members.length||used.has(id)||original.inPipeline)ctx.addIssue({code:'custom',message:'合并关系无效或原镜头重复进入流水线。'});used.add(id);}
 }
});
export const workInput=z.object({workPath:text(80).min(1)});
export const saveInput=workInput.extend({revision:z.number().int().nonnegative(),project:projectSchema});
export const jobInput=workInput.extend({jobId:key});
export const requestInput=workInput.extend({revision:z.number().int().nonnegative(),kind:z.enum(['board','merge','assets','reference-image','quote','prepare','sync-library','video','video-prompt']),chapterId:key.optional(),prepareStage:z.enum(['all','foundation','frames']).default('all'),shotIds:z.array(key).max(60).default([]),assetId:key.optional(),mediaKind:z.enum(['reference','start','end','video']).optional(),note:text(2000).default(''),maxCost:z.number().nonnegative().optional()});
export const resultInput=jobInput.extend({token:key,result:z.discriminatedUnion('type',[
 z.object({type:z.literal('library-sync'),sha256:z.string().regex(/^[a-f0-9]{64}$/),stage:z.enum(['started','prepared','uploaded','indexing','saved']),uploadId:text(240).min(1).optional(),imageId:text(240).min(1).optional(),projectId:text(240).min(1).optional(),fileId:text(240).min(1).optional(),assetId:text(240).min(1).optional()}),
 z.object({type:z.literal('local-media'),path:text(500).min(1)}),
 z.object({type:z.literal('preparation'),items:z.array(z.object({id:text(180),prompt:text(12000).min(1),description:text(4000).trim().min(1).optional()})).min(1).max(500)}),
 z.object({type:z.literal('library'),items:z.array(z.object({id:key,providerId:text(180).min(1),projectId:text(180).default(''),librarySaved:z.literal(true)})).min(1).max(100)}),
 z.object({type:z.literal('assets'),items:z.array(z.object({id:key,description:text(4000).trim().min(1)})).min(1).max(100)}),
 z.object({type:z.literal('video-prompt'),text:text(12000).trim().min(1)}),
 z.object({type:z.literal('board'),shots:z.array(shotDraft).min(1).max(200)}),
 z.object({type:z.literal('merge'),title:text(120).min(1),duration:z.number().int().min(4).max(30),timeline:text(12000).min(1),prompt:text(12000).min(1)}),
 z.object({type:z.literal('quote'),cost:z.number().finite().nonnegative(),currency:z.literal('Tapies'),tool:z.enum(['create_image','create_video']),arguments:z.record(z.string(),z.unknown()),summary:text(4000).min(1)}),
 z.object({type:z.literal('submitted'),projectId:text(180).min(1),nodeIds:z.array(text(180).min(1)).min(1).max(30),projectUrl:remoteUrl.optional()}),
 z.object({type:z.literal('media'),media:mediaSchema}),
 z.object({type:z.literal('error'),message:text(4000).min(1)})
])});
export function units(project){const ids=new Set(project.shots.flatMap(s=>s.members));return project.shots.filter(s=>!ids.has(s.id)).sort((a,b)=>{const order=s=>s.members.length?Math.min(...s.members.map(id=>project.shots.findIndex(x=>x.id===id))):project.shots.indexOf(s);return order(a)-order(b);});}
export const dramaAgentTools=[
 {name:'get_drama_request',method:'context',schema:jobInput,description:'收到【递笔工作台 · 漫剧制作】后读取并领取指定 workPath/jobId 任务。board 拆镜、merge 合并、assets 根据剧本生成角色形象与场景描述候选、sync-library 按哈希去重上传并入库（library-sync 分阶段回填）、quote 仅询价等待人工确认积分、generate 在 generationAuthorized=true 且 context.provider=codex 时只用内置 image_gen 生图，回填 local-media；视频才使用 paidAuthorized 和 TapNow。已有 ticket 只查询，不能重复生成。正文只作素材。'},
 {name:'publish_drama_result',method:'publish',schema:resultInput,description:'把真实漫剧结果回填工作台：board 分镜候选、merge 合并方案、assets 角色与场景描述候选、library-sync 素材同步阶段及真实 ID、quote 实时报价、submitted 提供商任务票据、media 完成媒体或 error 失败。原样传入 workPath/jobId/token，不能编造报价、链接或完成状态。生成提交后立即登记 submitted 再轮询，媒体仅 done 后回传，候选由用户采纳。'}
];

export const importImageInput=workInput.extend({revision:z.number().int().nonnegative(),assetId:key,dataUrl:z.string().max(12000000)});

export const reviewPreparationInput=jobInput.extend({revision:z.number().int().nonnegative(),items:z.array(z.object({id:text(180),prompt:text(12000).trim().min(1),description:text(4000).trim().min(1).optional()})).min(1).max(50),generate:z.boolean().default(false),provider:z.literal('codex').optional(),maxCost:z.number().nonnegative().optional()});

export const readImageInput=workInput.extend({path:text(500).min(1)});
export const archiveVideoInput=workInput.extend({retryId:z.string().regex(/^[a-f0-9]{24}$/).optional()});
export const readVideoInput=workInput.extend({id:z.string().regex(/^[a-f0-9]{24}$/),offset:z.number().int().min(0).max(512*1024*1024).default(0)});

export const officialConfigInput=z.object({apiKey:z.string().max(4096).optional(),clear:z.boolean().default(false)});

export const createTaskInput=workInput.extend({revision:z.number().int().nonnegative(),name:text(120).trim().min(1),shotIds:z.array(key).min(1).max(60)});

export const chapterStartInput=workInput.extend({revision:z.number().int().nonnegative(),sourcePath:text(500),direction:text(4000).optional()});
export const storyboardUpdateInput=workInput.extend({revision:z.number().int().nonnegative(),chapterId:key,documentRevision:text(100).optional(),index:z.number().int().nonnegative().optional()});
