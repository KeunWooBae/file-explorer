'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const { validatePaths } = require('./explorer-actions.cjs');
const { noLinkAncestors } = require('./file-operations.cjs');
async function showShellMenu(input, directory) {
  const paths = validatePaths(input);
  const parent = path.win32.dirname(paths[0]).toLowerCase();
  if (paths.some(p => path.win32.dirname(p).toLowerCase() !== parent)) throw new Error('같은 폴더의 항목들을 선택하세요.');
  for (const filename of paths) await noLinkAncestors(filename);
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['-NoProfile','-NonInteractive','-Sta','-ExecutionPolicy','Bypass','-File',path.join(directory,'shell-menu.ps1')], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.resume();
    child.on('error', reject); child.stdin.on('error', () => {});
    child.on('close', code => { try { const result=JSON.parse(output); if(code || !result.ok) throw new Error(result.message || 'Windows 메뉴를 열지 못했습니다.'); resolve(null); } catch(e) { reject(e); } });
    child.stdin.end(JSON.stringify({ paths }));
  });
}
module.exports = { showShellMenu };
