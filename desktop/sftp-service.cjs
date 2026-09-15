'use strict';
const { Client } = require('ssh2');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const { mutationPath, noLinkAncestors } = require('./file-operations.cjs');
const { validateName } = require('./explorer-actions.cjs');
function remotePath(value) {
  if(typeof value!=='string'||!value.startsWith('/')||value.length>32767||value.includes('\0'))throw new Error('원격 폴더의 절대 경로를 입력하세요.');
  return path.posix.normalize(value);
}
function createSftpService({ directory, confirmHost, onProgress = () => {} }) {
  let connection, sftp, connecting=false, busy=false;
  const hostsFile=path.join(directory,'ssh-known-hosts.json');
  const call=(method,...args)=>new Promise((resolve,reject)=>{
    if(!sftp)return reject(new Error('SFTP 연결이 필요합니다.'));
    sftp[method](...args,(error,value)=>error?reject(error):resolve(value));
  });
  async function disconnect(){if(busy)throw new Error('파일 전송이 끝난 후 연결을 종료하세요.');connection?.end();connection=null;sftp=null;}
  async function connect(input) {
    if(connecting||busy)throw new Error('연결 또는 전송 작업이 진행 중입니다.');
    if(!input || typeof input.host!=='string'||!input.host.trim()||input.host.length>253||/[\s\0]/.test(input.host)||typeof input.username!=='string'||!input.username||input.username.length>128)throw new Error('호스트와 사용자 이름을 확인하세요.');
    const port=Number(input.port||22);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('포트는 1~65535 범위여야 합니다.');
    await disconnect();connecting=true;
    const client=new Client();connection=client;
    let hostError;
    try {
      const key=input.privateKeyPath?await fs.readFile(mutationPath(input.privateKeyPath)):undefined;
      await new Promise((resolve,reject)=>{
        const finishError=error=>reject(hostError||error);
        client.once('ready',resolve);client.on('error',finishError);client.on('close',()=>{if(connection===client){connection=null;sftp=null;}reject(new Error('SSH 연결이 종료되었습니다.'));});
        client.connect({host:input.host.trim(),port,username:input.username,password:input.password||undefined,privateKey:key,passphrase:input.passphrase||undefined,readyTimeout:30000,keepaliveInterval:15000,
          hostVerifier(raw,callback){
            (async()=>{
              const fingerprint='SHA256:'+createHash('sha256').update(raw).digest('base64').replace(/=+$/,'');
              const id=`${input.host.trim()}:${port}`;
              let hosts={};try{hosts=JSON.parse(await fs.readFile(hostsFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw new Error('저장된 SSH 서버 키를 읽을 수 없습니다.');}
              if(Object.hasOwn(hosts,id)){
                if(hosts[id]!==fingerprint)throw new Error('SSH 서버 키가 이전 연결과 다릅니다. 서버 관리자에게 확인하세요.');
              }else{
                if(!await confirmHost({host:input.host.trim(),port,fingerprint}))return callback(false);
                hosts[id]=fingerprint;await fs.mkdir(directory,{recursive:true});const temp=hostsFile+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(hosts,null,2),{mode:0o600,flag:'wx'});await fs.rename(temp,hostsFile);
              }
              callback(true);
            })().catch(e=>{hostError=e;callback(false);});
          }
        });
      });
      sftp=await new Promise((resolve,reject)=>client.sftp((e,value)=>e?reject(e):resolve(value)));
      const home=await call('realpath','.');
      return {host:input.host.trim(),port,username:input.username,path:home};
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
  return {connect,disconnect,list,transfer};
}
module.exports={createSftpService,remotePath};
