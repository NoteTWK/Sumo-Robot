'use strict';

const byId = id => document.getElementById(id);
const setText = (id, value) => {
  const element = byId(id);
  if (element.textContent !== value) element.textContent = value;
};
const bytes = crypto.getRandomValues(new Uint8Array(12));
const id = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const stick = byId('stick');
const skillButton = byId('skill');
const ultButton = byId('ult');
const readyButton = byId('pad-ready');
const picker = byId('pad-picker');
const previousButton = byId('pad-previous');
const nextButton = byId('pad-next');
const swipeArea = byId('pad-swipe');
const controls = document.querySelector('.pad-controls');
const pad = document.querySelector('.pad');
const fullscreen = byId('pad-fullscreen');
const resultActions = byId('pad-results');
const arenaAction = kind => kind === 'skill' || kind === 'ult';
const actionLifetime = kind => arenaAction(kind) ? 350 : 1200;
const abilityMessages = {
  'lightning-hover': 'ลอยชาร์จ · ใช้จอยเลือกจุดกระแทก',
  'spin-charge': 'กำลังชาร์จ · หลบการชน',
  'spin-blade': 'ใบมีดพร้อม · เข้าชน',
  'grapple-carry': 'จับสำเร็จ · ใช้จอยพาหุ่นไปยังตำแหน่งที่ต้องการ'
};
let pointer = null;
let x = 0, y = 0;
let active = false;
let suspended = document.hidden;
let firstConnection = true;
let connected = false;
let state;
let packet = 0;
let actionSeq = 0;
let actions = [];
let timer;
let socket;
let reconnectTimer;
let reconnectDelay = 150;
let stopped = false;
let lastReply = 0;

function queue(kind, details = {}) {
  if (!connected || actions.length >= 8) return;
  actions.push({ event: { seq: ++actionSeq, kind, ...details }, at: performance.now() });
  schedule(0);
}

function selectRobot(step) {
  if (state?.phase === 'lobby') queue('robot', { step });
}

previousButton.addEventListener('click', () => selectRobot(-1));
nextButton.addEventListener('click', () => selectRobot(1));
readyButton.addEventListener('click', () => {
  if (state?.phase === 'lobby' && !actions.some(({event}) => event.kind === 'ready')) {
    queue('ready', { value: !state.ready[state.player] });
    readyButton.disabled = true;
  }
});

byId('pad-replay').addEventListener('click', () => { if (state?.showcase) queue('replay'); });
byId('pad-home').addEventListener('click', () => { if (state?.showcase) queue('home'); });
function isFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}
fullscreen.addEventListener('click', async () => {
  const root = document.documentElement;
  const toggle = isFullscreen() ? document.exitFullscreen || document.webkitExitFullscreen :
    root.requestFullscreen || root.webkitRequestFullscreen;
  const hint = byId('pad-fullscreen-status');
  try {
    if (!toggle) throw new Error('Fullscreen unavailable');
    await toggle.call(isFullscreen() ? document : root);
    hint.hidden = true;
  } catch {
    setText('pad-fullscreen-status', 'เบราว์เซอร์นี้เปิดเต็มจอจากปุ่มไม่ได้');
    hint.hidden = false;
  }
});
for (const event of ['fullscreenchange', 'webkitfullscreenchange']) {
  document.addEventListener(event, () => setText('pad-fullscreen', isFullscreen() ? 'ออกจากเต็มจอ' : '⛶ เต็มจอ'));
}

let swipe;
swipeArea.addEventListener('pointerdown', event => {
  if (!connected || swipe || (event.pointerType === 'mouse' && event.button !== 0)) return;
  swipe = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
  swipeArea.setPointerCapture(event.pointerId);
});
swipeArea.addEventListener('pointerup', event => {
  if (swipe?.pointer !== event.pointerId) return;
  const dx = event.clientX - swipe.x;
  const dy = event.clientY - swipe.y;
  swipe = null;
  if (Math.abs(dy) >= 24 && Math.abs(dy) > Math.abs(dx)) selectRobot(dy < 0 ? 1 : -1);
});
for (const eventName of ['pointercancel', 'lostpointercapture']) {
  swipeArea.addEventListener(eventName, event => {
    if (swipe?.pointer === event.pointerId) swipe = null;
  });
}
let wheelDelta = 0;
let lastWheel = -Infinity;
swipeArea.addEventListener('wheel', event => {
  if (!connected || state?.phase !== 'lobby' || !event.deltaY) return;
  event.preventDefault();
  const now = performance.now();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? swipeArea.clientHeight : 1;
  wheelDelta = now - lastWheel < 220 ? wheelDelta + event.deltaY * unit : event.deltaY * unit;
  lastWheel = now;
  if (Math.abs(wheelDelta) < 48) return;
  selectRobot(wheelDelta > 0 ? 1 : -1);
  wheelDelta = 0;
}, { passive: false });

