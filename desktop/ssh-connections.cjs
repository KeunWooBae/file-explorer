'use strict';
const { randomUUID } = require('node:crypto');
const { createSftpService } = require('./sftp-service.cjs');
const { createSshProfileStore } = require('./ssh-profiles.cjs');
function createSshConnections({ directory, confirmHost, emit, serviceFactory = createSftpService }) {
  const profiles = createSshProfileStore(directory);
  const connections = new Map();
  const create = id => serviceFactory({ directory, confirmHost,
    onTerminal: value => emit('output', { connectionId: id, ...value }),
    onState: value => emit('state', { connectionId: id, ...value }),
    onDirectory: directory => emit('directory', { connectionId: id, path: directory }),
    onProgress: value => emit('progress', { connectionId: id, ...value }),
  });
  const primary = create('primary');
  function get(id) { const record = connections.get(id); if (!record || !record.ready) throw new Error('열린 터미널 연결을 확인하세요.'); return record.service; }
  function selected(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 12 || new Set(ids).size !== ids.length) throw new Error('대상 터미널을 선택하세요.');
    return ids.map(id => ({ id, service: get(id) }));
  }
  return {
    primary, profiles,
    async connectPrimary(input) {
      const result = await primary.connect(input);
      try { const sessions = await profiles.save({ host: input.host, username: result.username, port: result.port, authMode: input.authMode || 'default-key', label: input.label }); return { ...result, sessions }; }
      catch (error) { return { ...result, warning: '연결되었지만 세션 정보를 저장하지 못했습니다: ' + error.message }; }
    },
    async openSaved(input) {
      if (connections.size >= 12) throw new Error('동시에 열 수 있는 터미널은 최대 12개입니다.');
      const id = randomUUID(), record = { service: create(id), ready: false }; connections.set(id, record);
      try {
        const profile = (await profiles.list()).find(item => item.id === input?.profileId);
        if (!profile) throw new Error('저장된 세션을 찾을 수 없습니다.');
        const result = await record.service.connect({ ...profile, password: input.password, passphrase: input.passphrase });
        record.ready = true;
        return { ...result, connectionId: id, label: profile.label, profileId: profile.id };
      } catch (error) { connections.delete(id); await record.service.disconnect().catch(() => {}); throw error; }
    },
    async close(id) { const service = get(id); await service.disconnect(); connections.delete(id); return null; },
    open: (id, size) => get(id).openTerminal({...size,followSupport:false}),
    input: (id, data) => get(id).writeTerminal(data),
    resize: (id, size) => get(id).resizeTerminal(size),
    ack: (id, value) => get(id).acknowledgeTerminal(value),
    async broadcast(input) {
      const targets = selected(input?.ids);
      if (typeof input.data !== 'string' || !input.data || Buffer.byteLength(input.data) > 65536) throw new Error('동시 입력 명령은 64KB 이하여야 합니다.');
      return Promise.all(targets.map(async ({ id, service }) => {
        try { await service.writeTerminal(input.data); return { id, ok: true }; } catch (error) { return { id, ok: false, error: error.message }; }
      }));
    },
    async upload(input) {
      if (!Array.isArray(input?.targets)) throw new Error('파일 전송 대상을 확인하세요.');
      const targets = selected(input.targets.map(item => item.id));
      if (!Array.isArray(input.sources) || !input.sources.length || input.sources.length > 1000) throw new Error('전송할 파일 또는 폴더를 선택하세요.');
      return Promise.all(targets.map(async ({ id, service }, index) => {
        try { return { id, ok: true, result: await service.transfer({ direction: 'upload', sources: input.sources, destination: input.targets[index].destination }) }; }
        catch (error) { return { id, ok: false, error: error.message }; }
      }));
    },
    async disconnectAll() { await Promise.allSettled([primary.disconnect(), ...[...connections.values()].map(record => record.service.disconnect())]); connections.clear(); },
  };
}
module.exports = { createSshConnections };
