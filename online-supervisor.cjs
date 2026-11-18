'use strict';
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { setTimeout: sleep } = require('node:timers/promises');
const { checkPublicLink } = require('./online-health.cjs');

async function supervise({ executable, port, open }) {
  const localUrl = 'http://127.0.0.1:' + port;
  const controlKey = randomBytes(24).toString('hex'), probe = randomBytes(24).toString('hex');
  const controller = new AbortController();
  let game, tunnel, ended = false;
  const delay = ms => sleep(ms, undefined, { signal: controller.signal }).catch(() => {});
  const stop = () => {
    if (ended) return;
    ended = true;
    controller.abort();
    game?.kill(); tunnel?.kill();
  };
  process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('exit', stop);
  const log = text => {
    try { appendFileSync(require('node:path').join(__dirname,'.tools','online.log'), text); } catch {}
  };
  async function control(origin, ready) {
    const response = await fetch(localUrl + '/api/online-control', {
      method: 'POST', signal: AbortSignal.timeout(2500),
      headers: { 'Content-Type': 'application/json', 'X-Online-Control': controlKey },
      body: JSON.stringify({ origin, ready })
    });
    if (!response.ok) throw Error('Cannot update the online link: ' + response.status);
  }
  function newTunnel() {
    return new Promise((resolve, reject) => {
      const current = spawn(executable, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', localUrl], {
        cwd: __dirname, windowsHide: true, stdio: ['ignore','pipe','pipe']
      });
      tunnel = current;
      const timeout = setTimeout(() => reject(Error('Tunnel connection timed out.')), 60000);
      let output = '';
      const read = chunk => {
        log(chunk.toString());
        output = (output + chunk.toString()).slice(-12000);
        const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
        if (match) { clearTimeout(timeout); resolve({ origin: match[0], process: current }); }
      };
      current.stdout.on('data', read); current.stderr.on('data', read);
      current.once('error', error => { clearTimeout(timeout); reject(error); });
      current.once('exit', () => { clearTimeout(timeout); reject(Error('Cloudflare Tunnel stopped.')); });
    });
  }
  try {
    while (!ended) {
      let origin;
      try {
        console.log('Connecting to the internet. Checking the public link before showing QR codes...');
        const candidate = await newTunnel(); origin = candidate.origin;
        if (ended) break;
        if (!game) {
          game = spawn(process.execPath, ['server.cjs', ...(open ? ['--open'] : [])], {
            cwd: __dirname, windowsHide: true, stdio: 'inherit',
            env: { ...process.env, PORT: String(port), PUBLIC_URL: origin,
              ONLINE_CONTROL_KEY: controlKey, ONLINE_PROBE_TOKEN: probe }
          });
          game.once('error', error => { console.error(error.message); process.exitCode=1; stop(); });
          game.once('exit', code => { if (code) process.exitCode=code; stop(); });
          let localReady = false;
          for (let attempt=0; attempt<30 && !ended; attempt++) {
            try {
              const response = await fetch(localUrl + '/api/online-health', { signal: AbortSignal.timeout(1000) });
              if ((await response.json()).probe === probe) { localReady=true; break; }
            } catch {}
            await delay(200);
          }
          if (!localReady) throw Error('Game did not start.');
        }
        await control(origin, false);
        const deadline = Date.now() + 120000;
        let ready = false;
        while (!ended && candidate.process.exitCode === null && Date.now() < deadline) {
          if (await checkPublicLink(origin, probe)) { ready=true; break; }
          await delay(2000);
        }
        if (ended) break;
        if (!ready) throw Error('Public DNS or tunnel is unavailable. Creating a new link...');
        await control(origin, true);
        console.log('Online link verified: ' + origin);
        console.log('Scan the ONLINE QR codes on ' + localUrl + '. Keep this program open.');
        let failures=0;
        while (!ended && candidate.process.exitCode === null && failures < 2) {
          await delay(15000);
          if (ended) break;
          const healthy = await checkPublicLink(origin, probe);
          await control(origin, healthy);
          if (healthy) failures=0;
          else { failures++; console.log('Online link unavailable. QR codes hidden while reconnecting...'); }
        }
        if (!ended) await control(origin, false);
      } catch (error) {
        if (!ended) {
          console.error(error.message);
          if (game && origin) await control(origin,false).catch(()=>{});
        }
      } finally {
        tunnel?.kill(); tunnel=undefined;
      }
      if (!ended) { console.log('Retrying online connection...'); await delay(3000); }
    }
  } finally { stop(); }
}
module.exports = { supervise };
