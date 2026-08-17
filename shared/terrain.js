/**
 * Генерация и изменение ландшафта (высотная карта)
 * Сервер — авторитетный расчет, клиенту приходят готовые высоты
 */

const { MAP_WIDTH, MAP_HEIGHT, GROUND_MIN_Y, GROUND_MAX_Y, PHYSICS } = require('./constants');

// Поверхность не опускается ниже: танк не должен проваливаться за нижнюю кромку
const MAX_SURFACE_Y = MAP_HEIGHT - 8;

// Профили карт: seed выбирает один из них, как «стили ландшафта» в классике
const TERRAIN_STYLES = [
  { name: 'холмы',   roughness: 0.55, relief: 0.75, smooth: 3 },
  { name: 'горы',    roughness: 0.70, relief: 1.00, smooth: 2 },
  { name: 'равнина', roughness: 0.42, relief: 0.40, smooth: 4 },
  { name: 'скалы',   roughness: 0.78, relief: 0.85, smooth: 1 }
];

/**
 * Генерация ландшафта методом срединного смещения (1D diamond-square):
 * даёт рваный самоподобный профиль вместо гладких синусоид, как в оригинале.
 * Площадки под танки досыпаются отдельно — после выбора точек спавна.
 *
 * @param {number} seed
 * @param {number} [styleIndex] - профиль карты, по умолчанию выводится из seed
 * @returns {number[]} heights[x] = Y поверхности (меньше Y = выше земля)
 */
function generateTerrain(seed, styleIndex) {
  const random = seededRandom(seed);
  const style = TERRAIN_STYLES[
    styleIndex !== undefined ? styleIndex % TERRAIN_STYLES.length : seed % TERRAIN_STYLES.length
  ];

  const midY = (GROUND_MIN_Y + GROUND_MAX_Y) / 2;
  const span = (GROUND_MAX_Y - GROUND_MIN_Y) / 2 * style.relief;

  // Размер сетки — степень двойки не меньше ширины карты
  let size = 1;
  while (size < MAP_WIDTH) size *= 2;

  const grid = new Float64Array(size + 1);
  grid[0] = midY + (random() - 0.5) * span;
  grid[size] = midY + (random() - 0.5) * span;

  let step = size;
  let amplitude = span;

  while (step > 1) {
    const half = step / 2;
    for (let x = half; x < size; x += step) {
      const avg = (grid[x - half] + grid[x + half]) / 2;
      grid[x] = avg + (random() - 0.5) * 2 * amplitude;
    }
    amplitude *= style.roughness;
    step = half;
  }

  const heights = new Array(MAP_WIDTH);
  for (let x = 0; x < MAP_WIDTH; x++) {
    heights[x] = Math.max(GROUND_MIN_Y, Math.min(GROUND_MAX_Y, Math.round(grid[x])));
  }

  smoothHeights(heights, style.smooth);

  // Карта сразу приводится к естественному углу откоса. Без этого первый же
  // взрыв запускал crumbleTerrain по всему массиву, и рельеф осыпался
  // разом по всей карте — далеко от места попадания.
  // Одного вызова мало: 40 проходов не всегда сходятся на рваном профиле.
  for (let i = 0; i < 15 && crumbleTerrain(heights); i++);

  return heights;
}

function terrainStyleName(seed) {
  return TERRAIN_STYLES[seed % TERRAIN_STYLES.length].name;
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
 * Ровные площадки под танки в выбранных точках спавна.
 * Раньше площадок всегда было четыре в фиксированных местах — независимо
 * от того, сколько игроков и где они на самом деле стоят.
 */
function createSpawnPlatforms(heights, positions, platformWidth = 44) {
  const half = Math.floor(platformWidth / 2);

  for (const centerX of positions) {
    const cx = Math.max(0, Math.min(MAP_WIDTH - 1, Math.round(centerX)));
    const platformY = heights[cx];

    for (let x = cx - half; x <= cx + half; x++) {
      if (x >= 0 && x < MAP_WIDTH) heights[x] = platformY;
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
      const newHeight = Math.min(Math.max(oldHeight, craterBottomY), MAX_SURFACE_Y);

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
  // и проваливаться ниже нижней кромки карты
  for (let x = 0; x < MAP_WIDTH; x++) {
    if (heights[x] < GROUND_MIN_Y) heights[x] = GROUND_MIN_Y;
    if (heights[x] > MAX_SURFACE_Y) heights[x] = MAX_SURFACE_Y;
  }

  return totalChanged;
}

/**
 * Позиции спавна: каждая зона карты - своему игроку, ищем ровное место.
 * Порядок зон перемешивается по seed, иначе первый слот всегда стоит слева.
 */
function findSpawnPositions(heights, numPlayers, seed) {
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

  if (seed !== undefined) {
    // Перемешивание Фишера-Йетса на том же seed: раскладка детерминирована,
    // но не привязана к порядку слотов
    const random = seededRandom(seed ^ 0x5f3a);
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
  }

  return positions;
}

/**
 * Качение снаряда (Roller): от точки падения скатывается в сторону
 * понижения до локального минимума. Возвращает путь по поверхности.
 * Направление определяется по окну (высоты округлены — единичный
 * перепад может быть 0 на пологом склоне).
 */
function rollPath(heights, startX, maxSteps = 400, window = 8) {
  const path = [];
  let x = Math.max(window, Math.min(MAP_WIDTH - 1 - window, Math.round(startX)));

  const ahead = (dir) => {
    const nx = Math.max(0, Math.min(MAP_WIDTH - 1, x + dir * window));
    return heights[nx] - heights[x];
  };

  for (let i = 0; i < maxSteps; i++) {
    path.push({ x, y: heights[x] });

    const leftDown = ahead(-1);
    const rightDown = ahead(1);

    let dir = 0;
    if (leftDown > 0.5 && leftDown >= rightDown) dir = -1;
    else if (rightDown > 0.5) dir = 1;

    if (dir === 0) break;   // низина или плато шире окна
    x += dir;
  }

  path.push({ x, y: heights[x] });
  return path;
}

/**
 * Напалм: две струи растекаются влево и вправо вниз по склону.
 * Возвращаются точки струй (точка = будущий огненный шар).
 */
function napalmFlows(heights, startX, stepEvery = 10) {
  const flows = [];

  for (const dir of [1, -1]) {
    const flow = [];
    let x = Math.max(1, Math.min(MAP_WIDTH - 2, Math.round(startX)));

    for (let step = 0; step < 200; step++) {
      // Склон смотрим по окну в 3 колонки (округленные высоты дают ступеньки)
      const nx = Math.max(0, Math.min(MAP_WIDTH - 1, x + dir * 3));
      if (heights[nx] > heights[x] + 0.5) {
        x += dir;
      } else {
        break; // уперлась в подъем/плато
      }
      if (step % stepEvery === 0) flow.push({ x, y: heights[x] });
    }

    if (flow.length > 0) flows.push(flow);
  }

  return flows;
}

module.exports = {
  generateTerrain,
  terrainStyleName,
  createSpawnPlatforms,
  smoothHeights,
  applyExplosion,
  applyDirtBall,
  crumbleTerrain,
  findSpawnPositions,
  rollPath,
  napalmFlows,
  seededRandom
};
