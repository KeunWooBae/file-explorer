const { protocol, app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, nativeImage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { discoverDrives, getFavorites, listDirectory, errorResult } = require('./filesystem.cjs');
const { createSessionStore } = require('./session-store.cjs');
const { createPreferencesStore } = require('./preferences-store.cjs');
const { createTransferService, transferError } = require('./file-operations.cjs');
const { createExplorerActions, createMutationCoordinator, actionError } = require('./explorer-actions.cjs');

const { createSshConnections } = require('./ssh-connections.cjs');
const applicationId = 'com.pane.prototype';
const indexPath = path.join(__dirname, '..', 'index.html');
const indexURL = 'pane://app/index.html';
protocol.registerSchemesAsPrivileged([{scheme:'pane',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
function registerAssets(){
 const assets=new Map([['index.html','text/html'],['styles.css','text/css'],['ssh-workspace.css','text/css'],['app.js','text/javascript'],['ssh-workspace.js','text/javascript'],['multi-terminal.js','text/javascript'],['theme.js','text/javascript'],['node_modules/@xterm/xterm/lib/xterm.js','text/javascript'],['node_modules/@xterm/xterm/css/xterm.css','text/css'],['node_modules/@xterm/addon-fit/lib/addon-fit.js','text/javascript']]);
 protocol.handle('pane',async request=>{
  const url=new URL(request.url),filename=url.pathname.slice(1);
  if(url.host!=='app'||request.method!=='GET'||!assets.has(filename))return new Response('Not found',{status:404});
  try{let body=await fs.promises.readFile(path.join(__dirname,'..',filename));if(filename==='index.html')body=Buffer.from(body.toString('utf8').replaceAll('__PANE_STYLE_NONCE__',require('node:crypto').randomBytes(24).toString('base64')));return new Response(body,{headers:{'Content-Type':assets.get(filename)+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}catch{return new Response('Not found',{status:404});}
 });
}
const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
const dataDirectory = path.join(
  portableDirectory || (app.isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..')),
  app.isPackaged ? 'pane-data' : '.pane-dev-data',
);

function ensureWritableDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, `.write-check-${process.pid}`);
  const descriptor = fs.openSync(probe, 'wx');
  fs.closeSync(descriptor);
  fs.unlinkSync(probe);
}

// Set every Chromium profile path before ready so preferences travel with the EXE.
try {
  ensureWritableDirectory(dataDirectory);
  for (const [name, child] of [
    ['userData', 'profile'],
    ['sessionData', 'session'],
    ['crashDumps', 'crashes'],
    ['logs', 'logs'],
  ]) {
    const directory = path.join(dataDirectory, child);
    ensureWritableDirectory(directory);
    app.setPath(name, directory);
  }
} catch (error) {
  dialog.showErrorBox('pane 설정 폴더를 만들 수 없습니다',
    `실행 파일 옆의 설정 폴더에 쓸 수 없습니다.\n\n${dataDirectory}\n\n쓰기 가능한 폴더로 pane 실행 파일을 옮긴 뒤 다시 실행해 주세요.\n\n${error.message}`);
  app.exit(1);
}

app.enableSandbox();
app.setAppUserModelId(applicationId);
let mainWindow;
const sessionStore = createSessionStore(dataDirectory);
const preferencesStore = createPreferencesStore(dataDirectory);
const transferService = createTransferService();
const progressTimes=new Map();
const sshConnections=createSshConnections({directory:dataDirectory,
 confirmHost:async value=>(await dialog.showMessageBox(mainWindow,{type:'question',title:'새 SSH 서버 키 확인',message:value.host+':'+value.port,detail:'서버 지문: '+value.fingerprint+'\n기존 known_hosts에 없는 서버입니다. 지문이 맞는지 확인하세요.',buttons:['취소','서버 신뢰'],defaultId:0,cancelId:0})).response===1,
 emit:(type,value)=>{
  if(type==='progress'){if(!value.finished&&Date.now()-(progressTimes.get(value.connectionId)||0)<100)return;progressTimes.set(value.connectionId,Date.now());}
  const channel=value.connectionId==='primary'?(type==='progress'?'pane:sftp-progress':'pane:ssh-'+type):'pane:ssh-multi-'+type;
  mainWindow?.webContents.send(channel,value);
 }
});
const sftpService=sshConnections.primary;
const mutations = createMutationCoordinator();
const explorerActions = createExplorerActions({ shell, mutations });
let quitAfterTransfer = false;
const explorerChannels = new Set(['pane:open-path', 'pane:reveal-path', 'pane:trash-items', 'pane:rename-item', 'pane:create-folder', 'pane:begin-native-drag']);

function applicationErrorResult(error, channel) {
  if(channel.startsWith('pane:ssh-')||channel.startsWith('pane:sftp-'))return {ok:false,error:{code:error.code||'SSH_ERROR',message:error.message||'SSH 작업 실패'}};
  if (['INVALID_PREFERENCES', 'PREFERENCES_WRITE_FAILED'].includes(error?.code)) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  if (explorerChannels.has(channel) || error?.code === 'ACTION_BUSY') return { ok: false, error: actionError(error) };
  return channel === 'pane:transfer' ? { ok: false, error: transferError(error) } : errorResult(error);
}

function registerFileAccess() {
  const handle = (channel, action) => ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (!mainWindow || event.sender !== mainWindow.webContents
        || event.senderFrame !== mainWindow.webContents.mainFrame
        || event.senderFrame.url !== indexURL) {
        return errorResult({ code: 'FORBIDDEN' });
      }
      return { ok: true, value: await action(...args) };
    } catch (error) { return applicationErrorResult(error, channel); }
  });
  handle('pane:bootstrap', async () => ({
    drives: await discoverDrives(),
    favorites: getFavorites(name => app.getPath(name)),
    ...sessionStore.load(),
    ...preferencesStore.load(),
  }));
  handle('pane:list-directory', directory => listDirectory(directory));
  handle('pane:save-session', session => sessionStore.save(session));
  handle('pane:save-preferences', preferences => preferencesStore.save(preferences));
  handle('pane:transfer', request => mutations.run(() => transferService.transfer(request)));
  handle('pane:sftp-connect',input=>sshConnections.connectPrimary(input));
  handle('pane:sftp-disconnect',()=>sftpService.disconnect());
  handle('pane:sftp-list',input=>sftpService.list(input));
  handle('pane:sftp-transfer',input=>mutations.run(()=>sftpService.transfer(input)));
  handle('pane:ssh-open',size=>sftpService.openTerminal(size));
  handle('pane:ssh-input',data=>sftpService.writeTerminal(data));
  handle('pane:ssh-ack',input=>sftpService.acknowledgeTerminal(input));
  handle('pane:ssh-resize',size=>sftpService.resizeTerminal(size));
  handle('pane:ssh-follow',enabled=>sftpService.setFollow(enabled));
  handle('pane:ssh-profiles',()=>sshConnections.profiles.list());
  handle('pane:ssh-profile-remove',id=>sshConnections.profiles.remove(id));
  handle('pane:ssh-multi-connect',input=>sshConnections.openSaved(input));
  handle('pane:ssh-multi-close',id=>sshConnections.close(id));
  handle('pane:ssh-multi-open',input=>sshConnections.open(input.id,input.size));
  handle('pane:ssh-multi-input',input=>sshConnections.input(input.id,input.data));
  handle('pane:ssh-multi-resize',input=>sshConnections.resize(input.id,input.size));
  handle('pane:ssh-multi-ack',input=>sshConnections.ack(input.connectionId,input));
  handle('pane:ssh-multi-broadcast',input=>sshConnections.broadcast(input));
  handle('pane:ssh-multi-upload',input=>mutations.run(()=>sshConnections.upload(input)));
  handle('pane:ssh-upload-picker',async folder=>{const result=await dialog.showOpenDialog(mainWindow,{title:folder?'전송할 폴더 선택':'전송할 파일 선택',properties:[folder?'openDirectory':'openFile','multiSelections']});return result.canceled?[]:result.filePaths;});
  handle('pane:open-path', filename => explorerActions.openPath(filename));
  handle('pane:reveal-path', filename => explorerActions.revealPath(filename));
  handle('pane:trash-items', request => explorerActions.trashItems(request));
  handle('pane:rename-item', request => explorerActions.renameItem(request));
  handle('pane:create-folder', request => explorerActions.createFolder(request));
  handle('pane:begin-native-drag', async request => {
    const files = await explorerActions.prepareNativeDrag(request);
    const icon = await app.getFileIcon(files[0], { size: 'normal' })
      .catch(() => nativeImage.createFromPath(path.join(__dirname, 'pane.ico')));
    if (!mainWindow || mainWindow.isDestroyed()) throw Object.assign(new Error('Window closed'), { code: 'ACTION_FAILED' });
    mainWindow.webContents.startDrag({ files, icon });
    return null;
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 760,
    minHeight: 540,
    show: false,
    title: 'pane — 파일 탐색기',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#11151c' : '#f4f6f8',
    icon: path.join(__dirname, 'pane.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  mainWindow = window;
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== indexURL) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.on('will-download', event => event.preventDefault());
  window.once('ready-to-show', () => {
    if (!app.commandLine.hasSwitch('pane-smoke-test')) window.show();
  });
  window.on('close', event => {
    const pending = mutations.pending;
    if (!pending) return;
    event.preventDefault();
    window.setTitle('pane — 파일 작업을 마친 뒤 종료합니다');
    if (!quitAfterTransfer) {
      quitAfterTransfer = true;
      pending.finally(() => { quitAfterTransfer = false; app.quit(); }).catch(() => {});
    }
  });
  window.on('closed', () => { sshConnections.disconnectAll().catch(()=>{});mainWindow = undefined; });
  window.loadURL(indexURL).catch(error => {
    dialog.showErrorBox('pane 화면을 열 수 없습니다', error.message);
    app.quit();
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    registerAssets();
    registerFileAccess();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (!mutations.pending) return;
    event.preventDefault();
    if (!quitAfterTransfer) {
      quitAfterTransfer = true;
      mutations.pending.finally(() => { quitAfterTransfer = false; app.quit(); }).catch(() => {});
    }
  });
}
