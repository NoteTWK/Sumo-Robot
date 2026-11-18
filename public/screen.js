'use strict';

const byId = id => document.getElementById(id);
const set = (id, value) => {
  const node = byId(id);
  if (node.textContent !== String(value)) node.textContent = value;
};
const cards = [...document.querySelectorAll('[data-player]')];
const huds = [...document.querySelectorAll('[data-hud]')];
const qrToggles = [...document.querySelectorAll('[data-qr-toggle]')];
const reconnectLinks = [...byId('reconnect-qr').querySelectorAll('[data-pad-link]')];
const lobbyControls = [...document.querySelectorAll('#practice, [data-step], [data-best], #network')];
const qrPreference = 'robot-sumo-hide-qr';
const reconnectDelay = 1250;
let setup;
let state;
let online = false;
let revoked = false;
let networkIndex = 0;
let events;
let reconnectTimer;
let connectionGeneration = 0;
let settingsRequest = Promise.resolve();
let qrVisible = true;
const internetUnavailable = () => setup?.links[networkIndex]?.available === false;
try { qrVisible = localStorage.getItem(qrPreference) !== 'true'; } catch {}

async function command(action, data = {}) {
  if (!online) return;
  try {
    const response = await fetch('/api/host', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data })
    });
    if (!response.ok) throw new Error();
  } catch {
    set('lobby-status', 'เชื่อมต่อเกมไม่ได้');
  }
}

function setting(action, data) {
  const generation = connectionGeneration;
  settingsRequest = settingsRequest.then(() => {
    if (generation === connectionGeneration) return command(action, data);
  });
}

function updateLinks() {
  const link = setup?.links[networkIndex];
  set('network-hint', internetUnavailable() ? 'กำลังเชื่อมต่ออินเทอร์เน็ตใหม่ · กรุณารอ QR ใหม่' :
    link?.ip === 'internet' ? 'สแกนได้จาก Wi-Fi อื่น หรือ 4G / 5G' : 'ใช้ Wi-Fi เดียวกับโน้ตบุ๊ก');
  set('share-tv-hint', link?.ip === 'internet' ? 'เปิดลิงก์ผ่านอินเทอร์เน็ตได้ เครื่องหลักต้องเปิดเกมและโหมดออนไลน์ค้างไว้' : 'เปิดลิงก์จากเครื่องที่อยู่บน Wi-Fi เดียวกัน เครื่องหลักต้องเปิดอยู่');
  byId('share-tv').hidden = !online || !link?.tvUrl;
  if (!link) return;
  for (const anchor of document.querySelectorAll('[data-pad-link]')) {
    const target = new URL(link.urls[Number(anchor.dataset.padLink)]);
    anchor.href = target.href;
    anchor.querySelector('img').src = '/api/qr?' + new URLSearchParams({
      ip: link.ip, k: target.searchParams.get('k'), v: setup.linkVersion || 0
    });
  }
}

function syncQrToggles() {
  for (const button of qrToggles) {
    button.textContent = qrVisible ? 'ซ่อน QR' : 'แสดง QR';
    button.setAttribute('aria-pressed', String(qrVisible));
  }
}

function lobbyMessage() {
  if (revoked) return 'ลิงก์หมดอายุ · ขอจากปุ่ม “แชร์หน้าเกม” บนเครื่องที่รันเกมอีกครั้ง';
  if (!online) return setup ? 'กำลังเชื่อมต่อเกมใหม่…' : 'กำลังเชื่อมต่อเครื่องที่รันเกม…';
  if (internetUnavailable()) return 'ลิงก์ออนไลน์ยังไม่พร้อม · กำลังสร้าง QR ใหม่';
  if (!state.connected.every(Boolean)) return 'เชื่อมต่อจอยทั้งสองฝั่งเพื่อเริ่มแข่ง';
  if (!canStart(state)) return 'ให้ทั้งสองฝั่งกด READY บนจอย';
  return 'พร้อมเริ่มการแข่งขัน';
}

function canStart(s) {
  return s.connected.every(Boolean) && (s.practice || s.ready.every(Boolean));
}

function padStatus(s, player) {
  if (!online || !s) return revoked ? 'ขอลิงก์ใหม่' : 'กำลังเชื่อมต่อ…';
  if (s.practice) return 'KEYBOARD';
  if (!s.connected[player]) return 'รอเชื่อมต่อจอย';
  return s.ready[player] ? 'READY ✓' : 'เชื่อมต่อแล้ว · รอกด READY';
}

