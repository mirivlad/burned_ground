const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// База открывается при require, поэтому каталог задаем заранее
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-rating-'));
process.env.BG_DATA_DIR = DATA_DIR;

const auth = require('../db');

test.after(() => {
  try {
    auth.db.close();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  } catch { /* временный каталог мог уже уйти */ }
});

test('дуэль равных дает симметричные ±16', () => {
  const deltas = auth.eloDeltas([
    { userId: 1, elo: 1000, place: 1 },
    { userId: 2, elo: 1000, place: 2 }
  ]);

  assert.equal(deltas.get(1), 16);
  assert.equal(deltas.get(2), -16);
});

test('в матче на четверых сумма изменений около нуля и качает слабее K', () => {
  const deltas = auth.eloDeltas([
    { userId: 1, elo: 1000, place: 1 },
    { userId: 2, elo: 1000, place: 2 },
    { userId: 3, elo: 1000, place: 3 },
    { userId: 4, elo: 1000, place: 4 }
  ]);

  const sum = [...deltas.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum) <= 2, `сумма ${sum}`);
  assert.ok(deltas.get(1) > 0 && deltas.get(4) < 0);
  assert.ok(Math.abs(deltas.get(1)) < 32, 'матч на четверых не должен качать как дуэль');
});

test('победа над сильно старшим дает заметно больше', () => {
  const deltas = auth.eloDeltas([
    { userId: 1, elo: 800, place: 1 },
    { userId: 2, elo: 1600, place: 2 }
  ]);

  assert.ok(deltas.get(1) > 25, `получено ${deltas.get(1)}`);
});

test('матч двух авторизованных рейтинговый, против ботов — нет', () => {
  const a = auth.registerUser('РейтингА', 'artillery');
  const b = auth.registerUser('РейтингБ', 'artillery');
  const c = auth.registerUser('Одиночка', 'artillery');

  const ranked = auth.recordMatch('R1', 5, [
    { name: 'РейтингА', userId: a.user.id, isBot: false, isGuest: false, kills: 5, totalEarned: 3000, roundWins: 3, place: 1, won: true },
    { name: 'РейтингБ', userId: b.user.id, isBot: false, isGuest: false, kills: 2, totalEarned: 1500, roundWins: 2, place: 2, won: false }
  ]);
  assert.equal(ranked.isRanked, true);
  assert.equal(auth.getRating(a.user.id).elo, 1016);
  assert.equal(auth.getRating(b.user.id).elo, 984);

  const vsBots = auth.recordMatch('R2', 5, [
    { name: 'Одиночка', userId: c.user.id, isBot: false, isGuest: false, kills: 9, totalEarned: 9000, roundWins: 5, place: 1, won: true },
    { name: 'Снайпер-1', userId: null, isBot: true, isGuest: false, kills: 0, totalEarned: 0, roundWins: 0, place: 2, won: false }
  ]);
  assert.equal(vsBots.isRanked, false);
  assert.equal(auth.getRating(c.user.id).elo, 1000, 'рейтинг фармить ботами нельзя');

  const stats = auth.userStats(c.user.id);
  assert.equal(stats.matches, 1, 'но в общую статистику матч попадает');
  assert.equal(stats.rankedGames, 0);
});

test('состав матча сохраняется целиком, включая ботов и гостей', () => {
  const d = auth.registerUser('Историк', 'artillery');

  auth.recordMatch('R3', 5, [
    { name: 'Историк', userId: d.user.id, isBot: false, isGuest: false, kills: 1, totalEarned: 500, roundWins: 1, place: 2, won: false },
    { name: 'Прохожий', userId: null, isBot: false, isGuest: true, kills: 4, totalEarned: 2000, roundWins: 4, place: 1, won: false },
    { name: 'Кадет-7', userId: null, isBot: true, isGuest: false, kills: 0, totalEarned: 100, roundWins: 0, place: 3, won: false }
  ]);

  const [match] = auth.userMatches(d.user.id, 5);
  assert.equal(match.composition.length, 3);
  assert.ok(match.composition.some(x => x.isGuest && x.name === 'Прохожий'));
  assert.ok(match.composition.some(x => x.isBot));
  assert.equal(match.eloDelta, null, 'матч с одним авторизованным рейтинг не двигает');
});

test('в таблице лидеров только сыгравшие рейтинговые матчи', () => {
  const board = auth.leaderboard(50);
  const names = board.map(l => l.username);

  assert.ok(names.includes('РейтингА'));
  assert.ok(!names.includes('Одиночка'), 'без рейтинговых матчей в таблицу не попадают');
  assert.equal(board[0].rank, 1);
  assert.ok(board[0].elo >= board[board.length - 1].elo, 'сортировка по убыванию Elo');
});

test('профиль отдает рейтинг и историю, несуществующий игрок — null', () => {
  const profile = auth.userProfile('РейтингБ');

  assert.equal(profile.stats.elo, 984);
  assert.equal(profile.matches.length, 1);
  assert.equal(auth.userProfile('НетТакогоИгрока'), null);
});
