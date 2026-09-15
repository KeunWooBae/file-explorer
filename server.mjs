import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/theme.js', ['theme.js', 'text/javascript; charset=utf-8']],
]);
for (const [file,type] of [['multi-terminal.js','text/javascript'],['ssh-workspace.js','text/javascript'],['ssh-workspace.css','text/css'],['node_modules/@xterm/xterm/lib/xterm.js','text/javascript'],['node_modules/@xterm/xterm/css/xterm.css','text/css'],['node_modules/@xterm/addon-fit/lib/addon-fit.js','text/javascript']]) assets.set('/'+file,[file,type+'; charset=utf-8']);
const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const server = http.createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }
  let pathname;
  try {
    pathname = new URL(request.url, 'http://localhost').pathname;
  } catch {
    response.writeHead(400);
    response.end('Bad request');
    return;
  }
  const asset = assets.get(pathname);
  if (!asset) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  try {
    let body = await readFile(new URL(asset[0], import.meta.url));
    if(asset[0]==='index.html')body=Buffer.from(body.toString('utf8').replaceAll('__PANE_STYLE_NONCE__',randomBytes(24).toString('base64')));
    response.writeHead(200, { 'Content-Type': asset[1], 'Content-Length': body.length });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    console.error(`Cannot serve ${asset[0]}: ${error.message}`);
    response.writeHead(500);
    response.end('Unable to load the prototype');
  }
});

server.on('error', (error) => {
  console.error(`Cannot start pane: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`pane prototype: http://127.0.0.1:${port}`);
});
