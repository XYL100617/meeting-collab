import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {scryptSync} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),work=path.dirname(root);
let dir,child,base,cookies={};
before(async()=>{
  dir=await mkdtemp(path.join(work,'timeline-focus-api-'));await mkdir(path.join(dir,'data'));await mkdir(path.join(dir,'public'));
  await copyFile(path.join(root,'server.mjs'),path.join(dir,'server.mjs'));await copyFile(path.join(root,'public/personal-history-model.js'),path.join(dir,'public/personal-history-model.js'));await copyFile(path.join(root,'public/project-events-model.js'),path.join(dir,'public/project-events-model.js'));
  const people=[{id:'u-1',name:'甲',role:'组长'},{id:'u-2',name:'乙',role:'成员'}],accounts=['leader','member'].map((account,i)=>({id:people[i].id,name:people[i].name,account,salt:'focus-test',password:scryptSync('demo1234','focus-test',64).toString('hex')}));
  const workspace={project:{id:'p-focus',name:'重点测试',status:'进行中'},people,meetings:[{id:'m-image',title:'含正文图片的会议',date:'2026-11-08',start:'09:00',summary:'',summaryHtml:'<p><img src="/api/editor-images?id=image&projectId=p-focus"></p>'}],files:[{id:'f-1',name:'资料.txt'},{id:'image',name:'正文图片.png',kind:'正文图片'}],assignments:[],logs:[],events:[],invites:[],focusMarks:[]};
  await writeFile(path.join(dir,'data/store.json'),JSON.stringify({accounts,workspaces:[workspace],sessions:[],notifications:[],todos:[]}));
  const port=await new Promise((resolve,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})});base=`http://127.0.0.1:${port}`;
  child=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{let output='',errors='';const timer=setTimeout(()=>reject(Error('Server start timeout')),10000);child.stdout.on('data',data=>{output+=data;if(output.includes(`localhost:${port}`)){clearTimeout(timer);resolve()}});child.stderr.on('data',data=>errors+=data);child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error(errors||'Server exited'))})});
  for(const account of ['leader','member']){const response=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account,password:'demo1234'})});assert.equal(response.status,200);cookies[account]=response.headers.get('set-cookie').split(';')[0]}
});
after(async()=>{if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited}if(dir){assert.ok(dir.startsWith(work+path.sep));await rm(dir,{recursive:true,force:true})}});
async function api(route,method='GET',data,account='leader',projectId='p-focus'){
  const response=await fetch(base+route,{method,headers:{cookie:cookies[account],'content-type':'application/json','X-Project-Id':projectId},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,data:await response.json()};
}
test('包含已保存正文图片的会议纪要可以设置三星重点',async()=>{
  const response=await api('/api/focus-marks','POST',{targetType:'minutes',targetId:'m-image',scope:'team',stars:3,note:'图片纪要'});assert.equal(response.status,200);
});
test('正文内嵌图片不作为独立项目资料重点对象',async()=>{
  assert.equal((await api('/api/focus-marks','POST',{targetType:'file',targetId:'image',scope:'personal',stars:3})).status,404);
});
test('全队三星与个人零星均持久化，恢复团队设置只移除个人覆盖',async()=>{
  const target={targetType:'file',targetId:'f-1'};
  assert.equal((await api('/api/focus-marks','POST',{...target,scope:'team',stars:3,note:'全队重点'})).status,200);
  assert.equal((await api('/api/focus-marks','POST',{...target,scope:'personal',stars:0,note:''},'member')).status,200);
  const marks=(await api('/api/focus-marks','GET',null,'member')).data;
  assert.ok(marks.some(m=>m.targetId==='f-1'&&m.scope==='team'&&m.stars===3));assert.ok(marks.some(m=>m.targetId==='f-1'&&m.scope==='personal'&&m.stars===0));
  assert.ok(!(await api('/api/focus-marks')).data.some(m=>m.userId==='u-2'));
  assert.equal((await api('/api/focus-marks','POST',{...target,scope:'personal',stars:0,restoreTeam:'yes'},'member')).status,200);
  assert.ok(!(await api('/api/focus-marks','GET',null,'member')).data.some(m=>m.userId==='u-2'));
});
test('普通成员不能设置全队重点，跨项目对象与不存在对象被拒绝',async()=>{
  const target={targetType:'file',targetId:'f-1',scope:'team',stars:3};
  assert.equal((await api('/api/focus-marks','POST',target,'member')).status,403);
  assert.equal((await api('/api/focus-marks','POST',target,'leader','other-project')).status,403);
  assert.equal((await api('/api/focus-marks','POST',{...target,targetId:'missing'})).status,404);
});
