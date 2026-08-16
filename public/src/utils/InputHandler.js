/**
 * Обработчик ввода
 * Управление с клавиатуры и мыши
 */

class InputHandler {
  constructor(scene) {
    this.scene = scene;
    this.keys = {};
    this.angle = 90;
    this.power = 70;
    this.onFireCallback = null;
    this.onAngleChangeCallback = null;

    this.setupKeyboard();
    this.setupSliders();
  }

  setupKeyboard() {
    // Обработка нажатий
    document.addEventListener('keydown', (e) => {
      // Стрелки - только если не в фокусе input
      if (document.activeElement.tagName === 'INPUT') return;
      
      // Блокируем прокрутку страницы стрелками
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }

      switch(e.code) {
        case 'ArrowLeft':
          this.angle = Math.min(180, this.angle + 1);
          this.updateAngleDisplay();
          if (this.onAngleChangeCallback) {
            this.onAngleChangeCallback(this.angle);
          }
          break;
        case 'ArrowRight':
          this.angle = Math.max(0, this.angle - 1);
          this.updateAngleDisplay();
          if (this.onAngleChangeCallback) {
            this.onAngleChangeCallback(this.angle);
          }
          break;
        case 'ArrowUp':
          this.power = Math.min(100, this.power + 1);
          this.updatePowerDisplay();
          break;
        case 'ArrowDown':
          this.power = Math.max(0, this.power - 1);
          this.updatePowerDisplay();
          break;
        case 'Space':
          if (this.onFireCallback) {
            this.onFireCallback(this.angle, this.power);
          }
          break;
      }
    });
  }

  setupSliders() {
    const angleSlider = document.getElementById('angle-slider');
    const powerSlider = document.getElementById('power-slider');

    if (angleSlider) {
      angleSlider.addEventListener('input', (e) => {
        this.angle = parseInt(e.target.value);
        this.updateAngleDisplay();
        if (this.onAngleChangeCallback) {
          this.onAngleChangeCallback(this.angle);
        }
      });
    }

    if (powerSlider) {
      powerSlider.addEventListener('input', (e) => {
        this.power = parseInt(e.target.value);
        this.updatePowerDisplay();
      });
    }
  }

  updateAngleDisplay() {
    const display = document.getElementById('angle-value');
    const slider = document.getElementById('angle-slider');
    if (display) display.textContent = this.angle;
    if (slider) slider.value = this.angle;
  }

  updatePowerDisplay() {
    const display = document.getElementById('power-value');
    const slider = document.getElementById('power-slider');
    if (display) display.textContent = this.power;
    if (slider) slider.value = this.power;
  }

  setAngle(angle) {
    this.angle = angle;
    this.updateAngleDisplay();
    // Вращаем ствол сразу (восстановление угла в начале хода)
    if (this.onAngleChangeCallback) {
      this.onAngleChangeCallback(this.angle);
    }
  }

  setPower(power) {
    this.power = power;
    this.updatePowerDisplay();
  }

  getAngle() {
    return this.angle;
  }

  getPower() {
    return this.power;
  }

  setOnFireCallback(callback) {
    this.onFireCallback = callback;
  }

  setOnAngleChangeCallback(callback) {
    this.onAngleChangeCallback = callback;
  }

  // Сброс состояния
  reset() {
    this.angle = 90;
    this.power = 70;
    this.updateAngleDisplay();
    this.updatePowerDisplay();
  }
}

window.InputHandler = InputHandler;
