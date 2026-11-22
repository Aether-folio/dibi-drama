// A successful read is not evidence that the host permits or decodes the media.
export function loadVideoSource(video,src,{signal,timeout=15000}={}){
 return new Promise((resolve,reject)=>{
  let timer,settled=false;
  const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);video.removeEventListener('loadeddata',ready);video.removeEventListener('error',failed);document.removeEventListener('securitypolicyviolation',blocked);signal?.removeEventListener('abort',aborted);error?reject(error):resolve();};
  const ready=()=>{if(video.readyState>=2)finish();};
  const failed=()=>finish(Error(video.error?.code===3?'当前宿主无法解码这段视频。':video.error?.code===4?'当前宿主未能载入这段视频。':'视频加载失败，请重试。'));
  const blocked=e=>{if(e.effectiveDirective==='media-src'&&(e.blockedURI===src||src.startsWith(e.blockedURI+':')))finish(Error('当前宿主限制了这种视频地址。'));};
  const aborted=()=>finish(new DOMException('播放已取消','AbortError'));
  if(signal?.aborted){aborted();return;}
  video.addEventListener('loadeddata',ready);video.addEventListener('error',failed);document.addEventListener('securitypolicyviolation',blocked);signal?.addEventListener('abort',aborted,{once:true});
  timer=setTimeout(()=>finish(Error('视频载入超时，请重试或切换在线播放。')),timeout);
  video.src=src;video.preload='auto';video.load();ready();
 });
}
const inlineSource=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('本地视频转换失败。'));reader.readAsDataURL(blob);});
export async function loadVideoWithFallback(video,{cache,remoteUrl,signal,onAttempt=()=>{},online=false}){
 const sources=[];
 if(!online&&cache){sources.push({kind:'local',url:()=>cache.url});if(cache.blob.size<=64*1024*1024)sources.push({kind:'inline',url:async()=>cache.inline||(cache.inline=await inlineSource(cache.blob))});}
 if(remoteUrl)sources.push({kind:'online',url:()=>remoteUrl});
 let last;
 for(const source of sources){if(signal?.aborted)throw new DOMException('播放已取消','AbortError');onAttempt(source.kind);try{await loadVideoSource(video,await source.url(),{signal});return source.kind;}catch(e){if(e.name==='AbortError')throw e;last=e;}}
 throw last||Error('没有可播放的视频文件或链接。');
}