function updatePadCards(s) {
  const useQr = online && qrVisible && !s?.practice && !internetUnavailable();
  cards.forEach((card, i) => {
    const text = padStatus(s, i);
    const connected = online && s?.connected[i];
    const ready = connected && (s.practice || s.ready[i]);
    const status = card.querySelector('.status');
    status.textContent = text;
    status.classList.toggle('connected', Boolean(connected));
    const pair = card.querySelector('.pair');
    pair.hidden = !useQr;
    pair.classList.toggle('connected', Boolean(connected));
    pair.classList.toggle('ready', Boolean(ready));
    pair.querySelector('small').textContent = text;
    const cover = card.querySelector('.pair-cover');
    cover.hidden = useQr || Boolean(online && s?.practice);
    cover.classList.toggle('ready', Boolean(ready));
    cover.querySelector('small').textContent = internetUnavailable() ? 'กำลังตรวจสอบลิงก์ · รอ QR ใหม่' :
      online ? text : (revoked ? 'ขอลิงก์ใหม่' : 'กำลังโหลด QR…');
    card.querySelector('.keyboard').hidden = !online || !s?.practice;
  });
}

function updateLobby(s) {
  const { robots, arena, bestOf } = s.config;
  cards.forEach((card, i) => {
    const robot = setup.robots[robots[i]];
    card.classList.toggle('default-art', robots[i] === i);
    card.style.setProperty('--home-bot', 'url(/home-robot-' + robots[i] + '.png)');
    const portrait = card.querySelector('.portrait img');
    const src = '/home-robot-' + robots[i] + '.png';
    if (portrait.getAttribute('src') !== src) {
      portrait.src = src;
      portrait.alt = robot.name;
      portrait.parentElement.style.setProperty('--portrait', 'url(' + src + ')');
    }
    card.querySelector('.selector strong').textContent = robot.name.toUpperCase();
    card.querySelector('.abilities').textContent = 'SKILL · ' + robot.skill + '   |   ULT · ' + robot.ult;
  });
  updatePadCards(s);
  byId('practice').setAttribute('aria-pressed', s.practice);
  const arenaPanel = document.querySelector('.arena-panel');
  arenaPanel.classList.toggle('default-art', arena === 0);
  arenaPanel.style.setProperty('--home-arena', 'url(/home-arena-' + arena + '.png)');
  set('arena-name', setup.arenas[arena].name);
  for (const button of byId('shapes').children) {
    button.setAttribute('aria-pressed', Number(button.dataset.shape) === arena);
  }
  for (const button of byId('format').children) {
    button.setAttribute('aria-pressed', Number(button.dataset.best) === bestOf);
  }
  byId('start').disabled = !online || !s.practice || !canStart(s);
  byId('start').classList.toggle('auto-start', !s.practice);
  set('start', s.practice ? 'START MATCH →' : 'รอผู้เล่นทั้งสองกดพร้อม');
  set('lobby-status', lobbyMessage());
}

