import {mkdir,readdir,readFile,lstat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';

const prefix='漫剧工作流-';
export const isDramaWorkflow=path=>/^漫剧工作流-[0-9a-f-]{36}$/.test(path);
export const isDramaScriptPath=path=>typeof path==='string'&&path.endsWith('/正文/剧本.md')&&isDramaWorkflow(path.split('/')[0])&&path.split('/').length===3;
const key=z.object({workPath:z.string().refine(isDramaWorkflow)});
const shelfKey=z.object({workPath:z.string().min(1).max(120).regex(/^[^./\\][^/\\]*$/u),removed:z.boolean()});
const viewKey=shelfKey.pick({workPath:true});
const positionId=z.string().max(180);
const positionSchema=z.object({
  tab:z.enum(['source','review','assets','prompts','pipeline','videos','tasks']),
  chapter:positionId,task:positionId,shot:positionId,asset:positionId,promptJob:positionId,
  section:z.enum(['','images','prompt','video']),sourcePath:z.string().max(500),
  boardView:z.enum(['text','cards']),
});
const revision=z.number().int().nonnegative();
const body=z.string().max(60000);
const ticket=key.extend({jobId:z.uuid()});
export const workflowTools=[
  ['load_drama_position',viewKey,'loadPosition',true],
  ['save_drama_position',viewKey.extend({position:positionSchema}),'savePosition',false],
  ['list_drama_workflows',z.object({removed:z.boolean().optional()}),'list',true],
  ['set_drama_workflow_removed',shelfKey,'setRemoved',false],
  ['create_drama_workflow',z.object({id:z.uuid()}),'create',false],
  ['load_drama_workflow',key,'load',true],
  ['save_drama_workflow',key.extend({revision,name:z.string().trim().min(1).max(80),source:body,script:body,editing:z.boolean()}),'save',false],
  ['start_drama_script_conversion',key.extend({revision}),'start',false],
  ['use_drama_script_candidate',ticket.extend({revision}),'adopt',false],
  ['prepare_drama_script',key.extend({revision}),'prepare',false],
];

export const workflowAgentTools=[
  {name:'get_drama_script_request',schema:ticket,method:'context',description:'读取小说转剧本任务。使用 short-drama-write 技能改编，并回传 Markdown 候选。'},
  {name:'publish_drama_script_result',schema:ticket.extend({token:z.uuid(),result:z.discriminatedUnion('type',[
    z.object({type:z.literal('script'),text:body.trim().min(1)}),
    z.object({type:z.literal('error'),message:z.string().trim().min(1).max(2000)}),
  ])}),method:'publish',description:'回传小说改编剧本或处理失败信息。结果作为候选供作者采用。'},
];

export function createDramaWorkflows({root,checked,atomic,sequential,readDocument,saveDocument}){
  const recordPath=path=>path+'/草稿/.剧本创作.json';
  const projectPath=path=>path+'/草稿/.漫剧项目.json';
  const positionPath=path=>path+'/草稿/.漫剧工作位置.json';
  async function loadPosition(workPath){
    try{return positionSchema.safeParse(JSON.parse(await readFile(await checked(positionPath(workPath)),'utf8'))).data??null;}
    catch(error){if(error.code==='ENOENT'||error instanceof SyntaxError)return null;throw error;}
  }
  async function projectFile(path){
    try{return await lstat(await checked(projectPath(path)));}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  const removalPath=path=>path+'/草稿/.工作流移除';
  async function removedFromShelf(path){
    try{return (await readFile(await checked(removalPath(path)),'utf8'))==='removed';}
    catch(error){if(error.code==='ENOENT')return false;throw error;}
  }
  const scriptPath=workPath=>workPath+'/正文/剧本.md';
  const readScript=workPath=>readDocument(scriptPath(workPath)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  async function load({workPath}){
    key.parse({workPath});
    return JSON.parse(await readFile(await checked(recordPath(workPath)),'utf8'));
  }
  async function write(state){
    await atomic(recordPath(state.workPath),JSON.stringify(state,null,2));
    return state;
  }
  async function current(input){
    const state=await load(input);
    if(state.revision!==input.revision)throw Error('剧本创作已在其他面板更新，请复制当前编辑内容后重新打开插件。');
    return state;
  }
  function jobFor(state,jobId){
    if(state.job?.id!==jobId)throw Error('此转换任务已过期。');
    return state.job;
  }
  const view=({job,...state})=>({...state,job:job&&{id:job.id,status:job.status,text:job.text,message:job.message}});
  return {
    loadPosition:async ({workPath})=>({position:await loadPosition(viewKey.parse({workPath}).workPath)}),
    savePosition:input=>sequential(async()=>{
      const {workPath,position}=viewKey.extend({position:positionSchema}).parse(input);
      const file=await lstat(await checked(isDramaWorkflow(workPath)?recordPath(workPath):projectPath(workPath)));
      if(!file.isFile())throw Error('找不到漫剧工作流。');
      await atomic(positionPath(workPath),JSON.stringify(position));
      return {saved:true};
    }),
    async list({removed=false}={}){
      const entries=await readdir(root,{withFileTypes:true});
      const workflows=await Promise.all(entries.filter(entry=>entry.isDirectory()&&!entry.name.startsWith('.')&&entry.name!=='数据').map(async ({name})=>{
        try{
          if(await removedFromShelf(name)!==removed)return;
          if(isDramaWorkflow(name)){
            const state=await load({workPath:name});
            const {updatedAt,name:title,editing,script}=state;
            const hasScript=Boolean(((await readScript(name))?.body??script).trim());
            const project=await projectFile(name);
            const position=await loadPosition(name);
            if(!hasScript&&!state.source.trim()&&!project?.isFile())return;
            const resumeProduction=Boolean(position||project?.isFile());
            const stage=resumeProduction?({source:'原文',review:'分镜',assets:'管理素材',prompts:'审图片提示词',pipeline:'生成画面与视频',videos:'视频库',tasks:'处理记录'}[position?.tab]||'制作中'):(hasScript?'剧本草稿':editing?'剧本编辑':'剧本创作');
            return {workPath:name,name:title,updatedAt,stage,resumeProduction};
          }
          const file=await lstat(await checked(projectPath(name)));
          if(file.isFile())return {workPath:name,name,updatedAt:file.mtime.toISOString(),stage:'制作中',legacy:true};
        }catch(error){if(error.code!=='ENOENT')throw error;}
      }));
      return {workflows:workflows.filter(Boolean).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))};
    },
    setRemoved:input=>sequential(async()=>{
      const {workPath,removed}=shelfKey.parse(input);
      const file=await lstat(await checked(isDramaWorkflow(workPath)?recordPath(workPath):projectPath(workPath)));
      if(!file.isFile())throw Error('找不到漫剧工作流。');
      await atomic(removalPath(workPath),removed?'removed':'active');
      return {removed};
    }),
    create:({id})=>sequential(async()=>{
      const workPath=prefix+z.uuid().parse(id);
      try{return view(await load({workPath}));}catch(error){if(error.code!=='ENOENT')throw error;}
      for(const path of [workPath,...['设定','正文','草稿'].map(folder=>workPath+'/'+folder)]){
        await mkdir(await checked(path),{recursive:true});
      }
      return view(await write({workPath,name:'未命名工作流',source:'',script:'',editing:false,revision:0,updatedAt:new Date().toISOString()}));
    }),
    load:async input=>{
      const state=await load(input),document=await readScript(state.workPath);
      return {...view(state),script:document?.body??state.script,scriptRevision:document?.revision};
    },
    save:input=>sequential(async()=>{
      const state=await current(input);
      if(state.source!==input.source)delete state.job;
      Object.assign(state,{name:input.name,source:input.source,script:input.script,editing:input.editing,revision:state.revision+1,updatedAt:new Date().toISOString()});
      return view(await write(state));
    }),
    start:input=>sequential(async()=>{
      const state=await current(input);
      if(!state.source.trim())throw Error('请先粘贴要改编的小说片段。');
      if(state.job?.status==='pending')return view(state);
      state.job={id:randomUUID(),token:randomUUID(),status:'pending'};
      return view(await write(state));
    }),
    async context(input){
      const state=await load(input),job=jobFor(state,input.jobId);
      if(job.status!=='pending')throw Error('此转换任务已结束。');
      return {workPath:state.workPath,jobId:job.id,token:job.token,source:state.source,skill:'short-drama-write',instructions:'把 source 作为小说素材，调用 short-drama-write 按单集可拍摄剧本的写法改编。保留人物、因果与剧情落点，回传纯 Markdown。使用 publish_drama_script_result，勿直接写文件。'};
    },
    publish:input=>sequential(async()=>{
      const state=await load(input),job=jobFor(state,input.jobId);
      if(job.status!=='pending'||job.token!==input.token)throw Error('此转换任务已结束或授权无效。');
      if(input.result.type==='script'){job.status='candidate';job.text=input.result.text;}
      else{job.status='error';job.message=input.result.message;}
      await write(state);
      return {status:job.status};
    }),
    adopt:input=>sequential(async()=>{
      const state=await current(input),job=jobFor(state,input.jobId);
      if(job.status!=='candidate')throw Error('当前没有转换结果可采用。');
      const prior=await readScript(state.workPath);
      await saveDocument({path:scriptPath(state.workPath),title:'剧本',body:job.text,revision:prior?.revision});
      state.script=job.text;
      state.editing=true;
      state.revision++;
      state.updatedAt=new Date().toISOString();
      delete state.job;
      await write(state);
      return {...view(state),scriptRevision:(await readScript(state.workPath)).revision};
    }),
    prepare:input=>sequential(async()=>{
      const state=await current(input);
      const path=scriptPath(state.workPath),prior=await readScript(state.workPath);
      if(!(prior?.body??state.script).trim())throw Error('请先完成剧本。');
      if(!prior)await saveDocument({path,title:'剧本',body:state.script});
      return {path};
    }),
  };
}
