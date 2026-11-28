import assert from 'node:assert/strict';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {scryptSync} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temp=await mkdtemp(path.join(os.tmpdir(),'meeting-acceptance-browser-'));
const stage=path.join(temp,'app'),downloads=path.join(temp,'downloads'),profile=path.join(temp,'chrome-profile');
let server,chrome,cdp,seq=0,appUrl='';
const pending=new Map();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
async function waitFor(fn,label,timeout=12000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await sleep(100)}throw Error(`等待超时：${label}`)}
async function cdpSend(method,params={}){const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP 超时：${method}`))},15000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject});cdp.send(JSON.stringify({id,method,params}))})}
async function reloadPage(){await cdpSend('Page.navigate',{url:appUrl});await waitFor(async()=>{try{return await evaluate('document.readyState==="complete"&&!!document.querySelector("#page-content")')}catch{return false}},'浏览器页面刷新完成');}
async function evaluate(expression){const result=await cdpSend('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value}
async function click(selector){const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center',inline:'center'});const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);if(!point)throw Error(`不可点击或不存在：${selector}`);await cdpSend('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await cdpSend('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await cdpSend('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1})}
async function setValue(selector,value){const ok=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);if(!ok)throw Error(`输入框不存在：${selector}`)}
async function setHtml(selector,html){const ok=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.innerHTML=${JSON.stringify(html)};e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));return true})()`);if(!ok)throw Error(`富文本编辑器不存在：${selector}`)}
async function chooseFile(selector,filePath){await cdpSend('DOM.enable');const document=await cdpSend('DOM.getDocument',{depth:-1});const {nodeId}=await cdpSend('DOM.querySelector',{nodeId:document.root.nodeId,selector});if(!nodeId)throw Error(`文件输入框不存在：${selector}`);await cdpSend('DOM.setFileInputFiles',{nodeId,files:[filePath]})}
async function text(){return evaluate('document.body.innerText')}
async function expectVisible(selector,label=selector){await waitFor(()=>evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),label)}
async function login(account){await expectVisible('#auth-form','登录表单');await setValue('#auth-form [name=account]',account);await setValue('#auth-form [name=password]','test1234');await click('#auth-form [type=submit]');await waitFor(()=>evaluate('!document.querySelector("#auth-form")&&document.querySelector("#connection-status")?.dataset.status==="saved"&&!!document.querySelector("#page-content h1")'),'登录并加载项目完成')}
async function navigate(view){await evaluate(`(()=>{let el=document.querySelector('[data-view="${view}"]'),panel=el?.closest('[data-nav-panel]');while(panel){const key=panel.dataset.navPanel,toggle=document.querySelector('.nav-caret-button[data-nav-toggle="'+key+'"]');if(toggle&&toggle.getAttribute('aria-expanded')!=='true')toggle.click();panel=panel.parentElement?panel.parentElement.closest('[data-nav-panel]'):null}return true})()`);await click(`[data-view="${view}"]`);const selector=`.nav-item[data-view="${view}"]`;await waitFor(()=>evaluate(`document.querySelector(${JSON.stringify(selector)})?.classList.contains("active")`),`导航到 ${view}`).catch(async error=>{throw Error(`${error.message}; 页面状态=${await evaluate(`JSON.stringify({url:location.href,nav:document.querySelector(${JSON.stringify(selector)})?.className,heading:document.querySelector("#page-content h1")?.textContent,errors:[...document.querySelectorAll(".toast,.auth-error")].map(x=>x.textContent)})`)}`)})}
async function createTask(title,ownerId='u2',projectId='p1',files=[]){
  await click('[data-action="new-task"]');await expectVisible('#task-create-form');
  await setValue('#task-create-form [name=title]',title);await setHtml('#task-create-form [data-rich-editor="task"]','<p>交付可检查成果：'+title+'</p>');
  await setValue('#task-create-form [name=ownerId]',ownerId);await setValue('#task-create-form [name=dueAt]',new Date(Date.now()+3*86400000).toISOString().slice(0,16));
  await setValue('#task-create-form [name=acceptance]','页面、接口与记录均可核对');for(const file of files)await chooseFile('#task-create-form [name=taskAttachments]',file);await click('[data-action="submit-modal"]');
  await waitFor(()=>evaluate('!document.querySelector("#task-create-form")||!!document.querySelector(".toast.error")'),'任务保存');if(await evaluate('!!document.querySelector("#task-create-form")'))throw Error(`创建任务失败：${await evaluate('[...document.querySelectorAll(".toast.error")].map(x=>x.textContent).join("；")')}`);
  const state=await pageApi('/api/state','GET',null,projectId);const task=state.tasks.find(x=>x.title===title);assert.ok(task,`负责人项目数据中应有任务 ${title}`);return task;
}
async function pageApi(route,method='GET',body=null,projectId='p1'){
  const result=await evaluate(`fetch(${JSON.stringify(route)},{method:${JSON.stringify(method)},headers:{'content-type':'application/json','X-Project-Id':${JSON.stringify(projectId)}},credentials:'same-origin',...((${body===null})?{}:{body:JSON.stringify(${JSON.stringify(body)} )})}).then(async r=>({status:r.status,data:await r.json()}))`);
  assert.ok(result,`API 未返回：${route}`);return result.data;
}
async function loginAs(account){if(await evaluate('!!document.querySelector("#auth-form")'))return login(account);await click('#top-avatar');await waitFor(()=>evaluate('!document.querySelector("#user-menu").hidden'),'账户菜单');await click('#user-menu [data-action="logout"]');await expectVisible('#auth-form','退出后登录表单');await login(account)}
async function selectProject(id){await click('#workspace-toggle');await waitFor(()=>evaluate('!document.querySelector("#project-menu").hidden'),'项目菜单');await click(`#project-menu [data-project="${id}"]`);await waitFor(()=>evaluate(`document.querySelector("#active-project-name")?.textContent==${JSON.stringify(id)}`),`打开项目 ${id}`)}
async function submitTask(task){await waitFor(()=>evaluate(`!!document.querySelector('[data-task="${task.id}"] [data-task-action="start"]')`),'负责人开始入口');await click(`[data-task="${task.id}"] [data-task-action="start"]`);await waitFor(()=>evaluate(`document.querySelector('[data-task="${task.id}"] .work-meta b')?.textContent==="进行中"`),'任务开始');}
async function createLog(title,taskIds,html='<p>完成阶段工作，保留验收证据。</p>'){
  await click(`[data-task-write-log="${taskIds[0]}"]`);await expectVisible('#log-form');
  await setValue('#log-form [name=title]',title);await setValue('#log-form [name=date]',new Date().toISOString().slice(0,10));
  await setValue('#log-form [name=logType]','任务日志');
  await evaluate(`(()=>{const s=document.querySelectorAll('#log-form input[name=taskIds]');for(const o of s)o.checked=${JSON.stringify(taskIds)}.includes(o.value);s.forEach(o=>o.dispatchEvent(new Event('change',{bubbles:true})))})()`);
  await setHtml('#log-form [data-rich-editor="log"]',html);await click('[data-action="submit-modal"]');
  await waitFor(()=>evaluate('!document.querySelector("#log-form")'),'日志发布');
  const state=await pageApi('/api/state','GET',null,'p1');return state.logs.find(x=>x.title===title);
}
async function submitForAcceptance(task,log){
  await loginAs('worker2');await navigate('work');
  await waitFor(()=>evaluate(`!!document.querySelector('[data-task="${task.id}"] [data-task-action="submit"]')`),'提交入口').catch(async error=>{throw Error(`${error.message}; 任务卡=${await evaluate(`document.querySelector('[data-task="${task.id}"]')?.innerText`)}; 按钮=${await evaluate(`JSON.stringify([...document.querySelectorAll('[data-task="${task.id}"] button')].map(x=>x.outerHTML))`)}`)});await click(`[data-task="${task.id}"] [data-task-action="submit"]`);await expectVisible('#task-action-form');
  await evaluate(`(()=>{const s=document.querySelector('#task-action-form [name=logIds]');for(const o of s.options)o.selected=o.value===${JSON.stringify(log.id)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await setValue('#task-action-form [name=artifacts]','https://example.test/evidence');await setValue('#task-action-form [name=note]','本次交付说明完整');await click('[data-action="submit-modal"]');
  await waitFor(()=>evaluate('!document.querySelector("#task-action-form")'),'提交验收');
}
async function acceptTask(task){await loginAs('leader1');await navigate('work');assert.ok(!(await text()).includes('乙的私有未完成步骤'),'组长界面不得出现私有子任务');await waitFor(()=>evaluate(`!!document.querySelector('[data-task="${task.id}"] [data-task-action="accept"]')`),'组长验收入口');await click(`[data-task="${task.id}"] [data-task-action="accept"]`);await expectVisible('#task-action-form');await setValue('#task-action-form [name=reason]','交付符合验收标准');await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('!document.querySelector("#task-action-form")'),'验收保存');const s=await pageApi('/api/state');assert.equal(s.tasks.find(x=>x.id===task.id).status,'已完成')}

try{
  await mkdir(downloads,{recursive:true});await mkdir(path.join(stage,'data'),{recursive:true});
  await cp(path.join(root,'server.mjs'),path.join(stage,'server.mjs'));await cp(path.join(root,'public'),path.join(stage,'public'),{recursive:true});await cp(path.join(root,'scripts'),path.join(stage,'scripts'),{recursive:true});await mkdir(path.join(stage,'data','uploads'),{recursive:true});
  const people=[{id:'u1',name:'组长甲',role:'组长'},{id:'u2',name:'组员乙',role:'组员'},{id:'u3',name:'组员丙',role:'组员'}];
  const accounts=people.map((p,i)=>({id:p.id,name:p.name,account:['leader1','worker2','peer3'][i],salt:`acceptance-${i}`,password:scryptSync('test1234',`acceptance-${i}`,64).toString('hex')}));
  const workspace=(id,leader)=>({project:{id,name:id,topic:'浏览器验收隔离项目',status:'进行中',startDate:'2026-01-01',endDate:'2027-12-31',createdAt:id==='p1'?'2026-01-01T00:00:00.000Z':'2026-01-02T00:00:00.000Z'},people:people.map(p=>({...p,role:p.id===leader?'组长':'组员'})),meetings:[],assignments:[],tasks:[],taskSequences:{},personalSubtasks:[],personalSubtaskHistory:[],logs:[],events:[],files:[],invites:[],focusMarks:[]});
  const overdue={id:'seed-overdue',number:'20250101-001',projectId:'p1',title:'验收逾期筛选样本',description:'历史样本',descriptionHtml:'<p>历史样本</p>',acceptance:'样本标准',ownerId:'u2',owner:'组员乙',priority:'P0',due:'2025-01-01',dueAt:'2025-01-01T12:00:00.000Z',status:'待处理',createdById:'u1',createdBy:'组长甲',createdAt:'2025-01-01T00:00:00.000Z',version:1,submissions:[],history:[]};
  const p1=workspace('p1','u1'),p2=workspace('p2','u3');p1.tasks.push(overdue);
  if(process.argv.includes('--work-layout-only')){
    for(const [index,status] of ['待处理','进行中','待验收','已完成','已取消'].entries())p1.tasks.push({...overdue,id:`layout-${index}`,legacyAssignmentId:`legacy-${index}`,number:`历史-${index}`,title:`布局验收${status}`,status});
    p1.tasks.push({...overdue,id:'layout-mine',legacyAssignmentId:'legacy-mine',number:'历史-本人',title:'本人负责的历史任务',ownerId:'u1',owner:'组长甲',status:'已取消'});
  }
  await writeFile(path.join(stage,'data','store.json'),JSON.stringify({accounts,workspaces:[p1,p2],todos:[],notifications:[],sessions:[]}));
  const port=await freePort();server=spawn(process.execPath,['server.mjs'],{cwd:stage,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,TEMP:temp,TMP:temp,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});
  let serverOutput='';server.stdout.on('data',chunk=>serverOutput+=chunk);server.stderr.on('data',chunk=>serverOutput+=chunk);
  const base=`http://127.0.0.1:${port}`;appUrl=base;await waitFor(async()=>{try{return (await fetch(base+'/')).ok}catch{return false}},'隔离应用启动');
  const chromePath=process.env.CHROME_BIN||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  chrome=spawn(chromePath,['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--no-sandbox','--remote-allow-origins=*',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{stdio:'ignore'});
  const activeFile=path.join(profile,'DevToolsActivePort');await waitFor(async()=>{try{return await readFile(activeFile,'utf8')}catch{return false}},'Chrome DevTools 端口');
  const [debugPort]= (await readFile(activeFile,'utf8')).trim().split(/\r?\n/);const debugBase=`http://127.0.0.1:${debugPort}`;
  const targets=await waitFor(async()=>{try{return await (await fetch(debugBase+'/json/list')).json()}catch{return false}},'Chrome 页面目标');
  const target=targets.find(x=>x.type==='page');assert.ok(target,'Chrome 没有页面目标');
  cdp=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{cdp.onopen=resolve;cdp.onerror=reject;cdp.onmessage=event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}else if(m.method==='Page.javascriptDialogOpening')void cdpSend('Page.handleJavaScriptDialog',{accept:true});else if(m.method==='Runtime.exceptionThrown')process.stderr.write(`浏览器异常：${m.params.exceptionDetails.text}\n`)}});
  await cdpSend('Page.enable');await cdpSend('Runtime.enable');await cdpSend('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await cdpSend('Page.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});await cdpSend('Page.navigate',{url:base});

  await login('leader1');
  if(process.argv.includes('--navigation-only')){
    await navigate('meetings');
    assert.equal(await evaluate('document.querySelector("#page-content h1").textContent'),'会议安排');
    assert.equal(await evaluate('document.querySelectorAll("#sidebar [data-view=meetings]").length'),1);
    assert.equal(await evaluate('!!document.querySelector("#sidebar [data-view=meetings]").closest(".sub-nav")'),false,'会议安排为一级导航');
    assert.equal(await evaluate('!!document.querySelector("#sidebar [data-nav-toggle=meeting-detail]")'),false,'移除外层会议详情');
    assert.equal(await evaluate('document.querySelectorAll("#nav-panel-meeting-schedule [data-meeting-section]").length'),4,'会议安排保留四个子项');
    assert.equal(await evaluate('document.querySelector("#nav-panel-meeting-schedule").hidden'),true,'列表页隐藏单场会议子项');
    const meeting=await pageApi('/api/meetings','POST',{title:'导航验收会议',topic:'核对会议各页面入口',date:'2026-12-15',start:'14:00',end:'15:00',format:'线下',location:'会议室',hostId:'u1',attendeeIds:['u1','u2']});
    assert.ok(meeting.id,JSON.stringify(meeting));
    await reloadPage();await navigate('meetings');
    assert.equal(await evaluate('document.querySelector("#meeting-count").textContent'),'1');
    await click(`[data-open-meeting="${meeting.id}"]`);
    await waitFor(()=>evaluate('!document.querySelector("#nav-panel-meeting-schedule").hidden'),'打开会议后展示子项');
    assert.equal(await evaluate('!!document.querySelector(".meeting-page-tabs")'),false,'子项保留在左侧');
    for(const section of ['audio','files','history','overview']){
      await click(`#sidebar [data-meeting-section="${section}"]`);await expectVisible(`[data-meeting-page="${section}"]`);
      assert.equal(await evaluate(`document.querySelector('#sidebar [data-meeting-section="${section}"]').classList.contains('active')`),true);
    }
    await click('[data-nav-toggle="meeting-schedule"]');
    assert.equal(await evaluate('document.querySelector("#nav-panel-meeting-schedule").hidden'),true,'会议子项可收起');
    await click('[data-nav-toggle="meeting-schedule"]');
    assert.equal(await evaluate('document.querySelector("#nav-panel-meeting-schedule").hidden'),false,'会议子项可展开');
    await click('#sidebar [data-view=meetings]');await expectVisible('.meeting-table-panel');
    assert.equal(await evaluate('document.querySelector("#nav-panel-meeting-schedule").hidden'),true,'返回列表隐藏单场会议子项');
    assert.equal(await evaluate('document.querySelector("#sidebar [data-view=meetings]").classList.contains("active")'),true);
    console.log('PASS: top-level meeting schedule, four sidebar subsections, collapse/expand, count, active state and return to list');
  }else if(process.argv.includes('--work-layout-only')){
    await navigate('work');
    assert.equal(await evaluate('!!document.querySelector(".work-with-agenda .heading-actions [data-action=new-log]")'),false,'工作分工顶部移除写工作日志');
    assert.equal(await evaluate('document.querySelectorAll(".task-scope-switch [data-action=task-scope]").length'),2,'任务范围使用两个固定选项');
    assert.equal(await evaluate('document.querySelector("[data-task-scope=all]").getAttribute("aria-pressed")'),'true');
    await setValue('#task-status-filter','已取消');
    await click('[data-task-scope="mine"]');
    assert.equal(await evaluate('document.querySelector("[data-task-scope=mine]").getAttribute("aria-pressed")'),'true');
    assert.equal(await evaluate('document.querySelector("[data-task-scope=mine]").textContent'),'我负责的任务');
    assert.equal(await evaluate('document.querySelector("#task-owner-filter").disabled'),true,'本人范围不能混选其他负责人');
    assert.equal(await evaluate('document.querySelector("#task-owner-filter").value'),'u1');
    await click('[data-action="show-task-history"]');await expectVisible('#modal-layer .work-card');
    assert.deepEqual(await evaluate('[...document.querySelectorAll("#modal-layer [data-task]")].map(e=>e.dataset.task)'),['layout-mine'],'本人范围只显示本人任务');
    await click('.modal-close');await waitFor(()=>evaluate('!document.querySelector("#modal-layer .modal")'),'关闭本人任务');
    await click('[data-task-scope="all"]');
    assert.equal(await evaluate('document.querySelector("[data-task-scope=all]").textContent'),'全部成员任务');
    assert.equal(await evaluate('document.querySelector("#task-owner-filter").disabled'),false);
    assert.equal(await evaluate('document.querySelector("#task-status-filter").value'),'已取消','切换范围保留状态筛选');
    await click('[data-action="show-task-history"]');await expectVisible('#modal-layer .work-card');
    assert.deepEqual((await evaluate('[...document.querySelectorAll("#modal-layer [data-task]")].map(e=>e.dataset.task)')).sort(),['layout-4','layout-mine'],'全部成员范围包含双方任务');
    await click('.modal-close');await waitFor(()=>evaluate('!document.querySelector("#modal-layer .modal")'),'关闭全部成员任务');
    for(const status of ['全部状态','待处理','进行中','待验收','已完成','已取消']){
      await setValue('#task-status-filter',status);
      const label=status==='全部状态'?'查看全部任务':`查看${status}任务`;
      assert.ok((await evaluate('document.querySelector("[data-action=show-task-history]").textContent')).startsWith(label));
      await click('[data-action="show-task-history"]');await expectVisible('#modal-layer .work-card');
      assert.equal(await evaluate('document.querySelector(".modal-head h2").textContent'),status==='全部状态'?'历史任务':`${status}任务`);
      await click('.modal-close');await waitFor(()=>evaluate('!document.querySelector("#modal-layer .modal")'),'关闭任务列表');
    }
    for(const width of [1823,1100,390]){
      await cdpSend('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
      const layout=await evaluate(`(()=>{const box=document.querySelector('.work-agenda-sidebar'),date=box.querySelector('.compact-agenda-date'),add=box.querySelector('[data-action="new-todo"]'),rect=box.getBoundingClientRect(),dr=date.getBoundingClientRect(),ar=add.getBoundingClientRect();return{header:!!box.querySelector('.compact-agenda-head'),dateFirst:box.firstElementChild===date,label:!!date.querySelector('label>span:not(.date-field)'),addText:add.textContent,addHeight:ar.height,addRight:ar.right,boxRight:rect.right,addTop:ar.top,settingsBottom:box.querySelector('.compact-agenda-settings').getBoundingClientRect().bottom,dateTop:dr.top,boxTop:rect.top}})()`);
      assert.equal(layout.header,false);assert.equal(layout.dateFirst,true);assert.equal(layout.label,false);
      assert.ok(layout.addText.includes('添加待办'));assert.ok(layout.addHeight>=44);
      assert.ok(layout.boxRight-layout.addRight<25);assert.ok(layout.addTop>=layout.settingsBottom);
      assert.ok(layout.dateTop-layout.boxTop<25);
    }
    const before=await evaluate('document.querySelector("#todo-date").value');
    await click('.work-agenda-sidebar [data-action="todo-day-next"]');
    await waitFor(()=>evaluate(`document.querySelector('#todo-date').value!==${JSON.stringify(before)}`),'日期切换正常');
    await click('.work-agenda-sidebar [data-action="todo-day-prev"]');
    await waitFor(()=>evaluate(`document.querySelector('#todo-date').value===${JSON.stringify(before)}`),'日期切回');
    await click('.work-agenda-sidebar [data-action="new-todo"]');await expectVisible('#todo-form');
    await setValue('#todo-form [name=title]','布局验收新增待办');await click('[data-action="submit-modal"]');
    await waitFor(()=>evaluate('!document.querySelector("#todo-form")'),'待办创建成功');
    console.log('PASS: status-specific task labels and dialogs, date at top, no duplicate heading/date, larger bottom-right add button, date navigation and todo creation');
  }else{
  await navigate('journal');
  assert.equal(await evaluate('!!document.querySelector(".journal-drafts-heading [data-action=new-log]")'),false,'草稿标题栏不显示新建草稿按钮');
  assert.equal(await evaluate('document.querySelector(".journal-drafts-empty")?.tagName'),'BUTTON','整个长方形草稿区域可点击并支持键盘');
  assert.equal(await evaluate('document.querySelector(".journal-drafts-empty").getBoundingClientRect().width>=document.querySelector(".journal-drafts").clientWidth-50'),true,'点击区域覆盖整行');
  await click('.journal-drafts-empty');await expectVisible('#log-form');
  assert.equal(await evaluate('document.querySelector(".modal-head h2").textContent'),'编辑草稿');
  assert.equal(await evaluate('!!document.querySelector("#modal-layer .form-foot")'),false,'自动保存草稿不显示底部按钮');
  assert.equal(await evaluate('!!document.querySelector("#log-form .rich-toolbar,#log-form input[type=file],#log-form select,#log-form input[type=date]")'),false,'草稿是独立的简洁编辑界面');
  assert.equal(await evaluate('document.querySelector("#log-form [data-rich-editor=log]").innerText'),'','新草稿正文为空白');
  const placeholderVisible=()=>evaluate(`!['none','normal','""'].includes(getComputedStyle(document.querySelector('.draft-blank-editor'),'::before').content)`);
  assert.equal(await placeholderVisible(),true,'空草稿显示输入提示');
  await setHtml('#log-form [data-rich-editor="log"]','111111<p></p>');
  assert.equal(await placeholderVisible(),false,'有文本和空段落时提示消失');
  await setHtml('#log-form [data-rich-editor="log"]','<p><br></p>');
  assert.equal(await placeholderVisible(),true,'删除全部内容后提示重新出现');
  await cdpSend('Input.insertText',{text:'实际输入的草稿'});
  assert.equal(await placeholderVisible(),false,'键盘输入后提示立即消失');
  await setValue('#log-form [name=title]','浏览器验收-草稿直接编辑');await setHtml('#log-form [data-rich-editor="log"]','<p>关闭后立即可继续编辑。</p>');
  await waitFor(async()=>((await pageApi('/api/state')).logDrafts||[]).some(d=>d.title==='浏览器验收-草稿直接编辑'&&d.text.includes('关闭后立即可继续编辑')),'编辑时自动保存');
  assert.equal(await evaluate('!!document.querySelector("#log-form")'),true,'自动保存后继续留在编辑器');
  await click('.modal-close');
  await waitFor(()=>evaluate('!document.querySelector("#log-form")'),'保存并关闭草稿');
  const directDraft=(await pageApi('/api/state')).logDrafts.find(d=>d.title==='浏览器验收-草稿直接编辑');assert.ok(directDraft);
  assert.equal(await evaluate(`!!document.querySelector('[data-log-draft-edit="${directDraft.id}"]')`),true,'关闭编辑器后草稿立即显示，无需重新导航');
  await click(`[data-log-draft-edit="${directDraft.id}"]`);await expectVisible('#log-form');
  assert.equal(await evaluate('document.querySelector("#log-form [name=title]").value'),'浏览器验收-草稿直接编辑');
  await setValue('#log-form [name=title]','浏览器验收-草稿修改已保存');await setHtml('#log-form [data-rich-editor="log"]','<p>继续编辑后的正文。</p>');
  await click('.modal-close');await waitFor(()=>evaluate('!document.querySelector("#log-form")'),'直接关闭时保存最新修改');
  assert.equal(await evaluate('!!document.querySelector(".compact-confirm")'),false,'关闭自动保存草稿无需确认');
  const editedDraft=(await pageApi('/api/state')).logDrafts.find(d=>d.id===directDraft.id);assert.equal(editedDraft.title,'浏览器验收-草稿修改已保存');assert.ok(editedDraft.text.includes('继续编辑后的正文'));
  assert.equal((await pageApi('/api/state')).logs.some(log=>log.id===directDraft.id),false,'保存草稿不会发布为日志');
  await reloadPage();await navigate('journal');await click(`[data-log-draft-edit="${directDraft.id}"]`);await expectVisible('#log-form');
  assert.equal(await evaluate('document.querySelector("#log-form [name=title]").value'),'浏览器验收-草稿修改已保存','刷新后可继续编辑同一草稿');
  await click('.modal-close');await waitFor(()=>evaluate('!document.querySelector("#log-form")'),'关闭未修改草稿');
  await click(`[data-log-delete-draft="${directDraft.id}"]`);await expectVisible('.compact-confirm');await click('[data-action="app-dialog-accept"]');await waitFor(async()=>!(await pageApi('/api/state')).logDrafts.some(d=>d.id===directDraft.id),'删除草稿验收样本');
  await expectVisible('.journal-drafts-empty');await click('.journal-drafts-empty');await expectVisible('#log-form');
  await setHtml('#log-form [data-rich-editor="log"]','<p>没有标题也可以保存草稿。</p>');
  await click('.modal-close');await waitFor(()=>evaluate('!document.querySelector("#log-form")'),'无标题正文自动保存');
  const bodyOnlyDraft=(await pageApi('/api/state')).logDrafts.find(d=>d.text.includes('没有标题也可以保存草稿'));
  assert.ok(bodyOnlyDraft);assert.equal(bodyOnlyDraft.title,'');
  await click(`[data-log-draft-edit="${bodyOnlyDraft.id}"]`);await expectVisible('#log-form');
  assert.equal(await evaluate('!!document.querySelector("#modal-layer .form-foot")'),false,'继续编辑也不显示底部按钮');
  assert.ok((await evaluate('document.querySelector("#log-form [data-rich-editor=log]").innerText')).includes('没有标题也可以保存草稿'));
  await setHtml('#log-form [data-rich-editor="log"]','');
  await click('.modal-close');await waitFor(()=>evaluate('!document.querySelector("#log-form")'),'关闭草稿');
  assert.equal((await pageApi('/api/state')).logDrafts.find(d=>d.id===bodyOnlyDraft.id).text,'','已有草稿清空正文后也应自动保存');
  await click(`[data-log-draft-edit="${bodyOnlyDraft.id}"]`);await expectVisible('#log-form');
  assert.equal(await evaluate('document.querySelector("#log-form [data-rich-editor=log]").innerText.trim()'),'','重新打开保留清空结果');
  await click('.modal-close');await waitFor(()=>evaluate('!document.querySelector("#log-form")'),'关闭已清空草稿');
  await click(`[data-log-delete-draft="${bodyOnlyDraft.id}"]`);await expectVisible('.compact-confirm');await click('[data-action="app-dialog-accept"]');await waitFor(async()=>!(await pageApi('/api/state')).logDrafts.some(d=>d.id===bodyOnlyDraft.id),'删除无标题草稿样本');
  assert.equal((await pageApi('/api/state')).logs.length,0,'所有保存操作均未发布日志');
  await expectVisible('.journal-drafts-empty');await click('[data-action="new-log"]');await expectVisible('#log-form');
  assert.equal(await evaluate('document.querySelector("[data-action=submit-modal]").textContent'),'发布日志','写日志入口保留发布界面');
  await click('.modal-close');await waitFor(()=>evaluate('!document.querySelector("#log-form")'),'关闭写日志界面');
  if(process.argv.includes('--drafts-only')){console.log('PASS: blank draft editor, optional title, save without publishing, reopen, refresh persistence, unchanged log publishing entry');}else{
   const emptyDraftView=await evaluate(`(()=>{const box=document.querySelector('.journal-drafts'),empty=box?.querySelector('.journal-drafts-empty'),heading=box?.querySelector('.journal-drafts-heading h2');if(!box||!empty||!heading)return null;const style=getComputedStyle(box),emptyStyle=getComputedStyle(empty),headingStyle=getComputedStyle(heading);return{text:box.innerText,padding:parseFloat(style.paddingTop),radius:parseFloat(style.borderTopLeftRadius),emptyPadding:parseFloat(emptyStyle.paddingTop),headingSize:parseFloat(headingStyle.fontSize)}})()`);assert.ok(emptyDraftView,'日志页应显示我的草稿卡片和空状态');assert.ok(emptyDraftView.text.includes('我的草稿')&&emptyDraftView.text.includes('暂无草稿'),'空草稿中文文案正常');assert.ok(emptyDraftView.padding>=15&&emptyDraftView.radius>=8&&emptyDraftView.emptyPadding>=10&&emptyDraftView.headingSize>=14,'草稿卡片应具备正常间距、边框和标题样式');await navigate('work');
  // Required-field validation is enforced in the real browser form.
  await click('[data-action="new-task"]');await expectVisible('#task-create-form');await click('[data-action="submit-modal"]');
  assert.equal(await evaluate('document.querySelector("#task-create-form")?.checkValidity()'),false,'缺必填信息应阻止浏览器表单提交');await click('.modal-close');
  const attachmentGood=path.join(temp,'task-reference.md'),attachmentBad=path.join(temp,'unsupported.zip');await writeFile(attachmentGood,'验收用任务参考附件\n');await writeFile(attachmentBad,'not a supported archive');
  const attachmentTask=await createTask('浏览器验收-任务参考附件','u2','p1',[attachmentGood]);let attachmentState=await pageApi('/api/state');const referenceFile=attachmentState.files.find(x=>x.taskId===attachmentTask.id);assert.ok(referenceFile,'成功上传的任务附件应保存为任务资料');assert.ok((await evaluate(`document.querySelector('[data-task="${attachmentTask.id}"]')?.innerText`)).includes('task-reference.md'),'任务卡片显示已保存附件');
  await click('[data-action="new-task"]');await expectVisible('#task-create-form');await setValue('#task-create-form [name=title]','浏览器验收-附件失败提示');await setHtml('#task-create-form [data-rich-editor="task"]','<p>用于验证上传错误反馈。</p>');await setValue('#task-create-form [name=ownerId]','u2');await setValue('#task-create-form [name=dueAt]',new Date(Date.now()+3*86400000).toISOString().slice(0,16));await setValue('#task-create-form [name=acceptance]','失败不作为成功附件记录');await chooseFile('#task-create-form [name=taskAttachments]',attachmentBad);await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('[...document.querySelectorAll(".toast.error")].some(x=>x.textContent.includes("附件未全部上传"))'),'任务附件上传失败提示');const failedUploadState=await pageApi('/api/state');const failedUploadTask=failedUploadState.tasks.find(x=>x.title==='浏览器验收-附件失败提示');assert.ok(failedUploadTask,'附件失败时应明确保留已经创建的主任务');assert.ok(!failedUploadState.files.some(x=>x.taskId===failedUploadTask.id),'上传失败不得显示为成功附件');await reloadPage();await navigate('work');
  const noChild=await createTask('浏览器验收-无子任务','u2');
  const withChild=await createTask('浏览器验收-未完成子任务','u2');
  await createTask('浏览器验收-多任务A','u2');await createTask('浏览器验收-多任务B','u2');
  await loginAs('worker2');await navigate('work');
  const ownerTasks=await pageApi('/api/state');const multiA=ownerTasks.tasks.find(x=>x.title==='浏览器验收-多任务A'),multiB=ownerTasks.tasks.find(x=>x.title==='浏览器验收-多任务B');
   // Task links toggle on and off; new logs autosave privately and use the shared in-app confirmation.
   await navigate('journal');await click('[data-action="new-log"]');await expectVisible('#log-form');await setValue('#log-form [name=title]','浏览器验收-自动草稿及选择取消');await setValue('#log-form [name=logType]','任务日志');await setHtml('#log-form [data-rich-editor="log"]','<p>用于检查草稿自动保存。</p>');await click(`#log-form input[name="taskIds"][value="${multiA.id}"]`);await click(`#log-form input[name="taskIds"][value="${multiB.id}"]`);await click(`#log-form input[name="taskIds"][value="${multiA.id}"]`);assert.deepEqual(await evaluate(`[...document.querySelectorAll('#log-form input[name="taskIds"]:checked')].map(x=>x.value)`),[multiB.id],'再次点击已选任务可取消关联');await waitFor(async()=>((await pageApi('/api/state')).logDrafts||[]).some(d=>d.title==='浏览器验收-自动草稿及选择取消'),'新日志自动保存为服务端草稿');await evaluate('window.__nativeConfirmCalls=0;window.confirm=()=>{window.__nativeConfirmCalls++;return true}');await click('.modal-close');await expectVisible('.compact-confirm');assert.ok((await text()).includes('未发布内容已自动保存到草稿'),'离开提示应使用统一站内确认框');assert.equal(await evaluate('window.__nativeConfirmCalls'),0,'离开草稿不调用浏览器原生 confirm');await click('[data-action="app-dialog-cancel"]');assert.equal(await evaluate('!!document.querySelector("#log-form")'),true,'取消离开后编辑内容仍在');await click('.modal-close');await expectVisible('.compact-confirm');await click('[data-action="app-dialog-accept"]');await waitFor(()=>evaluate('!document.querySelector("#log-form")'),'关闭已自动保存的日志草稿');await navigate('journal');await waitFor(()=>evaluate(`[...document.querySelectorAll('.journal-draft-item')].some(x=>x.innerText.includes('浏览器验收-自动草稿及选择取消'))`),'草稿列表显示未发布日志').catch(async error=>{throw Error(`${error.message}; view=${await evaluate('document.querySelector("#page-content")?.innerText.slice(0,500)')}; drafts=${JSON.stringify((await pageApi('/api/state')).logDrafts)}`)});const autosavedDraft=(await pageApi('/api/state')).logDrafts.find(d=>d.title==='浏览器验收-自动草稿及选择取消');assert.ok(autosavedDraft,'自动草稿刷新后仍保存');assert.deepEqual(autosavedDraft.taskIds,[multiB.id],'草稿保存实际勾选关联');await click(`[data-log-delete-draft="${autosavedDraft.id}"]`);await expectVisible('.compact-confirm');await click('[data-action="app-dialog-accept"]');await waitFor(async()=>!((await pageApi('/api/state')).logDrafts||[]).some(d=>d.id===autosavedDraft.id),'用户可删除自动草稿');await navigate('work');
  await submitTask(noChild);const noChildLog=await createLog('浏览器日志-无子任务',[noChild.id]);await submitForAcceptance(noChild,noChildLog);await acceptTask(noChild);
  await loginAs('worker2');await navigate('work');
  await click(`[data-task-subtask="${withChild.id}"]`);await expectVisible('#subtask-create-form');await setValue('#subtask-create-form [name=title]','乙的私有未完成步骤');await setValue('#subtask-create-form [name=description]','不向其他成员公开');await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('!document.querySelector("#subtask-create-form")'),'私有子任务创建');let subtaskState=await pageApi('/api/state');let privateSubtask=subtaskState.personalSubtasks.find(x=>x.taskId===withChild.id&&x.title==='乙的私有未完成步骤');assert.ok(privateSubtask,'浏览器保存按钮应创建私有子任务');
  await click(`[data-task="${withChild.id}"] [data-subtask-edit="${privateSubtask.id}"]`);await expectVisible('#subtask-edit-form');await setValue('#subtask-edit-form [name=description]','修改后仍仅本人可见');await setValue('#subtask-edit-form [name=order]','4');await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('!document.querySelector("#subtask-edit-form")'),'子任务编辑保存');subtaskState=await pageApi('/api/state');privateSubtask=subtaskState.personalSubtasks.find(x=>x.id===privateSubtask.id);assert.equal(privateSubtask.description,'修改后仍仅本人可见');assert.equal(privateSubtask.order,4);
  await setValue(`[data-subtask-status="${privateSubtask.id}"]`,'进行中');await waitFor(async()=>((await pageApi('/api/state')).personalSubtasks.find(x=>x.id===privateSubtask.id)?.status==='进行中'),'子任务状态开始');await setValue(`[data-subtask-status="${privateSubtask.id}"]`,'待处理');await waitFor(async()=>((await pageApi('/api/state')).personalSubtasks.find(x=>x.id===privateSubtask.id)?.status==='待处理'),'子任务状态恢复');
  await click(`[data-task-subtask="${withChild.id}"]`);await setValue('#subtask-create-form [name=title]','浏览器验收-删除子任务');await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('!document.querySelector("#subtask-create-form")'),'删除测试子任务创建');subtaskState=await pageApi('/api/state');const deleteSubtask=subtaskState.personalSubtasks.find(x=>x.taskId===withChild.id&&x.title==='浏览器验收-删除子任务');await click(`[data-subtask-delete="${deleteSubtask.id}"]`);await waitFor(async()=>!(await pageApi('/api/state')).personalSubtasks.some(x=>x.id===deleteSubtask.id),'子任务删除');assert.ok((await pageApi('/api/state')).personalSubtaskHistory.some(x=>x.subtaskId===deleteSubtask.id&&x.action==='delete'),'删除操作保留私有操作记录');
  await submitTask(withChild);const imageUpload=await evaluate(`(async()=>{const raw=atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6n8AAAAASUVORK5CYII='),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),form=new FormData();form.append('file',new File([bytes],'acceptance.png',{type:'image/png'}));form.append('kind','log');form.append('recordId','');const r=await fetch('/api/editor-images',{method:'POST',headers:{'X-Project-Id':'p1'},body:form});return {status:r.status,data:await r.json()}})()`);assert.equal(imageUpload.status,201,JSON.stringify(imageUpload.data));const rich=`<h2><strong>富文本交付证据</strong></h2><p>包含加粗内容与图片。</p><img alt="e2e-image" src="${imageUpload.data.url}">`;
  const multiLog=await createLog('浏览器日志-多任务富文本',[withChild.id,multiA.id,multiB.id],rich);assert.deepEqual(new Set(multiLog.taskIds),new Set([withChild.id,multiA.id,multiB.id]));
  await submitForAcceptance(withChild,multiLog);await acceptTask(withChild);await loginAs('worker2');
  const workerState=await pageApi('/api/state');assert.equal(workerState.tasks.find(x=>x.id===withChild.id)?.status,'已完成',JSON.stringify(workerState.tasks.map(x=>[x.id,x.title,x.status])));assert.equal(workerState.personalSubtasks.find(x=>x.taskId===withChild.id)?.status,'待处理',JSON.stringify(workerState.personalSubtasks));
  await navigate('work');await waitFor(()=>evaluate(`(document.querySelectorAll('[data-task="${multiA.id}"] [data-open-log]').length===1)&&(document.querySelectorAll('[data-task="${multiB.id}"] [data-open-log]').length===1)`),'多任务日志各显示一次');
  // Edit-draft restoration uses the author/project/log scoped cache across a full page reload.
  await navigate('journal');await waitFor(()=>evaluate(`!!document.querySelector('[data-log="${multiLog.id}"] [data-action="edit-log"]')`),'日志编辑入口');assert.equal(await evaluate(`document.querySelectorAll('[data-log="${multiLog.id}"] [data-open-task]').length`),3,'日志详情反向显示全部关联任务且不重复');await click(`[data-log="${multiLog.id}"] [data-action="edit-log"]`);await expectVisible('#log-form');await setValue('#log-form [name=title]','浏览器日志-编辑草稿恢复');await setHtml('#log-form [data-rich-editor="log"]','<p>刷新后恢复的未保存编辑。</p>');
  const draftKey=await evaluate(`localStorage.getItem('log-draft:u2:p1:${multiLog.id}')`);assert.ok(draftKey,'日志编辑草稿应按用户、项目和日志编号缓存');await reloadPage();await waitFor(()=>evaluate('!!document.querySelector("#page-content")'),'登录会话恢复');const afterReloadState=await pageApi('/api/state');assert.equal(afterReloadState.tasks.find(x=>x.id===noChild.id)?.status,'已完成','刷新后主任务状态持久');assert.ok(afterReloadState.logs.some(x=>x.id===multiLog.id),'刷新后日志关联持久');
  await navigate('journal');await click(`[data-log="${multiLog.id}"] [data-action="edit-log"]`);await expectVisible('#log-form');assert.equal(await evaluate('document.querySelector("#log-form [name=title]").value'),'浏览器日志-编辑草稿恢复');assert.match(await evaluate('document.querySelector("#log-form [data-rich-editor=log]").innerText'),/刷新后恢复/);await click('.modal-close');
   // DOCX includes rich body and embedded image, and can be parsed by python-docx.
  const bytesResult=await evaluate(`fetch('/api/export?kind=log&id=${multiLog.id}&format=docx',{headers:{'X-Project-Id':'p1'}}).then(async r=>({status:r.status,b64:btoa(String.fromCharCode(...new Uint8Array(await r.arrayBuffer())))}))`);
  assert.equal(bytesResult.status,200,'DOCX 导出请求成功');const docx=Buffer.from(bytesResult.b64,'base64');if(process.env.ACCEPTANCE_DOCX_OUTPUT)await writeFile(path.resolve(process.env.ACCEPTANCE_DOCX_OUTPUT),docx);
  const docxCheck=spawnSync('python',['-c','import io,sys,zipfile;from docx import Document;b=sys.stdin.buffer.read();z=zipfile.ZipFile(io.BytesIO(b));d=Document(io.BytesIO(b));text="\\n".join(p.text for p in d.paragraphs);print(text);print("IMAGES="+str(len(d.inline_shapes)));print("BOLD="+str(any(r.bold for p in d.paragraphs for r in p.runs)))'],{input:docx,encoding:'utf8'});
  assert.equal(docxCheck.status,0,docxCheck.stderr);assert.match(docxCheck.stdout,/富文本交付证据/);assert.match(docxCheck.stdout,/浏览器验收-多任务A/);assert.match(docxCheck.stdout,/浏览器验收-多任务B/);assert.match(docxCheck.stdout,/IMAGES=1/);assert.match(docxCheck.stdout,/BOLD=True/);
  await loginAs('peer3');await navigate('journal');await click('[data-action="new-log"]');await expectVisible('#log-form');assert.equal(await evaluate('document.querySelector("#log-form [name=title]").value'),'','另一账号不得恢复组员乙的本地草稿');assert.ok(!(await evaluate('document.querySelector("#log-form [data-rich-editor=log]").innerText')).includes('刷新后恢复'));await click('.modal-close');
  await loginAs('leader1');await navigate('work');const cycleTask=await createTask('浏览器验收-退回撤回重开恢复','u2');await loginAs('worker2');await navigate('work');await submitTask(cycleTask);const cycleLog=await createLog('浏览器日志-状态流转',[cycleTask.id]);await submitForAcceptance(cycleTask,cycleLog);
  await loginAs('leader1');await navigate('work');await click(`[data-task="${cycleTask.id}"] [data-task-action="return"]`);await expectVisible('#task-action-form');await setValue('#task-action-form [name=reason]','尚需补充边界验证');await setValue('#task-action-form [name=revisionRequest]','补上异常与恢复路径的验证结果');await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('!document.querySelector("#task-action-form")'),'验收退回');assert.equal((await pageApi('/api/state')).tasks.find(x=>x.id===cycleTask.id).status,'进行中');
  await loginAs('worker2');await navigate('work');await submitForAcceptance(cycleTask,cycleLog);await click(`[data-task="${cycleTask.id}"] [data-task-action="withdraw"]`);await expectVisible('#task-action-form');await setValue('#task-action-form [name=reason]','撤回补充附件');await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('!document.querySelector("#task-action-form")'),'提交撤回');let cycleState=await pageApi('/api/state');assert.equal(cycleState.tasks.find(x=>x.id===cycleTask.id).status,'进行中');assert.ok(cycleState.tasks.find(x=>x.id===cycleTask.id).submissions.at(-1)?.withdrawnAt||cycleState.tasks.find(x=>x.id===cycleTask.id).submissions[0]?.withdrawnAt);
  await submitForAcceptance(cycleTask,cycleLog);await loginAs('leader1');await navigate('work');await click(`[data-task="${cycleTask.id}"] [data-task-action="accept"]`);await expectVisible('#task-action-form');await setValue('#task-action-form [name=reason]','最终验收通过');await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('!document.querySelector("#task-action-form")'),'最终验收');
  await click(`[data-task="${cycleTask.id}"] [data-task-action="reopen"]`);await expectVisible('#task-action-form');await setValue('#task-action-form [name=reason]','后续发现新的补充需求');await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('!document.querySelector("#task-action-form")'),'重新打开');
  await click(`[data-task="${cycleTask.id}"] [data-task-action="cancel"]`);await expectVisible('#task-action-form');await setValue('#task-action-form [name=reason]','范围调整取消');await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('!document.querySelector("#task-action-form")'),'取消任务');
  await click(`[data-task="${cycleTask.id}"] [data-task-action="restore"]`);await expectVisible('#task-action-form');await setValue('#task-action-form [name=reason]','需求重新排期，恢复执行');await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('!document.querySelector("#task-action-form")'),'恢复任务');cycleState=await pageApi('/api/state');const cycled=cycleState.tasks.find(x=>x.id===cycleTask.id);assert.equal(cycled.status,'待处理');assert.equal(cycled.submissions.length,3);assert.equal(cycled.acceptanceHistory.filter(x=>x.result==='退回').length,1);assert.equal(cycled.acceptanceHistory.filter(x=>x.result==='通过').length,1);
  // Search, status, owner, priority, due-date and overdue filters run against rendered cards.
  await loginAs('leader1');await navigate('work');
  await setValue('#work-search','浏览器验收-多任务A');await waitFor(()=>evaluate(`document.querySelectorAll('.work-card[data-task]').length===1`),'标题搜索');
  await setValue('#work-search','');await setValue('#task-overdue-filter','');
  await evaluate(`(()=>{const e=document.querySelector('#task-overdue-filter');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}))})()`);
  await waitFor(()=>evaluate(`document.querySelectorAll('.work-card[data-task]').length===1&&document.querySelector('.work-card[data-task]')?.innerText.includes('验收逾期筛选样本')`),'逾期筛选');
  await evaluate(`(()=>{document.querySelector('#task-overdue-filter').checked=false;document.querySelector('#task-overdue-filter').dispatchEvent(new Event('change',{bubbles:true}));const e=document.querySelector('#task-status-filter');e.value='已完成';e.dispatchEvent(new Event('change',{bubbles:true}));const p=document.querySelector('#task-priority-filter');p.value='P1';p.dispatchEvent(new Event('change',{bubbles:true}));const o=document.querySelector('#task-owner-filter');o.value='u2';o.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(()=>evaluate(`[...document.querySelectorAll('.work-card[data-task]')].every(x=>x.innerText.includes('已完成')&&x.innerText.includes('P1'))`),'状态、优先级和负责人筛选');
  await evaluate(`(()=>{const e=document.querySelector('#task-status-filter');e.value='全部状态';e.dispatchEvent(new Event('change',{bubbles:true}));const p=document.querySelector('#task-priority-filter');p.value='全部优先级';p.dispatchEvent(new Event('change',{bubbles:true}));const o=document.querySelector('#task-owner-filter');o.value='全部成员';o.dispatchEvent(new Event('change',{bubbles:true}));const d=document.querySelector('#task-due-filter');d.value='2025-01-01';d.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(()=>evaluate(`document.querySelectorAll('.work-card[data-task]').length===1`),'截止日期筛选');
  await setValue('#task-due-filter','');await evaluate(`(()=>{const e=document.querySelector('#task-sort');e.value='due';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);const dueOrder=await evaluate('[...document.querySelectorAll(".work-card[data-task]")].map(x=>x.dataset.task)'),taskRows=(await pageApi('/api/state')).tasks,expectedDue=taskRows.slice().sort((a,b)=>String(a.dueAt||'').localeCompare(String(b.dueAt||''))).map(x=>x.id);assert.deepEqual(dueOrder,expectedDue,'截止日期排序与数据一致');await evaluate(`(()=>{const e=document.querySelector('#task-sort');e.value='created';e.dispatchEvent(new Event('change',{bubbles:true}))})()`);const createdOrder=await evaluate('[...document.querySelectorAll(".work-card[data-task]")].map(x=>x.dataset.task)'),expectedCreated=taskRows.slice().sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).map(x=>x.id);assert.deepEqual(createdOrder,expectedCreated,'创建时间排序与数据一致');
  await setValue('#task-due-filter','');const reassignmentTask=await createTask('浏览器验收-改派保留私有拆分','u2');await loginAs('worker2');await navigate('work');await click(`[data-task-subtask="${reassignmentTask.id}"]`);await setValue('#subtask-create-form [name=title]','改派后原负责人私有项');await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('!document.querySelector("#subtask-create-form")'),'改派样本子任务保存');
  await loginAs('leader1');await navigate('work');await click(`[data-task="${reassignmentTask.id}"] [data-task-action="reassign"]`);await expectVisible('#task-action-form');await setValue('#task-action-form [name=ownerId]','u3');await setValue('#task-action-form [name=reason]','浏览器验收改派');await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('!document.querySelector("#task-action-form")'),'改派保存');
  await loginAs('worker2');await navigate('work');assert.equal(await evaluate(`!!document.querySelector('[data-task="${reassignmentTask.id}"] [data-task-action="start"]')`),false,'改派后旧负责人没有执行入口');assert.ok((await evaluate(`document.querySelector('[data-task="${reassignmentTask.id}"]')?.innerText`)).includes('改派后原负责人私有项'),'原负责人仍可只读查看自己的私有拆分');
  await loginAs('peer3');await navigate('work');assert.ok(!(await evaluate(`document.querySelector('[data-task="${reassignmentTask.id}"]')?.innerText`)).includes('改派后原负责人私有项'),'新负责人看不到旧负责人的私有拆分');await submitTask(reassignmentTask);
  // Same user has independent roles in the two projects; role controls update after an actual project-menu click.
  await loginAs('leader1');const snakeMeeting=await pageApi('/api/meetings','POST',{title:'时间线验收会议',topic:'验证蛇形主线',date:new Date().toISOString().slice(0,10),start:'09:00',end:'10:00',format:'线下',location:'验收会议室',hostId:'u1',attendeeIds:['u1','u2','u3']},'p1');assert.ok(snakeMeeting.id,'可创建时间线验收会议');await pageApi('/api/focus-marks','POST',{targetType:'meeting',targetId:snakeMeeting.id,scope:'team',stars:3,timelineJoined:'yes',note:''},'p1');await reloadPage();await navigate('timeline');await waitFor(()=>evaluate(`[...document.querySelectorAll('.snake-meeting-node')].some(x=>x.innerText.includes('时间线验收会议'))`),'蛇形时间线会议节点加载');const publicTimeline=await text();assert.ok(publicTimeline.includes('时间线验收会议'),'项目蛇形时间线显示三星会议节点');assert.ok(!publicTimeline.includes('乙的私有未完成步骤')&&!publicTimeline.includes('改派后原负责人私有项'),'项目时间线不泄露私有子任务');await evaluate(`(()=>{const node=document.querySelector('.snake-open-proxy[data-open-meeting=\"${snakeMeeting.id}\"]')?.closest('.snake-meeting-node');node?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,detail:2}));return !!node})()`);await waitFor(()=>evaluate(`document.querySelector('#page-content h1')?.textContent==='时间线验收会议'`),'蛇形节点双击进入会议详情');
   await loginAs('worker2');
   // Server-side draft list renders as a styled card, remains private, and republishes through the browser control.
   const draftCreate=await evaluate(`fetch('/api/logs',{method:'POST',headers:{'content-type':'application/json','X-Project-Id':'p1'},body:JSON.stringify({title:'浏览器验收-草稿卡片显示',logType:'项目日常日志',text:'检查草稿保存和页面呈现。',date:new Date().toISOString().slice(0,10),taskIds:[]})}).then(async r=>({status:r.status,data:await r.json()}))`);assert.equal(draftCreate.status,201,'可创建项目日常日志');const savedDraft=draftCreate.data;const withdrawnDraft=await evaluate(`fetch('/api/logs',{method:'DELETE',headers:{'content-type':'application/json','X-Project-Id':'p1'},body:JSON.stringify({id:${JSON.stringify(savedDraft.id)}})}).then(async r=>({status:r.status,data:await r.json()}))`);assert.equal(withdrawnDraft.status,200,'未引用日志可撤回为草稿');await reloadPage();await waitFor(()=>evaluate('!!document.querySelector("#page-content")'),'草稿保存后重新读取项目状态');await navigate('journal');await waitFor(()=>evaluate(`!!document.querySelector('.journal-draft-item')`),'已保存草稿显示');assert.ok((await evaluate(`document.querySelector('.journal-drafts').innerText`)).includes('浏览器验收-草稿卡片显示'),'草稿标题正常显示');const draftStyle=await evaluate(`(()=>{const e=document.querySelector('.journal-draft-item'),s=getComputedStyle(e),b=getComputedStyle(e.querySelector('b'));return{padding:parseFloat(s.paddingTop),radius:parseFloat(s.borderTopLeftRadius),titleSize:parseFloat(b.fontSize)}})()`);assert.ok(draftStyle.padding>=8&&draftStyle.radius>=6&&draftStyle.titleSize>=11,'有草稿项目应具备正常卡片布局');await click(`[data-log-publish="${savedDraft.id}"]`);await waitFor(()=>evaluate(`!document.querySelector('[data-log-publish="${savedDraft.id}"]')`),'草稿重新发布');assert.ok((await pageApi('/api/state')).logs.some(x=>x.id===savedDraft.id),'重新发布后草稿成为项目日志');
   await loginAs('peer3');
  await navigate('work');assert.equal(await evaluate('!!document.querySelector("[data-action=new-task]")'),false,'p1 组员不可见创建主任务入口');
  await selectProject('p2');await navigate('work');assert.equal(await evaluate('!!document.querySelector("[data-action=new-task]")'),true,'p2 组长可见创建主任务入口');
  const leaderState=await pageApi('/api/state','GET',null,'p1');assert.equal(leaderState.personalSubtasks.length,0,'p1 组员看不到他人的私有子任务');assert.ok(!JSON.stringify(leaderState).includes('乙的私有未完成步骤'));
  const preTransferTask=await createTask('浏览器验收-转让后历史保留','u3','p2');await navigate('members');await click('[data-leader-transfer="u2"]');await expectVisible('[data-action="app-dialog-accept"]');await click('[data-action="app-dialog-accept"]');await waitFor(async()=>{const s=await pageApi('/api/state','GET',null,'p2');return s.people.find(p=>p.id==='u2')?.role==='组长'&&s.people.find(p=>p.id==='u3')?.role==='组员'},'组长转让完成');let transferredState=await pageApi('/api/state','GET',null,'p2');assert.equal(transferredState.people.filter(p=>p.role==='组长').length,1);assert.equal(transferredState.tasks.find(t=>t.id===preTransferTask.id)?.createdById,'u3');assert.equal(transferredState.tasks.find(t=>t.id===preTransferTask.id)?.ownerId,'u3');assert.equal(await evaluate('!!document.querySelector("[data-action=new-task]")'),false,'转让后的原组长界面失去组长入口');
  await loginAs('worker2');await navigate('work');assert.equal(await evaluate('!!document.querySelector("[data-action=new-task]")'),true,'新组长获得管理入口');await selectProject('p1');await navigate('work');assert.equal(await evaluate('!!document.querySelector("[data-action=new-task]")'),false,'新组长在另一项目仍按组员角色授权');await selectProject('p2');await navigate('work');assert.equal(await evaluate('!!document.querySelector("[data-action=new-task]")'),true,'切回组长项目后恢复该项目组长入口');
  await click(`[data-task="${preTransferTask.id}"] [data-task-action="cancel"]`);await expectVisible('#task-action-form');await setValue('#task-action-form [name=reason]','角色转让验收样本清理');await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('!document.querySelector("#task-action-form")'),'取消角色转让验收样本');
  const archiveBlocker=await createTask('浏览器验收-归档阻塞','u1','p2');await navigate('projects');await click('[data-project-select="p2"]');await waitFor(()=>evaluate(`document.querySelector('[data-action="archive-selected-project"]')?.disabled===false`),'项目归档按钮可用');await click('[data-action="archive-selected-project"]');await expectVisible('[data-action="app-dialog-accept"]');await click('[data-action="app-dialog-accept"]');await waitFor(()=>evaluate('[...document.querySelectorAll(".toast.error")].some(x=>x.textContent.includes("未结束主任务"))'),'存在未结束主任务时服务端拒绝归档');
  await navigate('members');await click('[data-member-remove="u1"]');await expectVisible('[data-action="app-dialog-accept"]');await click('[data-action="app-dialog-accept"]');await waitFor(()=>evaluate('[...document.querySelectorAll(".toast.error")].some(x=>x.textContent.includes("请先改派或取消"))'),'移除成员的活动任务阻断提示');assert.ok((await pageApi('/api/state','GET',null,'p2')).people.some(p=>p.id==='u1'),'有未结束任务时成员保留在项目内');
  await navigate('work');await click(`[data-task="${archiveBlocker.id}"] [data-task-action="cancel"]`);await expectVisible('#task-action-form');await setValue('#task-action-form [name=reason]','归档与移除成员验收清理');await click('[data-action="submit-modal"]');await waitFor(()=>evaluate('!document.querySelector("#task-action-form")'),'取消归档阻塞任务');await navigate('members');await click('[data-member-remove="u1"]');await expectVisible('[data-action="app-dialog-accept"]');await click('[data-action="app-dialog-accept"]');await waitFor(async()=>!(await pageApi('/api/state','GET',null,'p2')).people.some(p=>p.id==='u1'),'移除成员完成');await loginAs('leader1');const removedAccess=await evaluate(`fetch('/api/state',{headers:{'X-Project-Id':'p2'}}).then(r=>r.status)`);assert.equal(removedAccess,403,'移出项目后旧成员不能再读取项目');await loginAs('worker2');await selectProject('p2');await navigate('projects');await click('[data-project-select="p2"]');await waitFor(()=>evaluate(`document.querySelector('[data-action="archive-selected-project"]')?.disabled===false`),'项目归档按钮可用');await click('[data-action="archive-selected-project"]');await expectVisible('[data-action="app-dialog-accept"]');await click('[data-action="app-dialog-accept"]');await waitFor(async()=>{const s=await pageApi('/api/state','GET',null,'p2');return s.project.status==='已归档'},'归档成功');await navigate('work');assert.equal(await evaluate('!!document.querySelector("[data-action=new-task]")'),false,'归档后界面关闭任务创建入口');assert.equal(await evaluate(`!!document.querySelector('[data-task="${archiveBlocker.id}"] [data-task-action]')`),false,'归档后不提供任务操作入口');
  console.log(JSON.stringify({result:'PASS',browser:'Chrome headless (CDP mouse clicks)',scenarios:['AC-01 cross-project role isolation and leader transfer with historical actors preserved','AC-02 required browser form validation, assignment and task attachment success/failure','AC-05/21/22/23 transition, return, withdraw, reopen, cancel and restore','AC-07/08 submission with none/incomplete subtasks','AC-09/10/11 private subtask create, edit, delete, reorder and state boundary','AC-12/13 reassignment and private split boundary','AC-14/15 multi-task log links shown bidirectionally once','AC-16 local draft reload/account isolation, task checkbox toggle, server autosave/delete, styled cards and unified confirmation','AC-19 DOCX metadata, rich text and embedded image','AC-24 search/filters/sorting/overdue','AC-25 public timeline excludes private subtasks','AC-26 active-task archive block and archived read-only UI','AC-27 active task blocks member removal; removed member loses project access'],docx:{bytes:docx.length,pythonDocx:'opened',images:1,bold:true}},null,2));
  }
  }
}catch(error){console.error(error.stack||error);console.error('E2E_SERVER_OUTPUT',server?server.stdout.read()?.toString()||'':'');process.exitCode=1}
finally{
  if(cdp){try{await cdpSend('Browser.close')}catch{}try{cdp.close()}catch{}}
  for(const child of [chrome,server])if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve))}
  const resolved=path.resolve(temp);if(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)){for(let attempt=0;attempt<5;attempt++){try{await rm(resolved,{recursive:true,force:true});break}catch(error){if(error.code!=='EBUSY'||attempt===4)throw error;await sleep(500)}}}
}
