/**
 * Сетевой модуль клиента: комнаты, события змейкой (серверный контракт).
 * playerId + roomId хранятся в localStorage для реконнекта.
 */

const STORAGE_KEY = 'bg_session';

class Network {
  constructor() {
    this.socket = null;
    this.playerId = null;
    this.roomId = null;
    this.playerName = null;
    this.authToken = localStorage.getItem('bg_token') || null;
    this.account = null;        // { id, username } если авторизован
    this.eventHandlers = {};
  }

  restoreSession() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      return null;
    }
  }

  saveSession() {
    if (this.roomId && this.playerId) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        roomId: this.roomId, playerId: this.playerId, name: this.playerName
      }));
    }
  }

  clearSession() {
    localStorage.removeItem(STORAGE_KEY);
  }

  connect() {
    // Токен аккаунта уходит в handshake: сервер привяжет игрока к профилю
    this.socket = io({ auth: { token: this.authToken } });

    this.socket.on('connect', () => {
      console.log('Подключено к серверу');

      const saved = this.restoreSession();
      if (saved && saved.roomId && saved.playerId) {
        this.playerName = saved.name;
        this.socket.emit('rejoin', { roomId: saved.roomId, playerId: saved.playerId });
      } else {
        this.emit('need_join', {});
      }
    });

    this.socket.on('disconnect', () => {
      this.emit('connection_lost');
    });

    this.registerServerEvents();
  }

  registerServerEvents() {
    this.socket.on('room_created', (d) => {
      this.roomId = d.roomId;
      this.playerId = d.playerId;
      this.saveSession();
      this.lastRoomState = d.room;
      this.emit('room_created', d);
    });

    this.socket.on('room_state', (d) => {
      this.lastRoomState = d;
      if (d.roomId) this.roomId = d.roomId;
      this.emit('room_state', d);
    });

    this.socket.on('joined_room', (d) => {
      if (d.playerId) {
        this.playerId = d.playerId;
        this.saveSession();
      }
      if (d.room) this.lastRoomState = d.room;
      this.emit('joined_room', d);
    });

    this.socket.on('join_failed', (d) => {
      this.clearSession();
      this.emit('join_failed', d);
    });

    this.socket.on('rejoin_result', (d) => {
      if (d.ok) {
        this.roomId = d.roomId;
        this.playerId = d.playerId;
        this.saveSession();
      } else {
        this.clearSession();
      }
      this.emit('rejoin_result', d);
    });

    this.socket.on('game_snapshot', (d) => this.emit('game_snapshot', d));

    const forward = (event) => {
      this.socket.on(event, (data) => this.emit(event, data));
    };

    [
      'room_launched', 'host_changed', 'inter_round',
      'match_start', 'round_start', 'turn_start', 'turn_timeout',
      'shot', 'explosion', 'terrain_update', 'tank_update', 'players_update',
      'hp_update', 'death', 'fall_damage', 'player_disconnected',
      'money_update', 'inventory_update', 'round_end', 'match_end', 'match_reset',
      'error'
    ].forEach(forward);
  }

  // ==== Аккаунт ====

  async api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {}),
        ...(options.headers || {})
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка сервера');
    return data;
  }

  async login(username, password) {
    const d = await this.api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    this.setAuth(d.token, d.user);
    return d;
  }

  async register(username, password) {
    const d = await this.api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    this.setAuth(d.token, d.user);
    return d;
  }

  async fetchMe() {
    if (!this.authToken) return null;
    try {
      const d = await this.api('/api/me');
      this.account = d.user;
      return d;
    } catch {
      this.setAuth(null, null);
      return null;
    }
  }

  setAuth(token, user) {
    this.authToken = token;
    this.account = user;
    if (token) localStorage.setItem('bg_token', token);
    else localStorage.removeItem('bg_token');

    // Переподключаем сокет с новым токеном в handshake
    if (this.socket) {
      this.socket.auth = { token };
      this.socket.disconnect().connect();
    }
  }

  // ==== Команды ====

  createRoom(playerName, colorIdx) {
    this.playerName = playerName;
    this.socket.emit('create_room', { playerName, colorIdx });
  }

  joinRoom(roomId, playerName, colorIdx, asSpectator) {
    this.playerName = playerName;
    this.socket.emit('join_room', { roomId, playerName, colorIdx, asSpectator });
  }

  claimSlot(slotIndex, colorIdx) {
    this.socket.emit('claim_slot', { slotIndex, colorIdx });
  }

  leaveRoom() {
    this.socket.emit('leave_room', {});
    this.roomId = null;
    this.playerId = null;
    this.clearSession();
  }

  addSlot(kind, difficulty) {
    this.socket.emit('add_slot', { kind, difficulty });
  }

  removeSlot(slotIndex) {
    this.socket.emit('remove_slot', { slotIndex });
  }

  setSlot(slotIndex, kind, difficulty) {
    this.socket.emit('set_slot', { slotIndex, kind, difficulty });
  }

  setSlotColor(slotIndex, colorIdx) {
    this.socket.emit('set_slot_color', { slotIndex, colorIdx });
  }

  launch() {
    this.socket.emit('launch', {});
  }

  startMatch() {
    this.socket.emit('start_match', {});
  }

  buyWeapon(weaponId) {
    this.socket.emit('buy_weapon', { weaponId });
  }

  selectWeapon(weaponId) {
    this.socket.emit('select_weapon', { weaponId });
  }

  fire(angle, power, weaponId) {
    this.socket.emit('fire', { angle, power, weaponId });
  }

  isSpectator() {
    return this.roomId !== null && this.playerId === null;
  }

  // ==== События ====

  on(event, callback) {
    if (!this.eventHandlers[event]) this.eventHandlers[event] = [];
    this.eventHandlers[event].push(callback);
  }

  emit(event, data) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(cb => cb(data));
    }
  }
}

window.network = new Network();
