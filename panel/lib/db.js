const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || '/data';
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'panel.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    uuid TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
    auto_disabled INTEGER NOT NULL DEFAULT 0,
    uploaded_total INTEGER NOT NULL DEFAULT 0,
    downloaded_total INTEGER NOT NULL DEFAULT 0,
    last_raw_uplink INTEGER NOT NULL DEFAULT 0,
    last_raw_downlink INTEGER NOT NULL DEFAULT 0,
    data_limit_bytes INTEGER,
    expires_at TEXT,
    plan_label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS traffic_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    ts TEXT NOT NULL DEFAULT (datetime('now')),
    uplink INTEGER NOT NULL,
    downlink INTEGER NOT NULL
  )
`);

// Safe migration path for panels upgraded from v1 (Volume already has a users table
// without the newer columns). ALTER errors for already-existing columns are ignored.
function safeAddColumn(table, def) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
  } catch (e) {
    /* column already exists */
  }
}
safeAddColumn('users', 'auto_disabled INTEGER NOT NULL DEFAULT 0');
safeAddColumn('users', 'uploaded_total INTEGER NOT NULL DEFAULT 0');
safeAddColumn('users', 'downloaded_total INTEGER NOT NULL DEFAULT 0');
safeAddColumn('users', 'last_raw_uplink INTEGER NOT NULL DEFAULT 0');
safeAddColumn('users', 'last_raw_downlink INTEGER NOT NULL DEFAULT 0');
safeAddColumn('users', 'data_limit_bytes INTEGER');
safeAddColumn('users', 'expires_at TEXT');
safeAddColumn('users', 'plan_label TEXT');

function listUsers() {
  return db.prepare('SELECT * FROM users ORDER BY id DESC').all();
}

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function addUser(name, uuid) {
  const info = db.prepare('INSERT INTO users (name, uuid) VALUES (?, ?)').run(name, uuid);
  return getUser(info.lastInsertRowid);
}

function renameUser(id, name) {
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, id);
  return getUser(id);
}

function removeUser(id) {
  db.prepare('DELETE FROM traffic_history WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

function setEnabled(id, enabled, autoDisabled = 0) {
  db.prepare('UPDATE users SET enabled = ?, auto_disabled = ? WHERE id = ?').run(
    enabled ? 1 : 0,
    autoDisabled ? 1 : 0,
    id
  );
  return getUser(id);
}

function toggleUser(id) {
  const u = getUser(id);
  if (!u) return null;
  return setEnabled(id, u.enabled ? 0 : 1, 0);
}

function enabledUsers() {
  return db.prepare('SELECT * FROM users WHERE enabled = 1').all();
}

function applyUsageDelta(id, deltaUp, deltaDown, rawUp, rawDown) {
  db.prepare(
    `UPDATE users
     SET uploaded_total = uploaded_total + ?,
         downloaded_total = downloaded_total + ?,
         last_raw_uplink = ?,
         last_raw_downlink = ?
     WHERE id = ?`
  ).run(deltaUp, deltaDown, rawUp, rawDown, id);
}

function resetUsage(id) {
  db.prepare('UPDATE users SET uploaded_total = 0, downloaded_total = 0 WHERE id = ?').run(id);
  return getUser(id);
}

function setPlan(id, { dataLimitBytes, expiresAt, planLabel }) {
  db.prepare(
    `UPDATE users
     SET data_limit_bytes = ?, expires_at = ?, plan_label = ?, enabled = 1, auto_disabled = 0
     WHERE id = ?`
  ).run(dataLimitBytes, expiresAt, planLabel, id);
  return getUser(id);
}

function recordSnapshot(userId, uplinkTotal, downlinkTotal) {
  db.prepare('INSERT INTO traffic_history (user_id, uplink, downlink) VALUES (?, ?, ?)').run(
    userId,
    uplinkTotal,
    downlinkTotal
  );
}

function getHistory(userId, limit = 60) {
  const rows = db
    .prepare('SELECT ts, uplink, downlink FROM traffic_history WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(userId, limit);
  return rows.reverse();
}

module.exports = {
  listUsers,
  getUser,
  addUser,
  renameUser,
  removeUser,
  setEnabled,
  toggleUser,
  enabledUsers,
  applyUsageDelta,
  resetUsage,
  setPlan,
  recordSnapshot,
  getHistory,
};
