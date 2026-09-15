'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const {generateKeyPairSync}=require('node:crypto');const {Server,utils}=require('ssh2');const {createSftpService}=require('./sftp-service.cjs');
test('real loopback SSH/SFTP verifies host keys and transfers both ways without overwrite',async()=>{
  const root=await fs.mkdtemp(path.join(__dirname,'../.checks/sftp-'));
  const remote=path.join(root,'remote'),local=path.join(root,'local');await fs.mkdir(remote);await fs.mkdir(local);await fs.mkdir(path.join(remote,'nested'));await fs.writeFile(path.join(remote,'nested/한글.txt'),'remote bytes');await fs.writeFile(path.join(local,'upload.txt'),'local bytes');
  const hostKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
  const clients=new Set();
  const server=new Server({hostKeys:[hostKey]},client=>{
    clients.add(client);client.on('close',()=>clients.delete(client));client.on('error',()=>{});
    client.on('authentication',ctx=>ctx.method==='password'&&ctx.username==='test'&&ctx.password==='fixture-password'?ctx.accept():ctx.reject());
    client.on('ready',()=>client.on('session',accept=>accept().on('sftp',accept=>{
      const stream=accept(),handles=new Map();let next=1;
      const disk=p=>{const full=path.resolve(remote,'.'+(p.startsWith('/')?p:'/'+p));if(full!==remote&&!full.startsWith(remote+path.sep))throw new Error('Escape');return full;};
      const handle=value=>{const id=Buffer.alloc(4);id.writeUInt32BE(next++);handles.set(id.toString('hex'),value);return id;};
      const attrs=s=>({mode:s.mode,size:s.size,uid:0,gid:0,atime:Math.floor(s.atimeMs/1000),mtime:Math.floor(s.mtimeMs/1000)});
      const on=(name,fn)=>stream.on(name,(id,...args)=>Promise.resolve().then(()=>fn(id,...args)).catch(e=>stream.status(id,e.code==='ENOENT'?2:4,e.message)));
      on('REALPATH',(id,p)=>stream.name(id,[{filename:p==='.'?'/':path.posix.normalize(p),longname:'',attrs:{}}]));
      for(const method of ['STAT','LSTAT'])on(method,async(id,p)=>stream.attrs(id,attrs(await fs.lstat(disk(p)))));
      on('OPENDIR',async(id,p)=>stream.handle(id,handle({dir:disk(p),names:await fs.readdir(disk(p)),sent:false})));
      on('READDIR',async(id,h)=>{const entry=handles.get(h.toString('hex'));if(entry.sent){stream.status(id,1);return;}entry.sent=true;const names=[];for(const name of entry.names)names.push({filename:name,longname:name,attrs:attrs(await fs.lstat(path.join(entry.dir,name)))});if(names.length)stream.name(id,names);else stream.status(id,1);});
      on('OPEN',async(id,p,flags)=>stream.handle(id,handle({file:await fs.open(disk(p),utils.sftp.flagsToString(flags))})));
      on('FSTAT',async(id,h)=>stream.attrs(id,attrs(await handles.get(h.toString('hex')).file.stat())));
      on('READ',async(id,h,offset,length)=>{const b=Buffer.alloc(length);const {bytesRead}=await handles.get(h.toString('hex')).file.read(b,0,length,offset);if(bytesRead)stream.data(id,b.subarray(0,bytesRead));else stream.status(id,1);});
      on('WRITE',async(id,h,offset,data)=>{await handles.get(h.toString('hex')).file.write(data,0,data.length,offset);stream.status(id,0);});
      on('CLOSE',async(id,h)=>{await handles.get(h.toString('hex'))?.file?.close();handles.delete(h.toString('hex'));stream.status(id,0);});
      on('MKDIR',async(id,p)=>{await fs.mkdir(disk(p));stream.status(id,0);});
      on('SETSTAT',async(id,p,values)=>{if(values.atime!==undefined)await fs.utimes(disk(p),values.atime,values.mtime);stream.status(id,0);});
    })));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const input={host:'127.0.0.1',port:server.address().port,username:'test',password:'fixture-password'};
  let prompts=0;const service=createSftpService({directory:root,confirmHost:async()=>{prompts++;return true;}});
  try{
    const connection=await service.connect(input);assert.equal(connection.path,'/');assert.equal(prompts,1);
    assert.equal((await service.list('/')).entries[0].name,'nested');
    const downloaded=await service.transfer({direction:'download',sources:['/nested'],destination:local});assert.equal(downloaded.failed.length,0,JSON.stringify(downloaded));assert.equal(await fs.readFile(path.join(local,'nested/한글.txt'),'utf8'),'remote bytes');
    const uploaded=await service.transfer({direction:'upload',sources:[path.join(local,'upload.txt')],destination:'/'});assert.equal(uploaded.failed.length,0,JSON.stringify(uploaded));assert.equal(await fs.readFile(path.join(remote,'upload.txt'),'utf8'),'local bytes');
    await fs.writeFile(path.join(local,'upload.txt'),'replacement');const conflict=await service.transfer({direction:'upload',sources:[path.join(local,'upload.txt')],destination:'/'});assert.equal(conflict.failed.length,1);assert.equal(await fs.readFile(path.join(remote,'upload.txt'),'utf8'),'local bytes');
    await service.disconnect();await service.connect(input);assert.equal(prompts,1);await service.disconnect();
    const known=JSON.parse(await fs.readFile(path.join(root,'ssh-known-hosts.json'),'utf8'));known[`127.0.0.1:${input.port}`]='SHA256:wrong';await fs.writeFile(path.join(root,'ssh-known-hosts.json'),JSON.stringify(known));await assert.rejects(service.connect(input),/서버 키/);
  }finally{await service.disconnect();for(const client of clients)client.end();await new Promise(resolve=>server.close(resolve));}
});
