'use strict';
const { StringDecoder } = require('node:string_decoder');
function createDirectoryParser(token, onDirectory) {
  const decoder = new StringDecoder('utf8');
  const prefix = '\x1b]777;pane-cwd;' + token + ';';
  let buffer = '';
  return chunk => {
    buffer += decoder.write(chunk);
    while (true) {
      const start = buffer.indexOf(prefix);
      if (start < 0) { buffer = buffer.slice(-(prefix.length - 1)); return; }
      buffer = buffer.slice(start);
      const end = buffer.indexOf('\x07', prefix.length);
      if (end < 0) { if (buffer.length > 48000) buffer = ''; return; }
      const encoded = buffer.slice(prefix.length, end); buffer = buffer.slice(end + 1);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length > 44000) continue;
      const directory = Buffer.from(encoded, 'base64').toString('utf8');
      if (directory.startsWith('/') && directory.length <= 32767 && !/[\x00-\x1f\x7f]/.test(directory)) onDirectory(directory);
    }
  };
}
function integrationCommand(token) {
  if (!/^[a-f0-9]{32}$/.test(token)) throw new Error('Invalid terminal token');
  // The hook exists only in this shell process; no remote startup files are edited.
  const report = `__pane_report_pwd(){ printf '\\033]777;pane-cwd;${token};%s\\007' "$(printf '%s' "$PWD" | base64 | tr -d '\\r\\n')"; };`;
  return ` ${report} if [ -n "$BASH_VERSION" ]; then eval 'PROMPT_COMMAND+=(__pane_report_pwd)'; elif [ -n "$ZSH_VERSION" ]; then eval 'precmd_functions+=(__pane_report_pwd)'; else printf '\\nFollow terminal folder: Bash/Zsh required\\n'; fi; __pane_report_pwd\r`;
}
module.exports = { createDirectoryParser, integrationCommand };
