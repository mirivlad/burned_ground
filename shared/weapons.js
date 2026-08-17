/**
 * Определения оружия (UMD: сервер + браузер), обёрнуто в IIFE.
 *
 * Арсенал собран по мотивам Scorched Earth (DOS, 1991): линейки снарядов
 * идут ступенями (Baby -> обычный -> Heavy), рядом с фугасами живут
 * землеройные и землесыпные заряды, а дорогие игрушки вроде MIRV
 * и Death's Head закрывают верх экономики.
 */

(function () {
  'use strict';

  const WEAPONS = {
    // ==== Прямые фугасы ====
    baby_missile: {
      id: 'baby_missile',
      name: 'Baby Missile',
      price: 0,
      infinite: true,
      damage: 10,
      radius: 15,
      color: '#ffffff'
    },
    missile: {
      id: 'missile',
      name: 'Missile',
      price: 100,
      packSize: 2,
      infinite: false,
      damage: 25,
      radius: 22,
      color: '#ffdddd'
    },
    heavy_shot: {
      id: 'heavy_shot',
      name: 'Heavy Missile',
      price: 200,
      infinite: false,
      damage: 40,
      radius: 30,
      color: '#ff8844'
    },
    baby_nuke: {
      id: 'baby_nuke',
      name: 'Baby Nuke',
      price: 600,
      infinite: false,
      damage: 65,
      radius: 60,
      color: '#ffee99'
    },
    nuke: {
      id: 'nuke',
      name: 'Nuke',
      price: 1000,
      infinite: false,
      damage: 100,
      radius: 100,
      color: '#ffee44'
    },
    deaths_head: {
      id: 'deaths_head',
      name: "Death's Head",
      price: 2500,
      infinite: false,
      damage: 200,
      radius: 160,
      color: '#ff3355'
    },

    // ==== Катящиеся ====
    baby_roller: {
      id: 'baby_roller',
      name: 'Baby Roller',
      price: 150,
      infinite: false,
      damage: 20,
      radius: 15,
      effect: 'roller',
      color: '#ccffdd'
    },
    roller: {
      id: 'roller',
      name: 'Roller',
      price: 350,
      infinite: false,
      damage: 35,
      radius: 25,
      effect: 'roller',              // катится вниз по склону, взрыв в низине
      color: '#99ffcc'
    },
    heavy_roller: {
      id: 'heavy_roller',
      name: 'Heavy Roller',
      price: 700,
      infinite: false,
      damage: 55,
      radius: 40,
      effect: 'roller',
      color: '#66ffaa'
    },

    // ==== Кассетные и прыгающие ====
    leapfrog: {
      id: 'leapfrog',
      name: 'Leapfrog',
      price: 500,
      infinite: false,
      damage: 25,                    // на каждый прыжок
      radius: 20,
      effect: 'leapfrog',            // взрывается и скачет дальше по ходу полета
      hops: 3,
      hopDistance: 55,
      color: '#aaff55'
    },
    funky_bomb: {
      id: 'funky_bomb',
      name: 'Funky Bomb',
      price: 550,
      infinite: false,
      damage: 20,                    // на каждый заряд
      radius: 18,
      effect: 'funky',               // рассыпается веером зарядов
      cluster: 6,
      spread: 75,
      color: '#ff77ff'
    },
    mirv: {
      id: 'mirv',
      name: 'MIRV',
      price: 800,
      infinite: false,
      damage: 25,                    // на боеголовку (их три)
      radius: 20,
      effect: 'mirv',                // распад на 3 боеголовки в апексе
      color: '#ffdd55'
    },

    // ==== Огонь ====
    napalm: {
      id: 'napalm',
      name: 'Napalm',
      price: 450,
      infinite: false,
      damage: 15,                    // на огненный шар
      radius: 12,
      effect: 'napalm',              // горящая жидкость течет вниз по склону
      color: '#ff6622'
    },
    hot_napalm: {
      id: 'hot_napalm',
      name: 'Hot Napalm',
      price: 800,
      infinite: false,
      damage: 25,
      radius: 16,
      effect: 'napalm',
      color: '#ff3300'
    },

    // ==== Земляные работы ====
    digger: {
      id: 'digger',
      name: 'Digger',
      price: 250,
      infinite: false,
      damage: 15,
      radius: 16,
      effect: 'digger',              // прогрызает шахту вниз
      depth: 4,
      color: '#c8a165'
    },
    riot_charge: {
      id: 'riot_charge',
      name: 'Riot Charge',
      price: 120,
      packSize: 2,
      infinite: false,
      damage: 5,
      radius: 50,                    // широкий и почти безвредный: расчищает грунт
      color: '#d9d9d9'
    },
    dirt_ball: {
      id: 'dirt_ball',
      name: 'Dirt Ball',
      price: 150,
      infinite: false,
      damage: 0,
      radius: 30,                  // радиус холма из земли
      effect: 'add_earth',         // поднимает ландшафт
      color: '#8b5a2b'
    },
    ton_of_dirt: {
      id: 'ton_of_dirt',
      name: 'Ton of Dirt',
      price: 400,
      infinite: false,
      damage: 0,
      radius: 55,
      effect: 'add_earth',
      color: '#6f4520'
    },

    // ==== Пристрелка ====
    smoke_tracer: {
      id: 'smoke_tracer',
      name: 'Smoke Tracer',
      price: 25,
      packSize: 5,                    // продается пачкой
      infinite: false,
      damage: 0,
      radius: 4,
      effect: 'smoke',                // без урона и кратера: пристрелка
      color: '#cccccc'
    }
  };

  const BASE_WEAPON_ID = 'baby_missile';

  function getWeapon(weaponId) {
    return WEAPONS[weaponId] || null;
  }

  function isBaseWeapon(weaponId) {
    return weaponId === BASE_WEAPON_ID;
  }

  const WeaponsAPI = { WEAPONS, BASE_WEAPON_ID, getWeapon, isBaseWeapon };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = WeaponsAPI;
  } else {
    window.WEAPONS = WEAPONS;
    window.WeaponsAPI = WeaponsAPI;
  }
})();