function releaseStick() {
  const hadInput = pointer !== null || x !== 0 || y !== 0;
  if (pointer !== null && stick.hasPointerCapture(pointer)) stick.releasePointerCapture(pointer);
  pointer = null;
  x = y = 0;
  stick.style.setProperty('--x', '0px');
  stick.style.setProperty('--y', '0px');
  if (!suspended && hadInput) schedule(0);
}

function position(event) {
  if (event.pointerId !== pointer) return;
  const box = stick.getBoundingClientRect();
  const radius = box.width * .32;
  const dx = event.clientX - box.left - box.width / 2;
  const dy = event.clientY - box.top - box.height / 2;
  const scale = Math.max(radius, Math.hypot(dx, dy));
  x = dx / scale;
  y = dy / scale;
  stick.style.setProperty('--x', x * radius + 'px');
  stick.style.setProperty('--y', y * radius + 'px');
}

stick.addEventListener('pointerdown', event => {
  if (!active || pointer !== null) return;
  event.preventDefault();
  pointer = event.pointerId;
  stick.setPointerCapture(pointer);
  position(event);
});
stick.addEventListener('pointermove', position);
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  stick.addEventListener(name, event => { if (event.pointerId === pointer) releaseStick(); });
}
function bindAction(button, queue) {
  button.addEventListener('pointerdown', event => {
    if (!active || button.disabled) return;
    event.preventDefault();
    queue();
  });
  button.addEventListener('click', event => {
    if (active && event.detail === 0) queue();
  });
}
bindAction(skillButton, () => queue('skill'));
bindAction(ultButton, () => queue('ult'));

function show(snapshot) {
  state = snapshot;
  const fighter = snapshot.fighter;
  const lobby = snapshot.phase === 'lobby';
  const ready = lobby && snapshot.ready[snapshot.player];
  const robot = snapshot.robots?.[snapshot.robot];
  if (robot) {
    skillButton.setAttribute('aria-label', 'SKILL · ' + robot.skill);
    ultButton.setAttribute('aria-label', 'ULT · ' + robot.ult);
  }
  actions = actions.filter(({event}) =>
    event.seq > snapshot.ack && (lobby ? ['robot', 'ready'].includes(event.kind) :
      snapshot.showcase ? ['replay', 'home'].includes(event.kind) :
        snapshot.phase === 'live' && arenaAction(event.kind)));
  connected = true;
  active = state.phase === 'live' && state.connected.every(Boolean);
  if (!active) releaseStick();
  pad.classList.toggle('lobby-pad', lobby);
  picker.hidden = !lobby;
  controls.hidden = lobby || snapshot.showcase;
  resultActions.hidden = !snapshot.showcase;
  byId('pad-replay').disabled = !snapshot.connected.every(Boolean);
  document.body.classList.toggle('side-b', state.player === 1);
  setText('pad-player', 'PLAYER ' + 'AB'[state.player]);
  setText('pad-robot', state.name.toUpperCase());
  byId('pad-connection').classList.add('connected');
  setText('pad-connection', 'CONNECTED');
  byId('pad-hp').style.width = fighter.hp + '%';
  byId('pad-hp-text').textContent = (Math.round(fighter.hp * 100) / 100) + ' / 100 HP';
  const charge = Math.floor(fighter.ultCharge * 100);
  skillButton.disabled = !active || !fighter.skillReady;
  ultButton.disabled = !active || !fighter.ultReady;
  skillButton.querySelector('small').textContent = fighter.cooldown > 0 ? fighter.cooldown.toFixed(1) + 's' : '';
  ultButton.querySelector('small').textContent = fighter.ultUsed ? 'USED' :
    charge === 100 ? 'READY' : 'CHARGING ' + charge + '%';
  ultButton.style.setProperty('--charge', (fighter.ultUsed ? 0 : charge) + '%');
  if (lobby) {
    const portrait = byId('pad-portrait');
    const src = '/home-robot-' + state.robot + '.png';
    if (portrait.getAttribute('src') !== src) portrait.src = src;
    setText('pad-choice-name', state.name);
    previousButton.disabled = nextButton.disabled = state.robots.length < 2;
    readyButton.disabled = actions.some(({event}) => event.kind === 'ready');
    readyButton.setAttribute('aria-pressed', String(Boolean(ready)));
  }
  const messages = {
    lobby: ready ? (state.ready.every(Boolean) ? 'ทั้งสองฝั่งพร้อมแล้ว' : 'พร้อมแล้ว · รออีกฝั่ง') : 'เลือกหุ่นแล้วกดพร้อม',
    countdown: 'GET READY · ' + Math.max(1, Math.ceil(state.remaining)),
    paused: 'MATCH PAUSED · รอจอยทั้งสองฝั่ง',
    between: 'ROUND ' + state.round + ' COMPLETE',
    final: snapshot.showcase ? (snapshot.winner === snapshot.player ? 'คุณชนะ' : 'PLAYER ' + 'AB'[snapshot.winner] + ' ชนะ') +
      ' · ' + snapshot.score.join('–') : 'ดูผลบนทีวี'
  };
  const settling = state.falling && (state.phase === 'between' || state.phase === 'final');
  const message = settling ? 'RING OUT · ดูจอทีวี' :
    active && fighter.overturned ? 'หุ่นคว่ำ · หมุนจอยเป็นวงเพื่อพลิกกลับ' :
      snapshot.go ? 'GO!' : (active && abilityMessages[fighter.effect]) || messages[state.phase] || '';
  setText('pad-message', message);
  firstConnection = false;
}

