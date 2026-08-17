/**
 * Общие константы игры (UMD: работают и в Node.js, и в браузере)
 * Единственный источник правды для сервера и клиента.
 * Все UMD-модули обёрнуты в IIFE: топ-левел const в классических
 * скриптах попадает в общий глобальный лексический скоуп страницы.
 */

(function () {
  'use strict';

  const MAP_WIDTH = 1280;
  const MAP_HEIGHT = 720;

  const GROUND_MIN_Y = 300;
  const GROUND_MAX_Y = 720;

  const PHYSICS = {
    gravity: 0.3,                    // ускорение снаряда, px/тик² (тик = 1 кадр ~16мс)
    windCoeff: 0.05,                 // влияние ветра на снаряд
    projectileMaxSpeed: 35,          // скорость при мощности 100
    projectileMinSpeed: 0.5,         // при мощности 0 снаряд падает под ноги (как в классике)
    tickMs: 50,                      // шаг серверной физики танков
    tankGravity: 2.4,                // ускорение падения танка, px/тик² (тик = 50мс)
    tankWidth: 32,
    tankHeight: 16,
    tankStabilityThreshold: 0.5,     // нужно >=50% опоры
    slideSlopeThreshold: 5,          // перепад высот для скатывания
    maxTrajectoryTicks: 1000,        // одинаково на сервере и клиенте
    stabilizationQuietTicks: 20,     // тиков покоя до конца стабилизации
    stabilizationTimeoutMs: 6000,
    crumbleMaxSlope: 3,              // осыпание: макс. перепад между соседними колонками
    crumblePasses: 40,
    fallDamageThreshold: 50,         // падение ниже порога безвредно
    fallDamageFactor: 0.5            // урон за пиксель сверх порога (250px = 100 урона)
  };

  const GAME = {
    minPlayers: 2,                   // мин. участников матча (боты считаются)
    maxPlayers: 4,                   // deprecated: рамка на слот ниже
    roundsInMatch: 5,
    turnTimeLimit: 60000,            // ровно 1 минута на выстрел
    roundPauseTime: 8000,
    interRoundTime: 20000,           // пауза между раундами: хост меняет слоты ботов
    startingMoney: 500,
    maxWind: 10,
    reconnectWindowMs: 120000        // 2 минуты на перезаход после обрыва связи
  };

  // Экономика: за что и сколько платят (единый источник для сервера и README)
  const ECONOMY = {
    perTerrainPixel: 1,              // $ за пиксель уничтоженного грунта
    perDamageHp: 5,                  // $ за единицу нанесенного урона
    perKill: 100                     // $ за уничтоженный танк
  };

  const ROOM = {
    maxSlots: 10,                    // максимум слотов в комнате
    codeLength: 5,
    emptyTTL: 10 * 60 * 1000,        // пустая комната живёт 10 минут
    shareBaseUrl: '',                // ссылка строится на клиенте от location.origin
    nameMaxLength: 24,
    passwordMaxLength: 24
  };

  const CHAT = {
    maxLength: 200,
    historySize: 50,        // сколько строк видит вошедший
    windowMs: 5000,
    maxPerWindow: 5         // антиспам: 5 сообщений за 5 секунд на сокет
  };

  // Границы настроек матча: хост крутит их в этих рамках, сервер клампит
  const SETTINGS_LIMITS = {
    rounds: { min: 1, max: 15, def: GAME.roundsInMatch },
    turnSec: { min: 15, max: 180, def: GAME.turnTimeLimit / 1000 },
    startMoney: { min: 0, max: 10000, step: 100, def: GAME.startingMoney },
    maxWind: { min: 0, max: 25, def: GAME.maxWind }
  };

  // Палитра: 10 хорошо различимых цветов на тёмном фоне
  const PALETTE = [
    { hex: 0x66ff66, css: '#66ff66', name: 'ЗЕЛЕНЫЙ' },
    { hex: 0xff5555, css: '#ff5555', name: 'КРАСНЫЙ' },
    { hex: 0x5599ff, css: '#5599ff', name: 'СИНИЙ' },
    { hex: 0xffd24a, css: '#ffd24a', name: 'ЖЕЛТЫЙ' },
    { hex: 0xff77ff, css: '#ff77ff', name: 'РОЗОВЫЙ' },
    { hex: 0x55ffff, css: '#55ffff', name: 'БИРЮЗОВЫЙ' },
    { hex: 0xffa640, css: '#ffa640', name: 'ОРАНЖЕВЫЙ' },
    { hex: 0xaa66ff, css: '#aa66ff', name: 'ФИОЛЕТОВЫЙ' },
    { hex: 0xb4ff4a, css: '#b4ff4a', name: 'САЛАТОВЫЙ' },
    { hex: 0xf0f0f0, css: '#f0f0f0', name: 'БЕЛЫЙ' }
  ];

  // Боты
  const BOT = {
    difficulties: ['easy', 'medium', 'hard'],
    names: {
      easy: ['Рекрут', 'Новобранец', 'Кадет'],
      medium: ['Сержант', 'Стрелок', 'Артиллерист'],
      hard: ['Гроссмейстер', 'Снайпер', 'Ветеран']
    },
    thinkDelayMs: { easy: [2500, 4500], medium: [1500, 3000], hard: [800, 2000] },
    aimNoise: { easy: { angle: 12, power: 18 }, medium: { angle: 4, power: 6 }, hard: { angle: 0, power: 0 } },
    randomShotChance: { easy: 0.25, medium: 0.05, hard: 0 },
    // Экономика: порог денег для покупки
    buyThreshold: { easy: Infinity, medium: 400, hard: 400 },
    nukeThreshold: { easy: Infinity, medium: Infinity, hard: 1100 }
  };

  const ANGLE = { min: 0, max: 180 };   // 0° = влево, 90° = вверх, 180° = вправо
  const POWER = { min: 0, max: 100 };

  const CONSTANTS = {
    MAP_WIDTH,
    MAP_HEIGHT,
    GROUND_MIN_Y,
    GROUND_MAX_Y,
    PHYSICS,
    GAME,
    ECONOMY,
    ROOM,
    CHAT,
    SETTINGS_LIMITS,
    PALETTE,
    BOT,
    ANGLE,
    POWER
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONSTANTS;
  } else {
    window.CONSTANTS = CONSTANTS;
  }
})();
