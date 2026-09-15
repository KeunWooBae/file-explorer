'use strict';
const { Client } = require('ssh2');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { mutationPath, noLinkAncestors } = require('./file-operations.cjs');
const { resolveAuth, checkKnownHosts } = require('./ssh-auth.cjs');
const { createDirectoryParser, integrationCommand } = require('./ssh-directory.cjs');
const { validateName } = require('./explorer-actions.cjs');
function remotePath(value) {
  if(typeof value!=='string'||!value.startsWith('/')||value.length>32767||value.includes('\0'))throw new Error('원격 폴더의 절대 경로를 입력하세요.');
  return path.posix.normalize(value);
}
function createSftpService({ directory, confirmHost, onProgress = () => {}, onTerminal = () => {}, onState = () => {}, onDirectory = () => {}, authOptions }) {
  let terminalFlow, directoryParser, directoryToken, follow=false, integrated=false, lastDirectory;
  let connection, sftp, terminal, connecting=false, busy=false;
  const hostsFile=path.join(directory,'ssh-known-hosts.json');
  const call=(method,...args)=>new Promise((resolve,reject)=>{
    if(!sftp)return reject(new Error('SFTP 연결이 필요합니다.'));
    sftp[method](...args,(error,value)=>error?reject(error):resolve(value));
  });
  async function disconnect(){if(busy)throw new Error('파일 전송이 끝난 후 연결을 종료하세요.');terminal?.close();terminal=null;connection?.end();connection=null;sftp=null;}
  async function connect(input) {
    if(connecting||busy)throw new Error('연결 또는 전송 작업이 진행 중입니다.');
    await disconnect();connecting=true;
    const client=new Client();connection=client;
    let hostError;
    try {
      const auth=await resolveAuth(input,authOptions);
      const {host,port,username}=auth;
      await new Promise((resolve,reject)=>{
        const finishError=error=>reject(hostError||(error.level==='client-authentication'?new Error('SSH 인증 실패: 사용자 이름과 기본 .ssh 폴더의 개인키를 확인하세요. 잠긴 키는 키 암호를 입력하세요. '+auth.diagnostics.join(', ')):error));
        client.once('ready',resolve);client.on('error',finishError);client.on('close',()=>{if(connection===client){connection=null;sftp=null;terminal=null;onState({connected:false});}reject(new Error('SSH 연결이 종료되었습니다.'));});
        client.connect({host,port,username,authHandler:auth.attempts,readyTimeout:30000,keepaliveInterval:15000,
          hostVerifier(raw,callback){
            (async()=>{
              const fingerprint='SHA256:'+createHash('sha256').update(raw).digest('base64').replace(/=+$/,'');
              const id=`${host}:${port}`;
              const known=await checkKnownHosts(auth.knownHosts,auth.hostAlias||host,port,raw);
              let hosts={};try{hosts=JSON.parse(await fs.readFile(hostsFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('저장된 SSH 서버 키를 읽을 수 없습니다.');}
              if(Object.hasOwn(hosts,id)){
                if(hosts[id]!==fingerprint)throw new Error('SSH 서버 키가 이전 연결과 다릅니다. 서버 관리자에게 확인하세요.');
              }else if(!known){
                if(!await confirmHost({host,port,fingerprint}))return callback(false);
                hosts[id]=fingerprint;await fs.mkdir(directory,{recursive:true});const temp=hostsFile+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(hosts,null,2),{mode:0o600,flag:'wx'});await fs.rename(temp,hostsFile);
              }
              callback(true);
            })().catch(e=>{hostError=e;callback(false);});
          }
        });
      });
      sftp=await new Promise((resolve,reject)=>client.sftp((e,value)=>e?reject(e):resolve(value)));
      const home=await call('realpath','.');
      return {host,port,username,path:home};
    }catch(e){client.destroy();if(connection===client){connection=null;sftp=null;}throw e;}
    finally{connecting=false;}
  }
  async function list(input){
    const directory=remotePath(input);const entries=await call('readdir',directory);
    return {path:directory,parent:directory==='/'?null:path.posix.dirname(directory),entries:entries.filter(e=>!['.','..'].includes(e.filename)).map(e=>({name:e.filename,path:path.posix.join(directory,e.filename),type:e.attrs.isDirectory()?'folder':e.attrs.isFile()?'file':'link',size:e.attrs.size,modified:new Date(e.attrs.mtime*1000).toISOString()}))};
  }
  async function transfer(input) {
    if(busy)throw new Error('다른 SFTP 전송이 진행 중입니다.');
    if(!sftp)throw new Error('SFTP 연결이 필요합니다.');
    if(!['download','upload'].includes(input?.direction)||!Array.isArray(input.sources)||!input.sources.length||input.sources.length>1000)throw new Error('전송 항목을 확인하세요.');
    const download=input.direction==='download';
    const destination=download?mutationPath(input.destination):remotePath(input.destination);
    if(download)await noLinkAncestors(destination);
    busy=true;let bytes=0,items=0;
    const result={completed:[],failed:[]};
    const progress=filename=>new Transform({transform(chunk,enc,cb){bytes+=chunk.length;onProgress({direction:input.direction,bytes,path:filename});cb(null,chunk);}});
    async function copy(source,target,depth=0){
      if(depth>100 || ++items>100000)throw new Error('전송 항목 또는 폴더 깊이 제한을 초과했습니다.');
      if(download){
        const stat=await call('lstat',source);
        await noLinkAncestors(path.win32.dirname(target));
        if(stat.isDirectory()){
          await fs.mkdir(target);
          for(const entry of await call('readdir',source)){
            if(['.','..'].includes(entry.filename))continue;
            validateName(entry.filename);
            await copy(path.posix.join(source,entry.filename),mutationPath(path.win32.join(target,entry.filename)),depth+1);
          }
          await fs.utimes(target,stat.atime,stat.mtime);
        }else if(stat.isFile()){
          const handle=await fs.open(target,'wx');
          const identity=await handle.stat();
          try{await pipeline(sftp.createReadStream(source),progress(source),handle.createWriteStream());await fs.utimes(target,stat.atime,stat.mtime);}
          catch(e){await handle.close().catch(()=>{});const current=await fs.lstat(target).catch(()=>null);if(current && current.dev===identity.dev && current.ino===identity.ino && !current.isSymbolicLink())await fs.unlink(target).catch(()=>{});throw e;}
        }else throw new Error('심볼릭 링크는 전송하지 않습니다.');
      }else{
        await noLinkAncestors(source);const stat=await fs.lstat(source);
        if(stat.isDirectory()){
          await call('mkdir',target,{mode:0o755});
          for(const name of await fs.readdir(source))await copy(mutationPath(path.win32.join(source,name)),path.posix.join(target,name),depth+1);
          await call('utimes',target,Math.floor(stat.atimeMs/1000),Math.floor(stat.mtimeMs/1000));
        }else if(stat.isFile()){
          const handle=await fs.open(source,'r');
          try{await pipeline(handle.createReadStream(),progress(source),sftp.createWriteStream(target,{flags:'wx',mode:0o600}));await call('utimes',target,Math.floor(stat.atimeMs/1000),Math.floor(stat.mtimeMs/1000));}
          finally{await handle.close().catch(()=>{});}
        }else throw new Error('일반 파일·폴더만 전송할 수 있습니다.');
      }
    }
    try{
      for(const value of input.sources){
        let target='';
        try{
          const source=download?remotePath(value):mutationPath(value);
          const name=download?path.posix.basename(source):path.win32.basename(source);validateName(name);
          target=download?mutationPath(path.win32.join(destination,name)):path.posix.join(destination,name);
          await copy(source,target);result.completed.push({source,destination:target});
        }catch(e){result.failed.push({source:value,destination:target,message:e.message+' 부분 전송된 대상이 남아 있을 수 있습니다. 원본은 유지됩니다.'});}
      }
      return result;
    }finally{busy=false;onProgress({finished:true,bytes});}
  }

  async function openTerminal(size) {
    if(!connection)throw new Error('SSH 연결이 필요합니다.');
    terminal?.close();terminal=null;
    const client=connection;
    const followSupported=size.followSupport!==false && await new Promise(resolve=>{
      let done=false,channel;const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value);};
      const timer=setTimeout(()=>{channel?.close();finish(false);},3000);
      client.exec('printf "%s" "$SHELL"',(error,stream)=>{if(error)return finish(false);channel=stream;if(done){stream.close();return;}let text='';stream.on('data',chunk=>{text+=chunk.toString();if(text.length>2048){stream.close();finish(false);}});stream.on('error',()=>finish(false));stream.on('close',()=>finish(/(?:^|\/)(?:bash|zsh)$/.test(text.trim())));});
    });
    const stream=await new Promise((resolve,reject)=>client.shell({term:'xterm-256color',cols:80,rows:24},(e,s)=>e?reject(e):resolve(s)));
    if(connection!==client){stream.close();throw new Error('SSH 연결이 종료되었습니다.');}
    terminal=stream;integrated=false;lastDirectory=undefined;directoryToken=randomUUID().replaceAll('-','');directoryParser=createDirectoryParser(directoryToken,directory=>{lastDirectory=directory;if(follow)onDirectory(directory);});
    const flow={id:randomUUID(),pending:0,stream};terminalFlow=flow;
    const output=data=>{if(terminal!==stream)return;directoryParser(data);flow.pending+=data.length;if(flow.pending>=262144){stream.pause();stream.stderr.pause();}onTerminal({data:data.toString('base64'),id:flow.id,bytes:data.length});};
    stream.on('data',output);stream.stderr.on('data',output);
    stream.on('error',()=>onTerminal({closed:true}));
    stream.on('close',()=>{if(terminal===stream){terminal=null;onTerminal({closed:true});}});
    resizeTerminal(size);if(followSupported){await writeTerminal(integrationCommand(directoryToken));integrated=true;}return {followSupported};
  }
  async function setFollow(enabled){
    if(typeof enabled!=='boolean')throw new Error('폴더 동기화 설정이 올바르지 않습니다.');
    follow=enabled;
    if(enabled&&lastDirectory)onDirectory(lastDirectory);
    return {enabled};
  }
  function writeTerminal(data){
    if(!terminal)throw new Error('SSH 터미널이 연결되어 있지 않습니다.');
    if(typeof data!=='string'||Buffer.byteLength(data)>65536)throw new Error('터미널 입력이 너무 큽니다.');
    return new Promise((resolve,reject)=>terminal.write(data,error=>error?reject(error):resolve(null)));
  }
  function acknowledgeTerminal(input){
    const flow=terminalFlow;if(!flow||input?.id!==flow.id||terminal!==flow.stream)return null;
    if(!Number.isInteger(input.bytes)||input.bytes<0||input.bytes>flow.pending)throw new Error('터미널 수신 확인이 올바르지 않습니다.');
    flow.pending-=input.bytes;if(flow.pending<65536){flow.stream.resume();flow.stream.stderr.resume();}return null;
  }
  function resizeTerminal(size){
    if(!size||!Number.isInteger(size.cols)||!Number.isInteger(size.rows)||size.cols<2||size.cols>500||size.rows<1||size.rows>200)throw new Error('터미널 크기가 올바르지 않습니다.');
    terminal?.setWindow(size.rows,size.cols,0,0);return null;
  }

  return {connect,disconnect,list,transfer,openTerminal,writeTerminal,resizeTerminal,acknowledgeTerminal,setFollow};
}
module.exports={createSftpService,remotePath};
