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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL,
    played_at TEXT NOT NULL DEFAULT (datetime('now')),
    rounds INTEGER NOT NULL DEFAULT 5,
    winner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    is_ranked INTEGER NOT NULL DEFAULT 0,
    composition TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS ratings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    elo INTEGER NOT NULL DEFAULT 1000,
    peak_elo INTEGER NOT NULL DEFAULT 1000,
    ranked_games INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS match_participants (
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    is_bot INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    earned INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0,
    place INTEGER NOT NULL DEFAULT 0,
    rounds_won INTEGER NOT NULL DEFAULT 0,
    elo_before INTEGER,
    elo_after INTEGER,
    UNIQUE (match_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_tokens_user ON tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_part_user ON match_participants(user_id);
  CREATE INDEX IF NOT EXISTS idx_ratings_elo ON ratings(elo DESC);
`);

// ============================================
// МИГРАЦИИ (базы на томе живут дольше кода)
// ============================================

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }
}

ensureColumn('tokens', 'expires_at', `expires_at TEXT NOT NULL DEFAULT ''`);
ensureColumn('matches', 'is_ranked', 'is_ranked INTEGER NOT NULL DEFAULT 0');
ensureColumn('matches', 'composition', `composition TEXT NOT NULL DEFAULT '[]'`);
ensureColumn('match_participants', 'place', 'place INTEGER NOT NULL DEFAULT 0');
ensureColumn('match_participants', 'rounds_won', 'rounds_won INTEGER NOT NULL DEFAULT 0');
ensureColumn('match_participants', 'elo_before', 'elo_before INTEGER');
ensureColumn('match_participants', 'elo_after', 'elo_after INTEGER');

// ============================================
// ПАРОЛИ И ТОКЕНЫ
// ============================================

const TOKEN_TTL_DAYS = 30;
const MIN_PASSWORD_LENGTH = 6;

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
  db.prepare(`
    INSERT INTO tokens (token, user_id, expires_at)
    VALUES (?, ?, datetime('now', ?))
  `).run(token, userId, `+${TOKEN_TTL_DAYS} days`);
  return token;
}

function revokeToken(token) {
  if (!token) return false;
  return db.prepare('DELETE FROM tokens WHERE token = ?').run(String(token)).changes > 0;
}

/**
 * Чистка протухших токенов. Строки со старым пустым expires_at (миграция)
 * получают срок от даты выдачи.
 */
function purgeExpiredTokens() {
  db.prepare(`
    UPDATE tokens SET expires_at = datetime(created_at, ?) WHERE expires_at = ''
  `).run(`+${TOKEN_TTL_DAYS} days`);

  return db.prepare(`DELETE FROM tokens WHERE expires_at <= datetime('now')`).run().changes;
}

purgeExpiredTokens();

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
  if (pass.length < MIN_PASSWORD_LENGTH) {
    return { error: `Пароль: минимум ${MIN_PASSWORD_LENGTH} символов` };
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

  if (!row) {
    // Считаем хеш и для несуществующего логина: иначе время ответа
    // выдает, какие имена зарегистрированы
    hashPassword(String(password || ''), 'timing-equalizer');
    return { error: 'Неверное имя или пароль' };
  }

  if (!verifyPassword(String(password || ''), row.salt, row.password_hash)) {
    return { error: 'Неверное имя или пароль' };
  }

  return { user: { id: row.id, username: row.username }, token: issueToken(row.id) };
}

function userByToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username FROM tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token = ? AND (t.expires_at = '' OR t.expires_at > datetime('now'))
  `).get(String(token));
  return row || null;
}

// ============================================
// МАТЧИ И СТАТИСТИКА
// ============================================

// ============================================
// РЕЙТИНГ (Elo)
// ============================================

const ELO = {
  start: 1000,
  k: 32,
  minRankedPlayers: 2      // рейтинговым считается матч от двух авторизованных
};

function getRating(userId) {
  const row = db.prepare('SELECT elo, peak_elo, ranked_games FROM ratings WHERE user_id = ?').get(userId);
  return row || { elo: ELO.start, peak_elo: ELO.start, ranked_games: 0 };
}

/**
 * Изменение Elo в матче на N игроков: попарное сравнение мест.
 * Сумма нормируется на число соперников, иначе матч на 8 человек
 * двигал бы рейтинг в разы сильнее дуэли.
 * @param {Array} players — [{userId, elo, place}]
 * @returns {Map<number, number>} userId -> дельта (целое)
 */
function eloDeltas(players) {
  const deltas = new Map();
  const opponents = players.length - 1;
  if (opponents < 1) return deltas;

  for (const a of players) {
    let sum = 0;
    for (const b of players) {
      if (a === b) continue;
      const expected = 1 / (1 + Math.pow(10, (b.elo - a.elo) / 400));
      const actual = a.place < b.place ? 1 : (a.place === b.place ? 0.5 : 0);
      sum += ELO.k * (actual - expected);
    }
    deltas.set(a.userId, Math.round(sum / opponents));
  }

  return deltas;
}

/**
 * Записать завершенный матч.
 * @param {string} roomId
 * @param {number} rounds
 * @param {Array} scores — все участники, включая ботов и гостей:
 *   [{name, isBot, isGuest, userId, kills, totalEarned, roundWins, place, won}]
 */
