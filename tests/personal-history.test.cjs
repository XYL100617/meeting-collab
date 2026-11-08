const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const modelPath=path.join(__dirname,'../public/personal-history-model.js');
const {buildPersonalHistory}=fs.existsSync(modelPath)?require(modelPath):{};
function fixture(){
  return {
    project:{id:'p-1',name:'当前项目',startDate:'2026-10-01'},
    people:[{id:'u-1',name:'甲',role:'组长'},{id:'u-2',name:'乙',role:'成员'},{id:'u-3',name:'丙',role:'成员'}],
    meetings:[{id:'m-1',title:'项目讨论',date:'2026-11-01',start:'09:00',end:'10:00',hostId:'u-1',host:'甲',organizerId:'u-1',organizer:'甲',attendeeIds:['u-1','u-2'],attendees:['甲','乙'],status:'已结束',attendance:[{personId:'u-2',name:'乙',operatorId:'u-1',operator:'甲',method:'补签',at:'2026-11-01T01:10:00Z',reason:'设备故障'}],checkedIds:['u-2']}],
    assignments:[{id:'a-1',content:'整理材料',ownerId:'u-3',owner:'丙',byId:'u-1',by:'甲',meetingId:'m-1',createdAt:'2026-11-01T01:00:00Z',due:'2026-11-04',changeHistory:[{byId:'u-1',by:'甲',at:'2026-11-02T02:00:00Z',before:{ownerId:'u-2',owner:'乙',content:'整理材料',due:'2026-11-03'},after:{ownerId:'u-3',owner:'丙',content:'整理材料',due:'2026-11-04'}}]}],
    logs:[{id:'l-1',authorId:'u-2',author:'乙',date:'2026-11-01',createdAt:'2026-11-01T02:00:00Z',text:'乙的工作日志',meetingId:'m-1'}],
    events:[
      {id:'e-meeting',kind:'会议',title:'创建了会议「项目讨论」',meetingId:'m-1',actorId:'u-1',date:'2026-11-01'},
      {id:'e-checkin',kind:'会议',title:'为乙补签',meetingId:'m-1',actorId:'u-1',personId:'u-2',date:'2026-11-01'},
      {id:'e-assignment',kind:'工作分配',title:'新增了工作分配',assignmentId:'a-1',actorId:'u-1',date:'2026-11-01'},
      {id:'e-change',kind:'工作分配',title:'调整了工作分配',assignmentId:'a-1',actorId:'u-1',date:'2026-11-02',detail:'甲 · 乙 → 丙 · 整理材料'},
      {id:'e-log',kind:'工作日志',title:'发布了一条工作日志',logId:'l-1',meetingId:'m-1',actorId:'u-2',date:'2026-11-01'},
    ],
    todos:[{userId:'u-2',title:'不可出现在回顾中的私人待办',importanceNote:'私人内容'}],
  };
}
function history(memberId,workspace=fixture()){
  assert.equal(typeof buildPersonalHistory,'function','需要按当前项目归集历史参与关系的模型');
  return buildPersonalHistory(workspace,memberId);
}
test('同一会议事件同时匹配发起、主持、受邀关系只展示一次',()=>{
  const rows=history('u-1').entries.filter(e=>e.id==='event:e-meeting');
  assert.equal(rows.length,1);assert.deepEqual(rows[0].relations,['发起','主持','受邀']);
});
test('受邀和主持不能当作实际签到，补签操作与被补签人区分',()=>{
  const leader=history('u-1'),member=history('u-2');
  assert.equal(leader.summary.checkedIn,0);assert.equal(member.summary.checkedIn,1);
  assert.ok(leader.entries.find(e=>e.id==='event:e-checkin').relations.includes('补签操作'));
  assert.ok(member.entries.find(e=>e.id==='event:e-checkin').relations.includes('实际签到'));
});
test('同一会议其他成员的工作日志不会变成本人的历史活动',()=>{
  assert.ok(!history('u-1').entries.some(e=>e.source?.type==='log'));
  assert.ok(history('u-2').entries.some(e=>e.source?.id==='l-1'));
});
test('负责人调整事件在原、新负责人回顾中保留当时关系且去重',()=>{
  const former=history('u-2'),current=history('u-3');
  assert.equal(former.summary.currentAssignments,0);assert.equal(former.summary.historicalAssignments,1);
  assert.equal(current.summary.currentAssignments,1);
  assert.equal(former.entries.filter(e=>e.id==='event:e-change').length,1);
  assert.ok(former.entries.find(e=>e.id==='event:e-change').relations.includes('原负责人'));
  assert.ok(current.entries.find(e=>e.id==='event:e-change').relations.includes('新负责人'));
  assert.ok(former.entries.find(e=>e.id==='event:e-change').details.some(x=>x.value.includes('乙 → 丙')));
});
test('已转交的分工创建记录保留初始负责人的关系',()=>{
  assert.ok(history('u-2').entries.find(e=>e.id==='event:e-assignment').relations.includes('初始负责人'));
  assert.ok(!history('u-3').entries.some(e=>e.id==='event:e-assignment'));
});
test('重复事件 id 合并且不会重复显示签到',()=>{
  const data=fixture();data.events.push({...data.events[1]});
  assert.equal(history('u-2',data).entries.filter(e=>e.id==='event:e-checkin').length,1);
  assert.equal(history('u-2',data).entries.filter(e=>e.category==='签到').length,1);
});
test('未记录活动事件的旧签到和日志仍能回顾，来源可定位',()=>{
  const data=fixture();data.events=[];
  const result=history('u-2',data);
  assert.ok(result.entries.some(e=>e.category==='签到'&&e.source.id==='m-1'));
  assert.ok(result.entries.some(e=>e.source.type==='log'&&e.source.id==='l-1'));
});
test('回顾输出不读取私人待办，其他项目成员不能作为查询目标',()=>{
  assert.ok(!JSON.stringify(history('u-2')).includes('不可出现在回顾中的私人待办'));
  assert.throws(()=>history('outside-member'),/成员/);
});
test('同名成员按 id 区分，不能以姓名误归入签到和日志',()=>{
  const data=fixture();data.people.push({id:'u-4',name:'乙',role:'成员'});
  data.meetings[0].attendance=[{name:'乙',at:'2026-11-01T01:10:00Z'}];data.meetings[0].checkedIds=[];
  data.meetings[0].checked=['乙'];data.events=[];data.logs[0].authorId=null;
  const result=history('u-4',data);
  assert.equal(result.summary.checkedIn,0);assert.equal(result.summary.logs,0);
});

