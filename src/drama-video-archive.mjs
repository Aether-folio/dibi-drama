import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,open,rename,unlink,stat} from 'node:fs/promises';
import {request} from 'node:https';
import {lookup} from 'node:dns';
import {BlockList,isIP} from 'node:net';
import {videoCatalogue} from './drama-video-catalogue.mjs';

const MAX=512*1024*1024,CHUNK=96*1024;
const blocked=new BlockList(),blockedV6=new BlockList();
const isBlocked=(address,family)=>family===6?blockedV6.check(address,"ipv6"):blocked.check(address,"ipv4");
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.168.0.0',16],['224.0.0.0',4],['240.0.0.0',4]])blocked.addSubnet(address,prefix,'ipv4');
for(const [address,prefix] of [['::',96],['::ffff:0:0',96],['fc00::',7],['fe80::',10],['ff00::',8]])blockedV6.addSubnet(address,prefix,'ipv6');
export function publicVideoUrl(value){
 const u=new URL(value),host=u.hostname.replace(/^\[|\]$/g,'');
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||host==='localhost'||host.endsWith('.localhost')||isIP(host)&&isBlocked(host,isIP(host)))throw Error('视频下载地址必须是公开的 HTTPS 地址。');
 return u;
}
export function fetchVideo(url,redirects=0){
 return new Promise((resolve,reject)=>{
  const u=publicVideoUrl(url);
  const req=request(u,{method:'GET',headers:{Accept:'video/*,application/octet-stream'},lookup:(host,options,done)=>lookup(host,{...options,all:true},(err,addresses)=>{
   if(err)return done(err);
   if(!addresses.length||addresses.some(a=>isBlocked(a.address,a.family)))return done(Error('视频下载地址解析到了非公开网络。'));
   if(options.all)done(null,addresses);else done(null,addresses[0].address,addresses[0].family);
  })},res=>{
   if([301,302,303,307,308].includes(res.statusCode)){res.resume();if(redirects>=3||!res.headers.location){reject(Error('视频下载跳转过多。'));return;}try{resolve(fetchVideo(new URL(res.headers.location,u).href,redirects+1));}catch(e){reject(e);}return;}
   resolve({status:res.statusCode,headers:{get:name=>res.headers[name.toLowerCase()]},body:res});
  });
  const timer=setTimeout(()=>req.destroy(Error('下载超过两分钟，请稍后重试保存。')),120000);timer.unref();
  req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end();
 });
}
const idFor=key=>createHash('sha256').update(key).digest('hex').slice(0,24);
const filename=title=>title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,45)||'视频';
const folder=work=>work+'/草稿/漫剧视频';
const indexPath=work=>folder(work)+'/索引.json';
const format=head=>head.toString('ascii',4,8)==='ftyp'?{ext:'mp4',mime:'video/mp4'}:head.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))?{ext:'webm',mime:'video/webm'}:null;

