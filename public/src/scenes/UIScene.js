/**
 * UIScene — экраны: вход, комната (лобби со слотами), игра, пауза между раундами.
 */

const DIFF_LABELS = { easy: 'ЛЕГКО', medium: 'СРЕДНЕ', hard: 'СЛОЖНО' };

class UIScene extends Phaser.Scene {
  constructor() {
    super({ key: 'UIScene' });

    this.players = {};
    this.roomState = null;
    this.inventory = { baby_missile: Infinity };
    this.activeWeaponId = 'baby_missile';
    this.money = 500;
    this.currentPlayerId = null;
    this.isMyTurn = false;
    this.selectedColorIdx = 0;
    this.round = 0;
    this.maxRounds = 5;
    this.timerInterval = null;
    this.interroundInterval = null;
  }

  create() {
    window.inputHandler = new window.InputHandler(this);

    this.setupUIElements();
    this.setupNetworkListeners();
    this.setupEventHandlers();
    this.initAccount();

    this.showEntryScreen();
    this.renderColorPicker();
  }

  // ============================================
  // АККАУНТ
  // ============================================

  async initAccount() {
    const me = await window.network.fetchMe();
    if (me) this.showProfile(me.user, me.stats, me.matches);
  }

  showProfile(user, stats, matches) {
    if (!this.profileLine) return;

    const s = stats || { matches: 0, wins: 0, kills: 0, earned: 0, winRate: 0, elo: 1000, rankedGames: 0 };
    this.profileLine.classList.remove('hidden');
    this.profileLine.innerHTML =
      `<b>${escapeHtml(user.username)}</b> · <span class="stat elo">${s.elo ?? 1000} ELO</span>` +
      (s.rankedGames ? ` (рейтинговых ${s.rankedGames})` : ' (нет рейтинговых матчей)') +
      ` · матчей <span class="stat">${s.matches}</span>` +
      ` · побед <span class="stat">${s.wins}</span> (${s.winRate}%)` +
      ` · убийств <span class="stat">${s.kills}</span> · заработано <span class="stat">$${s.earned}</span>`;

    this.renderHistory(matches);

    this.btnLogout?.classList.remove('hidden');
    document.getElementById('btn-login')?.classList.add('hidden');
    document.getElementById('btn-register')?.classList.add('hidden');

    // Авторизованный играет под именем аккаунта — сервер все равно
    // подставит его, поэтому поле фиксируем, чтобы не вводить в заблуждение
    if (this.entryName) {
      this.entryName.value = user.username;
      this.entryName.disabled = true;
      this.entryName.title = 'Позывной берется из аккаунта';
    }
  }

  /**
   * Последние матчи: место, состав и изменение рейтинга.
   */
  renderHistory(matches) {
    if (!this.profileHistory) return;

    if (!matches || matches.length === 0) {
      this.profileHistory.classList.add('hidden');
      this.profileHistory.innerHTML = '';
      return;
    }

    this.profileHistory.classList.remove('hidden');
    this.profileHistory.innerHTML =
      '<div class="lobby-label">// ПОСЛЕДНИЕ МАТЧИ:</div>' +
      matches.map(m => {
        const delta = m.eloDelta === null || m.eloDelta === undefined
          ? '<span class="history-unranked">без рейтинга</span>'
          : `<span class="${m.eloDelta >= 0 ? 'history-up' : 'history-down'}">${m.eloDelta >= 0 ? '+' : ''}${m.eloDelta} ELO</span>`;

        const myName = window.network.account?.username;
        const rivals = (m.composition || [])
          .filter(c => c.name !== myName)
          .map(c => escapeHtml(c.name) + (c.isBot ? ' [бот]' : (c.isGuest ? ' [гость]' : '')))
          .join(', ') || 'соперники не записаны';

        return `
          <div class="history-row">
            <span class="history-place">${m.place || '-'} место</span>
            <span class="history-kills">убийств ${m.kills}</span>
            <span class="history-rounds">раундов ${m.roundsWon}</span>
            ${delta}
            <div class="history-rivals">${rivals}</div>
          </div>
        `;
      }).join('');
  }

  async showLeaderboard() {
    if (!this.leaderboardModal) return;
    this.leaderboardModal.classList.add('visible');
    this.leaderboardList.innerHTML = '<div class="leader-row">загрузка...</div>';

    try {
      const leaders = await window.network.fetchLeaderboard(50);
      this.leaderboardList.innerHTML = leaders.length === 0
        ? '<div class="leader-row">Рейтинговых матчей еще не было</div>'
        : leaders.map(l => `
            <div class="leader-row ${l.username === window.network.account?.username ? 'leader-me' : ''}">
              <span class="leader-rank">${l.rank}</span>
              <span class="leader-name">${escapeHtml(l.username)}</span>
              <span class="leader-elo">${l.elo}</span>
              <span class="leader-extra">пик ${l.peakElo} · матчей ${l.rankedGames} · побед ${l.wins}</span>
            </div>
          `).join('');
    } catch (e) {
      this.leaderboardList.innerHTML = `<div class="leader-row">Ошибка: ${escapeHtml(e.message)}</div>`;
    }
  }

  closeLeaderboard() {
    this.leaderboardModal?.classList.remove('visible');
  }

  hideProfile() {
    this.profileLine?.classList.add('hidden');
    this.profileHistory?.classList.add('hidden');
    this.btnLogout?.classList.add('hidden');
    document.getElementById('btn-login')?.classList.remove('hidden');
    document.getElementById('btn-register')?.classList.remove('hidden');

    if (this.entryName) {
      this.entryName.disabled = false;
      this.entryName.title = '';
    }
  }

