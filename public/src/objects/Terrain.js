/**
 * Ландшафт в стиле Scorched Earth:
 * сплошной песочный грунт с тёмной крапинкой и чёрной кромкой поверхности.
 * Крапинка детерминирована по X — не мерцает при перерисовках после взрывов.
 */

class Terrain {
  constructor(scene, heights) {
    this.scene = scene;
    this.heights = heights || [];
    this.speckles = [];
    this.graphics = scene.add.graphics();

    this.generateSpeckles();
    this.draw();
  }

  update(heights) {
    this.heights = heights;
    this.draw();
  }

  generateSpeckles() {
    const SPECKLE_COLORS = [0x8a6f44, 0x7d6538, 0x6e5730];
    const speckles = [];

    for (let x = 0; x < this.heights.length; x += 3) {
      const n = 1 + ((x * 7919) % 3);
      for (let k = 0; k < n; k++) {
        const depth = 6 + ((x * 31 + k * 17) % 60);
        const y = this.heights[x] + depth;
        if (y < 720) {
          speckles.push({
            x: x + ((x * 13 + k * 7) % 3),
            y,
            color: SPECKLE_COLORS[(x + k) % SPECKLE_COLORS.length]
          });
        }
      }
    }

    this.speckles = speckles;
  }

  draw() {
    this.graphics.clear();

    if (this.heights.length === 0) return;

    const H = window.CONSTANTS.MAP_HEIGHT;
    const groundColor = 0xa68b5b;   // песочный, как в оригинале

    // Тело земли
    this.graphics.fillStyle(groundColor, 1);
    this.graphics.beginPath();
    this.graphics.moveTo(0, H);
    this.graphics.lineTo(0, this.heights[0]);

    for (let x = 0; x < this.heights.length; x++) {
      this.graphics.lineTo(x, this.heights[x]);
    }

    this.graphics.lineTo(this.heights.length, H);
    this.graphics.closePath();
    this.graphics.fillPath();

    // Крапинка (только внутри земли — проверяем поверхность в точке)
    for (const s of this.speckles) {
      const surf = this.heights[Math.min(s.x, this.heights.length - 1)];
      if (s.y >= surf) {
        this.graphics.fillStyle(s.color, 1);
        this.graphics.fillRect(s.x, s.y, 2, 2);
      }
    }

    // Чёрная кромка поверхности
    this.graphics.lineStyle(2, 0x000000, 1);
    this.graphics.beginPath();
    this.graphics.moveTo(0, this.heights[0]);

    for (let x = 0; x < this.heights.length; x++) {
      this.graphics.lineTo(x, this.heights[x]);
    }

    this.graphics.strokePath();
  }

  getHeightAt(x) {
    x = Math.floor(x);
    if (x < 0 || x >= this.heights.length) return null;
    return this.heights[x];
  }

  destroy() {
    this.graphics.destroy();
  }
}

window.Terrain = Terrain;
