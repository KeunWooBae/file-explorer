'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
function validateProfile(input) {
  if (!input || typeof input.host !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:\-]{0,252}$/.test(input.host)) throw new Error('저장할 호스트가 올바르지 않습니다.');
  if (typeof input.username !== 'string' || !input.username || input.username.length > 128 || /[\x00-\x1f]/.test(input.username)) throw new Error('저장할 사용자가 올바르지 않습니다.');
  const port = Number(input.port || 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !['password', 'default-key'].includes(input.authMode)) throw new Error('저장할 연결 설정이 올바르지 않습니다.');
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim() : `${input.username}@${input.host}`;
  if (label.length > 120 || /[\x00-\x1f]/.test(label)) throw new Error('세션 이름이 올바르지 않습니다.');
  return { host: input.host, username: input.username, port, authMode: input.authMode, label };
}
function createSshProfileStore(directory) {
  const filename = path.join(directory, 'ssh-sessions.json');
  let queue = Promise.resolve();
  async function read() {
    try {
      if ((await fs.stat(filename)).size > 256 * 1024) throw new Error('세션 파일이 너무 큽니다.');
      const data = JSON.parse(await fs.readFile(filename, 'utf8'));
      if (data.version !== 1 || !Array.isArray(data.sessions) || data.sessions.length > 100) throw new Error('세션 파일 형식이 올바르지 않습니다.');
      const ids = new Set();
      return data.sessions.map(item => {
        if (typeof item.id !== 'string' || !/^[a-f0-9-]{36}$/.test(item.id) || ids.has(item.id)) throw new Error('세션 ID가 올바르지 않습니다.');
        ids.add(item.id);
        return { id: item.id, ...validateProfile(item) };
      });
    } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }
  async function write(sessions) {
    await fs.mkdir(directory, { recursive: true });
    const temporary = filename + '.' + randomUUID() + '.tmp';
    try { await fs.writeFile(temporary, JSON.stringify({ version: 1, sessions }, null, 2), { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, filename); }
    finally { await fs.unlink(temporary).catch(() => {}); }
    return sessions;
  }
  function change(fn) { const task = queue.then(async () => write(await fn(await read()))); queue = task.catch(() => {}); return task; }
  return {
    list: async () => { await queue; return read(); },
    save: input => change(sessions => {
      const profile = validateProfile(input);
      const existing = sessions.find(item => item.host.toLowerCase() === profile.host.toLowerCase() && item.port === profile.port && item.username === profile.username && item.authMode === profile.authMode);
      if (!existing && sessions.length >= 100) throw new Error('저장 세션은 최대 100개입니다.');
      const record = { id: existing?.id || randomUUID(), ...profile };
      return existing ? sessions.map(item => item.id === existing.id ? record : item) : [...sessions, record];
    }),
    remove: id => change(sessions => sessions.filter(item => item.id !== id)),
  };
}
module.exports = { createSshProfileStore, validateProfile };
