'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createTransferService, validateTransfer, nativeMove, copyFileRecord, inspectTree, noLinkAncestors, sameFile, sameIdentity, transferError } = require('./file-operations.cjs');
const fail = (code, message) => Object.assign(new Error(message || code), { code });
const exists = async p => { try { return await fs.lstat(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

// A journal owns only paths created by this process. Undo refuses externally changed data.
function createTransferManager({ onProgress = () => {} } = {}) {
  let state = null;
  const history = [];
  async function checkpoint(record) {
    while (state?.paused && !state.cancelled) await new Promise(resolve => setTimeout(resolve, 100));
    if (state?.cancelled) throw fail('CANCELLED', '취소됨');
    if (state && record) { state.path = record.path; report(); }
  }
  function report() {
    if (state) onProgress({ ...state, elapsed: Date.now() - state.started, undoCount: history.length });
  }
  async function signature(filename) {
    return (await inspectTree(filename)).map(r => ({ path: r.path, stat: r.stat }));
  }
  async function verify(records) {
    const now = await signature(records[0].path);
    const expected = new Map(records.map(r => [r.path.toLowerCase(), r.stat]));
    if (now.length !== records.length || now.some(r => !expected.has(r.path.toLowerCase()) ||
      !(r.stat.isDirectory() ? sameIdentity(r.stat, expected.get(r.path.toLowerCase())) : sameFile(r.stat, expected.get(r.path.toLowerCase()))))) {
      throw fail('SOURCE_CHANGED', '작업 후 변경된 항목이 있어 실행 취소를 중단했습니다.');
    }
  }
  async function removeOwned(records) {
    await verify(records);
    for (const record of [...records].reverse()) {
      await noLinkAncestors(record.path);
      const stat = await fs.lstat(record.path);
      if (!(stat.isDirectory()?sameIdentity(stat,record.stat):sameFile(stat,record.stat))) throw fail('SOURCE_CHANGED', '항목이 변경되었습니다.');
      if (stat.isDirectory()) await fs.rmdir(record.path); else await fs.unlink(record.path);
    }
  }
  async function transfer(input) {
    if (state) throw fail('TRANSFER_BUSY');
    const request = validateTransfer(input);
    const conflict = input.conflict || 'skip';
    if (!['skip', 'replace', 'merge', 'merge-replace'].includes(conflict)) throw fail('INVALID_TRANSFER');
    state = { operation: request.operation, bytes: 0, totalBytes: 0, completed: 0, paused: false, cancelled: false, started: Date.now(), path: '', phase: '준비' };
    const journal = [];
    const result = { operation: request.operation, completed: [], skipped: [], failed: [] };
    const service = createTransferService({ checkpoint, copyFile: async (record, target, created) => {
      state.phase = '복사'; report();
      // Native CopyFile retains NTFS streams. Pause/cancel takes effect at file boundaries.
      const before = state.bytes;
      const timer = setInterval(async () => {
        try { const stat = await fs.stat(target); if (state) { state.bytes = before + Math.min(stat.size, record.stat.size); report(); } } catch {}
      }, 250);
      try { await copyFileRecord(record, target, created); state.bytes = before + record.stat.size; }
      finally { clearInterval(timer); }
    }});
    async function one(source, destination) {
      await checkpoint();
      await noLinkAncestors(source); await noLinkAncestors(destination);
      const sourceStat = await fs.lstat(source);
      const target = path.win32.join(destination, path.win32.basename(source));
      const s = source.toLowerCase(), t = target.toLowerCase();
      if (s === t || destination.toLowerCase().startsWith(s + '\\') || s.startsWith(t + '\\')) {
        result.skipped.push({ source, code: 'DESCENDANT_TARGET', message: '같은 위치 또는 원본의 하위 폴더입니다.' }); return;
      }
      const old = await exists(target);
      if (old && sourceStat.isDirectory() && old.isDirectory() && conflict.startsWith('merge')) {
        await noLinkAncestors(target);
        for (const child of await fs.readdir(source)) await one(path.win32.join(source, child), target);
        if(request.operation==='move' && !(await fs.readdir(source)).length){
          await fs.rmdir(source);
          journal.push({operation:'removed-directory',source,stat:sourceStat});
          result.completed.push({source,destination:target});
        }
        return;
      }
      let backup, manifest;
      if (old && (conflict === 'replace' || conflict === 'merge-replace')) {
        await noLinkAncestors(target); await inspectTree(target);
        const sourceRecords = await inspectTree(source);
        if (sourceRecords[0].path.toLowerCase() === path.win32.parse(source).root.toLowerCase()) throw fail('ROOT_NOT_SUPPORTED');
        backup = path.win32.join(destination, `.pane-undo-${randomUUID()}`);
        manifest = backup+'.json';
        await fs.writeFile(manifest,JSON.stringify({version:1,originalPath:target,backupPath:backup,createdAt:new Date().toISOString()},null,2),{flag:'wx',mode:0o600});
        try{await nativeMove(target, backup, old.isDirectory() ? 'directory' : 'file');}catch(e){await fs.unlink(manifest).catch(()=>{});throw e;}
      }
      const item = await service.transfer({ sources: [source], destination, operation: request.operation });
      if (item.completed.length) {
        journal.push({ operation: request.operation, source, target, backup, manifest, records: await signature(target) });
        state.completed++; report();
      } else if (backup) {
        try { await nativeMove(backup, target, old.isDirectory() ? 'directory' : 'file'); await fs.unlink(manifest).catch(()=>{}); }
        catch { item.failed.push({ source: target, code: 'RECOVERY_REQUIRED', message: `기존 항목은 ${backup} 에 보관되어 있습니다.` }); }
      }
      for (const key of ['completed', 'skipped', 'failed']) result[key].push(...item[key]);
      if (item.failed.some(e => e.code === 'CANCELLED')) throw fail('CANCELLED');
    }
    try {
      for (const source of request.sources) {
        try { for (const r of await inspectTree(source)) if (r.stat.isFile()) state.totalBytes += r.stat.size; }
        catch {} // The actual operation reports inaccessible items individually.
      }
      report();
      for (const source of request.sources) {
        try { await one(source, request.destination); }
        catch (e) {
          if (e.code === 'CANCELLED') { result.cancelled = true; break; }
          result.failed.push({ source, ...transferError(e) });
        }
      }
      return result;
    } finally {
      if (journal.length) history.push(journal);
      const final = { ...state, finished: true, undoCount: history.length };
      state = null; onProgress(final);
    }
  }
  return {
    transfer,
    async recordAction(operation,source,target) {
      try {
        const records=await signature(target);
        history.push([{operation,source,target,records}]);
        onProgress({finished:true,undoCount:history.length,bytes:0,totalBytes:0});
      } catch { /* An action with unsupported descendants remains completed, without an undo record. */ }
    },
    control(command) {
      if (!state) return null;
      if (command === 'pause') state.paused = true;
      else if (command === 'resume') state.paused = false;
      else if (command === 'cancel') { state.cancelled = true; state.paused = false; }
      else throw fail('INVALID_TRANSFER');
      report(); return { ...state };
    },
    async undo() {
      if (state) throw fail('TRANSFER_BUSY');
      const journal = history.at(-1);
      if (!journal) throw fail('INVALID_ACTION', '실행 취소할 복사·이동 작업이 없습니다.');
      // Preflight all entries before changing any of them.
      for (const entry of journal) {
        if (entry.undone) continue;
        if(entry.operation==='removed-directory'){
          if(await exists(entry.source))throw fail('EEXIST',`원래 폴더 위치가 사용 중입니다: ${entry.source}`);
          continue;
        }
        await verify(entry.records);
        if (['move','rename'].includes(entry.operation) && entry.source.toLowerCase()!==entry.target.toLowerCase() && await exists(entry.source)) throw fail('EEXIST', `원래 위치가 사용 중입니다: ${entry.source}`);
      }
      const relocations=[];
      while (journal.length) {
        const entry = journal.at(-1);
        if(entry.operation==='removed-directory'){
          await noLinkAncestors(path.win32.dirname(entry.source));
          await fs.mkdir(entry.source);await fs.utimes(entry.source,entry.stat.atime,entry.stat.mtime);
          journal.pop();continue;
        }
        if (!entry.undone) {
          if(entry.operation==='rename'){
            const mode=entry.records[0].stat.isDirectory()?'directory':'file';
            if(entry.source.toLowerCase()===entry.target.toLowerCase()){
              const temp=path.win32.join(path.win32.dirname(entry.target),`.pane-rename-${randomUUID()}`);
              await nativeMove(entry.target,temp,mode);
              try{await nativeMove(temp,entry.source,mode);}catch(e){await nativeMove(temp,entry.target,mode).catch(()=>{});throw e;}
            }else await nativeMove(entry.target,entry.source,mode);
            relocations.push({source:entry.target,destination:entry.source});
          }else if (entry.operation === 'move') {
            const outcome = await createTransferService().transfer({ operation: 'move', sources: [entry.target], destination: path.win32.dirname(entry.source) });
            if (outcome.completed.length !== 1) throw fail('UNDO_FAILED', JSON.stringify(outcome));
            relocations.push({source:entry.target,destination:entry.source});
          } else await removeOwned(entry.records);
          entry.undone = true;
        }
        if (entry.backup) {
          const stat = await fs.lstat(entry.backup);
          await nativeMove(entry.backup, entry.target, stat.isDirectory() ? 'directory' : 'file');
          if(entry.manifest)await fs.unlink(entry.manifest).catch(()=>{});
        }
        journal.pop();
      }
      history.pop(); return { undoCount: history.length,relocations };
    },
    get undoCount() { return history.length; },
  };
}
module.exports = { createTransferManager };
