const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const {generateKeyPairSync,createHmac}=require('node:crypto');const {resolveAuth,checkKnownHosts}=require('./ssh-auth.cjs');
test('OpenSSH alias uses private keys in default .ssh folder without password or agent',async()=>{
 const root=await fs.mkdtemp(path.join(__dirname,'../.checks/auth-'));await fs.mkdir(path.join(root,'.ssh'));const keyPath=path.join(root,'.ssh','custom-key');await fs.writeFile(keyPath,generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}));
 // ssh2 accepts native OpenSSH/RSA encodings; use an RSA fixture for interoperability.
 await fs.writeFile(keyPath,generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'}));
 const configPath=path.join(root,'config');await fs.writeFile(configPath,`Host deployed\n HostName 127.0.0.1\n User fixture-user\n Port 2202\n IdentityFile "${keyPath.replaceAll('\\','/')}"\n IdentitiesOnly yes\n`);
 const auth=await resolveAuth({host:'deployed'},{home:root,configPath});assert.equal(auth.host,'127.0.0.1');assert.equal(auth.port,2202);assert.equal(auth.username,'fixture-user');assert(auth.attempts.some(x=>x.type==='publickey'));assert(!auth.attempts.some(x=>x.type==='password'||x.type==='agent'));
 const override=await resolveAuth({host:'deployed',username:'other',port:2223},{home:root,configPath});assert.equal(override.username,'other');assert.equal(override.port,2223);
 await assert.rejects(resolveAuth({host:'-oProxyCommand=bad'},{home:root,configPath}));
});
test('known_hosts accepts plain and hashed names; changed or revoked keys are rejected',async()=>{
 const root=await fs.mkdtemp(path.join(__dirname,'../.checks/hosts-'));const file=path.join(root,'known_hosts'),raw=Buffer.from('fixture host public key'),other=Buffer.from('different');const token='[example.test]:2222';
 await fs.writeFile(file,`${token} ssh-ed25519 ${raw.toString('base64')}\n`);assert.equal(await checkKnownHosts([file],'example.test',2222,raw),true);await assert.rejects(checkKnownHosts([file],'example.test',2222,other),/다릅니다/);
 const salt=Buffer.from('fixture-salt'),hash=createHmac('sha1',salt).update(token).digest('base64');await fs.writeFile(file,`|1|${salt.toString('base64')}|${hash} ssh-ed25519 ${raw.toString('base64')}\n`);assert.equal(await checkKnownHosts([file],'example.test',2222,raw),true);assert.equal(await checkKnownHosts([file],'unknown.test',2222,raw),false);
 await fs.appendFile(file,`@revoked ${token} ssh-ed25519 ${raw.toString('base64')}\n`);await assert.rejects(checkKnownHosts([file],'example.test',2222,raw),/폐기/);
});
test('0.5 session keeps original workspace paths when added tabs are removed',async()=>{
 const {createSessionStore}=require('./session-store.cjs');const root=await fs.mkdtemp(path.join(__dirname,'../.checks/session-migrate-'));const pane={path:'C:\\kept',sort:'name',direction:1,tabs:['C:\\kept','D:\\extra'],activeTab:0};const workspace={name:'custom label',layout:2,active:0,panes:[pane,pane,pane,pane]};const saved={version:2,workspaceId:'extra',workspaces:{design:workspace,documents:workspace,extra:workspace}};await fs.writeFile(path.join(root,'session.json'),JSON.stringify(saved));const store=createSessionStore(root);const result=store.load();assert.equal(result.session.version,1);assert.equal(result.session.workspaceId,'design');assert.equal(result.session.workspaces.design.panes[0].path,'C:\\kept');assert.equal(result.session.workspaces.extra,undefined);assert.equal(JSON.parse(await fs.readFile(path.join(root,'session.json'),'utf8')).version,2);
});
