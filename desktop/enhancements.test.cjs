'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createTransferManager}=require('./transfer-manager.cjs');
const {createTransferService}=require('./file-operations.cjs');
const {createSessionStore,validateSession}=require('./session-store.cjs');
const {preview,listArchive,extractEntry}=require('./content-service.cjs');
const {createExplorerActions}=require('./explorer-actions.cjs');
async function fixture(){const root=await fs.mkdtemp(path.join(__dirname,'../.checks/enhancements-'));const src=path.join(root,'source'),dst=path.join(root,'target');await fs.mkdir(src);await fs.mkdir(dst);return{root,src,dst};}
test('copied nested directories retain original modification times',async()=>{
  const f=await fixture();await fs.mkdir(path.join(f.src,'nested'));await fs.writeFile(path.join(f.src,'nested/a.txt'),'bytes');
  const date=new Date('2020-01-02T03:04:05Z');for(const dir of [f.src,path.join(f.src,'nested')])await fs.utimes(dir,date,date);
  const result=await createTransferService().transfer({sources:[f.src],destination:f.dst,operation:'copy'});assert.equal(result.completed.length,1);
  for(const dir of ['source','source/nested'])assert.equal((await fs.stat(path.join(f.dst,dir))).mtime.toISOString(),date.toISOString());
});
test('replacement preserves backup, undo restores original bytes and refuses later edits',async()=>{
  const f=await fixture();const src=path.join(f.src,'a.txt'),dst=path.join(f.dst,'a.txt');await fs.writeFile(src,'new');await fs.writeFile(dst,'old');const manager=createTransferManager();
  const result=await manager.transfer({sources:[src],destination:f.dst,operation:'copy',conflict:'replace'});assert.equal(result.completed.length,1);assert.equal(await fs.readFile(dst,'utf8'),'new');
  await fs.writeFile(dst,'externally changed');await assert.rejects(manager.undo(),/변경/);assert.equal(await fs.readFile(dst,'utf8'),'externally changed');
  const f2=await fixture();await fs.writeFile(path.join(f2.src,'a.txt'),'new');await fs.writeFile(path.join(f2.dst,'a.txt'),'old');const second=createTransferManager();
  await second.transfer({sources:[path.join(f2.src,'a.txt')],destination:f2.dst,operation:'copy',conflict:'replace'});await second.undo();assert.equal(await fs.readFile(path.join(f2.dst,'a.txt'),'utf8'),'old');assert.equal((await fs.readdir(f2.dst)).length,1);
});
test('merge moves children without replacing conflicts, and undo restores moved children',async()=>{
  const f=await fixture();await fs.mkdir(path.join(f.dst,'source'));await fs.writeFile(path.join(f.src,'a.txt'),'a');await fs.writeFile(path.join(f.src,'b.txt'),'b');await fs.writeFile(path.join(f.dst,'source/b.txt'),'old');
  const manager=createTransferManager();const result=await manager.transfer({sources:[f.src],destination:f.dst,operation:'move',conflict:'merge'});
  assert.equal(result.completed.length,1);assert.equal(result.skipped.length,1);assert.equal(await fs.readFile(path.join(f.dst,'source/b.txt'),'utf8'),'old');
  await manager.undo();assert.equal(await fs.readFile(path.join(f.src,'a.txt'),'utf8'),'a');assert.equal(await fs.readFile(path.join(f.src,'b.txt'),'utf8'),'b');
});
test('pause suspends between files; cancellation leaves no published partial tree',async()=>{
  const f=await fixture();for(let i=0;i<4;i++)await fs.writeFile(path.join(f.src,`${i}.txt`),'x'.repeat(1024));
  let manager,requested=false;manager=createTransferManager({onProgress:value=>{if(value.phase==='복사'&&!requested){requested=true;manager.control('pause');setTimeout(()=>manager.control('cancel'),80);}}});
  const result=await manager.transfer({sources:[f.src],destination:f.dst,operation:'copy'});assert.equal(result.cancelled,true);assert.equal(result.completed.length,0);assert.deepEqual(await fs.readdir(f.dst),[]);assert.equal((await fs.readdir(f.src)).length,4);
});
test('v2 workspace tabs save asynchronously in order, rejecting prototype keys',async()=>{
  const f=await fixture();const pane={path:f.src,sort:'name',direction:1,tabs:[f.src,f.dst],activeTab:1};
  const session={version:2,workspaceId:'space-a',workspaces:{'space-a':{name:'나의 자료',layout:2,active:0,panes:Array.from({length:4},()=>({...pane}))}}};
  const store=createSessionStore(f.root);const first=store.saveAsync(session);session.workspaces['space-a'].name='최종 이름';const second=store.saveAsync(session);await Promise.all([first,second]);assert.equal(store.load().session.workspaces['space-a'].name,'최종 이름');assert.equal(store.load().session.workspaces['space-a'].panes[0].path,f.dst);
  assert.throws(()=>validateSession({...session,workspaceId:'constructor',workspaces:{constructor:session.workspaces['space-a']}}));
});
test('preview caps text and does not render active HTML',async()=>{
  const f=await fixture();const file=path.join(f.src,'example.html');await fs.writeFile(file,'<script>alert(1)</script>'+ 'x'.repeat(300000));const value=await preview(file);assert.equal(value.kind,'text');assert.equal(value.truncated,true);assert.ok(Buffer.byteLength(value.data)<=256*1024);
});
test('rename and new-folder undo preserve existing files and reject nonempty new folders',async()=>{
 const f=await fixture(),manager=createTransferManager();const actions=createExplorerActions({shell:{},onCompleted:(op,src,dst)=>manager.recordAction(op,src,dst)});
 const original=path.join(f.src,'before.txt');await fs.writeFile(original,'rename bytes');await actions.renameItem({path:original,name:'after.txt'});await manager.undo();assert.equal(await fs.readFile(original,'utf8'),'rename bytes');
 const created=await actions.createFolder({parent:f.src,name:'empty'});await manager.undo();await assert.rejects(fs.stat(created.path),{code:'ENOENT'});
 const occupied=await actions.createFolder({parent:f.src,name:'occupied'});await fs.writeFile(path.join(occupied.path,'keep.txt'),'keep');await assert.rejects(manager.undo(),/변경/);assert.equal(await fs.readFile(path.join(occupied.path,'keep.txt'),'utf8'),'keep');
});
test('complete merged move removes empty source directories and undo recreates them',async()=>{
 const f=await fixture();await fs.mkdir(path.join(f.dst,'source'));await fs.writeFile(path.join(f.src,'a.txt'),'a');const manager=createTransferManager();const result=await manager.transfer({sources:[f.src],destination:f.dst,operation:'move',conflict:'merge'});assert.equal(result.failed.length,0);await assert.rejects(fs.stat(f.src),{code:'ENOENT'});await manager.undo();assert.equal(await fs.readFile(path.join(f.src,'a.txt'),'utf8'),'a');
});
test('ZIP extraction confines traversal names to selected folder and refuses overwrite',async()=>{
 const f=await fixture(),name=Buffer.from('../outside.txt'),data=Buffer.from('ZIP fixture bytes');let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}crc=(crc^0xffffffff)>>>0;
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
 const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+data.length,16);
 const archive=path.join(f.src,'fixture.zip');await fs.writeFile(archive,Buffer.concat([local,name,data,central,name,end]));assert.equal((await listArchive(archive)).length,1);
 const output=await extractEntry({archive,index:0,destination:f.dst});assert.equal(output.path,path.join(f.dst,'outside.txt'));assert.equal(await fs.readFile(output.path,'utf8'),'ZIP fixture bytes');await assert.rejects(fs.stat(path.join(f.root,'outside.txt')),{code:'ENOENT'});await assert.rejects(extractEntry({archive,index:0,destination:f.dst}),{code:'EEXIST'});
});
