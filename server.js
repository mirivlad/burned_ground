/**
 * Сервер Burned Ground: Express + Socket.IO + менеджер комнат.
 * Вся игровая логика — в room.js (класс Room), ИИ — в bot.js.
 * Комнаты изолированы: события уходят только в io.to(roomId).
 *
 * Burned Ground — сетевая артиллерийская игра, вдохновленная
 * Scorched Earth (DOS, 1991). Проект независимый и с правообладателем
 * оригинала не связан.
 *
 * Copyright (C) 2026 mirivlad
 *
 * Эта программа — свободное ПО: вы можете распространять и изменять ее
 * на условиях GNU Affero General Public License версии 3, опубликованной
 * Free Software Foundation.
 *
 * Программа распространяется в надежде, что будет полезной, но БЕЗ
 * ВСЯКИХ ГАРАНТИЙ, включая подразумеваемые гарантии КОММЕРЧЕСКОЙ
 * ПРИГОДНОСТИ и ПРИГОДНОСТИ ДЛЯ ОПРЕДЕЛЕННОЙ ЦЕЛИ. Подробности — в тексте
 * лицензии в файле LICENSE, а также на <https://www.gnu.org/licenses/>.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { GAME, ROOM } = require('./shared/constants');
const { Room } = require('./room');
const auth = require('./db');

// Переопределения для тестов
const CONFIG = {
  rounds: process.env.BG_ROUNDS ? parseInt(process.env.BG_ROUNDS, 10) : GAME.roundsInMatch,
  turnMs: process.env.BG_TURN_MS ? parseInt(process.env.BG_TURN_MS, 10) : GAME.turnTimeLimit,
  reconnectMs: process.env.BG_RECONNECT_MS ? parseInt(process.env.BG_RECONNECT_MS, 10) : GAME.reconnectWindowMs
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// За реверс-прокси (Nginx) включите BG_TRUST_PROXY=1, иначе все клиенты
// придут с адресом прокси и лимит попыток входа станет общим на всех
app.set('trust proxy', process.env.BG_TRUST_PROXY === '1');

app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

// ============================================
// АВТОРИЗАЦИЯ И СТАТИСТИКА
// ============================================

function tokenFromReq(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

/**
 * Лимит попыток на вход/регистрацию: скользящее окно в памяти процесса.
 * Ключ — IP + логин, чтобы перебор одного аккаунта с разных адресов
 * и перебор разных аккаунтов с одного адреса ловились одинаково.
 */
const RATE = { windowMs: 15 * 60 * 1000, maxAttempts: 10 };
const attempts = new Map();   // key -> { count, resetAt }

function rateLimit(req, res, action) {
  const key = `${action}:${req.ip}:${String(req.body?.username || '').toLowerCase()}`;
  const now = Date.now();
  const entry = attempts.get(key);

  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + RATE.windowMs });
    return false;
  }

  entry.count++;
  if (entry.count > RATE.maxAttempts) {
    const waitMin = Math.ceil((entry.resetAt - now) / 60000);
    res.status(429).json({ error: `Слишком много попыток. Повторите через ${waitMin} мин.` });
    return true;
  }
  return false;
}

// Успешный вход снимает счетчик, чтобы не наказывать за опечатки
function rateLimitReset(req, action) {
  attempts.delete(`${action}:${req.ip}:${String(req.body?.username || '').toLowerCase()}`);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (now > entry.resetAt) attempts.delete(key);
  }
}, 10 * 60 * 1000).unref();

// Протухшие токены чистятся раз в сутки
setInterval(() => auth.purgeExpiredTokens(), 24 * 60 * 60 * 1000).unref();

app.post('/api/auth/register', (req, res) => {
  if (rateLimit(req, res, 'register')) return;

  const result = auth.registerUser(req.body?.username, req.body?.password);
  if (result.error) return res.status(400).json({ error: result.error });

  rateLimitReset(req, 'register');
  res.json({ token: result.token, user: result.user });
});

app.post('/api/auth/login', (req, res) => {
  if (rateLimit(req, res, 'login')) return;

  const result = auth.loginUser(req.body?.username, req.body?.password);
  if (result.error) return res.status(401).json({ error: result.error });

  rateLimitReset(req, 'login');
  res.json({ token: result.token, user: result.user });
});

app.post('/api/auth/logout', (req, res) => {
  // Токен отзывается на сервере: очистки localStorage недостаточно
  auth.revokeToken(tokenFromReq(req));
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = auth.userByToken(tokenFromReq(req));
  if (!user) return res.status(401).json({ error: 'Не авторизован' });
  res.json({
    user,
    stats: auth.userStats(user.id),
    matches: auth.userMatches(user.id, 10)
  });
});

