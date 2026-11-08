const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const componentPath = path.join(__dirname, '../public/today-agenda.js');
const component = fs.existsSync(componentPath) ? require(componentPath) : {};
const date = '2026-11-08';
const options = {date, userId:'u-1', showCompleted:true};
const todo = (id, start='', extra={}) => ({id, userId:'u-1', date, title:id, start, end:start?'18:00':'', status:'未完成', stars:0, createdAt:'2026-11-01T00:00:00Z', ...extra});
const meeting = (id, start, extra={}) => ({id, projectId:'p-1', date, title:id, start, end:'18:00', status:'待召开', personalStars:0, ...extra});
function build(todos, meetings, opts=options) {
  assert.equal(typeof component.buildTodayAgenda, 'function', '今日安排需要独立且可验证的排序与分组组件');
  return component.buildTodayAgenda(todos, meetings, opts);
}

test('有时间待办和会议合并后按计划开始时间升序', () => {
  const result=build([todo('late','16:00'),todo('early','08:00')],[meeting('meeting','10:00')]);
  assert.deepEqual(result.scheduled.map(x=>x.id), ['early','meeting','late']);
});
test('同一时间会议与待办排序稳定，不因响应顺序改变', () => {
  const todos=[todo('b','09:00'),todo('a','09:00')], meetings=[meeting('m-b','09:00'),meeting('m-a','09:00')];
  assert.deepEqual(build(todos,meetings).scheduled.map(x=>x.id),build([...todos].reverse(),[...meetings].reverse()).scheduled.map(x=>x.id));
});
test('无时间待办独立归组，按个人星级排序', () => {
  const result=build([todo('plain'),todo('priority','',{stars:3}),todo('timed','10:00')],[]);
  assert.deepEqual(result.unscheduled.map(x=>x.id),['priority','plain']);
  assert.deepEqual(result.scheduled.map(x=>x.id),['timed']);
});
test('默认保留已完成待办与取消会议，未完成筛选仍保留取消标识', () => {
  const todos=[todo('done','08:00',{status:'已完成'}),todo('pending','09:00')];
  const meetings=[meeting('cancelled','10:00',{status:'已取消'})];
  assert.equal(build(todos,meetings).scheduled.length,3);
  assert.deepEqual(build(todos,meetings,{...options,showCompleted:false}).scheduled.map(x=>x.id),['pending','cancelled']);
});
test('只包含指定日期与当前账号的私人待办', () => {
  const result=build([todo('mine','08:00'),todo('other','09:00',{userId:'u-2'}),todo('yesterday','10:00',{date:'2026-11-07'})],[meeting('old-meeting','11:00',{date:'2026-11-07'})]);
  assert.deepEqual(result.scheduled.map(x=>x.id),['mine']);
});
test('会议使用个人星级，不使用全队星级', () => {
  const result=build([],[meeting('mine','09:00',{personalStars:3,stars:1}),meeting('team','10:00',{personalStars:0,stars:3})]);
  assert.deepEqual(result.scheduled.map(x=>x.stars),[3,0]);
});

test('指定当前项目时，主线与会议计数不混入其他项目',()=>{
  const result=build([],[meeting('current','09:00'),meeting('other','10:00',{projectId:'p-2'})],{...options,projectId:'p-1'});
  assert.deepEqual(result.scheduled.map(m=>m.id),['current']);assert.equal(result.meetingCount,1);
});
test('详情可折叠，完成和取消状态明确显示，标题和说明转义', () => {
  assert.equal(typeof component.renderTodayAgendaItem,'function','时间轴需要可折叠的事项详情');
  const done={...todo('done','09:00',{status:'已完成',title:'<img onerror=alert(1)>',description:'<script>bad()</script>',stars:3}),kind:'todo'};
  const html=component.renderTodayAgendaItem(done,{expanded:true});
  assert.match(html,/已完成/);
  assert.match(html,/priority-3/);
  assert.match(html,/<details[^>]* open/);
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<script>/);
  const cancelled=component.renderTodayAgendaItem({...meeting('cancelled','10:00',{status:'已取消',cancelReason:'天气预警'}),kind:'meeting',stars:0});
  assert.match(cancelled,/已取消/);
  assert.match(cancelled,/天气预警/);
  assert.match(cancelled,/取消原因/);
});
