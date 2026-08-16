/**
 * main.js — точка входа Phaser.
 * Константы и оружие приходят из /shared/*.js (window.CONSTANTS, window.WEAPONS).
 */

const config = {
  type: Phaser.AUTO,
  width: window.CONSTANTS.MAP_WIDTH,
  height: window.CONSTANTS.MAP_HEIGHT,
  parent: 'canvas-wrapper',
  backgroundColor: '#020402',
  pixelArt: true,
  antialias: false,
  scene: [
    window.BootScene,
    window.GameScene,
    window.UIScene
  ],
  render: {
    pixelArt: true,
    antialias: false,
    autoRound: true,
    preserveDrawingBuffer: true   // иначе WebGL-канвас чёрный на скриншотах
  }
};

let game = null;

window.addEventListener('load', () => {
  game = new Phaser.Game(config);
  window.game = game; // отладочный доступ: window.game.scene.getScene('GameScene')
  console.log('Игра запущена');
});
