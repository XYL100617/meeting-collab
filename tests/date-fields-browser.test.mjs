import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {readFile, mkdir, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const browserPath=process.env.CHROME_BIN||[
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(existsSync);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn){
  const end=Date.now()+15000;
  while(Date.now()<end){const value=await fn();if(value)return value;await sleep(100);}
  throw Error('Browser condition timed out');
}

test('date fields show yyyy/mm/dd without clipping and preserve native values, validation and picker', {timeout:60000,skip:!browserPath}, async()=>{
  const profile=path.join(root,'..',`date-browser-${process.pid}`);
  await mkdir(profile,{recursive:true});
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    ${['styles','personal-history','project-events','date-fields'].map(name=>`<link rel="stylesheet" href="/${name}.css">`).join('')}
    <style>body{padding:16px}.test-container{max-width:600px}.test-container form{display:grid;gap:16px}</style>
    <script src="/date-fields.js" defer></script></head><body><div class="test-container">
    <div class="task-workspace-page"><div class="task-filters"><input id="filter" type="date"></div></div>
    <form id="form"><div class="field"><label for="date">会议日期</label><input id="date" name="date" type="date" value="2026-11-26" required min="2024-01-01" max="2027-12-31"></div>
    <div class="field"><label>截止时间<input id="deadline" name="dueAt" type="datetime-local" value="2026-11-26T14:30" required></label></div>
    <div class="field"><label>只读日期<input id="disabled-date" type="date" value="2026-11-26" disabled></label></div></form>
    <div class="history-filter-bar"><label>开始日期<input id="history-date" type="date"></label></div>
    <div class="project-events-filters"><label>开始日期<input type="date"></label><label>结束日期<input type="date"></label></div>
    <div id="dynamic"></div></div>
    <div class="modal-layer" style="position:static"><div class="modal"><div class="modal-body"><div class="field"><label>弹窗截止时间<input id="modal-deadline" type="datetime-local"></label></div></div></div></div>
    <script>window.dateEvents=[];document.addEventListener('change',e=>{if(e.target.id==='filter')dateEvents.push(e.target.value)});</script></body></html>`;
  const server=createServer(async(req,res)=>{
    if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');res.end(html);return;}
    try{const filename=path.basename(req.url);const data=await readFile(path.join(root,'public',filename));res.setHeader('content-type',filename.endsWith('.css')?'text/css':'text/javascript');res.end(data);}
    catch{res.statusCode=404;res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser,ws;
  const pending=new Map();let seq=0;
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error(`CDP timeout: ${method}`));},10000);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject});ws.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
    return result.result.value;
  };
  const edit=async(id,value)=>{
    await evaluate(`(()=>{const text=document.getElementById('${id}').parentElement.querySelector('.date-field-text');text.focus();text.select()})()`);
    await send('Input.insertText',{text:value});
    await evaluate('document.activeElement.blur()');
  };
  try{
    browser=spawn(browserPath,['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--no-sandbox',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{stdio:['ignore','ignore','pipe']});
    let browserOutput='';browser.stderr.on('data',data=>browserOutput+=data);
    browser.on('error',error=>{browserOutput+=error.message});
    const active=await waitFor(async()=>{try{return await readFile(path.join(profile,'DevToolsActivePort'),'utf8')}catch{return false}}).catch(error=>{throw Error(`${error.message}; ${browserOutput}; exit=${browser.exitCode}`)});
    const debugPort=active.split(/\r?\n/)[0];
    const targets=await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    ws=new WebSocket(targets.find(x=>x.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;ws.onmessage=event=>{
      const result=JSON.parse(event.data);if(!pending.has(result.id))return;
      const handler=pending.get(result.id);pending.delete(result.id);result.error?handler.reject(Error(result.error.message)):handler.resolve(result.result);
    }});
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}`});
    await waitFor(()=>evaluate('document.readyState==="complete"'));
    assert.equal(await evaluate('!!document.querySelector("#filter + .date-field-text")'),true,'every native date field should have a formatted text input');
    assert.equal(await evaluate('document.querySelector("#filter + .date-field-text").placeholder'),'yyyy/mm/dd');
    assert.equal(await evaluate('document.querySelector("#date + .date-field-text").value'),'2026/11/26');
    assert.equal(await evaluate('document.querySelector("#deadline + .date-field-text").value'),'2026/11/26 14:30');
    assert.equal(await evaluate('document.querySelector("#disabled-date + .date-field-text").disabled'),true);
    await evaluate('document.querySelector("label[for=date]").click()');
    assert.equal(await evaluate('document.activeElement.classList.contains("date-field-text")'),true,'labels focus the visible editor');

    await edit('date','2024/02/29');
    await edit('deadline','2026/12/01 09:45');
    assert.deepEqual(await evaluate('Object.fromEntries(new FormData(document.getElementById("form")))'),{date:'2024-02-29',dueAt:'2026-12-01T09:45'},'server receives ISO values without duplicate fields');
    await edit('filter','2026/11/26');
    assert.deepEqual(await evaluate('dateEvents'),['2026-11-26'],'filter changes reach existing listeners exactly once');
    await edit('filter','');
    assert.deepEqual(await evaluate('dateEvents'),['2026-11-26',''],'clearing a filter reaches existing listeners');
    for(const invalid of ['2026/02/29','2023/12/31','2028/01/01','2026/11']){
      await edit('date',invalid);
      assert.equal(await evaluate('document.getElementById("form").checkValidity()'),false,`reject invalid or out-of-range date ${invalid}`);
    }
    await edit('date','');
    assert.equal(await evaluate('document.getElementById("form").reportValidity()'),false,'required dates still block submission');
    assert.equal(await evaluate('document.activeElement.classList.contains("date-field-text")'),true,'validation focuses a visible input');
    await edit('date','2026/11/26');
    assert.equal(await evaluate('document.getElementById("form").checkValidity()'),true);
    await evaluate('document.getElementById("date").value="2026-12-02";document.getElementById("date").dispatchEvent(new Event("change",{bubbles:true}))');
    assert.equal(await evaluate('document.querySelector("#date + .date-field-text").value'),'2026/12/02','native calendar and programmatic events update the editor');
    await evaluate('document.getElementById("form").reset()');
    await waitFor(()=>evaluate('document.querySelector("#date + .date-field-text").value==="2026/11/26"'));

    await evaluate('document.getElementById("dynamic").innerHTML=\'<input id="added" type="date" value="2026-12-03">\'');
    await waitFor(()=>evaluate('!!document.querySelector("#added + .date-field-text")'));
    assert.equal(await evaluate('document.querySelector("#added + .date-field-text").value'),'2026/12/03','new modal and rerendered fields are enhanced');
    assert.equal(await evaluate('document.querySelectorAll(".date-field").length'),9,'initialization never nests duplicate fields');

    // Exercise an actual user click: showPicker requires transient user activation.
    await evaluate('window.pickerCalls=0;document.getElementById("date").showPicker=function(){window.pickerCalls++;HTMLInputElement.prototype.showPicker.call(this)}');
    const point=await evaluate('(()=>{const r=document.querySelector("#date").parentElement.querySelector(".date-field-picker").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');
    await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    assert.equal(await evaluate('pickerCalls'),1,'the calendar button opens the original native picker');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});

    for(const width of [1440,1097,390,360]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
      const fields=await evaluate(`Array.from(document.querySelectorAll('.date-field-text')).map(input=>{
        const s=getComputedStyle(input),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=s.font;
        return {id:input.previousElementSibling.id,text:input.value||input.placeholder,available:input.getBoundingClientRect().width-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)-parseFloat(s.borderLeftWidth)-parseFloat(s.borderRightWidth),needed:ctx.measureText(input.value||input.placeholder).width,right:input.getBoundingClientRect().right,containerRight:input.closest('.field')?.getBoundingClientRect().right||innerWidth};
      })`);
      for(const field of fields){assert.ok(field.available>=field.needed,`${width}px: ${JSON.stringify(field)} must fit`);assert.ok(field.right<=Math.min(width,field.containerRight)+1,`${width}px: ${field.id} stays inside its container`);}
    }
  } catch(error){
    console.error(error.stack);
    throw error;
  } finally{
    if(ws?.readyState===WebSocket.OPEN)await send('Browser.close').catch(()=>{});
    if(ws)ws.close();
    if(browser&&browser.exitCode===null){
      const exited=new Promise(resolve=>browser.once('exit',resolve));
      if(process.platform==='win32')spawnSync('taskkill',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});
      else browser.kill();
      await exited;
    }
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    const target=path.resolve(profile),workspace=path.resolve(root,'..')+path.sep;
    assert.ok(target.startsWith(workspace));
    await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
});
