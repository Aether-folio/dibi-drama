import {build} from 'esbuild';
import {copyFile,cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const runtime=resolve(root,'runtime');
const input=resolve(root,'plugins/dibi-drama');
const target=resolve(runtime,'dist');
await mkdir(target,{recursive:true});
const [client,server]=await Promise.all([
  build({entryPoints:[resolve(root,'src/app.mjs')],bundle:true,format:'iife',platform:'browser',target:'chrome120',write:false,minify:true,loader:{'.gif':'dataurl'},define:{__WORKBENCH_MODE__:'"drama"'}}),
  build({entryPoints:[resolve(root,'src/server.mjs')],bundle:true,format:'esm',platform:'node',target:'node22',write:false,define:{__DRAMA_PLUGIN__:'true'},banner:{js:'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);'}}),
]);
const styles=await Promise.all([resolve(root,'src/style.css'),resolve(root,'src/monochrome.css'),resolve(input,'launch.css')].map(path=>readFile(path,'utf8')));
const launch=await readFile(resolve(input,'launch.html'),'utf8');
const template=await readFile(resolve(root,'src/template.html'),'utf8');
const html=template.replace('<title>递笔工作台</title>','<title>递笔漫剧制作</title>')
  .replace(/<nav class="workspace-modes"[^>]*>.*?<\/nav>/,'')
  .replace(/<button id="drama-open"[^>]*>.*?<\/button>/,'')
  .replace('<main id="writing-desk">',()=>launch+'\n<main id="writing-desk" hidden>')
  .replace('/* WORKBENCH_STYLES */',()=>styles.join('\n'))
  .replace('/* WORKBENCH_SCRIPT */',()=>client.outputFiles[0].text.replace(/<\/script/gi,'<\\/script'));
await Promise.all([
  writeFile(resolve(target,'editor.html'),html),
  writeFile(resolve(target,'server.mjs'),server.outputFiles[0].contents),
  cp(resolve(input,'.codex-plugin'),resolve(runtime,'.codex-plugin'),{recursive:true}),
  cp(resolve(input,'skills'),resolve(runtime,'skills'),{recursive:true}),
  cp(resolve(root,'assets/fonts'),resolve(runtime,'assets/fonts'),{recursive:true}),
]);
const env=process.env.WORKBENCH_WORKSPACE?.trim();
const mcpServers={dibi_drama:{command:process.execPath,args:[resolve(target,'server.mjs')],cwd:runtime,...(env?{env:{WORKBENCH_WORKSPACE:resolve(env)}}:{})}};
await writeFile(resolve(runtime,'.mcp.json'),JSON.stringify({mcpServers},null,2)+'\n');
console.log('Built dibi-drama in runtime/.');
