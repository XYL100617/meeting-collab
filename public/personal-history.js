function filterPersonalHistoryEntries(entries,{kind='全部',from='',to='',stars='all'}={}) {
  return entries.filter(entry=>(kind==='全部'||entry.category===kind)&&(!from||entry.date>=from)&&(!to||entry.date<=to)&&(stars==='all'||entry.personalStars===Number(stars)));
}
function renderPersonalHistoryRows(entries,{expandedKeys=new Set(),allowEditFocus=false}={}) {
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icons={'会议':'◷','签到':'✓','分工':'☷','日志':'▤'};
  let lastDay=null;
  return entries.map(entry=>{
    const header=entry.date!==lastDay?(lastDay=entry.date,`<div class="history-day">${escape(entry.date||'发生时间未记录')}</div>`):'';
    const exact=entry.timePrecision!=='date'&&entry.at&&/[T ]\d{2}:\d{2}/.test(entry.at)&&Number.isFinite(Date.parse(entry.at));
    const time=exact?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(entry.at)):entry.date?'仅记录日期':'时间未记录';
    const own=Object.hasOwn(entry,'personalStars'),stars=own?Math.max(0,Math.min(3,Math.trunc(Number(entry.personalStars)||0))):0;
    const focusBadge=own?`<span class="history-focus-badge">${stars?`${'★'.repeat(stars)} 我的重点`:'未设置个人星级'}</span>`:'';
    const focusNote=own&&entry.importanceNote?`<p class="history-focus-note"><b>个人重点备注 · 仅本人可见</b>${escape(entry.importanceNote)}</p>`:'';
    const editFocus=allowEditFocus&&own&&entry.source?.available?`<button class="text-link" data-action="edit-history-focus" data-type="${escape(entry.source.type)}" data-id="${escape(entry.source.id)}">${stars?'调整个人星级':'设置个人星级'} →</button>`:'';
    return `${header}<details class="history-record${own?` priority-${stars}`:''}" data-history-id="${escape(entry.id)}"${expandedKeys.has(entry.id)?' open':''}><summary><span class="history-icon" aria-hidden="true">${icons[entry.category]||'·'}</span><div class="history-record-main"><div class="history-record-title"><b>${escape(entry.title)}</b><span class="history-category">${escape(entry.category)}</span>${focusBadge}</div><div class="history-relations">${entry.relations.map(r=>`<span class="history-relation${r==='实际签到'?' actual-checkin':''}${r==='原负责人'?' former-owner':''}">${escape(r)}</span>`).join('')}</div></div><time class="history-record-time${exact?'':' unknown-time'}">${escape(time)}</time><span class="history-expand" aria-hidden="true">⌄</span></summary><div class="history-record-body"><dl>${entry.details.map(detail=>`<div><dt>${escape(detail.label)}</dt><dd>${escape(detail.value)}</dd></div>`).join('')}</dl>${focusNote}<div class="history-record-actions">${entry.source?.available?`<button class="text-link history-source" data-action="history-source" data-type="${escape(entry.source.type)}" data-id="${escape(entry.source.id)}">打开原始${entry.source.type==='meeting'?'会议':entry.source.type==='assignment'?'分工':'日志'} →</button>`:entry.source?'<small class="subtle">原始记录已不可用，历史事件仍保留。</small>':'<small class="subtle">此历史活动未记录可访问的来源。</small>'}${editFocus}</div></div></details>`;
  }).join('')||'<div class="empty-state">此成员在当前筛选范围内没有历史活动。可调整类型或日期条件。</div>';
}
if(typeof module!=='undefined'&&module.exports)module.exports={filterPersonalHistoryEntries,renderPersonalHistoryRows};
