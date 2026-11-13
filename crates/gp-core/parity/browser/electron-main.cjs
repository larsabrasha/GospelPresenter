// A hidden Chromium (Electron's) for the browser check, its background throttling off so the times are a front
// page's: it serves the check's files on a free port and opens the page.
const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { readFile } = require('node:fs');
const { join, extname } = require('node:path');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' };
app.whenReady().then(() => {
  const dir = process.env.GP_CHECK_DIR;
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const file = join(dir, path === '/' ? 'index.html' : decodeURIComponent(path));
    readFile(file, (err, body) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(body);
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    win.loadURL(`http://localhost:${server.address().port}/${process.env.GP_CHECK_QUERY ?? ''}`);
  });
});
