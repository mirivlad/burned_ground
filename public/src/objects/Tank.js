/**
 * Танк в стиле Scorched Earth: чёрные гусеницы с катками,
 * цветной корпус, полукруглая башня и ствол. Цвет — из палитры комнаты.
 */

class Tank {
  constructor(scene, x, y, playerId, color, name) {
    this.scene = scene;
    this.playerId = playerId;
    this.x = x;
    this.y = y;
    this.color = color;
    this.name = name || '';
    this.angle = 90;
    this.hp = 100;
    this.isAlive = true;
    this.isCurrent = false;

    this.width = window.CONSTANTS.PHYSICS.tankWidth;
    this.height = window.CONSTANTS.PHYSICS.tankHeight;

    this.graphics = scene.add.graphics();

    if (this.name) {
      const css = '#' + color.toString(16).padStart(6, '0');
      this.nameText = scene.add.text(this.x, this.y - 30, this.name, {
        fontFamily: 'Courier New',
        fontSize: '11px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3
      });
      this.nameText.setOrigin(0.5, 1);
    }

    this.draw();
  }

  draw() {
    this.graphics.clear();
    if (!this.isAlive) return;

    const g = this.graphics;
    const c = this.color;
    const dark = 0x1a1a1a;

    // Пиксельная сетка: блоки по 2px для DOS-вида
    const px = 2;

    // Гусеницы: чёрная база + светлые катки
    const treadW = this.width + 6;
    const treadH = 8;
    const treadX = Math.round(this.x - treadW / 2);
    const treadY = Math.round(this.y - treadH);

    g.fillStyle(dark, 1);
    g.fillRect(treadX, treadY, treadW, treadH);
    g.fillStyle(0x888888, 1);
    for (let dx = 3; dx < treadW - 2; dx += 6) {
      g.fillRect(treadX + dx, treadY + 2, px, px);
      g.fillRect(treadX + dx, treadY + 5, px, px);
    }

    // Корпус: цвет игрока с чёрной обводкой
    const hullW = this.width - 2;
    const hullH = 7;
    const hullX = Math.round(this.x - hullW / 2);
    const hullY = treadY - hullH;

    g.lineStyle(1, 0x000000, 1);
    g.fillStyle(c, 1);
    g.fillRect(hullX, hullY, hullW, hullH);
    g.strokeRect(hullX, hullY, hullW, hullH);

    // Башня: полукруг того же цвета
    const turretY = hullY - 2;
    g.fillStyle(c, 1);
    g.slice(this.x, turretY, 7, Math.PI, Math.PI * 2, false);
    g.fillPath();
    g.lineStyle(1, 0x000000, 1);
    g.slice(this.x, turretY, 7, Math.PI, Math.PI * 2, false);
    g.strokePath();

    // Ствол: чёрный контур + цветная сердцевина
    // Система углов: 0° = влево, 90° = вверх, 180° = вправо
    const barrelLen = 15;
    const a = (this.angle * Math.PI) / 180;
    const bx = this.x - Math.cos(a) * barrelLen;
    const by = turretY - Math.sin(a) * barrelLen;

    g.lineStyle(5, 0x000000, 1);
    g.beginPath();
    g.moveTo(this.x, turretY);
    g.lineTo(bx, by);
    g.strokePath();

    g.lineStyle(3, c, 1);
    g.beginPath();
    g.moveTo(this.x, turretY);
    g.lineTo(bx, by);
    g.strokePath();

    // Индикатор текущего игрока — белая рамка
    if (this.isCurrent) {
      g.lineStyle(1, 0xffffff, 0.8);
      g.strokeRect(this.x - this.width / 2 - 6, this.y - 30, this.width + 12, 32);
    }

    // Полоска HP
    const barW = this.width + 6;
    const barY = this.y - 34;
    g.fillStyle(0x000000, 0.8);
    g.fillRect(this.x - barW / 2, barY, barW, 4);
    const ratio = Math.max(0, Math.min(100, this.hp)) / 100;
    const hpColor = ratio > 0.5 ? 0x33ff66 : (ratio > 0.25 ? 0xffd24a : 0xff3333);
    g.fillStyle(hpColor, 1);
    g.fillRect(this.x - barW / 2, barY, barW * ratio, 4);
  }

  setPosition(x, y) {
    this.x = x;
    this.y = y;
    if (this.nameText) this.nameText.setPosition(this.x, this.y - 30);
    this.draw();
  }

  setAngle(angle) {
    if (this.angle !== angle) {
      this.angle = angle;
      this.draw();
    }
  }

  setHp(hp) {
    if (this.hp !== hp) {
      this.hp = hp;
      this.draw();
    }
  }

  setCurrent(isCurrent) {
    if (this.isCurrent !== isCurrent) {
      this.isCurrent = isCurrent;
      this.draw();
    }
  }

  setAlive(isAlive) {
    if (this.isAlive !== isAlive) {
      this.isAlive = isAlive;
      this.draw();
      if (this.nameText) this.nameText.setAlpha(isAlive ? 1 : 0.3);
    }
  }

  destroy() {
    this.graphics.destroy();
    if (this.nameText) this.nameText.destroy();
  }
}

window.Tank = Tank;
