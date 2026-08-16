/**
 * Сервер Burned Ground: Express + Socket.IO + менеджер комнат.
 * Вся игровая логика — в room.js (класс Room), ИИ — в bot.js.
 * Комнаты изолированы: события уходят только в io.to(roomId).
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const { GAME, ROOM } = require('./shared/constants');
const { Room } = require('./room');

// Переопределения для тестов
const CONFIG = {
  rounds: process.env.BG_ROUNDS ? parseInt(process.env.BG_ROUNDS, 10) : GAME.roundsInMatch,
  turnMs: process.env.BG_TURN_MS ? parseInt(process.env.BG_TURN_MS, 10) : GAME.turnTimeLimit,
  reconnectMs: process.env.BG_RECONNECT_MS ? parseInt(process.env.BG_RECONNECT_MS, 10) : GAME.reconnectWindowMs
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

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
  const room = new Room(io, id, { hostSocket, hostName, hostColorIdx, config: CONFIG });
  rooms.set(id, room);
  room.initializeHost(hostSocket, hostName, hostColorIdx);
  hostSocket.emit('room_created', {
    roomId: room.id,
    playerId: hostSocket.playerId,
    room: room.roomState()
  });
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

  socket.on('create_room', ({ playerName, colorIdx } = {}) => {
    if (socket.roomId && getRoom(socket.roomId)) {
      socket.emit('error', { message: 'Вы уже в комнате' });
      return;
    }

    const room = createRoom({ hostSocket: socket, hostName: playerName, hostColorIdx: colorIdx });
    socket.emit('room_created', {
      roomId: room.id,
      playerId: socket.playerId,
      room: room.roomState()
    });
    console.log(`Комната создана: ${room.id} (хост: ${playerName})`);
  });

  socket.on('join_room', ({ roomId, playerName, colorIdx, asSpectator } = {}) => {
    if (socket.roomId && getRoom(socket.roomId)) {
      socket.emit('error', { message: 'Вы уже в комнате' });
      return;
    }

    const room = getRoom(roomId);
    if (!room) {
      socket.emit('join_failed', { reason: 'Комната не найдена' });
      return;
    }

    room.join(socket, { playerName, colorIdx, asSpectator });
    console.log(`Комната ${room.id}: вход ${playerName}${asSpectator ? ' (зритель)' : ''}`);
  });

  socket.on('rejoin', ({ roomId, playerId } = {}) => {
    const room = getRoom(roomId);
    if (!room || !room.players[playerId]) {
      socket.emit('rejoin_result', { ok: false, reason: 'not_found' });
      return;
    }
    room.rebind(socket, playerId);
    console.log(`Комната ${room.id}: реконнект ${room.players[playerId].name}`);
  });

  // Дальше — только события внутри комнаты
  const inRoom = (fn) => (...args) => {
    const room = getRoom(socket.roomId);
    if (room && !room.destroyed) fn(room, ...args);
  };

  socket.on('claim_slot', inRoom((room, d) => room.claimSlot(socket, d || {})));
  socket.on('leave_room', inRoom((room) => {
    socket.leave(room.id);
    socket.roomId = null;
    socket.playerId = null;
    room.emitRoomState();
  }));
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

// Статистика комнат для мониторинга
app.get('/api/rooms', (req, res) => {
  res.json({
    rooms: Array.from(rooms.values()).map(r => ({
      id: r.id, phase: r.phase,
      players: r.playerOrderIds().length,
      spectators: Object.keys(r.spectators).length
    }))
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  console.log(`Откройте http://localhost:${PORT} в браузере`);
  console.log(`Раундов: ${CONFIG.rounds}, ход: ${CONFIG.turnMs / 1000}c, реконнект: ${CONFIG.reconnectMs / 1000}c`);
});
