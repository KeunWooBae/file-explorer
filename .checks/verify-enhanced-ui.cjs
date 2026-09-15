const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {createRequire}=require('node:module');
const {chromium}=createRequire(path.join(process.argv[2],'package.json'))('playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:960}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.addInitScript(()=>{
  const pane=()=>({path:'C:\\fixture',sort:'name',direction:1});window.calls=[];window.saves=[];window.sftpCalls=[];
  const entries=Array.from({length:5000},(_,i)=>({path:`C:\\fixture\\file-${String(i).padStart(5,'0')}.txt`,name:`file-${String(i).padStart(5,'0')}.txt`,type:'file',size:i,modified:'2020-01-02T00:00:00Z'}));
  const ok=value=>({ok:true,value});
  window.pane={bootstrap:async()=>ok({drives:[],favorites:[{id:'home',path:'C:\\fixture',label:'홈'}],session:{version:1,workspaceId:'design',workspaces:{design:{layout:4,active:0,panes:Array.from({length:4},pane)},documents:{layout:2,active:0,panes:Array.from({length:4},pane)}}}}),
   listDirectory:async p=>{window.calls.push(p);return ok({path:p,name:p.split('\\').at(-1),parent:'C:\\',breadcrumbs:[],entries});},saveSession:async s=>{window.saves.push(s);return ok(null);},savePreferences:async p=>ok(p),transfer:async()=>ok({operation:'copy',completed:[],failed:[],skipped:[]}),
   onDirectoryChanged:callback=>{window.changed=callback;},watch:async()=>ok(null),preview:async()=>ok({kind:'text',data:'<script>window.previewExecuted=true</script>'}),
   archiveList:async()=>ok([{index:0,name:'nested/readme.txt',type:'File',size:10}]),archiveExtract:async request=>{window.extracted=request;return ok({path:'C:\\fixture\\readme.txt'});},
   sftpConnect:async request=>{window.sftpCalls.push(request);return ok({path:'/home/test'});},sftpList:async p=>ok({path:p,parent:'/',entries:[{name:'remote.txt',path:p+'/remote.txt',type:'file',size:12}]}),sftpTransfer:async request=>{window.sftpTransferRequest=request;return ok({completed:[{}],failed:[]});},sftpDisconnect:async()=>ok(null)
  };
 });
 await page.goto('http://127.0.0.1:4173');await page.locator('#panel-design-0 tr[data-file]').first().waitFor();
 assert.equal(await page.evaluate(()=>calls.length),4,'only visible panes initially loaded');
 assert.ok(await page.locator('tr[data-file]').count()<400,'virtualized rows');
 await page.locator('#panel-design-0 tr[data-file]').first().click();await page.keyboard.press('End');
 await page.locator('#panel-design-0 tr[data-file]').filter({hasText:'file-04999.txt'}).waitFor();
 await page.keyboard.press('Home');await page.locator('#panel-design-0 tr[data-file]').filter({hasText:'file-00000.txt'}).waitFor();
 await page.locator('#panel-design-0 [data-tab-add]').click();assert.equal(await page.locator('#panel-design-0 [data-tab]').count(),2);
 const address=page.getByRole('textbox',{name:'1번 패널 폴더 경로',exact:true});await address.fill('C:\\second');await address.press('Enter');await page.waitForFunction(()=>window.saves.at(-1)?.workspaces.design.panes[0].tabs[1]==='C:\\second');
 await page.locator('#panel-design-0 [data-tab="0"]').click();await page.waitForFunction(()=>document.querySelector('#panel-design-0 .path-input').value==='C:\\fixture');
 await page.locator('#features-button').click();await page.locator('[data-tool="workspace-add"]').click();await page.locator('#workspace-name').fill('추가 작업');await page.locator('#workspace-form button').click();
 await page.waitForFunction(()=>Object.keys(window.saves.at(-1).workspaces).length===3);
 await page.locator('#features-button').click();await page.locator('[data-tool="workspace-rename"]').click();await page.locator('#workspace-name').fill('<img src=x> 이름');await page.locator('#workspace-form button').click();
 assert.equal(await page.locator('#workspaces img').count(),0);assert.ok((await page.locator('#workspaces').innerText()).includes('<img src=x> 이름'));
 await page.locator('.file-panel:not([hidden]) tr[data-file]').first().click();
 await page.locator('#features-button').click();await page.locator('[data-tool="preview"]').click();await page.locator('.text-preview').waitFor();assert.equal(await page.evaluate(()=>window.previewExecuted),undefined);
 await page.locator('#features-dialog [data-dismiss]').click();
 await page.locator('#sftp-button').click();await page.locator('[name="host"]').fill('example.test');await page.locator('[name="username"]').fill('tester');await page.locator('[name="password"]').fill('fixture-secret');await page.locator('#sftp-connect').click();
 await page.locator('[data-remote-select]').waitFor();assert.equal(await page.evaluate(()=>sftpCalls[0].host),'example.test');assert.equal(await page.locator('[name="password"]').inputValue(),'');
 await page.locator('[data-remote-select]').check();await page.locator('#sftp-download').click();await page.waitForFunction(()=>Boolean(window.sftpTransferRequest));assert.equal(await page.evaluate(()=>sftpTransferRequest.destination),'C:\\fixture');assert.equal(await page.evaluate(()=>sftpTransferRequest.direction),'download');
 await page.locator('#sftp-close').click();
 const root=path.join(__dirname,'enhanced-ui-'+Date.now());fs.mkdirSync(root);await page.screenshot({path:path.join(root,'desktop.png')});
 await page.locator('#features-button').click();await page.screenshot({path:path.join(root,'tools.png')});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'result.json'),JSON.stringify({passed:true,checks:['virtualization/keyboard','visible-only startup','tabs','workspaces/escaping','safe preview','SFTP form and current-folder download'],errors},null,2));console.log(root);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
