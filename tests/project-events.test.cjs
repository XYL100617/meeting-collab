const {test}=require('node:test'),assert=require('node:assert/strict');
let model={};try{model=require('../public/project-events-model.js')}catch(e){if(e.code!=='MODULE_NOT_FOUND')throw e}
const fixture=()=>({project:{id:'p-1',name:'项目'},people:[{id:'u-1',name:'甲'}],meetings:[{id:'m-1',title:'会议'}],files:[{id:'f-1',name:'资料',meetingId:'m-1'}],assignments:[],logs:[],invites:[],events:[]});
test('新事件包含项目、类型、准确时间、操作人、关联对象和摘要',()=>{
  assert.equal(typeof model.createProjectEvent,'function');const e=model.createProjectEvent(fixture(),{id:'u-1',name:'甲'},{id:'e-1',kind:'资料',title:'上传资料',detail:'摘要',fileId:'f-1',meetingId:'m-1'});
  assert.equal(e.projectId,'p-1');assert.equal(e.actorId,'u-1');assert.equal(e.operator.name,'甲');assert.ok(Number.isFinite(Date.parse(e.at)));assert.deepEqual(e.source,{type:'file',id:'f-1',projectId:'p-1'});assert.equal(e.summary,'摘要');
});
test('旧事件不补造历史时间或操作人，跨项目来源不可访问',()=>{
  assert.equal(typeof model.queryProjectEvents,'function');const w=fixture();w.events=[{id:'old',kind:'会议',title:'旧记录',date:'2026-11-01',meetingId:'m-1'},{id:'foreign',kind:'资料',title:'其他项目',source:{type:'file',id:'f-1',projectId:'p-other'}}];
  const old=model.queryProjectEvents(w).items.find(e=>e.id==='old');assert.equal(old.at,null);assert.equal(old.operator.id,null);
  const other=model.queryProjectEvents(w).items.find(e=>e.id==='foreign');assert.equal(other.sourceAvailable,false);assert.equal(w.events[0].at,undefined);
});
test('类型、成员、日期筛选和分页按实际时间稳定排序',()=>{
  const w=fixture();w.events=Array.from({length:25},(_,i)=>({id:`e-${i}`,kind:i%2?'会议':'资料',date:'2026-11-08',at:`2026-11-08T${String(i%12).padStart(2,'0')}:00:00Z`,actorId:'u-1',title:`操作${i}`}));
  const all=model.queryProjectEvents(w,{limit:20});assert.equal(all.total,25);assert.equal(all.hasMore,true);assert.equal(model.queryProjectEvents(w,{offset:20,limit:20}).items.length,5);
  assert.equal(model.queryProjectEvents(w,{kind:'会议',memberId:'u-1',from:'2026-11-08',to:'2026-11-08'}).total,12);
});
test('删除或不存在的来源保持历史记录但禁止跳转',()=>{
  const w=fixture();w.events=[{id:'deleted',kind:'工作日志',date:'2026-11-08',logId:'removed',title:'删除日志'}];
  const e=model.queryProjectEvents(w).items[0];assert.equal(e.sourceAvailable,false);assert.equal(e.source.id,'removed');assert.equal(e.title,'删除日志');
});