function updateMatch(s) {
  const { robots, bestOf } = s.config;
  huds.forEach((hud, i) => {
    const fighter = s.fighters[i];
    hud.querySelector('.robot-name').textContent = setup.robots[robots[i]].name;
    hud.querySelector(':scope > .meter i').style.width = fighter.hp + '%';
    hud.querySelector(':scope > .meter span').textContent = (Math.round(fighter.hp * 100) / 100) + ' / 100 HP';
    const meter = hud.querySelector('.ult-meter');
    const power = fighter.ultUsed ? 0 : Math.floor(fighter.ultCharge * 100);
    const ready = power === 100;
    meter.querySelector('i').style.width = power + '%';
    meter.querySelector('span').textContent = fighter.ultUsed ? 'USED' : ready ? 'READY' : power + '%';
    meter.setAttribute('aria-valuenow', power);
    meter.setAttribute('aria-valuetext', fighter.ultUsed ? 'ใช้แล้ว' : ready ? 'พร้อมใช้' : power + '%');
    meter.classList.toggle('ready', ready);
    meter.classList.toggle('spent', fighter.ultUsed);
  });
  set('round', 'ROUND ' + s.round);
  set('score', s.score.join(' – '));
  set('best', 'BEST OF ' + bestOf);
  const overlay = byId('overlay');
  const player = s.winner === 0 ? 'PLAYER A' : 'PLAYER B';
  let kicker = '', title = '', detail = '', variant = '', shade = false;
  const recovering = online && s.phase === 'paused';
  if (!online || s.phase === 'paused') {
    const missing = s.connected.map((connected, i) => connected ? '' : 'PLAYER ' + 'AB'[i]).filter(Boolean);
    title = revoked ? 'ลิงก์หมดอายุ' : 'MATCH PAUSED';
    detail = !online ? lobbyMessage() :
      internetUnavailable() ? 'กำลังเชื่อมต่ออินเทอร์เน็ตใหม่ · กรุณารอแล้วสแกน QR ใหม่' :
      missing.join(' / ') + (qrVisible ? ' · สแกน QR เพื่อเชื่อมต่อใหม่' : ' · กดแสดง QR เพื่อเชื่อมต่อใหม่');
    variant = 'paused';
    shade = true;
  } else if (s.phase === 'countdown' || s.go) {
    kicker = s.resume ? 'RESUMING MATCH' : 'ROUND ' + s.round;
    title = s.go ? 'GO!' : Math.max(1, Math.ceil(s.remaining));
    variant = 'count';
  } else if (s.phase === 'between' && !s.falling) {
    kicker = 'ROUND ' + s.round + ' COMPLETE';
    title = s.winner === null ? 'DRAW · REPLAY ROUND' : player + ' WINS THE ROUND';
    const next = s.round + (s.winner === null ? 0 : 1);
    detail = s.reason + '  ·  ROUND ' + next + ' IN ' + Math.max(1, Math.ceil(s.remaining));
    variant = 'between';
  } else if (s.showcase) {
    kicker = '♛  FINAL SCORE ' + s.score.join(' – ');
    title = player + ' WINS';
    detail = setup.robots[robots[s.winner]].name.toUpperCase();
    variant = 'final';
  }
  overlay.hidden = !title;
  overlay.className = ['overlay', variant, shade && 'shade', s.winner === 1 && 'side-b'].filter(Boolean).join(' ');
  set('result-kicker', kicker);
  set('result-title', title);
  set('result-detail', detail);
  byId('reconnect-panel').hidden = !recovering;
  byId('reconnect-qr').hidden = !recovering || !qrVisible || internetUnavailable();
  reconnectLinks.forEach((link, i) => { link.hidden = !recovering || s.connected[i]; });
  byId('match-tools').hidden = !online || recovering || s.showcase;
  byId('result-actions').hidden = !s.showcase || !online;
  byId('replay').disabled = !online || !s.connected.every(Boolean);
}

function update() {
  byId('lobby').classList.toggle('expired-link', revoked);
  lobbyControls.forEach(control => { control.disabled = !online; });
  for (const button of byId('shapes').children) button.disabled = !online;
  if (!state) {
    byId('lobby').hidden = false;
    byId('match').hidden = true;
    updatePadCards();
    set('lobby-status', lobbyMessage());
    return;
  }
  const lobby = state.phase === 'lobby';
  byId('lobby').hidden = !lobby;
  byId('match').hidden = lobby;
  if (lobby) updateLobby(state);
  else updateMatch(state);
}

function draw() {
  if (state) {
    const arena = setup.arenas[state.config.arena];
    if (state.phase === 'lobby' && byId('preview').getClientRects().length) {
      SumoRender.arena(byId('preview'), { arena, preview: true });
    } else if (state.phase !== 'lobby') {
      const fighters = state.fighters.map((fighter, i) => ({
        ...fighter, id: setup.robots[state.config.robots[i]].id, color: setup.robots[state.config.robots[i]].color
      }));
      SumoRender.arena(byId('battle'), { ...state, arena, fighters });
    }
  }
  requestAnimationFrame(draw);
}

function applySetup(next) {
  const preferredNetwork = setup?.links[networkIndex]?.ip ??
    (next.links.some(link => link.ip === 'internet') ? 'internet' : location.hostname);
  const priorCatalog = setup?.arenas;
  setup = next;
  const network = byId('network');
  network.replaceChildren(...setup.links.map((link, i) => new Option(link.label || link.ip, i)));
  networkIndex = Math.max(0, setup.links.findIndex(link => link.ip === preferredNetwork));
  network.value = String(networkIndex);
  updateLinks();

  const sameCatalog = priorCatalog?.length === setup.arenas.length &&
    setup.arenas.every((arena, i) => priorCatalog[i].id === arena.id);
  if (sameCatalog) return;
  const icons = ['○', '□', '⬭', '△', '⬡'];
  byId('shapes').replaceChildren(...setup.arenas.map((arena, i) => {
    const button = document.createElement('button');
    button.dataset.shape = i;
    button.textContent = icons[i];
    button.title = arena.name;
    button.setAttribute('aria-label', arena.name);
    button.disabled = true;
    button.onclick = () => setting('configure', { config: { arena: i } });
    return button;
  }));
}

function connectionLost() {
  if (events) events.close();
  events = null;
  online = false;
  connectionGeneration++;
  settingsRequest = Promise.resolve();
  const dialog = byId('share-tv-dialog');
  if (dialog.open) dialog.close();
  byId('share-tv').hidden = true;
  window.SumoAudio?.offline();
  update();
  if (!revoked && reconnectTimer === undefined) {
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connect(); }, reconnectDelay);
  }
}

