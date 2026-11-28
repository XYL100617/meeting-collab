import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {scryptSync} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');let dir,child,base,cookie;
const body={title:'同步会议',topic:'合并后校验',date:'2026-11-09',start:'09:00',end:'10:00',format:'线下',location:'会议室',hostId:'u-1',attendeeIds:['u-1']};
before(async()=>{
  dir=await mkdtemp(path.join(path.dirname(root),'main-merge-test-'));await mkdir(path.join(dir,'data'));await mkdir(path.join(dir,'public'));
  for(const name of ['server.mjs','public/personal-history-model.js','public/project-events-model.js'])await copyFile(path.join(root,name),path.join(dir,name));
  const people=[{id:'u-1',name:'甲',role:'组长'}],meeting=id=>({...body,id,host:'甲',organizer:'甲',organizerId:'u-1',attendees:['甲'],status:'待召开',scheduleVersion:1,checkedIds:[],attendance:[]});
  const workspace=(id,meetings)=>({project:{id,name:id,status:'进行中',startDate:'2026-01-01'},people,meetings,assignments:[],logs:[],events:[],files:[],invites:[],focusMarks:[]});
  const w=workspace('p-test',[meeting('m-1'),meeting('m-2')]);w.assignments=[{id:'a-1',content:'第一场会议分工',ownerId:'u-1',owner:'甲',byId:'u-1',by:'甲',meetingId:'m-1',createdAt:'2026-11-01T10:00:00Z'},{id:'a-2',content:'第二场会议分工',ownerId:'u-1',owner:'甲',byId:'u-1',by:'甲',meetingId:'m-2',changeHistory:[{byId:'u-1',by:'甲',at:'2026-11-03T10:00:00Z',before:{ownerId:'u-1',owner:'甲',content:'原分工',due:'2026-11-08'},after:{ownerId:'u-1',owner:'甲',content:'调整后分工',due:'2026-11-09',note:'补充历史说明'}}]},{id:'a-invalid-date',content:'保留已完成状态',ownerId:'u-1',owner:'甲',byId:'u-1',by:'甲',due:'2026-02-31',acceptance:'历史验收条件',status:'已完成'}];
  await writeFile(path.join(dir,'data/store.json'),JSON.stringify({accounts:[{id:'u-1',name:'甲',account:'merge',salt:'merge-qa',password:scryptSync('demo1234','merge-qa',64).toString('hex')}],workspaces:[w,workspace('p-archive',[meeting('m-3')])],todos:[],sessions:[],notifications:[{id:'old-reminder',userId:'u-1',projectId:'p-test',meetingId:'m-1',createdAt:'2026-11-01T00:00:00Z',readAt:null,title:'旧提醒',dedupeKey:'old'}]}));
  const port=await new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});child=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{let out='',errors='';const timer=setTimeout(()=>reject(Error('Server start timeout')),10000);child.stdout.on('data',x=>{out+=x;if(out.includes(`localhost:${port}`)){clearTimeout(timer);resolve()}});child.stderr.on('data',x=>errors+=x);child.once('error',reject);child.once('exit',()=>reject(Error(errors||'Server exited')))});base=`http://127.0.0.1:${port}`;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:'merge',password:'demo1234'})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
});
after(async()=>{if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited}if(dir){assert.ok(path.resolve(dir).startsWith(path.dirname(root)+path.sep));await rm(dir,{recursive:true,force:true})}});
async function api(route,method='GET',data,projectId='p-test'){const response=await fetch(base+route,{method,headers:{cookie,'X-Project-Id':projectId,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,data:await response.json()}}
test('合并保留会议版本冲突校验、准确事件与旧通知失效',async()=>{
  assert.equal((await api('/api/meetings','PATCH',{...body,id:'m-1'})).status,409);
  const results=await Promise.all(['版本甲','版本乙'].map(title=>api('/api/meetings','PATCH',{...body,id:'m-1',version:1,title})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const accepted=results.find(r=>r.status===200).data;assert.equal(accepted.scheduleVersion,2);
  assert.equal((await api('/api/meetings','PATCH',{...body,id:'m-1',version:1,title:'过期版本'})).status,409);
  assert.equal((await api('/api/meetings','PATCH',{...body,id:'m-1',version:2,title:accepted.title})).status,200);
  const state=(await api('/api/state')).data,events=state.events.filter(e=>e.action==='meeting-updated');assert.equal(events.length,1);assert.equal(events[0].projectId,'p-test');assert.ok(events[0].at);assert.ok(events[0].fields.includes('title'));
  const db=JSON.parse(await readFile(path.join(dir,'data/store.json'),'utf8'));assert.equal(db.notifications.find(n=>n.id==='old-reminder').supersededAt,events[0].at);assert.ok(!(await api('/api/notifications')).data.some(n=>n.id==='old-reminder'));
});
test('旧分工不再接受新日志关联，主任务日志保留版本和事件',async()=>{
  const task=(await api('/api/state')).data.tasks.find(t=>t.legacyAssignmentId==='a-1');assert.ok(task);
  assert.equal(task.history[0].action,'legacy-import');assert.equal(task.history[0].byId,'u-1');assert.equal(task.history[0].at,'2026-11-01T10:00:00Z');assert.equal(task.history[0].afterValues.title,'第一场会议分工');
  const changedLegacy=(await api('/api/state')).data.tasks.find(t=>t.legacyAssignmentId==='a-2');assert.equal(changedLegacy.history[1].action,'legacy-change');assert.equal(changedLegacy.history[1].beforeValues.title,'原分工');assert.equal(changedLegacy.history[1].afterValues.title,'调整后分工');assert.equal(changedLegacy.history[1].reason,'补充历史说明');
  const completedLegacy=(await api('/api/state')).data.tasks.find(t=>t.legacyAssignmentId==='a-invalid-date');assert.equal(completedLegacy.status,'已完成');assert.equal(completedLegacy.dueAt,null);assert.equal(completedLegacy.needsCompletion,true);assert.deepEqual(completedLegacy.submissions,[]);assert.equal(completedLegacy.acceptanceHistory,undefined);
  const content={title:'日志说明',logType:'任务日志',text:'日志说明',date:'2026-11-08',taskIds:[task.id]};
  const before=(await api('/api/state')).data.events.length;
  assert.equal((await api('/api/logs','POST',{...content,linkAssignmentId:'a-1'})).status,410);
  assert.equal((await api('/api/state')).data.events.length,before);
  const created=await api('/api/logs','POST',content);assert.equal(created.status,201);assert.deepEqual(created.data.taskIds,[task.id]);
  assert.equal((await api('/api/logs','PATCH',{...content,id:created.data.id,version:1,linkAssignmentId:'a-2'})).status,410);
  const changed=await api('/api/logs','PATCH',{...content,id:created.data.id,version:1,text:'日志更新'});assert.equal(changed.status,200);assert.equal(changed.data.version,2);
  assert.equal((await api('/api/state')).data.events.filter(e=>e.logId===created.data.id).length,2);
});
test('归档只受未结束主任务阻止，保留操作人时间及归档后个人设置例外',async()=>{
  const archived=await api('/api/project/archive','POST',{},'p-archive');assert.equal(archived.status,200);assert.equal(archived.data.archivedById,'u-1');assert.ok(archived.data.archivedAt);
  const state=(await api('/api/state','GET',undefined,'p-archive')).data;assert.equal(state.meetings.find(m=>m.id==='m-3').status,'待召开','未结束会议不阻止项目归档');assert.equal(state.events.some(e=>e.action==='meeting-status'),false);assert.equal(state.events.find(e=>e.action==='project-archived').at,archived.data.archivedAt);
  assert.equal((await api('/api/meetings/status','PATCH',{id:'m-3',status:'已取消',reason:'归档后不可操作'},'p-archive')).status,409);
  assert.equal((await api('/api/files/analyze','POST',{fileId:'none'},'p-archive')).status,409);
  assert.equal((await api('/api/focus-marks','POST',{targetType:'meeting',targetId:'m-3',scope:'personal',stars:2},'p-archive')).status,200);
  assert.equal((await api('/api/focus-marks','POST',{targetType:'meeting',targetId:'m-3',scope:'team',stars:2},'p-archive')).status,409);
  assert.equal((await api('/api/todos','POST',{title:'关联归档项目',date:'2026-11-08',projectId:'p-archive'},'p-archive')).status,409);
});
test('合并保留正文图片实际内容10MB限制，不能用multipart预留量绕过',async()=>{
  const upload=new FormData();upload.append('file',new Blob([Buffer.alloc(10*1024*1024+1)],{type:'image/png'}),'over-limit.png');upload.append('kind','log');
  const response=await fetch(base+'/api/editor-images',{method:'POST',headers:{cookie,'X-Project-Id':'p-test'},body:upload});assert.equal(response.status,413);
  assert.equal((await api('/api/state')).data.files.filter(f=>f.kind==='正文图片').length,0);
});
