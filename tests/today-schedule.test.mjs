import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, copyFile, writeFile, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {scryptSync} from 'node:crypto';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const date='2026-11-08';
let dir, child, base, cookies={};
const people=[{id:'u-1',name:'甲',role:'组长'},{id:'u-2',name:'乙',role:'成员'},{id:'u-3',name:'丙',role:'成员'}];
const meeting=(id,start,extra={})=>({id,title:id,topic:'项目讨论',date,start,end:'18:00',format:'线下',location:'会议室',host:'甲',hostId:'u-1',organizer:'甲',organizerId:'u-1',attendees:['甲'],attendeeIds:['u-1'],status:'待召开',...extra});
const workspace=(id,meetings,focusMarks=[])=>({project:{id,name:id,status:'进行中',startDate:'2026-01-01'},people,meetings,focusMarks,assignments:[],logs:[],events:[],files:[],invites:[]});
before(async()=>{
  dir=await mkdtemp(path.join(path.dirname(root),'agenda-test-'));
  await mkdir(path.join(dir,'data'));
  await copyFile(path.join(root,'server.mjs'),path.join(dir,'server.mjs'));
  await mkdir(path.join(dir,'public'));
  await copyFile(path.join(root,'public/personal-history-model.js'),path.join(dir,'public/personal-history-model.js'));await copyFile(path.join(root,'public/project-events-model.js'),path.join(dir,'public/project-events-model.js'));
  const accounts=['lin','zhou','chen'].map((account,i)=>({id:people[i].id,name:people[i].name,account,salt:'test-salt',password:scryptSync('demo1234','test-salt',64).toString('hex')}));
  const marks=[{targetType:'meeting',targetId:'personal',scope:'team',userId:null,stars:1,note:'全队备注'},{targetType:'meeting',targetId:'personal',scope:'personal',userId:'u-1',stars:3,note:'本人重点'},{targetType:'meeting',targetId:'personal',scope:'personal',userId:'u-2',stars:2,note:'他人的私人备注'}];
  const db={accounts,workspaces:[workspace('p-test',[meeting('personal','09:00'),meeting('cancelled','10:00',{status:'已取消',cancelReason:'天气预警'}),meeting('others','11:00',{attendeeIds:['u-2'],hostId:'u-2',organizerId:'u-2',host:'乙',organizer:'乙'})],marks),workspace('p-other',[meeting('cross-project','14:00')],[{targetType:'meeting',targetId:'cross-project',scope:'personal',userId:'u-1',stars:2,note:'跨项目重点'}])],todos:[{id:'private-1',userId:'u-1',title:'我的私人安排',date,start:'08:00',end:'08:30',status:'未完成',stars:1,description:'',importanceNote:'',createdAt:'2026-11-01T00:00:00Z',projectId:null,meetingId:null,assignmentId:null}],sessions:[],notifications:[]};
  await writeFile(path.join(dir,'data/store.json'),JSON.stringify(db));
  const port=await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port))})});
  child=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(Error('测试服务器启动超时')),10000);child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/localhost:(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`)}});child.stderr.on('data',chunk=>errors+=chunk);child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error(errors||'测试服务器退出'))})});
  for(const account of ['lin','zhou']){const response=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account,password:'demo1234'})});assert.equal(response.status,200);cookies[account]=response.headers.get('set-cookie').split(';')[0]}
});
after(async()=>{if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited}if(dir)await rm(dir,{recursive:true,force:true})});
async function api(route,method='GET',data,account='lin',projectId='p-test'){
  const response=await fetch(base+route,{method,headers:{cookie:cookies[account],'content-type':'application/json','X-Project-Id':projectId},...(data?{body:JSON.stringify(data)}:{})});
  return {status:response.status,data:await response.json()};
}
test('今日会议包含跨项目个人星级、日期和取消原因，不泄露他人备注',async()=>{
  const {status,data}=await api('/api/today-schedule?date='+date);
  assert.equal(status,200);
  assert.deepEqual(data.map(x=>x.id),['personal','cancelled','cross-project']);
  assert.equal(data[0].date,date);
  assert.equal(data[0].personalStars,3);
  assert.equal(data[0].importanceNote,'本人重点');
  assert.equal(data[1].cancelReason,'天气预警');
  assert.equal(data[2].personalStars,2);
  assert.ok(!JSON.stringify(data).includes('他人的私人备注'));
});
test('私人待办只允许本人读取、编辑、删除，项目状态不暴露私人待办',async()=>{
  assert.equal((await api('/api/todos?date='+date)).data.length,1);
  assert.deepEqual((await api('/api/todos?date='+date,'GET',null,'zhou')).data,[]);
  assert.equal((await api('/api/todos','PATCH',{id:'private-1',status:'已完成'},'zhou')).status,404);
  assert.equal((await api('/api/todos','DELETE',{id:'private-1'},'zhou')).status,404);
  assert.ok(!JSON.stringify((await api('/api/state')).data).includes('我的私人安排'));
});

test('项目会议范围包含未邀请本人的会议，支持仅本人筛选且不混入其他项目',async()=>{
  const all=await api('/api/today-schedule?date='+date+'&projectId=p-test&scope=project');
  assert.equal(all.status,200);assert.deepEqual(all.data.map(m=>m.id),['personal','cancelled','others']);
  assert.equal(all.data.find(m=>m.id==='others').isParticipant,false);
  const mine=await api('/api/today-schedule?date='+date+'&projectId=p-test&scope=mine');
  assert.deepEqual(mine.data.map(m=>m.id),['personal','cancelled']);
  assert.equal((await api('/api/today-schedule?date='+date+'&projectId=forbidden&scope=project')).status,403);
});
test('会议改时、改期后今日接口同步更新',async()=>{
  const original=(await api('/api/today-schedule?date='+date)).data.find(x=>x.id==='personal');
  const payload={id:original.id,title:original.title,topic:original.topic,date,start:'07:00',end:'08:00',format:original.format,location:original.location,hostId:'u-1',attendeeIds:['u-1']};
  assert.equal((await api('/api/meetings','PATCH',payload)).status,200);
  assert.equal((await api('/api/today-schedule?date='+date)).data[0].start,'07:00');
  assert.equal((await api('/api/meetings','PATCH',{...payload,date:'2026-11-09'})).status,200);
  assert.ok(!(await api('/api/today-schedule?date='+date)).data.some(x=>x.id==='personal'));
  assert.ok((await api('/api/today-schedule?date=2026-11-09')).data.some(x=>x.id==='personal'));
});
test('待办改时、改日、完成后接口同步并保留完成标识',async()=>{
  assert.equal((await api('/api/todos','PATCH',{id:'private-1',start:'16:00',end:'17:00'})).status,200);
  assert.equal((await api('/api/todos?date='+date)).data[0].start,'16:00');
  assert.equal((await api('/api/todos','PATCH',{id:'private-1',status:'已完成'})).status,200);
  const completed=(await api('/api/todos?date='+date)).data[0];
  assert.equal(completed.status,'已完成');
  assert.ok(completed.completedAt);
  assert.equal((await api('/api/todos','PATCH',{id:'private-1',date:'2026-11-09'})).status,200);
  assert.deepEqual((await api('/api/todos?date='+date)).data,[]);
});
test('未登录不能读取日程与私人待办',async()=>{
  for(const route of ['/api/today-schedule?date='+date,'/api/todos?date='+date])assert.equal((await fetch(base+route)).status,401);
});
