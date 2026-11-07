'use strict';
// Shared helpers for the headless Edge smoke tests.
// No npm dependencies: uses Node's built-in http / fetch / WebSocket.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', 'public');
const OUT = process.env.SMOKE_OUT ||
  path.join(process.env.TEMP || process.env.TMP || '.', 'opencode', 'leidian-smoke');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const BROWSER_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
].filter(Boolean);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function findBrowser() {
  for (const p of BROWSER_CANDIDATES) {
    try { if (fs.existsSync(p)) return p; } catch (e) { /* ignore */ }
  }
  throw new Error('No Chromium browser found. Set EDGE_PATH to chrome/edge executable.');
}

function createServer(port, root = ROOT) {
  const server = http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(req.url.split('?')[0]);
    } catch (e) {
      res.writeHead(400).end('bad request');
      return;
    }
    if (urlPath === '/') urlPath = '/index.html';
    const file = path.resolve(root, '.' + urlPath);
    if (!file.startsWith(root + path.sep) && file !== root) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function waitJson(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch (e) { /* retry */ }
    await sleep(200);
  }
  throw new Error('timeout waiting for ' + url);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method && this.handlers.has(msg.method)) {
        for (const fn of this.handlers.get(msg.method)) fn(msg.params);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
}

async function launchBrowser(opts = {}) {
  const cdpPort = opts.cdpPort || 9337;
  const profile = opts.profile || path.join(OUT, 'edge-profile');
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--remote-debugging-port=' + cdpPort,
    '--user-data-dir=' + profile
  ];
  if (opts.windowSize) args.push('--window-size=' + opts.windowSize);
  args.push('about:blank');

  fs.mkdirSync(path.dirname(profile), { recursive: true });
  fs.rmSync(profile, { recursive: true, force: true });

  const proc = spawn(findBrowser(), args, { stdio: 'ignore' });
  await waitJson('http://127.0.0.1:' + cdpPort + '/json/version');

  const tab = await (await fetch(
    'http://127.0.0.1:' + cdpPort + '/json/new?about:blank',
    { method: 'PUT' }
  )).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  const cdp = new CDP(ws);

  return {
    cdp,
    async close() {
      try { await cdp.send('Browser.close'); } catch (e) { /* ignore */ }
      try { proc.kill(); } catch (e) { /* ignore */ }
    }
  };
}

function attachErrorTracking(cdp, errors) {
  cdp.on('Runtime.exceptionThrown', p => {
    errors.push('EXCEPTION: ' +
      (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text));
  });
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error' || p.type === 'assert') {
      errors.push('CONSOLE: ' + p.args.map(a => a.value !== undefined ? a.value : a.description || '').join(' '));
    }
  });
  cdp.on('Log.entryAdded', p => {
    if (p.entry.level === 'error') errors.push('LOG: ' + p.entry.text + ' ' + (p.entry.url || ''));
  });
}

async function openPage(cdp, url) {
  const loaded = new Promise(resolve => cdp.on('Page.loadEventFired', resolve));
  await cdp.send('Page.navigate', { url });
  await loaded;
}

module.exports = {
  ROOT, OUT, MIME, sleep, findBrowser, createServer,
  waitJson, launchBrowser, attachErrorTracking, openPage
};
