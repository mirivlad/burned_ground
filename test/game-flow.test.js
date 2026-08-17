/**
 * Интеграционные проверки поверх живого сервера: один процесс на весь файл.
 * Проверяем контракты, которые нельзя увидеть в юнит-тестах — сокеты,
 * настройки комнаты, права хоста и снаряжение в бою.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { io } = require('socket.io-client');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BG_TEST_PORT || 4100);
const URL = `http://localhost:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-flow-'));

let server;
const sockets = [];

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const once = (sock, event, ms = 5000) => Promise.race([
  new Promise(r => sock.once(event, r)),
  wait(ms).then(() => null)
]);

/** Ждем room_state, удовлетворяющий условию */
const stateWhen = (sock, pred, ms = 4000) => Promise.race([
  new Promise(r => {
    const handler = (d) => { if (pred(d)) { sock.off('room_state', handler); r(d); } };
    sock.on('room_state', handler);
  }),
  wait(ms).then(() => null)
]);

async function connect() {
  const socket = io(URL, { reconnection: false, forceNew: true });
  sockets.push(socket);
  await once(socket, 'connect');
  return socket;
}

test.before(async () => {
  server = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), BG_DATA_DIR: DATA_DIR, BG_ROUNDS: '1', BG_TURN_MS: '30000' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', d => process.stderr.write(`[server] ${d}`));

  // Ждем, пока порт ответит
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${URL}/api/health`);
      if (res.ok) return;
    } catch { /* еще не поднялся */ }
    await wait(250);
  }
  throw new Error('сервер не поднялся');
});

test.after(async () => {
  sockets.forEach(s => s.connected && s.disconnect());
  if (server) server.kill();
  await wait(300);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

test('настройки комнаты применяются и зажимаются по границам', async () => {
  const host = await connect();
  host.emit('create_room', { playerName: 'Хост' });
  const created = await once(host, 'room_created');

  // Сервер поднят с BG_ROUNDS=1, комната наследует настройку процесса
  assert.equal(created.room.settings.rounds, 1, 'комната берет дефолт процесса');

  const applied = stateWhen(host, d => d.settings.rounds === 3);
  host.emit('set_settings', { name: 'Полигон', rounds: 3, turnSec: 25, startMoney: 1500, maxWind: 4 });
  const state = await applied;

  assert.ok(state, 'настройки не применились');
  assert.equal(state.settings.name, 'Полигон');
  assert.equal(state.settings.turnSec, 25);
  assert.equal(state.maxRounds, 3, 'maxRounds пересчитан');

  const clamped = stateWhen(host, d => d.settings.rounds === 15);
  host.emit('set_settings', { rounds: 999, turnSec: 1, startMoney: -500, maxWind: 1000 });
  const limits = await clamped;

  assert.equal(limits.settings.turnSec, 15, 'слишком короткий ход поднят до минимума');
  assert.equal(limits.settings.startMoney, 0);
  assert.equal(limits.settings.maxWind, 25);
});

test('приватная комната скрыта из списка, пароль наружу не отдается', async () => {
  const host = await connect();
  host.emit('create_room', { playerName: 'Скрытный' });
  const created = await once(host, 'room_created');
  host.emit('launch');
  await wait(300);

  let rooms = (await (await fetch(`${URL}/api/rooms`)).json()).rooms;
  assert.ok(rooms.some(r => r.id === created.roomId), 'публичная комната должна быть в списке');

  host.emit('set_settings', { isPublic: false, password: 'ключ' });
  await wait(300);

  rooms = (await (await fetch(`${URL}/api/rooms`)).json()).rooms;
  assert.ok(!rooms.some(r => r.id === created.roomId), 'приватная комната не индексируется');

  host.emit('set_settings', { isPublic: true });
  await wait(300);

  rooms = (await (await fetch(`${URL}/api/rooms`)).json()).rooms;
  const listed = rooms.find(r => r.id === created.roomId);
  assert.equal(listed.hasPassword, true);
  assert.equal(listed.password, undefined, 'пароль не должен уходить клиенту');

  const stranger = await connect();
  stranger.emit('join_room', { roomId: created.roomId, playerName: 'Чужак', password: 'не тот' });
  const denied = await once(stranger, 'join_failed');
  assert.match(denied.reason, /пароль/i);
});

test('место в матче не перехватить по одному playerId', async () => {
  const host = await connect();
  host.emit('create_room', { playerName: 'Владелец' });
  const created = await once(host, 'room_created');

  assert.ok(created.sessionSecret && created.sessionSecret.length >= 32, 'секрет сессии выдан');

  const attacker = await connect();
  attacker.emit('rejoin', { roomId: created.roomId, playerId: created.playerId });
  const stolen = await once(attacker, 'rejoin_result');

  assert.equal(stolen.ok, false);
  assert.equal(stolen.reason, 'forbidden');
});

test('хост выгоняет игрока, и тот не возвращается', async () => {
  const host = await connect();
  host.emit('create_room', { playerName: 'Командир' });
  const created = await once(host, 'room_created');
  host.emit('add_slot', { kind: 'human' });
  await wait(300);

  const guest = await connect();
  guest.emit('join_room', { roomId: created.roomId, playerName: 'Новичок' });
  const joined = await once(guest, 'joined_room');
  assert.ok(joined.playerId);

  const slotIndex = joined.room.slots.findIndex(s => s.player && s.player.id === joined.playerId);
  const kicked = once(guest, 'kicked');
  host.emit('kick_slot', { slotIndex });

  assert.ok(await kicked, 'выгнанный должен получить уведомление');

  const freed = await stateWhen(host, d => !d.slots.some(s => s.player && s.player.name === 'Новичок'));
  assert.ok(freed, 'слот выгнанного освобождается');

  guest.emit('join_room', { roomId: created.roomId, playerName: 'Новичок' });
  const rejected = await once(guest, 'join_failed');
  assert.match(rejected.reason, /удалили/i);
});

test('чат доходит до всех, спам режется, посторонний не пишет', async () => {
  const host = await connect();
  host.emit('create_room', { playerName: 'Радист' });
  const created = await once(host, 'room_created');
  host.emit('add_slot', { kind: 'human' });
  await wait(300);

  const guest = await connect();
  guest.emit('join_room', { roomId: created.roomId, playerName: 'Связист' });
  await once(guest, 'joined_room');

  const received = [];
  guest.on('chat_message', (m) => received.push(m));
  await wait(200);

  host.emit('chat', { text: 'занимай левый фланг' });
  await wait(400);
  assert.ok(received.some(m => m.text === 'занимай левый фланг' && m.name === 'Радист'));

  host.emit('chat', { text: 'строка\nвторая\tтретья' });
  await wait(400);
  const cleaned = received.filter(m => m.name === 'Радист').pop();
  assert.ok(!/[\n\t]/.test(cleaned.text), 'управляющие символы вычищаются');

  const before = received.length;
  for (let i = 0; i < 12; i++) host.emit('chat', { text: `спам ${i}` });
  await wait(800);
  assert.ok(received.length - before <= 5, `антиспам пропустил ${received.length - before} из 12`);

  const outsider = await connect();
  const beforeOutsider = received.length;
  outsider.emit('chat', { text: 'я вас вижу' });
  await wait(400);
  assert.equal(received.length, beforeOutsider, 'посторонний в чужой чат не пишет');
});

test('щит поглощает урон, снаряжение применяется только в свой ход', async () => {
  const host = await connect();
  host.emit('create_room', { playerName: 'Танкист' });
  const created = await once(host, 'room_created');
  const myId = created.playerId;

  host.emit('set_settings', { startMoney: 5000, rounds: 1 });
  await wait(250);
  host.emit('add_slot', { kind: 'bot', difficulty: 'easy' });
  await wait(250);
  host.emit('launch');
  await wait(200);
  host.emit('start_match');

  const round = await once(host, 'round_start', 12000);
  assert.ok(round, 'матч должен стартовать');

  let inventory = {};
  host.on('inventory_update', (d) => { if (d.playerId === myId) inventory = d; });

  const shieldUp = once(host, 'shield_up');
  host.emit('buy_item', { itemId: 'shield' });
  const up = await shieldUp;
  assert.equal(up.shield, 60, 'щит поднимается сразу при покупке');

  host.emit('buy_item', { itemId: 'shield' });
  await wait(400);
  assert.equal(inventory.items.shield, 1, 'второй щит уходит в запас');

  host.emit('buy_item', { itemId: 'parachute' });
  await wait(400);
  assert.equal(inventory.items.parachute, 3, 'парашюты продаются пачкой');

  host.emit('buy_item', { itemId: 'repair_kit' });
  host.emit('buy_weapon', { weaponId: 'nuke' });
  await wait(400);

  // Ждем свой ход: снаряжение вне хода применять нельзя
  let myTurn = false;
  host.on('turn_start', (d) => { myTurn = d.playerId === myId; });
  for (let i = 0; i < 60 && !myTurn; i++) await wait(500);
  assert.ok(myTurn, 'не дождались своего хода');

  const repairError = once(host, 'error', 3000);
  host.emit('use_item', { itemId: 'repair_kit' });
  assert.match((await repairError).message, /броня целая/i);

  // Нюка под ноги: щит обязан принять удар и разрушиться
  const hits = [];
  host.on('shield_hit', (h) => hits.push(h));
  host.emit('fire', { angle: 90, power: 0, weaponId: 'nuke' });
  await wait(5000);

  assert.ok(hits.length > 0, 'щит должен принять удар');
  assert.ok(hits.some(h => h.absorbed > 0));
  assert.ok(hits.some(h => h.broken), 'нюка в упор пробивает щит');
});

test('выход хоста не заканчивает матч, пока живы другие игроки', async () => {
  const host = await connect();
  host.emit('create_room', { playerName: 'Уходящий' });
  const created = await once(host, 'room_created');

  host.emit('set_settings', { rounds: 1, turnSec: 15 });
  await wait(200);
  host.emit('add_slot', { kind: 'human' });
  host.emit('add_slot', { kind: 'human' });
  await wait(300);

  const alice = await connect();
  alice.emit('join_room', { roomId: created.roomId, playerName: 'Алиса' });
  const aliceJoin = await once(alice, 'joined_room');

  const bob = await connect();
  bob.emit('join_room', { roomId: created.roomId, playerName: 'Борис' });
  await once(bob, 'joined_room');

  const bobJoin = await once(bob, 'joined_room', 1000) || {};

  // Оставшиеся стреляют сами: иначе ход висит до таймаута и «идет ли матч»
  // не проверить. Хост не стреляет — он уйдет прямо в свой ход.
  const autoFire = (sock, id) => {
    sock.on('turn_start', (d) => {
      if (d.playerId === id) {
        setTimeout(() => sock.emit('fire', { angle: 90, power: 40, weaponId: 'baby_missile' }), 150);
      }
    });
  };
  autoFire(alice, aliceJoin.playerId);
  autoFire(bob, bobJoin.playerId);

  const turns = [];
  alice.on('turn_start', (d) => turns.push(d.playerId));

  host.emit('launch');
  await wait(200);
  host.emit('start_match');
  assert.ok(await once(alice, 'round_start', 12000), 'матч должен стартовать');

  // Ждем именно ход хоста: уход в свой ход раньше подвешивал матч навсегда,
  // потому что таймер хода привязан к playerId ушедшего
  let hostTurn = false;
  for (let i = 0; i < 60 && !hostTurn; i++) {
    hostTurn = turns[turns.length - 1] === created.playerId;
    if (!hostTurn) await wait(500);
  }
  assert.ok(hostTurn, 'не дождались хода хоста');

  const matchEnded = once(alice, 'match_end', 4000);
  const hostChanged = once(alice, 'host_changed', 4000);
  const turnsBefore = turns.length;

  host.emit('leave_room', {});

  assert.ok(await hostChanged, 'права хоста должны перейти оставшемуся игроку');
  assert.equal(await matchEnded, null, 'матч не должен завершаться после ухода хоста');

  // Ход обязан перейти сразу, не дожидаясь истечения таймера
  for (let i = 0; i < 16 && turns.length <= turnsBefore; i++) await wait(500);

  assert.ok(turns.length > turnsBefore, 'ходы должны продолжаться после ухода хоста');
  assert.ok(!turns.slice(turnsBefore).includes(created.playerId), 'ушедший больше не ходит');
});
