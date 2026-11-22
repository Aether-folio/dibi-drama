import {randomUUID} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';

test('独立漫剧插件只暴露自己的入口并阻止保存小说正文',async()=>{
  const command=fileURLToPath(new URL('../runtime/dist/server.mjs',import.meta.url));
  const directory=await mkdtemp(join(tmpdir(),'dibi-drama-test-'));
  const client=new Client({name:'drama-integration-test',version:'1.0.0'});
  const transport=new StdioClientTransport({
    command:process.execPath,args:[command],stderr:'pipe',
    env:{...process.env,WORKBENCH_WORKSPACE:directory},
  });
  try{
    await client.connect(transport);
    const {tools}=await client.listTools();
    const open=tools.find(tool=>tool.name==='open_drama');
    assert.ok(open);
    assert.equal(open._meta.ui.resourceUri,'ui://dibi-drama/editor.html');
    assert.ok(tools.some(tool=>tool.name==='get_drama_request'));
    assert.ok(tools.some(tool=>tool.name==='get_storyboard_writing_request'));
    assert.ok(!tools.some(tool=>['open_workbench','get_writing_request','stage_chat_edits','delete_document'].includes(tool.name)));
    const resource=await client.readResource({uri:open._meta.ui.resourceUri});
    assert.match(resource.contents[0].text,/id="drama-launch-open"/);
    assert.equal((await client.callTool({name:'open_drama',arguments:{}})).isError,undefined);
    const denied=await client.callTool({name:'save_document',arguments:{path:'作品/正文/第一章.md',body:'正文'}});
    assert.equal(denied.isError,true);
    assert.match(denied.content[0].text,/只能保存分镜稿/);
    const call=async(name,args)=>{
      const result=await client.callTool({name,arguments:args});
      assert.ok(!result.isError,result.content?.[0]?.text);
      return result.structuredContent??JSON.parse(result.content[0].text);
    };
    assert.deepEqual((await call('list_drama_workflows',{})).workflows,[]);
    const id=randomUUID(),created=await call('create_drama_workflow',{id});
    assert.equal((await call('create_drama_workflow',{id})).workPath,created.workPath);
    const input={workPath:created.workPath};
    let state=await call('save_drama_workflow',{...input,revision:created.revision,name:'雨夜',source:'许宁推门。',script:'',editing:false});
    state=await call('start_drama_script_conversion',{...input,revision:state.revision});
    const args={...input,jobId:state.job.id};
    const context=await call('get_drama_script_request',args);
    assert.equal(context.skill,'short-drama-write');
    assert.equal(context.source,'许宁推门。');
    await call('publish_drama_script_result',{...args,token:context.token,result:{type:'script',text:'许宁推门走进屋。'}});
    state=await call('use_drama_script_candidate',{...args,revision:state.revision});
    const {path}=await call('prepare_drama_script',{...input,revision:state.revision});
    const script=await call('read_document',{path});
    assert.equal(script.body,'许宁推门走进屋。');
    await call('save_document',{path,body:'许宁推门走进屋，停在门口。',revision:script.revision});
    const reopened=await call('load_drama_workflow',input);
    assert.equal(reopened.script,'许宁推门走进屋，停在门口。');
    assert.equal((await call('workspace_info',{})).files.length,0);
    assert.ok((await call('workspace_info',input)).files.some(file=>file.path===path));
    assert.equal((await call('list_drama_workflows',{})).workflows[0].name,'雨夜');

  }finally{
    await client.close();
    await rm(directory,{recursive:true,force:true});
  }
});
