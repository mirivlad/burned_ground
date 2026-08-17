/**
 * Комната: лобби + матч, полностью изолированное состояние.
 * Сервер держит десятки комнат; события рассылаются в io.to(roomId).
 */

const crypto = require('crypto');

const {
  MAP_WIDTH, PHYSICS, GAME, ECONOMY, ROOM, PALETTE
} = require('./shared/constants');
const { getWeapon, BASE_WEAPON_ID } = require('./shared/weapons');
const {
  generateTerrain, applyExplosion, applyDirtBall, crumbleTerrain, findSpawnPositions,
  rollPath, napalmFlows
} = require('./shared/terrain');
const {
  calculateProjectileTrajectory,
  calculateExplosionDamage,
  calculateFallDamage,
  updateTankPhysics,
  simulateMirv
} = require('./shared/physics');
const { decideShot, thinkDelay, botName } = require('./bot');

let nextBotIndex = 0;

class Room {
  /**
   * @param {Server} io
   * @param {string} id
   * @param {object} opts - { hostSocket, hostName, hostColorIdx, config }
   */
  constructor(io, id, { hostSocket, hostName, hostColorIdx, config, onMatchEnd }) {
    this.io = io;
    this.id = id;
    this.config = config;              // { rounds, turnMs, reconnectMs }
    this.onMatchEnd = onMatchEnd || null;
    this.createdAt = Date.now();
    this.destroyed = false;

    this.phase = 'setup';              // setup | awaiting | playing | interRound | matchEnd
    this.hostId = null;                // participant id хоста
    this.lastHumanActivity = Date.now(); // для уборки комнат без людей

    this.slots = [];                   // { kind:'human'|'bot', difficulty, colorIdx, playerId|null }
    this.players = {};                 // participantId -> player (люди + боты)
    this.spectators = {};              // socketId -> { name }

    // Состояние матча
    this.round = 0;
    this.terrain = null;
    this.terrainSeed = 0;
    this.tanks = [];
    this.wind = 0;
    this.turnPhase = 'idle';           // aiming | resolving | idle
    this.lastShooterId = null;         // автор текущего выстрела (для урона от падений)
    this.currentPlayerIndex = 0;
    this.turnStartTime = 0;
    this.timers = { turn: null, resolve: null, round: null, match: null, bot: null };
  }

  // ============================================
  // РАССЫЛКА
  // ============================================

  emit(event, data) {
    this.io.to(this.id).emit(event, data);
  }

  freeColorIdx() {
    const used = new Set(this.slots.map(s => s.colorIdx));
    for (let i = 0; i < PALETTE.length; i++) {
      if (!used.has(i)) return i;
    }
    return null;
  }

  randomFreeColorIdx() {
    const used = new Set(this.slots.map(s => s.colorIdx));
    const free = [];
    for (let i = 0; i < PALETTE.length; i++) {
      if (!used.has(i)) free.push(i);
    }
    return free.length ? free[Math.floor(Math.random() * free.length)] : null;
  }

  colorTaken(colorIdx) {
    return this.slots.some(s => s.colorIdx === colorIdx);
  }

  // ============================================
  // СОСТОЯНИЕ ДЛЯ КЛИЕНТА
  // ============================================

  roomState() {
    return {
      roomId: this.id,
      phase: this.phase,
      hostId: this.hostId,
      round: this.round,
      maxRounds: this.config.rounds,
      slots: this.slots.map(s => ({
        kind: s.kind,
        difficulty: s.difficulty || null,
        colorIdx: s.colorIdx,
        color: PALETTE[s.colorIdx]?.css || '#ffffff',
        player: s.playerId ? this.playerPublic(this.players[s.playerId]) : null
      })),
      spectators: Object.entries(this.spectators).map(([sid, s]) => ({ id: sid, name: s.name })),
      shareUrl: `/index.html?room=${this.id}` // клиент достроит полный URL
    };
  }