test('会议标题含签到字样时，正常会议状态活动仍归为会议',()=>{
  const data=fixture();data.meetings[0].title='签到流程培训';
  data.events.push({id:'training-ended',kind:'会议',title:'会议「签到流程培训」已结束',meetingId:'m-1',actorId:'u-1',date:'2026-11-01'});
  const entry=history('u-2',data).entries.find(e=>e.id==='event:training-ended');
  assert.ok(entry,'受邀成员应能回顾该会议的状态活动');
  assert.equal(entry.category,'会议');assert.ok(entry.relations.includes('受邀'));
});

test('会议改主持和受邀名单后，保留旧关系且新成员不继承创建事件',()=>{
  const data=fixture(),m=data.meetings[0];
  const before={hostId:'u-2',host:'乙',organizerId:'u-1',organizer:'甲',attendeeIds:['u-2'],attendees:['乙'],date:m.date,start:m.start,end:m.end};
  const after={...before,hostId:'u-3',host:'丙',attendeeIds:['u-3'],attendees:['丙']};
  Object.assign(m,after,{changes:[{at:'2026-11-02T02:00:00Z',byId:'u-1',by:'甲',before,after}]});
  data.events.push({id:'e-meeting-change',kind:'会议',title:'调整会议「项目讨论」安排',meetingId:m.id,actorId:'u-1',date:'2026-11-02',detail:'甲 · 2026-11-01 09:00'});
  const former=history('u-2',data),current=history('u-3',data);
  assert.equal(former.summary.hosted,1);assert.equal(former.summary.invited,1);
  assert.deepEqual(former.entries.find(e=>e.id==='event:e-meeting').relations,['主持','受邀']);
  assert.ok(former.entries.find(e=>e.id==='event:e-meeting-change').relations.includes('原主持'));
  assert.ok(!current.entries.some(e=>e.id==='event:e-meeting'));
  assert.ok(current.entries.find(e=>e.id==='event:e-meeting-change').relations.includes('新主持'));
  assert.ok(current.entries.find(e=>e.id==='event:e-meeting-change').relations.includes('新增受邀'));
});
