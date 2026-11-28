// Keep native ISO-valued controls for existing forms and filters; use a visible
// editor because a native date input's text format follows the browser locale.
(() => {
  const selector='input[type="date"],input[type="datetime-local"]';
  const format=value=>value.replaceAll('-','/').replace('T',' ');

  function enhance(native){
    if(native.parentElement?.classList.contains('date-field'))return;
    const datetime=native.type==='datetime-local';
    const placeholder=datetime?'yyyy/mm/dd hh:mm':'yyyy/mm/dd';
    const label=native.getAttribute('aria-label')||native.labels?.[0]?.textContent.trim()||native.closest('.field')?.querySelector('label')?.textContent.trim()||(datetime?'日期和时间':'日期');
    const wrapper=document.createElement('span');
    wrapper.className=`date-field${datetime?' date-field-datetime':''}`;
    const text=document.createElement('input');
    text.type='text';text.className='date-field-text';text.placeholder=placeholder;
    text.value=format(native.value);text.defaultValue=text.value;
    text.required=native.required;text.disabled=native.disabled;text.readOnly=native.readOnly;
    text.autocomplete='off';text.spellcheck=false;
    text.setAttribute('aria-label',label);
    for(const attribute of ['aria-describedby','aria-labelledby']){
      if(native.hasAttribute(attribute))text.setAttribute(attribute,native.getAttribute(attribute));
    }
    const picker=document.createElement('button');
    picker.type='button';picker.className='date-field-picker';
    picker.setAttribute('aria-label',datetime?'选择日期和时间':'选择日期');
    picker.disabled=native.disabled||native.readOnly;
    picker.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14h2M14 14h2M8 17h2"/></svg>';
    native.before(wrapper);wrapper.append(native,text,picker);
    native.classList.add('date-field-native');
    native.tabIndex=-1;native.setAttribute('aria-hidden','true');

    let fromText=false;
    function syncFromNative(){
      if(fromText)return;
      native.setCustomValidity('');
      text.value=format(native.value);
      text.setCustomValidity(native.validationMessage);
    }
    function syncFromText(){
      native.setCustomValidity('');
      const value=text.value.trim();
      const pattern=datetime?/^\d{4}[/-]\d{2}[/-]\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/:/^\d{4}[/-]\d{2}[/-]\d{2}$/;
      const iso=value.replaceAll('/','-').replace(' ','T');
      native.value=!value||pattern.test(value)?iso:'';
      if(value&&(!pattern.test(value)||!native.value))native.setCustomValidity(`请使用 ${placeholder} 格式填写有效日期。`);
      text.setCustomValidity(native.validationMessage);
    }
    function forward(type){
      fromText=true;
      try{native.dispatchEvent(new Event(type,{bubbles:true}));}
      finally{fromText=false;}
    }
    text.addEventListener('input',event=>{
      event.stopPropagation();syncFromText();forward('input');
    });
    text.addEventListener('change',event=>{
      event.stopPropagation();syncFromText();
      if(native.validity.valid)text.value=format(native.value);
      forward('change');
    });
    native.addEventListener('input',syncFromNative);
    native.addEventListener('change',syncFromNative);
    native.addEventListener('focus',()=>text.focus());
    for(const label of native.labels||[])label.addEventListener('click',event=>{
      if(event.target.closest('.date-field'))return;
      event.preventDefault();text.focus();
    });
    native.addEventListener('invalid',event=>{
      event.preventDefault();text.setCustomValidity(native.validationMessage);
      text.reportValidity();
    });
    picker.addEventListener('click',()=>{
      if(typeof native.showPicker==='function')native.showPicker();
      else text.focus();
    });
    native.form?.addEventListener('reset',()=>requestAnimationFrame(syncFromNative));
  }

  function enhanceAll(root){
    if(root.matches?.(selector))enhance(root);
    root.querySelectorAll?.(selector).forEach(enhance);
  }
  enhanceAll(document);
  new MutationObserver(records=>{
    for(const record of records)for(const node of record.addedNodes){
      if(node.nodeType===1)enhanceAll(node);
    }
  }).observe(document.documentElement,{childList:true,subtree:true});
})();
