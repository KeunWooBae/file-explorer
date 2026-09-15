'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('pane', Object.freeze({
  bootstrap: () => ipcRenderer.invoke('pane:bootstrap'),
  listDirectory: path => ipcRenderer.invoke('pane:list-directory', path),
  saveSession: session => ipcRenderer.invoke('pane:save-session', session),
  savePreferences: preferences => ipcRenderer.invoke('pane:save-preferences', preferences),
  transfer: request => ipcRenderer.invoke('pane:transfer', request),
  sftpConnect:input=>ipcRenderer.invoke('pane:sftp-connect',input),
  sftpDisconnect:()=>ipcRenderer.invoke('pane:sftp-disconnect'),
  sftpList:input=>ipcRenderer.invoke('pane:sftp-list',input),
  sftpTransfer:input=>ipcRenderer.invoke('pane:sftp-transfer',input),
  sshOpen:size=>ipcRenderer.invoke('pane:ssh-open',size),
  sshInput:data=>ipcRenderer.invoke('pane:ssh-input',data),
  sshAck:input=>ipcRenderer.invoke('pane:ssh-ack',input),
  sshResize:size=>ipcRenderer.invoke('pane:ssh-resize',size),
  sshKeyPicker:()=>ipcRenderer.invoke('pane:ssh-key-picker'),
  onSftpProgress:callback=>{const listener=(_e,v)=>callback(v);ipcRenderer.on('pane:sftp-progress',listener);return()=>ipcRenderer.removeListener('pane:sftp-progress',listener);},
  onSshOutput:callback=>{const listener=(_e,v)=>callback(v);ipcRenderer.on('pane:ssh-output',listener);return()=>ipcRenderer.removeListener('pane:ssh-output',listener);},
  onSshState:callback=>{const listener=(_e,v)=>callback(v);ipcRenderer.on('pane:ssh-state',listener);return()=>ipcRenderer.removeListener('pane:ssh-state',listener);},
  openPath: path => ipcRenderer.invoke('pane:open-path', path),
  revealPath: path => ipcRenderer.invoke('pane:reveal-path', path),
  trashItems: request => ipcRenderer.invoke('pane:trash-items', request),
  renameItem: request => ipcRenderer.invoke('pane:rename-item', request),
  createFolder: request => ipcRenderer.invoke('pane:create-folder', request),
  beginNativeDrag: paths => ipcRenderer.invoke('pane:begin-native-drag', paths),
  droppedPaths: files => {
    if (!Array.isArray(files) || files.length > 1000) return [];
    // Only real File objects supplied by Chromium expose a filesystem path.
    return files.flatMap(file => {
      try { const path = webUtils.getPathForFile(file); return path ? [path] : []; }
      catch { return []; }
    });
  },
}));
