/**
 * GameScene — игровое поле: ландшафт, танки, снаряды, взрывы.
 * Логика авторитетна на сервере; сцена отрисовывает события комнаты.
 */

class GameScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameScene' });

    this.tanks = {};          // playerId -> Tank
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
    const maxWind = window.CONSTANTS.GAME.maxWind;
    const cx = W / 2;
    const y = 26;
    const len = Math.round((Math.abs(wind) / maxWind) * 55);

    this.windGfx = this.add.graphics();
    this.windGfx.fillStyle(0x000000, 0.45);
    this.windGfx.fillRect(cx - 100, y - 14, 200, 28);

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

    this.windText = this.add.text(cx, y, `WIND ${wind.toFixed(1)}`, {
      fontFamily: 'Courier New',
      fontSize: '13px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3
    });
    this.windText.setOrigin(0.5);
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
    this.lastSeed = data.terrainSeed || 1;

    this.buildWorld(data);
  }

  handleGameSnapshot(snapshot) {
    if (!snapshot || snapshot.status !== 'playing') return;

    this.wind = snapshot.wind || 0;
    this.round = snapshot.round || 0;

    this.buildWorld({
      terrainSeed: this.lastSeed || 1,
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
   * Анимация точки по полилинии от сервера (плоский массив [x,y,x,y,...]).
   * 1 точка = stepMs. Возвращает объект снаряда.
   */
  animatePolyline(flat, stepMs, colorNum, radius = 3) {
    if (!flat || flat.length < 4) return null;

    const dot = this.add.circle(flat[0], flat[1], radius, colorNum);
    let i = 2;

    this.time.addEvent({
      delay: stepMs,
      repeat: Math.floor(flat.length / 2),
      callback: () => {
        if (i + 1 < flat.length) {
          dot.setPosition(flat[i], flat[i + 1]);
          i += 2;
        }
      }
    });

    // Живет до конца полилинии
    this.time.delayedCall((flat.length / 2) * stepMs + 200, () => dot.destroy());
    return dot;
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
    if (tank) tank.setAngle(angle);

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

      if (special.type === 'mirv') {
        const main = this.animatePolyline(special.main, 16.67, colorNum);

        this.time.delayedCall((special.main.length / 2) * 16.67 + 50, () => {
          // Распад: три боеголовки
          for (const w of special.warheads) {
            this.animatePolyline(w, mainMs, colorNum, 2);
          }
          main?.destroy();
        });
      } else if (special.type === 'roller') {
        this.animatePolyline(special.main, 16.67, colorNum);
        const mainDoneMs = (special.main.length / 2) * 16.67 + 100;

        this.time.delayedCall(mainDoneMs, () => {
          this.waitForSpecialPath('path', (path) => {
            // Шар катится по склону
            this.animatePolyline(path, mainMs, colorNum, 4);
          });
        });
      } else if (special.type === 'napalm') {
        this.animatePolyline(special.main, 16.67, colorNum);
        const mainDoneMs = (special.main.length / 2) * 16.67 + 100;

        this.time.delayedCall(mainDoneMs, () => {
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

    const projectile = this.add.circle(trajectory[0].x, trajectory[0].y, 3, colorNum);

    // Твин с массивом точек ненадежен в Phaser 3.60 — анимируем вручную:
    // 1 точка траектории = 1 тик физики (16.67мс), снаряд точно следует кривой
    // и останавливается в точке падения (не пролетает сквозь грунт).
    const isSmoke = weaponId === 'smoke_tracer';

    if (isSmoke) this.aimTrail = this.add.graphics();

    const trail = isSmoke ? this.aimTrail : this.add.graphics();
    let idx = 0;

    this.time.addEvent({
      delay: 16.67,
      repeat: trajectory.length,
      callback: () => {
        idx++;
        if (idx < trajectory.length) {
          projectile.setPosition(trajectory[idx].x, trajectory[idx].y);
          if (!isSmoke) {
            trail.fillStyle(0xffffff, 0.25);
            trail.fillCircle(trajectory[idx].x, trajectory[idx].y, 1);
          } else if (idx % 5 === 0) {
            // Дымная дорожка остается до следующего выстрела — пристрелка
            trail.fillStyle(0xcccccc, 0.85);
            trail.fillCircle(trajectory[idx].x, trajectory[idx].y, 2);
          }
        } else {
          // Точка падения
          const last = trajectory[trajectory.length - 1];
          projectile.setPosition(last.x, last.y);
          if (isSmoke) {
            trail.fillStyle(0xffffff, 0.9);
            trail.fillCircle(last.x, last.y, 3);
          }
          projectile.destroy();
        }
      }
    });

    if (isSmoke) {
      window.sound.smoke();
    } else {
      window.sound.shot();
    }
  }

  handleExplosion(data) {
    const { x, y, radius, weaponId, damages } = data;
    const weapon = window.WEAPONS[weaponId] || {};
    const isDirt = weapon.effect === 'add_earth';
    const r = Math.max(radius, 10);

    if (isDirt) {
      // Холм земли: коричневое пятно + комья
      const blob = this.add.circle(x, y, 2, 0x8b5a2b);
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
        tank.setAlive(p.isAlive);
      }
    });
  }

  handleHpUpdate(data) {
    const tank = this.tanks[data.playerId];
    if (tank) tank.setHp(data.hp);
    if (this.players[data.playerId]) this.players[data.playerId].hp = data.hp;
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
      tank.destroy();
      delete this.tanks[data.playerId];
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
    Object.values(this.tanks).forEach(tank => tank.destroy());
    this.tanks = {};

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
