// One editable manuscript and a derived structured view, linked by stable shot IDs.
const fields={view:'景别与运镜',duration:'时长',characters:'角色',scene:'场景',action:'画面动作',startDesc:'首帧',endDesc:'尾帧',dialogue:'台词',sound:'音效',sourceExcerpt:'对应原文'};
export function storyboardText(shots){return shots.map((s,i)=>`## ${i+1}. ${s.title}\n<!-- shot:${s.id} -->\n${Object.entries(fields).map(([k,label])=>label+'：'+(Array.isArray(s[k])?s[k].join('、'):s[k]??'')).join('\n')}\n`).join('\n');}
export function parseStoryboard(text){
 const headings=[...text.matchAll(/^##\s+(?:\d+[.、．]\s*)?(.+)$/gm)];
 if(!headings.length)throw Error('请使用“## 镜头名称”划分分镜，再填写画面动作。');
 const result=headings.map((h,i)=>{const end=headings[i+1]?.index??text.length,body=text.slice(h.index+h[0].length,end),id=/<!--\s*shot:([0-9a-f-]{36})\s*-->/i.exec(body)?.[1],s={title:h[1].trim(),textStart:h.index,textEnd:end};if(id)s.id=id;
  const rows=[...body.matchAll(/^(景别与运镜|时长|角色|场景|画面动作|首帧|尾帧|台词|音效|对应原文)[：:][ \t]*(.*)$/gm)];
  for(let n=0;n<rows.length;n++){const row=rows[n],key=Object.keys(fields).find(k=>fields[k]===row[1]);s[key]=body.slice(row.index+row[0].length-row[2].length,rows[n+1]?.index??body.length).replace(/<!--.*?-->/gs,'').trim();}
  s.duration=Number(String(s.duration||'3').replace(/\s*秒\s*$/,''));s.characters=(s.characters||'').split(/[、,，；;]/).map(x=>x.trim()).filter(Boolean);s.dialogue||='无台词';s.view||='中景';s.scene||='';
  if(!s.action)throw Error(`第 ${i+1} 镜“${s.title}”缺少画面动作。`);if(!Number.isFinite(s.duration)||s.duration<.5||s.duration>30)throw Error(`第 ${i+1} 镜的时长须为 0.5–30 秒。`);return s;
 });
 const ids=result.map(x=>x.id).filter(Boolean);if(new Set(ids).size!==ids.length)throw Error('分镜编号重复，请删除复制镜头中的 shot 标记后重试。');return result;
}
export function sourceRange(source,excerpt){if(!excerpt?.trim())return null;const at=source.indexOf(excerpt);if(at<0||source.indexOf(excerpt,at+1)>=0)return null;return {start:at,end:at+excerpt.length};}
export function requiredAssets(project,shots){const ids=new Set(shots.filter(s=>s.settings.mode!=='text').flatMap(s=>s.refs));return project.assets.filter(a=>ids.has(a.id));}
export const taskName=shots=>shots.map(s=>s.title).join('、');
