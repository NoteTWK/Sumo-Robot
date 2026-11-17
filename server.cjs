'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { Game, ROBOTS, ARENAS } = require('./game.cjs');
const { qrSvg } = require('./qr.cjs');
const { WebSocketServer, WebSocket } = require('ws');

const port = Number(process.env.PORT || 8787);
const publicDir = path.join(__dirname, 'public');
const game = new Game();
const codes = [0, 1].map(() => randomBytes(8).toString('hex'));
const session = randomBytes(8).toString('hex');
const tvKey = randomBytes(16).toString('hex');
const tvCookie = 'robot_sumo_tv';
const controllers = [null, null];
const padSockets = [null, null];
const receipts = [new Map(), new Map()];
const ready = [false, false];
const robotChoices = ROBOTS.map(({ id, name, color, skill, ult }) => ({ id, name, color, skill, ult }));
const INPUT_TIMEOUT = 175;
const PAD_TIMEOUT = 1400;
const browserClients = new Set();
let practice = false;
let lastTime = performance.now();
const keySeen = [0, 0];

function networkHosts() {
  return [...new Set(Object.values(os.networkInterfaces()).flat().filter(
    address => address.family === 'IPv4' && !address.internal && !address.address.startsWith('169.254.')
  ).map(address => address.address))];
}

function publish() {
  const state = game.snapshot();
  const data = 'data: ' + JSON.stringify({ ...state, practice, ready, session }) + '\n\n';
  for (const client of browserClients) {
    if (client.writableLength < 12000) client.write(data);
  }
  padSockets.forEach((socket, player) => {
    if (socket?.readyState !== WebSocket.OPEN || !controllers[player]) return;
    if (socket.bufferedAmount > 16384) return socket.terminate();
    socket.send(JSON.stringify({ type: 'state', ...padState(player, socket.receipt, state) }));
  });
}

function disconnectPad(player) {
  const socket = padSockets[player];
  padSockets[player] = null;
  controllers[player] = null;
  if (game.phase === 'lobby') ready[player] = false;
  game.setConnected(player, false);
  if (socket?.readyState === WebSocket.OPEN) socket.close(4001, 'Controller released');
}

let steps = 0;
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.06, (now - lastTime) / 1000);
  lastTime = now;
  if (!practice) {
    controllers.forEach((controller, i) => {
      if (!controller) return;
      const age = now - controller.seen;
      if (age > PAD_TIMEOUT) {
        disconnectPad(i);
      } else if (age > INPUT_TIMEOUT && controller.moving) {
        game.input(i, { x: 0, y: 0 });
        controller.moving = false;
      }
    });
  } else {
    keySeen.forEach((seen, i) => {
      if (seen && now - seen > 450) {
        keySeen[i] = 0;
        game.input(i, { x: 0, y: 0 });
      }
    });
  }
  game.tick(dt);
  if (++steps % 2 === 0 && (browserClients.size || padSockets.some(Boolean))) publish();
}, 1000 / 60);

const mimetypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg' };

function respond(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2048) throw new Error('Request too large');
  }
  return JSON.parse(body || '{}');
}

function streamMusic(req, res, file) {
  const filename = path.join(publicDir, file);
  const size = fs.statSync(filename).size;
  let start = 0;
  let end = size - 1;
  const headers = { 'Content-Type': mimetypes['.mp3'], 'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      if (match[1]) {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      } else {
        start = Math.max(0, size - Number(match[2]));
      }
    }
    if (!match || (!match[1] && !match[2]) || start > end) {
      res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + size });
      return res.end();
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  res.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': end - start + 1 });
  const stream = fs.createReadStream(filename, { start, end });
  stream.on('error', error => res.destroy(error));
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

function setPractice(enabled) {
  practice = enabled;
  for (const player of [0, 1]) disconnectPad(player);
  ready.fill(false);
  keySeen.fill(0);
  for (const player of [0, 1]) {
    game.input(player, { x: 0, y: 0 });
    game.setConnected(player, enabled);
  }
}

