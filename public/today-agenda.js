// Personal daily plans are distinct from the project's historical activity feed.
function buildTodayAgenda(todos, meetings, {date, userId, projectId, showCompleted=true}) {
  const stars=value=>Math.max(0,Math.min(3,Math.trunc(Number(value)||0)));
  const ownTodos=todos.filter(t=>t.userId===userId&&t.date===date);
  const visibleTodos=ownTodos.filter(t=>showCompleted||t.status!=='已完成');
  const key=item=>`${item.kind}:${item.projectId||''}:${item.id}:${date}`;
  const actions=visibleTodos.map(t=>{const item={...t,kind:'todo',stars:stars(t.stars)};return {...item,key:key(item)}});
  const agendaMeetings=meetings.filter(m=>m.date===date&&(!projectId||m.projectId===projectId)).map(m=>{
    const item={...m,kind:'meeting',stars:stars(m.personalStars)};
    return {...item,key:key(item)};
  });
  const stableOrder=(a,b)=>(a.kind===b.kind?0:a.kind==='meeting'?-1:1)||String(a.projectId||'').localeCompare(String(b.projectId||''))||String(a.createdAt||'').localeCompare(String(b.createdAt||''))||String(a.id).localeCompare(String(b.id));
  const scheduled=[...agendaMeetings,...actions.filter(t=>t.start)].sort((a,b)=>(a.start||'99:99').localeCompare(b.start||'99:99')||stableOrder(a,b));
  const unscheduled=actions.filter(t=>!t.start).sort((a,b)=>b.stars-a.stars||stableOrder(a,b));
  return {scheduled,unscheduled,todoCount:ownTodos.length,meetingCount:agendaMeetings.filter(m=>m.status!=='已取消').length,cancelledCount:agendaMeetings.filter(m=>m.status==='已取消').length,completedCount:ownTodos.filter(t=>t.status==='已完成').length};
}

function renderTodayAgendaItem(item, {expanded=false, detailKey=item.key||item.id, contextHtml=''}={}) {
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isMeeting=item.kind==='meeting',completed=!isMeeting&&item.status==='已完成',cancelled=isMeeting&&item.status==='已取消';
  const stars=Math.max(0,Math.min(3,Number(item.stars)||0));
  const starLabel=stars?`${'★'.repeat(stars)}${'☆'.repeat(3-stars)} · ${['','一般关注','重要参考','优先关注'][stars]}`:'☆ 设置个人关注';
  const markAction=isMeeting?'edit-agenda-meeting-mark':'edit-todo-mark';
  const completionTime=item.completedAt?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(item.completedAt)):'';
  const details=isMeeting?
    `<p>${escape(item.topic||'暂无议题。')}</p><dl class="schedule-info"><div><dt>所属项目</dt><dd>${escape(item.projectName)}</dd></div><div><dt>主持人</dt><dd>${escape(item.host||'未填写')}</dd></div><div><dt>${item.format==='线上'?'线上链接':'地点'}</dt><dd>${escape(item.location||'未填写')}</dd></div>${cancelled?`<div class="schedule-cancel-reason"><dt>取消原因</dt><dd>${escape(item.cancelReason||'未填写')}</dd></div>`:''}${item.importanceNote?`<div><dt>个人重点备注</dt><dd>${escape(item.importanceNote)}</dd></div>`:''}</dl><div class="schedule-actions"><button class="text-link" data-action="agenda-open-meeting" data-project="${escape(item.projectId)}" data-meeting="${escape(item.id)}">查看会议 →</button></div>`:
    `<p>${escape(item.description||'没有补充说明。')}</p>${item.importanceNote?`<p>重点备注：${escape(item.importanceNote)}</p>`:''}${contextHtml?`<p>${contextHtml}</p>`:''}${completed&&completionTime?`<p>完成时间：${escape(completionTime)}</p>`:''}<div class="schedule-actions"><button class="text-link" data-action="todo-edit" data-id="${escape(item.id)}">编辑待办</button><button class="text-link danger-link" data-action="todo-delete" data-id="${escape(item.id)}">删除</button></div>`;
  return `<article class="schedule-item ${isMeeting?'meeting-agenda':'todo-agenda'} priority-${stars}${completed?' completed':''}${cancelled?' cancelled':''}${!item.start?' unscheduled-item':''}" data-schedule-id="${escape(item.id)}" data-schedule-kind="${item.kind}">
    ${item.start?`<time class="schedule-time">${escape(item.start)}<small>${escape(item.end||'')}</small></time><span class="schedule-node" aria-hidden="true"></span>`:''}
    <div class="schedule-card"><div class="schedule-card-heading"><div class="schedule-title"><span class="agenda-type${isMeeting?'':' todo'}">${isMeeting?(item.isParticipant===false?'项目会议':'应参会会议'):'私人待办'}</span><b>${escape(item.title)}</b></div><span class="schedule-status${completed?' is-complete':''}${cancelled?' is-cancelled':''}">${completed?'✓ 已完成':escape(item.status||'未完成')}</span></div>
      <div class="schedule-meta"><button class="schedule-stars" data-action="${markAction}" data-id="${escape(item.id)}" data-project="${escape(item.projectId||'')}" title="个人星级仅本人可见">${starLabel}</button>${isMeeting?`<small>${escape(item.projectName)} · ${escape(item.host||'未填写')} 主持${item.isParticipant===false?' · 未列入应参会名单':''}</small>`:'<small>仅本人可见</small>'}${!isMeeting?`<button class="button small schedule-complete" data-action="todo-toggle" data-id="${escape(item.id)}" data-status="${completed?'未完成':'已完成'}">${completed?'重新打开':'完成'}</button>`:''}</div>
      <details class="schedule-details" data-agenda-key="${escape(detailKey)}"${expanded?' open':''}><summary><span class="detail-expand-label">展开详情</span><span class="detail-collapse-label">收起详情</span></summary><div class="schedule-detail-body">${details}</div></details>
    </div></article>`;
}

if(typeof module!=='undefined'&&module.exports)module.exports={buildTodayAgenda,renderTodayAgendaItem};
