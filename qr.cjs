'use strict';
const QRCode = require('qrcode');

function qrSvg(text) {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const border = 4, size = modules.size, extent = size + border * 2;
  let path = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (modules.get(y, x)) path += `M${x + border},${y + border}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" shape-rendering="crispEdges"><rect width="${extent}" height="${extent}" fill="white"/><path d="${path}"/></svg>`;
}
module.exports = { qrSvg };
