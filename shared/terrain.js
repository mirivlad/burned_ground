/**
 * Генерация и изменение ландшафта (высотная карта)
 * Сервер — авторитетный расчет, клиенту приходят готовые высоты
 */

const { MAP_WIDTH, GROUND_MIN_Y, GROUND_MAX_Y, PHYSICS } = require('./constants');

/**
 * Генерация ландшафта: наложение синусоид + шум по seed
 * @returns {number[]} heights[x] = Y поверхности (меньше Y = выше земля)
 */
function generateTerrain(seed) {
  const heights = new Array(MAP_WIDTH);
  const random = seededRandom(seed);

  const baseHeight = (GROUND_MIN_Y + GROUND_MAX_Y) / 2;
  const amplitude = (GROUND_MAX_Y - GROUND_MIN_Y) / 2;

  const frequencies = [0.003, 0.01, 0.02, 0.05];
  const phases = [
    random() * Math.PI * 2,
    random() * Math.PI * 2,
    random() * Math.PI * 2,
    random() * Math.PI * 2
  ];
  const amplitudes = [0.6, 0.25, 0.1, 0.05];

  for (let x = 0; x < MAP_WIDTH; x++) {
    let y = baseHeight;
    for (let i = 0; i < frequencies.length; i++) {
      y += Math.sin(x * frequencies[i] + phases[i]) * amplitude * amplitudes[i];
    }
    y += (random() - 0.5) * 20;
    heights[x] = Math.max(GROUND_MIN_Y, Math.min(GROUND_MAX_Y, Math.round(y)));
  }

  smoothHeights(heights, 2);
  createSpawnPlatforms(heights);

  return heights;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return function() {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function smoothHeights(heights, passes = 1) {
  for (let p = 0; p < passes; p++) {
    const copy = [...heights];
    for (let x = 1; x < MAP_WIDTH - 1; x++) {
      heights[x] = Math.round((copy[x - 1] + copy[x] + copy[x + 1]) / 3);
    }
  }
}

/**
 * Плоские площадки для спавна
 */
function createSpawnPlatforms(heights) {
  const numPlatforms = 4;
  const platformWidth = 60;

  for (let i = 0; i < numPlatforms; i++) {
    const centerX = Math.floor((i + 0.5) * MAP_WIDTH / numPlatforms);
    const platformY = heights[centerX];

    for (let x = centerX - platformWidth / 2; x < centerX + platformWidth / 2; x++) {
      if (x >= 0 && x < MAP_WIDTH) {
        heights[x] = platformY;
      }
    }
  }
}

/**
 * Взрыв: кратер. Стены кратера остаются вертикальными —
 * осыпание делает crumbleTerrain().
 * @returns {number} сколько пикселей земли уничтожено (для экономики)
 */
function applyExplosion(heights, cx, cy, radius) {
  let terrainDiff = 0;
  const radiusSq = radius * radius;

  for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(MAP_WIDTH - 1, Math.ceil(cx + radius)); x++) {
    const dx = Math.abs(x - cx);
    if (dx <= radius) {
      const dy = Math.sqrt(radiusSq - dx * dx);
      const craterBottomY = cy + dy;

      const oldHeight = heights[x];
      const newHeight = Math.max(oldHeight, craterBottomY);

      heights[x] = newHeight;
      terrainDiff += Math.max(0, newHeight - oldHeight);
    }
  }

  return terrainDiff;
}

/**
 * Dirt Ball: холм земли
 * @returns {number} сколько пикселей земли добавлено
 */
function applyDirtBall(heights, cx, cy, radius) {
  let terrainDiff = 0;
  const radiusSq = radius * radius;

  for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(MAP_WIDTH - 1, Math.ceil(cx + radius)); x++) {
    const dx = Math.abs(x - cx);
    if (dx <= radius) {
      const dy = Math.sqrt(radiusSq - dx * dx);
      const moundTopY = cy - dy;

      const oldHeight = heights[x];
      const newHeight = Math.min(oldHeight, moundTopY);

      heights[x] = newHeight;
      terrainDiff += Math.max(0, oldHeight - newHeight);
    }
  }

  return terrainDiff;
}

/**
 * Осыпание грунта (фишка классики): склон круче угла естественного
 * откоса не держится — земля пересыпается в нижнюю колонку.
 * Вызывается после взрывов/холмов; танки на осыпавшемся краю теряют опору.
 * @returns {boolean} был ли изменен ландшафт
 */
function crumbleTerrain(heights, maxSlope = PHYSICS.crumbleMaxSlope, passes = PHYSICS.crumblePasses) {
  let totalChanged = false;

  for (let p = 0; p < passes; p++) {
    let changed = false;

    for (let x = 0; x < MAP_WIDTH - 1; x++) {
      const d = heights[x] - heights[x + 1];
      if (d > maxSlope) {
        const move = Math.ceil((d - maxSlope) / 2);
        heights[x] -= move;
        heights[x + 1] += move;
        changed = true;
      } else if (-d > maxSlope) {
        const move = Math.ceil((-d - maxSlope) / 2);
        heights[x + 1] -= move;
        heights[x] += move;
        changed = true;
      }
    }

    if (changed) {
      totalChanged = true;
    } else {
      break;
    }
  }

  // Осыпавшаяся земля не может висеть выше минимального уровня
  for (let x = 0; x < MAP_WIDTH; x++) {
    if (heights[x] < GROUND_MIN_Y) heights[x] = GROUND_MIN_Y;
  }

  return totalChanged;
}

/**
 * Позиции спавна: каждая зона карты - своему игроку, ищем ровное место
 */
function findSpawnPositions(heights, numPlayers) {
  const positions = [];

  for (let i = 0; i < numPlayers; i++) {
    const zoneStart = i * Math.floor(MAP_WIDTH / numPlayers);
    const zoneWidth = Math.floor(MAP_WIDTH / numPlayers);
    const zoneCenter = zoneStart + zoneWidth / 2;

    let bestX = Math.floor(zoneCenter);
    let bestFlatness = Infinity;

    for (let x = zoneStart + 10; x < zoneStart + zoneWidth - 10; x++) {
      if (x - 5 < 0 || x + 5 >= MAP_WIDTH) continue;
      const flatness = Math.abs(heights[x - 5] - heights[x + 5]);
      if (flatness < bestFlatness) {
        bestFlatness = flatness;
        bestX = x;
      }
    }

    positions.push(bestX);
  }

  return positions;
}

module.exports = {
  generateTerrain,
  smoothHeights,
  applyExplosion,
  applyDirtBall,
  crumbleTerrain,
  findSpawnPositions,
  seededRandom
};
