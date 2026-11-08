const projectTimelineEvents=typeof module!=='undefined'&&module.exports?require('./project-events-model.js'):globalThis.ProjectEventsModel;
function projectTimelineMoment(value,day='',clock='') {
  let text=String(value||'');
  let timeKnown=/^\d{2}:\d{2}$/.test(text)||/[ T]\d{2}:\d{2}/.test(text)||!text&&/^\d{2}:\d{2}$/.test(clock);
  if(/^\d{2}:\d{2}$/.test(text)&&/^\d{4}-\d{2}-\d{2}$/.test(day))text=`${day}T${text}:00+08:00`;
  if(!text&&/^\d{4}-\d{2}-\d{2}$/.test(day))text=`${day}T${/^\d{2}:\d{2}$/.test(clock)?clock:'00:00'}:00+08:00`;
  if(/^\d{4}-\d{2}-\d{2}$/.test(text))text+='T00:00:00+08:00';
  else if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text))text=text.replace(' ','T')+'+08:00';
  let timestamp=Date.parse(text);
  if(!Number.isFinite(timestamp)&&/^\d{4}-\d{2}-\d{2}$/.test(day)){timestamp=Date.parse(`${day}T${/^\d{2}:\d{2}$/.test(clock)?clock:'00:00'}:00+08:00`);timeKnown=/^\d{2}:\d{2}$/.test(clock)}
  if(!Number.isFinite(timestamp))return {timestamp:0,date:'',time:''};
  const date=new Date(timestamp);
  return {timestamp,date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date),time:timeKnown?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(date):''};
}

function buildProjectTimeline(workspace,{marks=[],userId='',scope='mine'}={}) {
  const people=workspace.people||[],meetings=workspace.meetings||[],assignments=workspace.assignments||[],logs=workspace.logs||[];
  const meetingById=new Map(meetings.map(m=>[m.id,m])),assignmentById=new Map(assignments.map(a=>[a.id,a])),logById=new Map(logs.map(l=>[l.id,l]));
  const personId=(id,name)=>{if(id)return id;const found=people.filter(p=>p.name===name);return found.length===1?found[0].id:null};
  const legacyMeeting=name=>{const found=meetings.filter(m=>m.title===name);return found.length===1?found[0]:null};
  const assignmentMeeting=a=>a?.meetingId?meetingById.get(a.meetingId):legacyMeeting(a?.meeting);
  const logMeeting=l=>{const matches=assignments.filter(a=>a.content===l?.link);return l?.meetingId?meetingById.get(l.meetingId):assignmentMeeting(l?.linkAssignmentId?assignmentById.get(l.linkAssignmentId):matches.length===1?matches[0]:null)||legacyMeeting(l?.meeting)};
  const fileMeeting=f=>f.meetingId?meetingById.get(f.meetingId):logMeeting(logById.get(f.logId));
  const ids=(...values)=>[...new Set(values.flat().filter(Boolean))];
  const order=(a,b)=>b.timestamp-a.timestamp||a.key.localeCompare(b.key);
  const markFor=(type,id)=>{
    const team=marks.find(m=>m.targetType===type&&m.targetId===id&&m.scope==='team');
    const own=marks.find(m=>m.targetType===type&&m.targetId===id&&m.scope==='personal'&&m.userId===userId);
    return scope==='team'?team:own||team;
  };
  const decorate=(type,record,title,kind,moment,meeting,personIds=[])=>{
    const mark=markFor(type,record.id),stars=Number(mark?.stars);
    const log=type==='file'?logById.get(record.logId):null;
    return {key:`${type}:${record.id}`,id:record.id,type,kind,title,record,...moment,stars:Number.isInteger(stars)&&stars>=0&&stars<=3?stars:0,mark:mark?{scope:mark.scope,note:mark.note||''}:null,
      meetingId:meeting?.id||'',meetingTitle:meeting?.title||'',logId:log?.id||'',logTitle:log?`${log.author||'历史成员'} · ${log.date||'未记录日期'} 工作日志`:'',personIds};
  };
  const targets=[],nodes=[],meetingNodes=new Map();
  for(const meeting of meetings){
    const invitations=Array.isArray(meeting.attendeeIds)?meeting.attendeeIds:(meeting.attendees||[]).map(name=>personId(null,name)).filter(Boolean);
    const records=meeting.attendance||[],checkedIds=Array.isArray(meeting.checkedIds)?meeting.checkedIds:(meeting.checked||[]).map(name=>personId(null,name)).filter(Boolean);
    const attendanceIds=ids(invitations,checkedIds,records.map(r=>personId(r.personId,r.name)));
    const attendance=attendanceIds.map(id=>{
      const person=people.find(p=>p.id===id),check=records.find(r=>personId(r.personId,r.name)===id);
      return {id,name:person?.name||check?.name||'历史成员',invited:invitations.includes(id),checked:!!check||checkedIds.includes(id),method:check?.method||'历史签到',reason:check?.reason||'',operator:check?.operator||'',...projectTimelineMoment(check?.at)};
    });
    const moment=projectTimelineMoment(meeting.actualStart,meeting.date,meeting.start),node=decorate('meeting',meeting,meeting.title,'会议',moment,meeting,ids(personId(meeting.hostId,meeting.host),personId(meeting.organizerId,meeting.organizer),attendanceIds));
    Object.assign(node,{timeLabel:meeting.actualStart?'实际开始':'计划开始',files:[],assignments:[],logs:[],activities:[],attendance,minutes:null});
    if(String(meeting.summary||'').trim()||String(meeting.summaryHtml||'').includes('<img')){
      node.minutes=decorate('minutes',meeting,`${meeting.title} 会议纪要`,'纪要',projectTimelineMoment(meeting.summaryUpdatedAt,meeting.date),meeting,ids(personId(meeting.summaryUpdatedById,meeting.summaryUpdatedBy),personId(meeting.hostId,meeting.host)));
      targets.push(node.minutes);
    }
    nodes.push(node);targets.push(node);meetingNodes.set(meeting.id,node);
  }
  const add=(target,group)=>{targets.push(target);const meetingNode=meetingNodes.get(target.meetingId);if(meetingNode)meetingNode[group].push(target);else nodes.push(target)};
  for(const file of workspace.files||[]){
    if(['正文图片','会议录音'].includes(file.kind))continue;
    add(decorate('file',file,file.name,'资料',projectTimelineMoment(file.uploadedAt),fileMeeting(file),ids(personId(file.uploaderId||file.uploadedById,file.uploadedBy))),'files');
  }
  for(const assignment of assignments)add(decorate('assignment',assignment,assignment.content,'工作分配',projectTimelineMoment(assignment.createdAt),assignmentMeeting(assignment),ids(personId(assignment.ownerId,assignment.owner),personId(assignment.byId,assignment.by))),'assignments');
  for(const log of logs)add(decorate('log',log,String(log.text||'工作日志').slice(0,100),'工作日志',projectTimelineMoment(log.createdAt,log.date,log.time),logMeeting(log),ids(personId(log.authorId,log.author))),'logs');
  const events=[...new Map((workspace.events||[]).filter(event=>!event.projectId||event.projectId===workspace.project.id).map((event,i)=>[event.id||`legacy-${i}`,{...projectTimelineEvents.normalizeProjectEvent(workspace,event,{id:userId}),id:event.id||`legacy-${i}`}])).values()];
  for(const event of events){
    const source=event.source?.projectId===workspace.project.id?event.source:null;
    const sourceMeeting=source?['meeting','minutes'].includes(source.type)?meetingById.get(source.id):source.type==='assignment'?assignmentMeeting(assignmentById.get(source.id)):source.type==='log'?logMeeting(logById.get(source.id)):['file','audio','file-analysis','audio-analysis','transcript'].includes(source.type)?fileMeeting((workspace.files||[]).find(f=>f.id===(source.parentId||source.id))||{}):source.type==='meeting-analysis'?meetingById.get(source.parentId):null:null;
    const meeting=sourceMeeting||(event.meetingId?meetingById.get(event.meetingId):event.assignmentId?assignmentMeeting(assignmentById.get(event.assignmentId)):event.logId?logMeeting(logById.get(event.logId)):event.fileId?fileMeeting((workspace.files||[]).find(f=>f.id===event.fileId)||{}):null);
    const moment=projectTimelineMoment(event.at,event.date);if(!event.at)moment.time='';
    const entry={key:`event:${event.id}`,id:event.id,type:'event',kind:event.kind||'项目',title:event.title||'项目活动',record:event,...moment,timeLabel:event.at?'实际操作时间':'精确时间未记录',stars:0,personIds:ids(event.operator.id,event.personId,event.affectedMemberIds)};
    const node=meetingNodes.get(meeting?.id);if(node)node.activities.push(entry);else nodes.push(entry);
  }
  for(const node of meetingNodes.values()){
    for(const key of ['files','assignments','logs','activities'])node[key].sort(order);
    node.highlightCount=[node.minutes,...node.files,...node.assignments,...node.logs].filter(t=>t?.stars===3).length;
  }
  return {nodes:nodes.sort(order),highlights:targets.filter(target=>target.stars===3).sort(order),targetCount:targets.length};
}

