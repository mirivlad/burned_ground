/**
 * Снаряжение (UMD: сервер + браузер), обёрнуто в IIFE.
 *
 * В отличие от оружия предметы не летят, а меняют состояние танка:
 * щит поглощает урон, парашют гасит падение, ремкомплект чинит.
 * Оммаж классике: там же арсенал делился на снаряды и защиту.
 */

(function () {
  'use strict';

  const ITEMS = {
    shield: {
      id: 'shield',
      name: 'Щит',
      price: 300,
      kind: 'shield',
      strength: 60,               // сколько урона поглотит
      auto: true,                 // включается сам при покупке, если щита нет
      color: '#55ffff',
      description: 'Поглощает 60 урона. Работает, пока не разрушен'
    },
    heavy_shield: {
      id: 'heavy_shield',
      name: 'Тяжелый щит',
      price: 700,
      kind: 'shield',
      strength: 150,
      auto: true,
      color: '#55ffff',
      description: 'Поглощает 150 урона'
    },
    parachute: {
      id: 'parachute',
      name: 'Парашют',
      price: 200,
      packSize: 3,
      kind: 'parachute',
      auto: true,                 // раскрывается сам при падении
      color: '#ffffff',
      description: 'Гасит урон от падения. Раскрывается автоматически, тратится один на падение'
    },
    repair_kit: {
      id: 'repair_kit',
      name: 'Ремкомплект',
      price: 400,
      kind: 'repair',
      heal: 50,
      auto: false,                // применяется вручную в свой ход
      color: '#66ff66',
      description: 'Восстанавливает 50 HP. Применяется в свой ход'
    }
  };

  function getItem(itemId) {
    return ITEMS[itemId] || null;
  }

  const ItemsAPI = { ITEMS, getItem };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ItemsAPI;
  } else {
    window.ITEMS = ITEMS;
    window.ItemsAPI = ItemsAPI;
  }
})();
