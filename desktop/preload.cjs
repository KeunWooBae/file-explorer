'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('pane', Object.freeze({
  bootstrap: () => ipcRenderer.invoke('pane:bootstrap'),
  listDirectory: path => ipcRenderer.invoke('pane:list-directory', path),
  saveSession: session => ipcRenderer.invoke('pane:save-session', session),
  savePreferences: preferences => ipcRenderer.invoke('pane:save-preferences', preferences),
  transfer: request => ipcRenderer.invoke('pane:transfer', request),
  jobControl: command => ipcRenderer.invoke('pane:job-control', command),
  undo: () => ipcRenderer.invoke('pane:undo'),
  clipboardWrite: request => ipcRenderer.invoke('pane:clipboard-write', request),
  clipboardRead: () => ipcRenderer.invoke('pane:clipboard-read'),
  preview: path => ipcRenderer.invoke('pane:preview', path),
  archiveList: path => ipcRenderer.invoke('pane:archive-list', path),
  archiveExtract: request => ipcRenderer.invoke('pane:archive-extract', request),
  shellMenu: paths => ipcRenderer.invoke('pane:shell-menu', paths),
  drives: () => ipcRenderer.invoke('pane:drives'),
  sftpConnect: input => ipcRenderer.invoke('pane:sftp-connect',input),
  sftpDisconnect: () => ipcRenderer.invoke('pane:sftp-disconnect'),
  sftpList: path => ipcRenderer.invoke('pane:sftp-list',path),
  sftpTransfer: input => ipcRenderer.invoke('pane:sftp-transfer',input),
  onSftpProgress: callback => { const listener=(_event,value)=>callback(value);ipcRenderer.on('pane:sftp-progress',listener);return()=>ipcRenderer.removeListener('pane:sftp-progress',listener); },
  watch: paths => ipcRenderer.invoke('pane:watch', paths),
  onProgress: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('pane:progress',listener); return () => ipcRenderer.removeListener('pane:progress',listener); },
  onDirectoryChanged: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('pane:directory-changed',listener); return () => ipcRenderer.removeListener('pane:directory-changed',listener); },
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
