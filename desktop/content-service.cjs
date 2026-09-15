'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { normalizePath } = require('./filesystem.cjs');
const { mutationPath, noLinkAncestors } = require('./file-operations.cjs');
const unzipper = require('unzipper');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

async function preview(input) {
  const filename = normalizePath(input);
  const stat = await fs.stat(filename);
  if (!stat.isFile()) throw new Error('파일을 선택하세요.');
  const ext = path.extname(filename).toLowerCase();
  const images = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.bmp':'image/bmp' };
  if (images[ext]) {
    if (stat.size > 12 * 1024 * 1024) throw new Error('이미지 미리보기는 12 MB 이하를 지원합니다.');
    return { kind: 'image', data: `data:${images[ext]};base64,${(await fs.readFile(filename)).toString('base64')}` };
  }
  if (!/\.(txt|md|json|js|cjs|mjs|ts|tsx|jsx|css|html|xml|csv|log|py|c|cpp|h|rs|ini|yaml|yml|toml|sql|sh|ps1)$/i.test(filename)) throw new Error('텍스트·소스 코드와 PNG/JPEG/GIF/WebP/BMP 미리보기를 지원합니다.');
  const handle = await fs.open(filename, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, 256 * 1024));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return { kind: 'text', data: buffer.subarray(0, bytesRead).toString('utf8'), truncated: stat.size > buffer.length };
  } finally { await handle.close(); }
}
async function archive(input) {
  const filename = normalizePath(input);
  if (path.extname(filename).toLowerCase() !== '.zip') throw new Error('현재 ZIP 형식을 지원합니다.');
  const content = await unzipper.Open.file(filename);
  if (content.files.length > 50000) throw new Error('ZIP 항목이 50,000개를 초과합니다.');
  return content;
}
async function listArchive(input) {
  return (await archive(input)).files.map((entry, index) => ({ index, name: entry.path, size: entry.uncompressedSize, type: entry.type }));
}
async function extractEntry({ archive: filename, index, destination }) {
  const entries = (await archive(filename)).files;
  if (!Number.isInteger(index) || !entries[index] || entries[index].type !== 'File') throw new Error('추출할 파일을 선택하세요.');
  const entry = entries[index];
  // Extract one file to the chosen directory. Never trust ZIP paths or create ancestors.
  const name = entry.path.replaceAll('\\', '/').split('/').at(-1);
  const parent = mutationPath(destination);
  const target = mutationPath(path.win32.join(parent, name));
  if (path.win32.dirname(target).toLowerCase() !== parent.toLowerCase()) throw new Error('잘못된 ZIP 경로입니다.');
  await noLinkAncestors(parent);
  if (entry.uncompressedSize > 1024 ** 3) throw new Error('개별 추출은 1 GB 이하를 지원합니다.');
  const handle = await fs.open(target, 'wx');
  const identity = await handle.stat();
  let bytes = 0;
  const limit = new Transform({ transform(chunk, enc, cb) { bytes += chunk.length; cb(bytes > 1024 ** 3 ? new Error('추출 크기 제한을 초과했습니다.') : null, chunk); } });
  try { await pipeline(entry.stream(), limit, handle.createWriteStream()); }
  catch (e) { await handle.close().catch(() => {}); const current=await fs.lstat(target).catch(()=>null);if(current && current.dev===identity.dev && current.ino===identity.ino && !current.isSymbolicLink())await fs.unlink(target).catch(()=>{}); throw e; }
  return { path: target };
}
module.exports = { preview, listArchive, extractEntry };
