/**
 * Небо в стиле Scorched Earth (DOS):
 * вертикальный градиент полосами, солнце / полумесяц со звёздами,
 * тонкие «дизерные» облака. Тема раунда выводится из seed ландшафта.
 */

const SKY_THEMES = {
  day: {
    night: false,
    stops: [0x5aa7d8, 0x9fd0ea, 0xd9eef8]   // голубое -> почти белое у горизонта
  },
  sunset: {
    night: false,
    stops: [0x35204f, 0x8a3d7a, 0xe05a3a, 0xffb347]  // фиолет -> оранж
  },
  night: {
    night: true,
    stops: [0x000000, 0x160c2b, 0x4a1a30, 0x8a3a1e]  // чёрное -> тлеющий горизонт
  }
};

class Sky {
  constructor(scene, theme, seed) {
    this.scene = scene;
    this.theme = SKY_THEMES[theme] ? theme : 'day';
    this.seed = seed || 1;
    this.graphics = scene.add.graphics();
    this.graphics.setDepth(-10);

    this.stars = SKY_THEMES[this.theme].night ? this.makeStars() : [];
    this.cloudsArr = SKY_THEMES[this.theme].night ? [] : this.makeClouds();

    this.draw();
  }

  makeStars() {
    const stars = [];
    for (let x = 0; x < 1280; x += 7) {
      const y = 40 + ((x * 7919 + this.seed * 104729) % 260);
      const bright = 0.4 + ((x * 31) % 10) / 15;
      stars.push({ x, y, bright });
    }
    return stars;
  }

  makeClouds() {
    // Тонкие горизонтальные полоски с дизерингом
    const clouds = [];
    for (let i = 0; i < 6; i++) {
      clouds.push({
        x: ((this.seed * (i + 3) * 131) % 1100) + 80,
        y: 60 + ((this.seed * (i + 7) * 7919) % 220),
        w: 50 + ((this.seed * (i + 5) * 17) % 100),
        h: 5
      });
    }
    return clouds;
  }

  draw() {
    const g = this.graphics;
    g.clear();

    const W = window.CONSTANTS.MAP_WIDTH;
    const H = window.CONSTANTS.MAP_HEIGHT;
    const theme = SKY_THEMES[this.theme];

    // Градиент полосами по 15px — узнаваемый DOS-стиль
    const bands = 48;
    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      g.fillStyle(this.lerpStops(theme.stops, t), 1);
      g.fillRect(0, Math.floor((H * i) / bands), W, Math.ceil(H / bands) + 1);
    }

    if (theme.night) {
      // Звёзды
      for (const s of this.stars) {
        g.fillStyle(0xffffff, s.bright);
        g.fillRect(s.x, s.y, 2, 2);
      }
      // Полумесяц: жёлтый круг + вырез цветом неба
      g.fillStyle(0xfff3c2, 1);
      g.fillCircle(1090, 86, 20);
      g.fillStyle(this.lerpStops(theme.stops, 86 / H), 1);
      g.fillCircle(1100, 78, 17);
    } else {
      // Солнце — сплошной жёлтый круг
      g.fillStyle(0xffe95c, 1);
      g.fillCircle(170, 96, 26);

      // Дизерные облака: пунктирные полоски
      g.fillStyle(0xffffff, 0.75);
      for (const c of this.cloudsArr) {
        for (let dx = 0; dx < c.w; dx += 6) {
          if (((dx / 6) + c.x) % 2 === 0) {
            g.fillRect(c.x + dx, c.y, 4, c.h);
          }
        }
      }
    }
  }

  lerpStops(stops, t) {
    const n = stops.length - 1;
    const seg = Math.min(Math.floor(t * n), n - 1);
    const local = t * n - seg;
    const c1 = stops[seg];
    const c2 = stops[seg + 1];

    const r1 = (c1 >> 16) & 0xff, g1 = (c1 >> 8) & 0xff, b1 = c1 & 0xff;
    const r2 = (c2 >> 16) & 0xff, g2 = (c2 >> 8) & 0xff, b2 = c2 & 0xff;

    const r = r1 + Math.round((r2 - r1) * local);
    const gg = g1 + Math.round((g2 - g1) * local);
    const b = b1 + Math.round((b2 - b1) * local);

    return (r << 16) | (gg << 8) | b;
  }

  destroy() {
    this.graphics.destroy();
  }
}

window.Sky = Sky;
window.SKY_THEMES = SKY_THEMES;
