/**
 * Физика снарядов и танков (UMD: сервер + браузер), обёрнуто в IIFE.
 * Клиент использует calculateProjectileTrajectory для анимации,
 * сервер — все функции для авторитетных расчетов.
 */

(function () {
  'use strict';

  const C = (typeof require !== 'undefined')
    ? require('./constants')
    : window.CONSTANTS;

  const PH = C.PHYSICS;
  const MAP_W = C.MAP_WIDTH;
  const MAP_H = C.MAP_HEIGHT;

  /**
   * Расчет траектории снаряда. Идентична на сервере и клиенте.
   * Система углов: 0° = влево, 90° = вверх, 180° = вправо.
   * @returns {Object[]} массив позиций по тикам, последний элемент — точка падения
   */
  /**
   * Скорость снаряда пропорциональна мощности: 0 — снаряд падает под ноги,
   * 100 — максимальная дальность. Раньше при нулевой мощности снаряд все
   * равно улетал с базовой скоростью 15, и ближний навес был невозможен.
   */
  function speedFromPower(power) {
    const p = Math.max(0, Math.min(100, Number(power) || 0));
    return Math.max(PH.projectileMinSpeed, (p / 100) * PH.projectileMaxSpeed);
  }

  function calculateProjectileTrajectory({ startX, startY, angle, power, wind, heights }) {
    const trajectory = [];

    const angleRad = (angle * Math.PI) / 180;
    const speed = speedFromPower(power);

    let vx = -Math.cos(angleRad) * speed;
    let vy = -Math.sin(angleRad) * speed;

    let x = startX;
    let y = startY;

    for (let i = 0; i < PH.maxTrajectoryTicks; i++) {
      trajectory.push({ x, y });

      if (x < 0 || x >= MAP_W || y > MAP_H) break;

      const xi = Math.floor(x);
      if (heights && xi >= 0 && xi < heights.length && y >= heights[xi]) break;

      x += vx;
      y += vy;
      vy += PH.gravity;
      vx += wind * PH.windCoeff;
    }

    return trajectory;
  }

  /**
   * Урон от взрыва: падает линейно с расстоянием.
   */
  function calculateExplosionDamage(distance, explosionRadius, baseDamage) {
    if (distance >= explosionRadius || explosionRadius <= 0) return 0;
    const damageMultiplier = 1 - (distance / explosionRadius);
    return Math.round(baseDamage * damageMultiplier);
  }

  /**
   * Урон от падения: до порога безвредно, дальше линейно.
   * Падение с ~250px убивает танк (как в классике).
   */
  function calculateFallDamage(fallDistance) {
    if (fallDistance <= PH.fallDamageThreshold) return 0;
    return Math.round((fallDistance - PH.fallDamageThreshold) * PH.fallDamageFactor);
  }

  /**
   * Обновление физики танка: опора, падение, скатывание.
   * Мутирует переданный танк. Один вызов = один тик (PHYSICS.tickMs).
   * @returns {{moved: boolean, landed: boolean, fallDistance: number, stabilized: boolean}}
   */
  function updateTankPhysics(tank, heights) {
    const result = { moved: false, landed: false, fallDistance: 0, stabilized: false };

    if (tank.isAlive === false) return result;

    const support = checkTankSupport(tank, heights);

    if (!support.hasSupport) {
      // Свободное падение
      tank.velocityY = (tank.velocityY || 0) + PH.tankGravity;
      tank.y += tank.velocityY;
      result.moved = true;

      const xi = Math.max(0, Math.min(heights.length - 1, Math.floor(tank.x)));
      const groundY = heights[xi];
      if (tank.y >= groundY) {
        result.fallDistance = Math.max(0, tank.y - groundY);
        tank.y = groundY;
        tank.velocityY = 0;
        result.landed = true;
      }
    } else {
      // На земле: прижимаем к поверхности
      const xi = Math.max(0, Math.min(heights.length - 1, Math.floor(tank.x)));
      if (tank.y !== heights[xi]) {
        tank.y = heights[xi];
        result.moved = true;
      }
      tank.velocityY = 0;

      // Скатывание по склону
      const slope = checkSlope(tank, heights);
      if (slope.shouldSlide) {
        tank.x += slope.direction;
        result.moved = true;
      } else {
        result.stabilized = true;
      }
    }

    const newX = Math.max(0, Math.min(MAP_W - 1, tank.x));
    if (newX !== tank.x) {
      tank.x = newX;
      result.moved = true;
    }

    return result;
  }

  /**
   * Правило 50% опоры: танк стоит, если земля есть под >= половиной ширины.
   */
  function checkTankSupport(tank, heights) {
    const halfWidth = PH.tankWidth / 2;
    const leftX = Math.floor(tank.x - halfWidth);
    const rightX = Math.floor(tank.x + halfWidth);

    let contactCount = 0;
    let totalCount = 0;

    for (let x = leftX; x <= rightX; x++) {
      if (x >= 0 && x < heights.length) {
        totalCount++;
        if (heights[x] <= tank.y) contactCount++;
      }
    }

    const supportRatio = totalCount > 0 ? contactCount / totalCount : 0;
    return { hasSupport: supportRatio >= PH.tankStabilityThreshold, supportRatio };
  }

  /**
   * Скатывание: если под гусеницами перепад больше порога, танк съезжает вниз.
   */
  function checkSlope(tank, heights) {
    const halfWidth = PH.tankWidth / 2;
    const leftX = Math.max(0, Math.floor(tank.x - halfWidth));
    const rightX = Math.min(heights.length - 1, Math.floor(tank.x + halfWidth));

    const leftHeight = heights[leftX];
    const rightHeight = heights[rightX];
    const heightDiff = Math.abs(leftHeight - rightHeight);

    if (heightDiff < PH.slideSlopeThreshold) {
      return { shouldSlide: false };
    }

    // Скатываемся туда, где земля ниже (больше Y)
    const direction = leftHeight > rightHeight ? -1 : 1;
    return { shouldSlide: true, direction };
  }

  /**
   * MIRV: снаряд летит до апекса, там распадается на 3 боеголовки
   * с разносом горизонтальной скорости. Все траектории детерминированы —
   * сервер и клиент анимируют одинаково.
   * @returns {{apexTicks:number, main:[], warheads:{trajectory:[], impact:{x,y}}[]}}
   */
  function simulateMirv({ startX, startY, angle, power, wind, heights }) {
    const angleRad = (angle * Math.PI) / 180;
    const speed = speedFromPower(power);

    let vx = -Math.cos(angleRad) * speed;
    let vy = -Math.sin(angleRad) * speed;

    let x = startX;
    let y = startY;
    const main = [];
    let apexTicks = 0;

    // Полет до апекса (vy >= 0)
    for (let t = 0; t < PH.maxTrajectoryTicks; t++) {
      main.push(Math.round(x), Math.round(y));
      if (x < 0 || x >= MAP_W || y > MAP_H) break;

      const xi = Math.floor(x);
      if (heights && xi >= 0 && xi < heights.length && y >= heights[xi]) break;

      if (vy >= 0 && t > 0) { apexTicks = t; break; } // апекс

      x += vx;
      y += vy;
      vy += PH.gravity;
      vx += wind * PH.windCoeff;
      apexTicks = t + 1;
    }

    // Три боеголовки из апекса
    const warheads = [];
    for (const dv of [-2.5, 0, 2.5]) {
      let wx = x, wy = y, wvx = vx + dv, wvy = 0;
      const trajectory = [];

      for (let t = 0; t < PH.maxTrajectoryTicks; t++) {
        trajectory.push(Math.round(wx), Math.round(wy));
        if (wx < 0 || wx >= MAP_W || wy > MAP_H) break;

        const xi = Math.floor(wx);
        if (heights && xi >= 0 && xi < heights.length && wy >= heights[xi]) break;

        wx += wvx;
        wy += wvy;
        wvy += PH.gravity;
        wvx += wind * PH.windCoeff;
      }

      warheads.push({ trajectory, impact: { x: wx, y: wy } });
    }

    return { apexTicks, main, warheads };
  }

  const PhysicsAPI = {
    speedFromPower,
    calculateProjectileTrajectory,
    calculateExplosionDamage,
    calculateFallDamage,
    updateTankPhysics,
    checkTankSupport,
    checkSlope,
    simulateMirv
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PhysicsAPI;
  } else {
    window.SharedPhysics = PhysicsAPI;
  }
})();
