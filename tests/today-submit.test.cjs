const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('待办隐藏 id 字段不会遮蔽保存分支使用的表单 id',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8').split('\n').find(line=>line.startsWith('async function submitModal(){'));
  const fields={id:'todo-1',title:'我的安排',date:'2026-11-08',start:'07:00',end:'07:30',stars:'3'};
  const form={id:{name:'id',value:'todo-1'},getAttribute:name=>name==='id'?'todo-form':null,reportValidity:()=>true,querySelector:()=>null};
  const calls=[],messages=[];
  const context={
    $:selector=>selector==='.modal form'?form:{disabled:false,textContent:''},
    FormData:class{entries(){return Object.entries(fields)}},
    request:async(route,method,data)=>{calls.push({route,method,data});return {...data,status:'未完成'}},
    refreshToday:async()=>{},closeModal:()=>{},render:()=>{},toast:message=>messages.push(message),
    todos:[{id:'todo-1'}],currentView:'today',currentTodoDate:'2026-11-08',
  };
  vm.createContext(context);vm.runInContext(source,context);await context.submitModal();
  assert.equal(calls.length,1,'保存按钮应提交一次待办更新，而不是直接关闭弹窗');
  assert.equal(calls[0].route,'/api/todos');
  assert.equal(calls[0].method,'PATCH');
  assert.equal(calls[0].data.start,'07:00');
  assert.ok(messages.includes('待办已更新'));
});

test('保存个人星级后，延迟返回的旧轮询不会覆盖已保存设置',async()=>{
  const app=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
  const submit=app.split('\n').find(line=>line.startsWith('async function submitModal(){'));
  const refresh=app.slice(app.indexOf('async function refreshToday('),app.indexOf('\nfunction startTodayPolling('));
  const oldItem={id:'todo-1',userId:'u-1',date:'2026-11-08',stars:0,importanceNote:''};
  let savedItem={...oldItem},releaseOld,todoReads=0;
  const oldResponse=new Promise(resolve=>releaseOld=resolve);
  const form={id:{name:'id'},getAttribute:()=> 'todo-mark-form',reportValidity:()=>true,querySelector:()=>null};
  const node={disabled:false,textContent:'',classList:{remove(){},add(){}}};
  const context={
    $:selector=>selector==='.modal form'?form:node,
    FormData:class{entries(){return Object.entries({id:'todo-1',personalMark:'yes',stars:'3',importanceNote:'已保存的新备注'})}},
    request:async(route,method,data)=>savedItem={...oldItem,...data},
    fetch:async url=>({ok:true,json:async()=>url.startsWith('/api/todos')?(++todoReads===1?oldResponse:[savedItem]):[]}),
    closeModal(){},render(){},toast(){},updateNotificationCount(){},validDay:()=>true,AbortSignal,
    currentProjectId:'p-1',todayMeetingScope:'project',todayScheduleUrl:date=>'/api/today-schedule?date='+date,currentUser:{id:'u-1'},currentTodoDate:'2026-11-08',currentView:'today',todayRefreshVersion:0,
    todos:[oldItem],dailyMeetings:[],notifications:[],
  };
  vm.createContext(context);vm.runInContext(submit+'\n'+refresh,context);
  const oldRefresh=context.refreshToday({silent:true});
  await new Promise(resolve=>setImmediate(resolve));
  await context.submitModal();
  releaseOld([oldItem]);await oldRefresh;
  assert.equal(context.todos[0].stars,3,'旧轮询不应把已保存的个人星级改回 0');
  assert.equal(context.todos[0].importanceNote,'已保存的新备注');
});