function configure(config) {
  const previous = game.config.robots;
  if (game.configure(config)) {
    game.config.robots.forEach((robot, i) => {
      if (robot !== previous[i]) ready[i] = false;
    });
  }
}

function selectRobot(player, step) {
  if ((player !== 0 && player !== 1) || (step !== -1 && step !== 1) || game.phase !== 'lobby') return;
  const robots = [...game.config.robots];
  robots[player] = (robots[player] + step + ROBOTS.length) % ROBOTS.length;
  configure({ robots });
}

function padReceipt(player, id) {
  const recent = receipts[player];
  if (!recent.has(id)) {
    if (recent.size >= 12) recent.delete(recent.keys().next().value);
    recent.set(id, { packet: 0, ack: 0 });
  }
  return recent.get(id);
}

function handlePadAction(player, receipt, action) {
  if (!action || !Number.isSafeInteger(action.seq) || action.seq <= receipt.ack) return {};
  receipt.ack = action.seq;
  const { kind, age } = action;
  const ability = kind === 'skill' || kind === 'ult';
  if (!Number.isFinite(age) || age < 0 || age > (ability ? 350 : 1200)) return {};
  if (ability) return { [kind]: true };
  if ((kind === 'replay' || kind === 'home') && game.phase === 'final' && !game.falling) {
    if (kind === 'replay') game.start(5);
    else {
      game.home();
      ready.fill(false);
    }
    return {};
  }
  if (game.phase !== 'lobby') return {};
  if (kind === 'robot') selectRobot(player, action.step);
  if (kind === 'ready' && typeof action.value === 'boolean') {
    ready[player] = action.value;
    if (ready.every(Boolean)) game.start(5);
  }
  return {};
}

function padState(player, receipt, state = game.snapshot()) {
  return {
    player, phase: state.phase, falling: state.falling, connected: state.connected, remaining: state.remaining,
    showcase: state.showcase, winner: state.winner, score: state.score, go: state.go,
    round: state.round, fighter: state.fighters[player], name: ROBOTS[state.config.robots[player]].name,
    ack: receipt.ack, robot: state.config.robots[player], robots: robotChoices, ready, session
  };
}

function receivePad(player, data, socket) {
  if (practice) return { status: 409, error: 'KEYBOARD MODE' };
  if (!data || typeof data.id !== 'string' || !/^[a-f0-9]{24}$/.test(data.id) ||
      !Number.isSafeInteger(data.packet) || data.packet <= 0) return { status: 400, error: 'Invalid packet' };
  if (socket?.padId && socket.padId !== data.id) return { status: 400, error: 'Controller changed' };
  const now = performance.now();
  if (controllers[player] && now - controllers[player].seen > PAD_TIMEOUT) disconnectPad(player);
  const current = controllers[player];
  if (current && current.id !== data.id) return { status: 409, error: 'CONTROLLER SLOT IN USE' };
  const receipt = padReceipt(player, data.id);
  if (data.packet > receipt.packet) {
    receipt.packet = data.packet;
    if (data.release) {
      if (current?.id === data.id) disconnectPad(player);
      return { status: 200, body: { ok: true, ack: receipt.ack } };
    }
    if (socket) {
      const prior = padSockets[player];
      padSockets[player] = socket;
      socket.padId = data.id;
      socket.receipt = receipt;
      if (prior && prior !== socket) prior.close(4001, 'Connection replaced');
    }
    controllers[player] = { id: data.id, seen: now, moving: Boolean(data.x || data.y) };
    game.setConnected(player, true);
    const action = handlePadAction(player, receipt, data.action);
    game.input(player, { x: data.x, y: data.y, ...action });
  }
  return { status: 200, body: padState(player, receipt) };
}

