'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHmac, timingSafeEqual } = require('node:crypto');
const { utils } = require('ssh2');
const execute = promisify(execFile);

function parseConfig(text) {
  const result = Object.create(null);
  for (const line of text.split(/\r?\n/)) {
    const split = line.indexOf(' ');
    if (split < 1) continue;
    const key = line.slice(0, split).toLowerCase();
    (result[key] ||= []).push(line.slice(split + 1).trim());
  }
  return result;
}
async function resolveAuth(input, { home = os.homedir(), configPath } = {}) {
  if (!input || typeof input.host !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:\-]*$/.test(input.host) || input.host.length > 253) throw new Error('호스트 이름 또는 SSH 설정의 Host 별칭을 입력하세요.');
  const args = ['-G'];
  if (configPath) args.push('-F', configPath);
  args.push(input.host);
  let config = Object.create(null);
  try { config = parseConfig((await execute('ssh', args, { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 })).stdout); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('OpenSSH 설정을 읽지 못했습니다. ~/.ssh/config의 문법을 확인하세요.'); }
  const first = key => config[key]?.[0];
  if ((first('proxyjump') && first('proxyjump') !== 'none') || (first('proxycommand') && first('proxycommand') !== 'none')) throw new Error('이 연결은 ProxyJump/ProxyCommand를 사용합니다. 현재 직접 SSH 연결만 지원합니다.');
  const host = first('hostname') || input.host;
  const username = input.username?.trim() || first('user') || os.userInfo().username;
  const port = Number(input.port || first('port') || 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !username || username.length > 128 || /[\0\r\n]/.test(username)) throw new Error('사용자 이름과 포트를 확인하세요.');
  const expand = filename => filename.replace(/^~(?=[/\\]|$)/, home).replace(/%d/g, home).replace(/%h/g, host).replace(/%r/g, username).replace(/%p/g, String(port));
  const attempts = [{ type: 'none', username }];
  const diagnostics = [];
  const mode = input.authMode || (input.password ? 'password' : 'auto');
  if (!['auto', 'key', 'password'].includes(mode)) throw new Error('인증 방식을 확인하세요.');
  if (mode !== 'password') {
    const agent = first('identityagent');
    if (mode === 'auto' && first('identitiesonly') !== 'yes' && agent !== 'none') attempts.push({ type: 'agent', username, agent: agent && agent !== 'SSH_AUTH_SOCK' ? expand(agent) : process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : '') });
    const keys = input.privateKeyPath ? [input.privateKeyPath] : config.identityfile || [path.join(home, '.ssh/id_ed25519'), path.join(home, '.ssh/id_rsa'), path.join(home, '.ssh/id_ecdsa')];
    if (mode === 'key' && !input.privateKeyPath) throw new Error('개인키 파일을 선택하세요.');
    for (const filename of [...new Set(keys)].slice(0, 30)) {
      if (filename === 'none') continue;
      try {
        const full = expand(filename);
        if ((await fs.stat(full)).size > 1024 * 1024) throw new Error('개인키 파일이 너무 큽니다.');
        const key = utils.parseKey(await fs.readFile(full), input.passphrase || undefined);
        if (key instanceof Error) { diagnostics.push('잠긴 키 또는 지원하지 않는 키 형식'); if (mode === 'key') throw new Error('개인키를 열 수 없습니다. 키 암호와 OpenSSH 형식을 확인하세요.'); continue; }
        attempts.push({ type: 'publickey', username, key });
      } catch (error) { if (mode === 'key' || input.privateKeyPath) throw error; if (error.code !== 'ENOENT') diagnostics.push('키 파일 접근 실패'); }
    }
  }
  if (input.password) attempts.push({ type: 'password', username, password: input.password });
  return { host, port, username, attempts: attempts.filter(item => item.type !== 'agent' || item.agent), diagnostics, hostAlias: first('hostkeyalias'), knownHosts: config.userknownhostsfile ? config.userknownhostsfile.flatMap(value => (value.match(/"[^"]+"|\S+/g)||[]).map(file=>expand(file.replace(/^"|"$/g,'')))).filter(file=>file!=='none') : [path.join(home, '.ssh/known_hosts'), path.join(home, '.ssh/known_hosts2')] };
}
function matchesHost(pattern, host) {
  if (pattern.startsWith('|1|')) {
    const [, , salt, hash] = pattern.split('|');
    const actual = createHmac('sha1', Buffer.from(salt || '', 'base64')).update(host).digest();
    const expected = Buffer.from(hash || '', 'base64');
    return expected.length === actual.length && timingSafeEqual(actual, expected);
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + escaped + '$', 'i').test(host);
}
async function checkKnownHosts(files, host, port, raw) {
  const token = port === 22 ? host : `[${host}]:${port}`;
  let found = false, trusted = false;
  for (const filename of files) {
    let text; try { text = await fs.readFile(filename, 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    for (const line of text.split(/\r?\n/)) {
      const fields = line.trim().split(/\s+/); if (!fields[0] || fields[0].startsWith('#')) continue;
      const marker = fields[0].startsWith('@') ? fields.shift() : '';
      const patterns = fields[0].split(',');
      if (patterns.some(p => p.startsWith('!') && matchesHost(p.slice(1), token)) || !patterns.some(p => !p.startsWith('!') && matchesHost(p, token))) continue;
      const same = Buffer.from(fields[2] || '', 'base64').equals(raw);
      if (marker === '@revoked' && same) throw new Error('폐기된 SSH 서버 키입니다.');
      if (marker) continue;
      found = true; if (same) trusted = true;
    }
  }
  if (found && !trusted) throw new Error('SSH 서버 키가 기존 known_hosts와 다릅니다. 서버 관리자에게 확인하세요.');
  return trusted;
}
module.exports = { resolveAuth, parseConfig, checkKnownHosts, matchesHost };