app.get('/api/stats/:username', (req, res) => {
  const stats = auth.userStatsByName(req.params.username);
  if (!stats) return res.status(404).json({ error: 'Игрок не найден' });
  res.json(stats);
});

app.get('/api/profile/:username', (req, res) => {
  const profile = auth.userProfile(req.params.username);
  if (!profile) return res.status(404).json({ error: 'Игрок не найден' });
  res.json(profile);
});

app.get('/api/leaderboard', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  res.json({ leaders: auth.leaderboard(limit) });
});

// ============================================
// МЕНЕДЖЕР КОМНАТ
// ============================================

const rooms = new Map();   // roomId -> Room

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих символов (I,1,O,0)

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < ROOM.codeLength; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function createRoom({ hostSocket, hostName, hostColorIdx }) {
  const id = generateRoomCode();
  const room = new Room(io, id, {
    hostSocket, hostName, hostColorIdx, config: CONFIG,
    onMatchEnd: (roomId, rounds, scores) => auth.recordMatch(roomId, rounds, scores)
  });
  rooms.set(id, room);
  room.initializeHost(hostSocket, hostName, hostColorIdx);
  scheduleSweep();
  return room;
}

function getRoom(id) {
  return rooms.get(String(id || '').toUpperCase());
}

// Уборка пустых/мертвых комнат
let sweepTimer = null;
function scheduleSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    for (const [id, room] of rooms) {
      const hasConnectedHuman = room.playerOrderIds().some(pid => {
        const p = room.players[pid];
        return p && !p.isBot && p.connected;
      });
      const hasSpectators = Object.keys(room.spectators).length > 0;

      // Комната без людей и зрителей умирает по истечении окна реконнекта
      // (боты сами по себе комнату не удерживают)
      const abandoned = !hasConnectedHuman && !hasSpectators &&
        Date.now() - room.lastHumanActivity > room.config.reconnectMs;

      if (room.destroyed || abandoned) {
        room.destroy();
        rooms.delete(id);
        console.log(`Комната ${id} удалена`);
      }
    }
    if (rooms.size === 0) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }, 30000);
}

// ============================================
// МАРШРУТИЗАЦИЯ СОКЕТОВ
// ============================================

io.on('connection', (socket) => {
  console.log('Подключение:', socket.id);

  // Аккаунт по токену из handshake (io({ auth: { token } }) на клиенте)
  const account = auth.userByToken(socket.handshake?.auth?.token);
  socket.userId = account ? account.id : null;
  socket.username = account ? account.username : null;

  socket.on('create_room', ({ playerName, colorIdx } = {}) => {
    if (socket.roomId && getRoom(socket.roomId)) {
      socket.emit('error', { message: 'Вы уже в комнате' });
      return;
    }

    const room = createRoom({ hostSocket: socket, hostName: playerName, hostColorIdx: colorIdx });
    const host = room.players[socket.playerId];

    socket.emit('room_created', {
      roomId: room.id,
      playerId: socket.playerId,
      sessionSecret: host ? host.sessionSecret : null,
      room: room.roomState()
    });
    console.log(`Комната создана: ${room.id} (хост: ${host ? host.name : playerName})`);
  });

  socket.on('join_room', ({ roomId, playerName, colorIdx, asSpectator, password } = {}) => {
    if (socket.roomId && getRoom(socket.roomId)) {
      socket.emit('error', { message: 'Вы уже в комнате' });
      return;
    }

    const room = getRoom(roomId);
    if (!room || room.destroyed) {
      socket.emit('join_failed', { reason: 'Комната не найдена' });
      return;
    }

    const result = room.join(socket, { playerName, colorIdx, asSpectator, password });
    if (result && result.error) return;

    console.log(`Комната ${room.id}: вход ${playerName}${asSpectator ? ' (зритель)' : ''}`);
  });

  socket.on('rejoin', ({ roomId, playerId, sessionSecret } = {}) => {
    const room = getRoom(roomId);
    if (!room || !room.players[playerId]) {
      socket.emit('rejoin_result', { ok: false, reason: 'not_found' });
      return;
    }

    if (!room.rebind(socket, playerId, sessionSecret)) {
      socket.emit('rejoin_result', { ok: false, reason: 'forbidden' });
      console.warn(`Комната ${room.id}: отклонен реконнект на ${playerId} (сокет ${socket.id})`);
      return;
    }

    console.log(`Комната ${room.id}: реконнект ${room.players[playerId].name}`);
  });

  // Дальше — только события внутри комнаты
  const inRoom = (fn) => (...args) => {
    const room = getRoom(socket.roomId);
    if (room && !room.destroyed) fn(room, ...args);
  };

  socket.on('claim_slot', inRoom((room, d) => room.claimSlot(socket, d || {})));
  socket.on('leave_room', inRoom((room) => {
    // Участника удаляем сразу: слот освобождается, комната может быть подметена.
    // Без этого игрок остается в room.players с connected=true навсегда.
    if (socket.playerId) room.removeParticipant(socket.playerId);
    else delete room.spectators[socket.id];

    socket.leave(room.id);
    socket.roomId = null;
    socket.playerId = null;
    room.emitRoomState();
  }));
  socket.on('chat', inRoom((room, d) => room.chat(socket, d || {})));
  socket.on('set_settings', inRoom((room, d) => room.setSettings(socket, d || {})));
  socket.on('kick_slot', inRoom((room, d) => room.kickSlot(socket, d || {})));
  socket.on('add_slot', inRoom((room, d) => room.addSlot(socket, d || {})));
  socket.on('remove_slot', inRoom((room, d) => room.removeSlot(socket, d || {})));
  socket.on('set_slot', inRoom((room, d) => room.setSlot(socket, d || {})));
  socket.on('set_slot_color', inRoom((room, d) => room.setSlotColor(socket, d || {})));
  socket.on('launch', inRoom((room) => room.launch(socket)));
  socket.on('start_match', inRoom((room) => room.startMatch(socket)));

  socket.on('buy_weapon', inRoom((room, { weaponId } = {}) => {
    if (socket.playerId) room.buyWeapon(socket.playerId, weaponId);
  }));

  socket.on('select_weapon', inRoom((room, { weaponId } = {}) => {
    if (socket.playerId) room.selectWeapon(socket.playerId, weaponId);
  }));

  socket.on('buy_item', inRoom((room, { itemId } = {}) => {
    if (socket.playerId) room.buyItem(socket.playerId, itemId);
  }));

  socket.on('use_item', inRoom((room, { itemId } = {}) => {
    if (socket.playerId) room.useItem(socket.playerId, itemId);
  }));

  socket.on('fire', inRoom((room, data = {}) => {
    const playerId = socket.playerId;
    if (!playerId || !room.players[playerId]) return;

    if (room.phase !== 'playing' || room.turnPhase !== 'aiming') return;
    if (room.playerOrderIds()[room.currentPlayerIndex] !== playerId) {
      socket.emit('error', { message: 'Не ваш ход' });
      return;
    }

    room.handleFire(playerId, data);
  }));

  socket.on('disconnect', () => {
    console.log('Отключение:', socket.id);
    const room = getRoom(socket.roomId);
    if (room && !room.destroyed) {
      room.handleDisconnect(socket);
    }
    socket.roomId = null;
    socket.playerId = null;
  });
});

