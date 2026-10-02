// Phone remote: a tiny HTTP + WebSocket server on the local network.
// Off by default; the panel switches it on. Every request must carry the
// secret key from the QR code (?k=...), so only whoever scans it can drive
// the app. Phones send commands, the panel executes them (same code paths
// as its own buttons) and pushes back a compact live state.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const STATIC = {
  '/': ['remote.html', 'text/html; charset=utf-8'],
  '/remote.js': ['remote.js', 'text/javascript; charset=utf-8'],
  '/remote.css': ['remote.css', 'text/css; charset=utf-8'],
  '/fonts/orbitron-latin-800-normal.woff2': ['fonts/orbitron-latin-800-normal.woff2', 'font/woff2'],
  '/fonts/rajdhani-latin-600-normal.woff2': ['fonts/rajdhani-latin-600-normal.woff2', 'font/woff2'],
  '/fonts/rajdhani-latin-700-normal.woff2': ['fonts/rajdhani-latin-700-normal.woff2', 'font/woff2'],
  '/manifest.webmanifest': [null, 'application/manifest+json']
};

// LAN IPv4 addresses, Wi-Fi/Ethernet first (skips loopback and link-local).
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ name, address: a.address });
    }
  }
  out.sort((a, b) => (/^en/.test(b.name) ? 1 : 0) - (/^en/.test(a.name) ? 1 : 0));
  return out.map(a => a.address);
}

class RemoteServer {
  constructor({ srcDir, onCommand }) {
    this.srcDir = srcDir;
    this.onCommand = onCommand;   // (msg) => void
    this.server = null;
    this.wss = null;
    this.key = null;
    this.port = 0;
    this.lastState = null;
  }

  get running() { return !!this.server; }

  async start(preferredPort = 8787, key) {
    if (this.server) return this.info();
    this.key = key || crypto.randomBytes(6).toString('hex');
    const server = http.createServer((req, res) => this._http(req, res));
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req, sock, head) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname !== '/ws' || u.searchParams.get('k') !== this.key) { sock.destroy(); return; }
      wss.handleUpgrade(req, sock, head, (ws) => wss.emit('connection', ws));
    });
    wss.on('connection', (ws) => {
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', (data) => {
        let m; try { m = JSON.parse(String(data)); } catch (e) { return; }
        if (m && typeof m.cmd === 'string') this.onCommand(m);
      });
      if (this.lastState) ws.send(JSON.stringify({ type: 'state', state: this.lastState }));
      this.onCommand({ cmd: '_clients', n: wss.clients.size });
      ws.on('close', () => this.onCommand({ cmd: '_clients', n: wss.clients.size }));
    });
    // drop phones that went to sleep without closing the socket
    this._ping = setInterval(() => {
      for (const ws of wss.clients) {
        if (!ws.isAlive) { ws.terminate(); continue; }
        ws.isAlive = false; try { ws.ping(); } catch (e) {}
      }
    }, 10000);
    // first free port from the preferred one
    for (let p = preferredPort; p < preferredPort + 20; p++) {
      const ok = await new Promise(resolve => {
        server.once('error', () => resolve(false));
        server.listen(p, '0.0.0.0', () => resolve(true));
      });
      if (ok) { this.port = p; break; }
    }
    if (!this.port) { clearInterval(this._ping); throw new Error('Nessuna porta libera per il telecomando'); }
    this.server = server; this.wss = wss;
    return this.info();
  }

  stop() {
    if (!this.server) return;
    clearInterval(this._ping);
    for (const ws of this.wss.clients) { try { ws.close(); } catch (e) {} }
    this.wss.close(); this.server.close();
    this.server = null; this.wss = null; this.port = 0;
  }

  async info() {
    if (!this.server) return { on: false };
    const ips = lanAddresses();
    const urls = ips.map(ip => `http://${ip}:${this.port}/?k=${this.key}`);
    const qr = urls[0] ? await QRCode.toDataURL(urls[0], { margin: 1, width: 360, color: { dark: '#04050bff', light: '#ffffffff' } }) : null;
    return { on: true, port: this.port, key: this.key, urls, qr, clients: this.wss ? this.wss.clients.size : 0 };
  }

  broadcast(state) {
    this.lastState = state;
    if (!this.wss) return;
    const msg = JSON.stringify({ type: 'state', state });
    for (const ws of this.wss.clients) if (ws.readyState === 1) ws.send(msg);
  }

  _http(req, res) {
    const u = new URL(req.url, 'http://x');
    const entry = STATIC[u.pathname];
    // the page itself needs the key; its assets are public (no secrets in them)
    if (!entry || (u.pathname === '/' && u.searchParams.get('k') !== this.key)) {
      res.writeHead(u.pathname === '/' ? 403 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(u.pathname === '/' ? 'Codice non valido: inquadra di nuovo il QR dal pannello.' : 'not found');
      return;
    }
    if (u.pathname === '/manifest.webmanifest') {
      res.writeHead(200, { 'Content-Type': entry[1] });
      res.end(JSON.stringify({ name: 'DJ Visualizer Remote', short_name: 'DJV Remote',
        start_url: '/?k=' + this.key, display: 'standalone', background_color: '#04050b', theme_color: '#04050b' }));
      return;
    }
    fs.readFile(path.join(this.srcDir, entry[0]), (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  }
}

module.exports = { RemoteServer };
