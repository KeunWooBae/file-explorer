import { initMultiTerminal } from './multi-terminal.js';
const api = window.pane;
const $ = selector => document.querySelector(selector);
const el = (tag, text, className) => { const node=document.createElement(tag); if(text!==undefined)node.textContent=text;if(className)node.className=className;return node; };
const unwrap = result => {if(!result?.ok)throw new Error(result?.error?.message || '작업을 완료하지 못했습니다.');return result.value;};
export function initSshWorkspace(getLocalPath) {
  const original=$('.main-content');
  const nav=el('button','SSH / SFTP','sidebar-button');nav.id='ssh-menu';nav.type='button';nav.title='SSH / SFTP';nav.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 0h4"/></svg><span>SSH / SFTP</span>';
  $('.sidebar-content').insertBefore(nav,$('.favorites-heading'));
  const screen=el('main',undefined,'ssh-workspace');screen.hidden=true;
  screen.innerHTML=`<header class="ssh-heading"><div><p class="workspace-eyebrow">원격 작업 공간</p><h1>SSH / SFTP</h1><p id="ssh-connection-label">로컬 파일과 원격 파일, 터미널을 한 화면에서</p></div><div><button id="ssh-connect" class="primary-button">SSH 연결</button><button id="ssh-disconnect" class="secondary-button" disabled>연결 종료</button></div></header><p id="ssh-status" role="status">SSH 연결을 눌러 호스트 이름 또는 SSH 설정의 별칭을 입력하세요.</p><section class="ssh-columns"><section class="ssh-files" id="ssh-local"><h2>로컬 파일</h2><form class="ssh-path"><button type="button" data-up aria-label="로컬 상위 폴더">↑</button><input aria-label="로컬 폴더 경로" spellcheck="false"><button type="submit">이동</button><button type="button" data-refresh aria-label="로컬 새로고침">↻</button></form><div class="ssh-file-list" role="group" aria-label="로컬 파일 목록"></div><button id="ssh-upload" class="primary-button" disabled>선택한 항목 업로드 →</button></section><section class="ssh-files" id="ssh-remote"><h2>원격 파일</h2><form class="ssh-path"><button type="button" data-up aria-label="원격 상위 폴더">↑</button><input aria-label="원격 폴더 경로" spellcheck="false" disabled><button type="submit" disabled>이동</button><button type="button" data-refresh aria-label="원격 새로고침" disabled>↻</button></form><div class="ssh-file-list" role="group" aria-label="원격 파일 목록"><p>SSH 연결 후 원격 폴더가 표시됩니다.</p></div><button id="ssh-download" class="primary-button" disabled>← 선택한 항목 다운로드</button></section><section class="ssh-terminal-panel"><div class="ssh-terminal-heading"><h2>SSH 터미널</h2><button id="ssh-terminal-reopen" class="secondary-button" disabled>셸 다시 열기</button></div><div id="ssh-terminal" aria-label="원격 SSH 터미널"></div><label class="follow-folder"><input id="ssh-follow" type="checkbox"> Follow terminal folder</label><p>켜면 Bash/Zsh에서 cd 후 원격 파일 폴더도 이동합니다.</p></section></section>`;
  original.after(screen);
  const dialog=el('dialog');dialog.id='ssh-dialog';
  dialog.innerHTML=`<form id="ssh-form"><h2>SSH 연결</h2><label>저장된 세션<div class="ssh-key-row"><select id="ssh-saved"><option value="">새 연결</option></select><button id="ssh-saved-remove" type="button">저장 삭제</button></div></label><label>세션 이름 (선택)<input name="label" maxlength="120" placeholder="예: 개발 서버"></label><label>호스트 또는 SSH 별칭<input name="host" required placeholder="예: my-server 또는 192.168.0.10" autocomplete="off"></label><div class="ssh-form-pair"><label>사용자 이름<input name="username" placeholder="SSH 설정에서 자동 입력" autocomplete="username"></label><label>포트<input name="port" type="number" min="1" max="65535" placeholder="설정값 또는 22"></label></div><label>인증 방식<select name="authMode"><option value="password">비밀번호</option><option value="default-key" selected>개인키 자동 식별 (기본 .ssh 폴더)</option></select></label><label id="ssh-passphrase-field">개인키 암호 (잠긴 키에만 필요)<input name="passphrase" type="password" autocomplete="off"></label><label id="ssh-password-field" hidden>서버 비밀번호<input name="password" type="password" autocomplete="current-password"></label><p class="ssh-auth-note">연결 성공 시 호스트 정보가 저장됩니다. 비밀번호·키 암호는 저장하지 않습니다.</p><p id="ssh-form-error" role="alert"></p><div class="dialog-actions"><button id="ssh-form-cancel" type="button" class="secondary-button">취소</button><button type="submit" class="primary-button">연결</button></div></form>`;
  document.body.append(dialog);
  let connected=false,busy=false,connecting=false,openingTerminal=false,terminalReady=false,term,fit,local={path:'',entries:[],selected:new Set(),ticket:0},remote={path:'',entries:[],selected:new Set(),ticket:0};
  const status=message=>{$('#ssh-status').textContent=message;};
  function controls(){
    $('#ssh-connect').disabled=busy||connecting||connected;
    $('#ssh-disconnect').disabled=!connected||busy;
    $('#ssh-upload').disabled=!connected||busy||local.loading||remote.loading||!local.selected.size||!remote.path;
    $('#ssh-download').disabled=!connected||busy||local.loading||remote.loading||!remote.selected.size||!local.path;
    $('#ssh-terminal-reopen').disabled=!connected||terminalReady||openingTerminal;
    for(const selector of ['#ssh-local .ssh-path','#ssh-remote .ssh-path'])for(const control of document.querySelectorAll(selector+' input,'+selector+' button'))control.disabled=busy||((selector.includes('remote'))&&!connected);
  }
  function draw(which){
    const state=which==='local'?local:remote,container=$('#ssh-'+which+' .ssh-file-list');container.replaceChildren();
    $('#ssh-'+which+' .ssh-path input').value=state.path;
    if(!state.entries.length)container.append(el('p','빈 폴더입니다.'));
    for(const entry of [...state.entries].sort((a,b)=>(b.type==='folder')-(a.type==='folder')||a.name.localeCompare(b.name,undefined,{numeric:true}))){
      const row=el('div',undefined,'ssh-file-row'),check=el('input');check.type='checkbox';check.checked=state.selected.has(entry.path);check.setAttribute('aria-label',entry.name+' 선택');check.disabled=busy;
      check.onchange=()=>{check.checked?state.selected.add(entry.path):state.selected.delete(entry.path);controls();};
      const name=el('button',(entry.type==='folder'?'📁 ':entry.type==='link'?'↗ ':'')+entry.name,'ssh-file-name');name.type='button';name.title=entry.name;name.disabled=busy;
      name.onclick=()=>{if(entry.type==='folder')load(which,entry.path);else{check.checked=!check.checked;check.onchange();}};
      const size=el('small',entry.type==='folder'?'폴더':entry.size===undefined?'':new Intl.NumberFormat('ko-KR').format(entry.size)+' B');row.append(check,name,size);container.append(row);
    }
    controls();
  }
  async function load(which,path){
    const state=which==='local'?local:remote;if(!path||busy)return;
    const ticket=++state.ticket;state.loading=true;controls();
    try{const listing=unwrap(await (which==='local'?api.listDirectory(path):api.sftpList(path)));if(ticket!==state.ticket)return;Object.assign(state,listing);state.selected.clear();draw(which);}
    catch(error){if(ticket===state.ticket){$('#ssh-'+which+' .ssh-path input').value=state.path;status(error.message);}}
    finally{if(ticket===state.ticket)state.loading=false;controls();}
  }
  for(const which of ['local','remote']){
    const form=$('#ssh-'+which+' .ssh-path');form.onsubmit=event=>{event.preventDefault();load(which,form.querySelector('input').value);};
    form.querySelector('[data-up]').onclick=()=>{const state=which==='local'?local:remote;load(which,state.parent);};
    form.querySelector('[data-refresh]').onclick=()=>load(which,which==='local'?local.path:remote.path);
  }
  function resize(){if(screen.hidden||!fit||!term)return;fit.fit();if(connected&&terminalReady)api.sshResize({cols:Math.min(500,term.cols),rows:Math.min(200,term.rows)}).then(result=>{if(!result.ok)status(result.error.message);});}
  function setupTerminal(){
    if(term)return;
    const nonce=$('meta[name="pane-style-nonce"]').content;
    const terminalDocument=new Proxy(document,{get(target,key){if(key==='createElement')return(tag,...args)=>{const node=target.createElement(tag,...args);if(tag.toLowerCase()==='style')node.nonce=nonce;return node;};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    term=new window.Terminal({documentOverride:terminalDocument,cursorBlink:true,fontSize:fontSize(),fontFamily:'Consolas, "Malgun Gothic", monospace',scrollback:5000,theme:{background:'#111820',foreground:'#e6edf3'},allowProposedApi:false});
    fit=new window.FitAddon.FitAddon();term.loadAddon(fit);term.open($('#ssh-terminal'));resize();
    let inputQueue=Promise.resolve();term.onData(data=>{if(!terminalReady)return;inputQueue=inputQueue.then(async()=>{for(let i=0;i<data.length;i+=8000)unwrap(await api.sshInput(data.slice(i,i+8000)));}).catch(error=>status(error.message));});
    api.onSshOutput(value=>{if(value.data)term.write(Uint8Array.from(atob(value.data),c=>c.charCodeAt(0)),()=>{if(value.id)api.sshAck({id:value.id,bytes:value.bytes}).catch(()=>{});});if(value.closed){terminalReady=false;term.writeln('\r\n[셸 종료]');controls();}});
    new ResizeObserver(resize).observe($('#ssh-terminal'));
  }
  async function openTerminal(){
    if(openingTerminal)return;openingTerminal=true;controls();
    try{setupTerminal();term.clear();if(api.sshFollow)unwrap(await api.sshFollow($('#ssh-follow').checked));const opened=unwrap(await api.sshOpen({cols:Math.min(500,term.cols),rows:Math.min(200,term.rows)}));if(opened?.followSupported===false&&$('#ssh-follow').checked)status('현재 셸에서는 폴더 따라가기를 사용할 수 없습니다. Bash/Zsh에서 지원합니다.');terminalReady=true;resize();term.focus();}
    catch(error){status('파일 연결은 유지됩니다. 터미널: '+error.message);}finally{openingTerminal=false;controls();}
  }
  let previousSelection;
  function show(){original.hidden=true;screen.hidden=false;previousSelection=$('#workspaces .selected');previousSelection?.classList.remove('selected');nav.classList.add('selected');if(!local.path)load('local',getLocalPath());resize();}
  nav.onclick=show;
  $('.sidebar').addEventListener('click',event=>{if(event.target.closest('button')&&!event.target.closest('#ssh-menu,#multi-menu')){screen.hidden=true;original.hidden=false;nav.classList.remove('selected');previousSelection?.classList.add('selected');}});
  $('#ssh-connect').onclick=()=>{if(!api?.sftpConnect){status('SSH 연결은 데스크톱 앱에서 사용할 수 있습니다.');return;}$('#ssh-form-error').textContent='';dialog.showModal();$('#ssh-form [name=host]').focus();};
  $('#ssh-form-cancel').onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(connecting)event.preventDefault();});
  const form=$('#ssh-form');
  let profiles=[];
  async function refreshProfiles(){
    if(!api?.sshProfiles)return;
    try{profiles=unwrap(await api.sshProfiles());const select=$('#ssh-saved'),previous=select.value;select.replaceChildren(new Option('새 연결',''));for(const item of profiles)select.add(new Option(item.label+' · '+item.username+'@'+item.host+':'+item.port,item.id));select.value=profiles.some(item=>item.id===previous)?previous:'';$('#ssh-saved-remove').disabled=!select.value;}
    catch(error){status(error.message);}
  }
  form.elements.authMode.onchange=()=>{const password=form.elements.authMode.value==='password';$('#ssh-password-field').hidden=!password;$('#ssh-passphrase-field').hidden=password;form.elements.password.required=password;};
  $('#ssh-saved').onchange=()=>{const saved=profiles.find(item=>item.id===$('#ssh-saved').value);if(saved)for(const name of ['host','username','port','authMode','label'])form.elements[name].value=saved[name];else form.reset();form.elements.password.value='';form.elements.passphrase.value='';form.elements.authMode.onchange();$('#ssh-saved-remove').disabled=!saved;};
  $('#ssh-saved-remove').onclick=async()=>{const id=$('#ssh-saved').value;if(!id)return;try{unwrap(await api.sshProfileRemove(id));await refreshProfiles();window.dispatchEvent(new Event('ssh-profiles-changed'));}catch(error){$('#ssh-form-error').textContent=error.message;}};
  refreshProfiles();
  let pendingDirectory='',followTimer;
  try{$('#ssh-follow').checked=localStorage.getItem('pane-follow-terminal')!=='false';}catch{$('#ssh-follow').checked=true;}
  function followPending(){if(busy||!connected||!$('#ssh-follow').checked||!pendingDirectory)return;const directory=pendingDirectory;pendingDirectory='';if(directory!==remote.path)load('remote',directory);}
  $('#ssh-follow').onchange=async()=>{const enabled=$('#ssh-follow').checked;try{localStorage.setItem('pane-follow-terminal',String(enabled));}catch{}if(!enabled){pendingDirectory='';clearTimeout(followTimer);remote.ticket++;remote.loading=false;controls();}try{if(api?.sshFollow)unwrap(await api.sshFollow(enabled));}catch(error){status(error.message);}};
  api?.onSshDirectory?.(value=>{if(!$('#ssh-follow').checked)return;pendingDirectory=value.path;clearTimeout(followTimer);followTimer=setTimeout(followPending,100);});
  form.onsubmit=async event=>{
    event.preventDefault();if(connecting)return;connecting=true;controls();
    const input=Object.fromEntries(new FormData(form));if(input.authMode!=='password')delete input.password;else delete input.passphrase;
    for(const item of form.elements)item.disabled=true;$('#ssh-form-error').textContent='연결 중…';
    try{const session=unwrap(await api.sftpConnect(input));connected=true;remote.path=session.path;$('#ssh-connection-label').textContent=`${session.username}@${session.host}:${session.port}`;dialog.close();status('연결되었습니다. 항목을 선택한 뒤 업로드 또는 다운로드를 누르세요.');await Promise.all([load('remote',session.path),local.path?Promise.resolve():load('local',getLocalPath())]);await openTerminal();await refreshProfiles();window.dispatchEvent(new Event('ssh-profiles-changed'));if(session.warning)status(session.warning);}
    catch(error){$('#ssh-form-error').textContent=error.message;status(error.message);}
    finally{form.elements.password.value='';form.elements.passphrase.value='';connecting=false;for(const item of form.elements)item.disabled=false;controls();}
  };
  function lost(){pendingDirectory='';clearTimeout(followTimer);connected=false;terminalReady=false;remote.ticket++;remote.loading=false;remote.entries=[];remote.path='';remote.selected.clear();draw('remote');$('#ssh-connection-label').textContent='연결되지 않음';status('SSH 연결이 종료되었습니다.');controls();}
  api?.onSshState?.(value=>{if(!value.connected)lost();});
  $('#ssh-disconnect').onclick=async()=>{try{unwrap(await api.sftpDisconnect());lost();}catch(error){status(error.message);}};
  $('#ssh-terminal-reopen').onclick=openTerminal;
  async function transfer(direction){
    if(busy||!connected)return;
    const source=direction==='upload'?local:remote,destination=direction==='upload'?remote:local;
    const request={direction,sources:[...source.selected],destination:destination.path};
    if(!request.sources.length)return;
    busy=true;controls();draw('local');draw('remote');status(`${request.sources.length}개 항목 → ${request.destination} 전송 중…`);
    try{const result=unwrap(await api.sftpTransfer(request));status(`${result.completed.length}개 완료, ${result.failed.length}개 실패. 대상: ${request.destination}`+(result.failed.length?' '+result.failed.map(x=>x.source+': '+x.message).join(' / '):''));}
    catch(error){status(error.message);}
    finally{busy=false;await Promise.all([load('local',local.path),connected?load('remote',remote.path):Promise.resolve()]);controls();followPending();}
  }
  $('#ssh-upload').onclick=()=>transfer('upload');$('#ssh-download').onclick=()=>transfer('download');
  api?.onSftpProgress?.(value=>{if(!value.finished)status(`${value.direction==='upload'?'업로드':'다운로드'}: ${value.path} · ${Math.round(value.bytes/1024).toLocaleString()} KB`);});
  const fontControl=el('label',undefined,'font-control');fontControl.append(el('span','글자 크기'));
  const select=el('select');select.id='font-size';select.setAttribute('aria-label','글자 크기');for(const size of [11,12,13,14,16,18,20]){const option=el('option',size+'px');option.value=String(size);select.append(option);}select.value=String(fontSize());fontControl.append(select);$('.appbar').insertBefore(fontControl,$('#theme-toggle'));
  function fontSize(){try{const value=Number(localStorage.getItem('pane-font-size'));return [11,12,13,14,16,18,20].includes(value)?value:13;}catch{return 13;}}
  function applyFont(){document.documentElement.style.setProperty('--font-scale',String(Number(select.value)/13));if(term){term.options.fontSize=Number(select.value);resize();}}
  select.onchange=()=>{try{localStorage.setItem('pane-font-size',select.value);}catch{}applyFont();window.dispatchEvent(new CustomEvent('pane-font-changed',{detail:Number(select.value)}));};applyFont();
  initMultiTerminal({onShow:()=>{screen.hidden=true;original.hidden=true;nav.classList.remove('selected');},onHide:()=>{if(screen.hidden)original.hidden=false;}});
  controls();
}
