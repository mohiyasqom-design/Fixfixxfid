const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || '/data';
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'panel.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    uuid TEXT NOT NULL UNIQUE,
    enabled INTEGER NOT NULL DEFAULT 1,
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

function recordSnapshot(userId, uplink, downlink) {
  db.prepare('INSERT INTO traffic_history (user_id, uplink, downlink) VALUES (?, ?, ?)').run(
    userId,
    uplink,
    downlink
  );
}

function getHistory(userId, limit = 50) {
  const rows = db
    .prepare('SELECT ts, uplink, downlink FROM traffic_history WHERE user_id = ? ORDER BY id DESC LIMIT ?')
    .all(userId, limit);
  return rows.reverse();
}

function listUsers() {
  return db.prepare('SELECT * FROM users ORDER BY id DESC').all();
}

function addUser(name, uuid) {
  const stmt = db.prepare('INSERT INTO users (name, uuid) VALUES (?, ?)');
  const info = stmt.run(name, uuid);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

function removeUser(id) {
  db.prepare('DELETE FROM traffic_history WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

function toggleUser(id) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return null;
  const newState = user.enabled ? 0 : 1;
  db.prepare('UPDATE users SET enabled = ? WHERE id = ?').run(newState, id);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function enabledUsers() {
  return db.prepare('SELECT * FROM users WHERE enabled = 1').all();
}

module.exports = {
  listUsers,
  addUser,
  removeUser,
  toggleUser,
  enabledUsers,
  recordSnapshot,
  getHistory,
};