async function connect() {
  try {
    const response = await fetch('/api/setup', { cache: 'no-store' });
    if (response.status === 403) {
      revoked = true;
      connectionLost();
      return;
    }
    if (!response.ok) throw new Error('No setup available');
    const next = await response.json();
    if (state && setup?.session !== next.session) state = undefined;
    applySetup(next);
    const currentUrl = new URL(location.href);
    if (currentUrl.searchParams.has('tv')) {
      currentUrl.searchParams.delete('tv');
      history.replaceState(null, '', currentUrl.pathname + currentUrl.search + currentUrl.hash);
    }
    const stream = new EventSource('/api/events');
    events = stream;
    stream.onmessage = event => {
      if (events !== stream) return;
      const nextState = JSON.parse(event.data);
      if (nextState.session !== setup.session) {
        connectionLost();
        return;
      }
      if ((nextState.linkVersion || 0) !== (setup.linkVersion || 0)) {
        connectionLost();
        return;
      }
      if (!online) {
        online = true;
        byId('share-tv').hidden = !setup.links[networkIndex].tvUrl;
      }
      state = nextState;
      update();
      window.SumoAudio?.snapshot(state, setup.robots);
    };
    stream.onerror = () => { if (events === stream) connectionLost(); };
  } catch {
    connectionLost();
  }
}

function init() {
  const network = byId('network');
  network.onchange = () => {
    networkIndex = Number(network.value);
    updateLinks();
  };

  for (const button of qrToggles) {
    button.onclick = () => {
      qrVisible = !qrVisible;
      try { localStorage.setItem(qrPreference, String(!qrVisible)); } catch {}
      syncQrToggles();
      update();
    };
  }
  syncQrToggles();

  const shareUrl = byId('share-tv-url');
  byId('share-tv').onclick = () => {
    shareUrl.value = setup.links[networkIndex].tvUrl;
    set('share-tv-status', 'ผู้ที่มีลิงก์นี้สามารถควบคุมแมตช์ได้');
    byId('share-tv-dialog').showModal();
    shareUrl.select();
  };
  byId('copy-tv').onclick = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl.value);
      set('share-tv-status', 'คัดลอกลิงก์แล้ว');
    } catch {
      shareUrl.focus();
      shareUrl.select();
      set('share-tv-status', 'กด Ctrl+C เพื่อคัดลอกลิงก์');
    }
  };

  for (const button of byId('format').children) {
    button.onclick = () => setting('configure', { config: { bestOf: Number(button.dataset.best) } });
  }
  cards.forEach((card, index) => {
    for (const button of card.querySelectorAll('[data-step]')) {
      button.onclick = () => setting('select-robot', { player: index, step: Number(button.dataset.step) });
    }
  });
  byId('practice').onclick = () => state && command('practice', { enabled: !state.practice });
  byId('fullscreen').onclick = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      set('lobby-status', 'ลองกด F11 เพื่อเปิดเต็มจอ');
    }
  };
  byId('start').onclick = byId('replay').onclick = () => setting('start');
  byId('home').onclick = byId('match-home').onclick = byId('pause-home').onclick = () => command('home');
  update();
  connect();
  requestAnimationFrame(draw);
}

const keys = new Set();
const drivingKeys = [false, false];
const bindings = [
  { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', skill: 'KeyF', ult: 'KeyG' },
  { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', skill: 'KeyK', ult: 'KeyL' }
];
function sendKeys(action) {
  if (!state?.practice || state.phase !== 'live' || !online) return;
  bindings.forEach((bind, player) => {
    const pressed = Object.values(bind).some(key => keys.has(key));
    if (!pressed && !drivingKeys[player]) return;
    drivingKeys[player] = pressed;
    command('key', {
      player,
      x: Number(keys.has(bind.right)) - Number(keys.has(bind.left)),
      y: Number(keys.has(bind.down)) - Number(keys.has(bind.up)),
      skill: bind.skill === action, ult: bind.ult === action
    });
  });
}

window.addEventListener('keydown', event => {
  if (!state?.practice || state.phase !== 'live' ||
      !bindings.some(bind => Object.values(bind).includes(event.code))) return;
  event.preventDefault();
  keys.add(event.code);
  if (!event.repeat) sendKeys(event.code);
});
window.addEventListener('keyup', event => { if (keys.delete(event.code)) sendKeys(); });
window.addEventListener('blur', () => { keys.clear(); sendKeys(); });
setInterval(sendKeys, 65);
if (location.protocol !== 'file:') {
  init();
}
