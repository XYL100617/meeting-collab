const {test}=require('node:test');
const assert=require('node:assert/strict');
let model={};
try{model=require('../public/project-timeline-model.js')}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error}
const mark=(type,id,stars,scope='team',userId=null)=>({targetType:type,targetId:id,stars,scope,userId,note:'备注'});
const fixture=()=>({project:{id:'p-1'},people:[{id:'u-1',name:'甲'},{id:'u-2',name:'乙'}],
  meetings:[{id:'m-1',title:'早会',date:'2026-11-08',start:'09:00',host:'甲',attendeeIds:['u-1','u-2'],checkedIds:['u-1'],attendance:[{personId:'u-1',at:'2026-11-08T01:05:00Z',method:'本人签到'}],summary:'已保存纪要'},
    {id:'m-2',title:'晚会',date:'2026-11-08',start:'16:00',attendeeIds:[],summary:''}],
  files:[{id:'f-1',name:'三星资料.pdf',meetingId:'m-1',uploadedAt:'2026-11-08T10:00:00+08:00'}, {id:'f-orphan',name:'未关联.txt',uploadedAt:'2026-11-07T08:00:00+08:00'}],
  assignments:[{id:'a-1',meetingId:'m-1',content:'整理记录',owner:'乙',ownerId:'u-2',createdAt:'2026-11-08T10:30:00+08:00'}],
  logs:[{id:'l-1',linkAssignmentId:'a-1',author:'乙',authorId:'u-2',date:'2026-11-08',time:'11:00',text:'分工关联日志'}],
  events:[{id:'e-1',meetingId:'m-1',kind:'会议',title:'开始了会议',date:'2026-11-08',at:'2026-11-08T01:00:00Z',actorId:'u-1'}]});
function build(workspace=fixture(),marks=[]){assert.equal(typeof model.buildProjectTimeline,'function','应提供完整项目主线模型');return model.buildProjectTimeline(workspace,{marks,userId:'u-1',scope:'mine'})}

