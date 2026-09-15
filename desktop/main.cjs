const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, nativeImage, shell, clipboard, ClipboardItem } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { discoverDrives, getFavorites, listDirectory, errorResult } = require('./filesystem.cjs');
const { createSessionStore } = require('./session-store.cjs');
const { createPreferencesStore } = require('./preferences-store.cjs');
const { createTransferService, transferError } = require('./file-operations.cjs');
const { createExplorerActions, createMutationCoordinator, actionError } = require('./explorer-actions.cjs');
const { createTransferManager } = require('./transfer-manager.cjs');
const { createSystemClipboard } = require('./system-clipboard.cjs');
const contentService = require('./content-service.cjs');
const { showShellMenu } = require('./shell-menu.cjs');
const { normalizePath } = require('./filesystem.cjs');
const { createSftpService } = require('./sftp-service.cjs');

const applicationId = 'com.pane.prototype';
const indexPath = path.join(__dirname, '..', 'index.html');
const indexURL = pathToFileURL(indexPath).href;
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
if (process.env.PANE_DISABLE_GPU === '1') app.disableHardwareAcceleration();
app.setAppUserModelId(applicationId);
let mainWindow;
const sessionStore = createSessionStore(dataDirectory);
const preferencesStore = createPreferencesStore(dataDirectory);
const transferService = createTransferManager({ onProgress: value => mainWindow?.webContents.send('pane:progress', value) });
const systemClipboard = createSystemClipboard({ directory: app.isPackaged ? path.join(process.resourcesPath,'shell-helper') : __dirname });
const watchers = new Map();
const directoryReads = new Map();
let lastSftpProgress = 0;
const sftpService = createSftpService({directory:dataDirectory,
  confirmHost: async value => (await dialog.showMessageBox(mainWindow,{type:'question',title:'SSH 서버 키 확인',message:`${value.host}:${value.port}`,detail:`서버 키 지문: ${value.fingerprint}\n\n서버 관리자가 제공한 지문과 일치하는지 확인하세요. 신뢰한 키는 다음 연결부터 검사합니다.`,buttons:['취소','이 서버 신뢰'],defaultId:0,cancelId:0})).response===1,
  onProgress:value=>{if(value.finished||Date.now()-lastSftpProgress>100){lastSftpProgress=Date.now();mainWindow?.webContents.send('pane:sftp-progress',value);}}
});
const mutations = createMutationCoordinator();
const explorerActions = createExplorerActions({ shell, mutations, onCompleted:(operation,source,target)=>transferService.recordAction(operation,source,target) });
let quitAfterTransfer = false;
const explorerChannels = new Set(['pane:open-path', 'pane:reveal-path', 'pane:trash-items', 'pane:rename-item', 'pane:create-folder', 'pane:begin-native-drag']);

function applicationErrorResult(error, channel) {
  if(channel.startsWith('pane:sftp-'))return {ok:false,error:{code:error.code||'SFTP_ERROR',message:error.message||'SFTP 작업 실패'}};
  if (['pane:undo','pane:preview','pane:archive-list','pane:archive-extract','pane:shell-menu','pane:clipboard-read','pane:clipboard-write'].includes(channel)) return { ok: false, error: { code: error.code || 'ACTION_FAILED', message: error.message || '작업을 완료하지 못했습니다.' } };
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
  handle('pane:list-directory', input => {
    const directory=normalizePath(input), key=directory.toLowerCase();
    if(directoryReads.has(key))return directoryReads.get(key);
    let timer;
    const pending=Promise.race([listDirectory(directory),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('폴더 연결 시간이 초과되었습니다.'),{code:'ETIMEDOUT'})),30000);})]);
    directoryReads.set(key,pending);
    pending.finally(()=>{clearTimeout(timer);if(directoryReads.get(key)===pending)directoryReads.delete(key);}).catch(()=>{});
    return pending;
  });
  handle('pane:save-session', session => sessionStore.saveAsync(session));
  handle('pane:save-preferences', preferences => preferencesStore.save(preferences));
  handle('pane:transfer', request => mutations.run(() => transferService.transfer(request)));
  handle('pane:job-control', command => transferService.control(command));
  handle('pane:undo', () => mutations.run(() => transferService.undo()));
  handle('pane:clipboard-write', request => systemClipboard.write(request));
  handle('pane:clipboard-read', () => systemClipboard.read());
  handle('pane:preview', filename => contentService.preview(filename));
  handle('pane:archive-list', filename => contentService.listArchive(filename));
  handle('pane:archive-extract', request => mutations.run(() => contentService.extractEntry(request)));
  handle('pane:shell-menu', paths => mutations.run(() => showShellMenu(paths, app.isPackaged ? path.join(process.resourcesPath,'shell-helper') : __dirname)));
  handle('pane:drives', () => discoverDrives());
  handle('pane:sftp-connect', input => sftpService.connect(input));
  handle('pane:sftp-disconnect', () => sftpService.disconnect());
  handle('pane:sftp-list', path => sftpService.list(path));
  handle('pane:sftp-transfer', input => mutations.run(() => sftpService.transfer(input)));
  handle('pane:watch', paths => {
    if (!Array.isArray(paths) || paths.length > 80) throw new Error('Invalid watch request');
    const next = new Set(paths.map(normalizePath));
    for (const [directory, record] of watchers) if (!next.has(directory)) { clearTimeout(record.timer); record.watcher.close(); watchers.delete(directory); }
    for (const directory of next) {
      if (watchers.has(directory)) continue;
      try {
        const record = {};
        record.watcher = fs.watch(directory, () => {
          clearTimeout(record.timer);
          record.timer = setTimeout(() => mainWindow?.webContents.send('pane:directory-changed', directory), 350);
        });
        record.watcher.on('error', () => { record.watcher.close(); watchers.delete(directory); mainWindow?.webContents.send('pane:directory-changed',directory); });
        watchers.set(directory, record);
      } catch {} // Network and removable drives may not support notifications; focus/F5 remains available.
    }
    return null;
  });
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
  let closingSaved = false;
  window.on('close', event => {
    const pending = mutations.pending;
    if (!pending && closingSaved) return;
    event.preventDefault();
    if (pending) { transferService.control('resume'); window.setTitle('pane — 파일 작업을 마친 뒤 종료합니다'); }
    if (!quitAfterTransfer) {
      quitAfterTransfer = true;
      Promise.allSettled([pending, sessionStore.pending]).then(() => { closingSaved = true; quitAfterTransfer = false; app.quit(); });
    }
  });
  window.on('closed', () => { mainWindow = undefined; for (const record of watchers.values()) {clearTimeout(record.timer);record.watcher.close();} watchers.clear(); });
  window.loadFile(indexPath).catch(error => {
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
