const {test}=require('node:test');
const assert=require('node:assert/strict');
let ui={};try{ui=require('../public/project-timeline.js')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}
const {buildProjectTimeline}=require('../public/project-timeline-model.js');
const data=()=>({project:{id:'p-1'},people:[{id:'u-1',name:'甲'}],meetings:[{id:'m-1',title:'<img onerror=alert(1)>',date:'2026-11-08',start:'09:00',summary:'纪要内容',attendeeIds:['u-1'],attendance:[]}],files:[{id:'f-1',meetingId:'m-1',name:'三星文件.txt'}],assignments:[],logs:[],events:[]});
test('会议明细默认折叠，资料、纪要、签到和分工可展开',()=>{
  assert.equal(typeof ui.renderProjectTimelineNodes,'function');
  const html=ui.renderProjectTimelineNodes(buildProjectTimeline(data()).nodes,{projectId:'p-1'});
  assert.match(html,/<details[^>]+data-project-node/);assert.ok(!/<details[^>]+ open/.test(html));
  for(const text of ['会议资料','会议纪要','参会与签到','会后分工','待签到'])assert.ok(html.includes(text),text);
  assert.ok(!html.includes('<img onerror='));assert.ok(html.includes('&lt;img'));
});
test('没有三星内容提供明确提示及查看完整主线入口',()=>{
  assert.equal(typeof ui.renderProjectTimelineHighlights,'function');const html=ui.renderProjectTimelineHighlights([]);
  assert.match(html,/尚无三星重点/);assert.match(html,/data-action="timeline-show-all"/);
});
test('三星文件独立展示上下文和下载来源，节点容器不会误触来源跳转',()=>{
  const timeline=buildProjectTimeline(data(),{marks:[{targetType:'file',targetId:'f-1',scope:'team',stars:3}]});
  const html=ui.renderProjectTimelineHighlights(timeline.highlights,{projectId:'p-1'});
  assert.match(html,/三星文件/);assert.match(html,/所属会议/);assert.match(html,/\/api\/files\/download/);
  assert.ok(!/<(?:article|details)[^>]+data-open-/.test(ui.renderProjectTimelineNodes(timeline.nodes)));
});
