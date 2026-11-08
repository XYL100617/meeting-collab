const projectTimelineEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function projectTimelineBadge(target){return `<span class="project-star-badge stars-${target.stars}">${target.stars?'★'.repeat(target.stars):'无星级'}</span>`}
function projectTimelineRecordTime(target){
  if(!target.date)return '时间未记录';
  const date=projectTimelineEscape(target.date);
  if(target.type==='minutes'&&!target.record.summaryUpdatedAt)return `${date} · 会议日期，纪要更新时间未记录`;
  return `${date}${target.time?` · ${projectTimelineEscape(target.time)}`:' · 精确时间未记录'}`;
}
function projectTimelineSource(target,{projectId=''}={}){
  const e=projectTimelineEscape;
  if(target.type==='file')return `<a class="text-link" href="/api/files/download?id=${encodeURIComponent(target.id)}&projectId=${encodeURIComponent(projectId)}">下载资料 ↗</a>`;
  if(target.type==='event')return target.record.sourceAvailable?`<button class="text-link" data-action="project-event-source" data-id="${e(target.id)}">查看事件来源 →</button>`:`<span class="project-source-unavailable">${target.record.source?'来源已删除或无权查看':'来源未记录'}</span>`;
  const type=target.type==='minutes'?'meeting':target.type;
  return `<button class="text-link" data-action="timeline-source" data-type="${e(type)}" data-id="${e(target.id)}">${type==='meeting'?'查看会议':type==='assignment'?'查看分工':'查看日志'} ↗</button>`;
}
function projectTimelineContext(target){
  const e=projectTimelineEscape;
  if(target.type==='meeting')return '';
  const meeting=target.meetingId?`<span>所属会议：${e(target.meetingTitle)}</span><button class="text-link" data-action="timeline-source" data-type="meeting" data-id="${e(target.meetingId)}">查看上下文</button>`:'';
  const log=target.logId?`<span>所属日志：${e(target.logTitle)}</span><button class="text-link" data-action="timeline-source" data-type="log" data-id="${e(target.logId)}">查看来源日志</button>`:'';
  return meeting+log||`<span>${target.record?.meetingId?'原会议已不存在':target.record?.logId?'原日志已不存在':'未关联会议'} · 项目独立记录</span>`;
}
function renderProjectTimelineHighlights(highlights,options={}){
  const e=projectTimelineEscape;
  if(!highlights.length){const filtered=options.totalHighlights>0&&options.hasFilters;return `<div class="project-focus-empty"><span class="project-empty-star">☆</span><div><b>${filtered?'当前筛选没有三星重点':'尚无三星重点'}</b><p>${filtered?'调整筛选可查看其他三星内容；主线仍保留符合条件的所有星级。':'全部星级的会议、资料、纪要、分工和日志仍可在主线中查看。'}</p>${filtered?'<button class="text-link" data-action="timeline-clear-filters">清除筛选</button> ':''}<button class="button" data-action="timeline-show-all">查看全部主线 →</button></div></div>`;}
  return `<div class="project-focus-grid">${highlights.map(target=>`<article class="project-focus-card" data-highlight-key="${e(target.key)}"><div class="project-focus-label">${projectTimelineBadge(target)}<small>${target.mark?.scope==='personal'?'我的重点':'全队重点'} · ${e(target.kind)}</small></div><h3>${e(target.title)}</h3><div class="project-context">${projectTimelineContext(target)}</div><small class="project-record-time">${projectTimelineRecordTime(target)}</small>${target.mark?.note?`<p>${e(target.mark.note)}</p>`:''}<div class="project-record-actions">${projectTimelineSource(target,options)}${options.focusButton?.(target.type,target.id)||''}</div></article>`).join('')}</div>`;
}
function renderProjectTimelineNodes(nodes,{expandedKeys=new Set(),projectId='',focusButton=()=>'',richContent=(html,text)=>projectTimelineEscape(text),...rest}={}){
  const e=projectTimelineEscape,options={projectId,...rest},source=target=>projectTimelineSource(target,options);
  let matchingKeys=new Set();const matchClass=key=>matchingKeys.has(key)?' is-filter-match':'';
  const eventMeta=activity=>`<span>操作人：${e(activity.record.operator?.name||'未记录')}</span>${activity.record.source?`<span>关联对象：${e(activity.record.sourceName||activity.record.source.id)}</span>`:''}`;
  const activityRow=activity=>`<div class="project-activity${matchClass(activity.key)}" data-activity-key="${e(activity.key)}"><span>${e(activity.kind)}</span><b>${e(activity.title)}</b><small>${e(activity.date||'日期未记录')} ${activity.record.at?e(activity.time):'· 精确时间未记录'}</small>${eventMeta(activity)}<p>${e(activity.record.summary||'摘要未记录')}</p><div class="project-record-actions">${source(activity)}</div></div>`;
  const mini=target=>`<div class="project-child-record priority-${target.stars}${matchClass(target.key)}" data-child-key="${e(target.key)}"><div class="project-child-heading"><b>${e(target.title)}</b>${projectTimelineBadge(target)}</div><small>${e(target.record.owner||target.record.author||target.record.uploadedBy||'')}${target.record.due?` · 计划日 ${e(target.record.due)}`:''}</small>${target.mark?.note?`<p class="project-mark-note">${e(target.mark.note)}</p>`:''}<div class="project-record-actions">${source(target)}${focusButton(target.type,target.id)}</div></div>`;
  const group=(title,items)=>`<section class="project-node-section"><h4>${title} <small>${items.length}</small></h4>${items.map(mini).join('')||'<p class="project-empty-copy">暂无记录</p>'}</section>`;
  let lastDate='';
  return nodes.map(node=>{
    matchingKeys=new Set(node.matchingKeys||[]);
    const day=node.date||'未记录日期',header=day!==lastDate?(lastDate=day,`<div class="project-timeline-day">${e(day)}</div>`):'';
    const starControl=node.type==='event'?'':focusButton(node.type,node.id);
    const heading=`<div class="project-node-heading"><span class="project-kind">${e(node.kind)}</span><h3>${e(node.title)}</h3>${projectTimelineBadge(node)}</div><div class="project-node-meta"><time>${e(node.date||'未记录日期')}${node.time?` · ${e(node.time)}`:''}</time><span>${e(node.timeLabel||'记录时间')}${node.record.status?` · ${e(node.record.status)}`:''}</span>${node.highlightCount?`<span class="project-child-highlight">含 ${node.highlightCount} 项三星重点</span>`:''}${node.matchCount?`<span class="project-match-count">匹配 ${node.matchCount} 条明细</span>`:''}</div><div class="project-record-actions">${source(node)}${starControl}</div>`;
    let body='';
    if(node.type==='meeting'){
      const checked=node.attendance.filter(p=>p.checked).length,invited=node.attendance.filter(p=>p.invited).length;
      body=`<details class="project-node-details" data-project-node="${e(node.key)}" ${expandedKeys.has(node.key)?'open':''}><summary><span class="project-expand-text">展开会议详情</span><span class="project-collapse-text">收起会议详情</span><small>资料 ${node.files.length} · 纪要 ${node.minutes?1:0} · 签到 ${checked} · 分工 ${node.assignments.length}</small></summary><div class="project-node-body"><p class="project-meeting-topic">${e(node.record.topic||'未填写议题')} · ${e(node.record.host||'未记录')} 主持</p>${group('会议资料',node.files)}<section class="project-node-section${matchClass(node.minutes?.key)}" data-child-key="minutes:${e(node.id)}"><h4>会议纪要 ${node.minutes?projectTimelineBadge(node.minutes):''}</h4>${node.minutes?`<div class="rich-readonly project-minutes">${richContent(node.record.summaryHtml,node.record.summary)}</div><div class="project-record-actions">${focusButton('minutes',node.id)}${source(node.minutes)}</div>`:'<p class="project-empty-copy">尚未保存会议纪要</p>'}</section><section class="project-node-section"><h4>参会与签到 <small>应参会 ${invited} 人 · 实际签到 ${checked} 人</small></h4>${node.attendance.map(person=>`<div class="project-attendance${matchClass(`attendance:${person.id}`)}"><b>${e(person.name)}</b><span class="${person.checked?'is-checked':'is-pending'}">${person.checked?`已签到 · ${e(person.method)}`:'待签到'}${!person.invited?' · 名单外签到记录':''}</span>${person.checked&&person.date?`<small>${e(person.date)} ${e(person.time)}</small>`:''}${person.reason?`<p>补签原因：${e(person.reason)}${person.operator?` · 操作人：${e(person.operator)}`:''}</p>`:''}</div>`).join('')||'<p class="project-empty-copy">暂无应参会或签到记录</p>'}</section>${group('会后分工',node.assignments)}${group('关联工作日志',node.logs)}<section class="project-node-section"><h4>会议活动记录 <small>${node.activities.length}</small></h4>${node.activities.map(activityRow).join('')||'<p class="project-empty-copy">暂无活动记录，会议及明细仍保留在主线中。</p>'}</section></div></details>`;
    }else body=`<div class="project-standalone-body">${node.type==='event'?`<div class="project-event-context">${eventMeta(node)}</div><p>${e(node.record.summary||'摘要未记录')}</p>`:`<div class="project-context">${projectTimelineContext(node)}</div>${node.type==='log'?`<p>${e(node.record.text)}</p>`:node.type==='assignment'?`<p>负责人：${e(node.record.owner||'未记录')} · 计划日：${e(node.record.due||'未设置')}</p>`:''}${node.mark?.note?`<p>${e(node.mark.note)}</p>`:''}`}</div>`;
    return `${header}<article class="project-main-node priority-${node.stars}${matchClass(node.key)}" data-node-key="${e(node.key)}">${heading}${body}</article>`;
  }).join('')||'<div class="empty-state">当前筛选下没有主线节点，可清除筛选后查看全部记录。</div>';
}
if(typeof module!=='undefined'&&module.exports)module.exports={renderProjectTimelineHighlights,renderProjectTimelineNodes};
