import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {scryptSync} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let dir,child,base,cookies={};
const due=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(Date.now()+86400000)).replace(' ','T');
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
before(async()=>{
 dir=await mkdtemp(path.join(path.dirname(root),'task-flow-test-'));await mkdir(path.join(dir,'data'));await mkdir(path.join(dir,'public'));await mkdir(path.join(dir,'scripts'));
 for(const name of ['server.mjs','public/personal-history-model.js','public/project-events-model.js','scripts/export_document.py','scripts/backup_project.py'])await copyFile(path.join(root,name),path.join(dir,name));
 const people=[{id:'u1',name:'Leader',role:'组长'},{id:'u2',name:'Worker',role:'组员'},{id:'u3',name:'Peer',role:'组员'}];
 const accounts=people.map((p,i)=>({id:p.id,name:p.name,account:`user${i+1}`,salt:'task-test',password:scryptSync('pass1234','task-test',64).toString('hex')}));
 const workspace=(id,leader='u1')=>({project:{id,name:id,topic:'tasks',status:'进行中',startDate:'2026-01-01'},people:people.map(p=>({...p,role:p.id===leader?'组长':'组员'})),meetings:[],assignments:[],logs:[],events:[],files:[],invites:[],focusMarks:[]});
 await writeFile(path.join(dir,'data/store.json'),JSON.stringify({accounts,workspaces:[workspace('p1'),workspace('p2','u3')],todos:[],notifications:[],sessions:[]}));
 const port=await new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});base=`http://127.0.0.1:${port}`;
 child=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{let output='',error='';const timer=setTimeout(()=>reject(Error(error||'startup timeout')),10000);child.stdout.on('data',x=>{output+=x;if(output.includes(`localhost:${port}`)){clearTimeout(timer);resolve()}});child.stderr.on('data',x=>error+=x);child.once('exit',()=>reject(Error(error||'server exited')))});
 child.stderr.on('data',x=>process.stderr.write(x));
 for(let i=1;i<=3;i++){const response=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({account:`user${i}`,password:'pass1234'})});assert.equal(response.status,200);cookies[`u${i}`]=response.headers.get('set-cookie').split(';')[0]}
});
after(async()=>{if(child&&child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended}if(dir)await rm(dir,{recursive:true,force:true})});
async function api(route,method='GET',data,user='u1',project='p1'){const response=await fetch(base+route,{method,headers:{cookie:cookies[user],'content-type':'application/json','X-Project-Id':project},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,data:await response.json()}}
const taskData=(ownerId='u2')=>({title:'Implement feature',description:'Deliver result',acceptance:'Working result',ownerId,priority:'P1',dueAt:due()});
test('task permissions, private subtasks, logs, submissions and archive',async()=>{
 assert.equal((await api('/api/tasks','POST',taskData(),'u2')).status,403);
 assert.equal((await api('/api/tasks','POST',{...taskData(),acceptance:''})).status,400);
 assert.equal((await api('/api/tasks','POST',{...taskData(),title:'任'.repeat(101)})).status,400);
 assert.equal((await api('/api/tasks','POST',{...taskData(),dueAt:'2027-02-31T12:00'})).status,400);
 const defaultPriorityData=taskData();delete defaultPriorityData.priority;const defaultPriority=await api('/api/tasks','POST',defaultPriorityData);assert.equal(defaultPriority.status,201);assert.equal(defaultPriority.data.priority,'P1');assert.equal((await api('/api/tasks/action','POST',{id:defaultPriority.data.id,version:1,action:'cancel',reason:'Validation cleanup'})).status,200);assert.equal((await api('/api/tasks/action','POST',{id:defaultPriority.data.id,version:2,action:'restore',reason:'恢复后继续验证'})).status,200);assert.equal((await api('/api/tasks/action','POST',{id:defaultPriority.data.id,version:3,action:'cancel',reason:'Validation cleanup'})).status,200);
 const created=await api('/api/tasks','POST',{...taskData(),meetingId:'must-not-be-linked',status:'已完成'});assert.equal(created.status,201,JSON.stringify(created));const id=created.data.id;
 assert.equal(created.data.status,'待处理');assert.equal(created.data.priority,'P1');assert.equal(created.data.projectId,'p1');assert.equal(created.data.createdById,'u1');assert.ok(created.data.createdAt);assert.equal(created.data.history[0].action,'create');assert.equal(created.data.history[0].byId,'u1');assert.equal(created.data.history[0].afterValues.ownerId,'u2');assert.equal(created.data.history[0].beforeValues,null);assert.ok(created.data.history[0].reason);
 assert.equal('meetingId' in created.data,false);assert.ok((await api('/api/state','GET',null,'u2')).data.tasks.some(task=>task.id===id));
 assert.equal((await api('/api/tasks/action','POST',{id,version:1,action:'accept'},'u2')).status,403);
 for(const action of ['edit','reassign','cancel','restore','reopen','return'])assert.equal((await api('/api/tasks/action','POST',{id,version:1,action,reason:'Member must not manage tasks',ownerId:'u3'},'u2')).status,403,`group member cannot ${action}`);
 const sub=await api('/api/subtasks','POST',{taskId:id,title:'Private step',description:'Only the owner sees this detail',plannedAt:'2099-12-31',ownerId:'u1',parentSubtaskId:'nested-not-supported'},'u2');assert.equal(sub.status,201);assert.equal(sub.data.ownerId,'u2');assert.equal(sub.data.plannedAt,'2099-12-31');assert.equal('parentSubtaskId' in sub.data,false);assert.equal(sub.data.history[0].action,'create');
 const ownerState=(await api('/api/state','GET',null,'u2')).data;assert.equal(ownerState.personalSubtasks[0].description,'Only the owner sees this detail');assert.ok(ownerState.personalSubtaskHistory.some(x=>x.subtaskId===sub.data.id&&x.action==='create'));
 assert.equal((await api('/api/state','GET',null,'u1')).data.personalSubtasks.length,0);
 assert.equal((await api('/api/state','GET',null,'u1')).data.personalSubtaskHistory.length,0);
 assert.equal((await api('/api/state','GET',null,'u3')).data.personalSubtasks.length,0);
 const deleted=await api('/api/subtasks','POST',{taskId:id,title:'Delete me'},'u2');assert.equal(deleted.status,201);assert.equal((await api('/api/subtasks','PATCH',{id:deleted.data.id,action:'delete'},'u2')).status,200);assert.ok((await api('/api/state','GET',null,'u2')).data.personalSubtaskHistory.some(x=>x.subtaskId===deleted.data.id&&x.action==='delete'));
 const backupResponse=await fetch(base+'/api/backup',{headers:{cookie:cookies.u1,'X-Project-Id':'p1'}});assert.equal(backupResponse.status,200);const backup=Buffer.from(await backupResponse.arrayBuffer()),backupScan=spawnSync('python',['-c','import io,sys,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));data=b"".join(z.read(n) for n in z.namelist());print(b"Private step" in data or b"Only the owner sees this detail" in data)'],{input:backup,encoding:'utf8'});assert.equal(backupScan.status,0,backupScan.stderr);assert.equal(backupScan.stdout.trim(),'False');
 assert.equal((await api('/api/subtasks','PATCH',{id:sub.data.id,action:'status',status:'已完成'},'u3')).status,404);
 assert.equal((await api('/api/subtasks','PATCH',{id:sub.data.id,action:'status',status:'进行中'},'u2')).status,200);assert.equal((await api('/api/state','GET',null,'u2')).data.tasks.find(t=>t.id===id).status,'待处理');
 assert.equal((await api('/api/subtasks','PATCH',{id:sub.data.id,action:'status',status:'已完成'},'u2')).status,200);assert.equal((await api('/api/state','GET',null,'u2')).data.tasks.find(t=>t.id===id).status,'待处理');
 assert.equal((await api('/api/subtasks','PATCH',{id:sub.data.id,action:'status',status:'待处理'},'u2')).status,200);
 const started=await api('/api/tasks/action','POST',{id,version:1,action:'start'},'u2');assert.equal(started.status,200);assert.equal(started.data.status,'进行中');assert.ok(started.data.startedAt);
 assert.equal((await api('/api/tasks/action','POST',{id,version:2,action:'submit',note:'Done',artifacts:['https://example.com/result'],logIds:[]},'u2')).status,400);
 const log=await api('/api/logs','POST',{title:'Progress',logType:'任务日志',text:'Implemented',date:today(),taskIds:[id]},'u2');assert.equal(log.status,201);assert.ok(log.data.publishedAt);assert.equal(log.data.updatedAt,log.data.publishedAt);assert.deepEqual(log.data.taskIds,[id]);
 assert.equal((await api('/api/state','GET',null,'u2')).data.tasks.find(t=>t.id===id).status,'进行中');
 const exportResponse=await fetch(base+`/api/export?kind=log&id=${log.data.id}&format=docx`,{headers:{cookie:cookies.u2,'X-Project-Id':'p1'}});
 assert.equal(exportResponse.status,200);
 const docx=Buffer.from(await exportResponse.arrayBuffer());assert.equal(docx.subarray(0,2).toString(),'PK');
 const opened=spawnSync('python',['-c','import io,sys;from docx import Document;d=Document(io.BytesIO(sys.stdin.buffer.read()));print(" ".join(p.text for p in d.paragraphs))'],{input:docx,encoding:'utf8'});
 assert.equal(opened.status,0,opened.stderr);assert.match(opened.stdout,/Progress/);assert.match(opened.stdout,/Worker/);assert.match(opened.stdout,/p1/);assert.match(opened.stdout,/Implement feature/);assert.ok(opened.stdout.includes(today()));assert.match(opened.stdout,/Implemented/);
 assert.equal((await api('/api/logs','POST',{title:'Wrong',logType:'任务日志',text:'Wrong',date:today(),taskIds:[id]},'u3')).status,400);
 assert.equal((await api('/api/tasks/action','POST',{id,version:2,action:'submit',note:'Done',artifacts:['https://example.com/result'],logIds:[log.data.id]},'u2')).status,200);
 const waitingEdit=await api('/api/subtasks','PATCH',{id:sub.data.id,title:'Private step edited during review',description:'Still private',plannedAt:'2099-12-31',status:'进行中',order:2},'u2');assert.equal(waitingEdit.status,200);assert.equal(waitingEdit.data.order,2);assert.ok((await api('/api/state','GET',null,'u2')).data.personalSubtaskHistory.some(x=>x.subtaskId===sub.data.id&&x.after?.order===2));
 assert.equal((await api('/api/tasks/action','POST',{id,version:2,action:'submit',note:'Done',artifacts:['https://example.com/result'],logIds:[log.data.id]},'u2')).status,409);
 assert.equal((await api('/api/tasks/action','POST',{id,version:3,action:'withdraw'},'u2')).status,409);
 assert.equal((await api('/api/tasks/action','POST',{id,version:3,action:'withdraw',reason:'Wrong owner'},'u3')).status,403);
 const withdrawn=await api('/api/tasks/action','POST',{id,version:3,action:'withdraw',reason:'Need to add the missing result'},'u2');assert.equal(withdrawn.status,200);assert.equal(withdrawn.data.status,'进行中');assert.equal(withdrawn.data.submissions.length,1);assert.equal(withdrawn.data.submissions[0].withdrawalReason,'Need to add the missing result');
 assert.equal((await api('/api/tasks/action','POST',{id,version:3,action:'accept',reason:'Too late'},'u1')).status,409);
 assert.equal((await api('/api/logs','DELETE',{id:log.data.id},'u2')).status,409);
 const edited=await api('/api/logs','PATCH',{id:log.data.id,version:1,title:'Progress',logType:'任务日志',text:'Changed after submission',date:today(),taskIds:[id]},'u2');assert.equal(edited.status,200);assert.equal(edited.data.version,2);assert.equal(edited.data.versions[0].text,'Implemented');assert.ok(edited.data.updatedAt>=log.data.updatedAt);assert.equal(edited.data.publishedAt,log.data.publishedAt);
 assert.equal((await api('/api/state','GET',null,'u1')).data.tasks.find(t=>t.id===id).submissions[0].logVersions[0].text,'Implemented');
 const resubmitted=await api('/api/tasks/action','POST',{id,version:4,action:'submit',note:'Added final result',artifacts:['https://example.com/result-v2'],logIds:[log.data.id]},'u2');assert.equal(resubmitted.status,200);assert.equal(resubmitted.data.submissions.length,2);assert.equal(resubmitted.data.submissions[0].logVersions[0].version,2);assert.equal(resubmitted.data.submissions[1].logVersions[0].version,1);
 assert.equal((await api('/api/tasks/action','POST',{id,version:4,action:'submit',note:'Duplicate',artifacts:['https://example.com/result-v2'],logIds:[log.data.id]},'u2')).status,409);
 assert.equal((await api('/api/tasks/action','POST',{id,version:5,action:'return',reason:'未覆盖异常场景'},'u1')).status,400);
 const returned=await api('/api/tasks/action','POST',{id,version:5,action:'return',reason:'边界条件不足',revisionRequest:'补充异常输入与恢复路径的验证记录'},'u1');assert.equal(returned.status,200);assert.equal(returned.data.status,'进行中');assert.equal(returned.data.acceptanceHistory[0].revisionRequest,'补充异常输入与恢复路径的验证记录');
 const resubmittedAfterReturn=await api('/api/tasks/action','POST',{id,version:6,action:'submit',note:'Added verification',artifacts:['https://example.com/result-v3'],logIds:[log.data.id]},'u2');assert.equal(resubmittedAfterReturn.status,200);assert.equal(resubmittedAfterReturn.data.submissions.length,3);
 const accepted=await api('/api/tasks/action','POST',{id,version:7,action:'accept',reason:'验收通过'},'u1');assert.equal(accepted.status,200);
 assert.equal((await api('/api/tasks/action','POST',{id,version:7,action:'accept',reason:'重复验收'},'u1')).status,409);
 assert.equal((await api('/api/tasks/action','POST',{id,version:8,action:'reopen',reason:'发现新的修改需求'},'u1')).status,200);
 const reopenedSub=await api('/api/subtasks','PATCH',{id:sub.data.id,title:'Private step after reopen',description:'Can edit again',plannedAt:'2099-12-31',status:'待处理',order:0},'u2');assert.equal(reopenedSub.status,200);
 const state=(await api('/api/state','GET',null,'u1')).data;assert.equal(state.tasks.find(t=>t.id===id).status,'进行中');assert.equal(state.tasks.find(t=>t.id===id).submissions.length,3);assert.equal(state.tasks.find(t=>t.id===id).acceptanceHistory.length,2);
 const acceptedAgain=await api('/api/tasks/action','POST',{id,version:9,action:'submit',note:'Final changes complete',artifacts:['https://example.com/final'],logIds:[log.data.id]},'u2');assert.equal(acceptedAgain.status,200);
 const completed=await api('/api/tasks/action','POST',{id,version:10,action:'accept',reason:'重新验收通过'},'u1');assert.equal(completed.status,200);assert.equal(completed.data.acceptanceHistory.length,3);assert.equal(completed.data.submissions.length,4);assert.ok(completed.data.completedAt);
 assert.equal((await api('/api/subtasks','PATCH',{id:sub.data.id,action:'status',status:'已完成'},'u2')).status,409);assert.equal((await api('/api/state','GET',null,'u2')).data.personalSubtasks.find(x=>x.id===sub.data.id).status,'待处理');
 assert.equal((await api('/api/todos','POST',{title:'Independent private todo',date:today()},'u2')).status,201);
 assert.equal((await api('/api/project/archive','POST',{},'u1')).status,200);
 assert.equal((await api('/api/subtasks','PATCH',{id:sub.data.id,action:'status',status:'待处理'},'u2')).status,409);
});
test('cross-project roles are independent',async()=>{
 assert.equal((await api('/api/tasks','POST',taskData('u1'),'u1','p2')).status,403);
 assert.equal((await api('/api/tasks','POST',taskData('u1'),'u3','p2')).status,201);
});
test('leader transfer changes only project roles and preserves historical actors',async()=>{
 const project=await api('/api/projects','POST',{name:'Leader transfer test',topic:'role handoff',startDate:'2026-01-01'},'u3','p2');assert.equal(project.status,201);const projectId=project.data.id;
 const invite=await api('/api/invites','POST',{},'u3',projectId);assert.equal(invite.status,201);
 assert.equal((await api('/api/invites/accept','POST',{code:invite.data.code},'u1','p1')).status,201);
 const task=(await api('/api/tasks','POST',taskData('u3'),'u3',projectId)).data;
 assert.equal(task.createdById,'u3');assert.equal(task.ownerId,'u3');
 assert.equal((await api('/api/project/transfer-leader','POST',{memberId:'u1'},'u1',projectId)).status,403);
 const transfer=await api('/api/project/transfer-leader','POST',{memberId:'u1'},'u3',projectId);assert.equal(transfer.status,200);
 const after=(await api('/api/state','GET',null,'u1',projectId)).data;
 assert.equal(after.people.filter(person=>person.role==='组长').length,1);
 assert.equal(after.people.find(person=>person.id==='u1').role,'组长');assert.equal(after.people.find(person=>person.id==='u3').role,'组员');
 const unchanged=after.tasks.find(item=>item.id===task.id);assert.equal(unchanged.createdById,'u3');assert.equal(unchanged.ownerId,'u3');assert.equal(unchanged.history[0].byId,'u3');
 assert.equal((await api('/api/tasks','POST',taskData(),'u3',projectId)).status,403);
 assert.equal((await api('/api/tasks/action','POST',{id:task.id,version:1,action:'edit',reason:'no',title:'Denied'},'u3',projectId)).status,403);
 assert.equal((await api('/api/tasks','POST',taskData('u1'),'u1',projectId)).status,201);
 assert.equal((await api('/api/state','GET',null,'u3','p1')).data.people.find(person=>person.id==='u3').role,'组员');
});
test('meeting management belongs to the project leader or meeting organizer, not the host',async()=>{
 const meeting=await api('/api/meetings','POST',{title:'Organizer meeting',topic:'Role check',date:today(),start:'09:00',end:'10:00',format:'线下',location:'Room',hostId:'u1',attendeeIds:['u1','u2']},'u2','p2');
 assert.equal(meeting.status,201,JSON.stringify(meeting));
 assert.equal((await api('/api/meetings/status','PATCH',{id:meeting.data.id,status:'进行中'},'u1','p2')).status,403);
 assert.equal((await api('/api/meetings/material-analysis','POST',{meetingId:meeting.data.id},'u1','p2')).status,403);
 assert.equal((await api('/api/meetings/status','PATCH',{id:meeting.data.id,status:'进行中'},'u2','p2')).status,200);
});

test('withdraw and acceptance race is resolved by the first versioned save',async()=>{
 const task=(await api('/api/tasks','POST',taskData('u2'),'u3','p2')).data;
 const started=await api('/api/tasks/action','POST',{id:task.id,version:1,action:'start'},'u2','p2');assert.equal(started.status,200);
 const log=await api('/api/logs','POST',{title:'Race evidence',logType:'任务日志',text:'Evidence',date:today(),taskIds:[task.id]},'u2','p2');assert.equal(log.status,201);
 const submission=await api('/api/tasks/action','POST',{id:task.id,version:2,action:'submit',note:'Ready',artifacts:['https://example.com/race'],logIds:[log.data.id]},'u2','p2');assert.equal(submission.status,200);
 const results=await Promise.all([
  api('/api/tasks/action','POST',{id:task.id,version:3,action:'withdraw',reason:'发现遗漏'},'u2','p2'),
  api('/api/tasks/action','POST',{id:task.id,version:3,action:'accept',reason:'已核对'},'u3','p2')
 ]);
 assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 const final=(await api('/api/state','GET',null,'u3','p2')).data.tasks.find(x=>x.id===task.id);assert.equal(final.submissions.length,1);
 if(final.status==='已完成')assert.equal((final.acceptanceHistory||[]).length,1);else{assert.equal(final.status,'进行中');assert.equal((final.acceptanceHistory||[]).length,0);assert.ok(final.submissions[0].withdrawnAt)}
});

test('leader may own, submit and approve a self-assigned task with truthful actor records',async()=>{
 const task=(await api('/api/tasks','POST',taskData('u3'),'u3','p2')).data;
 const started=await api('/api/tasks/action','POST',{id:task.id,version:1,action:'start'},'u3','p2');assert.equal(started.status,200);
 const log=await api('/api/logs','POST',{title:'Self-assigned work',logType:'任务日志',text:'Completed work',date:today(),taskIds:[task.id]},'u3','p2');assert.equal(log.status,201);
 const submitted=await api('/api/tasks/action','POST',{id:task.id,version:2,action:'submit',note:'Ready for review',artifacts:['https://example.com/self'],logIds:[log.data.id]},'u3','p2');assert.equal(submitted.status,200);assert.equal(submitted.data.submissions[0].byId,'u3');
 const completed=await api('/api/tasks/action','POST',{id:task.id,version:3,action:'accept',reason:'验收通过'},'u3','p2');assert.equal(completed.status,200);assert.equal(completed.data.acceptanceHistory[0].byId,'u3');assert.equal(completed.data.submissions[0].byId,completed.data.acceptanceHistory[0].byId);
});

test('reassignment preserves private data, and todos keep independent status',async()=>{
 const created=await api('/api/tasks','POST',taskData('u2'),'u3','p2'),edited=await api('/api/tasks/action','POST',{id:created.data.id,version:1,action:'edit',title:'Updated task title',description:'Updated scope',acceptance:'Check the delivered result',priority:'P2',dueAt:due()},'u3','p2');
 assert.equal(edited.status,200);assert.equal(edited.data.history[0].beforeValues.title,created.data.title);assert.equal(edited.data.history[0].afterValues.title,'Updated task title');assert.equal(edited.data.history[0].byId,'u3');assert.ok(edited.data.history[0].at);
 const task=edited.data;
 const otherTask=(await api('/api/tasks','POST',taskData('u2'),'u3','p2')).data;assert.equal((await api('/api/tasks/action','POST',{id:otherTask.id,version:1,action:'reassign',ownerId:'u1',reason:'Separate association permission check'},'u3','p2')).status,200);
 const sub=(await api('/api/subtasks','POST',{taskId:task.id,title:'Only worker sees'},'u2','p2')).data;
 const formerOwnerLog=await api('/api/logs','POST',{title:'Original owner evidence',logType:'任务日志',text:'Work before reassignment',date:today(),taskIds:[task.id]},'u2','p2');assert.equal(formerOwnerLog.status,201);
 const todo=(await api('/api/todos','POST',{title:'Work on task',date:today(),projectId:'p2',taskId:task.id},'u2','p2'));assert.equal(todo.status,201);
 const laterTodo=(await api('/api/todos','POST',{title:'Continue task tomorrow',date:'2027-03-15',projectId:'p2',taskId:task.id},'u2','p2'));assert.equal(laterTodo.status,201);
 assert.equal((await api('/api/todos','POST',{title:'Duplicate',date:today(),projectId:'p2',taskId:task.id},'u2','p2')).status,409);
 assert.equal((await api('/api/todos','PATCH',{id:todo.data.id,status:'已完成'},'u2','p2')).status,200);
 assert.equal((await api('/api/state','GET',null,'u2','p2')).data.tasks.find(t=>t.id===task.id).status,'待处理');
 const reassigned=await api('/api/tasks/action','POST',{id:task.id,version:2,action:'reassign',ownerId:'u1',reason:'New owner'},'u3','p2');assert.equal(reassigned.status,200);
 assert.equal(reassigned.data.history[0].beforeValues.owner,'Worker');assert.equal(reassigned.data.history[0].afterValues.owner,'Leader');
 const staleTodos=(await api('/api/todos','GET',null,'u2','p2')).data,stale=staleTodos.find(x=>x.id===todo.data.id),stalePending=staleTodos.find(x=>x.id===laterTodo.data.id);assert.equal(stale.sourceStatus,'待处理');assert.equal(stale.sourceInactive,true);assert.equal(stale.sourceInactiveReason,'已改派');assert.equal(stalePending.sourceTitle,'Updated task title');assert.equal((await api('/api/todos','PATCH',{id:laterTodo.data.id,status:'已完成'},'u2','p2')).status,409);assert.equal((await api('/api/todos','GET',null,'u2','p2')).data.find(x=>x.id===laterTodo.data.id).status,'未完成');
 const formerLogEdited=await api('/api/logs','PATCH',{id:formerOwnerLog.data.id,version:1,title:'Original owner evidence revised',logType:'任务日志',text:'Historical association retained after reassignment',date:today(),taskIds:[task.id]},'u2','p2');assert.equal(formerLogEdited.status,200);assert.deepEqual(formerLogEdited.data.taskIds,[task.id]);assert.equal((await api('/api/logs','PATCH',{id:formerOwnerLog.data.id,version:2,title:'Attempt to add reassigned task',logType:'任务日志',text:'Forbidden new task link',date:today(),taskIds:[task.id,otherTask.id]},'u2','p2')).status,403);
 assert.equal((await api('/api/logs','DELETE',{id:formerOwnerLog.data.id},'u2','p2')).status,200);const republishedFormerLog=await api('/api/logs/publish','POST',{id:formerOwnerLog.data.id},'u2','p2');assert.equal(republishedFormerLog.status,200);assert.deepEqual(republishedFormerLog.data.taskIds,[task.id]);assert.equal(republishedFormerLog.data.publishedAt,formerLogEdited.data.publishedAt);assert.equal(republishedFormerLog.data.version,3);
 assert.equal((await api('/api/subtasks','PATCH',{id:sub.id,action:'status',status:'已完成'},'u2','p2')).status,409);
 assert.equal((await api('/api/state','GET',null,'u1','p2')).data.personalSubtasks.length,0);
 assert.equal((await api('/api/state','GET',null,'u2','p2')).data.personalSubtasks.some(x=>x.id===sub.id),true);
 const assignedBack=await api('/api/tasks/action','POST',{id:task.id,version:3,action:'reassign',ownerId:'u2',reason:'Return to original owner'},'u3','p2');assert.equal(assignedBack.status,200);assert.equal((await api('/api/subtasks','PATCH',{id:sub.id,action:'status',status:'进行中'},'u2','p2')).status,200);
 const reassignedAgain=await api('/api/tasks/action','POST',{id:task.id,version:4,action:'reassign',ownerId:'u1',reason:'Assign to new owner again'},'u3','p2');assert.equal(reassignedAgain.status,200);assert.equal((await api('/api/state','GET',null,'u1','p2')).data.personalSubtasks.length,0);
 assert.equal((await api('/api/members/remove','POST',{memberId:'u1'},'u3','p2')).status,409);
 const started=await api('/api/tasks/action','POST',{id:task.id,version:5,action:'start'},'u1','p2');assert.equal(started.status,200);
 const submitted=await api('/api/tasks/action','POST',{id:task.id,version:6,action:'submit',note:'Using the published task evidence',artifacts:['https://example.com/reassignment'],logIds:[formerOwnerLog.data.id]},'u1','p2');assert.equal(submitted.status,200);assert.equal(submitted.data.submissions[0].logVersions[0].authorId,'u2');
});
test('autosaved log drafts are private, editable, publishable and deletable',async()=>{
 const draftBody={title:'',logType:'任务日志',text:'正在编写的内容',textHtml:'<p>正在编写的内容</p>',date:today(),taskIds:[]};
 const created=await api('/api/logs/drafts','PUT',draftBody,'u2','p2');assert.equal(created.status,200);assert.ok(created.data.id);assert.equal(created.data.draftType,'autosave');
 assert.ok((await api('/api/state','GET',null,'u2','p2')).data.logDrafts.some(d=>d.id===created.data.id));
 assert.equal((await api('/api/state','GET',null,'u3','p2')).data.logDrafts.some(d=>d.id===created.data.id),false);
 assert.equal((await api('/api/logs/drafts','PUT',{...draftBody,id:created.data.id,title:'Other user edit'},'u3','p2')).status,404);
 const updated=await api('/api/logs/drafts','PUT',{...draftBody,id:created.data.id,title:'Finished title',logType:'项目日常日志',text:'完成内容'},'u2','p2');assert.equal(updated.status,200);assert.equal(updated.data.id,created.data.id);assert.equal((await api('/api/state','GET',null,'u2','p2')).data.logDrafts.filter(d=>d.id===created.data.id).length,1);
 const published=await api('/api/logs','POST',{draftId:created.data.id,title:'Finished title',logType:'项目日常日志',text:'完成内容',date:today(),taskIds:[]},'u2','p2');assert.equal(published.status,201);assert.equal(published.data.id,created.data.id);assert.equal((await api('/api/state','GET',null,'u2','p2')).data.logDrafts.some(d=>d.id===created.data.id),false);
 const disposable=await api('/api/logs/drafts','PUT',{...draftBody,title:'Delete me'},'u2','p2');assert.equal(disposable.status,200);
 assert.equal((await api('/api/logs/drafts','DELETE',{id:disposable.data.id},'u3','p2')).status,404);
 assert.equal((await api('/api/logs/drafts','DELETE',{id:disposable.data.id},'u2','p2')).status,200);
 assert.equal((await api('/api/state','GET',null,'u2','p2')).data.logDrafts.some(d=>d.id===disposable.data.id),false);
});
test('unreferenced log withdrawal makes a private draft',async()=>{
 const log=await api('/api/logs','POST',{title:'Notes',logType:'项目日常日志',text:'Temporary',date:today(),taskIds:[]},'u2','p2');assert.equal(log.status,201);
 const withdrawn=await api('/api/logs','DELETE',{id:log.data.id},'u2','p2');assert.equal(withdrawn.status,200);
 const worker=(await api('/api/state','GET',null,'u2','p2')).data,leader=(await api('/api/state','GET',null,'u3','p2')).data;
 assert.equal(worker.logs.some(x=>x.id===log.data.id),false);assert.equal(worker.logDrafts.some(x=>x.id===log.data.id),true);
 assert.equal(leader.logDrafts.some(x=>x.id===log.data.id),false);
 assert.equal((await api('/api/logs/publish','POST',{id:log.data.id},'u3','p2')).status,404);
 assert.equal((await api('/api/logs/publish','POST',{id:log.data.id},'u2','p2')).status,200);
});
test('removed project member loses access to their private subtasks',async()=>{
 const task=(await api('/api/tasks','POST',taskData('u2'),'u3','p2')).data,sub=(await api('/api/subtasks','POST',{taskId:task.id,title:'Private after removal'},'u2','p2')).data;
 assert.equal((await api('/api/members/remove','POST',{memberId:'u2'},'u3','p2')).status,409,'member with an unfinished owned task cannot be removed');
 assert.equal((await api('/api/tasks/action','POST',{id:task.id,version:1,action:'cancel',reason:'Prepare membership access test'},'u3','p2')).status,200);
 const workspace=(await api('/api/state','GET',null,'u3','p2')).data;
 for(const openTask of workspace.tasks.filter(item=>['待处理','进行中','待验收'].includes(item.status)))assert.equal((await api('/api/tasks/action','POST',{id:openTask.id,version:openTask.version,action:'cancel',reason:'Close before member removal'},'u3','p2')).status,200);
 assert.equal((await api('/api/members/remove','POST',{memberId:'u2'},'u3','p2')).status,200);
 assert.ok((await api('/api/state','GET',null,'u2','p2')).status>=400);
 assert.ok((await api('/api/subtasks','PATCH',{id:sub.id,action:'status',status:'已完成'},'u2','p2')).status>=400);
 assert.equal((await api('/api/state','GET',null,'u3','p2')).data.personalSubtasks.length,0);
});
