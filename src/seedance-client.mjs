import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {seedanceModel} from './seedance-pricing.mjs';
const endpoint='https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
const secretPath='数据/凭据/火山方舟.json';
// DPAPI binds the stored secret to the current Windows user; plaintext never goes in argv.
function protect(value,decrypt=false){
 if(process.platform!=='win32')throw Error('此系统请通过后台环境变量 ARK_API_KEY 配置密钥。');
 const code=`Add-Type -AssemblyName System.Security; $data=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
 return new Promise((resolve,reject)=>{const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';const timer=setTimeout(()=>p.kill(),15000);p.stdout.on('data',d=>output+=d);p.stderr.resume();p.on('error',()=>{clearTimeout(timer);reject(Error('无法使用 Windows 密钥保护。'));});p.on('close',exit=>{clearTimeout(timer);if(exit!==0)return reject(Error('无法读取或保存 Windows 加密密钥，请重新配置。'));resolve(decrypt?Buffer.from(output.trim(),'base64').toString('utf8'):output.trim());});p.stdin.on('error',()=>{});p.stdin.end(decrypt?value:Buffer.from(value).toString('base64'));});
}
export function createSeedanceClient({checked,atomic,fetchImpl=(...args)=>fetch(...args),env=process.env,vault=protect}){
 async function config(){try{return JSON.parse(await readFile(await checked(secretPath),'utf8'));}catch(e){if(e.code==='ENOENT')return {};throw Error('官方通道配置无法读取，请重新保存。');}}
 async function status(){const c=await config();return {configured:Boolean(c.encrypted||env.ARK_API_KEY),source:c.encrypted?'Windows 加密保存':env.ARK_API_KEY?'后台环境变量':'未配置',model:seedanceModel};}
 async function credential(){const c=await config(),key=c.encrypted?await vault(c.encrypted,true):env.ARK_API_KEY;if(!key)throw Error('请先在“官方接口设置”中配置火山方舟 API Key。');const identity=createHash('sha256').update(key).digest('hex');return {key,identity,revision:c.revision||identity};}
 async function call(method,suffix,body,key){
  let response;try{response=await fetchImpl(endpoint+suffix,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(method==='POST'?55000:10000)});}catch{throw Error(method==='POST'?'提交结果未知：连接中断，可能已经创建任务。请到方舟控制台核对，勿重复生成。':'查询暂时失败，稍后重试查询；不会重复生成。');}
  if(!response.ok){const e=Error(`官方接口返回 HTTP ${response.status}。${response.status===401||response.status===403?'请检查 API Key、模型开通状态和账户权限。':response.status===429?'请求受限，请稍后重新询价。':'请在方舟控制台查看失败原因。'}`);e.definitive=method!=='POST'||[400,401,403,404,422,429].includes(response.status);throw e;}
  try{return await response.json();}catch{throw Error('官方响应不完整，请到控制台核对；不会自动重复生成。');}
 }
 return {status,credential,
  async save({apiKey,clear=false}){if(clear)await atomic(secretPath,JSON.stringify({revision:randomUUID()}));else{if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>4096||/[\r\n]/.test(apiKey))throw Error('请输入有效 API Key。');await atomic(secretPath,JSON.stringify({encrypted:await vault(apiKey.trim()),revision:randomUUID()}));}return status();},
  async submit(body,credential){const r=await call('POST','',body,credential.key);if(typeof r.id!=='string'||!/^cgt-[A-Za-z0-9_-]+$/.test(r.id))throw Error('未收到有效任务编号，请到方舟控制台核对；不会自动重试。');return r.id;},
  async query(id,credential){if(!/^cgt-[A-Za-z0-9_-]+$/.test(id))throw Error('官方任务编号无效。');return call('GET','/'+encodeURIComponent(id),null,credential.key);}
 };
}
