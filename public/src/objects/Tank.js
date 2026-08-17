/**
 * Танк в стиле Scorched Earth: чёрные гусеницы с катками, цветной корпус,
 * башня и ствол. Цвет — из палитры комнаты.
 *
 * Корпусов несколько: модель выбирается детерминированно по playerId, чтобы
 * в бою на десятерых танки различались не только цветом. Убитый танк
 * оставляет обгоревший остов до конца раунда — как воронка в оригинале.
 */

// Силуэты корпусов: отличаются шириной, высотой и формой башни
const HULL_MODELS = [
  { name: 'штурмовой', hullH: 7,  turretR: 7, turretY: -2, hullInset: 2, sloped: false },
  { name: 'тяжёлый',   hullH: 9,  turretR: 8, turretY: -1, hullInset: 0, sloped: false },
  { name: 'лёгкий',    hullH: 6,  turretR: 6, turretY: -2, hullInset: 4, sloped: true },
  { name: 'самоходка', hullH: 8,  turretR: 5, turretY: -3, hullInset: 1, sloped: true }
];

function modelFor(playerId) {
  let hash = 0;
  const s = String(playerId || '');
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return HULL_MODELS[hash % HULL_MODELS.length];
}

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
    this.shield = 0;
    this.isAlive = true;
    this.isCurrent = false;
    this.model = modelFor(playerId);
    this.muzzleFlashUntil = 0;

    this.width = window.CONSTANTS.PHYSICS.tankWidth;
    this.height = window.CONSTANTS.PHYSICS.tankHeight;

    this.graphics = scene.add.graphics();

    if (this.name) {
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

    if (!this.isAlive) {
      this.drawWreck();
      return;
    }

    const g = this.graphics;
    const c = this.color;
    const m = this.model;
    const dark = 0x1a1a1a;
    const px = 2;   // пиксельная сетка для DOS-вида

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

    // Корпус: цвет игрока с чёрной обводкой, форма зависит от модели
    const hullW = this.width - m.hullInset;
    const hullH = m.hullH;
    const hullX = Math.round(this.x - hullW / 2);
    const hullY = treadY - hullH;

    g.fillStyle(c, 1);
    g.lineStyle(1, 0x000000, 1);

    if (m.sloped) {
      // Скошенная лобовая деталь
      g.beginPath();
      g.moveTo(hullX + 4, hullY);
      g.lineTo(hullX + hullW - 4, hullY);
      g.lineTo(hullX + hullW, hullY + hullH);
      g.lineTo(hullX, hullY + hullH);
      g.closePath();
      g.fillPath();
      g.strokePath();
    } else {
      g.fillRect(hullX, hullY, hullW, hullH);
      g.strokeRect(hullX, hullY, hullW, hullH);
    }

    // Башня: полукруг того же цвета
    const turretY = hullY + m.turretY;
    g.fillStyle(c, 1);
    g.slice(this.x, turretY, m.turretR, Math.PI, Math.PI * 2, false);
    g.fillPath();
    g.lineStyle(1, 0x000000, 1);
    g.slice(this.x, turretY, m.turretR, Math.PI, Math.PI * 2, false);
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

    // Вспышка у среза ствола сразу после выстрела
    if (this.scene.time.now < this.muzzleFlashUntil) {
      const fx = this.x - Math.cos(a) * (barrelLen + 4);
      const fy = turretY - Math.sin(a) * (barrelLen + 4);
      g.fillStyle(0xffffcc, 0.95);
      g.fillCircle(fx, fy, 5);
      g.fillStyle(0xffaa33, 0.8);
      g.fillCircle(fx, fy, 3);
    }

    // Купол щита: полукруг над танком, ярче при большем запасе прочности
    if (this.shield > 0) {
      const radius = this.width * 0.85;
      const strength = Math.min(1, this.shield / 100);
      g.lineStyle(2, 0x55ffff, 0.35 + strength * 0.5);
      g.beginPath();
      g.arc(this.x, this.y - 4, radius, Math.PI, Math.PI * 2, false);
      g.strokePath();
    }

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

  /** Обгоревший остов на месте уничтоженного танка */
  drawWreck() {
    const g = this.graphics;
    const wreckW = this.width;
    const wreckX = Math.round(this.x - wreckW / 2);
    const wreckY = Math.round(this.y - 6);

    g.fillStyle(0x241c14, 1);
    g.fillRect(wreckX, wreckY, wreckW, 6);
    g.fillStyle(0x120e0a, 1);
    g.fillRect(wreckX + 4, wreckY - 3, wreckW - 12, 3);

    // Погнутый ствол в грунте
    g.lineStyle(3, 0x1a1a1a, 1);
    g.beginPath();
    g.moveTo(this.x + 2, wreckY);
    g.lineTo(this.x + 14, wreckY - 7);
    g.strokePath();
  }

  /** Вспышка выстрела: гаснет сама через 120мс */
  flash() {
    this.muzzleFlashUntil = this.scene.time.now + 120;
    this.draw();
    this.scene.time.delayedCall(140, () => {
      if (this.graphics && this.graphics.scene) this.draw();
    });
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

  setShield(shield) {
    const value = Math.max(0, Number(shield) || 0);
    if (this.shield !== value) {
      this.shield = value;
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