function projectTimelineMatches(record,{kind='全部动态',personId='全部成员',from='',to='',stars='all'}={}){
  return !(from&&to&&from>to)&&(kind==='全部动态'||record.kind===kind)&&(personId==='全部成员'||record.personIds?.includes(personId))&&(stars==='all'||record.stars===Number(stars))&&(!from||record.date&&record.date>=from)&&(!to||record.date&&record.date<=to);
}
function filterProjectTimelineHighlights(highlights,filters={}){return highlights.filter(record=>projectTimelineMatches(record,filters))}
function filterProjectTimeline(nodes,filters={}) {
  const hasFilters=!!(filters.kind&&filters.kind!=='全部动态'||filters.personId&&filters.personId!=='全部成员'||filters.from||filters.to||filters.stars&&filters.stars!=='all');
  return nodes.flatMap(node=>{
    const children=[node.minutes,...(node.files||[]),...(node.assignments||[]),...(node.logs||[]),...(node.activities||[]),...(node.attendance||[]).filter(p=>p.checked).map(p=>({...p,key:`attendance:${p.id}`,type:'event',kind:'签到',personIds:[p.id]}))].filter(Boolean);
    const matching=children.filter(record=>projectTimelineMatches(record,filters)),self=projectTimelineMatches(node,filters);
    if(!self&&!matching.length)return [];
    return [{...node,filterActive:hasFilters,matchingKeys:hasFilters?[...(self?[node.key]:[]),...matching.map(r=>r.key)]:[],matchCount:hasFilters?matching.length:0}];
  });
}
if(typeof module!=='undefined'&&module.exports)module.exports={buildProjectTimeline,filterProjectTimeline,filterProjectTimelineHighlights,projectTimelineMoment};
