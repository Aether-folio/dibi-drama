import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename} from 'node:path';
const indexPath='数据/TapNow素材索引.json';
export function createDramaLibrary({checked,atomic,localImage}){
 async function read(){try{const data=JSON.parse(await readFile(await checked(indexPath),'utf8'));if(data.version!==1||!data.entries||typeof data.entries!=='object')throw Error('TapNow 素材索引损坏，请保留文件并检查。');return data.entries;}catch(e){if(e.code==='ENOENT')return {};throw e;}}
 async function inventory(work,project){
  const entries=await read(),sources=[...project.assets.map(a=>({key:'reference:'+a.id,title:a.name,path:a.media?.localPath||a.localPath})),...project.shots.flatMap(s=>['start','end'].map(k=>({key:k+':'+s.id,title:s.title+' · '+(k==='start'?'首帧':'尾帧'),path:s[k]?.localPath})))].filter(x=>x.path);
  const hashes=new Map();
  for(const item of sources){let info=hashes.get(item.path);if(!info){const {bytes,mime}=await localImage(work,item.path);info={sha256:createHash('sha256').update(bytes).digest('hex'),fileSize:bytes.length,mime};hashes.set(item.path,info);}Object.assign(item,info,{localPath:await checked(item.path),fileName:basename(item.path),remote:entries[info.sha256]||null,uploadTitle:'WB-'+info.sha256,uploadFileName:'WB-'+info.sha256+'.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[info.mime])});}
  return sources;
 }
 async function record(item,result){
  const {bytes}=await localImage(item.workPath,item.path),hash=createHash('sha256').update(bytes).digest('hex');
  if(hash!==item.sha256||result.sha256!==hash)throw Error('本地图片内容已变化，不能关联旧的上传结果。');
  const entries=await read(),old=entries[hash]||{};
  if(old.fileId&&result.stage!=='saved')throw Error('素材已入库，不得重复上传。');
  const rank={started:0,prepared:1,uploaded:2,indexing:3,saved:4};if(old.stage&&rank[result.stage]<rank[old.stage])throw Error('上传进度不能回退。');
  if(result.stage==='prepared'&&!result.uploadId)throw Error('请回填真实 upload_id。');
  if(old.uploadId&&result.uploadId&&old.uploadId!==result.uploadId)throw Error('不能覆盖已有上传记录。');
  if(old.imageId&&result.imageId&&old.imageId!==result.imageId)throw Error('不能覆盖已有图片记录。');
  if(result.stage==='started'&&(old.uploadId||old.imageId||old.stage))throw Error('已有上传记录，先恢复或核对原上传，不能重复上传。');
  if(result.stage==='uploaded'&&(!result.imageId||!result.projectId))throw Error('请回填真实图片 ID 和项目 ID。');
  if(result.stage==='saved'&&!result.fileId)throw Error('请回填素材库返回的真实 file_id。');
  if(old.fileId&&old.fileId!==result.fileId)throw Error('相同图片已有素材库 ID，不能覆盖。');
  entries[hash]={...old,...result,updatedAt:new Date().toISOString()};
  await atomic(indexPath,JSON.stringify({version:1,entries},null,2));return entries[hash];
 }
 return {inventory,read,record};
}
export const libraryInstructions='这是已授权的本地素材同步，不生图、不生成视频、不收取生成积分。仅处理 context.item。先用 find_library_assets 在 private 搜索 uploadTitle（完整 SHA256 唯一标题）；若哈希名无匹配，再按原 fileName（去扩展名）检索历史手动上传；仅在 source_url 原图字节的 SHA256 与 item.sha256 一致时复用，不能仅凭名字或外观判断。已有真实匹配则回填 library-sync stage=saved 和 fileId，绝不重复上传。remote.fileId 已有时复用，需验证可按 remote.assetId 查询（asset_ids 是素材编号，不是 file_id）。remote.stage=indexing 表示已入库，只检索结果，不再次 save_to_library。remote.imageId 已有时先检索 uploadTitle；旧记录可检索原 fileName 去除扩展名，并核对返回 file_id 与 remote.uploadId 一致。未找到且非 indexing 才继续 save_to_library，成功立刻回填 stage=indexing，然后检索真实 file_id。remote.uploadId 已有时只用 upload_image({upload_id})完成原上传，不新建上传。没有任何记录且搜索无匹配时，先回填 stage=started，再调用 upload_image local_file（file_name 必须用 item.uploadFileName，file_size/mime_type 与 item 一致；本地仍读取 item.localPath，title=uploadTitle），立刻回填 stage=prepared/uploadId，运行返回的上传命令（本地路径用 item.localPath），完成后回填 stage=uploaded/imageId/projectId，再 save_to_library 到 folder_name=递笔工作台，成功立刻回填 stage=indexing，再检索真实 file_id 与 asset_id 后回填 stage=saved/fileId/assetId。每个阶段都使用原 workPath/jobId/token/sha256，部分回传不会结束任务。若只有 started 记录且结果未知，先核对素材库；无法确定时返回 error，不盲目重传。错误保留已保存进度。回传 nextJobIds 后继续处理，quote 只询价，绝不代替用户确认积分。';
