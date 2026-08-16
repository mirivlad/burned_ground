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

    this.showEntryScreen();
    this.renderColorPicker();
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

    // Комната
    this.roomScreen = document.getElementById('room-screen');
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
    this.shopItems = document.getElementById('shop-items');
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
        if (snap && snap.status === 'playing') {
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
      if (snap && snap.status === 'playing') {
        this.restoreGameFromSnapshot(snap);
      }
    });

    net.on('room_state', (d) => this.applyRoomState(d));
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
    // ==== Вход ====
    document.getElementById('btn-create').addEventListener('click', () => {
      const name = this.entryName.value.trim();
      if (!name) { this.entryName.focus(); return; }
      window.network.createRoom(name, this.selectedColorIdx);
    });

    document.getElementById('btn-join').addEventListener('click', () => {
      const name = this.entryName.value.trim();
      const code = this.entryCode.value.trim().toUpperCase();
      if (!name || !code) return;
      window.network.joinRoom(code, name, this.selectedColorIdx, false);
    });

    document.getElementById('btn-spectate').addEventListener('click', () => {
      const name = this.entryName.value.trim();
      const code = this.entryCode.value.trim().toUpperCase();
      if (!name || !code) return;
      window.network.joinRoom(code, name, this.selectedColorIdx, true);
    });

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

    // ==== Выстрел ====
    window.inputHandler.setOnFireCallback((angle, power) => {
      if (this.isMyTurn) {
        window.network.fire(angle, power, this.getActiveWeapon());
      } else if (this.currentPlayerId) {
        this.showMessage('Сейчас не ваш ход');
      }
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
          <div class="slot-kind">${slot.player.isBot ? 'БОТ' : 'ИГРОК'}${slot.player.connected === false ? ' · ОФФЛАЙН' : ''}</div>
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
        if (!inMatch && !slot.player) {
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
          ? `${p.name} разбился при падении!`
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

    const scores = [...(data.finalScores || [])].sort((a, b) =>
      (b.kills * 1000 + b.totalEarned) - (a.kills * 1000 + a.totalEarned)
    );

    this.showMatchResults(scores);
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

  setupShop() {
    if (!this.shopItems) return;
    if (window.network.isSpectator()) return;

    const weapons = Object.values(window.WEAPONS || {}).filter(w => !w.infinite);

    this.shopItems.innerHTML = weapons.map(weapon => `
      <div class="shop-item ${weapon.price > this.money ? 'too-expensive' : ''}" data-weapon="${weapon.id}">
        <div class="shop-item-header">
          <span class="shop-item-name">${weapon.name}</span>
          <span class="shop-item-price">$${weapon.price}</span>
        </div>
        <div class="shop-item-desc">
          ${weapon.effect === 'add_earth' ? 'создает холм земли' : `Урон: ${weapon.damage}, Радиус: ${weapon.radius}`}
        </div>
      </div>
    `).join('');

    this.shopItems.querySelectorAll('.shop-item').forEach(item => {
      item.addEventListener('click', () => {
        if (item.classList.contains('too-expensive')) return;
        window.network.buyWeapon(item.dataset.weapon);
      });
    });
  }

  setupShopRefresh() {
    this.shopItems?.querySelectorAll('.shop-item').forEach(item => {
      const weapon = window.WEAPONS[item.dataset.weapon];
      if (weapon) item.classList.toggle('too-expensive', weapon.price > this.money);
    });
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

      return `
        <div class="player-item ${isCurrent} ${isAlive} ${offline} ${isBot}">
          <div class="p-color" style="background:${color}"></div>
          <span class="p-name">${escapeHtml(p.name || 'Игрок')}${isMe}</span>
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
        ${scores.map((s, i) => `
          <div class="stat-row ${i === 0 ? 'winner-highlight' : ''}">
            <span>${i + 1}. ${escapeHtml(s.name)}${s.isBot ? ' [бот]' : ''}</span>
            <span>Убийств: ${s.kills}</span>
            <span>$${s.totalEarned}</span>
          </div>
        `).join('')}
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
