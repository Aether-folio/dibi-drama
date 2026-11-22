import {createDramaWorkflows,isDramaWorkflow} from './drama-workflows.mjs';
import {createDramaStore} from './drama-store.mjs';
import {readFile,writeFile,mkdir,readdir,lstat,rename,unlink,copyFile,cp,rm,rmdir,link} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,dirname,join,relative,isAbsolute,extname,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {createWritingStore} from './writing-suggestions.mjs';
import {createWorkspaceHistory} from './workspace-history.mjs';
import {MAX_COVER_BYTES} from './shelf-cover.mjs';
import {createWorkProgress} from './work-progress.mjs';
import {fonts} from './font-choices.mjs';
import {countWords} from './core.mjs';
import {boardSchema,boardScratchSchema,openBoardSchema,saveBoardSchema,saveNamedBoardSchema,saveBoardScratchSchema,updateBoardSchema} from './draft-board-schema.mjs';
import {boardFileExtension} from './draft-board.mjs';

export const draftSchema=z.object({title:z.string().max(80),body:z.string().max(2000000)});
export const defaultStatsFields=['work','cover','words','speed','active','idle','status'];
const statsFieldsSchema=z.array(z.enum(defaultStatsFields)).max(defaultStatsFields.length).refine(fields=>new Set(fields).size===fields.length);
const defaultPet={enabled:false,character:'dragon'};
const petSchema=z.object({enabled:z.boolean(),character:z.enum(['dragon','fish'])});
export const statsPreferencesSchema=z.object({fields:statsFieldsSchema,workPath:z.string().max(80).optional(),coverDataUrl:z.string().max(3000000).nullable().optional(),pet:petSchema.optional()});
const coverTypes={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'};
const storedStatsSchema=z.object({version:z.literal(1),fields:statsFieldsSchema,covers:z.record(z.string(),z.object({id:z.string().uuid(),mime:z.enum(['image/png','image/jpeg','image/webp'])})),pet:petSchema.default(defaultPet)});
export const recordSchema=z.object({id:z.string().min(1).max(100),day:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),path:z.string().max(240),title:z.string().max(80),added:z.number().int().min(0).max(10000000),deleted:z.number().int().min(0).max(10000000),activeMs:z.number().min(0).max(86400000),idleMs:z.number().min(0).max(86400000),startedAt:z.string().datetime(),updatedAt:z.string().datetime()});
export const settingsSchema=z.object({theme:z.enum(['native','glass','light','dark']).default('native'),glassPalette:z.enum(['glacier','iris','mint','peach','silver','midnight']).default('glacier'),glassFrost:z.number().min(40).max(90).default(70),background:z.string().regex(/^#[0-9a-f]{6}$/i),fontFamily:z.enum(Object.keys(fonts)).default('system'),fontSize:z.number().min(14).max(30).default(18),lineHeight:z.number().min(1.2).max(2.4).default(1.6),paragraphGap:z.number().min(.5).max(3).default(1.3),pageWidth:z.number().min(600).max(1600).default(1100),autoPageWidth:z.boolean().optional(),reduceMotion:z.boolean().default(false),sidebarSide:z.enum(['left','right']).default('left'),chapterOrders:z.record(z.string().max(240),z.enum(['asc','desc'])).default({})});
const trashSchema=z.object({id:z.string().uuid(),path:z.string().max(240),kind:z.enum(['folder','board']).optional(),deletedAt:z.string().datetime(),revision:z.string().regex(/^[a-f0-9]{64}$/),restoredAt:z.string().datetime().optional()});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const missing=error=>error.code==='ENOENT';

export function createWorkspace(workspacePath,{seedance,videoFetch,dramaEnabled=true,writingScope}={}) {
  const root=resolve(workspacePath,'码字工作台');
  let pending=Promise.resolve();
  let recovering=null;
  const countedChapters=new Map();
  function sequential(task) {const next=pending.then(task);pending=next.then(()=>{},()=>{});return next;}
  async function checked(path) {
    const target=resolve(root,path);
    const rel=relative(root,target);
    if(rel.startsWith('..') || isAbsolute(rel)) throw new Error('只能访问码字工作台文件夹内的文件。');
    const parts=rel ? rel.split(/[\\/]/) : [];
    let current=root;
    for(const part of ['',...parts]) {
      if(part) current=join(current,part);
      try {if((await lstat(current)).isSymbolicLink()) throw new Error('不支持链接文件或链接目录。');}
      catch(error) {if(!missing(error)) throw error;}
    }
    return target;
  }
  async function init() {
    await checked('');await mkdir(root,{recursive:true});
    for(const folder of ['数据','数据/备份']) {await mkdir(await checked(folder),{recursive:true});}
    if(!recovering)recovering=recoverRenames();
    await recovering;
  }
  async function readJSON(name,fallback) {
    try {return JSON.parse(await readFile(await checked(`数据/${name}.json`),'utf8'));}
    catch(error) {if(missing(error)) return fallback;throw new Error(`无法读取${name}数据，已保留原文件：${error.message}`);}
  }
  async function atomic(path,content) {
    const target=await checked(path);
    const temp=`${target}.${randomUUID()}.tmp`;
    await mkdir(dirname(target),{recursive:true});
    try {await writeFile(temp,content);await rename(temp,target);}
    finally {await unlink(temp).catch(()=>{});}
  }
  const writeJSON=(name,value)=>atomic(`数据/${name}.json`,JSON.stringify(value,null,2));
  async function readDraftBoard() {
    const board=boardSchema.parse(await readJSON('草稿画板',{version:1,items:[]}));
    return {board,revision:hash(JSON.stringify(board))};
  }
  async function checkedBoardFolder(folder) {
    const path=folderPath(folder),parts=path.split('/');
    if(parts.length!==2||parts[1]!=='草稿')throw new Error('请选择作品的草稿文件夹。');
    await checkedWork(parts[0]);
    if(!(await lstat(await checked(path))).isDirectory())throw new Error('草稿文件夹不存在。');
    return path;
  }
  function boardTitle(value){
    return folderName(value.replace(/\.board\.json$/i,''));
  }
  function nextBoardName(names){
    const existing=new Set(names.map(name=>name.toLowerCase()));
    for(let i=1;;i++)if(!existing.has(`草稿${i}${boardFileExtension}`))return `草稿${i}`;
  }
  const scratchPath=folder=>folder+'/.新建画板.json';
  async function readBoardScratch(folder){
    try {
      const bytes=await readFile(await checked(scratchPath(folder)));
      return {scratch:boardScratchSchema.parse(JSON.parse(bytes)),revision:hash(bytes)};
    }catch(error){if(missing(error))return {scratch:null,revision:null};throw error;}
  }
  function boardPath(value){
    const path=folderPath(value),parts=path.split('/'),name=parts[2];
    if(parts.length!==3||parts[1]!=='草稿'||!name.endsWith(boardFileExtension)||name!==boardTitle(name)+boardFileExtension)
      throw new Error('画板文件路径不正确。');
    return path;
  }
  async function readBoardFile(value){
    const path=boardPath(value),target=await checked(path),info=await lstat(target);
    if(!info.isFile()||info.size>16000000)throw new Error('画板文件格式不正确或超过 16 MB。');
    const bytes=await readFile(target),board=boardSchema.parse(JSON.parse(bytes));
    return {board,revision:hash(bytes),name:boardTitle(basename(path))};
  }
  async function openDraftBoard(input){
    const {folder,path}=openBoardSchema.parse(input),draftFolder=await checkedBoardFolder(folder);
    const defaultName=nextBoardName(await readdir(await checked(draftFolder)));
    if(path){
      if(!path.startsWith(draftFolder+'/'))throw new Error('画板文件路径不正确。');
      return {...await readBoardFile(path),defaultName};
    }
    const {scratch,revision:scratchRevision}=await readBoardScratch(draftFolder);
    if(scratch)return {...scratch,revision:scratchRevision,defaultName};
    const {board,revision}=await readDraftBoard();
    const migrated=await readJSON('草稿画板迁移',null);
    if(board.items.length&&revision!==migrated?.revision)return {board,defaultName,legacyRevision:revision,revision:null};
    return {board:{version:3,items:[]},defaultName,revision:null};
  }
  async function writeNewBoard(folder,name,board){
    const temp=await checked(`${folder}/.board-${randomUUID()}.tmp`);
    try {
      await writeFile(temp,JSON.stringify(board),{flag:'wx'});
      for(let suffix=1;;suffix++){
        const stem=suffix===1?name:`${name.slice(0,80-String(suffix).length-1)}-${suffix}`;
        const file=`${stem}${boardFileExtension}`,path=`${folder}/${file}`,target=await checked(path);
        try{await link(temp,target);}
        catch(error){if(error.code==='EEXIST')continue;throw error;}
        return {path,name:stem};
      }
    }finally{await unlink(temp).catch(()=>{});}
  }
  async function recoverRenames(){let files=[];try{files=await readdir(await checked('数据/改名记录'));}catch(e){if(!missing(e))throw e;}for(const file of files){if(!/^[a-f0-9-]{36}\.json$/.test(file))continue;const record=JSON.parse(await readFile(await checked('数据/改名记录/'+file),'utf8'));folderPath(record.from);folderPath(record.to);let moved=false;try{await lstat(await checked(record.to));try{await lstat(await checked(record.from));}catch(e){if(missing(e))moved=true;else throw e;}}catch(e){if(!missing(e))throw e;}if(moved){await writing.migratePaths(record.from,record.to);await history.migratePaths(record.from,record.to);if(!record.from.includes('/'))await migrateCover(record.from,record.to);}await unlink(await checked('数据/改名记录/'+file));}}
  async function renameLinked(from,to){const key=randomUUID(),journal=`数据/改名记录/${key}.json`;await atomic(journal,JSON.stringify({from,to}));await rename(await checked(from),await checked(to));try{await writing.migratePaths(from,to);await history.migratePaths(from,to);const aliases=await readJSON('路径别名',{});aliases[from]=to;await writeJSON('路径别名',aliases);await unlink(await checked(journal));}catch(error){recovering=null;throw new Error('文件已改名，关联记录迁移未完成；重新打开工作台会继续恢复。'+error.message);}}
  async function resolveDocumentAlias(path){let current=path;try{await lstat(await checked(path));return path;}catch(e){if(!missing(e))throw e;}const aliases=await readJSON('路径别名',{});for(let i=0;i<20;i++){const key=Object.keys(aliases).sort((a,b)=>b.length-a.length).find(k=>current===k||current.startsWith(k+'/'));if(!key)break;current=aliases[key]+current.slice(key.length);}return current;}
  function documentPath(path) {
    if(typeof path!=='string' || path.length>240 || !path || isAbsolute(path) || /[<>:"|?*\x00-\x1f]/.test(path)) throw new Error('文稿路径不正确。');
    const parts=path.replace(/\\/g,'/').split('/');
    if(parts.some(part=>!part || part==='.' || part==='..' || part.startsWith('.') || /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || parts[0]==='数据') throw new Error('文稿路径不正确。');
    if(!['.md','.txt'].includes(extname(path).toLowerCase())) throw new Error('目前支持 Markdown 和 TXT 文稿。');
    return parts.join('/');
  }
  function documentStem(value) {
    const name=String(value ?? '').trim();
    if(!name) throw new Error('文稿名称不能为空。');
    if(/[\\/:*?"<>|\x00-\x1f]/.test(name)) throw new Error('文稿名称不能包含 \\ / : * ? " < > | 等字符。');
    const stem=name.replace(/\.(md|txt)$/i,'').trim();
    if(!stem || stem==='.' || stem==='..' || stem.startsWith('.')) throw new Error('文稿名称不正确。');
    if(/[ .]$/.test(stem)) throw new Error('文稿名称不能以空格或句点结尾。');
    if(stem.length>80) throw new Error('文稿名称过长，最多 80 个字符。');
    return stem;
  }
  function folderPath(path) {
    if(typeof path!=='string' || path.length>240 || !path || isAbsolute(path) || /[<>:"|?*\x00-\x1f]/.test(path)) throw new Error('文件夹路径不正确。');
    const parts=path.replace(/\\/g,'/').split('/');
    if(parts.length>6 || parts.some(part=>!part || part==='.' || part==='..' || part==='数据' || part.startsWith('.') || /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('文件夹路径不正确。');
    return parts.join('/');
  }
  function folderName(value) {
    const name=String(value ?? '').trim();
    if(!name) throw new Error('文件夹名称不能为空。');
    if(name.length>80) throw new Error('文件夹名称过长，最多 80 个字符。');
    if(/[\\/:*?"<>|\x00-\x1f]/.test(name)) throw new Error('文件夹名称不能包含 \\ / : * ? " < > | 等字符。');
    if(name==='.' || name==='..' || name==='数据' || name.startsWith('.')) throw new Error('文件夹名称不正确。');
    if(/[ .]$/.test(name)) throw new Error('文件夹名称不能以空格或句点结尾。');
    if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('文件夹名称不正确。');
    return name;
  }
  async function scanTree(start='',stamps) {
    const files=[],directories=[],boardFiles=[],markedWorks=new Set();
    async function visit(folder,depth=0) {
      if(depth>6) return;
      for(const entry of await readdir(await checked(folder),{withFileTypes:true})) {
        if(!dramaEnabled&&!folder&&isDramaWorkflow(entry.name))continue;
        if(depth===1&&entry.name==='.workbench-work'&&entry.isFile())markedWorks.add(folder);
        if(entry.name.startsWith('.') || entry.name==='数据' || entry.isSymbolicLink()) continue;
        const path=folder ? `${folder}/${entry.name}` : entry.name;
        if(entry.isDirectory()) {directories.push({path,name:entry.name});await visit(path,depth+1);}
        else if(entry.isFile() && /\.(md|txt)$/i.test(entry.name)) {
          const info=await lstat(await checked(path));
          files.push({path,name:entry.name,size:info.size,updatedAt:info.mtime.toISOString()});
          if(stamps)stamps.set(path,`${info.size}:${info.mtimeMs}:${info.ctimeMs}`);
        }else if(entry.isFile()&&folder.split('/').length===2&&folder.endsWith('/草稿')&&entry.name.endsWith(boardFileExtension)){
          const info=await lstat(await checked(path));boardFiles.push({path,name:entry.name,size:info.size,updatedAt:info.mtime.toISOString()});
        }
      }
    }
    await visit(start,start?start.split('/').length:0);return {files:files.sort((a,b)=>a.path.localeCompare(b.path,'zh-CN')),directories:directories.sort((a,b)=>a.path.localeCompare(b.path,'zh-CN')),boardFiles:boardFiles.sort((a,b)=>a.path.localeCompare(b.path,'zh-CN',{numeric:true})),markedWorks};
  }
  async function scan() {return (await scanTree()).files;}
  async function chapterTotals(files,works,stamps){
    const totals=Object.fromEntries(works.map(work=>[work.path+'/正文',0]));
    const live=new Set();
    for(const file of files){
      const folder=file.path.split('/').slice(0,2).join('/');
      if(!Object.hasOwn(totals,folder))continue;
      live.add(file.path);
      const stamp=stamps.get(file.path);
      let cached=countedChapters.get(file.path);
      if(cached?.stamp!==stamp){
        try{cached={stamp,words:countWords((await readDocument(file.path)).body)};countedChapters.set(file.path,cached);}
        catch{totals[folder]=null;continue;}
      }
      if(totals[folder]!==null)totals[folder]+=cached.words;
    }
    for(const path of countedChapters.keys())if(!live.has(path))countedChapters.delete(path);
    return totals;
  }
  async function readDocument(path) {
    path=documentPath(path);
    const target=await checked(path);
    const info=await lstat(target);
    if(!info.isFile() || info.size>5000000) throw new Error('文稿必须是 5 MB 以内的 UTF-8 文本文件。');
    const bytes=await readFile(target);
    let body;
    try {body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
    catch {throw new Error('文稿不是 UTF-8 编码，请转换后再打开。');}
    return {path,title:basename(path,extname(path)).slice(0,80),body,revision:hash(bytes)};
  }
  async function saveDocumentInternal(input) {
    const path=documentPath(input.path),target=await checked(path);let old;
    try{old=await readFile(target);}catch(error){if(!missing(error))throw error;}
    if(old&&(!input.revision||hash(old)!==input.revision))throw new Error('文件已在其他地方修改，未覆盖。请先保留编辑区内容，再重新打开文件。');
    if(!old&&input.revision)throw new Error('原文件已被移动或删除，未另行覆盖。请保留编辑区内容。');
    if(old&&old.toString('utf8')===input.body)return readDocument(path);
    if(old)await history.backup(path,old);
    await atomic(path,input.body);return readDocument(path);
  }
  const documentTrash='数据/回收站',folderTrash='数据/回收站/文件夹';
  async function trashEntry(id,base) {
    z.string().uuid().parse(id);
    if(!base){
      try {await lstat(await checked(`${documentTrash}/${id}/entry.json`));base=documentTrash;}
      catch(error){if(!missing(error))throw error;base=folderTrash;}
    }
    const folder=`${base}/${id}`;
    const entry=trashSchema.parse(JSON.parse(await readFile(await checked(`${folder}/entry.json`),'utf8')));
    if(entry.id!==id||(entry.kind==='folder')!==(base===folderTrash)) throw new Error('回收站记录不匹配。');
    entry.path=entry.kind==='folder'?removableFolderPath(entry.path):entry.kind==='board'?boardPath(entry.path):documentPath(entry.path);
    return {entry,folder,file:await checked(`${folder}/${entry.kind==='folder'?'contents':basename(entry.path)}`)};
  }
  function removableFolderPath(input) {
    const path=folderPath(input),parts=path.split('/');
    if(parts.length===1)throw new Error('不能从文件树删除整个作品。');
    return path;
  }
  async function inspectFolder(rootPath) {
    const stamp=createHash('sha256');let count=0;
    async function visit(path,relativePath='') {
      const info=await lstat(path);
      if(info.isSymbolicLink())throw new Error('文件夹里包含链接，不能移动或删除。');
      if(!info.isDirectory()&&!info.isFile())throw new Error('文件夹里包含不支持的文件类型。');
      stamp.update(JSON.stringify([relativePath,info.isDirectory(),info.ino,info.size,info.mtimeMs]));
      if(info.isDirectory()){
        for(const name of (await readdir(path)).sort())await visit(join(path,name),relativePath+'/'+name);
      }else count++;
    }
    if(!(await lstat(rootPath)).isDirectory())throw new Error('没有找到这个文件夹。');
    await visit(rootPath);
    return {revision:stamp.digest('hex'),count};
  }
  async function folderTrashInfo({path}) {
    return inspectFolder(await checked(removableFolderPath(path)));
  }
  async function readStatsPreferences() {
    return storedStatsSchema.parse(await readJSON('悬浮窗',{version:1,fields:defaultStatsFields,covers:{}}));
  }
  async function checkedWork(path) {
    if(typeof path!=='string' || !path || /[\\/]/.test(path))throw new Error('请选择一个作品。');
    documentPath(`${path}/正文/未命名.md`);
    if(!(await lstat(await checked(path))).isDirectory())throw new Error('作品不存在。');
    try {if((await lstat(await checked(path+'/.workbench-work'))).isFile())return path;}catch(error){if(!missing(error))throw error;}
    for(const folder of [path+'/设定',path+'/正文'])if(!(await lstat(await checked(folder))).isDirectory())throw new Error('作品目录不完整。');
    return path;
  }
  async function migrateCover(from,to) {
    try {
      const preferences=await readStatsPreferences();
      if(!Object.hasOwn(preferences.covers,from)) return;
      const covers={...preferences.covers};
      covers[to]=covers[from];delete covers[from];
      await writeJSON('悬浮窗',{...preferences,covers});
    } catch {
      // 封面配置损坏或不可写时，不影响文件夹改名本身。
    }
  }
  async function statsInfo(preferences,workPath) {
    let coverDataUrl=null;
    if(workPath) {
      await checkedWork(workPath);
      const cover=Object.hasOwn(preferences.covers,workPath)?preferences.covers[workPath]:null;
      if(cover) {
        const file=await checked(`数据/封面/${cover.id}.${coverTypes[cover.mime]}`);
        if((await lstat(file)).size>MAX_COVER_BYTES)throw new Error('封面超过 2 MB，请重新上传。');
        coverDataUrl=`data:${cover.mime};base64,${(await readFile(file)).toString('base64')}`;
      }
    }
    return {fields:preferences.fields,coverDataUrl,pet:preferences.pet};
  }
  const api={
    root,init,scan,readDocument,
    async info({workPath}={}) {
      await init();
      const settings=settingsSchema.parse(await readJSON('外观',{background:'#fffdf8'}));
      const defaultDraft={title:'未命名草稿',body:''};
      const draft=workPath!==undefined?defaultDraft:draftSchema.parse(await readJSON('草稿',defaultDraft));
      const scoped=workPath!==undefined;
      const stamps=new Map();
      const {markedWorks,...tree}=scoped&&!workPath?{markedWorks:new Set(),files:[],directories:[],boardFiles:[]}:await scanTree(scoped?await checkedWork(workPath):'',scoped?undefined:stamps);
      const paths=new Set(tree.directories.map(folder=>folder.path));
      const works=scoped?(workPath?[{name:workPath,path:workPath}]:[]):tree.directories.filter(folder=>!folder.path.includes('/') && (markedWorks.has(folder.path)||paths.has(folder.path+'/设定')&&paths.has(folder.path+'/正文')));
      const wordTotals=scoped?{}:await chapterTotals(tree.files,works,stamps);
    return {folder:'码字工作台',...tree,works,wordTotals,settings,draft,features:{trash:true,folderTrash:true,works:true,statsPreferences:true,writingSuggestions:true,writingRequestContext:true,pen:true,backups:true,search:true,readingPosition:true,workProgress:true,...(dramaEnabled?{drama:true,dramaProduction:true,dramaPromptReview:true,dramaLibrarySync:true,dramaCodexImages:true,dramaSeedanceDirect:true,dramaVideoLibrary:true}:{}),volumes:true,draftBoard:true,draftBoardInline:true,draftBoardVersion:4,draftBoardBrushWidth:true}};
    },
    createWork(input) {return sequential(async()=>{
      const name=z.string().trim().min(1).max(80).parse(input.name);
      if(/[\\/]/.test(name))throw new Error('请填写作品名，不要包含路径。');
      documentPath(`${name}/正文/未命名.md`);
      const target=await checked(name);
      try {await mkdir(target);}
      catch(error){if(error.code==='EEXIST')throw new Error('同名作品或文件夹已存在，请换一个作品名。');throw error;}
      const folders=['设定','正文','草稿'];
      for(const folder of folders)await mkdir(await checked(`${name}/${folder}`));
      await atomic(`${name}/.workbench-work`,'');
      return {work:{name,path:name},directories:folders.map(folder=>({name:folder,path:`${name}/${folder}`}))};
    });},
    createFolder(input){return sequential(async()=>{
      const parent=folderPath(input.path),name=folderName(input.name),path=folderPath(parent+'/'+name);
      if(!(await lstat(await checked(parent))).isDirectory())throw new Error('上级文件夹不存在。');
      try{await mkdir(await checked(path));}
      catch(error){if(error.code==='EEXIST')throw new Error('已有同名文件或文件夹。');throw error;}
      return {folder:{name,path}};
    });},
    createVolume(input) {return sequential(async()=>{
      const work=await checkedWork(input.workPath);
      const name=folderName(input.name),path=folderPath(`${work}/正文/${name}`);
      documentPath(path+'/新文稿.md');
      try{await mkdir(await checked(path));}
      catch(error){if(error.code==='EEXIST')throw new Error('正文里已有同名卷，请换一个名称。');throw error;}
      return {folder:{name,path}};
    });},
    prepareWorkVolumes(input) {return sequential(async()=>{
      const work=await checkedWork(input.workPath),body=work+'/正文';
      const children=await readdir(await checked(body),{withFileTypes:true});
      const legacy=children.filter(entry=>entry.isFile()&&!entry.name.startsWith('.')&&/\.(md|txt)$/i.test(entry.name));
      const volumes=children.filter(entry=>entry.isDirectory()&&!entry.name.startsWith('.'));
      const firstVolume=body+'/第一卷',moves=[],conflicts=[];
      if(!legacy.length&&volumes.length)return {moves,conflicts};
      if(!volumes.some(entry=>entry.name==='第一卷')){
        try{await mkdir(await checked(firstVolume));}
        catch(error){if(error.code==='EEXIST')throw new Error('正文里的「第一卷」不是可用的文件夹。');throw error;}
      }
      for(const entry of legacy){
        const from=documentPath(body+'/'+entry.name),to=documentPath(firstVolume+'/'+entry.name);
        try{
          await lstat(await checked(to));
          conflicts.push(entry.name);
          continue;
        }catch(error){if(!missing(error))throw error;}
        await renameLinked(from,to);
        moves.push({from,to});
      }
      return {moves,conflicts,firstVolume};
    });},
    async statsPreferences({workPath}={}) {
      await pending;return statsInfo(await readStatsPreferences(),workPath);
    },
    saveStatsPreferences(input) {return sequential(async()=>{
      const values=statsPreferencesSchema.parse(input),previous=await readStatsPreferences();
      if(values.workPath)await checkedWork(values.workPath);
      let covers=previous.covers;
      if(values.coverDataUrl!==undefined) {
        const workPath=await checkedWork(values.workPath);
        covers=Object.fromEntries(Object.entries(covers).filter(([path])=>path!==workPath));
        if(values.coverDataUrl!==null) {
          const match=values.coverDataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
          if(!match)throw new Error('请选择 PNG、JPG 或 WebP 格式的封面。');
          const [,mime,data]=match,bytes=Buffer.from(data,'base64');
          if(!bytes.length || bytes.length>MAX_COVER_BYTES || bytes.toString('base64')!==data)throw new Error('请选择 2 MB 以内的有效封面。');
          const signature=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):mime==='image/jpeg'?bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')):bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP';
          if(!signature)throw new Error('图片格式与文件内容不符，请重新选择封面。');
          const id=randomUUID();await atomic(`数据/封面/${id}.${coverTypes[mime]}`,bytes);
          covers=Object.fromEntries([...Object.entries(covers),[workPath,{id,mime}]]);
        }
      }
      const preferences={version:1,fields:values.fields,covers,pet:values.pet ?? previous.pet};
      // Commit the preferences only after the optional cover file is ready.
      await writeJSON('悬浮窗',preferences);
      return statsInfo(preferences,values.workPath);
    });},
    saveDocument(input) {return sequential(()=>saveDocumentInternal(input));},
    renameDocument(input) {return sequential(async()=>{
      const path=documentPath(input.path);
      const current=await readDocument(path);
      if(input.revision && current.revision!==input.revision) throw new Error('文件已在其他地方修改，未重命名。请重新打开后再操作。');
      const stem=documentStem(input.name),ext=extname(path),folder=dirname(path);
      const nextPath=documentPath(`${folder==='.'?'':folder.replace(/\\/g,'/')+'/'}${stem}${ext}`);
      if(nextPath===path) return {document:current,previousPath:path};
      const target=await checked(nextPath);
      let exists=false;
      try {await lstat(target);exists=true;}
      catch(error){if(!missing(error)) throw error;}
      if(exists) throw new Error('同名文稿或文件夹已存在，请换一个名称。');
      await renameLinked(path,nextPath);
      return {document:await readDocument(nextPath),previousPath:path};
    });},
    renameFolder(input) {return sequential(async()=>{
      const path=folderPath(input.path);
      const info=await lstat(await checked(path));
      if(!info.isDirectory()) throw new Error('只能重命名文件夹。');
      const name=folderName(input.name),parent=dirname(path);
      const nextPath=`${parent==='.'?'':parent.replace(/\\/g,'/')+'/'}${name}`;
      if(nextPath===path) return {folder:{name:basename(path),path},previousPath:path};
      let exists=false;
      try {await lstat(await checked(nextPath));exists=true;}
      catch(error){if(!missing(error)) throw error;}
      if(exists) throw new Error('同名文件或文件夹已存在，请换一个名称。');
      await renameLinked(path,nextPath);
      // 作品封面按作品目录名保存；作品目录改名后把封面迁移到新名字。
      if(!path.includes('/')) await migrateCover(path,nextPath);
      return {folder:{name,path:nextPath},previousPath:path};
    });},
    deleteDocument(input) {return sequential(async()=>{
      const document=await readDocument(input.path);
      if(document.revision!==input.revision) throw new Error('文件已在其他地方修改，未删除。请重新打开后再操作。');
      const entry={id:randomUUID(),path:document.path,deletedAt:new Date().toISOString(),revision:document.revision};
      const folder=`${documentTrash}/${entry.id}`;
      await atomic(`${folder}/entry.json`,JSON.stringify(entry,null,2));
      await rename(await checked(document.path),await checked(`${folder}/${basename(document.path)}`));
      return {deleted:true,entry};
    });},
    folderTrashInfo,
    deleteBoard(input){return sequential(async()=>{
      const path=boardPath(input.path),{revision}=await readBoardFile(path);
      if(revision!==input.revision)throw new Error('画板已在其他地方修改，请重新打开后再删除。');
      const entry={id:randomUUID(),kind:'board',path,revision,deletedAt:new Date().toISOString()};
      const folder=`${documentTrash}/${entry.id}`;
      await atomic(`${folder}/entry.json`,JSON.stringify(entry,null,2));
      await rename(await checked(path),await checked(`${folder}/${basename(path)}`));
      return {deleted:true,entry};
    });},
    deleteFolder(input) {return sequential(async()=>{
      const path=removableFolderPath(input.path),source=await checked(path),{revision}=await inspectFolder(source);
      if(revision!==input.revision)throw new Error('文件夹内容已变化，请重新确认。');
      const [work,name,...rest]=path.split('/');
      if(!rest.length&&['正文','设定','草稿'].includes(name)){
        const wasWork=await checkedWork(work).then(()=>true,error=>{if(missing(error)||error.message==='作品目录不完整。')return false;throw error;});
        if(wasWork)await atomic(work+'/.workbench-work','');
      }
      const entry={id:randomUUID(),kind:'folder',path,deletedAt:new Date().toISOString(),revision};
      const folder=`${folderTrash}/${entry.id}`;
      await atomic(`${folder}/entry.json`,JSON.stringify(entry,null,2));
      await rename(source,await checked(`${folder}/contents`));
      return {deleted:true,entry};
    });},
    async listTrash() {
      await pending;
      const entries=[];
      for(const base of [documentTrash,folderTrash]){
        let directories;
        try {directories=await readdir(await checked(base),{withFileTypes:true});}catch(error){if(missing(error))continue;throw error;}
        for(const directory of directories) {
          if(!directory.isDirectory() || directory.isSymbolicLink() || !z.string().uuid().safeParse(directory.name).success)continue;
          try {
            const {entry,file}=await trashEntry(directory.name,base);
            if(!entry.restoredAt){const info=await lstat(file);if(entry.kind==='folder'?info.isDirectory():info.isFile())entries.push(entry);}
          } catch(error) {if(!missing(error))throw error;}
        }
      }
      return {entries:entries.sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt))};
    },
    deleteTrash({id}) {return sequential(async()=>{
      const {entry,folder}=await trashEntry(id);
      if(entry.restoredAt)throw new Error('此条目已恢复，不能从回收站删除。');
      const target=await checked(folder);
      // Only a validated UUID entry with its two ordinary archive files may be removed.
      for(const child of await readdir(target)) {
        if(child==='contents'&&entry.kind==='folder'){await inspectFolder(await checked(`${folder}/${child}`));continue;}
        if(child!=='entry.json'&&(entry.kind==='folder'||child!==basename(entry.path)))throw new Error('回收站记录包含未知文件，未删除。');
        if(!(await lstat(await checked(`${folder}/${child}`))).isFile())throw new Error('回收站记录不完整，未删除。');
      }
      await rm(target,{recursive:true});
      return {deleted:true,id};
    });},
    restoreDocument({id}) {return sequential(async()=>{
      const {entry,folder,file}=await trashEntry(id);
      if(entry.restoredAt)throw new Error('此条目已恢复。');
      const target=await checked(entry.path);
      await mkdir(dirname(target),{recursive:true});
      if(entry.kind==='folder') {
        await inspectFolder(file);
        // Reserve the original name so an existing folder, even an empty one, is never replaced.
        try {await mkdir(target);}catch(error){if(error.code==='EEXIST')throw new Error('原位置已有同名文件或文件夹，未覆盖。');throw error;}
        try {
          for(const name of await readdir(file))await cp(join(file,name),join(target,name),{recursive:true,force:false,errorOnExist:true});
        }
        catch(error){await rmdir(target).catch(()=>{});throw new Error(`文件夹未完整恢复，回收站副本仍保留：${error.message}`);}
        await atomic(`${folder}/entry.json`,JSON.stringify({...entry,restoredAt:new Date().toISOString()},null,2));
        return {restored:true,path:entry.path};
      }
      try {await copyFile(file,target,constants.COPYFILE_EXCL);}
      catch(error){if(error.code==='EEXIST')throw new Error('原位置已有同名文稿，未覆盖。请先重命名或移走同名文件。');throw error;}
      // Keep the archived copy, even after restoring, as an additional backup.
      await atomic(`${folder}/entry.json`,JSON.stringify({...entry,restoredAt:new Date().toISOString()},null,2));
      return {restored:true,path:entry.path};
    });},
    saveDraft(input) {return sequential(async()=>{const draft=draftSchema.parse(input);await writeJSON('草稿',draft);return {saved:true};});},
    readDraftBoard,openDraftBoard,
    saveBoardScratch(input){return sequential(async()=>{
      const {folder,revision,...scratch}=saveBoardScratchSchema.parse(input),path=await checkedBoardFolder(folder);
      const current=await readBoardScratch(path),bytes=JSON.stringify(scratch),next=hash(bytes);
      if(current.revision===next)return {revision:next};
      if(current.revision!==revision)throw new Error('新画板已在另一处修改，当前内容仍留在这里。');
      await atomic(scratchPath(path),bytes);return {revision:next};
    });},
    updateBoard(input){return sequential(async()=>{
      const {path,board,revision}=updateBoardSchema.parse(input),current=await readBoardFile(path);
      const bytes=JSON.stringify(board),next=hash(bytes);
      if(next===current.revision)return {revision:next};
      if(current.revision!==revision)throw new Error('画板文件已在其他地方修改，当前内容仍留在这里。');
      await atomic(boardPath(path),bytes);return {revision:next};
    });},
    saveNamedDraftBoard(input) {return sequential(async()=>{
      const {board,folder,name,legacyRevision,scratchRevision}=saveNamedBoardSchema.parse(input),draftFolder=await checkedBoardFolder(folder);
      if(scratchRevision!==undefined&&(await readBoardScratch(draftFolder)).revision!==scratchRevision)throw new Error('新画板已在另一处修改，请先保留当前内容。');
      if(!board.items.length)throw new Error('画板没有内容。');
      const files=await readdir(await checked(draftFolder));
      const saved=await writeNewBoard(draftFolder,name.trim()?boardTitle(name):nextBoardName(files),board);
      if(legacyRevision){
        try {
          const current=await readDraftBoard();
          if(current.revision===legacyRevision)await writeJSON('草稿画板迁移',{revision:legacyRevision});
        }catch{
          // The new file is already durable. If the marker cannot be written, keep offering the original draft.
        }
      }
      let resetRevision;
      if(scratchRevision!==undefined){
        const empty=JSON.stringify({board:{version:3,items:[]},name:''});
        try{await atomic(scratchPath(draftFolder),empty);resetRevision=hash(empty);}catch{}
      }
      return {...saved,defaultName:nextBoardName([...files,saved.name+boardFileExtension]),...(resetRevision?{resetRevision}:{})};
    });},
    saveDraftBoard(input) {return sequential(async()=>{
      const {board,revision}=saveBoardSchema.parse(input),current=await readDraftBoard(),next=hash(JSON.stringify(board));
      if(next===current.revision)return {revision:next};
      if(revision!==current.revision)throw new Error('另一个工作台已修改画板，当前改动仍保留在此面板。');
      await atomic('数据/草稿画板.json',JSON.stringify(board));
      return {revision:next};
    });},
    saveSettings(input) {return sequential(async()=>{const settings=settingsSchema.parse({...await readJSON('外观',{background:'#fffdf8'}),...input});await writeJSON('外观',settings);return {settings};});},
    saveRecords(input) {return sequential(async()=>{
      const document=z.object({version:z.literal(1),records:z.array(recordSchema)}).parse(await readJSON('码字记录',{version:1,records:[]}));
      const byId=new Map(document.records.map(item=>[item.id,item]));
      for(const item of input.map(record=>recordSchema.parse(record))) {
        const previous=byId.get(item.id);
        if(previous && (previous.day!==item.day || previous.path!==item.path)) throw new Error('码字记录标识冲突。');
        byId.set(item.id,previous ? {...item,added:Math.max(previous.added,item.added),deleted:Math.max(previous.deleted,item.deleted),activeMs:Math.max(previous.activeMs,item.activeMs),idleMs:Math.max(previous.idleMs,item.idleMs)} : item);
      }
      await writeJSON('码字记录',{version:1,records:[...byId.values()]});return {saved:true};
    });},
    async history(month) {
      await pending;
      const document=z.object({version:z.literal(1),records:z.array(recordSchema)}).parse(await readJSON('码字记录',{version:1,records:[]}));
      return {month,records:document.records.filter(item=>item.day.startsWith(month+'-'))};
    },
  };
  const history=createWorkspaceHistory({checked,atomic,readDocument,saveDocument:saveDocumentInternal,sequential,validatePath:documentPath});
  const workflows=dramaEnabled?createDramaWorkflows({root,checked,atomic,sequential,readDocument,saveDocument:saveDocumentInternal}):undefined;
  const drama=dramaEnabled?createDramaStore({checked,checkedWork,atomic,sequential,seedance,videoFetch,readDocument,saveDocument:saveDocumentInternal}):undefined;
  const progress=createWorkProgress({checked,atomic,readDocument,saveDocument:saveDocumentInternal,scanTree,folderPath,sequential});
  const writing=createWritingStore({scope:writingScope,checked,atomic,validatePath:documentPath,readDocument,saveDocument:saveDocumentInternal,sequential,resolvePath:resolveDocumentAlias,
    readWorkMemory:progress.memory,
    readDraft:()=>readJSON('草稿',{title:'未命名草稿',body:''}),
    commitDraft:async(draft,expectedHash)=>{
      const current=await readJSON('草稿',{title:'未命名草稿',body:''});
      if(hash(current.body)!==expectedHash)throw new Error('草稿已改变，未覆盖。');
      await writeJSON('草稿',draft);return draft;
    },
  });
  return {...api,progress,drama,workflows,createWritingRequest:writing.create,stageChatEdits:writing.stageChatEdits,writingRequests:({path,history,allDrafts})=>writing.list(path,{history,allDrafts}),getWritingRequest:writing.context,updateWritingRequest:writing.update,publishWritingSuggestion:writing.publish,writingVersion:({id,versionId})=>writing.version(id,versionId),listBackups:history.list,readBackup:({id})=>history.read(id),restoreBackup:history.restore,pruneBackups:history.prune,readingPosition:history.view,
    async searchDocuments({workPath,query,offset=0,limit=100}){if(typeof query!=='string'||!query.trim()||query.length>200)throw new Error('请输入200字以内的搜索内容。');if(workPath)folderPath(workPath);z.number().int().min(0).parse(offset);z.number().int().min(1).max(200).parse(limit);const matches=[];let total=0;for(const file of (await scan()).filter(f=>!workPath||f.path.startsWith(workPath+'/'))){const doc=await readDocument(file.path),source=doc.body.replace(/\r\n?/g,'\n');let at=-query.length;while((at=source.indexOf(query,at+query.length))>=0){if(total>=offset&&matches.length<limit)matches.push({path:file.path,offset:at,excerpt:source.slice(Math.max(0,at-35),at+query.length+50)});total++;}}return {matches,total,offset,hasMore:total>offset+matches.length};},
  };
}