export function createVideoArchive({checked,atomic,videoFetch=fetchVideo}){
 const running=new Map(),failures=new Map();
 async function filePresent(work,a){const prefix=folder(work)+'/';if(!a?.localPath?.startsWith(prefix)||! /^[^/\\]+\.(mp4|webm)$/.test(a.localPath.slice(prefix.length)))return false;try{return (await stat(await checked(a.localPath))).size===a.size;}catch{return false;}}
 async function index(work){try{const value=JSON.parse(await readFile(await checked(indexPath(work)),'utf8'));if(value.version!==1||!Array.isArray(value.items))throw Error('视频索引格式不正确。');return value;}catch(e){if(e.code!=='ENOENT')throw e;return {version:1,items:[]};}}
 const persist=(work,value)=>atomic(indexPath(work),JSON.stringify(value,null,2));
 async function download(work,item){
  let temp,handle,body;
  try{
   publicVideoUrl(item.media.url);
   const response=await videoFetch(item.media.url);body=response.body;
   if(response.status!==200)throw Error('视频下载返回 HTTP '+response.status+'，可重试保存；链接失效时需刷新原生成结果。');
   if(Number(response.headers.get('content-length'))>MAX)throw Error('视频超过 512 MB，暂不自动保存。');
   const dir=await checked(folder(work));await mkdir(dir,{recursive:true});
   temp=await checked(folder(work)+'/.下载-'+randomUUID()+'.part');handle=await open(temp,'wx');
   let size=0,head=Buffer.alloc(0);const hash=createHash('sha256');
   for await(const chunk of body){const bytes=Buffer.from(chunk);size+=bytes.length;if(size>MAX)throw Error('视频超过 512 MB，暂不自动保存。');if(head.length<32)head=Buffer.concat([head,bytes.subarray(0,32-head.length)]);hash.update(bytes);await handle.writeFile(bytes);}
   const kind=format(head);if(!kind||size<32)throw Error('返回内容不是 MP4 或 WebM 视频，请刷新原生成结果后重试保存。');
   const expected=Number(response.headers.get('content-length'));if(expected&&expected!==size)throw Error('视频下载不完整，请重试保存。');
   await handle.close();handle=null;
   const localPath=folder(work)+'/'+filename(item.title)+'_'+item.id+'.'+kind.ext;
   await rename(temp,await checked(localPath));temp=null;
   return {state:'saved',localPath,size,mime:kind.mime,sha256:hash.digest('hex'),savedAt:new Date().toISOString()};
  }finally{body?.destroy?.();if(body?.cancel)await body.cancel().catch(()=>{});if(handle)await handle.close();if(temp)await unlink(temp).catch(()=>{});}
 }
 // One queue per work; network transfers never hold the manuscript/project write lock.
 function schedule(state,{retryId=''}={}){
  const work=state.workPath,prior=running.get(work)||Promise.resolve();
  const promise=prior.catch(()=>{}).then(async()=>{
   const data=await index(work),catalogue=videoCatalogue(state);
   for(const source of catalogue){const id=idFor(source.key);let item=data.items.find(x=>x.id===id);
    if(!item){item={...source,id,archive:{state:'pending'}};data.items.push(item);}else Object.assign(item,source);
   }
   // Retain every archived version, even if its source task was later removed.
   for(const item of data.items){
    if(item.archive.state==='saved'){if(await filePresent(work,item.archive))continue;item.archive={state:'error',error:'本地视频文件已移动或改变，请重试保存。'};}
    if(item.archive.state==='error'&&item.id!==retryId)continue;
    if(!item.media.url){item.archive={state:'error',error:'缺少远程视频链接，无法重新保存。'};continue;}
    item.archive={state:'saving'};await persist(work,data);
    try{item.archive=await download(work,item);}catch(e){item.archive={state:'error',error:e.message.startsWith('视频')||e.message.startsWith('返回')||e.message.startsWith('下载')?e.message:'下载失败，请检查网络后重试保存。'};}
    await persist(work,data);
   }
   if(data.items.length)await persist(work,data);failures.delete(work);
  });
  running.set(work,promise);promise.catch(()=>failures.set(work,'本地视频索引未能保存，请检查文件夹权限后重新整理。')).finally(()=>{if(running.get(work)===promise)running.delete(work);}).catch(()=>{});return promise;
 }
 async function list(state){
  const data=await index(state.workPath),seen=new Set();
  const items=videoCatalogue(state).map(source=>{const id=idFor(source.key);seen.add(id);return {...source,id,archive:data.items.find(x=>x.id===id)?.archive||{state:'pending'}};});
  for(const item of data.items)if(!seen.has(item.id))items.push({...item,status:'history'});
  for(const item of items)if(item.archive.state==='saved'&&!await filePresent(state.workPath,item.archive))item.archive={state:'error',error:'本地视频文件已移动或改变，请重试保存。'};
  return {folder:await checked(folder(state.workPath)),items,...(failures.has(state.workPath)?{error:failures.get(state.workPath)}:{})};
 }
 async function readChunk(work,id,offset=0){
  const item=(await index(work)).items.find(x=>x.id===id),a=item?.archive;
  const prefix=folder(work)+'/';
  if(a?.state!=='saved'||!a.localPath.startsWith(prefix)||! /^[^/\\]+\.(mp4|webm)$/.test(a.localPath.slice(prefix.length)))throw Error('视频尚未保存，请先重试保存。');
  const file=await open(await checked(a.localPath),'r');try{
   const info=await file.stat();if(info.size>MAX||info.size!==a.size||offset>info.size)throw Error('视频文件已改变或读取范围无效，请重试保存。');
   const buffer=Buffer.alloc(Math.min(CHUNK,info.size-offset)),{bytesRead}=await file.read(buffer,0,buffer.length,offset);
   return {base64:buffer.subarray(0,bytesRead).toString('base64'),offset,next:offset+bytesRead,total:info.size,mime:a.mime};
  }finally{await file.close();}
 }
 return {schedule,list,readChunk,settled:work=>running.get(work)||Promise.resolve()};
}
