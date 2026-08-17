const test = require('node:test');
const assert = require('node:assert/strict');

const { MAP_WIDTH, PHYSICS } = require('../shared/constants');
const { updateTankPhysics } = require('../shared/physics');
const { applyDirtBall, applyExplosion } = require('../shared/terrain');

const flat = (height = 600) => Array.from({ length: MAP_WIDTH }, () => height);

test('насыпанная сверху земля засыпает танк, а не выносит его на склон кучи', () => {
  const heights = flat(600);
  const tank = { playerId: 'p', x: 400, y: 600, velocityY: 0 };

  // Dirt Ball прямо в танк: поверхность поднимается над корпусом
  applyDirtBall(heights, 400, 600, 30);
  assert.ok(heights[400] < 600 - PHYSICS.tankHeight, 'земля должна лечь выше корпуса');

  const res = updateTankPhysics(tank, heights);

  assert.equal(tank.y, 600, 'танк остается на своем месте под землей');
  assert.equal(res.buried, true, 'танк помечен как засыпанный');
  assert.equal(res.moved, false, 'засыпанный танк не двигается');
});

test('засыпанный танк не съезжает по склону кучи', () => {
  const heights = flat(600);
  const tank = { playerId: 'p', x: 400, y: 600, velocityY: 0 };

  // Куча со смещением: ее склон уходит вбок
  applyDirtBall(heights, 420, 600, 40);

  const before = tank.x;
  for (let i = 0; i < 20; i++) updateTankPhysics(tank, heights);

  assert.equal(tank.x, before, 'зажатый грунтом танк остается на месте');
});

test('висящий над землей танк падает и встает на поверхность', () => {
  const heights = flat(600);
  const tank = { playerId: 'p', x: 400, y: 540, velocityY: 0 };

  let landed = false;
  for (let i = 0; i < 40 && !landed; i++) {
    landed = updateTankPhysics(tank, heights).landed;
  }

  assert.ok(landed, 'танк должен приземлиться');
  assert.equal(tank.y, 600, 'и встать ровно на поверхность');
});

test('выкопанная воронка роняет танк вниз', () => {
  const heights = flat(600);
  const tank = { playerId: 'p', x: 400, y: 600, velocityY: 0 };

  applyExplosion(heights, 400, 600, 60);

  let landed = false;
  for (let i = 0; i < 60 && !landed; i++) {
    landed = updateTankPhysics(tank, heights).landed;
  }

  assert.ok(landed, 'танк должен упасть в воронку');
  assert.ok(tank.y > 600, `танк опустился ниже прежнего уровня (стал ${tank.y})`);
});
