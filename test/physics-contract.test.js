const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAP_WIDTH,
  MAP_HEIGHT,
  PHYSICS
} = require('../shared/constants');
const {
  calculateProjectileTrajectory,
  projectileFlightMs,
  distanceToTankHitbox
} = require('../shared/physics');

function flatTerrain(height = 600) {
  return Array.from({ length: MAP_WIDTH }, () => height);
}

test('длительность полета берется из единого шага анимации', () => {
  assert.equal(projectileFlightMs(10), 9 * PHYSICS.projectileStepMs);
});

test('прямое попадание в силуэт танка имеет нулевую дистанцию', () => {
  const distance = distanceToTankHitbox({
    impactX: 400,
    impactY: 500,
    tankX: 400,
    tankGroundY: 508
  });

  assert.equal(distance, 0);
});

test('ветер силой 8 остается поправкой, а не переворачивает дальний выстрел', () => {
  const terrain = flatTerrain();
  const calm = calculateProjectileTrajectory({
    startX: 1000,
    startY: 500,
    angle: 45,
    power: 30,
    wind: 0,
    heights: terrain
  });
  const windy = calculateProjectileTrajectory({
    startX: 1000,
    startY: 500,
    angle: 45,
    power: 30,
    wind: 8,
    heights: terrain
  });

  const calmImpact = calm.at(-1).x;
  const windyImpact = windy.at(-1).x;
  const calmRange = 1000 - calmImpact;
  const drift = windyImpact - calmImpact;

  assert.ok(calmRange > 300, `ожидалась дальность, получено ${calmRange}`);
  assert.ok(drift > 0, `ветер вправо должен сносить вправо, получено ${drift}`);
  assert.ok(drift < calmRange * 0.35, `снос ${drift} слишком велик для дальности ${calmRange}`);
});
