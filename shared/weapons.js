/**
 * Определения оружия (UMD: сервер + браузер), обёрнуто в IIFE
 */

(function () {
  'use strict';

  const WEAPONS = {
    baby_missile: {
      id: 'baby_missile',
      name: 'Baby Missile',
      price: 0,
      infinite: true,
      damage: 10,
      radius: 15,
      color: '#ffffff'
    },
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
    },
    heavy_shot: {
      id: 'heavy_shot',
      name: 'Heavy Shot',
      price: 200,
      infinite: false,
      damage: 40,
      radius: 30,
      color: '#ff8844'
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
    nuke: {
      id: 'nuke',
      name: 'Nuke',
      price: 1000,
      infinite: false,
      damage: 100,
      radius: 100,
      color: '#ffee44'
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
