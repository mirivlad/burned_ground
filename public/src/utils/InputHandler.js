/**
 * Обработчик ввода: клавиатура, ползунки и числовые поля.
 * Угол и мощность можно набрать числом — как в оригинале, где значения
 * вводились с клавиатуры, а не подбирались стрелками.
 */

const ANGLE_MIN = 0;
const ANGLE_MAX = 180;
const POWER_MIN = 0;
const POWER_MAX = 100;

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
    this.setupNumberInputs();
  }

  setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Стрелки — только если не в фокусе поле ввода
      if (document.activeElement.tagName === 'INPUT') return;

      // Блокируем прокрутку страницы стрелками
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }

      // SHIFT — грубая наводка десятками
      const step = e.shiftKey ? 10 : 1;

      switch (e.code) {
        // 0° = влево, 180° = вправо: стрелка ведет ствол в свою сторону
        case 'ArrowLeft':
          this.setAngle(this.angle - step);
          break;
        case 'ArrowRight':
          this.setAngle(this.angle + step);
          break;
        case 'ArrowUp':
          this.setPower(this.power + step);
          break;
        case 'ArrowDown':
          this.setPower(this.power - step);
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
      angleSlider.addEventListener('input', (e) => this.setAngle(parseInt(e.target.value, 10)));
    }

    if (powerSlider) {
      powerSlider.addEventListener('input', (e) => this.setPower(parseInt(e.target.value, 10)));
    }
  }

  /**
   * Числовой ввод: Enter применяет значение и стреляет,
   * чтобы можно было работать одними цифрами.
   */
  setupNumberInputs() {
    const angleInput = document.getElementById('angle-value');
    const powerInput = document.getElementById('power-value');

    const bind = (input, apply) => {
      if (!input) return;

      input.addEventListener('change', () => apply(parseInt(input.value, 10)));
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        apply(parseInt(input.value, 10));
        input.blur();
        if (this.onFireCallback) this.onFireCallback(this.angle, this.power);
      });
    };

    bind(angleInput, (v) => this.setAngle(v));
    bind(powerInput, (v) => this.setPower(v));
  }

  updateAngleDisplay() {
    const input = document.getElementById('angle-value');
    const slider = document.getElementById('angle-slider');
    if (input && document.activeElement !== input) input.value = this.angle;
    if (slider) slider.value = this.angle;
  }

  updatePowerDisplay() {
    const input = document.getElementById('power-value');
    const slider = document.getElementById('power-slider');
    if (input && document.activeElement !== input) input.value = this.power;
    if (slider) slider.value = this.power;
  }

  setAngle(angle) {
    const value = Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, Math.round(Number(angle))));
    if (!Number.isFinite(value)) return;

    this.angle = value;
    this.updateAngleDisplay();
    // Вращаем ствол сразу (в том числе при восстановлении угла в начале хода)
    if (this.onAngleChangeCallback) {
      this.onAngleChangeCallback(this.angle);
    }
  }

  setPower(power) {
    const value = Math.max(POWER_MIN, Math.min(POWER_MAX, Math.round(Number(power))));
    if (!Number.isFinite(value)) return;

    this.power = value;
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
    this.setAngle(90);
    this.setPower(70);
  }
}

window.InputHandler = InputHandler;
