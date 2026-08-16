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

function listUsers() {
  return db.prepare('SELECT * FROM users ORDER BY id DESC').all();
}

function addUser(name, uuid) {
  const stmt = db.prepare('INSERT INTO users (name, uuid) VALUES (?, ?)');
  const info = stmt.run(name, uuid);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
}

function removeUser(id) {
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

module.exports = { listUsers, addUser, removeUser, toggleUser, enabledUsers };