function disconnected(message) {
  connected = active = false;
  releaseStick();
  skillButton.disabled = ultButton.disabled = true;
  readyButton.disabled = previousButton.disabled = nextButton.disabled = true;
  resultActions.hidden = true;
  setText('pad-connection', firstConnection ? 'CONNECTING…' : 'RECONNECTING…');
  byId('pad-connection').classList.remove('connected');
  setText('pad-message', message);
}

function schedule(delay) {
  clearTimeout(timer);
  if (!suspended && !stopped && socket?.readyState === WebSocket.OPEN) {
    timer = setTimeout(sendInput, delay);
  }
}

function sendInput() {
  if (suspended || stopped || socket?.readyState !== WebSocket.OPEN) return;
  const now = performance.now();
  actions = actions.filter(({event, at}) => now - at < actionLifetime(event.kind));
  const pending = actions[0];
  const action = pending && { ...pending.event, age: Math.floor(now - pending.at) };
  // Skip obsolete directions while the connection is congested.
  if (socket.bufferedAmount <= 4096) {
    socket.send(JSON.stringify({ id, packet: ++packet, sentAt: now, x, y, action }));
  }
  schedule(state?.phase === 'live' || actions.length ? 32 : 100);
}

function reconnect() {
  if (suspended || stopped || reconnectTimer !== undefined) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(1600, reconnectDelay * 1.7);
}

function resetConnection(current) {
  if (socket !== current) return;
  socket = undefined;
  clearTimeout(timer);
  disconnected(stopped ? 'สแกน QR ล่าสุดจากจอทีวีอีกครั้ง' : 'กำลังเชื่อมต่อจอยใหม่…');
  current.close();
  reconnect();
}

function connect() {
  if (suspended || stopped || socket) return;
  const url = new URL('/api/pad/ws' + location.search, location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const current = new WebSocket(url);
  socket = current;
  const timeout = setTimeout(() => {
    if (socket === current && current.readyState !== WebSocket.OPEN) resetConnection(current);
  }, 4000);
  current.addEventListener('open', () => {
    if (socket !== current || suspended) return current.close();
    clearTimeout(timeout);
    lastReply = performance.now();
    sendInput();
  });
  current.addEventListener('message', event => {
    if (socket !== current || suspended) return;
    let message;
    try { message = JSON.parse(event.data); } catch { return current.close(); }
    if (message.type === 'error') {
      if (message.status === 403) {
        stopped = true;
        disconnected('สแกน QR ล่าสุดจากจอทีวีอีกครั้ง');
      } else {
        actions = [];
        disconnected(message.error === 'KEYBOARD MODE' ?
          'ปิดโหมด Keyboard ที่หน้าหลักเพื่อใช้จอย' : 'จอยฝั่งนี้กำลังถูกใช้งาน');
        reconnectDelay = 650;
      }
      current.close();
      return;
    }
    if (message.type !== 'state' || !message.fighter) return;
    lastReply = performance.now();
    reconnectDelay = 150;
    show(message);
  });
  current.addEventListener('error', () => {});
  current.addEventListener('close', () => {
    clearTimeout(timeout);
    if (socket !== current) return;
    socket = undefined;
    clearTimeout(timer);
    disconnected(stopped ? 'สแกน QR ล่าสุดจากจอทีวีอีกครั้ง' : 'กำลังเชื่อมต่อจอยใหม่…');
    reconnect();
  });
}

setInterval(() => {
  if (suspended || !socket || socket.readyState !== WebSocket.OPEN) return;
  const elapsed = performance.now() - lastReply;
  if (elapsed > 550 && connected) disconnected('กำลังเชื่อมต่อจอยใหม่…');
  if (elapsed > 1000) resetConnection(socket);
}, 150);

function suspend() {
  if (suspended) return;
  suspended = true;
  clearTimeout(timer);
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  actions = [];
  swipe = null;
  disconnected('เปิดหน้านี้เพื่อเชื่อมต่อจอยใหม่');
  if (socket) {
    const old = socket;
    socket = undefined;
    if (old.readyState === WebSocket.OPEN) {
      old.send(JSON.stringify({ id, packet: ++packet, sentAt: performance.now(), release: true }));
    }
    old.close();
  }
}

function resume() {
  if (!suspended || document.hidden) return;
  suspended = false;
  reconnectDelay = 150;
  connect();
}

window.addEventListener('pagehide', suspend);
window.addEventListener('pageshow', resume);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) suspend();
  else resume();
});
connect();
