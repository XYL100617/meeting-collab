const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'../public/personal-history.js');
const ui=fs.existsSync(file)?require(file):{};
const entries=[{id:'event:1',title:'分工转交',category:'分工',date:'2026-11-02',relations:['原负责人'],details:[{label:'负责人变化',value:'甲 → 乙'}],source:{type:'assignment',id:'a-1',available:true}},{id:'event:2',title:'会议安排',category:'会议',date:'2026-11-01',relations:['受邀'],details:[],source:{type:'meeting',id:'m-1',available:true}}];
test('历史活动按类型和日期筛选',()=>{
  assert.equal(typeof ui.filterPersonalHistoryEntries,'function');
  assert.deepEqual(ui.filterPersonalHistoryEntries(entries,{kind:'分工',from:'2026-11-02',to:'2026-11-02'}).map(e=>e.id),['event:1']);
  assert.deepEqual(ui.filterPersonalHistoryEntries(entries,{kind:'全部',to:'2026-10-31'}),[]);
});
test('历史详情默认折叠，展开后有关系快照和来源访问',()=>{
  assert.equal(typeof ui.renderPersonalHistoryRows,'function');
  const html=ui.renderPersonalHistoryRows(entries,{expandedKeys:new Set(['event:1'])});
  assert.match(html,/原负责人/);assert.match(html,/甲 → 乙/);
  assert.match(html,/data-history-id="event:1"[^>]* open/);
  assert.match(html,/data-action="history-source" data-type="assignment" data-id="a-1"/);
});
test('历史记录转义内容，已删除来源显示不可用提示',()=>{
  assert.equal(typeof ui.renderPersonalHistoryRows,'function');
  const html=ui.renderPersonalHistoryRows([{...entries[0],title:'<script>bad()</script>',details:[{label:'<img>',value:'<img onerror=bad()>'}],source:{type:'log',id:'deleted',available:false}}]);
  assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script/);
  assert.match(html,/原始记录已不可用/);assert.doesNotMatch(html,/data-action="history-source"/);
});
