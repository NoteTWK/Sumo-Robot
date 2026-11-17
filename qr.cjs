'use strict';

// QR Model 2, version 4-L, byte mode, mask pattern 0.
const size = 33;
const dataBytes = 80;
const errorBytes = 20;

function multiply(a, b) {
  let product = 0;
  while (b) {
    if (b & 1) product ^= a;
    a = (a << 1) ^ (a & 0x80 ? 0x11d : 0);
    b >>>= 1;
  }
  return product;
}

function withErrorCorrection(data) {
  let divisor = [1];
  let root = 1;
  for (let i = 0; i < errorBytes; i++) {
    const next = new Array(divisor.length + 1).fill(0);
    for (let j = 0; j < divisor.length; j++) {
      next[j] ^= divisor[j];
      next[j + 1] ^= multiply(divisor[j], root);
    }
    divisor = next;
    root = multiply(root, 2);
  }

  const remainder = Uint8Array.from([...data, ...new Uint8Array(errorBytes)]);
  for (let i = 0; i < data.length; i++) {
    const factor = remainder[i];
    for (let j = 0; j < divisor.length; j++) {
      remainder[i + j] ^= multiply(divisor[j], factor);
    }
  }
  return [...data, ...remainder.subarray(data.length)];
}

function encode(text) {
  const payload = Buffer.from(text, 'utf8');
  if (payload.length > 78) throw new RangeError('QR payload exceeds 78 bytes');

  const bits = [];
  function append(value, width) {
    for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  }

  append(4, 4);
  append(payload.length, 8);
  for (const byte of payload) append(byte, 8);
  append(0, 4);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    data.push(byte);
  }
  for (let pad = 0xec; data.length < dataBytes; pad ^= 0xec ^ 0x11) {
    data.push(pad);
  }
  return withErrorCorrection(data);
}

function buildMatrix(codewords) {
  const matrix = Array.from({ length: size }, () => new Array(size));
  const set = (x, y, value) => { matrix[y][x] = value; };

  // Timing tracks are drawn first so finder patterns and separators can cover their ends.
  for (let i = 0; i < size; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let y = Math.max(0, cy - 4); y <= Math.min(size - 1, cy + 4); y++) {
      for (let x = Math.max(0, cx - 4); x <= Math.min(size - 1, cx + 4); x++) {
        const distance = Math.max(Math.abs(x - cx), Math.abs(y - cy));
        set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      set(26 + dx, 26 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  // Encoded and masked format string for correction level L and mask 0.
  const format = 0x77c4;
  const formatBit = (i) => Boolean((format >>> i) & 1);
  for (let i = 0; i <= 5; i++) set(8, i, formatBit(i));
  set(8, 7, formatBit(6));
  set(8, 8, formatBit(7));
  set(7, 8, formatBit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, formatBit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, formatBit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, formatBit(i));
  set(8, size - 8, true);

  let bitIndex = 0;
  let upward = true;
  for (let column = size - 1; column >= 1; column -= 2) {
    if (column === 6) column--;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [column, column - 1]) {
        if (matrix[y][x] !== undefined) continue;
        const bit = (codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1;
        const mask = (x + y) % 2 === 0;
        set(x, y, Boolean(bit) !== mask);
        bitIndex++;
      }
    }
    upward = !upward;
  }
  return matrix;
}

function qrSvg(text) {
  const border = 4;
  const extent = size + border * 2;
  const matrix = buildMatrix(encode(text));
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (matrix[y][x]) path += `M${x + border},${y + border}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" shape-rendering="crispEdges"><rect width="${extent}" height="${extent}" fill="white"/><path d="${path}"/></svg>`;
}

module.exports = { qrSvg };
