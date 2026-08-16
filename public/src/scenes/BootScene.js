/**
 * BootScene — стартовый запуск сцен и подключение к серверу
 */

class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  create() {
    // Подключаемся к серверу (события сокета асинхронны, слушатели успеют
    // зарегистрироваться в GameScene/UIScene)
    window.network.connect();

    this.scene.start('GameScene');
    this.scene.launch('UIScene');
  }
}

window.BootScene = BootScene;