function allowedHost(host) {
  return host && ['localhost', '127.0.0.1', ...networkHosts()].some(ip => host === ip + ':' + port);
}

const server = http.createServer(async (req, res) => {
  try {
    const local = req.socket.remoteAddress === '127.0.0.1';
    const hosts = networkHosts();
    const host = req.headers.host;
    if (!allowedHost(host)) {
      return respond(res, 403, { error: 'Unknown host' });
    }
    const url = new URL(req.url, 'http://' + host);
    const route = url.pathname;
    const joining = !local && req.method === 'GET' && route === '/' && url.searchParams.get('tv') === tvKey;
    const authorizedTv = (req.headers.cookie || '').split(';')
      .some(cookie => cookie.trim() === tvCookie + '=' + tvKey);
    const screenAccess = local || authorizedTv || joining;
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (joining) {
      res.setHeader('Set-Cookie', tvCookie + '=' + tvKey + '; Path=/; HttpOnly; SameSite=Strict');
    }
    const code = url.searchParams.get('k');
    const player = codes.indexOf(code);
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== 'http://' + host) {
      return respond(res, 403, { error: 'Unknown origin' });
    }

    if (route === '/api/setup' && req.method === 'GET') {
      if (!screenAccess) return respond(res, 403, { error: 'Open a new TV share link' });
      const links = hosts.map(ip => {
        const base = 'http://' + ip + ':' + port;
        return {
          ip,
          urls: codes.map(k => base + '/pad?k=' + k),
          tvUrl: local ? base + '/?tv=' + tvKey : undefined
        };
      });
      if (!links.length) links.push({ ip: '127.0.0.1', urls: codes.map(k => 'http://127.0.0.1:' + port + '/pad?k=' + k) });
      return respond(res, 200, { robots: ROBOTS, arenas: ARENAS, links, session });
    }
    if (route === '/api/events' && req.method === 'GET' && screenAccess) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      browserClients.add(res);
      res.on('close', () => browserClients.delete(res));
      publish();
      return;
    }
    if (route === '/api/qr' && req.method === 'GET' && screenAccess) {
      const ip = url.searchParams.get('ip');
      if (player < 0 || ![...hosts, '127.0.0.1'].includes(ip)) return respond(res, 400, {});
      return respond(res, 200, qrSvg('http://' + ip + ':' + port + '/pad?k=' + code), 'image/svg+xml');
    }
    if (route === '/api/host' && req.method === 'POST' && screenAccess) {
      const data = await readBody(req);
      const { phase, showcase } = game.snapshot();
      switch (data.action) {
        case 'configure':
          if (phase === 'lobby') configure(data.config);
          break;
        case 'select-robot':
          selectRobot(data.player, data.step);
          break;
        case 'practice':
          if (phase === 'lobby') setPractice(Boolean(data.enabled));
          break;
        case 'start':
          if (showcase) game.start(practice ? 3 : 5);
          else if (phase === 'lobby' && practice) game.start();
          break;
        case 'home':
          game.home();
          ready.fill(false);
          break;
        case 'key':
          if (practice && (data.player === 0 || data.player === 1)) {
            keySeen[data.player] = performance.now();
            game.input(data.player, data);
          }
          break;
        default:
          return respond(res, 400, { error: 'Unknown action' });
      }
      publish();
      return respond(res, 200, { ok: true });
    }
    if (route === '/api/pad' && req.method === 'POST' && player >= 0) {
      const data = await readBody(req);
      const result = receivePad(player, data);
      return respond(res, result.status, result.body || { error: result.error });
    }
    if (req.method === 'GET') {
      let file = route.slice(1);
      if (route === '/') {
        if (!screenAccess) {
          return respond(res, 403, 'ให้เปิดลิงก์จากปุ่ม “แชร์หน้าเกม” บนเครื่องที่รัน Robot Sumo',
            'text/plain; charset=utf-8');
        }
        file = 'index.html';
      }
      if (route === '/pad' && player >= 0) file = 'pad.html';
      const permitted = ['index.html', 'pad.html', 'screen.js', 'pad.js', 'render.js', 'style.css',
        'audio.js', 'effects.js', 'home.css', 'pad-extra.css'];
      const music = screenAccess && ['music-home.mp3', 'music-match.mp3'].includes(file);
      if (music) return streamMusic(req, res, file);
      const photo = /^robot-[0-5]\.jpg$/.test(file) ||
        /^home-(?:reference\.png|robot-[0-5]\.png|arena-[1-4]\.png|backing\.jpg)$/.test(file);
      if ((!permitted.includes(file) && !photo) ||
          (file === 'index.html' && !screenAccess) || (file === 'pad.html' && player < 0)) {
        return respond(res, 404, 'Open the game on the notebook or scan a controller QR code.', 'text/plain');
      }
      return respond(res, 200, fs.readFileSync(path.join(publicDir, file)), mimetypes[path.extname(file)]);
    }
    return respond(res, 404, {});
  } catch (error) {
    if (!res.headersSent) respond(res, error instanceof SyntaxError ? 400 : 500, { error: 'Request failed' });
    else res.end();
    if (!(error instanceof SyntaxError)) console.error(error.message);
  }
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
server.on('upgrade', (req, connection, head) => {
  const reject = status => {
    connection.end('HTTP/1.1 ' + status + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  };
  if (!allowedHost(req.headers.host) || req.headers.origin !== 'http://' + req.headers.host) {
    return reject('403 Forbidden');
  }
  const url = new URL(req.url, 'http://' + req.headers.host);
  const player = codes.indexOf(url.searchParams.get('k'));
  if (url.pathname !== '/api/pad/ws' || player < 0) return reject('403 Forbidden');
  sockets.handleUpgrade(req, connection, head, socket => {
    let clockOffset = Infinity;
    const handshakeTimeout = setTimeout(() => { if (!socket.padId) socket.terminate(); }, 5000);
    socket.on('error', () => {});
    socket.on('message', (raw, binary) => {
      try {
        if (socket.readyState !== WebSocket.OPEN) return;
        const data = JSON.parse(raw.toString());
        if (binary || !Number.isFinite(data.sentAt) || data.sentAt < 0) return socket.close(1008, 'Invalid packet');
        const transit = performance.now() - data.sentAt;
        clockOffset = Math.min(clockOffset, transit);
        if (transit - clockOffset > INPUT_TIMEOUT) return;
        const result = receivePad(player, data, socket);
        if (socket.readyState !== WebSocket.OPEN) return;
        if (result.status !== 200 || data.action || !socket.introduced) {
          socket.send(JSON.stringify(result.status === 200 ?
            { type: 'state', ...result.body } : { type: 'error', status: result.status, error: result.error }));
          socket.introduced = result.status === 200;
        }
        if (result.status !== 200) socket.close(4000, 'Controller unavailable');
      } catch {
        socket.close(1008, 'Invalid JSON');
      }
    });
    socket.on('close', () => {
      clearTimeout(handshakeTimeout);
      if (padSockets[player] !== socket) return;
      padSockets[player] = null;
      if (controllers[player]?.id !== socket.padId) return;
      controllers[player].moving = false;
      game.input(player, { x: 0, y: 0 });
      game.setConnected(player, false);
      publish();
    });
  });
});

server.listen(port, '0.0.0.0', () => {
  const localUrl = 'http://127.0.0.1:' + port;
  console.log('Robot Sumo TV: ' + localUrl);
  console.log('Controller network: ' + (networkHosts().join(', ') || 'No LAN interface detected'));
  if (process.platform === 'win32' && process.argv.includes('--open')) {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', localUrl], {
      stdio: 'ignore', windowsHide: true
    });
    browser.on('error', () => console.log('Open ' + localUrl + ' in your browser.'));
    browser.unref();
  }
});
