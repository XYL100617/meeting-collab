const {test}=require('node:test'),assert=require('node:assert/strict');
const model=require('../public/project-timeline-model.js');
const {renderProjectTimelineNodes,renderProjectTimelineHighlights}=require('../public/project-timeline.js');
const fixture=()=>({project:{id:'p-pb18'},people:[{id:'u-1',name:'甲',role:'组长'},{id:'u-2',name:'乙',role:'成员'}],meetings:[{id:'m-1',title:'项目主线会议',date:'2026-11-01',start:'09:00',hostId:'u-1',attendeeIds:['u-1','u-2'],checkedIds:[],summary:'已保存纪要'}],files:[{id:'f-1',name:'重点资料.pdf',meetingId:'m-1',uploaderId:'u-2',uploadedAt:'2026-11-08T02:00:00Z'}],assignments:[],logs:[],events:[]});
const build=w=>model.buildProjectTimeline(w,{userId:'u-1',marks:[{scope:'team',targetType:'file',targetId:'f-1',stars:3}]});
test('AC-01 主线内事件保留操作人、摘要、来源与旧记录未知精确时间',()=>{
  const w=fixture();w.events=[{id:'old',meetingId:'m-1',kind:'会议',title:'旧记录',date:'2026-11-01'},{id:'new',meetingId:'m-1',kind:'资料',title:'上传资料',at:'2026-11-08T02:00:00Z',actorId:'u-2',fileId:'f-1',summary:'完整事件摘要',detail:'旧式摘要'}];
  const node=build(w).nodes[0],old=node.activities.find(e=>e.id==='old');assert.equal(old.time,'');assert.equal(old.record.operator.name,'未记录');
  const html=renderProjectTimelineNodes([node]);assert.ok(html.includes('操作人：乙'));assert.ok(html.includes('完整事件摘要'));assert.ok(html.includes('精确时间未记录'));assert.ok(html.includes('data-action="project-event-source"'));assert.ok(html.includes('data-id="new"'));
});
test('AC-01 仅有日期的 at 不能伪装成零点；主线排除跨项目事件',()=>{
  const w=fixture();w.events=[{id:'date-only',kind:'项目',title:'只有日期',at:'2026-11-08',date:'2026-11-08'},{id:'foreign',projectId:'p-foreign',kind:'项目',title:'外项目事件',at:'2026-11-08T02:00:00Z'}];
  const nodes=build(w).nodes;assert.equal(nodes.find(n=>n.id==='date-only').time,'');assert.ok(!nodes.some(n=>n.id==='foreign'));
});
test('AC-01 只有标准来源字段的分析事件仍归入实际所属会议',()=>{
  const w=fixture();w.files[0].analyses=[{id:'analysis',status:'已完成'}];w.events=[{id:'analysis-event',kind:'AI资料分析',title:'分析完成',actorId:'u-2',at:'2026-11-08T03:00:00Z',source:{type:'file-analysis',id:'analysis',parentId:'f-1',projectId:w.project.id}}];
  const node=build(w).nodes.find(n=>n.id==='m-1');assert.equal(node.activities[0].id,'analysis-event');assert.equal(node.activities[0].record.sourceAvailable,true);
});
test('AC-05 同一记录满足组合条件，并标出匹配的会议子记录',()=>{
  const w=fixture(),nodes=build(w).nodes,filters={kind:'资料',personId:'u-2',from:'2026-11-08',to:'2026-11-08'},filtered=model.filterProjectTimeline(nodes,filters);
  assert.equal(filtered.length,1);assert.deepEqual(filtered[0].matchingKeys,['file:f-1']);assert.equal(filtered[0].matchCount,1);
  assert.equal(model.filterProjectTimeline(nodes,{...filters,personId:'u-1'}).length,0);
  const html=renderProjectTimelineNodes(filtered);assert.ok(html.includes('匹配 1 条明细'));assert.ok(html.includes('is-filter-match'));assert.equal(nodes[0].matchingKeys,undefined);
});
test('AC-03/05 重点卡片按自身记录筛选，不因其他同会议明细被误选',()=>{
  const timeline=build(fixture());assert.equal(typeof model.filterProjectTimelineHighlights,'function');
  assert.equal(model.filterProjectTimelineHighlights(timeline.highlights,{kind:'资料',personId:'u-2',from:'2026-11-08'}).length,1);assert.equal(model.filterProjectTimelineHighlights(timeline.highlights,{kind:'资料',personId:'u-1'}).length,0);
});
test('AC-06 无三星与当前筛选未匹配三星分别提示，均提供查看全部入口',()=>{
  const empty=renderProjectTimelineHighlights([]),filtered=renderProjectTimelineHighlights([],{totalHighlights:2,hasFilters:true});
  assert.ok(empty.includes('尚无三星重点'));assert.ok(filtered.includes('当前筛选没有三星重点'));assert.ok(filtered.includes('timeline-clear-filters'));assert.ok(empty.includes('timeline-show-all'));
});
test('AC-02 有协作活动时不显示空活动提示，无活动时明确提示',()=>{
  const w=fixture();w.events=[{id:'e-1',kind:'会议',title:'实际活动',date:'2026-11-01',meetingId:'m-1'}];
  assert.ok(!renderProjectTimelineNodes(build(w).nodes).includes('暂无活动记录'));
  w.events=[];assert.ok(renderProjectTimelineNodes(build(w).nodes).includes('暂无活动记录'));
});
test('AC-01 文件仅有日期及纪要缺少更新时间时不补造精确时间',()=>{
  const w=fixture();w.files[0].uploadedAt='2026-11-08';const timeline=build(w),file=timeline.highlights[0],minutes=timeline.nodes[0].minutes;
  assert.equal(file.time,'');assert.equal(minutes.time,'');
  assert.ok(renderProjectTimelineHighlights([file]).includes('精确时间未记录'));assert.ok(renderProjectTimelineHighlights([minutes]).includes('纪要更新时间未记录'));
});
test('AC-04 无星级筛选保留显示为无星级的独立事件',()=>{
  const w=fixture();w.events=[{id:'e-1',kind:'项目',title:'项目操作',date:'2026-11-08'}];
  assert.ok(model.filterProjectTimeline(build(w).nodes,{stars:'0'}).some(n=>n.key==='event:e-1'));
});
