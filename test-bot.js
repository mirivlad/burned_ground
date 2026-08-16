/**
 * Тестовый клиент для комнатного протокола.
 *
 *   node test-bot.js <код> <имя> [spectator|player]   - вход в комнату
 *   node test-bot.js <код> <имя> rejoin               - реконнект по сохраненному id
 *   stdin-команды: fire <angle> <power> [weaponId] | buy <id> | claim | state
 */
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

const code = (process.argv[2] || '').toUpperCase();
const name = process.argv[3] || 'Гость';
const mode = process.argv[4] || 'player';

const STATE_FILE = path.join(__dirname, '.bot-state.json');
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};

const socket = io('http://localhost:3000', { reconnection: false });
const log = (...a) => console.log(`[${name}]`, ...a);

socket.on('connect', () => {
  log('connected');
  if (mode === 'rejoin' && state.playerId) {
    socket.emit('rejoin', { roomId: code, playerId: state.playerId });
    return;
  }
  socket.emit('join_room', {
    roomId: code,
    playerName: name,
    asSpectator: mode === 'spectator'
  });
});

socket.on('joined_room', (d) => {
  log('joined_room:', d.playerId ? 'участник ' + d.playerId : 'ЗРИТЕЛЬ');
  if (d.playerId) {
    state.playerId = d.playerId;
    state.roomId = code;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  }
  if (d.room) log('room:', d.room.phase, 'slots:', d.room.slots.length);
});

socket.on('rejoin_result', (d) => log('rejoin_result:', d.ok ? 'OK' : JSON.stringify(d)));
socket.on('room_created', (d) => log('room_created:', d.roomId));
socket.on('room_state', (d) => {
  log('room_state:', d.phase,
    'slots:', d.slots.map(s => s.kind[0] + (s.player ? '(' + s.player.name + (s.player.isBot ? '/бот' : '') + ')' : '(пусто)')).join(' '),
    'зрителей:', d.spectators.length);
});
socket.on('game_snapshot', (d) => log('game_snapshot: round', d.round, 'tanks', d.tanks?.length));
socket.on('error', (d) => log('error:', d.message));
socket.on('join_failed', (d) => log('join_failed:', d.reason));

socket.on('round_start', (d) => {
  log('round_start: round', d.round, 'wind', d.wind,
    'tanks:', d.tanks.map(t => t.playerId.slice(0, 5) + '@' + Math.round(t.x)).join(' '));
});
socket.on('turn_start', (d) => {
  log('turn_start:', d.playerId.slice(0, 5), d.playerId === state.playerId ? '(МОЙ ХОД)' : '');
});
socket.on('shot', (d) => log('shot:', d.playerId.slice(0, 5), 'a' + Math.round(d.angle), 'p' + Math.round(d.power), d.weaponId));
socket.on('explosion', (d) => log('explosion:', Math.round(d.x), Math.round(d.y), 'r' + d.radius,
  'dmg:', (d.damages || []).map(x => x.playerId.slice(0, 5) + ':' + x.damage).join(','), 'terrain:', d.terrainDiff));
socket.on('terrain_update', () => {}); // молча
socket.on('tank_update', () => {});
socket.on('players_update', (d) => {
  log('players:', d.players.map(p => p.name + '[' + p.hp + 'hp' + (p.isBot ? ',бот' : '') + ']').join(' '));
});
socket.on('hp_update', (d) => log('hp_update:', d.playerId.slice(0, 5), d.hp, '(-' + d.damage + ')'));
socket.on('death', (d) => log('DEATH:', d.playerId.slice(0, 5), 'cause:', d.cause));
socket.on('fall_damage', (d) => log('fall_damage:', d.playerId.slice(0, 5), Math.round(d.distance) + 'px ->', d.damage, 'dmg'));
socket.on('money_update', (d) => log('money:', d.playerId.slice(0, 5), d.amount, d.reason));
socket.on('round_end', (d) => log('round_end: round', d.round, 'winner:', d.winnerId ? d.winnerId.slice(0, 5) : 'нет'));
socket.on('inter_round', (d) => log('inter_round: next in', Math.round(d.nextRoundIn / 1000) + 's', 'last:', d.isLastRound));
socket.on('match_end', (d) => log('MATCH_END:', JSON.stringify(d.finalScores)));
socket.on('match_reset', () => log('match_reset'));
socket.on('room_launched', () => log('room_launched'));
socket.on('host_changed', (d) => log('host_changed:', d.hostId.slice(0, 5)));
socket.on('player_disconnected', (d) => log('player_disconnected:', d.name));
socket.on('turn_timeout', (d) => log('turn_timeout:', d.playerId.slice(0, 5)));
socket.on('disconnect', (r) => log('disconnected:', r));

// stdin команды
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const [cmd, a, p, w] = line.trim().split(/\s+/);
  if (cmd === 'fire') {
    socket.emit('fire', { angle: +a || 90, power: +p || 70, weaponId: w || 'baby_missile' });
  } else if (cmd === 'buy') {
    socket.emit('buy_weapon', { weaponId: a });
  } else if (cmd === 'claim') {
    socket.emit('claim_slot', {});
  } else if (cmd === 'state') {
    log('state:', JSON.stringify(state));
  }
});

log('started: room', code, 'as', mode);
