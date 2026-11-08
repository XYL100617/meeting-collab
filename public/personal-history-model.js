// Only the supplied project's public collaboration records enter this model.
function buildPersonalHistory(workspace, memberId, {viewerId,focusMarks=workspace.focusMarks||[]}={}) {
  const {normalizeProjectEvent}=typeof module!=='undefined'&&module.exports?require('./project-events-model.js'):globalThis.ProjectEventsModel;
  const people=workspace.people||[],member=people.find(p=>p.id===memberId);
  if(!member)throw new Error('成员不属于当前项目。');
  const personId=(id,name)=>{if(id)return id;const matches=people.filter(p=>p.name===name);return matches.length===1?matches[0].id:null};
  const localDay=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(d):String(value||'').slice(0,10)};
  const meetings=workspace.meetings||[],assignments=workspace.assignments||[],logs=workspace.logs||[];
  const events=[...new Map((workspace.events||[]).map((event,i)=>{
    if(event.projectId&&event.projectId!==workspace.project.id||event.source?.projectId&&event.source.projectId!==workspace.project.id)return null;
    const e=normalizeProjectEvent(workspace,event),s=e.source;
    const assignmentId=e.assignmentId||(s?.type==='assignment'?s.id:null),logId=e.logId||(s?.type==='log'?s.id:null);
    const meetingId=e.meetingId||(['meeting','minutes'].includes(s?.type)?s.id:null)||assignments.find(a=>a.id===assignmentId)?.meetingId||logs.find(l=>l.id===logId)?.meetingId;
    const id=e.id||`legacy-${i}`;
    return [id,{...e,id,actorId:e.operator.id,assignmentId,logId,meetingId}];
  }).filter(Boolean)).values()];
  const consumed=new Set(),entries=new Map(),checkedMeetings=new Set(),pastAssignments=new Set();
  const relation=(condition,label)=>condition?label:null;
  const source=(type,id)=>({type,id,available:(type==='meeting'?meetings:type==='assignment'?assignments:logs).some(x=>x.id===id)});
  const add=(id,title,category,at,date,relations,details,record)=>{
    relations=[...new Set(relations.filter(Boolean))];if(!relations.length)return;
    const moment=normalizeProjectEvent(workspace,{at,date}),timePrecision=moment.at?'exact':moment.date?'date':'unknown';
    const row={id,title,category,at:moment.at||moment.date||'',date:moment.date||'',timePrecision,relations,details:details.filter(d=>d.value!==undefined&&d.value!==null&&d.value!=='' ).map(d=>({label:d.label,value:String(d.value)})),source:record||null};
    if(viewerId===memberId){
      const mark=record&&focusMarks.find(m=>m.scope==='personal'&&m.userId===viewerId&&m.targetType===record.type&&m.targetId===record.id);
      row.personalStars=Math.max(0,Math.min(3,Math.trunc(Number(mark?.stars)||0)));row.importanceNote=mark?.note||'';
    }
    if(entries.has(id)){const previous=entries.get(id);previous.relations=[...new Set([...previous.relations,...relations])]}else entries.set(id,row);
  };
  const meetingRoles=m=>[
    relation(personId(m.organizerId,m.organizer)===memberId,'发起'),
    relation(personId(m.hostId,m.host)===memberId,'主持'),
    relation(Array.isArray(m.attendeeIds)?m.attendeeIds.includes(memberId):(m.attendees||[]).some(name=>personId(null,name)===memberId),'受邀'),
  ].filter(Boolean);
  const meetingChanges=m=>[...(m.changes||[])].sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  const meetingSnapshot=(m,snapshot)=>{
    const value={...m,...snapshot};
    if(snapshot&&Object.hasOwn(snapshot,'attendees')&&!Object.hasOwn(snapshot,'attendeeIds'))delete value.attendeeIds;
    if(snapshot&&Object.hasOwn(snapshot,'host')&&!Object.hasOwn(snapshot,'hostId'))delete value.hostId;
    return value;
  };
  const meetingAtEvent=(m,event)=>{
    const changes=meetingChanges(m);let value=meetingSnapshot(m,changes[0]?.before);
    for(const change of changes){
      const included=event.at?Date.parse(change.at)<=Date.parse(event.at):localDay(change.at)<event.date;
      if(included)value=meetingSnapshot(m,change.after);
    }
    return value;
  };
  const historicMeetingRoles=m=>[...new Set([m,...meetingChanges(m).flatMap(h=>[meetingSnapshot(m,h.before),meetingSnapshot(m,h.after)])].flatMap(meetingRoles))];
  const meetingDetails=m=>[{label:'计划时间',value:`${m.date||''} ${m.start||''} — ${m.end||''}`},{label:'会议状态',value:m.status},{label:'主持人',value:m.host},{label:'发起人',value:m.organizer},{label:'议题',value:m.topic},{label:'地点 / 链接',value:m.location}];
  const isCheck=e=>{
    if(e.action)return e.action==='meeting-checkin'||e.action==='meeting-supplement';
    if(e.logId||e.assignmentId)return false;
    return /^.+ 完成(?:会议)?签到$|^为.+补签$|^组长补录签到$/.test(e.title||'');
  };
  const checkSubject=e=>{
    if(e.personId)return e.personId;
    if(e.action==='meeting-checkin')return e.actorId;
    const matches=people.filter(p=>[`${p.name} 完成会议签到`,`${p.name} 完成签到`,`为${p.name}补签`].includes(e.title));
    return matches.length===1?matches[0].id:null;
  };
  for(const m of meetings){
    const changes=meetingChanges(m),initial=meetingSnapshot(m,changes[0]?.before),roles=meetingRoles(initial);
    const created=events.find(e=>e.meetingId===m.id&&!e.assignmentId&&!e.logId&&(e.action==='meeting-created'||/创建.*会议/.test(e.title||'')));
    if(created)consumed.add(created);
    add(created?`event:${created.id}`:`meeting:${m.id}`,`会议安排：${initial.title}`,'会议',created?.at||m.createdAt,created?.date,roles,meetingDetails(initial),source('meeting',m.id));
    for(const change of changes){
      const before=meetingSnapshot(m,change.before),after=meetingSnapshot(m,change.after),oldRoles=meetingRoles(before),newRoles=meetingRoles(after);
      const event=events.find(e=>!consumed.has(e)&&e.meetingId===m.id&&!e.assignmentId&&!e.logId&&(e.action==='meeting-updated'||/调整会议.*安排/.test(e.title||''))&&(e.id===change.eventId||e.at&&e.at===change.at||!e.at&&e.date===localDay(change.at)&&String(e.detail||'').includes(`${after.date} ${after.start}`)));
      if(event)consumed.add(event);
      const relations=[relation(personId(change.byId,change.by)===memberId,'调整会议'),relation(oldRoles.includes('发起')||newRoles.includes('发起'),'发起'),relation(oldRoles.includes('主持')&&newRoles.includes('主持'),'主持'),relation(oldRoles.includes('主持')&&!newRoles.includes('主持'),'原主持'),relation(!oldRoles.includes('主持')&&newRoles.includes('主持'),'新主持'),relation(oldRoles.includes('受邀')&&newRoles.includes('受邀'),'受邀'),relation(oldRoles.includes('受邀')&&!newRoles.includes('受邀'),'取消受邀'),relation(!oldRoles.includes('受邀')&&newRoles.includes('受邀'),'新增受邀')];
      add(event?`event:${event.id}`:`meeting-change:${m.id}:${change.at}`,`调整会议：${after.title}`,'会议',change.at,event?.date||localDay(change.at),relations,[{label:'主持人变化',value:`${before.host||'未记录'} → ${after.host||'未记录'}`},{label:'受邀名单变化',value:`${(before.attendees||[]).join('、')||'未记录'} → ${(after.attendees||[]).join('、')||'未记录'}`},{label:'计划时间变化',value:`${before.date} ${before.start} → ${after.date} ${after.start}`},{label:'调整人',value:change.by}],source('meeting',m.id));
    }
    const attendance=(m.attendance||[]).find(a=>personId(a.personId,a.name)===memberId);
    const checkEvents=events.filter(e=>e.meetingId===m.id&&isCheck(e)&&checkSubject(e)===memberId);
    const legacyChecked=Array.isArray(m.checkedIds)?m.checkedIds.includes(memberId):(m.checked||[]).some(name=>personId(null,name)===memberId);
    if(attendance||legacyChecked||checkEvents.length){
      checkedMeetings.add(m.id);const event=checkEvents[0];checkEvents.forEach(e=>consumed.add(e));
      const method=attendance?.method||(/补签/.test(event?.title||'')?'补签':attendance?'本人签到':'历史签到标记');
      add(event?`event:${event.id}`:`checkin:${m.id}:${memberId}`,`${method.includes('补签')?'补签记录':'实际签到'}：${m.title}`,'签到',attendance?.at||event?.at,event?.date,['实际签到',relation(method.includes('补签'),'补签')],[{label:'签到方式',value:method},{label:'签到时间',value:attendance?.at||event?.at||'旧记录未保存具体时间'},{label:'操作人',value:attendance?.operator},{label:'补签原因',value:attendance?.reason}],source('meeting',m.id));
    }
  }
  for(const assignment of assignments){
    const changes=[...(assignment.changeHistory||[])].sort((a,b)=>String(a.at).localeCompare(String(b.at)));
    const initial=changes[0]?.before||assignment,initialOwner=personId(initial.ownerId,initial.owner),currentOwner=personId(assignment.ownerId,assignment.owner);
    if(initialOwner===memberId||changes.some(h=>personId(h.before?.ownerId,h.before?.owner)===memberId||personId(h.after?.ownerId,h.after?.owner)===memberId))pastAssignments.add(assignment.id);
    const created=events.find(e=>e.assignmentId===assignment.id&&(e.action==='assignment-created'||/新增.*工作分配|新增.*分工/.test(e.title||'')));
    if(created)consumed.add(created);
    add(created?`event:${created.id}`:`assignment:${assignment.id}`,`分工分配：${initial.content||assignment.content}`,'分工',created?.at||assignment.createdAt,created?.date,[relation(personId(assignment.byId,assignment.by)===memberId,'分配'),relation(initialOwner===memberId,changes.length?'初始负责人':'负责人')],[{label:'初始负责人',value:initial.owner},{label:'当前负责人',value:assignment.owner},{label:'分配人',value:assignment.by},{label:'计划完成',value:initial.due},{label:'分工说明',value:initial.note}],source('assignment',assignment.id));
    for(const change of changes){
      const before=change.before||{},after=change.after||{},oldOwner=personId(before.ownerId,before.owner),newOwner=personId(after.ownerId,after.owner);
      const event=events.find(e=>!consumed.has(e)&&e.assignmentId===assignment.id&&(e.action==='assignment-updated'||/调整.*工作分配|调整.*分工/.test(e.title||''))&&(e.id===change.eventId||e.at&&e.at===change.at||!e.at&&e.date===localDay(change.at)&&String(e.detail||'').includes(`${before.owner} → ${after.owner}`)));
      if(event)consumed.add(event);
      const relations=[relation(personId(change.byId,change.by)===memberId,'调整'),...(oldOwner===newOwner?[relation(oldOwner===memberId,'负责人')]:[relation(oldOwner===memberId,'原负责人'),relation(newOwner===memberId,'新负责人')])];
      add(event?`event:${event.id}`:`assignment-change:${assignment.id}:${change.at}`,`调整分工：${after.content||before.content||assignment.content}`,'分工',change.at,event?.date||localDay(change.at),relations,[{label:'负责人变化',value:`${before.owner||'未记录'} → ${after.owner||'未记录'}`},{label:'计划完成变化',value:`${before.due||'未设置'} → ${after.due||'未设置'}`},{label:'工作内容变化',value:`${before.content||'未记录'} → ${after.content||'未记录'}`},{label:'调整人',value:change.by},{label:'调整时备注',value:after.note}],source('assignment',assignment.id));
    }
    if(currentOwner===memberId)pastAssignments.add(assignment.id);
  }
  for(const log of logs){
    const created=events.find(e=>e.logId===log.id&&(e.action==='log-created'||/发布/.test(e.title||'')));
    if(created)consumed.add(created);
    add(created?`event:${created.id}`:`log:${log.id}`,'发布工作日志','日志',created?.at||log.createdAt,created?.date,[relation(personId(log.authorId,log.author)===memberId,'日志作者')],[{label:'工作日期',value:log.date},{label:'日志内容',value:log.text},{label:'关联会议',value:meetings.find(m=>m.id===log.meetingId)?.title},{label:'关联分工',value:log.link}],source('log',log.id));
  }
  for(const event of events){
    if(consumed.has(event))continue;
    const actor=personId(event.actorId,event.actor||event.by),direct=actor===memberId;
    let category,relations=[],record=null,details=[{label:'活动说明',value:event.detail}];
    if(isCheck(event)){
      category='签到';const subject=checkSubject(event),m=meetings.find(m=>m.id===event.meetingId),attendance=m?.attendance?.find(a=>personId(a.personId,a.name)===subject);
      relations=[relation(subject===memberId,'实际签到'),relation(direct&&subject!==memberId,/补签/.test(event.title||'')?'补签操作':'签到操作')];
      details.push({label:'签到成员',value:people.find(p=>p.id===subject)?.name},{label:'签到方式',value:attendance?.method},{label:'补签原因',value:attendance?.reason});
      if(m)record=source('meeting',m.id);
    }else if(event.logId||event.kind==='工作日志'){
      category='日志';const log=logs.find(l=>l.id===event.logId);
      relations=[relation(direct,'日志操作'),relation(log&&personId(log.authorId,log.author)===memberId,'日志作者')];
      if(event.logId)record=source('log',event.logId);
    }else if(event.assignmentId||event.kind==='工作分配'){
      category='分工';relations=[relation(direct,'分工操作'),relation(event.assignedToId===memberId,'负责人（当时）'),relation(event.before?.ownerId===memberId,'原负责人'),relation(event.after?.ownerId===memberId,'新负责人')];
      if(event.assignmentId)record=source('assignment',event.assignmentId);
    }else if(event.kind==='会议'){
      category='会议';const m=meetings.find(m=>m.id===event.meetingId);
      const snapshot=m&&meetingAtEvent(m,event);
      relations=snapshot?meetingRoles(snapshot):[];if(direct&&!relations.length)relations.push('会议操作');
      if(m){record=source('meeting',m.id);details.push(...meetingDetails(snapshot))}
    }else continue;
    add(`event:${event.id}`,event.title,category,event.at,event.date,relations,details,record);
  }
  const currentAssignments=assignments.filter(a=>personId(a.ownerId,a.owner)===memberId);
  return {
    project:{id:workspace.project.id,name:workspace.project.name,status:workspace.project.status},
    member:{id:member.id,name:member.name,role:member.role,joined:member.joined||''},
    summary:{initiated:meetings.filter(m=>historicMeetingRoles(m).includes('发起')).length,hosted:meetings.filter(m=>historicMeetingRoles(m).includes('主持')).length,invited:meetings.filter(m=>historicMeetingRoles(m).includes('受邀')).length,checkedIn:checkedMeetings.size,currentAssignments:currentAssignments.length,historicalAssignments:[...pastAssignments].filter(id=>!currentAssignments.some(a=>a.id===id)).length,logs:logs.filter(l=>personId(l.authorId,l.author)===memberId).length},
    entries:[...entries.values()].sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0)||b.id.localeCompare(a.id)),
  };
}
if(typeof module!=='undefined'&&module.exports)module.exports={buildPersonalHistory};