  setupAccountHandlers() {
    const doLogin = async (register) => {
      const username = this.authUsername?.value.trim();
      const password = this.authPassword?.value;
      if (!username || !password) return;

      try {
        const d = register
          ? await window.network.register(username, password)
          : await window.network.login(username, password);
        this.authPassword.value = '';
        const me = await window.network.fetchMe();
        this.showProfile(d.user, me ? me.stats : null, me ? me.matches : null);
        window.sound?.coin();
        this.showMessage(register ? 'Аккаунт создан' : `С возвращением, ${d.user.username}!`);
      } catch (e) {
        window.sound?.click();
        this.showMessage(e.message);
      }
    };

    document.getElementById('btn-login')?.addEventListener('click', () => doLogin(false));
    document.getElementById('btn-register')?.addEventListener('click', () => doLogin(true));

    this.authPassword?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doLogin(false);
    });
    this.authUsername?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.authPassword?.focus();
    });

    this.btnLogout?.addEventListener('click', async () => {
      await window.network.logout();
      this.hideProfile();
      this.showMessage('Вы вышли из аккаунта');
    });

    document.getElementById('btn-leaderboard')?.addEventListener('click', () => this.showLeaderboard());
    document.getElementById('btn-close-leaderboard')?.addEventListener('click', () => this.closeLeaderboard());
    this.leaderboardModal?.addEventListener('click', (e) => {
      if (e.target === this.leaderboardModal) this.closeLeaderboard();
    });
  }

  setupUIElements() {
    // Вход
    this.entryScreen = document.getElementById('entry-screen');
    this.entryBox = document.getElementById('entry-box');
    this.entryName = document.getElementById('entry-name');
    this.entryCode = document.getElementById('entry-code');
    this.entryColors = document.getElementById('entry-colors');
    this.entryReconnect = document.getElementById('entry-reconnect');
    this.entryError = document.getElementById('entry-error');

    // Аккаунт
    this.authUsername = document.getElementById('auth-username');
    this.authPassword = document.getElementById('auth-password');
    this.profileLine = document.getElementById('profile-line');
    this.profileHistory = document.getElementById('profile-history');
    this.btnLogout = document.getElementById('btn-logout');
    this.leaderboardModal = document.getElementById('leaderboard-modal');
    this.leaderboardList = document.getElementById('leaderboard-list');

    // Список комнат
    this.roomsModal = document.getElementById('rooms-modal');
    this.roomsList = document.getElementById('rooms-list');

    // Комната
    this.roomScreen = document.getElementById('room-screen');
    this.roomSettingsView = document.getElementById('room-settings-view');
    this.roomSettingsForm = document.getElementById('room-settings-form');
    this.entryRoomPassword = document.getElementById('entry-room-password');
    this.roomCodeEl = document.getElementById('room-code');
    this.roomPhaseLabel = document.getElementById('room-phase-label');
    this.roomSlotsEl = document.getElementById('room-slots');
    this.roomStatusEl = document.getElementById('room-status');
    this.roomSpectatorsEl = document.getElementById('room-spectators');
    this.hostControls = document.getElementById('host-controls');

    // Игра
    this.gameContainer = document.getElementById('game-container');
    this.playersList = document.getElementById('players-list');
    this.roundDisplay = document.getElementById('round-display');
    this.currentPlayerEl = document.getElementById('current-player');
    this.windValue = document.getElementById('wind-value');
    this.timeValue = document.getElementById('time-value');
    this.timerEl = document.getElementById('timer');
    this.moneyValue = document.getElementById('money-value');
    this.inventoryList = document.getElementById('inventory-list');
    this.btnOpenShop = document.getElementById('btn-open-shop');
    this.shopModal = document.getElementById('shop-modal');
    this.shopGrid = document.getElementById('shop-grid');
    this.shopMoney = document.getElementById('shop-money');
    this.sidebarEl = document.getElementById('sidebar');
    this.messagePanel = document.getElementById('message-panel');
    this.messageText = document.getElementById('message-text');

    // Пауза между раундами
    this.interroundOverlay = document.getElementById('interround-overlay');
    this.interroundTitle = document.getElementById('interround-title');
    this.interroundWinner = document.getElementById('interround-winner');
    this.interroundCountdown = document.getElementById('interround-countdown');
    this.interroundSlots = document.getElementById('interround-slots');
    this.interroundHint = document.getElementById('interround-hint');
  }

  // ============================================
  // СЕТЕВЫЕ СОБЫТИЯ
  // ============================================

  setupNetworkListeners() {
    const net = window.network;

    net.on('need_join', () => this.showEntryScreen());
    net.on('connection_lost', () => this.showMessage('Связь потеряна. Переподключение...'));

    net.on('room_created', (d) => {
      this.showRoomScreen();
      if (d.room) this.applyRoomState(d.room);
    });

    net.on('joined_room', (d) => {
      this.showRoomScreen();
      if (d.spectator) {
        this.showMessage('Вы наблюдаете за игрой');
      }
      if (d.room) this.applyRoomState(d.room);
    });

    net.on('join_failed', (d) => {
      this.showEntryScreen();
      this.entryError.textContent = d.reason === 'Комната не найдена' ? 'КОМНАТА НЕ НАЙДЕНА' : 'НЕ УДАЛОСЬ ВОЙТИ';
      this.entryError.classList.remove('hidden');
    });

    net.on('rejoin_result', (d) => {
      if (d.ok) {
        this.showGameScreen();
        if (d.room) this.applyRoomState(d.room);
        const snap = d.snapshot;
        if (snap && (snap.status === 'playing' || snap.status === 'interRound')) {
          this.restoreGameFromSnapshot(snap);
        }
        if (d.inventory) {
          this.inventory = d.inventory;
          this.activeWeaponId = d.activeWeaponId || 'baby_missile';
          this.updateInventoryDisplay();
        }
        this.showMessage('Вы вернулись в бой!');
      } else {
        this.showEntryScreen();
      }
    });

    net.on('game_snapshot', (snap) => {
      this.showGameScreen();
      if (snap && (snap.status === 'playing' || snap.status === 'interRound')) {
        this.restoreGameFromSnapshot(snap);
      }
    });

    net.on('room_state', (d) => this.applyRoomState(d));
    net.on('chat_message', (d) => this.appendChat(d));
    net.on('chat_history', (d) => {
      this.clearChat();
      (d.messages || []).forEach(m => this.appendChat(m));
    });
    net.on('kicked', () => {
      this.roomState = null;
      this.showEntryScreen();
      this.entryError.textContent = 'ВАС УДАЛИЛИ ИЗ КОМНАТЫ';
      this.entryError.classList.remove('hidden');
    });
    net.on('room_launched', () => this.showMessage('Лобби запущено — делитесь ссылкой!'));
    net.on('host_changed', (d) => {
      if (d.hostId === window.network.playerId) this.showMessage('Теперь вы хост');
    });

    net.on('match_start', (d) => this.handleMatchStart(d));
    net.on('round_start', (d) => this.handleRoundStart(d));
    net.on('turn_start', (d) => this.handleTurnStart(d));
    net.on('turn_timeout', (d) => this.handleTurnTimeout(d));
    net.on('players_update', (d) => this.handlePlayersUpdate(d));
    net.on('player_disconnected', (d) => {
      this.showMessage(`${d.name} потерял связь (${Math.round(d.reconnectWindowMs / 1000)}c на возврат)`);
    });
    net.on('money_update', (d) => this.handleMoneyUpdate(d));
    net.on('inventory_update', (d) => {
      if (d.playerId === window.network.playerId) {
        this.inventory = d.inventory || this.inventory;
        if (d.activeWeaponId) this.activeWeaponId = d.activeWeaponId;
        this.updateInventoryDisplay();
      }
    });
    net.on('death', (d) => this.handleDeath(d));
    net.on('round_end', (d) => this.handleRoundEnd(d));
    net.on('inter_round', (d) => this.handleInterRound(d));
    net.on('match_end', (d) => this.handleMatchEnd(d));
    net.on('match_reset', () => this.handleMatchReset());
    net.on('error', (d) => this.showMessage(d.message));
  }

  setupEventHandlers() {
    this.setupAccountHandlers();
    this.setupChat();

    // ==== Вход ====
    // Позывной запоминается: showEntryScreen подставит его при следующем заходе
    const rememberName = (name) => localStorage.setItem('bg_name', name);

    document.getElementById('btn-create').addEventListener('click', () => {
      const name = this.entryName.value.trim();
      if (!name) { this.entryName.focus(); return; }
      rememberName(name);
      window.network.createRoom(name, this.selectedColorIdx);
    });

    const joinWith = (asSpectator, roomCode) => {
      const name = this.entryName.value.trim();
      const code = (roomCode || this.entryCode.value).trim().toUpperCase();
      if (!name || !code) return;
      rememberName(name);
      window.network.joinRoom(
        code, name, this.selectedColorIdx, asSpectator,
        this.entryRoomPassword ? this.entryRoomPassword.value : ''
      );
    };

    document.getElementById('btn-join').addEventListener('click', () => joinWith(false));
    document.getElementById('btn-spectate').addEventListener('click', () => joinWith(true));
    this.joinWith = joinWith;

    document.getElementById('btn-rooms')?.addEventListener('click', () => this.showRooms());
    document.getElementById('btn-refresh-rooms')?.addEventListener('click', () => this.showRooms());
    document.getElementById('btn-close-rooms')?.addEventListener('click', () => this.closeRooms());
    this.roomsModal?.addEventListener('click', (e) => {
      if (e.target === this.roomsModal) this.closeRooms();
    });

    document.getElementById('btn-save-settings')?.addEventListener('click', () => this.saveSettings());

    // Пока хост правит поля, room_state их не перетирает
    ['set-name', 'set-rounds', 'set-turn', 'set-money', 'set-wind', 'set-public', 'set-password']
      .forEach(id => document.getElementById(id)?.addEventListener('input', () => { this.settingsDirty = true; }));

    this.entryName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-create').click();
    });
    this.entryCode.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-join').click();
    });

    // ==== Комната ====
    document.getElementById('btn-copy-link').addEventListener('click', () => {
      const url = this.roomShareUrl();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => this.showMessage('Ссылка скопирована'));
      } else {
        this.showMessage(url);
      }
    });

    document.getElementById('btn-leave-room').addEventListener('click', () => {
      window.network.leaveRoom();
      location.reload();
    });

    document.getElementById('btn-add-human').addEventListener('click', () => {
      window.network.addSlot('human');
    });

    document.getElementById('btn-add-bot').addEventListener('click', () => {
      window.network.addSlot('bot', 'easy');
    });

    document.getElementById('btn-launch').addEventListener('click', () => {
      window.network.launch();
    });

    document.getElementById('btn-start').addEventListener('click', () => {
      window.network.startMatch();
    });

    // ==== Магазин (модальное окно) ====
    this.btnOpenShop?.addEventListener('click', () => this.openShop());
    document.getElementById('btn-close-shop')?.addEventListener('click', () => this.closeShop());
    this.shopModal?.addEventListener('click', (e) => {
      if (e.target === this.shopModal) this.closeShop();
    });

    // Горячие клавиши (не срабатывают в полях ввода)
    document.addEventListener('keydown', (e) => {
      if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        // Escape возвращает управление игре из поля чата
        if (e.code === 'Escape') document.activeElement.blur();
        return;
      }

      if (e.code === 'KeyT') {
        const input = document.querySelector('#chat-panel .chat-input');
        if (input) { e.preventDefault(); input.focus(); }
        return;
      }

      if (e.code === 'KeyB') {
        this.shopModal?.classList.contains('visible') ? this.closeShop() : this.openShop();
      } else if (e.code === 'Escape') {
        this.closeShop();
        this.closeLeaderboard();
        this.closeRooms();
      }
    });

    // ==== Выстрел и вращение ствола ====
    window.inputHandler.setOnFireCallback((angle, power) => {
      if (this.isMyTurn) {
        window.network.fire(angle, power, this.getActiveWeapon());
      } else if (this.currentPlayerId) {
        this.showMessage('Сейчас не ваш ход');
      }
    });

    window.inputHandler.setOnAngleChangeCallback((angle) => {
      const gs = this.scene.get('GameScene');
      const myId = window.network.playerId;
      const tank = gs && myId ? gs.tanks[myId] : null;
      if (tank) tank.setAngle(angle);
    });
  }

  // ============================================
  // ЭКРАН ВХОДА
  // ============================================

  showEntryScreen() {
    this.entryScreen.classList.remove('hidden');
    this.roomScreen.classList.add('hidden');
    this.gameContainer.classList.remove('visible');
    this.interroundOverlay.classList.remove('visible');

    // Ссылка с кодом комнаты? Подставим код
    const params = new URLSearchParams(location.search);
    const room = params.get('room');
    if (room) {
      this.entryCode.value = room.toUpperCase();
    }

    const savedName = localStorage.getItem('bg_name');
    if (savedName) this.entryName.value = savedName;
  }

  renderColorPicker() {
    const palette = window.CONSTANTS.PALETTE;
    this.entryColors.innerHTML = palette.map((c, i) =>
      `<div class="color-swatch ${i === this.selectedColorIdx ? 'selected' : ''}" data-idx="${i}" style="background:${c.css}" title="${c.name}"></div>`
    ).join('');

    this.entryColors.querySelectorAll('.color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        this.selectedColorIdx = parseInt(sw.dataset.idx, 10);
        this.entryColors.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
      });
    });
  }

  // ============================================
  // ЭКРАН КОМНАТЫ
  // ============================================

  showRoomScreen() {
    this.entryScreen.classList.add('hidden');
    this.roomScreen.classList.remove('hidden');
    this.gameContainer.classList.remove('visible');
  }

  showGameScreen() {
    this.entryScreen.classList.add('hidden');
    this.roomScreen.classList.add('hidden');
    this.gameContainer.classList.add('visible');
    this.sidebarEl.classList.toggle('spectator', window.network.isSpectator());
  }

  // ============================================
  // ЧАТ
  // ============================================

  setupChat() {
    // Блоков два (лобби и сайдбар), поведение общее
    document.querySelectorAll('.chat-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        this.sendChat(input);
      });
    });

    document.querySelectorAll('.chat-send').forEach(btn => {
      const input = btn.parentElement.querySelector('.chat-input');
      btn.addEventListener('click', () => this.sendChat(input));
    });
  }

  sendChat(input) {
    const text = input.value.trim();
    if (!text) return;
    window.network.sendChat(text);
    input.value = '';
  }

  appendChat(msg) {
    const line = document.createElement('div');

    if (msg.system) {
      line.className = 'chat-line chat-system';
      line.textContent = msg.text;
    } else {
      line.className = 'chat-line';
      const color = msg.colorIdx !== null && msg.colorIdx !== undefined
        ? (window.CONSTANTS.PALETTE[msg.colorIdx]?.css || '#9dffb0')
        : '#7bbd8a';
      const tag = msg.isSpectator ? ' (зритель)' : '';
      line.innerHTML =
        `<span class="chat-author" style="color:${color}">${escapeHtml(msg.name)}${tag}:</span> ` +
        `<span class="chat-text">${escapeHtml(msg.text)}</span>`;
    }

    document.querySelectorAll('.chat-log').forEach(log => {
      log.appendChild(line.cloneNode(true));
      log.scrollTop = log.scrollHeight;
    });
  }

  clearChat() {
    document.querySelectorAll('.chat-log').forEach(log => { log.innerHTML = ''; });
  }

  // ============================================
  // СПИСОК ОТКРЫТЫХ КОМНАТ
  // ============================================

  async showRooms() {
    if (!this.roomsModal) return;
    this.roomsModal.classList.add('visible');
    this.roomsList.innerHTML = '<div class="room-listing">загрузка...</div>';

    const phases = {
      awaiting: 'ждет игроков', playing: 'идет бой',
      interRound: 'пауза между раундами', matchEnd: 'матч завершен'
    };

    try {
      const rooms = await window.network.fetchRooms();
      if (rooms.length === 0) {
        this.roomsList.innerHTML = '<div class="room-listing">Открытых комнат нет — создайте свою</div>';
        return;
      }

      this.roomsList.innerHTML = rooms.map(r => `
        <div class="room-listing">
          <span class="rl-name">${escapeHtml(r.name)}${r.hasPassword ? ' <span class="rl-lock">🔒</span>' : ''}</span>
          <span class="rl-code">${r.id}</span>
          <span class="rl-phase">${phases[r.phase] || r.phase}</span>
          <span class="rl-slots">игроков ${r.players}/${r.slots} · свободно ${r.freeHumanSlots}</span>
          <span class="rl-rules">${r.rounds} р. · ${r.turnSec}с</span>
          <button class="rl-join" data-room="${r.id}">${r.freeHumanSlots > 0 ? 'ВОЙТИ' : 'НАБЛЮДАТЬ'}</button>
        </div>
      `).join('');

      this.roomsList.querySelectorAll('.rl-join').forEach(btn => {
        btn.addEventListener('click', () => {
          const room = rooms.find(r => r.id === btn.dataset.room);
          this.entryCode.value = btn.dataset.room;
          if (room && room.hasPassword && this.entryRoomPassword && !this.entryRoomPassword.value) {
            this.closeRooms();
            this.entryRoomPassword.focus();
            this.showMessage('Комната под паролем — введите его и нажмите ВОЙТИ');
            return;
          }
          this.closeRooms();
          this.joinWith(!room || room.freeHumanSlots === 0, btn.dataset.room);
        });
      });
    } catch (e) {
      this.roomsList.innerHTML = `<div class="room-listing">Ошибка: ${escapeHtml(e.message)}</div>`;
    }
  }

  closeRooms() {
    this.roomsModal?.classList.remove('visible');
  }

  // ============================================
  // НАСТРОЙКИ КОМНАТЫ
  // ============================================

  renderSettings(state, isHost) {
    const s = state.settings;
    if (!s || !this.roomSettingsView) return;

    const lock = s.hasPassword ? ' · под паролем' : '';
    const visibility = s.isPublic ? 'публичная' : 'приватная';
    this.roomSettingsView.textContent =
      `${s.name || 'Комната ' + state.roomId} · ${visibility}${lock} · раундов ${s.rounds}` +
      ` · ход ${s.turnSec}с · старт $${s.startMoney} · ветер до ${s.maxWind}`;

    const editable = isHost && state.phase !== 'playing' && state.phase !== 'interRound';
    this.roomSettingsForm?.classList.toggle('hidden', !editable);
    if (!editable || this.settingsDirty) return;

    // Поля не перетираем, пока хост их правит (settingsDirty снимается после ПРИМЕНИТЬ)
    const set = (id, value) => { const el = document.getElementById(id); if (el) el.value = value; };
    set('set-name', s.name);
    set('set-rounds', s.rounds);
    set('set-turn', s.turnSec);
    set('set-money', s.startMoney);
    set('set-wind', s.maxWind);
    const pub = document.getElementById('set-public');
    if (pub) pub.checked = s.isPublic;
  }

  saveSettings() {
    const num = (id) => Number(document.getElementById(id)?.value);
    window.network.setSettings({
      name: document.getElementById('set-name')?.value || '',
      rounds: num('set-rounds'),
      turnSec: num('set-turn'),
      startMoney: num('set-money'),
      maxWind: num('set-wind'),
      isPublic: !!document.getElementById('set-public')?.checked,
      password: document.getElementById('set-password')?.value || ''
    });
    this.settingsDirty = false;
    this.showMessage('Настройки применены');
    window.sound?.click();
  }

  roomShareUrl() {
    return `${location.origin}/?room=${this.roomState ? this.roomState.roomId : ''}`;
  }

  applyRoomState(state) {
    this.roomState = state;
    this.roomCodeEl.textContent = state.roomId;

    const phaseLabels = {
      setup: 'НАСТРОЙКА СОСТАВА',
      awaiting: 'ОЖИДАНИЕ ИГРОКОВ — ссылка активна',
      playing: `ИГРА ИДЕТ · РАУНД ${state.round}/${state.maxRounds}`,
      interRound: 'ПАУЗА МЕЖДУ РАУНДАМИ',
      matchEnd: 'МАТЧ ЗАВЕРШЕН'
    };
    this.roomPhaseLabel.textContent = phaseLabels[state.phase] || state.phase;

    const myId = window.network.playerId;
    const isHost = myId && state.hostId === myId;
    const inMatch = state.phase === 'playing' || state.phase === 'interRound';

    this.renderSettings(state, isHost);

    // Кнопки хоста
    this.hostControls.classList.toggle('hidden', !isHost || inMatch);
    document.getElementById('btn-launch').classList.toggle('hidden', state.phase !== 'setup');
    document.getElementById('btn-start').classList.toggle('hidden', state.phase !== 'awaiting');
    document.getElementById('btn-add-human').disabled = state.slots.length >= window.CONSTANTS.ROOM.maxSlots;
    document.getElementById('btn-add-bot').disabled = state.slots.length >= window.CONSTANTS.ROOM.maxSlots;

    // Слоты
    this.renderSlots(state, isHost, inMatch);

    // Зрители
    this.roomSpectatorsEl.innerHTML = state.spectators
      .map(s => escapeHtml(s.name)).join(', ');

    // Статус
    const humans = state.slots.filter(s => s.kind === 'human' && s.player).length;
    const freeHuman = state.slots.filter(s => s.kind === 'human' && !s.player).length;
    const bots = state.slots.filter(s => s.kind === 'bot').length;

    if (state.phase === 'setup') {
      this.roomStatusEl.textContent = `Настройте состав. Сейчас: людей ${humans}, ботов ${bots}`;
    } else if (state.phase === 'awaiting') {
      this.roomStatusEl.textContent = `Ждем игроков: свободно слотов ${freeHuman}. Ботов: ${bots}. ${isHost ? 'Нажмите НАЧАТЬ МАТЧ, когда готовы.' : 'Ждите старта от хоста.'}`;
    }
  }

  renderSlots(state, isHost, inMatch) {
    const myId = window.network.playerId;

    this.roomSlotsEl.innerHTML = state.slots.map((slot, i) => {
      const colorStyle = `style="background:${slot.color}"`;
      let inner = '';

      if (slot.player) {
        const me = slot.player.id === myId ? ' me-slot' : '';
        const diff = slot.player.isBot && slot.player.difficulty
          ? `<span class="slot-difficulty">[${DIFF_LABELS[slot.player.difficulty]}]</span>` : '';
        const hostTag = slot.player.id === state.hostId ? ' <span style="color:#ffd24a">(хост)</span>' : '';
        inner = `
          <div class="slot-top">
            <div class="slot-color" ${colorStyle}></div>
            <span class="slot-name">${escapeHtml(slot.player.name)}${hostTag}</span>
            ${diff}
          </div>
          <div class="slot-kind">${slot.player.isBot ? 'БОТ' : (slot.player.isGuest ? 'ГОСТЬ' : 'ИГРОК')}${slot.player.connected === false ? ' · ОФФЛАЙН' : ''}</div>
        `;
      } else if (slot.kind === 'human') {
        inner = `
          <div class="slot-top">
            <div class="slot-color" ${colorStyle}></div>
            <span class="slot-name" style="color:#3a5a42">-- СВОБОДНО --</span>
            <button class="slot-claim" data-slot="${i}">ЗАНЯТЬ</button>
          </div>
          <div class="slot-kind">СЛОТ ИГРОКА</div>
        `;
      } else {
        inner = `
          <div class="slot-top">
            <div class="slot-color" ${colorStyle}></div>
            <span class="slot-name" style="color:#ff77ff">Бот</span>
          </div>
          <div class="slot-kind">СЛОТ БОТА · ${DIFF_LABELS[slot.difficulty] || ''}</div>
        `;
      }

      // Управление хоста
      let hostCtl = '';
      if (isHost) {
        if (!inMatch && slot.player && slot.player.id !== state.hostId) {
          hostCtl = `
            <div class="slot-host-controls">
              <button class="ctl-kick" data-slot="${i}">ВЫГНАТЬ</button>
            </div>
          `;
        } else if (!inMatch && !slot.player) {
          hostCtl = `
            <div class="slot-host-controls">
              <select data-slot="${i}" class="ctl-kind">
                <option value="human" ${slot.kind === 'human' ? 'selected' : ''}>Игрок</option>
                <option value="bot" ${slot.kind === 'bot' ? 'selected' : ''}>Бот</option>
              </select>
              <select data-slot="${i}" class="ctl-diff" ${slot.kind !== 'bot' ? 'style="display:none"' : ''}>
                <option value="easy" ${slot.difficulty === 'easy' ? 'selected' : ''}>Легко</option>
                <option value="medium" ${slot.difficulty === 'medium' ? 'selected' : ''}>Средне</option>
                <option value="hard" ${slot.difficulty === 'hard' ? 'selected' : ''}>Сложно</option>
              </select>
              <button class="ctl-remove" data-slot="${i}">УБРАТЬ</button>
            </div>
          `;
        } else if (inMatch && slot.kind === 'bot') {
          hostCtl = `
            <div class="slot-host-controls">
              <select data-slot="${i}" class="ctl-kind">
                <option value="bot" selected>Бот</option>
                <option value="human">Игрок (освободить)</option>
              </select>
              <select data-slot="${i}" class="ctl-diff">
                <option value="easy" ${slot.difficulty === 'easy' ? 'selected' : ''}>Легко</option>
                <option value="medium" ${slot.difficulty === 'medium' ? 'selected' : ''}>Средне</option>
                <option value="hard" ${slot.difficulty === 'hard' ? 'selected' : ''}>Сложно</option>
              </select>
            </div>
          `;
        }
      }

      return `<div class="room-slot ${slot.player ? '' : 'empty-slot'}">${inner}${hostCtl}</div>`;
    }).join('');

    // Обработчики
    this.roomSlotsEl.querySelectorAll('.slot-claim').forEach(btn => {
      btn.addEventListener('click', () => {
        window.network.claimSlot(parseInt(btn.dataset.slot, 10), this.selectedColorIdx);
      });
    });

    this.roomSlotsEl.querySelectorAll('.ctl-kick').forEach(btn => {
      btn.addEventListener('click', () => {
        window.network.kickSlot(parseInt(btn.dataset.slot, 10));
      });
    });

    this.roomSlotsEl.querySelectorAll('.ctl-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        window.network.removeSlot(parseInt(btn.dataset.slot, 10));
      });
    });

    this.roomSlotsEl.querySelectorAll('.ctl-kind').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = parseInt(sel.dataset.slot, 10);
        const diffSel = this.roomSlotsEl.querySelector(`.ctl-diff[data-slot="${idx}"]`);
        window.network.setSlot(idx, sel.value, diffSel ? diffSel.value : 'easy');
      });
    });

    this.roomSlotsEl.querySelectorAll('.ctl-diff').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = parseInt(sel.dataset.slot, 10);
        window.network.setSlot(idx, 'bot', sel.value);
      });
    });
  }

  // ============================================
  // ИГРА
  // ============================================

  handleMatchStart(data) {
    this.players = {};
    (data.players || []).forEach(p => {
      this.players[p.id] = { ...p, angle: 90, power: 70 };
    });

    this.maxRounds = data.rounds || 5;
    this.round = 0;
    this.money = this.players[window.network.playerId]?.money ?? 500;
    this.inventory = { baby_missile: Infinity };
    this.activeWeaponId = 'baby_missile';

    this.updateMoneyDisplay();
    this.updatePlayersList();
    this.updateInventoryDisplay();
    this.setupShop();
    this.showGameScreen();
    this.showMessage('Матч начался!');
    window.inputHandler.reset();
  }

  restoreGameFromSnapshot(snap) {
    this.players = {};
    (snap.players || []).forEach(p => {
      this.players[p.id] = { ...p };
    });
    this.round = snap.round || 0;
    this.maxRounds = snap.maxRounds || 5;

    const me = this.players[window.network.playerId];
    this.money = me ? me.money : 500;

    this.updateMoneyDisplay();
    this.updatePlayersList();
    this.setupShop();
    this.showGameScreen();

    if (snap.currentPlayerId) {
      this.handleTurnStart({
        playerId: snap.currentPlayerId,
        timeRemaining: snap.timeRemaining,
        wind: snap.wind
      });
    }
  }

  handleRoundStart(data) {
    this.round = data.round || 0;
    this.maxRounds = data.maxRounds || this.maxRounds;

    (data.players || []).forEach(p => {
      this.players[p.id] = { ...this.players[p.id], ...p };
    });

    if (this.windValue) this.windValue.textContent = (data.wind || 0).toFixed(1);
    this.updatePlayersList();
    this.updateInventoryDisplay();
    this.updateRoundDisplay();
    this.interroundOverlay.classList.remove('visible');
    this.showMessage(`Раунд ${this.round}/${this.maxRounds}. Ветер: ${(data.wind || 0).toFixed(1)}`);
  }

  handleTurnStart(data) {
    this.currentPlayerId = data.playerId;
    this.isMyTurn = data.playerId === window.network.playerId;

    const player = this.players[data.playerId];
    if (this.currentPlayerEl) {
      const label = player ? player.name : '...';
      this.currentPlayerEl.textContent = this.isMyTurn ? '► ВАШ ХОД ◄' : `Ход: ${label}${player?.isBot ? ' (бот)' : ''}`;
      this.currentPlayerEl.classList.toggle('my-turn', this.isMyTurn);
    }

    if (data.wind !== undefined && this.windValue) {
      this.windValue.textContent = data.wind.toFixed(1);
    }

    const ih = window.inputHandler;
    if (ih && this.isMyTurn && player) {
      ih.setAngle(player.angle ?? 90);
      ih.setPower(player.power ?? 70);
    }

    this.startTimer(data.timeRemaining);
    this.updatePlayersList();
  }

  handleTurnTimeout(data) {
    const p = this.players[data.playerId];
    if (p) this.showMessage(`${p.name}: время вышло, ход пропущен`);
  }

  startTimer(timeMs) {
    if (this.timerInterval) clearInterval(this.timerInterval);

    let timeLeft = Math.max(0, Math.ceil((timeMs || 0) / 1000));

    const render = () => {
      if (this.timeValue) this.timeValue.textContent = timeLeft;
      if (this.timerEl) this.timerEl.classList.toggle('low', timeLeft <= 10);
    };
    render();

    this.timerInterval = setInterval(() => {
      timeLeft = Math.max(0, timeLeft - 1);
      render();
      if (timeLeft <= 0) clearInterval(this.timerInterval);
    }, 1000);
  }

  handlePlayersUpdate(data) {
    (data.players || []).forEach(p => {
      this.players[p.id] = { ...this.players[p.id], ...p };
    });

    const me = this.players[window.network.playerId];
    if (me && me.money !== undefined) {
      this.money = me.money;
      this.updateMoneyDisplay();
      this.setupShopRefresh();
    }

    this.updatePlayersList();
  }

  handleMoneyUpdate(data) {
    if (data.playerId === window.network.playerId && data.amount > 0) {
      const reasons = {
        terrain: 'разрушение грунта', damage: 'урон', kill: 'убийство', round_win: 'бонус за раунд'
      };
      this.showMessage(`+$${data.amount} — ${reasons[data.reason] || data.reason}`);
    }
  }

  handleDeath(data) {
    const p = this.players[data.playerId];
    const killer = data.killerId ? this.players[data.killerId] : null;
    if (p) {
      this.showMessage(
        data.cause === 'fall'
          ? `${p.name} разбился при падении!${killer ? ' Сбросил: ' + killer.name : ''}`
          : `${p.name} уничтожен${killer ? ' (' + killer.name + ')' : ''}`
      );
    }
  }

  handleRoundEnd(data) {
    const winner = data.winnerId ? this.players[data.winnerId] : null;
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.interroundTitle.textContent = winner ? `РАУНД ${data.round} — ПОБЕДА` : `РАУНД ${data.round} — ВСЕ УНИЧТОЖЕНЫ`;
    this.interroundWinner.textContent = winner ? `${winner.name} получает бонус за раунд` : '';
    this.interroundOverlay.classList.add('visible');
  }

  handleInterRound(data) {
    const isHost = this.roomState && this.roomState.hostId === window.network.playerId;
    const myId = window.network.playerId;

    this.interroundSlots.innerHTML = (this.roomState?.slots || []).map((slot, i) => {
      const who = slot.player
        ? escapeHtml(slot.player.name)
        : (slot.kind === 'human' ? 'свободно' : 'бот');
      let ctl = '';

      if (isHost && data.canEditSlots && slot.kind === 'bot') {
        ctl = `
          <select data-slot="${i}" class="ir-ctl-kind">
            <option value="bot" selected>Бот</option>
            <option value="human">Игрок</option>
          </select>
          <select data-slot="${i}" class="ir-ctl-diff">
            <option value="easy" ${slot.difficulty === 'easy' ? 'selected' : ''}>Легко</option>
            <option value="medium" ${slot.difficulty === 'medium' ? 'selected' : ''}>Средне</option>
            <option value="hard" ${slot.difficulty === 'hard' ? 'selected' : ''}>Сложно</option>
          </select>
        `;
      }

      return `<div class="room-slot">
        <div class="slot-top">
          <div class="slot-color" style="background:${slot.color}"></div>
          <span class="slot-name">${who}</span>
          <span class="slot-kind">${slot.kind === 'human' ? 'ИГРОК' : 'БОТ'}</span>
        </div>
        <div class="slot-host-controls">${ctl}</div>
      </div>`;
    }).join('');

    this.interroundSlots.querySelectorAll('.ir-ctl-kind').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = parseInt(sel.dataset.slot, 10);
        window.network.setSlot(idx, sel.value, 'easy');
      });
    });
    this.interroundSlots.querySelectorAll('.ir-ctl-diff').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = parseInt(sel.dataset.slot, 10);
        window.network.setSlot(idx, 'bot', sel.value);
      });
    });

    this.interroundHint.textContent = data.isLastRound
      ? 'Финальная таблица результатов...'
      : (isHost ? 'Хост: можно заменить ботов на игроков или сменить сложность' : 'Следующий раунд скоро...');

    // Обратный отсчет
    let left = Math.ceil((data.nextRoundIn || 20000) / 1000);
    this.interroundCountdown.textContent = left;
    if (this.interroundInterval) clearInterval(this.interroundInterval);
    this.interroundInterval = setInterval(() => {
      left--;
      if (left <= 0) {
        clearInterval(this.interroundInterval);
        return;
      }
      this.interroundCountdown.textContent = left;
    }, 1000);
  }

  handleMatchEnd(data) {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.interroundInterval) clearInterval(this.interroundInterval);
    this.interroundOverlay.classList.remove('visible');

    // Места считает сервер: раунды важнее фрагов, фраги важнее денег
    const scores = [...(data.finalScores || [])].sort((a, b) => (a.place || 99) - (b.place || 99));

    this.showMatchResults(scores);

    // Рейтинг мог измениться — обновляем профиль к возврату на экран входа
    window.network.fetchMe().then(me => {
      if (me) this.showProfile(me.user, me.stats, me.matches);
    });
  }

  handleMatchReset() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.interroundInterval) clearInterval(this.interroundInterval);

    this.currentPlayerId = null;
    this.isMyTurn = false;
    document.getElementById('match-overlay')?.remove();
    this.interroundOverlay.classList.remove('visible');

    this.showRoomScreen();
    this.showMessage('Матч завершен. Можно изменить состав и начать новый');
  }

  // ============================================
  // МАГАЗИН / ИНВЕНТАРЬ / СПИСКИ
  // ============================================

  openShop() {
    if (!this.shopModal) return;
    if (window.network.isSpectator()) return;
    this.shopModal.classList.add('visible');
    this.updateShopDisplay();
    window.sound?.click();
  }

  closeShop() {
    this.shopModal?.classList.remove('visible');
  }

  setupShop() {
    if (!this.shopGrid) return;
    if (window.network.isSpectator()) return;

    const weapons = Object.values(window.WEAPONS || {}).filter(w => !w.infinite);

    this.shopGrid.innerHTML = weapons.map(weapon => {
      const pack = weapon.packSize ? `<span class="card-pack">×${weapon.packSize} за покупку</span>` : '';
      const desc = weapon.effect === 'add_earth'
        ? 'Создает холм земли: закопать себя или поставить стену врагу'
        : weapon.effect === 'smoke'
          ? 'Пристрелочный дым: без урона и кратера, след остается до следующего выстрела'
          : `Урон: ${weapon.damage} · Радиус: ${weapon.radius}`;

      return `
        <div class="shop-card" data-weapon="${weapon.id}">
          <div class="card-top">
            <span class="card-name">${weapon.name} ${pack}</span>
            <span class="card-price">$${weapon.price}</span>
          </div>
          <div class="card-desc">${desc}</div>
          <div class="card-owned" data-owned="${weapon.id}">в наличии: 0</div>
          <button class="card-buy" data-buy="${weapon.id}">КУПИТЬ</button>
        </div>
      `;
    }).join('');

    this.shopGrid.querySelectorAll('.card-buy').forEach(btn => {
      btn.addEventListener('click', () => {
        const weapon = window.WEAPONS[btn.dataset.buy];
        if (weapon && weapon.price <= this.money) {
          window.network.buyWeapon(btn.dataset.buy);
          window.sound?.coin();
        }
      });
    });

    this.updateShopDisplay();
  }

  updateShopDisplay() {
    if (!this.shopGrid) return;

    if (this.shopMoney) this.shopMoney.textContent = '$' + this.money;

    this.shopGrid.querySelectorAll('.shop-card').forEach(card => {
      const weapon = window.WEAPONS[card.dataset.weapon];
      if (!weapon) return;
      const owned = this.inventory[weapon.id] || 0;
      card.classList.toggle('too-expensive', weapon.price > this.money);

      const ownedEl = card.querySelector(`[data-owned="${weapon.id}"]`);
      if (ownedEl) ownedEl.textContent = `в наличии: ${owned}`;
    });
  }

  setupShopRefresh() {
    this.updateShopDisplay();
  }

  updateInventoryDisplay() {
    if (!this.inventoryList) return;

    const weapons = window.WEAPONS || {};

    const items = Object.entries(this.inventory).map(([weaponId, count]) => {
      const weapon = weapons[weaponId];
      if (!weapon) return '';

      const countText = weapon.infinite ? '∞' : String(count);
      const isActive = weaponId === this.activeWeaponId ? 'active' : '';
      const isOutOfStock = !weapon.infinite && !(count > 0) ? 'out-of-stock' : '';

      return `
        <div class="inventory-item ${isActive} ${isOutOfStock}" data-weapon="${weaponId}">
          <span class="weapon-name">${weapon.name}</span>
          <span class="weapon-count">${countText}</span>
        </div>
      `;
    }).filter(Boolean).join('');

    this.inventoryList.innerHTML = items;

    this.inventoryList.querySelectorAll('.inventory-item').forEach(item => {
      item.addEventListener('click', () => {
        if (item.classList.contains('out-of-stock')) return;
        this.activeWeaponId = item.dataset.weapon;
        window.network.selectWeapon(this.activeWeaponId);
        this.updateInventoryDisplay();
      });
    });
  }

  getActiveWeapon() {
    const weapons = window.WEAPONS || {};
    const active = this.inventory[this.activeWeaponId];
    if (this.activeWeaponId && (active > 0 || weapons[this.activeWeaponId]?.infinite)) {
      return this.activeWeaponId;
    }
    for (const [weaponId, count] of Object.entries(this.inventory)) {
      if (count > 0 || weapons[weaponId]?.infinite) return weaponId;
    }
    return 'baby_missile';
  }

  updatePlayersList() {
    if (!this.playersList) return;

    const myId = window.network.playerId;

    const items = Object.values(this.players).map(p => {
      const isCurrent = p.id === this.currentPlayerId ? 'current' : '';
      const isAlive = p.isAlive ? 'alive' : 'dead';
      const offline = p.connected === false ? 'offline' : '';
      const isBot = p.isBot ? 'bot-item' : '';
      const isMe = p.id === myId ? ' (вы)' : '';
      const color = window.CONSTANTS.PALETTE[p.colorIdx]?.css || '#ffffff';
      // Гость не влияет на рейтинг — помечаем явно
      const guestTag = p.isGuest && !p.isBot ? '<span class="p-guest" title="Играет без аккаунта">гость</span>' : '';

      return `
        <div class="player-item ${isCurrent} ${isAlive} ${offline} ${isBot}">
          <div class="p-color" style="background:${color}"></div>
          <span class="p-name">${escapeHtml(p.name || 'Игрок')}${isMe}${guestTag}</span>
          <span class="player-hp">${p.hp}</span>
          <span class="player-money">$${p.money}</span>
        </div>
      `;
    }).join('');

    this.playersList.innerHTML = items;
    this.updateRoundDisplay();
  }

  updateRoundDisplay() {
    if (this.roundDisplay) {
      this.roundDisplay.textContent = this.round > 0 ? `РАУНД ${this.round}/${this.maxRounds}` : '';
    }
  }

  updateMoneyDisplay() {
    if (this.moneyValue) this.moneyValue.textContent = this.money;
  }

  showMessage(text) {
    if (!this.messageText || !this.messagePanel) return;
    this.messageText.textContent = text;
    this.messagePanel.classList.add('visible');

    if (this.messageTimeout) clearTimeout(this.messageTimeout);
    this.messageTimeout = setTimeout(() => {
      this.messagePanel.classList.remove('visible');
    }, 3000);
  }

  showMatchResults(scores) {
    document.getElementById('match-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'match-overlay';
    overlay.className = 'visible';

    overlay.innerHTML = `
      <div id="match-results">
        <h1>МАТЧ ЗАВЕРШЕН</h1>
        ${scores.map(s => {
          const tag = s.isBot ? ' [бот]' : (s.isGuest ? ' [гость]' : '');
          return `
            <div class="stat-row ${s.won ? 'winner-highlight' : ''}">
              <span>${s.place || '-'}. ${escapeHtml(s.name)}${tag}</span>
              <span>Раундов: ${s.roundWins || 0}</span>
              <span>Убийств: ${s.kills}</span>
              <span>$${s.totalEarned}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;

    document.body.appendChild(overlay);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

window.UIScene = UIScene;
