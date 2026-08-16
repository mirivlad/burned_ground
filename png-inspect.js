/**
 * Локальный анализ PNG: декодирование + цветовая карта скриншота.
 * Проверяет: градиент неба, песочный грунт, чёрную кромку, крапинку, танки.
 * Использование: node png-inspect.js <file.png> [tankX:tankY:expectedCss ...]
 */
const fs = require('fs');
const zlib = require('zlib');

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;

    pos += 12 + len;
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`unsupported PNG: depth=${bitDepth} color=${colorType}`);
  }

  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const pixels = Buffer.alloc(width * height * 3);

  let prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = Buffer.alloc(stride);

    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;

      let v = line[i];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
          v = (v + pr) & 0xff; break;
        }
      }
      cur[i] = v;
    }

    for (let x = 0; x < width; x++) {
      pixels[(y * width + x) * 3] = cur[x * bpp];
      pixels[(y * width + x) * 3 + 1] = cur[x * bpp + 1];
      pixels[(y * width + x) * 3 + 2] = cur[x * bpp + 2];
    }
    prev = cur;
  }

  return { width, height, pixels };
}

const css = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');

// ==== Запуск ====
const file = process.argv[2];
const img = decodePNG(fs.readFileSync(file));
const { width, height, pixels } = img;

const px = (x, y) => {
  x = Math.max(0, Math.min(width - 1, Math.round(x)));
  y = Math.max(0, Math.min(height - 1, Math.round(y)));
  const i = (y * width + x) * 3;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
};

console.log(`Файл: ${file} (${width}x${height})`);

// 1) Градиент неба: столбец x=600, от 20 до 400 с шагом 60
console.log('\n--- НЕБО (x=600, сверху вниз) ---');
for (let y = 20; y <= 400; y += 60) {
  const [r, g, b] = px(600, y);
  console.log(`y=${String(y).padStart(3)}: ${css(r, g, b)}  rgb(${r},${g},${b})`);
}

// 2) Поверхность земли: столбец x=200, ищем первый песочный пиксель
console.log('\n--- ГРУНТ (x=200) ---');
let surfY = -1;
for (let y = 0; y < height; y++) {
  const [r, g, b] = px(200, y);
  if (r > 140 && r < 190 && g > 120 && g < 160 && b > 70 && b < 110) { surfY = y; break; }
}
if (surfY > 0) {
  const above = px(200, surfY - 3);
  const at = px(200, surfY);
  console.log(`поверхность y=${surfY}: ${css(...at)} (эталон #a68b5b)`);
  console.log(`на 3px выше: ${css(...above)} (ожидаем тёмную кромку или небо)`);

  // Крапинка: тёмные пиксели в теле земли на глубинах +10..+60
  let dark = 0, total = 0;
  for (let d = 10; d <= 60; d += 2) {
    for (let dx = -30; dx <= 30; dx += 2) {
      const [r, g, b] = px(200 + dx, surfY + d);
      total++;
      if (r < 145 && g < 120) dark++;
    }
  }
  console.log(`крапинка: ${dark}/${total} тёмных пикселей в теле земли`);
} else {
  console.log('ПОВЕРХНОСТЬ НЕ НАЙДЕНА!');
}

// 3) Танки: аргументы X:Y:ожидаемыйЦвет
const tankArgs = process.argv.slice(3);
if (tankArgs.length) {
  console.log('\n--- ТАНКИ ---');
  for (const arg of tankArgs) {
    const [tx, ty, expected] = arg.split(':');
    let found = null;
    // ищем в окрестности 30x25 ожидаемый цвет
    for (let dy = -25; dy <= 5 && !found; dy++) {
      for (let dx = -20; dx <= 20 && !found; dx++) {
        const c = css(...px(+tx + dx, +ty + dy));
        if (c === expected.toLowerCase()) found = { dx, dy, c };
      }
    }
    console.log(`танк @(${tx},${ty}) ожидает ${expected}: ${found ? `найден (смещение ${found.dx},${found.dy})` : 'НЕ НАЙДЕН'}`);
  }
}
