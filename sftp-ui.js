export function installSftp(api) {
  const {$,bridge,escapeHtml:esc}=api;
  const button=document.createElement('button');button.className='toolbar-button';button.id='sftp-button';button.textContent='SSH / SFTP';
  $('.toolbar-actions').append(button);
  const dialog=document.createElement('dialog');dialog.id='sftp-dialog';dialog.setAttribute('aria-label','SSH / SFTP 파일 전송');
  dialog.innerHTML=`<div class="dialog-topline"><h2>SSH / SFTP 파일 전송</h2><button id="sftp-close" aria-label="닫기">×</button></div>
    <form id="sftp-connect-form" class="sftp-connect-grid">
      <label>호스트<input name="host" required placeholder="server.example.com" autocomplete="off"></label><label>포트<input name="port" type="number" min="1" max="65535" value="22" required></label>
      <label>사용자<input name="username" required autocomplete="off"></label><label>비밀번호<input name="password" type="password" autocomplete="off"></label>
      <label>개인키 파일 경로 (선택)<input name="privateKeyPath" placeholder="C:\\Users\\…\\.ssh\\id_ed25519" autocomplete="off"></label><label>개인키 암호 (선택)<input name="passphrase" type="password" autocomplete="off"></label>
      <button class="primary-button" id="sftp-connect">연결</button>
    </form><p class="dialog-subtitle">SFTP로 파일을 복사합니다. 원본은 유지하며 같은 이름의 대상은 덮어쓰지 않습니다. 비밀번호와 개인키 암호는 저장하지 않습니다.</p>
    <div id="sftp-browser" hidden><form id="sftp-path-form"><button type="button" id="sftp-up" aria-label="원격 상위 폴더">↑</button><input id="sftp-path" aria-label="원격 폴더 경로"><button>이동</button><button type="button" id="sftp-disconnect">연결 종료</button></form>
      <p id="sftp-local"></p><div class="sftp-actions"><button id="sftp-download">원격 선택 항목 → 현재 로컬 폴더</button><button id="sftp-upload">로컬 선택 항목 → 원격 폴더</button></div><div id="sftp-entries"></div></div><p id="sftp-status" role="status"></p>`;
  document.body.append(dialog);
  let connected=false,pending=false,remote='/',parent=null,entries=[],token=0;
  let local='',localSources=[];
  const status=text=>{$('#sftp-status').textContent=text;};
  function lock(value){pending=value;dialog.querySelectorAll('button,input').forEach(el=>{el.disabled=value;});}
  async function checked(request){const response=await request;if(!response?.ok)throw new Error(response?.error?.message||'SFTP 작업 실패');return response.value;}
  async function browse(path){
    const id=++token;status('원격 폴더 조회 중…');
    const value=await checked(bridge.sftpList(path));if(id!==token)return;
    remote=value.path;parent=value.parent;entries=value.entries.sort((a,b)=>a.type===b.type?a.name.localeCompare(b.name):a.type==='folder'?-1:1);
    $('#sftp-path').value=remote;
    $('#sftp-entries').innerHTML=entries.slice(0,5000).map((entry,index)=>`<div class="sftp-row"><input type="checkbox" data-remote-select="${index}" aria-label="${esc(entry.name)} 선택" ${entry.type==='link'?'disabled':''}><button data-remote-open="${index}" title="${esc(entry.path)}">${entry.type==='folder'?'📁':'📄'} ${esc(entry.name)}</button><span>${entry.type==='file'?api.sizeText(entry.size):entry.type==='link'?'링크':'폴더'}</span></div>`).join('');
    status(`${entries.length}개 항목${entries.length>5000?' · 처음 5,000개 표시':''}`);
  }
  button.onclick=()=>{if(!api.ready)return;if(!bridge?.sftpConnect){api.showToast('SFTP는 데스크톱 앱에서 사용할 수 있습니다.');return;}local=api.activePane().path;localSources=api.selectedFiles().map(f=>f.path);$('#sftp-local').textContent=`로컬 대상: ${local} · 업로드 선택 ${localSources.length}개`;dialog.showModal();};
  $('#sftp-close').onclick=()=>dialog.close();dialog.addEventListener('cancel',event=>{if(pending)event.preventDefault();});
  $('#sftp-connect-form').onsubmit=async event=>{
    event.preventDefault();if(pending)return;
    const input=Object.fromEntries(new FormData(event.target));
    lock(true);status('SSH 연결 중…');
    try{const value=await checked(bridge.sftpConnect(input));connected=true;$('#sftp-browser').hidden=false;await browse(value.path);}
    catch(e){connected=false;$('#sftp-browser').hidden=true;status(e.message);}
    finally{event.target.elements.password.value='';event.target.elements.passphrase.value='';input.password='';input.passphrase='';lock(false);}
  };
  $('#sftp-path-form').onsubmit=event=>{event.preventDefault();if(connected&&!pending)browse($('#sftp-path').value).catch(e=>status(e.message));};
  $('#sftp-up').onclick=()=>{if(parent&&!pending)browse(parent).catch(e=>status(e.message));};
  $('#sftp-entries').ondblclick=event=>{const button=event.target.closest('[data-remote-open]');if(button&&!pending){const entry=entries[Number(button.dataset.remoteOpen)];if(entry.type==='folder')browse(entry.path).catch(e=>status(e.message));}};
  $('#sftp-disconnect').onclick=async()=>{try{await checked(bridge.sftpDisconnect());connected=false;$('#sftp-browser').hidden=true;status('연결을 종료했습니다.');}catch(e){status(e.message);}};
  async function transfer(direction){
    if(!connected||pending||api.busy)return;
    const sources=direction==='download'?[...dialog.querySelectorAll('[data-remote-select]:checked')].map(el=>entries[Number(el.dataset.remoteSelect)].path):localSources;
    if(!sources.length){status('전송할 항목을 선택하세요. 업로드 항목은 이 창을 열기 전에 로컬 패널에서 선택합니다.');return;}
    lock(true);status('SFTP 전송 중…');
    try{
      const result=await checked(bridge.sftpTransfer({direction,sources,destination:direction==='download'?local:remote}));
      await api.refreshAffected(path=>path===local);await browse(remote);
      status(`완료 ${result.completed.length}개 · 실패 ${result.failed.length}개`+(result.failed.length?'\n'+result.failed.map(e=>`${e.source}\n${e.destination}\n${e.message}`).join('\n'):''));
    }catch(e){status(e.message);}finally{lock(false);}
  }
  $('#sftp-download').onclick=()=>transfer('download');$('#sftp-upload').onclick=()=>transfer('upload');
  bridge?.onSftpProgress?.(value=>{if(pending&&!value.finished)status(`전송 중 · ${api.sizeText(value.bytes)} · ${value.path}`);});
}
