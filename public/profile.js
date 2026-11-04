function syncUserMenu(){
  const menu=document.querySelector('#user-menu');
  const logoutButtons=document.querySelectorAll('[data-action="logout"]');
  if(!currentUser){
    if(menu)menu.hidden=true;
    document.querySelector('#top-avatar')?.setAttribute('aria-expanded','false');
    logoutButtons.forEach(button=>button.hidden=true);
    return;
  }
  logoutButtons.forEach(button=>button.hidden=false);
  const top=document.querySelector('#top-avatar'),menuAvatar=document.querySelector('#user-menu-avatar');
  const name=document.querySelector('#user-menu-name'),account=document.querySelector('#user-menu-account');
  const content=currentUser.avatar?`<img src="${esc(currentUser.avatar)}" alt="">`:`<span>${esc(initialOf(currentUser.name))}</span>`;
  if(top){top.innerHTML=content;top.setAttribute('aria-label',`${currentUser.name}账户菜单`)}
  if(menuAvatar)menuAvatar.innerHTML=content;
  if(name)name.textContent=currentUser.name;
  if(account)account.textContent=`@${currentUser.account||''}`;
}

function profilePage(){
  return `${heading('PERSONAL ACCOUNT','个人资料与账户','管理个人头像、显示名称、登录账号和登录密码。','')}
    <div class="profile-layout">
      <section class="profile-card profile-identity">
        <div class="profile-card-heading"><div><span class="eyebrow">个人账户</span><h2>个人资料</h2><p>修改后的显示名称会同步到你加入的项目成员档案。</p></div></div>
        <div class="profile-avatar-row"><span class="profile-avatar-preview" id="profile-avatar-preview">${currentUser.avatar?`<img src="${esc(currentUser.avatar)}" alt="个人头像">`:esc(initialOf(currentUser.name))}</span><div class="profile-avatar-copy"><b>${esc(currentUser.name)}</b><span>@${esc(currentUser.account||'')}</span><small>系统已生成默认头像；也可上传常见图片格式，最大 1 兆字节</small></div><div class="profile-avatar-actions"><label class="button" for="avatar-upload">上传头像</label><button class="button" type="button" data-action="reset-avatar">恢复默认</button></div><input id="avatar-upload" type="file" accept="image/png,image/jpeg,image/webp" hidden></div>
        <form id="profile-form"><div class="field"><label>显示名称</label><input name="name" required maxlength="20" value="${esc(currentUser.name)}" placeholder="请输入显示名称"></div><div class="field"><label>登录账号</label><input name="account" required minlength="4" maxlength="30" pattern="[A-Za-z0-9_]{4,30}" value="${esc(currentUser.account||'')}" autocomplete="username"><small>4–30 位字母、数字或下划线。修改后下次登录请使用新账号。</small></div><button class="button primary" type="submit">保存个人资料</button></form>
      </section>
      <section class="profile-card profile-password">
        <div class="profile-card-heading"><div><span class="eyebrow">账户安全</span><h2>修改密码</h2><p>更新密码前需要验证当前密码。</p></div><span class="security-mark" aria-hidden="true">⌑</span></div>
        <form id="password-form"><div class="field"><label>当前密码</label><input name="currentPassword" type="password" required autocomplete="current-password" placeholder="输入当前密码"></div><div class="field"><label>新密码</label><input name="newPassword" type="password" required minlength="8" maxlength="32" autocomplete="new-password" placeholder="8–32 位"></div><div class="field"><label>确认新密码</label><input name="confirmPassword" type="password" required minlength="8" maxlength="32" autocomplete="new-password" placeholder="再次输入新密码"></div><button class="button primary" type="submit">更新密码</button></form>
        <div class="profile-security-note"><b>账户安全</b><span>修改密码后，其他设备上的登录会话将退出；当前设备保持登录。</span></div>
      </section>
    </div>`;
}

document.addEventListener('click',async e=>{
  if(e.target.closest('[data-action="reset-avatar"]')){
    try{const response=await fetch('/api/profile/avatar/reset',{method:'POST',credentials:'same-origin'}),result=await response.json();if(!response.ok)throw Error(result.error||'恢复默认头像失败');currentUser.avatar=result.avatar;if(state){const person=state.people.find(p=>p.id===currentUser.id);if(person)person.avatar=result.avatar}syncUserMenu();const preview=document.querySelector('#profile-avatar-preview');if(preview)preview.innerHTML=`<img src="${esc(result.avatar)}" alt="系统默认头像">`;toast('已恢复系统默认头像')}catch(err){toast(err.message)}
    return;
  }
  const toggle=e.target.closest('#top-avatar');
  const menu=document.querySelector('#user-menu');
  if(toggle&&menu){if(!currentUser){menu.hidden=true;renderAuth();return}menu.hidden=!menu.hidden;toggle.setAttribute('aria-expanded',String(!menu.hidden));return}
  if(e.target.closest('#user-menu [data-view]')){if(menu)menu.hidden=true;document.querySelector('#top-avatar')?.setAttribute('aria-expanded','false');return}
  if(!e.target.closest('.user-menu-wrap')){if(menu)menu.hidden=true;document.querySelector('#top-avatar')?.setAttribute('aria-expanded','false')}
});

document.addEventListener('change',async e=>{
  if(e.target.id!=='avatar-upload')return;
  const file=e.target.files?.[0];if(!file)return;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>1024*1024){toast('请选择常见图片格式，大小不超过1兆字节。');e.target.value='';return}
  const reader=new FileReader();reader.onload=async()=>{try{const result=await fetch('/api/profile/avatar',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({avatarData:reader.result})});const data=await result.json();if(!result.ok)throw Error(data.error||'头像上传失败');currentUser.avatar=data.avatar;if(state){const person=state.people.find(p=>p.id===currentUser.id);if(person)person.avatar=data.avatar}syncUserMenu();const preview=document.querySelector('#profile-avatar-preview');if(preview)preview.innerHTML=`<img src="${esc(data.avatar)}" alt="个人头像">`;toast('头像已更新')}catch(err){toast(err.message)}};reader.onerror=()=>toast('无法读取所选图片。');reader.readAsDataURL(file);
});

document.addEventListener('submit',async e=>{
  const form=e.target;
  if(form.id==='profile-form'){
    e.preventDefault();e.stopImmediatePropagation();if(!form.reportValidity())return;
    const button=form.querySelector('[type=submit]'),data=Object.fromEntries(new FormData(form));button.disabled=true;button.textContent='正在保存…';
    try{const response=await fetch('/api/profile',{method:'PATCH',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(data)}),result=await response.json();if(!response.ok)throw Error(result.error||'资料保存失败');Object.assign(currentUser,result);if(state){const person=state.people.find(p=>p.id===currentUser.id);if(person){person.name=result.name;person.account=result.account;person.avatar=result.avatar}}syncUserMenu();render();toast('个人资料已保存')}catch(err){toast(err.message);button.disabled=false;button.textContent='重试保存'}
  }
  if(form.id==='password-form'){
    e.preventDefault();e.stopImmediatePropagation();if(!form.reportValidity())return;
    const button=form.querySelector('[type=submit]'),data=Object.fromEntries(new FormData(form));if(data.newPassword!==data.confirmPassword){toast('两次输入的新密码不一致。');return}button.disabled=true;button.textContent='正在更新…';
    try{const response=await fetch('/api/profile/password',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(data)}),result=await response.json();if(!response.ok)throw Error(result.error||'密码更新失败');form.reset();toast('密码已更新')}catch(err){toast(err.message);button.disabled=false;button.textContent='更新密码'}
  }
});