/**
 * Список открытых комнат для лобби: только публичные и только те,
 * куда есть смысл заходить. Приватные комнаты в выдачу не попадают —
 * в них заходят по коду или ссылке.
 */
app.get('/api/rooms', (req, res) => {
  const list = Array.from(rooms.values())
    .filter(r => !r.destroyed && r.settings.isPublic && r.phase !== 'setup')
    .map(r => r.listingInfo())
    .sort((a, b) => (b.freeHumanSlots - a.freeHumanSlots) || (b.players - a.players));

  res.json({ rooms: list });
});

// Техническая сводка для мониторинга (включая приватные комнаты)
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    rooms: rooms.size,
    sockets: io.engine.clientsCount
  });
});

// Одна упавшая комната не должна уносить сервер вместе со всеми матчами:
// таймеры (ходы ботов, отложенные попадания) исполняются вне try/catch вызывающего.
process.on('uncaughtException', (err) => {
  console.error('Необработанное исключение:', err);
});
process.on('unhandledRejection', (err) => {
  console.error('Необработанный reject:', err);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Откройте http://localhost:${PORT} в браузере`);
  console.log(`Раундов: ${CONFIG.rounds}, ход: ${CONFIG.turnMs / 1000}c, реконнект: ${CONFIG.reconnectMs / 1000}c`);
});

/**
 * Корректное завершение: docker stop шлет SIGTERM и ждет 10 секунд.
 * Игрокам сообщаем, комнаты гасим (иначе останутся висеть таймеры),
 * базу закрываем — WAL должен быть сброшен на диск.
 */
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Получен ${signal}, останавливаемся...`);

  io.emit('server_shutdown', { message: 'Сервер перезапускается' });

  for (const [id, room] of rooms) {
    room.destroy();
    rooms.delete(id);
  }
  if (sweepTimer) clearInterval(sweepTimer);

  io.close(() => {
    server.close(() => {
      try {
        auth.db.close();
      } catch (e) {
        console.error('Ошибка закрытия базы:', e.message);
      }
      console.log('Остановлено штатно');
      process.exit(0);
    });
  });

  // Страховка: если сокеты не закрылись, не висим до SIGKILL
  setTimeout(() => {
    console.warn('Штатное завершение затянулось, выходим принудительно');
    process.exit(0);
  }, 8000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
