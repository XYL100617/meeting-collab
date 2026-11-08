import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,rm,readFile,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {scryptSync} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=path.dirname(root);
let dir,child,base,cookies={};
before(async()=>{
  dir=await mkdtemp(path.join(work,'events-api-'));await mkdir(path.join(dir,'data'));await mkdir(path.join(dir,'public'));
  for(const file of ['server.mjs','public/personal-history-model.js','public/project-events-model.js'])await copyFile(path.join(root,file),path.join(dir,file));
  const people=[{id:'u-1',name:'甲',role:'组长'},{id:'u-2',name:'乙',role:'成员'}],accounts=['leader','member'].map((account,i)=>({id:people[i].id,name:people[i].name,account,salt:'events-test',password:scryptSync('demo1234','events-test',64).toString('hex')}));
  accounts.push({id:'u-new',name:'新用户',account:'newaccount',salt:'events-test',password:scryptSync('demo1234','events-test',64).toString('hex')});
  const workspace={project:{id:'p-events',name:'事件测试',topic:'测试',startDate:'2026-01-01',endDate:'',status:'进行中'},people,meetings:[{id:'m-a',title:'同名会议',hostId:'u-2',organizerId:'u-2',status:'待召开',date:'2026-11-08'},{id:'m-b',title:'同名会议',hostId:'u-1',organizerId:'u-1',status:'待召开',date:'2026-11-08'}],files:[{id:'audio-1',kind:'会议录音',meetingId:'m-b',transcriptions:[{id:'t-1',status:'已完成',rawText:'原稿',editedText:'原稿',revisions:[]}]}],assignments:[{id:'a-1',content:'相同工作',ownerId:'u-1',owner:'甲',meetingId:'m-b',meeting:'同名会议',version:1},{id:'a-2',content:'相同工作',ownerId:'u-1',owner:'甲',meetingId:'m-b',meeting:'同名会议',version:1}],logs:[],events:[{id:'legacy',kind:'会议',title:'旧记录',date:'2026-01-01',meetingId:'m-b'}],invites:[],focusMarks:[]};
  await writeFile(path.join(dir,'data/store.json'),JSON.stringify({accounts,workspaces:[workspace],sessions:[],notifications:[],todos:[]}));
  const port=await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})});base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(Error('Server start timeout')),10000);child.stdout.on('data',data=>{output+=data;if(output.includes(`localhost:${port}`)){clearTimeout(timer);resolve()}});child.stderr.on('data',data=>errors+=data);child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error(errors||'Server exited'))})});
  for(const account of ['leader','member','newaccount']){const response=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account,password:'demo1234'})});assert.equal(response.status,200);cookies[account]=response.headers.get('set-cookie').split(';')[0]}
});
after(async()=>{if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited}if(dir){assert.ok(dir.startsWith(work+path.sep));await rm(dir,{recursive:true,force:true})}});
async function api(route,method='GET',data,account='leader',operationId,projectId='p-events'){
  const response=await fetch(base+route,{method,headers:{cookie:cookies[account],'content-type':'application/json','X-Project-Id':projectId,...(operationId?{'X-Operation-Id':operationId}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,data:await response.json()};
}
const events=async()=>(await api('/api/project-events?limit=100')).data.items;
test('旧事件保留缺失字段，新事件有准确字段；项目相同保存不增事件',async()=>{
  assert.equal((await api('/api/project-events')).status,200);const old=(await events()).find(e=>e.id==='legacy');assert.equal(old.at,null);assert.equal(old.operator.id,null);
  const data={name:'修改后的项目',topic:'测试',startDate:'2026-01-01',endDate:''};assert.equal((await api('/api/project','PATCH',data)).status,200);
  const list=await events(),e=list[0];assert.equal(e.projectId,'p-events');assert.equal(e.operator.id,'u-1');assert.ok(Number.isFinite(Date.parse(e.at)));assert.equal(e.source.type,'project');assert.ok(e.summary);
  await api('/api/project','PATCH',data);assert.equal((await events()).length,list.length);
});
test('验证失败、越权和个人操作不生成公开事件，同名会议遵从明确ID',async()=>{
  const before=(await events()).length;
  assert.equal((await api('/api/meetings','POST',{})).status,400);
  assert.equal((await api('/api/assignments','PATCH',{id:'a-1',version:1,content:'越权修改',ownerId:'u-1'},'member')).status,403);
  assert.equal((await api('/api/assignments','POST',{meetingId:'m-b',meeting:'同名会议',content:'越权新增',ownerId:'u-2'},'member')).status,403);
  await api('/api/focus-marks','POST',{scope:'personal',targetType:'meeting',targetId:'m-b',stars:3,note:'私人'});
  await api('/api/meetings/reminders','POST',{meetingId:'m-b',personalMinutes:[10]});
  assert.equal((await events()).length,before);assert.equal((await api('/api/project-events','GET',undefined,'leader',undefined,'foreign')).status,403);
});
test('新会议ID不接受覆盖，重复并发创建仅生成一次；令牌不同正文被拒绝',async()=>{
  const data={id:'m-b',title:'新会议',topic:'议题',date:'2026-11-08',start:'09:00',end:'10:00',hostId:'u-1',attendeeIds:['u-1'],format:'线下',location:'办公室'},before=(await events()).length;
  const responses=await Promise.all([api('/api/meetings','POST',data,'leader','meeting-once'),api('/api/meetings','POST',data,'leader','meeting-once')]);
  assert.equal(responses[0].status,201);assert.equal(responses[1].status,201);assert.notEqual(responses[0].data.id,'m-b');assert.equal(responses[0].data.id,responses[1].data.id);assert.equal((await events()).length,before+1);
  assert.equal((await api('/api/meetings','POST',{...data,title:'另一会议'},'leader','meeting-once')).status,409);
  const persisted=JSON.parse(await readFile(path.join(dir,'data/store.json'),'utf8'));assert.ok(persisted.operationReceipts.some(r=>r.operationId==='meeting-once'));
});
test('清除全队重点、全队提醒仅在真正改变时留痕',async()=>{
  const target={scope:'team',targetType:'meeting',targetId:'m-b'};await api('/api/focus-marks','POST',{...target,stars:3});const before=(await events()).length;
  await api('/api/focus-marks','POST',{...target,stars:0});assert.equal((await events()).length,before+1);await api('/api/focus-marks','POST',{...target,stars:0});assert.equal((await events()).length,before+1);
  await api('/api/meetings/reminders','POST',{meetingId:'m-b',teamMinutes:[30,10]});const count=(await events()).length;await api('/api/meetings/reminders','POST',{meetingId:'m-b',teamMinutes:[10,30]});assert.equal((await events()).length,count);
});
test('同内容分工切换产生一次日志更新，删除保留摘要但禁止跳转',async()=>{
  const created=await api('/api/logs','POST',{date:'2026-01-01',text:'工作记录',linkAssignmentId:'a-1'});assert.equal(created.status,201);
  const id=created.data.id,before=(await events()).length;const updated=await api('/api/logs','PATCH',{id,version:1,date:'2026-01-01',text:'工作记录',linkAssignmentId:'a-2'});assert.equal(updated.data.linkAssignmentId,'a-2');assert.equal((await events()).length,before+1);
  await api('/api/logs','PATCH',{id,version:2,date:'2026-01-01',text:'工作记录',linkAssignmentId:'a-2'});assert.equal((await events()).length,before+1);
  await api('/api/logs','DELETE',{id});const deletion=(await events()).find(e=>e.action==='log-deleted');assert.ok(deletion.summary.includes('工作记录'));assert.equal(deletion.sourceAvailable,false);assert.equal((await api('/api/project-events/source?id='+deletion.id)).status,404);
});
test('转写修订与邀请操作记录精确来源；重复保存不增加',async()=>{
  const before=(await events()).length;assert.equal((await api('/api/audio/transcript','PATCH',{audioId:'audio-1',id:'t-1',version:1,editedText:'修订稿'})).status,200);assert.equal((await events()).length,before+1);
  await api('/api/audio/transcript','PATCH',{audioId:'audio-1',id:'t-1',version:2,editedText:'修订稿'});assert.equal((await events()).length,before+1);
  const invite=await api('/api/invites','POST',{});assert.equal(invite.status,201);const count=(await events()).length;await api('/api/invites','POST',{});assert.equal((await events()).length,count);
  await api('/api/invites/revoke','POST',{id:invite.data.id});await api('/api/invites/revoke','POST',{id:invite.data.id});assert.equal((await events()).length,count+1);
});
test('日期、成员、类型组合筛选，游标继续加载无重复；错误日期被拒绝',async()=>{
  const first=await api('/api/project-events?limit=2&memberId=u-1');assert.equal(first.data.items.length,2);assert.equal(first.data.hasMore,true);
  const next=await api('/api/project-events?limit=2&memberId=u-1&cursor='+encodeURIComponent(first.data.nextCursor));assert.ok(next.data.items.every(e=>!first.data.items.some(x=>x.id===e.id)));
  assert.equal((await api('/api/project-events?from=2026-02-30')).status,400);
});
test('磁盘保存失败后无虚假事件和未保存的项目更新，重试成功一次',async()=>{
  const before=(await events()).length,data={name:'失败修改',topic:'测试',startDate:'2026-01-01',endDate:''},file=path.join(dir,'data/store.json'),backup=path.join(dir,'data/store.backup');
  await rename(file,backup);await mkdir(file);
  try{assert.equal((await api('/api/project','PATCH',data,'leader','disk-retry')).status,500);assert.equal((await events()).length,before);assert.notEqual((await api('/api/state')).data.project.name,'失败修改')}finally{await rm(file,{recursive:true});await rename(backup,file)}
  assert.equal((await api('/api/project','PATCH',data,'leader','disk-retry')).status,200);assert.equal((await events()).length,before+1);
});
test('首次创建项目及接受邀请的重试不会因成员角色变化而重复或被拒绝',async()=>{
  const data={name:'新用户项目',topic:'说明',startDate:'2026-01-01',endDate:''},first=await api('/api/projects','POST',data,'newaccount','first-project'),second=await api('/api/projects','POST',data,'newaccount','first-project');assert.equal(first.status,201);assert.equal(second.status,201);assert.equal(first.data.id,second.data.id);
  const invite=(await api('/api/invites','POST',{})).data,joined=await api('/api/invites/accept','POST',{code:invite.code},'newaccount','first-join'),retried=await api('/api/invites/accept','POST',{code:invite.code},'newaccount','first-join');assert.equal(joined.status,201);assert.equal(retried.status,201);assert.equal(joined.data.projectId,retried.data.projectId);
  const list=await events();assert.equal(list.filter(e=>e.kind==='成员'&&e.actorId==='u-new').length,1);
});