  playerPublic(p) {
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      colorIdx: p.colorIdx,
      isBot: !!p.isBot,
      isGuest: !!p.isGuest,
      difficulty: p.difficulty || null,
      hp: p.hp,
      money: p.money,
      isAlive: p.isAlive,
      connected: p.connected,
      kills: p.kills
    };
  }

  playersSnapshot() {
    return this.playerOrderIds().map(pid => this.playerPublic(this.players[pid]));
  }

  emitRoomState() {
    this.emit('room_state', this.roomState());
  }

  emitPlayers() {
    this.emit('players_update', { players: this.playersSnapshot() });
  }

  // ============================================
  // УЧАСТНИКИ
  // ============================================

  playerOrderIds() {
    return this.slots.filter(s => s.playerId).map(s => s.playerId);
  }

  aliveIds() {
    return this.playerOrderIds().filter(pid => this.players[pid].isAlive);
  }

  /**
   * Участник-человек. Имя авторизованного игрока берется из аккаунта:
   * подделать чужой позывной в лобби нельзя. Гость играет под введенным
   * именем и помечается как гость.
   */
  createHuman(socket, name, colorIdx) {
    const account = socket.userId ? { id: socket.userId, username: socket.username } : null;
    const displayName = account
      ? account.username
      : (String(name || '').trim().slice(0, 20) || 'Игрок');

    return {
      id: 'p' + crypto.randomUUID(),
      // playerId виден всем в room_state, поэтому возврат в бой подтверждается
      // отдельным секретом, который знает только владелец места
      sessionSecret: crypto.randomBytes(24).toString('hex'),
      name: displayName,
      colorIdx,
      userId: account ? account.id : null,
      isGuest: !account,
      isBot: false,
      socketId: null,
      hp: 100,
      money: GAME.startingMoney,
      inventory: { [BASE_WEAPON_ID]: Infinity },
      activeWeaponId: BASE_WEAPON_ID,
      angle: 90,
      power: 70,
      isAlive: true,
      connected: true,
      kills: 0,
      roundEarned: 0,
      totalEarned: 0,
      disconnectTimer: null
    };
  }

  createBot(difficulty, colorIdx) {
    return {
      id: 'b' + Math.random().toString(36).substr(2, 9),
      name: botName(difficulty, nextBotIndex++),
      colorIdx,
      isBot: true,
      difficulty,
      hp: 100,
      money: GAME.startingMoney,
      inventory: { [BASE_WEAPON_ID]: Infinity },
      activeWeaponId: BASE_WEAPON_ID,
      angle: 90,
      power: 70,
      isAlive: true,
      connected: true,
      kills: 0,
      roundEarned: 0,
      totalEarned: 0
    };
  }

  // ============================================
  // ПОДКЛЮЧЕНИЕ / ВЫХОД
  // ============================================

  /**
   * Хост создает комнату: первый слот (человек) занимает хост.
   */
  initializeHost(hostSocket, hostName, colorIdx) {
    const color = colorIdx !== undefined && !this.colorTaken(colorIdx) ? colorIdx : this.freeColorIdx();
    const host = this.createHuman(hostSocket, hostName || 'Хост', color);
    host.socketId = hostSocket.id;
    this.players[host.id] = host;
    this.hostId = host.id;

    this.slots.push({ kind: 'human', colorIdx: color, playerId: host.id, difficulty: null });

    hostSocket.playerId = host.id;
    hostSocket.roomId = this.id;
    hostSocket.join(this.id);
    this.lastHumanActivity = Date.now();

    this.emitRoomState();
    return { playerId: host.id, sessionSecret: host.sessionSecret };
  }

  /**
   * Вход в комнату: участником (займет свободный слот человека) или зрителем.
   */
  join(socket, { playerName, colorIdx, asSpectator }) {
    socket.join(this.id);
    socket.roomId = this.id;

    const name = String(playerName || '').trim().slice(0, 20) || `Игрок`;

    if (!asSpectator) {
      const freeSlot = this.slots.find(s => s.kind === 'human' && !s.playerId);
      if (freeSlot) {
        return this.claimSlot(socket, { slotIndex: this.slots.indexOf(freeSlot), colorIdx, name });
      }
    }

    // Зрителем
    this.spectators[socket.id] = { name };
    this.lastHumanActivity = Date.now();
    socket.emit('joined_room', {
      roomId: this.id,
      spectator: true,
      room: this.roomState()
    });

    if (this.phase === 'playing' || this.phase === 'interRound') {
      socket.emit('game_snapshot', this.gameSnapshot());
    }

    this.emitRoomState();
    return { spectator: true };
  }

  /**
   * Занять свободный слот человека (из лобби или из зрителей, в т.ч. между раундами).
   */
  claimSlot(socket, { slotIndex, colorIdx, name }) {
    const slot = this.slots[slotIndex];
    if (!slot || slot.kind !== 'human' || slot.playerId) {
      socket.emit('error', { message: 'Слот занят или недоступен' });
      return { error: true };
    }

    // Цвет: выбранный свободный или автоподбор
    let color = null;
    if (colorIdx !== undefined && !this.colorTaken(colorIdx)) color = colorIdx;
    if (color === null && slot.colorIdx !== null && !this.players[slot.playerId]) {
      // цвет слота свободен, оставляем цвет слота
      color = slot.colorIdx;
    }
    if (color === null) color = this.freeColorIdx();
    slot.colorIdx = color;

    const player = this.createHuman(socket, name, color);
    player.socketId = socket.id;
    this.players[player.id] = player;
    slot.playerId = player.id;

    socket.playerId = player.id;
    socket.roomId = this.id;
    delete this.spectators[socket.id];
    this.lastHumanActivity = Date.now();

    socket.emit('joined_room', {
      roomId: this.id,
      playerId: player.id,
      sessionSecret: player.sessionSecret,
      colorIdx: color,
      room: this.roomState()
    });

    // Матч идет: игрок вступит со следующего раунда
    if (this.phase === 'playing' || this.phase === 'interRound') {
      socket.emit('game_snapshot', this.gameSnapshot());
      socket.emit('error', { message: 'Вы вступите в бой со следующего раунда' });
    }

    this.emitRoomState();
    return { playerId: player.id };
  }

  /**
   * Реконнект участника. Одного playerId мало: он виден всем в room_state,
   * поэтому нужен либо секрет сессии, либо тот же аккаунт (заход с другого
   * устройства под своим логином).
   */
  rebind(socket, playerId, secret) {
    const p = this.players[playerId];
    if (!p || p.isBot) return false;

    const bySecret = !!p.sessionSecret && typeof secret === 'string' &&
      secret.length === p.sessionSecret.length &&
      crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(p.sessionSecret));
    const byAccount = !!socket.userId && !!p.userId && socket.userId === p.userId;

    if (!bySecret && !byAccount) return false;

    // Перехват управления, если зашли с нового сокета
    if (p.socketId && p.socketId !== socket.id) {
      const old = this.io.sockets.sockets.get(p.socketId);
      if (old) {
        old.playerId = null;
        old.emit('error', { message: 'Ваше место занято новым подключением' });
      }
    }

    p.connected = true;
    p.socketId = socket.id;
    socket.playerId = playerId;
    socket.roomId = this.id;
    socket.join(this.id);
    delete this.spectators[socket.id];
    this.lastHumanActivity = Date.now();

    if (p.disconnectTimer) {
      clearTimeout(p.disconnectTimer);
      p.disconnectTimer = null;
    }

    socket.emit('rejoin_result', {
      ok: true,
      roomId: this.id,
      playerId,
      sessionSecret: p.sessionSecret,
      room: this.roomState(),
      snapshot: this.gameSnapshot(),
      inventory: p.inventory,
      activeWeaponId: p.activeWeaponId,
      angle: p.angle,
      power: p.power
    });

    this.emitPlayers();
    this.emitRoomState();
    return true;
  }

  handleDisconnect(socket) {
    // Зритель уходит тихо
    if (this.spectators[socket.id]) {
      delete this.spectators[socket.id];
      this.emitRoomState();
      this.checkEmpty();
      return;
    }

    const playerId = socket.playerId;
    if (!playerId || !this.players[playerId]) return;
    const p = this.players[playerId];
    if (p.socketId !== socket.id) return;

    p.socketId = null;
    p.connected = false;

    // Вне матча (setup/awaiting/matchEnd) участник удаляется сразу
    if (this.phase === 'setup' || this.phase === 'awaiting' || this.phase === 'matchEnd') {
      this.removeParticipant(playerId);
      return;
    }

    this.emit('player_disconnected', {
      playerId, name: p.name, reconnectWindowMs: this.config.reconnectMs
    });
    this.emitPlayers();
    this.emitRoomState();

    // Ход был его — переходим к следующему
    if (this.phase === 'playing' &&
        this.playerOrderIds()[this.currentPlayerIndex] === playerId &&
        this.turnPhase === 'aiming') {
      this.endTurn();
    }

    p.disconnectTimer = setTimeout(() => {
      this.removeParticipant(playerId);
    }, this.config.reconnectMs);
  }

  removeParticipant(playerId) {
    const p = this.players[playerId];
    if (!p) return;

    if (p.disconnectTimer) clearTimeout(p.disconnectTimer);

    const slot = this.slots.find(s => s.playerId === playerId);
    if (slot) slot.playerId = null;      // слот освобождается (человек или бот)
    if (p.isBot && slot) {
      // Бот удален (хост снял слот между раундами) — слот станет пустым/человеческим
    }

    delete this.players[playerId];

    const ti = this.tanks.findIndex(t => t.playerId === playerId);
    if (ti !== -1) this.tanks.splice(ti, 1);

    // Хост ушел: передаем права
    if (this.hostId === playerId) {
      const nextHuman = this.playerOrderIds().find(pid => this.players[pid] && !this.players[pid].isBot);
      this.hostId = nextHuman || null;
      if (this.hostId) this.emit('host_changed', { hostId: this.hostId });
    }

    if (this.playerOrderIds().length === 0) {
      this.emit('tank_update', { tanks: this.tanks });
      this.emitPlayers();
      this.emitRoomState();
      this.checkEmpty();
      return;
    }

    this.emit('tank_update', { tanks: this.tanks });
    this.emitPlayers();
    this.emitRoomState();

    if (this.phase === 'playing' || this.phase === 'interRound') {
      const alive = this.aliveIds();
      if (alive.length <= 1) {
        this.endRound(alive[0] || null);
      }
    }
  }

  checkEmpty() {
    if (this.playerOrderIds().length === 0 && Object.keys(this.spectators).length === 0) {
      this.destroy();
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clearTimers();
    Object.values(this.players).forEach(p => p.disconnectTimer && clearTimeout(p.disconnectTimer));
    // socket.io 4.x: у BroadcastOperator метод называется disconnectSockets,
    // прежний disconnect() бросал TypeError при каждом закрытии комнаты
    this.io.in(this.id).disconnectSockets(true);
  }

  // ============================================
  // СЛОТЫ (хост)
  // ============================================

  isHost(socket) {
    return socket.playerId && socket.playerId === this.hostId;
  }

  addSlot(socket, { kind, difficulty }) {
    if (!this.isHost(socket)) return;
    if (this.phase !== 'setup' && this.phase !== 'awaiting' && this.phase !== 'matchEnd') return;
    if (this.slots.length >= ROOM.maxSlots) {
      socket.emit('error', { message: `Максимум ${ROOM.maxSlots} слотов` });
      return;
    }

    const colorIdx = this.randomFreeColorIdx();
    if (colorIdx === null) {
      socket.emit('error', { message: 'Свободные цвета закончились' });
      return;
    }

    this.slots.push({
      kind: kind === 'bot' ? 'bot' : 'human',
      difficulty: kind === 'bot' ? (difficulty || 'easy') : null,
      colorIdx,
      playerId: null
    });

    this.emitRoomState();
  }

  removeSlot(socket, { slotIndex }) {
    if (!this.isHost(socket)) return;
    if (this.phase !== 'setup' && this.phase !== 'awaiting' && this.phase !== 'matchEnd') return;

    const slot = this.slots[slotIndex];
    if (!slot) return;

    // Нельзя убирать участника (требование: хост не может убирать игроков)
    if (slot.playerId) {
      socket.emit('error', { message: 'Нельзя убрать занятый слот' });
      return;
    }

    this.slots.splice(slotIndex, 1);
    this.emitRoomState();
  }

  /**
   * Смена типа слота. До матча — свободно; в матче — только слоты ботов.
   */
  setSlot(socket, { slotIndex, kind, difficulty }) {
    if (!this.isHost(socket)) return;

    const slot = this.slots[slotIndex];
    if (!slot) return;

    const inMatch = this.phase === 'playing' || this.phase === 'interRound';
    if (inMatch && slot.kind !== 'bot') {
      socket.emit('error', { message: 'Во время матча можно менять только слоты ботов' });
      return;
    }
    if (inMatch && slot.playerId) {
      // Бот занимает слот: разрешаем заменить бота на человека (бот уйдет с этого раунда)
      // или сменить сложность бота
    }

    if (kind === 'bot') {
      slot.kind = 'bot';
      slot.difficulty = difficulty || slot.difficulty || 'easy';
    } else if (kind === 'human') {
      if (slot.playerId && this.players[slot.playerId]?.isBot) {
        // Бота снимаем, слот открывается человеку
        this.removeParticipant(slot.playerId);
      }
      slot.kind = 'human';
      slot.difficulty = null;
    }

    this.emitRoomState();
  }

  setSlotColor(socket, { slotIndex, colorIdx }) {
    if (!this.isHost(socket)) return;
    if (this.phase === 'playing' || this.phase === 'interRound') return;

    const slot = this.slots[slotIndex];
    if (!slot || colorIdx === undefined || colorIdx < 0 || colorIdx >= PALETTE.length) return;
    if (this.colorTaken(colorIdx)) {
      socket.emit('error', { message: 'Цвет занят' });
      return;
    }

    slot.colorIdx = colorIdx;
    const p = slot.playerId ? this.players[slot.playerId] : null;
    if (p) p.colorIdx = colorIdx;
    this.emitRoomState();
  }

  // ============================================
  // ФАЗЫ КОМНАТЫ
  // ============================================

  /**
   * «Запуск»: комната открыта, ссылка активна, игроки могут занимать слоты.
   */
  launch(socket) {
    if (!this.isHost(socket)) return;
    if (this.phase !== 'setup') return;

    this.phase = 'awaiting';
    this.emit('room_launched', { roomId: this.id });
    this.emitRoomState();
  }

  startMatch(socket) {
    if (!this.isHost(socket)) return;
    if (this.phase !== 'awaiting') return;
    this.beginMatch();
  }

  beginMatch() {
    // Спавн ботов по слотам
    for (const slot of this.slots) {
      if (slot.kind === 'bot' && !slot.playerId) {
        const bot = this.createBot(slot.difficulty || 'easy', slot.colorIdx);
        this.players[bot.id] = bot;
        slot.playerId = bot.id;
      }
    }

    const participants = this.playerOrderIds();
    if (participants.length < GAME.minPlayers) {
      this.emit('error', { message: `Нужно минимум ${GAME.minPlayers} участника (боты считаются)` });
      return;
    }

    this.phase = 'playing';
    this.round = 0;

    for (const pid of participants) {
      const p = this.players[pid];
      p.money = GAME.startingMoney;
      p.inventory = { [BASE_WEAPON_ID]: Infinity };
      p.activeWeaponId = BASE_WEAPON_ID;
      p.kills = 0;
      p.totalEarned = 0;
      p.roundEarned = 0;
      p.roundWins = 0;
      p.hp = 100;
      p.isAlive = true;
    }

    this.clearTimers();
    this.emit('match_start', { players: this.playersSnapshot(), rounds: this.config.rounds });
    this.emitRoomState();

    setTimeout(() => {
      if (this.phase === 'playing' && !this.destroyed) this.startNewRound();
    }, 2000);
  }

  // ============================================
  // РАУНДЫ И ХОДЫ
  // ============================================

  startNewRound() {
    this.round++;
    this.terrainSeed = Math.floor(Math.random() * 1000000);
    this.terrain = generateTerrain(this.terrainSeed);
    this.wind = Math.round((Math.random() - 0.5) * 2 * GAME.maxWind * 10) / 10;

    for (const pid of this.playerOrderIds()) {
      const p = this.players[pid];
      p.hp = 100;
      p.isAlive = true;
      p.roundEarned = 0;
    }

    const ids = this.playerOrderIds();
    const spawnPositions = findSpawnPositions(this.terrain, ids.length);

    this.tanks = ids.map((pid, index) => {
      const p = this.players[pid];
      const x = spawnPositions[index];
      const y = this.terrain[x];
      p.x = x;
      p.y = y;
      return { playerId: pid, x, y, velocityY: 0 };
    });

    this.emit('round_start', {
      round: this.round,
      maxRounds: this.config.rounds,
      terrainSeed: this.terrainSeed,
      heights: this.terrain,
      tanks: this.tanks,
      wind: this.wind,
      players: this.playersSnapshot(),
      serverTime: Date.now()
    });

    this.currentPlayerIndex = this.round % ids.length;
    this.startTurn();
  }

  ableToPlay(p) {
    return p && p.isAlive && (p.isBot || p.connected);
  }

  startTurn() {
    if (this.phase !== 'playing' || this.destroyed) return;

    const order = this.playerOrderIds();
    if (order.length === 0) return;

    const alive = this.aliveIds();
    if (alive.length <= 1) {
      this.endRound(alive[0] || null);
      return;
    }

    let loops = 0;
    while (!this.ableToPlay(this.players[order[this.currentPlayerIndex]]) && loops < order.length) {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % order.length;
      loops++;
    }

    const current = this.players[order[this.currentPlayerIndex]];
    if (!this.ableToPlay(current)) {
      // Все живые отключились: ждем реконнект
      this.setTimer('turn', () => {
        if (this.phase === 'playing' && !this.destroyed) this.startTurn();
      }, 5000);
      return;
    }

    this.turnPhase = 'aiming';
    this.turnStartTime = Date.now();
    const playerId = order[this.currentPlayerIndex];

    this.emit('turn_start', {
      playerId,
      round: this.round,
      timeRemaining: this.config.turnMs,
      wind: this.wind,
      serverTime: Date.now()
    });

    this.setTimer('turn', () => {
      if (this.phase === 'playing' &&
          this.turnPhase === 'aiming' &&
          this.playerOrderIds()[this.currentPlayerIndex] === playerId) {
        this.emit('turn_timeout', { playerId });
        this.endTurn();
      }
    }, this.config.turnMs);

    // Ход бота
    if (current.isBot) {
      this.scheduleBotTurn(current);
    }
  }

  endTurn() {
    if (this.phase !== 'playing') return;

    this.clearTimer('turn');
    this.clearTimer('resolve');
    this.clearTimer('bot');
    this.turnPhase = 'idle';
    this.lastShooterId = null;

    const order = this.playerOrderIds();
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % order.length;

    this.startTurn();
  }

  endRound(winnerId) {
    this.phase = 'interRound';
    this.turnPhase = 'idle';
    this.lastShooterId = null;
    this.clearTimers();

    if (winnerId && this.players[winnerId]) {
      const winner = this.players[winnerId];
      winner.roundWins = (winner.roundWins || 0) + 1;

      const bonus = winner.roundEarned;
      if (bonus > 0) {
        winner.money += bonus;
        winner.totalEarned += bonus;
        this.emit('money_update', { playerId: winnerId, amount: bonus, reason: 'round_win' });
      }
    }

    this.emit('round_end', {
      round: this.round,
      winnerId,
      stats: this.playerOrderIds().map(pid => {
        const p = this.players[pid];
        return { playerId: pid, name: p.name, hp: p.hp, kills: p.kills, roundEarned: p.roundEarned, isAlive: p.isAlive };
      })
    });
    this.emitPlayers();
    this.emitRoomState();

    const isLast = this.round >= this.config.rounds;
    this.emit('inter_round', {
      nextRoundIn: isLast ? GAME.roundPauseTime : GAME.interRoundTime,
      isLastRound: isLast,
      canEditSlots: !isLast
    });

    this.setTimer('round', () => {
      if (this.destroyed) return;
      if (this.phase !== 'interRound') return;

      // Применяем смены слотов: новых ботов спавнит beginRound через startNewRound
      if (this.round < this.config.rounds) {
        const participants = this.playerOrderIds();
        if (participants.length < GAME.minPlayers) {
          this.endMatch();
          return;
        }
        this.phase = 'playing';
        this.startNewRound();
      } else {
        this.endMatch();
      }
    }, isLast ? GAME.roundPauseTime : GAME.interRoundTime);
  }

  endMatch() {
    this.phase = 'matchEnd';
    this.clearTimers();

    // Места: выигранные раунды важнее всего (как в классике — таблица по
    // раундам), дальше фраги, дальше заработок. Равные показатели — равное место.
    const rank = (p) => [p.roundWins || 0, p.kills, Math.round(p.totalEarned)];
    const cmp = (a, b) => {
      const ra = rank(a), rb = rank(b);
      for (let i = 0; i < ra.length; i++) if (rb[i] !== ra[i]) return rb[i] - ra[i];
      return 0;
    };

    const ordered = this.playerOrderIds().map(pid => this.players[pid]).sort(cmp);

    let place = 0;
    let prev = null;
    const finalScores = ordered.map((p, i) => {
      if (!prev || cmp(prev, p) !== 0) place = i + 1;   // ничья делит место
      prev = p;
      return {
        playerId: p.id,
        name: p.name,
        kills: p.kills,
        totalEarned: p.totalEarned,
        roundWins: p.roundWins || 0,
        isBot: !!p.isBot,
        isGuest: !!p.isGuest,
        userId: p.userId || null,
        place
      };
    });

    // Победитель — первое место среди людей: проигрыш боту не засчитывается победой
    const champion = finalScores.find(s => s.place === 1 && !s.isBot) || null;
    const scores = finalScores.map(s => ({ ...s, won: !!champion && s === champion }));

    this.emit('match_end', { finalScores: scores });

    if (this.onMatchEnd && scores.length > 0) {
      try {
        this.onMatchEnd(this.id, this.config.rounds, scores);
      } catch (e) {
        console.error('Ошибка записи матча:', e.message);
      }
    }

    this.setTimer('match', () => {
      if (this.destroyed) return;
      // Возврат в открытую комнату (awaiting): состав можно менять снова
      this.phase = 'awaiting';
      this.round = 0;
      this.terrain = null;
      this.tanks = [];
      for (const pid of this.playerOrderIds()) {
        const p = this.players[pid];
        p.hp = 100;
        p.isAlive = true;
      }
      this.emit('match_reset');
      this.emitRoomState();
    }, 12000);
  }

  // ============================================
  // БОТЫ
  // ============================================

  scheduleBotTurn(bot) {
    const playerId = bot.id;

    this.setTimer('bot', () => {
      if (this.destroyed || this.phase !== 'playing' || this.turnPhase !== 'aiming') return;
      if (this.playerOrderIds()[this.currentPlayerIndex] !== playerId) return;
      if (!bot.isAlive) return;

      const tank = this.tanks.find(t => t.playerId === playerId);
      if (!tank) return;

      // Сбой ИИ не должен ронять комнату: бот пропускает ход
      let shot;
      try {
        // Экономика бота: покупка перед выстрелом
        shot = decideShot({
          difficulty: bot.difficulty,
          heights: this.terrain,
          wind: this.wind,
          selfTank: tank,
          selfHp: bot.hp,
          enemyTanks: this.tanks.filter(t => t.playerId !== playerId),
          money: bot.money,
          inventory: bot.inventory
        });
      } catch (e) {
        console.error(`Комната ${this.id}: ошибка ИИ (${bot.name}):`, e);
        this.endTurn();
        return;
      }

      const weapon = getWeapon(shot.weaponId);
      if (weapon && !weapon.infinite && !(bot.inventory[shot.weaponId] > 0) && bot.money >= weapon.price) {
        bot.money -= weapon.price;
        bot.inventory[shot.weaponId] = 1;
        this.emit('money_update', { playerId: bot.id, amount: -weapon.price, reason: `buy_${shot.weaponId}` });
      }

      this.handleFire(playerId, shot);
    }, thinkDelay(bot.difficulty));
  }

  // ============================================
  // ВЫСТРЕЛ И СТАБИЛИЗАЦИЯ
  // ============================================

  addMoney(playerId, amount, reason) {
    const p = this.players[playerId];
    if (!p) return;

    const rounded = Math.round(amount);
    if (rounded === 0) return;

    p.money += rounded;
    if (rounded > 0) {
      p.roundEarned += rounded;
      p.totalEarned += rounded;
    }

    this.emit('money_update', { playerId, amount: rounded, reason });
    this.emitPlayers();
  }

  damagePlayer(playerId, damage, sourcePlayerId, cause) {
    const p = this.players[playerId];
    if (!p || !p.isAlive || damage <= 0) return false;

    const hpBefore = p.hp;
    p.hp = Math.max(0, p.hp - damage);
    const dealt = hpBefore - p.hp;   // фактически снятые HP (не «перебор» по мертвому танку)

    this.emit('hp_update', { playerId, hp: p.hp, damage: Math.round(damage), cause: cause || 'explosion' });

    // Деньги за урон — только за чужие танки, самоподрыв не оплачивается
    const byOther = sourcePlayerId && sourcePlayerId !== playerId && this.players[sourcePlayerId];
    if (byOther && dealt > 0) {
      this.addMoney(sourcePlayerId, dealt * ECONOMY.perDamageHp, 'damage');
    }

    if (p.hp <= 0) {
      p.isAlive = false;

      if (byOther) {
        this.players[sourcePlayerId].kills++;
        this.addMoney(sourcePlayerId, ECONOMY.perKill, 'kill');
      }

      const tankIndex = this.tanks.findIndex(t => t.playerId === playerId);
      if (tankIndex !== -1) this.tanks.splice(tankIndex, 1);

      this.emit('tank_update', { tanks: this.tanks });
      this.emit('death', { playerId, cause: cause || 'explosion', killerId: sourcePlayerId || null });
    }

    this.emitPlayers();
    return !p.isAlive;
  }

  handleFire(playerId, { angle, power, weaponId }) {
    const p = this.players[playerId];
    const weapon = getWeapon(weaponId);

    angle = Math.max(0, Math.min(180, Number(angle) || 0));
    power = Math.max(0, Math.min(100, Number(power) || 0));

    if (!weapon || !(p.inventory[weaponId] > 0 || weapon.infinite)) {
      return { error: 'Нет снарядов' };
    }

    if (!weapon.infinite) {
      p.inventory[weaponId]--;
      if (p.inventory[weaponId] === 0) p.activeWeaponId = BASE_WEAPON_ID;
      this.emit('inventory_update', { playerId, inventory: p.inventory, activeWeaponId: p.activeWeaponId });
    }

    const tank = this.tanks.find(t => t.playerId === playerId);
    if (!tank) return { error: 'Танк уничтожен' };

    p.angle = angle;
    p.power = power;

    // Автор текущего выстрела: ему засчитываются падения, вызванные его взрывом
    this.lastShooterId = playerId;

    const startX = tank.x;
    const startY = tank.y - PHYSICS.tankHeight;

    const trajectory = calculateProjectileTrajectory({
      startX, startY, angle, power, wind: this.wind, heights: this.terrain
    });

    const impact = trajectory[trajectory.length - 1];

    // === Спец-оружие: расписание попаданий и данные для анимации ===
    const ROLL_STEP_MS = 12;
    let special = null;
    const impacts = [];   // [{ atMs, x, y }]

    const flatten = (pts, step = 2) => {
      const out = [];
      for (let i = 0; i < pts.length; i += step) {
        out.push(Math.round(pts[i].x), Math.round(pts[i].y));
      }
      return out;
    };

    if (weapon.effect === 'mirv') {
      const m = simulateMirv({ startX, startY, angle, power, wind: this.wind, heights: this.terrain });
      special = {
        type: 'mirv',
        main: m.main,
        warheads: m.warheads.map(w => w.trajectory),
        stepMs: 33
      };
      m.warheads.forEach(w => {
        if (w.impact.x >= 0 && w.impact.x < MAP_WIDTH) {
          // Задержка от апекса (callback полета срабатывает в апексе)
          impacts.push({ atMs: (w.trajectory.length / 2) * 16.67, x: w.impact.x, y: w.impact.y });
        }
      });
    } else if (weapon.effect === 'roller') {
      special = {
        type: 'roller',
        main: flatten(trajectory),
        path: null, // заполняется ниже после проверки карты
        stepMs: ROLL_STEP_MS
      };
    } else if (weapon.effect === 'napalm') {
      special = {
        type: 'napalm',
        main: flatten(trajectory),
        flows: null,
        stepMs: ROLL_STEP_MS
      };
    }

    const missedMap = impact.y > 7000 || impact.x < 0 || impact.x >= MAP_WIDTH;

    this.emit('shot', {
      playerId,
      angle,
      power,
      wind: this.wind,
      startX,
      startY,
      weaponId,
      trajectoryDurationMs: trajectory.length * 16.67,
      special
    });

    this.turnPhase = 'resolving';

    // Полет основного снаряда (или до распада MIRV)
    const flightMs = special && special.type === 'mirv'
      ? Math.min(special.main.length / 2 * 16.67, 8000)
      : Math.min(trajectory.length * 16.67, 8000);

    this.setTimer('resolve', () => {
      if (this.destroyed || this.phase !== 'playing') return;

      if (missedMap && impacts.length === 0) {
        this.endTurn();
        return;
      }

      // Roller/Napalm: путь считается по рельефу в момент приземления
      if (special && special.type === 'roller') {
        const path = rollPath(this.terrain, impact.x);
        special.path = flatten(path);
        const end = path[path.length - 1];
        impacts.push({ atMs: path.length * ROLL_STEP_MS, x: end.x, y: end.y });
        this.emit('special_update', { playerId, special });
      } else if (special && special.type === 'napalm') {
        const flows = napalmFlows(this.terrain, impact.x);
        special.flows = flows.map(f => flatten(f));
        flows.forEach((f, fi) => {
          f.forEach((pt, k) => {
            impacts.push({ atMs: 200 + k * 150, x: pt.x, y: pt.y });
          });
        });
        this.emit('special_update', { playerId, special });
      }

      // Обычное оружие — одно попадание в конце полета
      if (impacts.length === 0) {
        impacts.push({ atMs: 0, x: impact.x, y: impact.y });
      }

      const applyImpact = (ix, iy) => {
        ix = Math.max(0, Math.min(MAP_WIDTH - 1, ix));

        const damages = [];
        for (const otherTank of this.tanks) {
          const other = this.players[otherTank.playerId];
          if (!other || !other.isAlive) continue;

          const dx = otherTank.x - ix;
          const dy = (otherTank.y - PHYSICS.tankHeight / 2) - iy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const effectiveRadius = weapon.radius + PHYSICS.tankWidth / 2;

          const dmg = calculateExplosionDamage(dist, effectiveRadius, weapon.damage);
          if (dmg > 0) damages.push({ playerId: otherTank.playerId, damage: dmg });
        }

        let terrainDiff = 0;
        if (weapon.effect === 'add_earth') {
          terrainDiff = -applyDirtBall(this.terrain, ix, iy, weapon.radius);
        } else if (weapon.effect !== 'smoke') {
          terrainDiff = applyExplosion(this.terrain, ix, iy, weapon.radius);
          this.addMoney(playerId, terrainDiff * ECONOMY.perTerrainPixel, 'terrain');
        }

        this.emit('explosion', {
          x: ix, y: iy, radius: weapon.radius, weaponId,
          damages, terrainDiff: Math.round(terrainDiff)
        });

        for (const { playerId: hitId, damage } of damages) {
          this.damagePlayer(hitId, damage, playerId, 'explosion');
        }
      };

      impacts
        .slice()
        .sort((a, b) => a.atMs - b.atMs)
        .forEach((im, i) => {
          const isLast = i === impacts.length - 1;
          if (im.atMs <= 0) {
            applyImpact(im.x, im.y);
            if (isLast) this.finishShot(weapon, playerId);
            return;
          }
          this.scheduleImpact(() => {
            if (this.destroyed || this.phase !== 'playing') return;
            applyImpact(im.x, im.y);
            if (isLast) this.finishShot(weapon, playerId);
          }, im.atMs);
        });

      if (impacts.every(im => im.atMs > 0)) {
        // Все попадания отложены (roller/napalm/mirv): стабилизация после последнего
        // выполняется в его таймере через finishShot
        return;
      }

      // Одиночное мгновенное попадание уже обработано выше
    }, flightMs);

    return {};
  }

  /**
   * Завершение выстрела: осыпание, рассылка рельефа, стабилизация танков.
   */
  finishShot(weapon, playerId) {
    if (this.destroyed || this.phase !== 'playing') return;

    if (weapon.effect !== 'smoke') {
      crumbleTerrain(this.terrain);
      this.emit('terrain_update', { heights: this.terrain, crumbled: true });
    }

    this.runStabilization(0);
  }

  runStabilization(settleDelayMs) {
    this.clearTimer('resolve');
    const startedAt = Date.now();
    let quietTicks = 0;
    const delay = Math.max(0, settleDelayMs || 0);

    const step = () => {
      if (this.phase !== 'playing' || this.destroyed) return;

      let anyMoving = false;

      for (const tank of this.tanks) {
        const p = this.players[tank.playerId];
        if (!p || !p.isAlive) continue;

        const res = updateTankPhysics(tank, this.terrain);
        p.x = tank.x;
        p.y = tank.y;

        if (res.moved) anyMoving = true;

        if (res.landed && res.fallDistance > PHYSICS.fallDamageThreshold) {
          const fallDamage = calculateFallDamage(res.fallDistance);
          if (fallDamage > 0) {
            this.emit('fall_damage', { playerId: tank.playerId, distance: Math.round(res.fallDistance), damage: fallDamage });
            // Сброс врага в пропасть — такое же попадание: фраг и деньги стрелявшему
            this.damagePlayer(tank.playerId, fallDamage, this.lastShooterId || null, 'fall');
          }
        }
      }

      this.emit('tank_update', { tanks: this.tanks });

      if (this.phase !== 'playing' || this.destroyed) return;

      const alive = this.aliveIds();
      if (alive.length <= 1) {
        this.endRound(alive[0] || null);
        return;
      }

      if (anyMoving) quietTicks = 0; else quietTicks++;

      if (quietTicks >= PHYSICS.stabilizationQuietTicks ||
          Date.now() - startedAt > PHYSICS.stabilizationTimeoutMs + delay) {
        this.endTurn();
        return;
      }

      this.setTimer('resolve', step, PHYSICS.tickMs);
    };

    this.setTimer('resolve', step, delay);
  }

  // ============================================
  // ПОКУПКИ / ВЫБОР ОРУЖИЯ
  // ============================================

  buyWeapon(playerId, weaponId) {
    const p = this.players[playerId];
    const weapon = getWeapon(weaponId);
    if (!p || !weapon || weapon.infinite) return;
    if (this.phase !== 'playing' && this.phase !== 'interRound') return;
    if (weapon.price > p.money) return;

    p.money -= weapon.price;
    // Некоторые снаряды продаются пачками (Smoke Tracer)
    p.inventory[weaponId] = (p.inventory[weaponId] || 0) + (weapon.packSize || 1);

    this.emit('inventory_update', { playerId, inventory: p.inventory, activeWeaponId: p.activeWeaponId });
    this.emit('money_update', { playerId, amount: -weapon.price, reason: `buy_${weaponId}` });
    this.emitPlayers();
  }

  selectWeapon(playerId, weaponId) {
    const p = this.players[playerId];
    const weapon = getWeapon(weaponId);
    if (!p || !weapon) return;

    if (weapon.infinite || p.inventory[weaponId] > 0) {
      p.activeWeaponId = weaponId;
    } else {
      p.activeWeaponId = BASE_WEAPON_ID;
      weaponId = BASE_WEAPON_ID;
    }
    this.emit('inventory_update', { playerId, inventory: p.inventory, activeWeaponId: weaponId });
  }

  // ============================================
  // СНАПШОТ ДЛЯ ПОЗДНИХ ПОДКЛЮЧЕНИЙ
  // ============================================

  gameSnapshot() {
    if (!this.terrain) return null;

    const currentId = (this.phase === 'playing')
      ? this.playerOrderIds()[this.currentPlayerIndex]
      : null;

    return {
      status: this.phase,
      round: this.round,
      maxRounds: this.config.rounds,
      players: this.playersSnapshot(),
      terrainSeed: this.terrainSeed,   // тема неба выводится из seed: зритель увидит то же, что все
      heights: this.terrain,
      tanks: this.tanks,
      wind: this.wind,
      currentPlayerId: currentId,
      timeRemaining: this.timers.turn && this.turnPhase === 'aiming'
        ? Math.max(0, this.config.turnMs - (Date.now() - this.turnStartTime))
        : 0
    };
  }

  // ============================================
  // ТАЙМЕРЫ
  // ============================================

  setTimer(name, fn, ms) {
    if (this.timers[name]) clearTimeout(this.timers[name]);
    this.timers[name] = setTimeout(() => {
      this.timers[name] = null;
      fn();
    }, ms);
  }

  /**
   * Отложенные попадания (боеголовки MIRV, шары напалма): независимые таймеры,
   * общий пул this.timers.impacts очищается вместе с остальными.
   */
  scheduleImpact(fn, ms) {
    if (!this.timers.impacts) this.timers.impacts = [];
    const t = setTimeout(() => {
      this.timers.impacts = (this.timers.impacts || []).filter(x => x !== t);
      fn();
    }, ms);
    this.timers.impacts.push(t);
  }

  clearTimer(name) {
    if (this.timers[name]) {
      clearTimeout(this.timers[name]);
      this.timers[name] = null;
    }
  }

  clearTimers() {
    Object.keys(this.timers).forEach(k => {
      if (k === 'impacts') {
        (this.timers[k] || []).forEach(clearTimeout);
        this.timers[k] = [];
      } else {
        this.clearTimer(k);
      }
    });
  }
}

module.exports = { Room };
