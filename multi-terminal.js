const api=window.pane;
const $=selector=>document.querySelector(selector);
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const value=result=>{if(!result?.ok)throw new Error(result?.error?.message||'작업을 완료하지 못했습니다.');return result.value;};
export function initMultiTerminal({onShow,onHide}) {
  const nav=element('button',undefined,'sidebar-button');nav.id='multi-menu';nav.type='button';nav.title='Multi-Execution Terminal';
  nav.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="2" y="3" width="15" height="13" rx="2"/><path d="M7 20h13a2 2 0 0 0 2-2V8M6 7l3 3-3 3m6 0h2"/></svg><span>Multi-Execution Terminal</span>';
  $('#ssh-menu').after(nav);
  const screen=element('main',undefined,'multi-workspace');screen.hidden=true;
  screen.innerHTML='<header class="ssh-heading"><div><p class="workspace-eyebrow">여러 호스트에 함께 작업</p><h1>Multi-Execution Terminal</h1></div><button id="multi-refresh" class="secondary-button">세션 새로고침</button></header><section class="multi-session-bar"><div id="multi-profiles"></div><button id="multi-open" class="primary-button">선택한 세션 열기</button></section><p id="multi-status" role="status">SSH/SFTP에서 연결한 호스트가 여기에 저장됩니다.</p><section id="multi-terminals" class="multi-terminals"></section><section class="multi-controls"><form id="multi-command-form"><label for="multi-command">동시 실행 명령</label><textarea id="multi-command" rows="2" placeholder="예: hostname && pwd" aria-describedby="multi-command-targets"></textarea><div class="multi-command-actions"><span id="multi-command-targets"></span><button type="submit" class="primary-button">명령 동시 실행</button></div></form><div class="multi-file-controls"><div><button id="multi-pick-files" class="secondary-button">파일 선택</button><button id="multi-pick-folders" class="secondary-button">폴더 선택</button><button id="multi-upload" class="primary-button">선택 대상에 파일 전송</button></div><p id="multi-file-selection">전송할 파일·폴더를 선택하세요.</p><p>파일은 각 터미널 아래의 대상 폴더로 전송됩니다. ‘동시 명령 제외’와 파일 전송 대상은 독립적입니다.</p></div></section>';
  $('.ssh-workspace').after(screen);
  const credentials=element('dialog');credentials.id='multi-credentials';
  credentials.innerHTML='<form id="multi-credential-form"><h2 id="multi-credential-title"></h2><label id="multi-credential-label" for="multi-secret"></label><input id="multi-secret" type="password" autocomplete="off"><div class="dialog-actions"><button type="button" id="multi-secret-cancel" class="secondary-button">취소</button><button type="submit" class="primary-button">연결</button></div></form>';
  document.body.append(credentials);
  const cards=new Map();let profiles=[],files=[],opening=false,sending=false,uploading=false;
  const status=text=>{$('#multi-status').textContent=text;};
  const commandTargets=()=>[...cards.values()].filter(card=>card.ready&&!card.exclude.checked);
  const fileTargets=()=>[...cards.values()].filter(card=>card.connected&&card.fileTarget.checked);
  function controls(){
    $('#multi-open').disabled=opening||!$('#multi-profiles input:checked');
    $('#multi-refresh').disabled=opening;
    $('#multi-command-form button').disabled=sending||!commandTargets().length;
    $('#multi-command-targets').textContent=commandTargets().length+'개 터미널 대상 · '+[...cards.values()].filter(card=>card.exclude.checked).length+'개 제외';
    $('#multi-upload').disabled=uploading||!files.length||!fileTargets().length;
    $('#multi-pick-files').disabled=uploading;$('#multi-pick-folders').disabled=uploading;
    for(const card of cards.values()){card.close.disabled=uploading;card.destination.disabled=uploading;card.fileTarget.disabled=uploading;}
  }
  async function refreshProfiles(){
    if(!api?.sshProfiles){status('Multi-Execution은 데스크톱 앱에서 사용할 수 있습니다.');return;}
    try{profiles=value(await api.sshProfiles());const selected=new Set([...document.querySelectorAll('#multi-profiles input:checked')].map(node=>node.value));const list=$('#multi-profiles');list.replaceChildren();if(!profiles.length)list.append(element('p','저장된 세션이 없습니다. 먼저 SSH/SFTP에서 호스트에 연결하세요.'));for(const profile of profiles){const label=element('label',undefined,'multi-profile');const box=element('input');box.type='checkbox';box.value=profile.id;box.checked=selected.has(profile.id);box.onchange=controls;label.append(box,element('span',profile.label+' · '+profile.username+'@'+profile.host+':'+profile.port));list.append(label);}controls();}
    catch(error){status(error.message);}
  }
  function askSecret(profile,key=false){
    return new Promise(resolve=>{
      $('#multi-credential-title').textContent=profile.label;
      $('#multi-credential-label').textContent=key?'기본 .ssh 폴더 개인키 암호':'서버 비밀번호';
      const input=$('#multi-secret');input.value='';input.required=true;
      let settled=false;const finish=answer=>{if(settled)return;settled=true;input.value='';credentials.close();resolve(answer);};
      $('#multi-credential-form').onsubmit=event=>{event.preventDefault();finish(input.value);};$('#multi-secret-cancel').onclick=()=>finish(null);credentials.oncancel=event=>{event.preventDefault();finish(null);};
      credentials.showModal();input.focus();
    });
  }
  function addCard(session){
    const panel=element('section',undefined,'multi-terminal-card');panel.dataset.connectionId=session.connectionId;
    const header=element('header');const title=element('h2',session.label);const close=element('button','연결 종료','secondary-button');header.append(title,close);
    const address=element('p',session.username+'@'+session.host+':'+session.port,'multi-host');
    const terminal=element('div',undefined,'multi-terminal');terminal.setAttribute('aria-label',session.label+' SSH 터미널');
    const options=element('div',undefined,'multi-terminal-options');
    const excludeLabel=element('label'),exclude=element('input');exclude.type='checkbox';excludeLabel.append(exclude,document.createTextNode('동시 명령 제외'));
    const targetLabel=element('label'),fileTarget=element('input');fileTarget.type='checkbox';fileTarget.checked=true;targetLabel.append(fileTarget,document.createTextNode('파일 전송 대상'));
    const pathLabel=element('label','파일 대상 폴더'),destination=element('input');destination.value=session.path;destination.setAttribute('aria-label',session.label+' 파일 대상 폴더');pathLabel.append(destination);
    const result=element('p','셸 연결 중…','multi-result');result.setAttribute('role','status');options.append(excludeLabel,targetLabel,pathLabel,result);panel.append(header,address,terminal,options);$('#multi-terminals').append(panel);
    const nonce=$('meta[name="pane-style-nonce"]').content;
    const terminalDocument=new Proxy(document,{get(target,key){if(key==='createElement')return(tag,...args)=>{const node=target.createElement(tag,...args);if(tag.toLowerCase()==='style')node.nonce=nonce;return node;};const found=Reflect.get(target,key,target);return typeof found==='function'?found.bind(target):found;}});
    const term=new window.Terminal({documentOverride:terminalDocument,cursorBlink:true,fontSize:Number($('#font-size').value),fontFamily:'Consolas, "Malgun Gothic", monospace',scrollback:5000,theme:{background:'#111820',foreground:'#e6edf3'}});const fit=new window.FitAddon.FitAddon();term.loadAddon(fit);term.open(terminal);
    const card={...session,panel,close,exclude,fileTarget,destination,result,term,fit,ready:false,connected:true};cards.set(session.connectionId,card);
    let queue=Promise.resolve();term.onData(data=>{if(!card.ready)return;queue=queue.then(async()=>{for(let i=0;i<data.length;i+=8000)value(await api.sshMultiInput({id:card.connectionId,data:data.slice(i,i+8000)}));}).catch(error=>{result.textContent=error.message;});});
    const resize=()=>{if(screen.hidden)return;fit.fit();if(card.ready)api.sshMultiResize({id:card.connectionId,size:{cols:Math.min(term.cols,500),rows:Math.min(term.rows,200)}}).catch(()=>{});};
    card.resize=resize;card.observer=new ResizeObserver(resize);card.observer.observe(terminal);resize();
    exclude.onchange=()=>{panel.classList.toggle('broadcast-excluded',exclude.checked);controls();};fileTarget.onchange=controls;
    close.onclick=async()=>{try{value(await api.sshMultiClose(card.connectionId));card.observer.disconnect();term.dispose();cards.delete(card.connectionId);panel.remove();controls();}catch(error){result.textContent=error.message;}};
    return card;
  }
  $('#multi-open').onclick=async()=>{
    if(opening)return;const chosen=profiles.filter(profile=>[...document.querySelectorAll('#multi-profiles input:checked')].some(box=>box.value===profile.id));opening=true;controls();
    try{for(const profile of chosen){
      let password,passphrase;
      if(profile.authMode==='password'){password=await askSecret(profile);if(password===null)break;}
      status(profile.label+' 연결 중…');
      try{
        let result=await api.sshMultiConnect({profileId:profile.id,password});password=undefined;
        if(!result.ok&&profile.authMode==='default-key'&&/키|인증/.test(result.error?.message||'')){passphrase=await askSecret(profile,true);if(passphrase===null)break;result=await api.sshMultiConnect({profileId:profile.id,passphrase});passphrase=undefined;}
        const session=value(result),card=addCard(session);
        try{value(await api.sshMultiOpen({id:session.connectionId,size:{cols:Math.min(card.term.cols,500),rows:Math.min(card.term.rows,200)}}));card.ready=true;card.result.textContent='연결됨';card.resize();}
        catch(error){card.result.textContent='SSH 셸: '+error.message;}
        status(cards.size+'개 터미널이 열려 있습니다.');
      }catch(error){status(profile.label+': '+error.message);}
    }}finally{opening=false;controls();}
  };
  api?.onMultiOutput?.(message=>{const card=cards.get(message.connectionId);if(!card)return;if(message.data)card.term.write(Uint8Array.from(atob(message.data),c=>c.charCodeAt(0)),()=>{if(message.id)api.sshMultiAck({connectionId:message.connectionId,id:message.id,bytes:message.bytes}).catch(()=>{});});if(message.closed){card.ready=false;card.result.textContent='셸 종료';controls();}});
  api?.onMultiState?.(message=>{const card=cards.get(message.connectionId);if(card&&!message.connected){card.connected=false;card.ready=false;card.result.textContent='연결 종료';controls();}});
  api?.onMultiProgress?.(message=>{const card=cards.get(message.connectionId);if(card&&!message.finished)card.result.textContent=Math.round(message.bytes/1024).toLocaleString()+' KB 전송 중…';});
  $('#multi-command-form').onsubmit=async event=>{
    event.preventDefault();if(sending)return;const command=$('#multi-command').value;if(!command.trim())return;const targets=commandTargets();if(!targets.length)return;
    sending=true;controls();
    try{const results=value(await api.sshMultiBroadcast({ids:targets.map(card=>card.connectionId),data:command.replace(/\r?\n/g,'\r')+'\r'}));for(const result of results){const card=cards.get(result.id);if(card)card.result.textContent=result.ok?'명령 전송 완료':result.error;}status(results.filter(item=>item.ok).length+'개 터미널에 명령 전송 완료');}
    catch(error){status(error.message);}finally{sending=false;controls();}
  };
  async function pick(folder){try{const chosen=value(await api.sshUploadPicker(folder));if(chosen.length){files=chosen;$('#multi-file-selection').textContent=files.length+'개 선택: '+files.join(' / ');}controls();}catch(error){status(error.message);}}
  $('#multi-pick-files').onclick=()=>pick(false);$('#multi-pick-folders').onclick=()=>pick(true);
  $('#multi-upload').onclick=async()=>{
    if(uploading)return;const targets=fileTargets().map(card=>({id:card.connectionId,destination:card.destination.value}));if(!files.length||!targets.length)return;
    uploading=true;controls();status(targets.length+'개 호스트에 파일 전송 중…');
    try{const results=value(await api.sshMultiUpload({sources:files,targets}));for(const item of results){const card=cards.get(item.id);if(card)card.result.textContent=item.ok?item.result.completed.length+'개 완료 / '+item.result.failed.length+'개 실패'+(item.result.failed.length?' · '+item.result.failed.map(f=>f.message).join(' / '):''):item.error;}status('파일 전송이 끝났습니다. 각 터미널 아래 결과를 확인하세요.');}
    catch(error){status(error.message);}finally{uploading=false;controls();}
  };
  nav.onclick=()=>{onShow();screen.hidden=false;document.querySelectorAll('#workspaces .selected').forEach(node=>node.classList.remove('selected'));nav.classList.add('selected');refreshProfiles();for(const card of cards.values())card.resize();};
  $('.sidebar').addEventListener('click',event=>{if(event.target.closest('button')&&!event.target.closest('#multi-menu')){screen.hidden=true;nav.classList.remove('selected');onHide();}});
  $('#multi-refresh').onclick=refreshProfiles;
  window.addEventListener('ssh-profiles-changed',refreshProfiles);
  window.addEventListener('pane-font-changed',event=>{for(const card of cards.values()){card.term.options.fontSize=event.detail;card.resize();}});
  controls();
}
