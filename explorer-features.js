import { installSftp } from './sftp-ui.js';
// Optional explorer tools share the existing pane state through a small adapter.
export function installFeatures(api) {
  installSftp(api);
  const { $, bridge, escapeHtml: esc, showToast: toast } = api;
  let clipboardWrite = Promise.resolve(), clipboardRequest = 0, watchTimer, treeToken = 0;
  const changed = new Set();
  const dialog = document.createElement('dialog');
  dialog.id = 'features-dialog'; dialog.setAttribute('aria-label','탐색기 기능');
  dialog.innerHTML = `<div class="dialog-topline"><h2>탐색기 기능</h2><button type="button" data-dismiss aria-label="닫기">×</button></div><div class="feature-grid">
    <button data-tool="tree">폴더 트리</button><button data-tool="preview">선택 파일 미리보기</button><button data-tool="zip">ZIP 탐색</button><button data-tool="shell">Windows 메뉴</button>
    <button data-tool="workspace-add">작업 공간 추가</button><button data-tool="workspace-rename">작업 공간 이름 변경</button><button data-tool="compact">간결한 화면 전환</button>
  </div><label class="feature-setting">파일 충돌 처리<select id="conflict-policy"><option value="skip">같은 이름 건너뛰기</option><option value="replace">기존 항목 백업 후 교체</option><option value="merge">폴더 병합 · 같은 파일 건너뛰기</option><option value="merge-replace">폴더 병합 · 같은 파일 백업 후 교체</option></select></label><p class="dialog-subtitle">충돌 정책은 이번 실행에 적용됩니다. 실행 취소는 이번 실행의 복사·이동·이름 변경·새 폴더에 적용되며, 교체된 원본은 대상 폴더의 .pane-undo-*에 보관합니다.</p><div id="feature-content"></div>`;
  document.body.append(dialog);
  const button = document.createElement('button'); button.className='toolbar-button'; button.id='features-button'; button.textContent='기능'; button.disabled=true;
  $('.toolbar-actions').append(button);
  button.addEventListener('click', () => dialog.showModal());
  dialog.querySelector('[data-dismiss]').onclick=()=>dialog.close();
  const controls=document.createElement('span'); controls.className='job-controls';
  controls.innerHTML='<button id="job-pause" hidden>일시정지</button><button id="job-cancel" hidden>취소</button><button id="job-undo" disabled title="이번 실행의 마지막 지원 파일 작업 실행 취소 (Ctrl+Z)">실행 취소</button>';
  $('#activity-strip').append(controls);
  let paused=false;
  $('#job-pause').onclick=async()=>{await bridge.jobControl?.(paused?'resume':'pause');};
  $('#job-cancel').onclick=async()=>{await bridge.jobControl?.('cancel');toast('현재 파일을 마친 후 취소합니다.');};
  async function undo() {
    if(api.busy || !bridge.undo || $('#job-undo').disabled) return;
    await api.runMutation('실행 취소 중…','undo','',async()=>{
      const result=await bridge.undo(); if(!result.ok) throw new Error(result.error.message);
      $('#job-undo').disabled=!result.value.undoCount;
      for(const item of result.value.relocations||[])api.remapReferences(item.source,item.destination);
      await api.refreshAffected(()=>true,result.value.relocations||[]); toast('파일 작업을 실행 취소했습니다.');
    });
  }
  $('#job-undo').onclick=undo;
  document.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!document.activeElement.matches('input,textarea,[contenteditable]')&&!document.querySelector('dialog[open]')){event.preventDefault();undo();}
  });
  bridge?.onProgress?.(value=>{
    paused=value.paused;
    $('#job-pause').hidden=Boolean(value.finished); $('#job-cancel').hidden=Boolean(value.finished);
    $('#job-pause').textContent=paused?'계속':'일시정지';
    $('#job-pause').title='현재 파일을 마친 후 일시정지';
    $('#job-undo').disabled=!value.undoCount || !value.finished;
    const speed=value.elapsed>0 ? value.bytes/(value.elapsed/1000) : 0;
    const percent=value.totalBytes?Math.min(100,Math.round(value.bytes/value.totalBytes*100)):0;
    api.mutationLabel=`${value.cancelled?'취소 대기':paused?'일시정지 요청':value.phase||'작업'} · ${api.sizeText(value.bytes)} / ${api.sizeText(value.totalBytes)} (${percent}%) · ${api.sizeText(speed)}/s`;
    api.updateSelection();
  });
  async function readClipboard() {
    if(!bridge?.clipboardRead) return;
    const request=++clipboardRequest;
    try { await clipboardWrite; const response=await bridge.clipboardRead(); if(request===clipboardRequest&&response.ok){api.clipboard=response.value;api.updateSelection();} }
    catch {} // Clipboard can be temporarily locked by another app.
  }
  function writeClipboard(value,expected) {
    if(!bridge?.clipboardWrite || (!value?.sources.length && !expected?.length)) return;
    clipboardRequest++;
    const snapshot=value?.sources.length?{operation:value.operation,sources:[...value.sources]}:{sources:[],expected};
    clipboardWrite=clipboardWrite.catch(()=>{}).then(async()=>{const result=await bridge.clipboardWrite(snapshot);if(!result.ok)toast('Windows 클립보드에 기록하지 못했습니다. 앱 안에서는 붙여넣을 수 있습니다.');});
  }
  function syncWatches() {
    clearTimeout(watchTimer);
    watchTimer=setTimeout(()=>bridge?.watch?.(api.visiblePanes().filter(p=>p.loaded).map(p=>p.path)).catch(()=>{}),100);
  }
  async function flushChanged() {
    if(api.busy || !api.ready) return;
    const paths=[...changed]; changed.clear();
    for(const pane of api.visiblePanes()) if(paths.some(p=>p.toLowerCase()===pane.path.toLowerCase())&&!pane.loading) api.navigate(pane,pane.path,{refresh:true,preserveDraft:true});
  }
  bridge?.onDirectoryChanged?.(path=>{changed.add(path);flushChanged();});
  const flushTimer=setInterval(flushChanged,1000);
  window.addEventListener('beforeunload',()=>clearInterval(flushTimer));
  function renderTabs(pane) {
    const parent=api.panelElement(pane)?.querySelector('.panel-tab'); if(!parent)return;
    let tabs=parent.querySelector('.pane-tabs');
    if(!tabs){tabs=document.createElement('div');tabs.className='pane-tabs';parent.querySelector('.panel-tab-label').remove();parent.append(tabs);}
    tabs.innerHTML=pane.tabs.map((path,index)=>`<button class="pane-tab ${index===pane.activeTab?'current panel-tab-label':''}" data-tab="${index}" title="${esc(path)}">${esc(path.replace(/[\\/]+$/,'').split(/[\\/]/).at(-1)||path)}</button>`).join('')+'<button data-tab-add title="폴더 탭 추가" aria-label="폴더 탭 추가">＋</button><button data-tab-close title="현재 탭 닫기" aria-label="현재 탭 닫기" '+(pane.tabs.length===1?'disabled':'')+'>×</button>';
  }
  $('#panels').addEventListener('click',event=>{
    const pane=api.paneFromElement(event.target);if(!pane || pane.loading)return;
    const tab=event.target.closest('[data-tab]');
    if(tab){pane.history=[];api.navigate(pane,pane.tabs[Number(tab.dataset.tab)],{tabIndex:Number(tab.dataset.tab),focus:true});}
    if(event.target.closest('[data-tab-add]')){if(pane.tabs.length>=20){toast('패널마다 탭은 20개까지 만들 수 있습니다.');return;}pane.tabs.push(pane.path);pane.activeTab=pane.tabs.length-1;renderTabs(pane);api.persistSession();}
    if(event.target.closest('[data-tab-close]')&&pane.tabs.length>1){pane.tabs.splice(pane.activeTab,1);pane.activeTab=Math.min(pane.activeTab,pane.tabs.length-1);pane.history=[];api.navigate(pane,pane.tabs[pane.activeTab],{tabIndex:pane.activeTab});renderTabs(pane);api.persistSession();}
  });
  function workspaceView(){
    button.disabled=!api.ready;
    if(!api.ready)return;
    for(const pane of api.visiblePanes()){renderTabs(pane);if(!pane.loaded&&!pane.loading&&!pane.error)queueMicrotask(()=>{if(!pane.loading&&!pane.loaded)api.navigate(pane,pane.path,{initial:true});});}
    syncWatches();
  }
  async function tree(path,container,token) {
    const result=await bridge.listDirectory(path);if(token!==treeToken)return;
    if(!result.ok)throw new Error(result.error.message);
    container.replaceChildren();
    for(const entry of result.value.entries.filter(e=>e.type==='folder')){
      const row=document.createElement('div');row.className='tree-row';
      const expand=document.createElement('button');expand.textContent='▸';expand.setAttribute('aria-label',`${entry.name} 하위 폴더 펼치기`);
      const open=document.createElement('button');open.textContent=entry.name;open.title=entry.path;
      const children=document.createElement('div');children.className='tree-children';children.hidden=true;
      expand.onclick=async()=>{children.hidden=!children.hidden;expand.textContent=children.hidden?'▸':'▾';if(!children.hidden){children.textContent='불러오는 중…';try{await tree(entry.path,children,token);}catch(e){children.textContent=e.message;}}};
      open.onclick=()=>{api.navigate(api.activePane(),entry.path);dialog.close();};
      row.append(expand,open);container.append(row,children);
    }
    if(!container.children.length)container.textContent='하위 폴더 없음';
  }
  const content=$('#feature-content');
  async function runTool(tool){
    if(!api.ready)return;
    const pane=api.activePane(), file=api.selectedFile();content.replaceChildren();treeToken++;
    if(tool==='compact'){document.body.classList.toggle('compact-mode');return;}
    if(tool.startsWith('workspace-')){
      content.innerHTML='<form id="workspace-form"><label>작업 공간 이름<input id="workspace-name" maxlength="60" required></label><button class="primary-button">저장</button></form>';
      $('#workspace-name').value=tool==='workspace-rename'?api.workspaces[api.workspaceId].name:'';$('#workspace-name').focus();
      $('#workspace-form').onsubmit=event=>{event.preventDefault();const name=$('#workspace-name').value.trim();if(!name)return;
        if(tool==='workspace-add'){
          if(Object.keys(api.workspaces).length>=20){toast('작업 공간은 20개까지 만들 수 있습니다.');return;}
          const id=`space-${crypto.randomUUID()}`, definition={name,description:'폴더와 탭을 모아 두는 작업 공간',icon:'grid'};
          api.definitions[id]=definition;api.workspaces[id]={...definition,layout:2,active:0,panes:Array.from({length:4},(_,i)=>api.makePane(id,i,{path:pane.path,sort:'name',direction:1}))};
          api.workspaces[id].panes.forEach(api.createPanel);api.workspaceId=id;
        }else{api.workspaces[api.workspaceId].name=name;api.definitions[api.workspaceId].name=name;}
        api.renderSidebar();api.updateWorkspaceView();api.persistSession();dialog.close();
      };return;
    }
    if(tool==='tree'){content.innerHTML=`<p>${esc(pane.path)}</p><div id="folder-tree"></div>`;await tree(pane.path,$('#folder-tree'),treeToken);return;}
    if(tool==='shell'){
      if(api.busy)throw new Error('진행 중인 파일 작업이 끝난 뒤 열어 주세요.');
      const paths=api.selectedFiles().map(f=>f.path);if(!paths.length)paths.push(pane.path);
      dialog.close();const result=await bridge.shellMenu(paths);if(!result.ok)throw new Error(result.error.message);await api.refreshAffected(()=>true);await readClipboard();return;
    }
    if(!file)throw new Error('파일 하나를 선택하세요.');
    if(tool==='preview'){
      const result=await bridge.preview(file.path);if(!result.ok)throw new Error(result.error.message);
      const value=result.value;
      if(value.kind==='image'){const img=document.createElement('img');img.className='file-preview';img.src=value.data;img.alt=file.name;content.append(img);}
      else{const pre=document.createElement('pre');pre.className='text-preview';pre.textContent=value.data;content.append(pre);if(value.truncated)content.append('처음 256 KB만 표시합니다.');}return;
    }
    if(tool==='zip'){
      const result=await bridge.archiveList(file.path);if(!result.ok)throw new Error(result.error.message);
      content.innerHTML=`<p>${esc(file.name)} · ${result.value.length}개 항목</p><input id="zip-filter" placeholder="ZIP 안에서 이름 검색" aria-label="ZIP 안에서 이름 검색"><div id="zip-list"></div>`;
      const render=()=>{
        const rows=result.value.filter(r=>r.name.toLowerCase().includes($('#zip-filter').value.toLowerCase()));
        $('#zip-list').innerHTML=rows.slice(0,500).map(r=>`<div class="zip-row"><span title="${esc(r.name)}">${esc(r.name)}</span><small>${api.sizeText(r.size)}</small>${r.type==='File'?`<button data-extract="${r.index}">현재 폴더에 추출</button>`:''}</div>`).join('')+(rows.length>500?'<p>500개만 표시합니다. 검색어를 좁혀 주세요.</p>':'');
      };$('#zip-filter').oninput=render;render();
      $('#zip-list').onclick=async event=>{const button=event.target.closest('[data-extract]');if(!button||api.busy)return;button.disabled=true;
        await api.runMutation('ZIP 추출 중…','extract',file.path,async()=>{const result=await bridge.archiveExtract({archive:file.path,index:Number(button.dataset.extract),destination:pane.path});if(!result.ok)throw new Error(result.error.message);await api.refreshAffected(p=>p===pane.path);toast('추출했습니다.');});button.disabled=false;};
    }
  }
  dialog.addEventListener('click',event=>{const target=event.target.closest('[data-tool]');if(target)runTool(target.dataset.tool).catch(e=>{content.textContent=e.message;toast(e.message);});});
  return { renderTabs,workspaceView,syncWatches,readClipboard,writeClipboard,conflict:()=>$('#conflict-policy').value };
}