test('没有活动事件的会议也进入完整主线，按会议时间排序',()=>{
  const timeline=build();assert.deepEqual(timeline.nodes.filter(n=>n.type==='meeting').map(n=>n.id),['m-2','m-1']);
  assert.equal(timeline.nodes.find(n=>n.id==='m-1').activities.length,1);
});
test('会议节点关联资料、纪要、分工和通过分工关联的日志',()=>{
  const node=build().nodes.find(n=>n.id==='m-1');
  assert.deepEqual(node.files.map(f=>f.id),['f-1']);assert.deepEqual(node.assignments.map(a=>a.id),['a-1']);
  assert.deepEqual(node.logs.map(l=>l.id),['l-1']);assert.equal(node.minutes.type,'minutes');
});
test('三星文件独立进入概览，无星级会议也保留上下文',()=>{
  const timeline=build(fixture(),[mark('file','f-1',3)]);
  assert.deepEqual(timeline.highlights.map(n=>n.key),['file:f-1']);
  assert.equal(timeline.highlights[0].meetingTitle,'早会');assert.equal(timeline.nodes.find(n=>n.id==='m-1').stars,0);
});
test('各级星级都可查找且不会改变真实时间顺序',()=>{
  const workspace=fixture(),marks=[mark('meeting','m-1',3),mark('meeting','m-2',1),mark('assignment','a-1',2)];
  const timeline=build(workspace,marks);assert.deepEqual(timeline.nodes.map(n=>n.key),build(workspace).nodes.map(n=>n.key));
  assert.equal(timeline.nodes.find(n=>n.id==='m-2').stars,1);assert.equal(timeline.nodes.find(n=>n.id==='m-1').assignments[0].stars,2);
});
test('个人0星覆盖全队三星，不会读取其他人的个人重点',()=>{
  const workspace=fixture(),marks=[mark('file','f-1',3),mark('file','f-1',0,'personal','u-1'),mark('meeting','m-2',3,'personal','u-2')];
  assert.equal(build(workspace,marks).highlights.length,0);
  assert.deepEqual(model.buildProjectTimeline(workspace,{marks,userId:'u-1',scope:'team'}).highlights.map(n=>n.key),['file:f-1']);
});
test('签到区区分应参会、实际签到和补签，受邀不等于签到',()=>{
  const workspace=fixture();workspace.meetings[0].attendance.push({personId:'u-2',at:'2026-11-08T01:10:00Z',method:'组长补签',operator:'甲',reason:'现场已到场'});
  const node=build(workspace).nodes.find(n=>n.id==='m-1');assert.equal(node.attendance.find(p=>p.id==='u-1').checked,true);
  const other=node.attendance.find(p=>p.id==='u-2');assert.equal(other.checked,true);assert.equal(other.reason,'现场已到场');
  assert.equal(build().nodes.find(n=>n.id==='m-1').attendance.find(p=>p.id==='u-2').checked,false);
});
test('没有会议关联的资料独立展示，正文图片和私人待办不进入主线',()=>{
  const workspace=fixture();workspace.files.push({id:'image',name:'正文图片',kind:'正文图片',meetingId:'m-1'});workspace.todos=[{id:'private',title:'私人安排'}];
  const timeline=build(workspace,[mark('file','f-orphan',3),mark('file','image',3)]);
  assert.ok(timeline.nodes.some(n=>n.key==='file:f-orphan'));assert.equal(timeline.highlights[0].meetingTitle,'');
  assert.ok(!JSON.stringify(timeline).includes('正文图片'));assert.ok(!JSON.stringify(timeline).includes('私人安排'));
});
test('按成员、类型和日期匹配会议明细，筛选不会遗漏子记录',()=>{
  assert.equal(typeof model.filterProjectTimeline,'function');
  const filtered=model.filterProjectTimeline(build().nodes,{kind:'工作日志',personId:'u-2',from:'2026-11-08',to:'2026-11-08'});
  assert.deepEqual(filtered.map(n=>n.key),['meeting:m-1']);
  assert.equal(model.filterProjectTimeline(build().nodes,{from:'2026-11-09'}).length,0);
});
test('不同时区的活动按实际时刻排序，旧记录无效时间不崩溃',()=>{
  const workspace=fixture();workspace.events.push({id:'e-2',meetingId:'m-1',kind:'会议',title:'结束',at:'2026-11-08T10:00:00+08:00',date:'2026-11-08'});
  workspace.meetings[1].actualStart='2026-11-08T00:00:00Z';
  const timeline=build(workspace);assert.deepEqual(timeline.nodes.filter(n=>n.type==='meeting').map(n=>n.id),['m-1','m-2']);
  assert.deepEqual(timeline.nodes.find(n=>n.id==='m-1').activities.map(e=>e.id),['e-2','e-1']);
  workspace.files[1].uploadedAt='invalid';assert.doesNotThrow(()=>build(workspace));
});
test('日志附件保留关联日志的上下文，不会显示为无关独立文件',()=>{
  const workspace=fixture();workspace.files.push({id:'f-log',name:'日志附件.txt',logId:'l-1'});
  const target=build(workspace,[mark('file','f-log',3)]).highlights[0];
  assert.equal(target.logId,'l-1');assert.equal(target.meetingId,'m-1');assert.match(target.logTitle,/乙/);
});
test('只保存时分的旧实际开始时间使用会议日期，不会落到主线末尾',()=>{
  const workspace=fixture();workspace.meetings[0].actualStart='17:00';
  const node=build(workspace).nodes.find(n=>n.id==='m-1');assert.equal(node.date,'2026-11-08');assert.equal(node.time,'17:00');
  assert.equal(build(workspace).nodes[0].key,'meeting:m-1');
});
test('日期筛选可找到会议日期以外的实际补签记录',()=>{
  const workspace=fixture();workspace.meetings[0].date='2026-11-01';workspace.events=[];
  const result=model.filterProjectTimeline(build(workspace).nodes,{kind:'签到',personId:'u-1',from:'2026-11-08',to:'2026-11-08'});
  assert.deepEqual(result.map(n=>n.key),['meeting:m-1']);
});
test('同名成员资料按历史 uploadedById 识别上传者',()=>{
  const workspace=fixture();workspace.people[1].name='甲';workspace.files[0].uploadedById='u-1';workspace.files[0].uploadedBy='甲';
  const result=model.filterProjectTimeline(build(workspace).nodes,{kind:'资料',personId:'u-1'});
  assert.deepEqual(result.map(n=>n.key),['meeting:m-1']);
});
