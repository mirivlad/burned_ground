/**
 * ИИ ботов. Прицеливание — та же физика, что у игроков (shared/physics),
 * поэтому боты «видят» ровно то, что происходит на сервере.
 */

const { calculateProjectileTrajectory } = require('./shared/physics');
const { WEAPONS, BASE_WEAPON_ID } = require('./shared/weapons');
const { BOT } = require('./shared/constants');

/**
 * Поиск прицельного решения: сетка по углу/мощности + локальное уточнение.
 * @param {number[]} heights - рельеф
 * @param {number} wind
 * @param {{x:number,y:number}} from - дуло
 * @param {{x:number,y:number}} target - центр цели
 * @returns {{angle:number, power:number, dist:number, impact:{x,y}}}
 */
function solveShot(heights, wind, from, target) {
  const sim = (angle, power) => {
    const tr = calculateProjectileTrajectory({
      startX: from.x, startY: from.y, angle, power, wind, heights
    });
    const imp = tr[tr.length - 1];
    return { dist: Math.hypot(imp.x - target.x, imp.y - target.y), imp };
  };

  let best = null;

  // Грубая сетка
  for (let a = 5; a <= 175; a += 2) {
    for (let p = 15; p <= 100; p += 3) {
      const r = sim(a, p);
      if (!best || r.dist < best.dist) best = { angle: a, power: p, dist: r.dist, impact: r.imp };
    }
  }

  // Уточнение вокруг лучшего
  const a0 = best.angle, p0 = best.power;
  for (let a = a0 - 2; a <= a0 + 2; a += 0.5) {
    if (a < 1 || a > 179) continue;
    for (let p = p0 - 3; p <= p0 + 3; p += 1) {
      if (p < 5 || p > 100) continue;
      const r = sim(a, p);
      if (r.dist < best.dist) best = { angle: a, power: p, dist: r.dist, impact: r.imp };
    }
  }

  best.angle = Math.max(0, Math.min(180, Math.round(best.angle)));
  best.power = Math.max(0, Math.min(100, Math.round(best.power)));
  return best;
}

/**
 * Решение бота с учетом сложности.
 * @returns {{angle, power, weaponId}}
 */
function decideShot({ difficulty, heights, wind, selfTank, selfHp, enemyTanks, money, inventory }) {
  const cfg = BOT;
  const noise = cfg.aimNoise[difficulty] || cfg.aimNoise.easy;
  const randomChance = cfg.randomShotChance[difficulty] || 0;

  // Цель: ближайший живой противник
  const enemies = enemyTanks.filter(t => t.playerId !== selfTank.playerId);
  if (enemies.length === 0) {
    return { angle: 90, power: 50, weaponId: BASE_WEAPON_ID };
  }
  const target = enemies.reduce((best, t) =>
    Math.abs(t.x - selfTank.x) < Math.abs(best.x - selfTank.x) ? t : best
  );

  const from = { x: selfTank.x, y: selfTank.y - 16 };
  const targetPoint = { x: target.x, y: target.y - 8 };

  // Полностью случайный выстрел (легкие боты часто мажут)
  const roll = Math.random();
  if (roll < randomChance) {
    const toRight = target.x > selfTank.x;
    const angle = toRight
      ? 95 + Math.floor(Math.random() * 75)
      : 10 + Math.floor(Math.random() * 75);
    return {
      angle,
      power: 30 + Math.floor(Math.random() * 70),
      weaponId: BASE_WEAPON_ID
    };
  }

  const solution = solveShot(heights, wind, from, targetPoint);

  // Шум прицеливания по сложности
  const angle = Math.max(0, Math.min(180,
    Math.round(solution.angle + (Math.random() * 2 - 1) * noise.angle)
  ));
  const power = Math.max(0, Math.min(100,
    Math.round(solution.power + (Math.random() * 2 - 1) * noise.power)
  ));

  // Выбор оружия: сначала то, что уже есть в трюме, иначе покупка по деньгам.
  // Порядок — от тяжелого к легкому, дорогое доступно только сильным ботам.
  const has = (id) => (inventory[id] || 0) > 0;
  const nukeTh = cfg.nukeThreshold[difficulty];
  const buyTh = cfg.buyThreshold[difficulty];

  const arsenal = [
    { id: 'deaths_head', buyFrom: nukeTh * 2.5 },
    { id: 'nuke',        buyFrom: nukeTh },
    { id: 'baby_nuke',   buyFrom: nukeTh * 0.8 },
    { id: 'heavy_shot',  buyFrom: buyTh },
    { id: 'missile',     buyFrom: buyTh }
  ];

  let weaponId = BASE_WEAPON_ID;

  const owned = arsenal.find(w => has(w.id));
  if (owned) {
    weaponId = owned.id;
  } else {
    const affordable = arsenal.find(w => {
      const weapon = WEAPONS[w.id];
      return weapon && money >= w.buyFrom && money >= weapon.price;
    });
    if (affordable) weaponId = affordable.id;
  }

  // Не стреляем тяжелым, если взрыв заденет себя (иначе самоубийство)
  const chosen = WEAPONS[weaponId];
  if (chosen && chosen.radius > 40) {
    const selfDist = Math.hypot(solution.impact.x - selfTank.x, solution.impact.y - (selfTank.y - 8));
    if (selfDist < chosen.radius * 1.1) {
      weaponId = has('heavy_shot') ? 'heavy_shot' : BASE_WEAPON_ID;
    }
  }

  return { angle, power, weaponId };
}

/**
 * Задержка "раздумий" бота
 */
function thinkDelay(difficulty) {
  const [min, max] = BOT.thinkDelayMs[difficulty] || BOT.thinkDelayMs.easy;
  return min + Math.random() * (max - min);
}

/**
 * Имя бота по сложности
 */
function botName(difficulty, index) {
  const names = BOT.names[difficulty] || BOT.names.easy;
  const base = names[index % names.length];
  return `${base}-${100 + Math.floor(Math.random() * 900)}`;
}

module.exports = { solveShot, decideShot, thinkDelay, botName };
