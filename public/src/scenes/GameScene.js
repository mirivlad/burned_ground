/**
 * GameScene — игровое поле: ландшафт, танки, снаряды, взрывы.
 * Логика авторитетна на сервере; сцена отрисовывает события комнаты.
 */

// Порядок отрисовки: небо -> танки -> грунт -> эффекты -> интерфейс.
// Грунт выше танков, чтобы засыпанная землей машина скрывалась под ней.
const DEPTH = { sky: -10, tanks: 0, terrain: 1, effects: 6, hud: 8 };

class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });

    this.tanks = {};          // playerId -> Tank
    this.wrecks = {};         // playerId -> Tank (остов убитого, живет до конца раунда)
    this.activeShots = [];    // снаряды в полете: позиция считается по времени в update()
    this.terrain = null;
    this.sky = null;
    this.players = {};        // id -> player info (с colorIdx)
    this.currentPlayerId = null;
    this.wind = 0;
    this.round = 0;
  }

  create() {
    const net = window.network;

    net.on('round_start', (d) => this.handleRoundStart(d));
    net.on('game_snapshot', (d) => this.handleGameSnapshot(d));
    net.on('special_update', (d) => {
      // Roller/Napalm: путь приходит в момент приземления снаряда
      if (d && d.special) {
        this.pendingSpecial = { ...(this.pendingSpecial || {}), ...d.special };
      }
    });
    // При реконнекте снапшот приходит внутри rejoin_result
    net.on('rejoin_result', (d) => {
      if (d && d.ok && d.snapshot) this.handleGameSnapshot(d.snapshot);
    });
    net.on('turn_start', (d) => this.handleTurnStart(d));
    net.on('shot', (d) => this.handleShot(d));
    net.on('explosion', (d) => this.handleExplosion(d));
    net.on('terrain_update', (d) => this.handleTerrainUpdate(d));
    net.on('tank_update', (d) => this.handleTankUpdate(d));
    net.on('players_update', (d) => this.handlePlayersUpdate(d));
    net.on('hp_update', (d) => this.handleHpUpdate(d));
    net.on('shield_up', (d) => this.handleShieldUp(d));
    net.on('shield_hit', (d) => this.handleShieldHit(d));
    net.on('parachute_used', (d) => this.handleParachute(d));
    net.on('fall_damage', (d) => this.handleFallDamage(d));
    net.on('death', (d) => this.handleDeath(d));
    net.on('round_end', () => {
      Object.values(this.tanks).forEach(t => t.setCurrent(false));
    });
    net.on('match_reset', () => this.clearObjects());
  }

  colorOf(playerId) {
    const p = this.players[playerId];
    const idx = p ? p.colorIdx : 0;
    return (window.CONSTANTS.PALETTE[idx] || window.CONSTANTS.PALETTE[0]).hex;
  }

  // ==== События ====

  // Тема неба раунда выводится из seed ландшафта
  themeForSeed(seed) {
    return ['day', 'sunset', 'night'][Math.abs(seed | 0) % 3];
  }

  /**
   * Индикатор ветра: стрелка вверху в центре канваса.
   * Длина пропорциональна силе, направление — куда сносит снаряды.
   */
  drawWindIndicator(wind) {
    if (this.windGfx) this.windGfx.destroy();
    if (this.windText) this.windText.destroy();

    const W = window.CONSTANTS.MAP_WIDTH;
    // Шкала — из настроек комнаты: хост мог задать свой предел ветра
    const maxWind = this.maxWind || window.CONSTANTS.GAME.maxWind;
    const cx = W / 2;
    const y = 25;
    const len = Math.round((Math.abs(wind) / maxWind) * 55);

    this.windGfx = this.add.graphics();
    this.windGfx.setDepth(DEPTH.hud);
    this.windGfx.fillStyle(0x001006, 0.82);
    this.windGfx.fillRect(cx - 120, y - 16, 240, 54);
    this.windGfx.lineStyle(1, 0x66ff66, 0.75);
    this.windGfx.strokeRect(cx - 120, y - 16, 240, 54);

    if (Math.abs(wind) < 0.05) {
      // Штиль — точка
      this.windGfx.fillStyle(0xffffff, 0.9);
      this.windGfx.fillCircle(cx, y, 3);
    } else {
      const dir = wind > 0 ? 1 : -1;   // ветер > 0 сносит вправо
      const color = Math.abs(wind) > maxWind * 0.66 ? 0xff5555 : 0xffffff;

      this.windGfx.lineStyle(3, color, 1);
      this.windGfx.beginPath();
      this.windGfx.moveTo(cx - dir * len, y);
      this.windGfx.lineTo(cx + dir * len, y);
      this.windGfx.strokePath();

      // Наконечник стрелки
      this.windGfx.beginPath();
      this.windGfx.moveTo(cx + dir * len, y);
      this.windGfx.lineTo(cx + dir * (len - 8), y - 5);
      this.windGfx.lineTo(cx + dir * (len - 8), y + 5);
      this.windGfx.closePath();
      this.windGfx.fillStyle(color, 1);
      this.windGfx.fillPath();
    }

    const direction = Math.abs(wind) < 0.05 ? '·' : (wind > 0 ? '→→' : '←←');
    this.windText = this.add.text(cx, y + 18, `ВЕТЕР ${direction} ${Math.abs(wind).toFixed(1)}`, {
      fontFamily: 'Courier New',
      fontSize: '14px',
      color: '#ffffcc',
      stroke: '#000000',
      strokeThickness: 2
    });
    this.windText.setOrigin(0.5);
    this.windText.setDepth(DEPTH.hud);
  }

  buildWorld({ terrainSeed, heights, tanks, players }) {
    this.clearObjects();

    if (players) {
      players.forEach(p => { this.players[p.id] = { ...this.players[p.id], ...p }; });
    }

    this.sky = new window.Sky(this, this.themeForSeed(terrainSeed || 1), terrainSeed || 1);
    this.terrain = new window.Terrain(this, heights || []);
    this.drawWindIndicator(this.wind);

    (tanks || []).forEach(tankData => {
      this.spawnTank(tankData.playerId, tankData.x, tankData.y);
    });
  }

  handleRoundStart(data) {
    const { wind, round } = data;

    this.round = round || 0;
    this.wind = wind || 0;
    this.maxWind = data.maxWind || this.maxWind;
    this.lastSeed = data.terrainSeed || 1;

    this.buildWorld(data);
  }

  handleGameSnapshot(snapshot) {
    // Зритель может зайти и в паузе между раундами — поле уже есть, показываем его
    if (!snapshot || (snapshot.status !== 'playing' && snapshot.status !== 'interRound')) return;

    this.wind = snapshot.wind || 0;
    this.round = snapshot.round || 0;
    this.lastSeed = snapshot.terrainSeed || this.lastSeed || 1;

    this.buildWorld({
      terrainSeed: this.lastSeed,
      heights: snapshot.heights,
      tanks: snapshot.tanks,
      players: snapshot.players
    });
  }

  handleTurnStart(data) {
    if (data.wind !== undefined) {
      this.wind = data.wind;
      this.drawWindIndicator(this.wind);
    }

    this.currentPlayerId = data.playerId;

    Object.entries(this.tanks).forEach(([pid, tank]) => {
      tank.setCurrent(pid === data.playerId);
    });
  }

  /**
   * Анимация снаряда по точкам, привязанная к часам сцены.
   *
   * Раньше шаг задавался через time.addEvent, но TimerEvent не может
   * сработать чаще кадра: шаг 22мс на 60fps фактически превращался в 33мс,
   * снаряд отставал в полтора раза, и взрыв успевал прогреметь до его
   * прилета. По времени позиция считается точно при любом FPS, а пропущенные
   * при просадке кадров точки дорисовываются в след, чтобы не было разрывов.
   *
   * @returns {{endsAt:number}|null}
   */
  animatePoints(points, stepMs, colorNum, radius = 3, options = {}) {
    if (!points || points.length < 2) return null;

    const dot = this.add.circle(points[0].x, points[0].y, radius, colorNum);
    dot.setDepth(DEPTH.effects);
    const shot = {
      points,
      stepMs,
      dot,
      startedAt: this.time.now,
      endsAt: this.time.now + (points.length - 1) * stepMs,
      lastIdx: 0,
      trail: options.trail || null,
      trailMode: options.trailMode || null,
      keepDot: !!options.keepDot
    };

    this.activeShots.push(shot);
    return shot;
  }

  /** Полилиния от сервера приходит плоским массивом [x,y,x,y,...] */
  animatePolyline(flat, stepMs, colorNum, radius = 3, options = {}) {
    if (!flat || flat.length < 4) return null;

    const points = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      points.push({ x: flat[i], y: flat[i + 1] });
    }

    return this.animatePoints(points, stepMs, colorNum, radius, options);
  }

  update(time) {
    if (!this.activeShots || this.activeShots.length === 0) return;

    for (let i = this.activeShots.length - 1; i >= 0; i--) {
      const shot = this.activeShots[i];
      const last = shot.points.length - 1;
      const idx = Math.min(last, Math.max(0, Math.floor((time - shot.startedAt) / shot.stepMs)));

      if (shot.trail) {
        for (let k = shot.lastIdx + 1; k <= idx; k++) {
          const p = shot.points[k];
          if (shot.trailMode === 'smoke') {
            if (k % 5 !== 0) continue;
            shot.trail.fillStyle(0xcccccc, 0.85);
            shot.trail.fillCircle(p.x, p.y, 2);
          } else {
            shot.trail.fillStyle(0xffffff, 0.25);
            shot.trail.fillCircle(p.x, p.y, 1);
          }
        }
      }

      shot.lastIdx = idx;
      shot.dot.setPosition(shot.points[idx].x, shot.points[idx].y);

      if (idx >= last) {
        if (shot.trailMode === 'smoke' && shot.trail) {
          // Отметка точки падения остается до следующего выстрела
          shot.trail.fillStyle(0xffffff, 0.9);
          shot.trail.fillCircle(shot.points[last].x, shot.points[last].y, 3);
        }
        if (!shot.keepDot) shot.dot.destroy();
        this.activeShots.splice(i, 1);
      }
    }
  }

  /**
   * Ждет появления поля в this.pendingSpecial (путь приходит отдельным событием),
   * затем запускает анимацию качения/растекания.
   */
  waitForSpecialPath(field, onReady, attempts = 60) {
    if (this.pendingSpecial && this.pendingSpecial[field]) {
      onReady(this.pendingSpecial[field]);
      return;
    }
    if (attempts <= 0) return;
    this.time.delayedCall(50, () => this.waitForSpecialPath(field, onReady, attempts - 1));
  }

  handleShot(data) {
    const { playerId, angle, power, wind, startX, startY, weaponId, special } = data;

    const tank = this.tanks[playerId];
    if (tank) {
      tank.setAngle(angle);
      tank.flash();
    }

    if (this.players[playerId]) this.players[playerId].angle = angle;

    const weapon = window.WEAPONS[weaponId] || {};
    const colorNum = Phaser.Display.Color.HexStringToColor(weapon.color || '#ffffff').color;

    if (this.aimTrail) {
      // Новый выстрел убирает пристрелочный след
      this.aimTrail.destroy();
      this.aimTrail = null;
    }

    // ==== Спец-оружие: анимация по полилиниям сервера ====
    if (special) {
      this.pendingSpecial = { ...special };
      window.sound.shot();

      const mainMs = special.stepMs || 30;
      // Длительность основного полета — та же, что отсчитывает сервер
      const mainPoints = Math.max(2, special.main.length / 2);
      const serverMainMs = Number(data.flightMs);
      const mainDoneMs = Number.isFinite(serverMainMs) && serverMainMs > 0
        ? serverMainMs
        : window.SharedPhysics.projectileFlightMs(mainPoints);
      const flightStep = mainDoneMs / (mainPoints - 1);

      // Спец-оружие тоже не должно взрываться раньше прилета
      this.projectileImpactAt = this.time.now + mainDoneMs;

      if (special.type === 'mirv') {
        this.animatePolyline(special.main, flightStep, colorNum);

        this.time.delayedCall(mainDoneMs + 50, () => {
          // Распад: три боеголовки
          for (const w of special.warheads) {
            this.animatePolyline(w, mainMs, colorNum, 2);
          }
        });
      } else if (special.type === 'roller') {
        this.animatePolyline(special.main, flightStep, colorNum);

        this.time.delayedCall(mainDoneMs + 100, () => {
          this.waitForSpecialPath('path', (path) => {
            // Шар катится по склону
            this.animatePolyline(path, mainMs, colorNum, 4);
          });
        });
      } else if (special.type === 'napalm') {
        this.animatePolyline(special.main, flightStep, colorNum);

        this.time.delayedCall(mainDoneMs + 100, () => {
          this.waitForSpecialPath('flows', (flows) => {
            for (const flow of flows) {
              // Огненные точки стекают по склону
              this.animatePolyline(flow, mainMs * 2, 0xff5522, 3);
            }
          });
        });
      }
      return;
    }

    // ==== Обычный снаряд: локальный пересчет траектории ====
    const heights = this.terrain ? this.terrain.heights : null;
    const trajectory = window.SharedPhysics.calculateProjectileTrajectory({
      startX, startY, angle, power, wind, heights
    });

    if (!trajectory || trajectory.length < 2) return;

    const isSmoke = weaponId === 'smoke_tracer';

    if (isSmoke) { this.aimTrail = this.add.graphics(); this.aimTrail.setDepth(DEPTH.effects); }

    const trail = isSmoke ? this.aimTrail : this.add.graphics();
    trail.setDepth(DEPTH.effects);

    // Длительность берем из события сервера: он же по ней отсчитывает момент
    // попадания. Локальная траектория может отличаться на точку-другую, если
    // рельеф у клиента на обновление отстает — тогда взрыв разъезжался с полетом.
    const steps = Math.max(1, trajectory.length - 1);
    const serverMs = Number(data.flightMs);
    const stepMs = Number.isFinite(serverMs) && serverMs > 0
      ? serverMs / steps
      : window.CONSTANTS.PHYSICS.projectileStepMs;

    const shot = this.animatePoints(trajectory, stepMs, colorNum, 3, {
      trail,
      trailMode: isSmoke ? 'smoke' : 'thin'
    });

    // Момент прилета: до него взрыв не показываем, даже если событие уже пришло
    this.projectileImpactAt = shot ? shot.endsAt : this.time.now;

    if (isSmoke) {
      window.sound.smoke();
    } else {
      window.sound.shot();
      window.sound.projectileFlight(this.projectileImpactAt - this.time.now);
    }
  }

  handleExplosion(data) {
    const waitMs = Math.max(0, (this.projectileImpactAt || 0) - this.time.now);
    if (waitMs > 0) {
      this.time.delayedCall(waitMs, () => this.handleExplosion(data));
      return;
    }
    this.projectileImpactAt = 0;
    const { x, y, radius, weaponId, damages } = data;
    const weapon = window.WEAPONS[weaponId] || {};
    const isDirt = weapon.effect === 'add_earth';
    const r = Math.max(radius, 10);

    if (isDirt) {
      // Холм земли: коричневое пятно + комья
      const blob = this.add.circle(x, y, 2, 0x8b5a2b);
      blob.setDepth(DEPTH.effects);
      this.tweens.add({
        targets: blob,
        radius: r,
        alpha: 0,
        duration: 700,
        ease: 'Power1',
        onComplete: () => blob.destroy()
      });
      this.spawnDebris(x, y, r, 0x8b5a2b, 10);
      return;
    }

    // Классический взрыв: расширяющиеся кольца белый -> жёлтый -> оранжевый
    const rings = [
      { color: 0xffffff, delay: 0, size: r },
      { color: 0xffe95c, delay: 90, size: r * 0.85 },
      { color: 0xff7a2a, delay: 180, size: r * 0.7 }
    ];

    rings.forEach(({ color, delay, size }) => {
      const ring = this.add.circle(x, y, 4, color);
      ring.setDepth(DEPTH.effects);
      ring.setStrokeStyle(4, color, 1);
      ring.setFillStyle();
      this.time.delayedCall(delay, () => {
        this.tweens.add({
          targets: ring,
          radius: size,
          alpha: 0,
          duration: 420 + size * 2,
          ease: 'Quad.easeOut',
          onComplete: () => ring.destroy()
        });
      });
    });

    // Ядро вспышки
    const core = this.add.circle(x, y, 3, 0xffffff);
    core.setDepth(DEPTH.effects);
    this.tweens.add({
      targets: core,
      radius: r * 0.5,
      alpha: 0,
      duration: 300,
      onComplete: () => core.destroy()
    });

    // Комья земли и дым
    this.spawnDebris(x, y, r, 0xa68b5b, 12);
    this.spawnSmoke(x, y, r);

    // Тряска камеры на крупных взрывах
    if (r >= 30) {
      this.cameras.main.shake(250 + r * 2, Math.min(0.004 + r * 0.00012, 0.015));
    }

    // Цифры урона
    (damages || []).forEach(({ playerId, damage }) => {
      const tank = this.tanks[playerId];
      if (tank && damage > 0) {
        this.showFloatingText(tank.x, tank.y - 40, `-${damage}`, '#ff4444');
      }
    });

    window.sound.explosion(radius);
  }

  spawnDebris(x, y, r, color, count) {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = r * (0.3 + Math.random() * 0.8);
      const px = x + Math.cos(ang) * dist;
      const py = y + Math.sin(ang) * dist - 10;
      const chunk = this.add.circle(px, py, 2 + Math.random() * 3, color);
      chunk.setDepth(DEPTH.effects);
      this.tweens.add({
        targets: chunk,
        y: py + 40 + Math.random() * 50,
        x: px + (Math.random() - 0.5) * 40,
        alpha: 0,
        duration: 700 + Math.random() * 700,
        ease: 'Quad.easeIn',
        onComplete: () => chunk.destroy()
      });
    }
  }

  spawnSmoke(x, y, r) {
    for (let i = 0; i < 7; i++) {
      const px = x + (Math.random() - 0.5) * r;
      const py = y + (Math.random() - 0.5) * r * 0.6;
      const puff = this.add.circle(px, py, 3 + Math.random() * 4, 0x555555);
      puff.setDepth(DEPTH.effects);
      this.tweens.add({
        targets: puff,
        y: py - 25 - Math.random() * 35,
        radius: puff.radius + 6,
        alpha: 0,
        duration: 900 + Math.random() * 700,
        onComplete: () => puff.destroy()
      });
    }
  }

  handleTerrainUpdate(data) {
    if (this.terrain && data.heights) {
      this.terrain.update(data.heights);
    }
  }

  handleTankUpdate(data) {
    const seen = new Set();

    (data.tanks || []).forEach(tankData => {
      seen.add(tankData.playerId);
      const tank = this.tanks[tankData.playerId];
      if (tank) {
        tank.setPosition(tankData.x, tankData.y);
      } else {
        this.spawnTank(tankData.playerId, tankData.x, tankData.y);
      }
    });

    Object.keys(this.tanks).forEach(pid => {
      if (!seen.has(pid)) {
        this.tanks[pid].destroy();
        delete this.tanks[pid];
      }
    });
  }

  handlePlayersUpdate(data) {
    (data.players || []).forEach(p => {
      this.players[p.id] = { ...this.players[p.id], ...p };
      const tank = this.tanks[p.id];
      if (tank) {
        tank.setHp(p.hp);
        tank.setShield(p.shield || 0);
        tank.setAlive(p.isAlive);
      }
    });
  }

  handleHpUpdate(data) {
    const tank = this.tanks[data.playerId];
    if (tank) tank.setHp(data.hp);
    if (this.players[data.playerId]) this.players[data.playerId].hp = data.hp;
  }

  handleShieldUp(data) {
    const tank = this.tanks[data.playerId];
    if (!tank) return;

    tank.setShield(data.shield);

    // Вспышка купола при поднятии
    const dome = this.add.circle(tank.x, tank.y - 4, 10, 0x55ffff, 0);
    dome.setStrokeStyle(2, 0x55ffff, 0.9);
    this.tweens.add({
      targets: dome,
      radius: 32,
      alpha: 0,
      duration: 450,
      onComplete: () => dome.destroy()
    });
  }

  handleShieldHit(data) {
    const tank = this.tanks[data.playerId];
    if (!tank) return;

    tank.setShield(data.shield);
    this.showFloatingText(tank.x, tank.y - 46, `ЩИТ -${data.absorbed}`, '#55ffff');

    if (data.broken) {
      // Осколки купола
      for (let i = 0; i < 8; i++) {
        const ang = Math.PI + Math.random() * Math.PI;
        const shard = this.add.circle(tank.x + Math.cos(ang) * 20, tank.y - 4 + Math.sin(ang) * 20, 2, 0x55ffff);
        this.tweens.add({
          targets: shard,
          x: shard.x + Math.cos(ang) * 30,
          y: shard.y + Math.sin(ang) * 30,
          alpha: 0,
          duration: 500,
          onComplete: () => shard.destroy()
        });
      }
    }
  }

  handleParachute(data) {
    const tank = this.tanks[data.playerId];
    if (tank) {
      this.showFloatingText(tank.x, tank.y - 40, 'ПАРАШЮТ', '#ffffff');
    }
  }

  handleFallDamage(data) {
    const tank = this.tanks[data.playerId];
    if (tank) {
      this.showFloatingText(tank.x, tank.y - 30, `ПАДЕНИЕ -${Math.round(data.distance)}px`, '#ffaa00');
    }
    window.sound.fall(data.distance);
  }

  handleDeath(data) {
    const tank = this.tanks[data.playerId];
    if (tank) {
      const boom = this.add.circle(tank.x, tank.y - 8, 4, 0xff5522);
      this.tweens.add({
        targets: boom,
        radius: 30,
        alpha: 0,
        duration: 600,
        onComplete: () => boom.destroy()
      });

      // Танк не исчезает, а остается обгоревшим остовом до конца раунда
      tank.setAlive(false);
      delete this.tanks[data.playerId];
      this.wrecks[data.playerId] = tank;
    }
    if (this.players[data.playerId]) this.players[data.playerId].isAlive = false;
    window.sound.explosion(50);
  }

  // ==== Вспомогательные ====

  spawnTank(playerId, x, y) {
    if (this.tanks[playerId]) return this.tanks[playerId];

    const player = this.players[playerId] || {};
    const color = this.colorOf(playerId);

    const tank = new window.Tank(this, x, y, playerId, color, player.name);
    tank.setHp(player.hp !== undefined ? player.hp : 100);
    tank.setAngle(player.angle !== undefined ? player.angle : 90);
    this.tanks[playerId] = tank;
    return tank;
  }

  showFloatingText(x, y, text, color) {
    const label = this.add.text(x, y, text, {
      fontFamily: 'Courier New',
      fontSize: '14px',
      color: color || '#ffffff',
      stroke: '#000000',
      strokeThickness: 3
    });
    label.setOrigin(0.5);
    label.setDepth(DEPTH.hud);

    this.tweens.add({
      targets: label,
      y: y - 40,
      alpha: 0,
      duration: 1400,
      ease: 'Quad.easeOut',
      onComplete: () => label.destroy()
    });
  }

  clearObjects() {
    (this.activeShots || []).forEach(shot => shot.dot.destroy());
    this.activeShots = [];
    this.projectileImpactAt = 0;

    Object.values(this.tanks).forEach(tank => tank.destroy());
    this.tanks = {};

    Object.values(this.wrecks).forEach(wreck => wreck.destroy());
    this.wrecks = {};

    if (this.terrain) {
      this.terrain.destroy();
      this.terrain = null;
    }

    if (this.sky) {
      this.sky.destroy();
      this.sky = null;
    }

    if (this.windGfx) { this.windGfx.destroy(); this.windGfx = null; }
    if (this.windText) { this.windText.destroy(); this.windText = null; }
    if (this.aimTrail) { this.aimTrail.destroy(); this.aimTrail = null; }
  }
}

window.GameScene = GameScene;