function recordMatch(roomId, rounds, scores) {
  const withAccount = scores.filter(s => s.userId && !s.isBot);
  if (withAccount.length === 0) return null;   // все гости/боты — записывать нечего

  const isRanked = withAccount.length >= ELO.minRankedPlayers;
  const winner = scores.find(s => s.won);

  // Состав целиком (боты и гости тоже) — для истории матчей в профиле
  const composition = JSON.stringify(scores.map(s => ({
    name: s.name,
    isBot: !!s.isBot,
    isGuest: !!s.isGuest,
    place: s.place,
    kills: s.kills,
    earned: Math.round(s.totalEarned),
    roundWins: s.roundWins || 0
  })));

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO matches (room_id, rounds, winner_user_id, is_ranked, composition)
      VALUES (?, ?, ?, ?, ?)
    `).run(roomId, rounds, winner && winner.userId ? winner.userId : null, isRanked ? 1 : 0, composition);
    const matchId = info.lastInsertRowid;

    const deltas = isRanked
      ? eloDeltas(withAccount.map(s => ({ userId: s.userId, elo: getRating(s.userId).elo, place: s.place })))
      : new Map();

    const stmt = db.prepare(`
      INSERT INTO match_participants
        (match_id, user_id, name, is_bot, kills, earned, won, place, rounds_won, elo_before, elo_after)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsertRating = db.prepare(`
      INSERT INTO ratings (user_id, elo, peak_elo, ranked_games, updated_at)
      VALUES (?, ?, ?, 1, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        elo = excluded.elo,
        peak_elo = MAX(peak_elo, excluded.elo),
        ranked_games = ranked_games + 1,
        updated_at = datetime('now')
    `);

    for (const s of withAccount) {
      const before = isRanked ? getRating(s.userId).elo : null;
      const after = isRanked ? Math.max(100, before + (deltas.get(s.userId) || 0)) : null;

      stmt.run(
        matchId, s.userId, s.name, s.kills, Math.round(s.totalEarned),
        s.won ? 1 : 0, s.place || 0, s.roundWins || 0, before, after
      );

      if (isRanked) upsertRating.run(s.userId, after, after);
    }
  });

  tx();
  return { isRanked };
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
      COALESCE(SUM(earned), 0) AS earned,
      COALESCE(SUM(rounds_won), 0) AS roundsWon
    FROM match_participants
    WHERE user_id = ?
  `).get(userId);

  const rating = getRating(userId);

  return {
    matches: row.matches,
    wins: row.wins,
    kills: row.kills,
    earned: row.earned,
    roundsWon: row.roundsWon,
    winRate: row.matches ? Math.round((row.wins / row.matches) * 100) : 0,
    elo: rating.elo,
    peakElo: rating.peak_elo,
    rankedGames: rating.ranked_games
  };
}

function userStatsByName(username) {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(String(username || ''));
  if (!user) return null;
  return { username: String(username), ...userStats(user.id) };
}

/**
 * История матчей игрока: состав пишется целиком, поэтому в профиле
 * видно, с кем именно играли (включая ботов и гостей).
 */
function userMatches(userId, limit = 10) {
  const rows = db.prepare(`
    SELECT m.id, m.played_at, m.rounds, m.is_ranked, m.composition,
           p.place, p.kills, p.earned, p.won, p.rounds_won, p.elo_before, p.elo_after
    FROM match_participants p
    JOIN matches m ON m.id = p.match_id
    WHERE p.user_id = ?
    ORDER BY m.id DESC
    LIMIT ?
  `).all(userId, Math.max(1, Math.min(50, limit)));

  return rows.map(r => {
    let composition = [];
    try { composition = JSON.parse(r.composition); } catch { /* старая запись без состава */ }

    return {
      id: r.id,
      playedAt: r.played_at,
      rounds: r.rounds,
      isRanked: !!r.is_ranked,
      place: r.place,
      kills: r.kills,
      earned: r.earned,
      won: !!r.won,
      roundsWon: r.rounds_won,
      eloBefore: r.elo_before,
      eloAfter: r.elo_after,
      eloDelta: (r.elo_after !== null && r.elo_before !== null) ? r.elo_after - r.elo_before : null,
      composition
    };
  });
}

/**
 * Таблица лидеров: только те, кто сыграл хотя бы один рейтинговый матч.
 */
function leaderboard(limit = 50) {
  return db.prepare(`
    SELECT u.username, r.elo, r.peak_elo, r.ranked_games,
           (SELECT COUNT(*) FROM match_participants p WHERE p.user_id = u.id AND p.won = 1) AS wins,
           (SELECT COALESCE(SUM(kills), 0) FROM match_participants p WHERE p.user_id = u.id) AS kills
    FROM ratings r
    JOIN users u ON u.id = r.user_id
    WHERE r.ranked_games > 0
    ORDER BY r.elo DESC, r.ranked_games ASC
    LIMIT ?
  `).all(Math.max(1, Math.min(200, limit))).map((r, i) => ({
    rank: i + 1,
    username: r.username,
    elo: r.elo,
    peakElo: r.peak_elo,
    rankedGames: r.ranked_games,
    wins: r.wins,
    kills: r.kills
  }));
}

function userProfile(username) {
  const user = db.prepare('SELECT id, username, created_at FROM users WHERE username = ?')
    .get(String(username || ''));
  if (!user) return null;

  return {
    user: { username: user.username, createdAt: user.created_at },
    stats: userStats(user.id),
    matches: userMatches(user.id, 10)
  };
}

module.exports = {
  db,
  registerUser,
  loginUser,
  userByToken,
  revokeToken,
  purgeExpiredTokens,
  recordMatch,
  userStats,
  userStatsByName,
  userMatches,
  userProfile,
  getRating,
  eloDeltas,
  leaderboard
};
