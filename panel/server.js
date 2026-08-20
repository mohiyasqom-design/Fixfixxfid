const express = require('express');
const session = require('express-session');
const httpProxy = require('http-proxy');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const db = require('./lib/db');
const xray = require('./lib/xray');
const usage = require('./lib/usage');

const PORT = process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const PUBLIC_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_DOMAIN || '';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

const PRESET_PLANS = {
  '10gb-30d': { dataLimitBytes: 10 * GB, days: 30, label: '۱۰ گیگابایت / ۳۰ روز' },
  '20gb-30d': { dataLimitBytes: 20 * GB, days: 30, label: '۲۰ گیگابایت / ۳۰ روز' },
  unlimited: { dataLimitBytes: null, days: null, label: 'نامحدود' },
};

function resolvePlan(body) {
  const { preset, customAmount, customAmountUnit, customDuration, customDurationUnit } = body || {};

  if (preset && PRESET_PLANS[preset]) {
    const p = PRESET_PLANS[preset];
    const expiresAt = p.days ? new Date(Date.now() + p.days * DAY_MS).toISOString() : null;
    return { dataLimitBytes: p.dataLimitBytes, expiresAt, planLabel: p.label };
  }

  if (preset === 'custom') {
    let dataLimitBytes = null;
    if (customAmount) {
      const unit = customAmountUnit === 'GB' ? GB : MB;
      dataLimitBytes = Math.round(Number(customAmount) * unit);
    }
    let expiresAt = null;
    if (customDuration) {
      const days = customDurationUnit === 'month' ? Number(customDuration) * 30 : Number(customDuration);
      expiresAt = new Date(Date.now() + days * DAY_MS).toISOString();
    }
    const amountLabel = customAmount ? `${customAmount}${customAmountUnit}` : 'نامحدود';
    const durationLabel = customDuration
      ? `${customDuration} ${customDurationUnit === 'month' ? 'ماه' : 'روز'}`
      : 'نامحدود';
    return { dataLimitBytes, expiresAt, planLabel: `${amountLabel} / ${durationLabel}` };
  }

  return null;
}

function buildLink(uuid) {
  const domain = PUBLIC_DOMAIN || 'YOUR_RAILWAY_DOMAIN';
  const encodedPath = encodeURIComponent(xray.VLESS_PATH);
  return `vless://${uuid}@${domain}:443?encryption=none&security=tls&type=ws&host=${domain}&path=${encodedPath}&sni=${domain}#Panel`;
}

function serialize(u) {
  return { ...u, link: buildLink(u.uuid) };
}

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

app.get('/api/users', requireAuth, (req, res) => {
  res.json(db.listUsers().map(serialize));
});

app.get('/api/users/:id', requireAuth, (req, res) => {
  const u = db.getUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  res.json(serialize(u));
});

app.post('/api/users', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const uuid = crypto.randomUUID();
  const user = db.addUser(name.trim(), uuid);
  xray.restart();
  res.json(serialize(user));
});

app.patch('/api/users/:id/name', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const u = db.renameUser(req.params.id, name.trim());
  res.json(serialize(u));
});

app.delete('/api/users/:id', requireAuth, (req, res) => {
  db.removeUser(req.params.id);
  xray.restart();
  res.json({ ok: true });
});

app.patch('/api/users/:id/toggle', requireAuth, (req, res) => {
  const user = db.toggleUser(req.params.id);
  xray.restart();
  res.json(serialize(user));
});

app.post('/api/users/:id/reset-usage', requireAuth, (req, res) => {
  const user = db.resetUsage(req.params.id);
  res.json(serialize(user));
});

app.put('/api/users/:id/plan', requireAuth, (req, res) => {
  const plan = resolvePlan(req.body);
  if (!plan) return res.status(400).json({ error: 'invalid plan' });
  const user = db.setPlan(req.params.id, plan);
  xray.restart();
  res.json(serialize(user));
});

app.get('/api/users/:id/history', requireAuth, (req, res) => {
  res.json(db.getHistory(req.params.id, 60));
});

const server = http.createServer(app);
const wsProxy = httpProxy.createProxyServer({
  target: `ws://127.0.0.1:${xray.XRAY_INTERNAL_PORT}`,
  ws: true,
});

wsProxy.on('error', (err, req, socket) => {
  console.log('WS proxy error (xray likely down):', err.code || err.message);
  if (socket && socket.writable) socket.destroy();
});

server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith(xray.VLESS_PATH)) {
    wsProxy.ws(req, socket, head);
  } else {
    socket.destroy();
  }
});

xray.start();
usage.start();

server.listen(PORT, () => {
  console.log(`Panel listening on port ${PORT}`);
});
