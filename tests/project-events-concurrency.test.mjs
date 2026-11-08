import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rename,rm} from 'node:fs/promises';
import {scryptSync} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=path.dirname(root),nativeFetch=globalThis.fetch;
let dir,service,base,cookie;const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
before(async()=>{
  dir=await mkdtemp(path.join(work,'event-concurrency-'));await mkdir(path.join(dir,'data/uploads'),{recursive:true});await mkdir(path.join(dir,'public'));
  for(const file of ['server.mjs','public/personal-history-model.js','public/project-events-model.js'])await copyFile(path.join(root,file),path.join(dir,file));
  const people=[{id:'u-concurrent',name:'甲',role:'组长'}],account={id:people[0].id,name:'甲',account:'leader',salt:'event-concurrency',password:scryptSync('demo1234','event-concurrency',64).toString('hex')};
  const workspace={project:{id:'p-concurrent',name:'原项目',topic:'测试',status:'进行中',startDate:'2026-01-01',endDate:''},people,meetings:[{id:'m-1',title:'测试会议',status:'已结束',hostId:people[0].id,organizerId:people[0].id}],files:[{id:'audio',name:'录音.wav',kind:'会议录音',meetingId:'m-1',ext:'.wav',storage:'audio.wav',durationSeconds:10,consent:{confirmed:true},transcriptions:[],analyses:[{id:'analysis',status:'处理中',progress:0}]}],events:[],logs:[],assignments:[],invites:[]};
  await writeFile(path.join(dir,'data/store.json'),JSON.stringify({accounts:[account],workspaces:[workspace],sessions:[],todos:[],notifications:[]}));await writeFile(path.join(dir,'data/uploads/audio.wav'),'test bytes');
  const serverFile=path.join(dir,'server.mjs');await writeFile(serverFile,(await readFile(serverFile,'utf8'))+'\nexport {server,operationContext,save,mutateData,runWorkspaceTask,database,recordProjectEvent};\n');
  process.env.PORT='0';process.env.HOST='127.0.0.1';process.env.ASSEMBLYAI_API_KEY='fixture-only';process.env.TENCENTCLOUD_SECRET_ID='fixture-only';process.env.TENCENTCLOUD_SECRET_KEY='fixture-only';process.env.DASHSCOPE_API_KEY='fixture-only';process.env.ASR_PROVIDER='assemblyai';
  service=await import(pathToFileURL(serverFile));if(!service.server.listening)await new Promise(resolve=>service.server.once('listening',resolve));base=`http://127.0.0.1:${service.server.address().port}`;
  const response=await nativeFetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:'leader',password:'demo1234'})});assert.equal(response.status,200);cookie=response.headers.get('set-cookie').split(';')[0];
});
after(async()=>{globalThis.fetch=nativeFetch;if(service)await new Promise(resolve=>service.server.close(resolve));if(dir){assert.ok(dir.startsWith(work+path.sep));await rm(dir,{recursive:true,force:true})}});
async function api(route,method='GET',data,operationId){const response=await nativeFetch(base+route,{method,headers:{cookie,'content-type':'application/json','X-Project-Id':'p-concurrent',...(operationId?{'X-Operation-Id':operationId}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,data:await response.json()}}
const workspace=()=>service.database.workspaces[0];
test('后台保存与业务事务共用独占队列，事务失败不能被后台提前落盘',async()=>{
  const saved=defer(),release=defer();
  const background=service.mutateData(async()=>{workspace().files[0].analyses[0].progress=20;await service.save();saved.resolve();await release.promise});await saved.promise;
  const pending=api('/api/project','PATCH',{name:'失败的新项目名',topic:'测试',startDate:'2026-01-01',endDate:''});await new Promise(resolve=>setTimeout(resolve,30));assert.equal(workspace().project.name,'原项目');
  const file=path.join(dir,'data/store.json'),backup=path.join(dir,'data/store.backup');await rename(file,backup);await mkdir(file);release.resolve();await background;
  try{assert.equal((await pending).status,500);assert.equal(workspace().project.name,'原项目');assert.equal(workspace().events.length,0);const persisted=JSON.parse(await readFile(backup,'utf8'));assert.equal(persisted.workspaces[0].project.name,'原项目');assert.equal(persisted.workspaces[0].events.length,0)}finally{await rm(file,{recursive:true});await rename(backup,file)}
});
test('后台分析在独立副本运行，保存失败撤回成功事件，重试保留已提交数据',async()=>{
  const file=path.join(dir,'data/store.json'),backup=path.join(dir,'data/store.backup');await rename(file,backup);await mkdir(file);
  try{
    await service.runWorkspaceTask(async(w,f,analysis)=>{analysis.status='已完成';service.recordProjectEvent(w,{id:'u-concurrent',name:'甲'},{kind:'AI资料分析',title:'分析完成',fileId:f.id});try{await service.save()}catch{assert.equal(analysis.status,'处理中');assert.equal(w.events.length,0)}},[workspace(),workspace().files[0],workspace().files[0].analyses[0]]);
    assert.equal(workspace().files[0].analyses[0].status,'处理中');assert.equal(workspace().events.length,0);
  }finally{await rm(file,{recursive:true});await rename(backup,file)}
  await service.runWorkspaceTask(async(w,f,analysis)=>{analysis.status='已完成';service.recordProjectEvent(w,{id:'u-concurrent',name:'甲'},{kind:'AI资料分析',title:'分析完成',fileId:f.id});await service.save()},[workspace(),workspace().files[0],workspace().files[0].analyses[0]]);
  assert.equal(workspace().files[0].analyses[0].status,'已完成');assert.equal(workspace().files[0].analyses[0].progress,20);assert.equal(workspace().events.length,1);
});
test('三个供应商的并发转写轮询只完成一次，人工修订不会被后续轮询覆盖',async()=>{
  for(const provider of ['阿里云百炼','腾讯云语音识别','AssemblyAI']){
    const id='job-'+provider;await service.mutateData(async()=>{workspace().files[0].transcriptions.push({id,status:'转写中',provider,remoteId:'fixture-task',version:1,editVersion:1,rawText:'',editedText:'',createdBy:'甲',createdById:'u-concurrent'});await service.save()});
    const entered=defer(),release=defer();let calls=0;
    globalThis.fetch=async(url,options)=>{
      if(String(url).startsWith(base))return nativeFetch(url,options);
      ++calls;entered.resolve();await release.promise;
      if(String(url).includes('transcription.json'))return Response.json({transcripts:[{text:'云端原稿'}]});
      if(provider==='阿里云百炼')return Response.json({output:{task_status:'SUCCEEDED',results:[{subtask_status:'SUCCEEDED',transcription_url:'https://fixture.invalid/transcription.json'}]}});
      if(provider==='腾讯云语音识别')return Response.json({Response:{Data:{Status:2,AudioDuration:10,Result:'云端原稿'}}});
      return Response.json({status:'completed',text:'云端原稿',audio_duration:10});
    };
    const route='/api/audio/transcript?audioId=audio&id='+encodeURIComponent(id),first=api(route);await entered.promise;const second=api(route);release.resolve();assert.equal((await first).status,200);assert.equal((await second).status,200);
    assert.equal(calls,provider==='阿里云百炼'?2:provider==='AssemblyAI'?3:1,provider+' external calls');assert.equal(workspace().events.filter(e=>e.dedupeKey===`transcript-completed:${id}`).length,1,provider+' completion events');
    assert.equal((await api('/api/audio/transcript','PATCH',{audioId:'audio',id,version:1,editedText:'人工修订稿'})).status,200);assert.equal((await api(route)).data.editedText,'人工修订稿');assert.equal(workspace().files[0].transcriptions.find(t=>t.id===id).editVersion,2);
  }
  globalThis.fetch=nativeFetch;
});
test('成功转写提交与重试回执一起保存，失败提交不生成成功事件',async()=>{
  globalThis.fetch=async(url,options)=>String(url).includes('/upload')?Response.json({upload_url:'https://fixture.invalid/audio'}):Response.json({id:'accepted-fixture-task'});
  const before=workspace().events.length,request={audioId:'audio',newVersion:true},first=await api('/api/audio/transcribe','POST',request,'submit-once'),second=await api('/api/audio/transcribe','POST',request,'submit-once');assert.equal(first.status,202);assert.equal(second.status,202);assert.equal(first.data.id,second.data.id);assert.equal(workspace().events.length,before+1);
  const persisted=JSON.parse(await readFile(path.join(dir,'data/store.json'),'utf8'));assert.ok(persisted.operationReceipts.some(r=>r.operationId==='submit-once'));
  await service.mutateData(async()=>{workspace().files[0].transcriptions.find(t=>t.id===first.data.id).status='失败';await service.save()});globalThis.fetch=async()=>Response.json({error:'fixture rejection'},{status:502});
  assert.equal((await api('/api/audio/transcribe','POST',request,'submit-failed')).status,502);assert.equal(workspace().events.length,before+1);globalThis.fetch=nativeFetch;
});
test('资料分析仅在提交成功后启动，提交与完成分别生成准确事件',async()=>{
  await writeFile(path.join(dir,'data/uploads/doc.txt'),'真实资料正文');await service.mutateData(async()=>{workspace().files.push({id:'doc',name:'资料.txt',ext:'.txt',storage:'doc.txt',size:30,meetingId:'m-1',analyses:[]});await service.save()});
  let calls=0;globalThis.fetch=async()=>{++calls;return Response.json({choices:[{message:{content:'依据资料整理的分析结果'}}]})};
  const file=path.join(dir,'data/store.json'),backup=path.join(dir,'data/store.backup'),data={fileId:'doc',externalConsent:'yes'};await rename(file,backup);await mkdir(file);const before=workspace().events.length;
  try{assert.equal((await api('/api/files/analyze','POST',data,'analyze-once')).status,500);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(calls,0);assert.equal(workspace().events.length,before);assert.equal(workspace().files.find(f=>f.id==='doc').analyses.length,0)}finally{await rm(file,{recursive:true});await rename(backup,file)}
  const first=await api('/api/files/analyze','POST',data,'analyze-once'),retry=await api('/api/files/analyze','POST',data,'analyze-once');assert.equal(first.status,202);assert.equal(retry.data.id,first.data.id);
  const deadline=Date.now()+5000;while(workspace().files.find(f=>f.id==='doc').analyses[0]?.status==='处理中'&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(workspace().files.find(f=>f.id==='doc').analyses[0].status,'已完成');assert.equal(workspace().events.length,before+2);assert.equal(workspace().events.filter(e=>e.source?.id===first.data.id).length,2);globalThis.fetch=nativeFetch;
});
