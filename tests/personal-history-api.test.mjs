import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {scryptSync} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let dir,child,base,cookie;
before(async()=>{
  dir=await mkdtemp(path.join(path.dirname(root),'history-api-'));await mkdir(path.join(dir,'data'));await mkdir(path.join(dir,'public'));
  await copyFile(path.join(root,'server.mjs'),path.join(dir,'server.mjs'));await copyFile(path.join(root,'public/personal-history-model.js'),path.join(dir,'public/personal-history-model.js'));await copyFile(path.join(root,'public/project-events-model.js'),path.join(dir,'public/project-events-model.js'));
  const people=[{id:'u-1',name:'甲',role:'组长'},{id:'u-2',name:'乙',role:'成员'},{id:'u-3',name:'丙',role:'成员'}];
  const accounts=['lin','zhou','chen'].map((account,i)=>({id:people[i].id,name:people[i].name,account,salt:'history-test',password:scryptSync('demo1234','history-test',64).toString('hex')}));
  const project={project:{id:'p-test',name:'当前项目',status:'进行中',startDate:'2026-10-01'},people,meetings:[{id:'m-1',title:'历史会议',date:'2026-11-01',start:'09:00',end:'10:00',hostId:'u-1',host:'甲',organizerId:'u-1',organizer:'甲',attendeeIds:['u-1','u-2'],status:'已结束'}],assignments:[{id:'a-1',content:'整理材料',ownerId:'u-2',owner:'乙',byId:'u-1',by:'甲',meetingId:'m-1',version:1,due:'2026-11-05'}],logs:[{id:'l-1',authorId:'u-2',author:'乙',text:'公开工作日志',date:'2026-11-01'}],events:[],invites:[],files:[]};
  const hidden={project:{id:'p-secret',name:'其他项目'},people:[people[2]],meetings:[],assignments:[],logs:[],events:[{id:'secret-event',title:'其他项目内容'}],files:[],invites:[]};
  await writeFile(path.join(dir,'data/store.json'),JSON.stringify({accounts,workspaces:[project,hidden],sessions:[],notifications:[],todos:[{id:'private',userId:'u-2',title:'乙的私人待办',date:'2026-11-08',start:'',end:'',createdAt:'2026-11-01',status:'未完成'}]}));
  const port=await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port))})});
  child=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{let out='',errors='';const timer=setTimeout(()=>reject(Error('测试服务启动超时')),10000);child.stdout.on('data',x=>{out+=x;if(out.includes(`localhost:${port}`)){clearTimeout(timer);resolve()}});child.stderr.on('data',x=>errors+=x);child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error(errors||'服务退出'))})});base=`http://127.0.0.1:${port}`;
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:'lin',password:'demo1234'})});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
});
after(async()=>{if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited}if(dir)await rm(dir,{recursive:true,force:true})});
const api=async(route,method='GET',data,projectId='p-test')=>{const response=await fetch(base+route,{method,headers:{cookie,'X-Project-Id':projectId,'content-type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,data:await response.json()}};
test('个人回顾仅查询当前项目，其他成员公开记录可看但不含私人待办',async()=>{
  const result=await api('/api/personal-history?personId=u-2');assert.equal(result.status,200);assert.equal(result.data.project.id,'p-test');assert.equal(result.data.member.id,'u-2');
  assert.ok(result.data.entries.some(e=>e.source?.id==='l-1'));assert.ok(!JSON.stringify(result.data).includes('乙的私人待办'));assert.ok(!JSON.stringify(result.data).includes('其他项目内容'));
});
test('拒绝未登录、非项目成员和不存在的查询成员',async()=>{
  assert.equal((await fetch(base+'/api/personal-history?personId=u-2')).status,401);
  assert.equal((await api('/api/personal-history?personId=u-3','GET',null,'p-secret')).status,403);
  assert.equal((await api('/api/personal-history?personId=outside')).status,404);
});
test('本人查询返回个人星级，查看他人回顾不返回任何私人重点',async()=>{
  const mark=await api('/api/focus-marks','POST',{targetType:'meeting',targetId:'m-1',scope:'personal',stars:3,note:'HISTORY-PRIVATE-FOCUS'});assert.equal(mark.status,200);
  const mine=(await api('/api/personal-history?personId=u-1')).data;
  assert.equal(mine.entries.find(e=>e.source?.id==='m-1').personalStars,3);assert.match(JSON.stringify(mine),/HISTORY-PRIVATE-FOCUS/);
  const other=(await api('/api/personal-history?personId=u-2')).data;
  assert.doesNotMatch(JSON.stringify(other),/HISTORY-PRIVATE-FOCUS|乙的私人待办/);assert.ok(other.entries.every(e=>!Object.hasOwn(e,'personalStars')));
});
test('负责人调整持久化原、新负责人快照及准确事件时间',async()=>{
  const result=await api('/api/assignments','PATCH',{id:'a-1',ownerId:'u-3',content:'整理材料',due:'2026-11-05',version:1});assert.equal(result.status,200);
  const state=(await api('/api/state')).data,event=state.events.find(e=>e.assignmentId==='a-1');
  assert.equal(event.action,'assignment-updated');assert.ok(event.at);assert.equal(event.before.ownerId,'u-2');assert.equal(event.after.ownerId,'u-3');assert.ok(event.affectedMemberIds.includes('u-2'));assert.ok(event.affectedMemberIds.includes('u-3'));
  const former=(await api('/api/personal-history?personId=u-2')).data,current=(await api('/api/personal-history?personId=u-3')).data;
  assert.equal(former.summary.currentAssignments,0);assert.equal(former.summary.historicalAssignments,1);assert.equal(current.summary.currentAssignments,1);
  assert.equal(former.entries.filter(e=>e.id===`event:${event.id}`).length,1);assert.ok(former.entries.find(e=>e.id===`event:${event.id}`).relations.includes('原负责人'));
});

test('会议调整记录当时关系和时间，新主持不继承创建事件',async()=>{
  const original={title:'签到机制讨论',topic:'核对签到规则',date:'2026-11-09',start:'09:00',end:'10:00',format:'线下',location:'会议室',hostId:'u-2',attendeeIds:['u-2']};
  const created=await api('/api/meetings','POST',original);assert.equal(created.status,201);
  const changed=await api('/api/meetings','PATCH',{...original,id:created.data.id,version:created.data.scheduleVersion,hostId:'u-3',attendeeIds:['u-3']});assert.equal(changed.status,200);
  const state=(await api('/api/state')).data,creation=state.events.find(e=>e.meetingId===created.data.id&&e.action==='meeting-created'),update=state.events.find(e=>e.meetingId===created.data.id&&e.action==='meeting-updated');
  assert.ok(update?.at,'会议调整事件需要准确时间与类型');assert.equal(update.before.hostId,'u-2');assert.equal(update.after.hostId,'u-3');
  const former=(await api('/api/personal-history?personId=u-2')).data,current=(await api('/api/personal-history?personId=u-3')).data;
  assert.ok(former.entries.find(e=>e.id===`event:${creation.id}`).relations.includes('主持'));
  assert.ok(!current.entries.some(e=>e.id===`event:${creation.id}`));
  assert.ok(current.entries.find(e=>e.id===`event:${update.id}`).relations.includes('新主持'));
});
