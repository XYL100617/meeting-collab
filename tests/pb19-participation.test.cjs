const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildPersonalHistory}=require('../public/personal-history-model.js');
const {renderPersonalHistoryRows,filterPersonalHistoryEntries}=require('../public/personal-history.js');
function fixture(){return {
  project:{id:'p-19',name:'当前项目',startDate:'2026-01-01'},
  people:[{id:'u-1',name:'甲',role:'组长'},{id:'u-2',name:'乙',role:'成员'}],
  meetings:[{id:'m-1',title:'未来计划',date:'2026-12-10',start:'09:00',end:'10:00',hostId:'u-1',organizerId:'u-1',attendeeIds:['u-1','u-2'],checkedIds:['u-1']}],
  assignments:[{id:'a-1',content:'待跟进',ownerId:'u-1',byId:'u-1'}],
  logs:[{id:'l-1',text:'公开日志',authorId:'u-1',date:'2026-11-08',createdAt:'2026-11-08T01:00:00Z'}],events:[],
  focusMarks:[{scope:'personal',userId:'u-1',targetType:'meeting',targetId:'m-1',stars:3,note:'甲的私人重点'},
    {scope:'personal',userId:'u-2',targetType:'meeting',targetId:'m-1',stars:1,note:'乙的私人重点'},
    {scope:'team',targetType:'assignment',targetId:'a-1',stars:3,note:'全队重点'}],
  todos:[{userId:'u-1',title:'甲的私人待办'}]
}}
test('AC-01 历史未知时间不能补作会议计划日期或项目开始日期',()=>{
  const result=buildPersonalHistory(fixture(),'u-1');
  for(const row of result.entries.filter(e=>e.source?.type!=='log')){
    assert.equal(row.at,'');assert.equal(row.date,'');assert.equal(row.timePrecision,'unknown');
  }
  assert.ok(result.entries.find(e=>e.source?.type==='meeting').details.some(d=>d.value.includes('2026-12-10')));
});
test('AC-01 明确来自其他项目的事件和来源不进入个人回顾',()=>{
  const w=fixture();w.events=[
    {id:'foreign-event',projectId:'other',kind:'会议',actorId:'u-1',title:'其他项目事件',at:'2026-11-08T00:00:00Z'},
    {id:'foreign-source',kind:'会议',actorId:'u-1',title:'其他项目来源',source:{type:'meeting',id:'m-1',projectId:'other'},at:'2026-11-08T00:00:00Z'}];
  const result=JSON.stringify(buildPersonalHistory(w,'u-1'));assert.doesNotMatch(result,/其他项目事件|其他项目来源/);
});
test('AC-01 日志工作日期不能覆盖已记录的发布日期或补作未知时间',()=>{
  const w=fixture();w.logs[0].date='2026-10-31';delete w.logs[0].createdAt;
  w.events=[{id:'log-date',kind:'工作日志',action:'log-created',logId:'l-1',actorId:'u-1',date:'2026-11-08'}];
  const row=buildPersonalHistory(w,'u-1').entries.find(e=>e.category==='日志');
  assert.equal(row.date,'2026-11-08');assert.ok(row.details.some(d=>d.label==='工作日期'&&d.value==='2026-10-31'));
  w.events=[];const unknown=buildPersonalHistory(w,'u-1').entries.find(e=>e.category==='日志');
  assert.equal(unknown.date,'');assert.equal(unknown.timePrecision,'unknown');
});
test('AC-01/02 标准来源和操作人字段可以归集日志且只展示一次',()=>{
  const w=fixture();w.events=[{id:'standard-log',action:'log-created',kind:'工作日志',title:'发布日志',operator:{id:'u-1',name:'甲'},source:{type:'log',id:'l-1',projectId:w.project.id},at:'2026-11-08T01:00:00Z'}];
  const rows=buildPersonalHistory(w,'u-1').entries.filter(e=>e.category==='日志');
  assert.equal(rows.length,1);assert.equal(rows[0].id,'event:standard-log');assert.equal(rows[0].source.id,'l-1');
});
test('AC-02 没有编号的不同旧事件保留独立条目',()=>{
  const w=fixture();w.meetings.push({...w.meetings[0],id:'m-2',title:'另一场会议'});
  w.events=w.meetings.map(m=>({kind:'会议',action:'meeting-created',title:'创建会议 '+m.title,meetingId:m.id,actorId:'u-1',date:'2026-11-08'}));
  const rows=buildPersonalHistory(w,'u-1').entries.filter(e=>e.category==='会议');
  assert.equal(rows.length,2);assert.equal(new Set(rows.map(e=>e.id)).size,2);assert.ok(rows.every(e=>!e.id.includes('undefined')));
});
test('AC-01 日期精度不显示零点，无时区的旧时间按北京时间解释',()=>{
  const w=fixture();w.events=[{id:'dated',kind:'会议',title:'会议更新',meetingId:'m-1',at:'2026-11-08'},
    {id:'clock',kind:'会议',title:'会议结束',meetingId:'m-1',at:'2026-11-09 01:30:00'}];
  const rows=buildPersonalHistory(w,'u-1').entries;
  assert.equal(rows.find(e=>e.id==='event:clock').at,'2026-11-08T17:30:00.000Z');
  assert.equal(rows.find(e=>e.id==='event:clock').date,'2026-11-09');
  const html=renderPersonalHistoryRows([rows.find(e=>e.id==='event:dated')]);
  assert.match(html,/仅记录日期/);assert.doesNotMatch(html,/>00:00</);
});
test('AC-05 本人回顾显示本人个人重点，全队重点不当作个人重点',()=>{
  const w=fixture(),rows=buildPersonalHistory(w,'u-1',{viewerId:'u-1'}).entries;
  const meeting=rows.find(e=>e.source?.type==='meeting'),assignment=rows.find(e=>e.source?.type==='assignment');
  assert.equal(meeting.personalStars,3);assert.equal(meeting.importanceNote,'甲的私人重点');assert.equal(assignment.personalStars,0);
  const html=renderPersonalHistoryRows([meeting],{allowEditFocus:true});
  assert.match(html,/priority-3/);assert.match(html,/甲的私人重点/);assert.match(html,/data-action="edit-history-focus"/);
  assert.equal(filterPersonalHistoryEntries(rows,{stars:'3'}).every(e=>e.personalStars===3),true);
  assert.ok(filterPersonalHistoryEntries(rows,{stars:'3'}).length<rows.length);
});
test('AC-05 查看他人或未指定查看人不输出私人待办和任何个人星级备注',()=>{
  const w=fixture();
  for(const result of [buildPersonalHistory(w,'u-1',{viewerId:'u-2'}),buildPersonalHistory(w,'u-1')]){
    assert.doesNotMatch(JSON.stringify(result),/甲的私人重点|乙的私人重点|甲的私人待办/);
    assert.ok(result.entries.every(e=>!Object.hasOwn(e,'personalStars')));
    assert.doesNotMatch(renderPersonalHistoryRows(result.entries),/edit-history-focus|我的重点/);
  }
});
