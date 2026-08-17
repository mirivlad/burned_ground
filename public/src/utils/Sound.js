/**
 * Звуки без ассетов: синтез WebAudio.
 * Браузер блокирует автозапуск — unlock() вызывается на первом жесте пользователя.
 */

class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.25;
    this.master.connect(this.ctx.destination);

    // Буфер белого шума (2с) — основа взрывов и выстрелов
    const len = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  noise({ duration = 0.3, filterType = 'lowpass', freq = 800, gain = 1, freqEnd = null }) {
    if (!this.ready()) return;

    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, t);
    if (freqEnd !== null) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 20), t + duration);
    }

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + duration);

    src.connect(filter).connect(env).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  tone({ freq = 440, freqEnd = null, duration = 0.2, type = 'square', gain = 0.5 }) {
    if (!this.ready()) return;

    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 20), t + duration);
    }

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + duration);

    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  // ==== Игровые события ====

  shot() {
    this.noise({ duration: 0.18, filterType: 'bandpass', freq: 1800, freqEnd: 400, gain: 0.7 });
    this.tone({ freq: 300, freqEnd: 80, duration: 0.2, type: 'triangle', gain: 0.3 });
  }

  projectileFlight(durationMs) {
    const duration = Math.max(0.12, Math.min((durationMs || 0) / 1000, 1.5));
    this.noise({ duration, filterType: 'bandpass', freq: 1800, freqEnd: 700, gain: 0.06 });
    this.tone({ freq: 1100, freqEnd: 650, duration, type: 'triangle', gain: 0.045 });
  }

  smoke() {
    this.noise({ duration: 0.35, filterType: 'highpass', freq: 3000, freqEnd: 6000, gain: 0.25 });
  }

  explosion(radius) {
    const r = Math.max(radius || 15, 10);
    this.noise({
      duration: Math.min(0.4 + r / 100, 1.4),
      filterType: 'lowpass',
      freq: 900,
      freqEnd: 60,
      gain: Math.min(0.6 + r / 120, 1.2)
    });
    this.tone({ freq: 90, freqEnd: 30, duration: 0.5 + r / 200, type: 'sine', gain: 0.5 });
  }

  fall(distance) {
    // Свист падения
    this.tone({
      freq: 1200,
      freqEnd: 200,
      duration: Math.min(0.2 + (distance || 50) / 400, 0.8),
      type: 'sawtooth',
      gain: 0.15
    });
  }

  click() {
    this.tone({ freq: 700, duration: 0.05, type: 'square', gain: 0.2 });
  }

  coin() {
    this.tone({ freq: 900, duration: 0.08, type: 'square', gain: 0.2 });
    setTimeout(() => this.tone({ freq: 1350, duration: 0.1, type: 'square', gain: 0.2 }), 70);
  }
}

window.sound = new Sound();

// Разблокировка звука на первом жесте пользователя
['keydown', 'pointerdown', 'click'].forEach(ev => {
  window.addEventListener(ev, () => window.sound.unlock(), { once: false, passive: true });
});
