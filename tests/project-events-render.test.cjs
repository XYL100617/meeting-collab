const {test}=require('node:test'),assert=require('node:assert/strict');
const {renderProjectEvents}=require('../public/project-events.js');
test('事件视图转义输入并明确标注旧记录未知时间和失效来源',()=>{
  const html=renderProjectEvents({filters:{},projectName:'<项目>',data:{total:1,kinds:[],members:[],items:[{id:'e',title:'<script>恶意</script>',kind:'会议',date:'2026-01-01',at:null,operator:{name:'未记录'},source:{type:'meeting',id:'m'},sourceAvailable:false,summary:'<摘要>'}]}});
  assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;项目&gt;'));assert.ok(html.includes('精确时间未记录'));assert.ok(html.includes('来源已删除或无权查看'));assert.ok(!html.includes('data-action="project-event-source"'));
});
