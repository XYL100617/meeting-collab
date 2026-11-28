import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,readFile,readdir,rename,rm} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {randomBytes,scryptSync} from 'node:crypto';
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
async function uploadEditorImage(user='u2',project='p2'){const form=new FormData();form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Fh8AAAAASUVORK5CYII=','base64')],{type:'image/png'}),'private-draft.png');form.append('kind','log');form.append('recordId','');const response=await fetch(base+'/api/editor-images',{method:'POST',headers:{cookie:cookies[user],'X-Project-Id':project},body:form});return {status:response.status,data:await response.json()}}
test('failed project backup restore leaves existing attachments and database intact',async()=>{
 const task=await api('/api/tasks','POST',taskData('u1'),'u1','p1');assert.equal(task.status,201);
 const form=new FormData();form.append('file',new Blob(['backup version'],{type:'text/plain'}),'restore-check.txt');form.append('taskId',task.data.id);form.append('taskArtifact','yes');
 const upload=await fetch(base+'/api/files',{method:'POST',headers:{cookie:cookies.u1,'X-Project-Id':'p1'},body:form});assert.equal(upload.status,201);const file=await upload.json();
 const backupResponse=await fetch(base+'/api/backup',{headers:{cookie:cookies.u1,'X-Project-Id':'p1'}});assert.equal(backupResponse.status,200);const archive=Buffer.from(await backupResponse.arrayBuffer()).toString('base64');
 const uploadDir=path.join(dir,'data','uploads'),liveBytes=Buffer.from('current live version');await writeFile(path.join(uploadDir,file.storage),liveBytes);const beforeFiles=await readdir(uploadDir),storeFile=path.join(dir,'data','store.json'),storeBackup=path.join(dir,'data','store.json.test-backup');
 await rename(storeFile,storeBackup);await mkdir(storeFile);
 try{
  const response=await fetch(base+'/api/backup/restore',{method:'POST',headers:{cookie:cookies.u1,'X-Project-Id':'p1','content-type':'application/json'},body:JSON.stringify({archive})});assert.equal(response.status,500);
  assert.deepEqual(await readFile(path.join(uploadDir,file.storage)),liveBytes,'a failed restore must not overwrite the live attachment');
  assert.deepEqual((await readdir(uploadDir)).sort(),beforeFiles.sort(),'failed restore must remove staged attachment files');
  const state=await api('/api/state','GET',null,'u1','p1');assert.ok(state.data.tasks.some(item=>item.id===task.data.id),'failed restore must restore in-memory state');
 }finally{await rm(storeFile,{recursive:true,force:true});await rename(storeBackup,storeFile)}
 assert.equal((await api('/api/tasks/action','POST',{id:task.data.id,version:1,action:'cancel',reason:'Backup restore regression cleanup'},'u1','p1')).status,200);
});
test('successful project backup restore uses staged files and removes replaced storage',async()=>{
 const task=await api('/api/tasks','POST',taskData('u1'),'u1','p1');assert.equal(task.status,201);
 const form=new FormData();form.append('file',new Blob(['backup attachment bytes'],{type:'text/plain'}),'restore-success.txt');form.append('taskId',task.data.id);form.append('taskArtifact','yes');
 const upload=await fetch(base+'/api/files',{method:'POST',headers:{cookie:cookies.u1,'X-Project-Id':'p1'},body:form});assert.equal(upload.status,201);const originalFile=await upload.json();
 const backupResponse=await fetch(base+'/api/backup',{headers:{cookie:cookies.u1,'X-Project-Id':'p1'}});assert.equal(backupResponse.status,200);const archive=Buffer.from(await backupResponse.arrayBuffer()).toString('base64');
 const storeFile=path.join(dir,'data','store.json'),storedBefore=JSON.parse(await readFile(storeFile,'utf8')),originalStorage=storedBefore.workspaces.find(item=>item.project.id==='p1').files.find(item=>item.id===originalFile.id).storage;await writeFile(path.join(dir,'data','uploads',originalStorage),Buffer.from('live attachment bytes'));
 assert.equal((await api('/api/project','PATCH',{name:'Changed after backup',topic:'changed',startDate:'2026-01-01',endDate:''},'u1','p1')).status,200);
 const restored=await fetch(base+'/api/backup/restore',{method:'POST',headers:{cookie:cookies.u1,'X-Project-Id':'p1','content-type':'application/json'},body:JSON.stringify({archive})});assert.equal(restored.status,200);
 const state=(await api('/api/state','GET',null,'u1','p1')).data;assert.equal(state.project.name,'p1');const restoredFile=state.files.find(item=>item.id===originalFile.id);assert.ok(restoredFile);const storedAfter=JSON.parse(await readFile(storeFile,'utf8')),restoredStorage=storedAfter.workspaces.find(item=>item.project.id==='p1').files.find(item=>item.id===originalFile.id).storage;assert.notEqual(restoredStorage,originalStorage,'restored file must use a staged storage key');
 assert.deepEqual(await readFile(path.join(dir,'data','uploads',restoredStorage)),Buffer.from('backup attachment bytes'));
 await assert.rejects(readFile(path.join(dir,'data','uploads',originalStorage)),{code:'ENOENT'},'replaced old storage should be deleted only after commit');
 assert.equal((await api('/api/tasks/action','POST',{id:task.data.id,version:1,action:'cancel',reason:'Backup restore regression cleanup'},'u1','p1')).status,200);
});
test('backup restores an attachment at the configured 20 MiB upload limit byte-for-byte',async()=>{
 const task=await api('/api/tasks','POST',taskData('u1'),'u1','p1');assert.equal(task.status,201);const bytes=randomBytes(20*1024*1024);
 const form=new FormData();form.append('file',new Blob([bytes],{type:'text/plain'}),'maximum-size-check.txt');form.append('taskId',task.data.id);form.append('taskArtifact','yes');
 try{
  const upload=await fetch(base+'/api/files',{method:'POST',headers:{cookie:cookies.u1,'X-Project-Id':'p1'},body:form});assert.equal(upload.status,201);
  const backup=await fetch(base+'/api/backup',{headers:{cookie:cookies.u1,'X-Project-Id':'p1'}});assert.equal(backup.status,200);const archive=Buffer.from(await backup.arrayBuffer()).toString('base64');
  const restore=await fetch(base+'/api/backup/restore',{method:'POST',headers:{cookie:cookies.u1,'X-Project-Id':'p1','content-type':'application/json'},body:JSON.stringify({archive})});assert.equal(restore.status,200);
  const state=(await api('/api/state','GET',null,'u1','p1')).data,file=state.files.find(item=>item.name==='maximum-size-check.txt');assert.ok(file);
  const download=await fetch(base+`/api/files/download?id=${encodeURIComponent(file.id)}&projectId=p1`,{headers:{cookie:cookies.u1}});assert.equal(download.status,200);assert.deepEqual(Buffer.from(await download.arrayBuffer()),bytes);
 }finally{
  const state=(await api('/api/state','GET',null,'u1','p1')).data,active=state.tasks.find(item=>item.id===task.data.id&&['待处理','进行中','待验收'].includes(item.status));
  if(active)await api('/api/tasks/action','POST',{id:active.id,version:active.version,action:'cancel',reason:'Backup size regression cleanup'},'u1','p1');
 }
});
const taskData=(ownerId='u2')=>({title:'Implement feature',description:'Deliver result',acceptance:'Working result',ownerId,priority:'P1',dueAt:due()});
test('task permissions, private subtasks, logs, submissions and archive',async()=>{
 assert.equal((await api('/api/tasks','POST',taskData(),'u2')).status,403);
 assert.equal((await api('/api/tasks','POST',{...taskData(),acceptance:''})).status,400);
 assert.equal((await api('/api/tasks','POST',{...taskData(),title:'任'.repeat(101)})).status,400);
 assert.equal((await api('/api/tasks','POST',{...taskData(),dueAt:'2027-02-31T12:00'})).status,400);
 const defaultPriorityData=taskData();delete defaultPriorityData.priority;const defaultPriority=await api('/api/tasks','POST',defaultPriorityData);assert.equal(defaultPriority.status,201);assert.equal(defaultPriority.data.priority,'P1');assert.equal((await api('/api/tasks/action','POST',{id:defaultPriority.data.id,version:1,action:'cancel',reason:'Validation cleanup'})).status,200);assert.equal((await api('/api/tasks/action','POST',{id:defaultPriority.data.id,version:2,action:'restore',reason:'恢复后继续验证'})).status,200);assert.equal((await api('/api/tasks/action','POST',{id:defaultPriority.data.id,version:3,action:'cancel',reason:'Validation cleanup'})).status,200);
 const created=await api('/api/tasks','POST',{...taskData(),meetingId:'must-not-be-linked',status:'已完成'});assert.equal(created.status,201,JSON.stringify(created));const id=created.data.id;assert.equal((await api('/api/project/archive','POST',{},'u1')).status,409,'未结束主任务阻止归档');
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
 const meeting=await api('/api/meetings','POST',{title:'Organizer meet',topic:'Role check',date:today(),start:'09:00',end:'10:00',format:'线下',location:'Room',hostId:'u1',attendeeIds:['u1','u2']},'u2','p2');
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
 const peerBeforePublish=(await api('/api/state','GET',null,'u1','p2')).data;assert.equal(peerBeforePublish.logDrafts.some(d=>d.id===created.data.id),false);assert.equal(peerBeforePublish.logs.some(l=>l.id===created.data.id),false);
 assert.equal((await api('/api/logs/drafts','PUT',{...draftBody,id:created.data.id,title:'Other user edit'},'u3','p2')).status,404);
 const updated=await api('/api/logs/drafts','PUT',{...draftBody,id:created.data.id,title:'Finished title',logType:'项目日常日志',text:'完成内容'},'u2','p2');assert.equal(updated.status,200);assert.equal(updated.data.id,created.data.id);assert.equal((await api('/api/state','GET',null,'u2','p2')).data.logDrafts.filter(d=>d.id===created.data.id).length,1);
 const published=await api('/api/logs','POST',{draftId:created.data.id,title:'Finished title',logType:'项目日常日志',text:'完成内容',date:today(),taskIds:[]},'u2','p2');assert.equal(published.status,201);assert.equal(published.data.id,created.data.id);assert.equal((await api('/api/state','GET',null,'u2','p2')).data.logDrafts.some(d=>d.id===created.data.id),false);assert.ok((await api('/api/state','GET',null,'u1','p2')).data.logs.some(l=>l.id===created.data.id),'已发布日志对项目其他成员可见');const exportResponse=await fetch(`${base}/api/export?kind=log&id=${encodeURIComponent(published.data.id)}&format=docx`,{headers:{cookie:cookies.u1,'X-Project-Id':'p2'}});assert.equal(exportResponse.status,403,'他人可查看已发布日志，但不能导出作者日志');const leaderExport=await fetch(`${base}/api/export?kind=log&id=${encodeURIComponent(published.data.id)}&format=docx`,{headers:{cookie:cookies.u3,'X-Project-Id':'p2'}});assert.equal(leaderExport.status,403,'项目组长也不能导出其他作者的工作日志');
 const disposable=await api('/api/logs/drafts','PUT',{...draftBody,title:'Delete me'},'u2','p2');assert.equal(disposable.status,200);
 assert.equal((await api('/api/logs/drafts','DELETE',{id:disposable.data.id},'u3','p2')).status,404);
 assert.equal((await api('/api/logs/drafts','DELETE',{id:disposable.data.id},'u2','p2')).status,200);
 assert.equal((await api('/api/state','GET',null,'u2','p2')).data.logDrafts.some(d=>d.id===disposable.data.id),false);
});
test('uncommitted rich-text draft images stay private and cannot use generic file downloads',async()=>{
 const uploaded=await uploadEditorImage();assert.equal(uploaded.status,201);const imageId=uploaded.data.id;
 const peerBeforeSave=(await api('/api/state','GET',null,'u1','p2')).data;assert.equal(peerBeforeSave.files.some(f=>f.id===imageId),false,'未保存的正文图片元数据不能进入其他成员状态');
 const genericPeer=await fetch(base+`/api/files/download?id=${imageId}&projectId=p2`,{headers:{cookie:cookies.u1}});assert.equal(genericPeer.status,404,'正文图片不能绕过专用权限检查走通用下载');
 const privateImage=await fetch(base+`/api/editor-images?id=${imageId}&projectId=p2`,{headers:{cookie:cookies.u1}});assert.equal(privateImage.status,403,'未保存图片内容仅上传者可读');
 const ownImage=await fetch(base+`/api/editor-images?id=${imageId}&projectId=p2`,{headers:{cookie:cookies.u2}});assert.equal(ownImage.status,200,'编辑者可以继续查看自己的待保存图片');
 const backupResponse=await fetch(base+'/api/backup',{headers:{cookie:cookies.u3,'X-Project-Id':'p2'}});assert.equal(backupResponse.status,200,'组长仍可备份项目');const backupScan=spawnSync('python',['-c','import io,json,sys,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));m=json.loads(z.read("manifest.json"));print(any(x.get("id")==sys.argv[1] for x in m["files"]) or any(n.endswith(sys.argv[1]+".png") for n in z.namelist()))',imageId],{input:Buffer.from(await backupResponse.arrayBuffer()),encoding:'utf8'});assert.equal(backupScan.status,0,backupScan.stderr);assert.equal(backupScan.stdout.trim(),'False','项目备份不得包含未保存草稿图片的清单或文件内容');
 const draft=await api('/api/logs/drafts','PUT',{title:'Private image draft',logType:'项目日常日志',text:'Draft with private image',textHtml:`<p>Draft with private image<img src="/api/editor-images?id=${imageId}&projectId=p2"></p>`,date:today(),taskIds:[]},'u2','p2');assert.equal(draft.status,200);
 const peerAfterSave=(await api('/api/state','GET',null,'u1','p2')).data;assert.equal(peerAfterSave.files.some(f=>f.id===imageId),false,'私有草稿正文图片元数据不能泄露');
 const privateDraftImage=await fetch(base+`/api/editor-images?id=${imageId}&projectId=p2`,{headers:{cookie:cookies.u1}});assert.equal(privateDraftImage.status,404,'其他成员不能读取私有草稿正文图片');
 const genericAfterSave=await fetch(base+`/api/files/download?id=${imageId}&projectId=p2`,{headers:{cookie:cookies.u1}});assert.equal(genericAfterSave.status,404);
 assert.equal((await api('/api/logs/drafts','DELETE',{id:draft.data.id},'u2','p2')).status,200);
});
test('withdrawn log team marks and events stop appearing in shared views and backups',async()=>{
 const log=await api('/api/logs','POST',{title:'Private after withdrawal',logType:'项目日常日志',text:'Withdrawn content',date:today(),taskIds:[]},'u2','p2');assert.equal(log.status,201);
 const mark=await api('/api/focus-marks','POST',{scope:'team',targetType:'log',targetId:log.data.id,stars:3,note:'PRIVATE_TEAM_MARK'},'u3','p2');assert.equal(mark.status,200);
 const before=(await api('/api/state','GET',null,'u3','p2')).data;assert.ok(before.focusMarks.some(x=>x.targetId===log.data.id));
 assert.equal((await api('/api/logs','DELETE',{id:log.data.id},'u2','p2')).status,200);
 const peer=(await api('/api/state','GET',null,'u3','p2')).data;assert.equal(peer.logs.some(x=>x.id===log.data.id),false);assert.equal(peer.focusMarks.some(x=>x.targetId===log.data.id),false);assert.ok(!JSON.stringify(peer.events).includes('PRIVATE_TEAM_MARK'));
 assert.equal((await api('/api/focus-marks','GET',null,'u3','p2')).data.some(x=>x.targetId===log.data.id),false);
 const timeline=(await api('/api/project-events?limit=100','GET',null,'u3','p2')).data;assert.ok(!timeline.items.some(x=>x.source?.type==='log'&&x.source.id===log.data.id));
 const backupResponse=await fetch(base+'/api/backup',{headers:{cookie:cookies.u3,'X-Project-Id':'p2'}});assert.equal(backupResponse.status,200);const backupScan=spawnSync('python',['-c','import io,json,sys,zipfile;z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()));w=json.loads(z.read("manifest.json"))["workspace"];print(any(x.get("targetId")==sys.argv[1] for x in w.get("focusMarks",[])) or "PRIVATE_TEAM_MARK" in json.dumps(w.get("events",[])) or any(x.get("id")==sys.argv[1] for x in w.get("logs",[])))',log.data.id],{input:Buffer.from(await backupResponse.arrayBuffer()),encoding:'utf8'});assert.equal(backupScan.status,0,backupScan.stderr);assert.equal(backupScan.stdout.trim(),'False','共享备份不得暴露撤回草稿的团队关注标记或日志内容');
});
test('autosaved task-log drafts cannot bypass current task responsibility',async()=>{
 const task=(await api('/api/tasks','POST',taskData('u2'),'u3','p2')).data,draft=await api('/api/logs/drafts','PUT',{title:'Private pending task log',logType:'任务日志',text:'Draft body',date:today(),taskIds:[task.id]},'u2','p2');assert.equal(draft.status,200);
 const reassigned=await api('/api/tasks/action','POST',{id:task.id,version:1,action:'reassign',ownerId:'u1',reason:'Change the responsible member'},'u3','p2');assert.equal(reassigned.status,200);
 assert.equal((await api('/api/logs/publish','POST',{id:draft.data.id},'u2','p2')).status,409,'自动保存草稿不能走撤回日志的快捷重发接口');
 assert.equal((await api('/api/logs','POST',{draftId:draft.data.id,title:'Private pending task log',logType:'任务日志',text:'Draft body',date:today(),taskIds:[task.id]},'u2','p2')).status,400,'原负责人不能在改派后发布新的任务日志关联');
 const ownerState=(await api('/api/state','GET',null,'u2','p2')).data;assert.ok(ownerState.logDrafts.some(x=>x.id===draft.data.id));assert.ok(!ownerState.logs.some(x=>x.id===draft.data.id));
});test('personal log folders and links are private to their owner',async()=>{
 const task=await api('/api/tasks','POST',taskData('u2'),'u3','p2');assert.equal(task.status,201);
 const folder=await api('/api/log-folders','POST',{action:'create',taskId:task.data.id,name:'验收记录'},'u2','p2');assert.equal(folder.status,200);assert.equal(folder.data.folders.length,1);
 const log=await api('/api/logs','POST',{title:'分类日志',logType:'任务日志',text:'已发布内容',date:today(),taskIds:[task.data.id]},'u2','p2');assert.equal(log.status,201);
 const attached=await api('/api/log-folders','POST',{action:'attach',folderId:folder.data.folders[0].id,logId:log.data.id},'u2','p2');assert.equal(attached.status,200);assert.equal(attached.data.links.length,1);
 const ownerState=(await api('/api/state','GET',null,'u2','p2')).data,peerState=(await api('/api/state','GET',null,'u1','p2')).data;
 assert.ok(ownerState.personalLogFolders.some(item=>item.id===folder.data.folders[0].id));assert.ok(ownerState.personalLogFolderLinks.some(item=>item.logId===log.data.id));
 assert.equal(peerState.personalLogFolders.some(item=>item.id===folder.data.folders[0].id),false);assert.equal(peerState.personalLogFolderLinks.some(item=>item.logId===log.data.id),false);
 assert.equal((await api('/api/log-folders','POST',{action:'rename',folderId:folder.data.folders[0].id,name:'越权'},'u1','p2')).status,404);
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
