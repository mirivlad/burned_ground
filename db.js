/**
 * SQLite-хранилище: пользователи, токены сессий, история матчей.
 * Пароли — scrypt (встроенный crypto), токены — случайные 32 байта.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.BG_DATA_DIR || path.join(__dirname, 'data');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'burned_ground.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    played_at TEXT NOT NULL DEFAULT (datetime('now')),
    rounds INTEGER NOT NULL DEFAULT 5,
    winner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS match_participants (
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_bot INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    earned INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0,
    UNIQUE (match_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_part_user ON match_participants(user_id);
`);

// ============================================
// ПАРОЛИ И ТОКЕНЫ
// ============================================

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function issueToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO tokens (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

// ============================================
// ПОЛЬЗОВАТЕЛИ
// ============================================

function registerUser(username, password) {
  const name = String(username || '').trim();
  const pass = String(password || '');

  if (name.length < 3 || name.length > 20) {
    return { error: 'Имя: от 3 до 20 символов' };
  }
  if (!/^[A-Za-zА-Яа-яЁё0-9_-]+$/.test(name)) {
    return { error: 'Имя: только буквы, цифры, _ и -' };
  }
  if (pass.length < 4) {
    return { error: 'Пароль: минимум 4 символа' };
  }

  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(name);
  if (exists) {
    return { error: 'Имя уже занято' };
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(pass, salt);

  const info = db.prepare('INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)')
    .run(name, hash, salt);

  const user = { id: info.lastInsertRowid, username: name };
  return { user, token: issueToken(user.id) };
}

function loginUser(username, password) {
  const name = String(username || '').trim();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(name);

  if (!row || !verifyPassword(String(password || ''), row.salt, row.password_hash)) {
    return { error: 'Неверное имя или пароль' };
  }

  return { user: { id: row.id, username: row.username }, token: issueToken(row.id) };
}

function userByToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username FROM tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token = ?
  `).get(String(token));
  return row || null;
}

// ============================================
// МАТЧИ И СТАТИСТИКА
// ============================================

/**
 * Записать завершенный матч.
 * @param {string} roomId
 * @param {number} rounds
 * @param {Array} scores — [{playerId, name, isBot, kills, totalEarned, userId, won}]
 */
function recordMatch(roomId, rounds, scores) {
  const withAccount = scores.filter(s => s.userId && !s.isBot);
  if (withAccount.length === 0) return; // нечего записывать (все гости/боты)

  const winner = scores.find(s => s.won);

  const tx = db.transaction(() => {
    const info = db.prepare('INSERT INTO matches (room_id, rounds, winner_user_id) VALUES (?, ?, ?)')
      .run(roomId, rounds, winner && winner.userId ? winner.userId : null);
    const matchId = info.lastInsertRowid;

    const stmt = db.prepare(`
      INSERT INTO match_participants (match_id, user_id, name, is_bot, kills, earned, won)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const s of withAccount) {
      stmt.run(matchId, s.userId, s.name, 0, s.kills, Math.round(s.totalEarned), s.won ? 1 : 0);
    }
  });

  tx();
}

/**
 * Агрегированная статистика пользователя
 */
function userStats(userId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS matches,
      COALESCE(SUM(won), 0) AS wins,
      COALESCE(SUM(kills), 0) AS kills,
      COALESCE(SUM(earned), 0) AS earned
    FROM match_participants
    WHERE user_id = ?
  `).get(userId);

  return {
    matches: row.matches,
    wins: row.wins,
    kills: row.kills,
    earned: row.earned,
    winRate: row.matches ? Math.round((row.wins / row.matches) * 100) : 0
  };
}

function userStatsByName(username) {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(String(username || ''));
  if (!user) return null;
  return { username: String(username), ...userStats(user.id) };
}

module.exports = {
  db,
  registerUser,
  loginUser,
  userByToken,
  recordMatch,
  userStats,
  userStatsByName
};
