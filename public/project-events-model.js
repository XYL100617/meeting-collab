(function(root,factory){const model=factory();if(typeof module==='object'&&module.exports)module.exports=model;else root.ProjectEventsModel=model})(typeof globalThis==='object'?globalThis:this,function(){
  const day=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at));
  const unique=(list,id)=>{const matches=(list||[]).filter(x=>x.id===id);return matches.length===1?matches[0]:null};
  function sourceFor(w,e){
    if(e.source)return {...e.source};
    const pair=e.fileId?['file',e.fileId]:e.audioId?['audio',e.audioId]:e.assignmentId?['assignment',e.assignmentId]:e.logId?['log',e.logId]:e.inviteId?['invite',e.inviteId]:e.meetingId?[e.kind==='纪要'?'minutes':'meeting',e.meetingId]:e.kind==='项目'?['project',w.project.id]:e.kind==='成员'&&e.actorId?['member',e.actorId]:null;
    return pair?{type:pair[0],id:pair[1],projectId:w.project.id}:null;
  }
  function resolveProjectEventSource(w,e,actor){
    const s=sourceFor(w,e);if(!s||s.projectId!==w.project.id||e.projectId&&e.projectId!==w.project.id)return null;
    if(actor&&!(w.people||[]).some(p=>p.id===actor.id))return null;
    let record;
    switch(s.type){
      case 'project':record=s.id===w.project.id?w.project:null;break;
      case 'member':record=unique(w.people,s.id);break;
      case 'meeting':record=unique(w.meetings,s.id);break;
      case 'minutes':record=unique(w.meetings,s.id);if(!record?.summary?.trim()&&!record?.summaryHtml?.includes('<img'))record=null;break;
      case 'assignment':record=unique(w.assignments,s.id);break;
      case 'log':record=unique(w.logs,s.id);break;
      case 'invite':if(actor&&w.people.find(p=>p.id===actor.id)?.role!=='组长')return null;record=unique(w.invites,s.id);break;
      case 'file':case 'audio':record=unique(w.files,s.id);if(record?.kind==='正文图片')record=null;break;
      case 'file-analysis':record=unique(unique(w.files,s.parentId)?.analyses,s.id);break;
      case 'transcript':record=unique(unique(w.files,s.parentId)?.transcriptions,s.id);break;
      case 'audio-analysis':record=unique(unique(unique(w.files,s.parentId)?.transcriptions,s.transcriptId)?.analyses,s.id);break;
      case 'meeting-analysis':record=unique(unique(w.meetings,s.parentId)?.materialAnalyses,s.id);break;
    }
    return record?{...s}:null;
  }
  function createProjectEvent(w,actor,details){
    const at=details.at&&Number.isFinite(Date.parse(details.at))?new Date(details.at).toISOString():new Date().toISOString();
    const event={...details,projectId:w.project.id,at,date:day(at),actorId:actor?.id||details.actorId||null,operator:{id:actor?.id||details.actorId||null,name:actor?.name||'未记录'},summary:String(details.summary??details.detail??details.title??''),action:details.action||'recorded'};
    if(['meeting-checkin','meeting-supplement'].includes(event.action))event.kind='签到';
    event.source=sourceFor(w,event);
    const source=event.source,collections={member:w.people,meeting:w.meetings,minutes:w.meetings,assignment:w.assignments,log:w.logs,file:w.files,audio:w.files};
    const record=source&&(source.type==='project'?w.project:unique(collections[source.type],source.id));
    event.sourceName=details.sourceName||record?.title||record?.name||record?.content||(record?.author?`${record.author} 的工作日志`:'');
    return event;
  }
  function normalizeProjectEvent(w,e,actor){
    let value=String(e.at||'');
    if(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value))value=value.replace(' ','T')+'+08:00';
    const at=/[T ]\d{2}:\d{2}/.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
    const actorId=e.operator?.id||e.actorId||null,person=unique(w.people,actorId),source=sourceFor(w,e);
    return {...e,projectId:e.projectId||w.project.id,at,date:at?day(at):(e.date||(/^\d{4}-\d{2}-\d{2}$/.test(value)?value:null)),operator:{id:actorId,name:e.operator?.name||person?.name||'未记录'},summary:String(e.summary??e.detail??''),source,sourceAvailable:!!e.id&&!!resolveProjectEventSource(w,e,actor)};
  }
  function queryProjectEvents(w,options={}){
    const events=(w.events||[]).filter(e=>!e.projectId||e.projectId===w.project.id).map(e=>normalizeProjectEvent(w,e,options.actor));
    const rows=events.filter(e=>(!options.kind||options.kind===e.kind)&&(!options.memberId||options.memberId===e.operator.id)&&(!options.from||e.date&&e.date>=options.from)&&(!options.to||e.date&&e.date<=options.to));
    const key=e=>e.at||`${e.date||'0000-00-00'}T00:00:00.000Z`;
    rows.sort((a,b)=>key(b).localeCompare(key(a))||String(b.id).localeCompare(String(a.id)));
    const total=rows.length,limit=Math.min(100,Math.max(1,Number(options.limit)||20));let offset=Math.max(0,Number(options.offset)||0);
    if(options.cursor){let c;try{c=JSON.parse(options.cursor)}catch{throw new Error('分页参数无效。')}if(!Array.isArray(c)||c.length!==2||c.some(x=>typeof x!=='string'))throw new Error('分页参数无效。');offset=rows.findIndex(e=>key(e)<c[0]||key(e)===c[0]&&String(e.id).localeCompare(c[1])<0);if(offset<0)offset=total;}
    const items=rows.slice(offset,offset+limit),last=items.at(-1),hasMore=offset+items.length<total;
    return {items,total,hasMore,nextCursor:hasMore&&last?JSON.stringify([key(last),String(last.id)]):null,kinds:[...new Set(events.map(e=>e.kind).filter(Boolean))].sort(),members:(w.people||[]).map(p=>({id:p.id,name:p.name}))};
  }
  return {createProjectEvent,normalizeProjectEvent,queryProjectEvents,resolveProjectEventSource};
});
