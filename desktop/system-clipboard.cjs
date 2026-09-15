'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const { validateTransfer } = require('./file-operations.cjs');
// WinForms uses predefined CF_HDROP, not a custom format named CF_HDROP.
function createSystemClipboard({ directory }) {
  function call(request) {
    const exe=path.join(process.env.SystemRoot || 'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
    return new Promise((resolve,reject)=>{
      const child=spawn(exe,['-NoProfile','-NonInteractive','-Sta','-ExecutionPolicy','Bypass','-File',path.join(directory,'clipboard.ps1')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.resume();child.on('error',reject);child.stdin.on('error',()=>{});
      child.on('close',code=>{try{const result=JSON.parse(output);if(code||!result.ok)throw new Error(result.message||'클립보드에 접근할 수 없습니다.');resolve(result.value);}catch(e){reject(e);}});
      child.stdin.end(JSON.stringify(request));
    });
  }
  return {
    async write(input) {
      if(input?.sources?.length===0 && input.expected?.length){await call({action:'clear',sources:input.expected});return null;}
      const value=validateTransfer({...input,destination:'C:\\'});
      return call({action:'write',sources:value.sources,operation:value.operation});
    },
    async read() {
      const value=await call({action:'read'});
      if(!value)return null;
      return {sources:validateTransfer({...value,destination:'C:\\'}).sources,operation:value.operation};
    },
  };
}
module.exports={createSystemClipboard};
