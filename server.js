const express = require('express');
const session = require('express-session');
const httpProxy = require('http-proxy');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const db = require('./lib/db');
const xray = require('./lib/xray');

const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PUBLIC_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_DOMAIN || '';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'wrong password' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/users', requireAuth, async (req, res) => {
  const users = db.listUsers();
  const stats = await xray.getStats();
  const enriched = users.map((u) => ({
    ...u,
    traffic: stats[u.name] || { uplink: 0, downlink: 0 },
    link: buildLink(u.uuid),
  }));
  res.json(enriched);
});

app.post('/api/users', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const uuid = crypto.randomUUID();
  const user = db.addUser(name.trim(), uuid);
  xray.restart();
  res.json({ ...user, link: buildLink(user.uuid) });
});

app.delete('/api/users/:id', requireAuth, (req, res) => {
  db.removeUser(req.params.id);
  xray.restart();
  res.json({ ok: true });
});

app.patch('/api/users/:id/toggle', requireAuth, (req, res) => {
  const user = db.toggleUser(req.params.id);
  xray.restart();
  res.json(user);
});

function buildLink(uuid) {
  const domain = PUBLIC_DOMAIN || 'YOUR_RAILWAY_DOMAIN';
  const encodedPath = encodeURIComponent(xray.VLESS_PATH);
  return `vless://${uuid}@${domain}:443?encryption=none&security=tls&type=ws&host=${domain}&path=${encodedPath}&sni=${domain}#Panel`;
}

const server = http.createServer(app);
const wsProxy = httpProxy.createProxyServer({
  target: `ws://127.0.0.1:${xray.XRAY_INTERNAL_PORT}`,
  ws: true,
});

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith(xray.VLESS_PATH)) {
    wsProxy.ws(req, socket, head);
  } else {
    socket.destroy();
  }
});

xray.start();

server.listen(PORT, () => {
  console.log(`Panel listening on port ${PORT}`);
});
