'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizePath } = require('./filesystem.cjs');
const MAX_SESSION_BYTES = 2 * 1024 * 1024;

function invalidSession() {
  const error = new Error('Invalid session');
  error.code = 'INVALID_SESSION';
  return error;
}

function validateSession(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![1, 2].includes(input.version) || typeof input.workspaceId !== 'string'
    || !input.workspaces || typeof input.workspaces !== 'object' || Array.isArray(input.workspaces)) throw invalidSession();
  const keys = input.version === 1 ? ['design', 'documents'] : Object.keys(input.workspaces);
  if (!keys.length || keys.length > 20 || !keys.includes(input.workspaceId) || keys.some(k => !/^[a-z][a-z0-9-]{0,60}$/.test(k) || ['constructor','prototype','__proto__'].includes(k))) throw invalidSession();
  const workspaces = {};
  for (const key of keys) {
    const workspace = input.workspaces[key];
    if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)
      || ![1, 2, 4].includes(workspace.layout)
      || !Number.isInteger(workspace.active) || workspace.active < 0 || workspace.active > 3
      || !Array.isArray(workspace.panes) || workspace.panes.length !== 4) throw invalidSession();
    const panes = Array.from(workspace.panes, pane => {
      if (!pane || typeof pane !== 'object' || Array.isArray(pane)
        || !['name', 'modified', 'size'].includes(pane.sort)
        || ![1, -1].includes(pane.direction)) throw invalidSession();
      let panePath;
      try { panePath = normalizePath(pane.path); } catch { throw invalidSession(); }
      const value = { path: panePath, sort: pane.sort, direction: pane.direction };
      if (input.version === 2) {
        if (!Array.isArray(pane.tabs) || !pane.tabs.length || pane.tabs.length > 20 || !Number.isInteger(pane.activeTab) || pane.activeTab < 0 || pane.activeTab >= pane.tabs.length) throw invalidSession();
        try { value.tabs = pane.tabs.map(normalizePath); } catch { throw invalidSession(); }
        value.activeTab = pane.activeTab;
        value.path = value.tabs[value.activeTab];
      }
      return value;
    });
    const active = workspace.layout === 2 && workspace.active > 1 ? 0 : workspace.active;
    workspaces[key] = { layout: workspace.layout, active, panes };
    if (input.version === 2) {
      if (typeof workspace.name !== 'string' || !workspace.name.trim() || workspace.name.length > 60) throw invalidSession();
      workspaces[key].name = workspace.name.trim();
    }
  }
  return { version: input.version, workspaceId: input.workspaceId, workspaces };
}

function createSessionStore(directory) {
  const filename = path.join(directory, 'session.json');
  const temporary = path.join(directory, `.session-${process.pid}.tmp`);
  let queue = Promise.resolve();
  return {
    saveAsync(input) {
      const session = validateSession(input);
      const serialized = `${JSON.stringify(session, null, 2)}\n`;
      if (Buffer.byteLength(serialized) > MAX_SESSION_BYTES) throw invalidSession();
      const write = async () => {
        let handle;
        try {
          await fs.promises.mkdir(directory, { recursive: true });
          handle = await fs.promises.open(temporary, 'w', 0o600);
          await handle.writeFile(serialized); await handle.sync(); await handle.close(); handle = null;
          await fs.promises.rename(temporary, filename);
        } catch {
          await handle?.close().catch(() => {});
          throw Object.assign(new Error('작업 공간을 저장하지 못했습니다.'), { code: 'SESSION_WRITE_FAILED' });
        }
        return null;
      };
      queue = queue.catch(() => {}).then(write);
      return queue;
    },
    get pending() { return queue; },
    load() {
      try {
        if (fs.statSync(filename).size > MAX_SESSION_BYTES) throw invalidSession();
        return { session: validateSession(JSON.parse(fs.readFileSync(filename, 'utf8'))) };
      } catch (error) {
        if (error.code === 'ENOENT') return { session: null };
        return { session: null, sessionWarning: '이전 작업 공간 설정을 읽을 수 없어 기본 폴더를 표시합니다. 새 경로를 선택하면 설정을 다시 저장합니다.' };
      }
    },
    save(input) {
      const session = validateSession(input);
      const serialized = `${JSON.stringify(session, null, 2)}\n`;
      // Apply the same byte ceiling before touching the previous valid file.
      if (Buffer.byteLength(serialized, 'utf8') > MAX_SESSION_BYTES) throw invalidSession();
      let descriptor;
      try {
        fs.mkdirSync(directory, { recursive: true });
        descriptor = fs.openSync(temporary, 'w', 0o600);
        fs.writeFileSync(descriptor, serialized, 'utf8');
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        fs.renameSync(temporary, filename);
      } catch {
        if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch {} }
        try { fs.unlinkSync(temporary); } catch {}
        const error = new Error('Could not save session');
        error.code = 'SESSION_WRITE_FAILED';
        throw error;
      }
      return null;
    },
  };
}

module.exports = { createSessionStore, validateSession, MAX_SESSION_BYTES };
