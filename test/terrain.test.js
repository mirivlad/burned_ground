const test = require('node:test');
const assert = require('node:assert/strict');

const { MAP_WIDTH, GROUND_MIN_Y } = require('../shared/constants');
const {
  generateTerrain,
  terrainStyleName,
  findSpawnPositions,
  createSpawnPlatforms,
  crumbleTerrain
} = require('../shared/terrain');

test('карта строится на всю ширину и в границах высот', () => {
  const heights = generateTerrain(123);

  assert.equal(heights.length, MAP_WIDTH);
  assert.ok(heights.every(y => y >= GROUND_MIN_Y), 'земля не поднимается выше потолка');
  assert.ok(heights.every(Number.isFinite), 'все высоты — числа');
});

test('seed выбирает стиль карты, стилей четыре', () => {
  const styles = new Set();
  for (let seed = 1; seed <= 40; seed++) styles.add(terrainStyleName(seed));

  assert.equal(styles.size, 4, `получены стили: ${[...styles].join(', ')}`);
});

test('одинаковый seed дает одинаковую карту', () => {
  assert.deepEqual(generateTerrain(777), generateTerrain(777));
  assert.notDeepEqual(generateTerrain(777), generateTerrain(778));
});

test('свежая карта уже лежит под естественным углом откоса', () => {
  // Иначе первый же взрыв запускает осыпание по всему массиву высот,
  // и рельеф обваливается далеко от места попадания
  for (let seed = 1; seed <= 60; seed++) {
    const heights = generateTerrain(seed);
    assert.equal(crumbleTerrain([...heights]), false, `карта ${seed} осыпается сама`);
  }
});

test('площадки ровняются под каждого игрока, а не в фиксированных местах', () => {
  const heights = generateTerrain(42);
  const positions = findSpawnPositions(heights, 6, 42);
  createSpawnPlatforms(heights, positions);

  assert.equal(positions.length, 6);
  for (const x of positions) {
    assert.equal(heights[x - 15], heights[x], `слева от точки ${x} не ровно`);
    assert.equal(heights[x + 15], heights[x], `справа от точки ${x} не ровно`);
  }
});

test('порядок точек спавна перемешивается по seed', () => {
  const heights = generateTerrain(31);
  const ordered = findSpawnPositions(heights, 6);
  const shuffled = findSpawnPositions(heights, 6, 31);

  assert.deepEqual([...shuffled].sort((a, b) => a - b), [...ordered].sort((a, b) => a - b));
  assert.notDeepEqual(shuffled, ordered, 'первый слот не должен всегда стоять слева');
});
