'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

async function cloudflared() {
  if (process.platform !== 'win32') return 'cloudflared';
  const folder = path.join(__dirname, '.tools');
  const target = path.join(folder, 'cloudflared.exe');
  try { await fs.access(target); return target; } catch {}
  console.log('Downloading Cloudflare Tunnel (first launch only)...');
  const response = await fetch('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', {
    headers: { 'User-Agent': 'Robot-Sumo' }, signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw Error('Cannot fetch Cloudflare release: ' + response.status);
  const release = await response.json();
  const name = process.arch === 'arm64' ? 'cloudflared-windows-arm64.exe' : 'cloudflared-windows-amd64.exe';
  const asset = release.assets.find(item => item.name === name);
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest || '')) {
    throw Error('Cloudflare download has no verified checksum. Install cloudflared manually in .tools/cloudflared.exe.');
  }
  await fs.mkdir(folder, { recursive: true });
  const temp = target + '.download';
  try {
    await new Promise((resolve, reject) => {
      const download = spawn('curl.exe', ['--fail', '--location', '--silent', '--show-error',
        '--max-time', '180', '--retry', '2', '--output', temp, asset.browser_download_url],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let error = '';
      download.stderr.on('data', chunk => { error = (error + chunk).slice(-2000); });
      download.once('error', reject);
      download.once('exit', code => code === 0 ? resolve() : reject(Error('Cloudflare download failed: ' + error)));
    });
    const hash = createHash('sha256').update(await fs.readFile(temp)).digest('hex');
    if ('sha256:' + hash !== asset.digest) throw Error('Cloudflare checksum mismatch');
    await fs.rename(temp, target);
  } catch (error) { await fs.rm(temp, { force: true }); throw error; }
  return target;
}

async function main() {
  const executable = await cloudflared();
  const port = process.env.PORT || '8788';
  // Reserve a separate port so online mode cannot accidentally expose an older local game.
  const probe = require('node:net').createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(Number(port), '0.0.0.0', resolve); });
  await new Promise(resolve => probe.close(resolve));
  const tunnel = spawn(executable, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:' + port], {
    cwd: __dirname, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let game, ended = false;
  const stop = () => {
    if (ended) return;
    ended = true;
    game?.kill(); tunnel.kill();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('exit', stop);
  try {
    const origin = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Tunnel connection timed out. Check your internet connection.')), 60000);
      let output = '';
      const read = chunk => {
        output = (output + chunk.toString()).slice(-12000);
        const found = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/);
        if (found) { clearTimeout(timeout); resolve(found[0]); }
      };
      tunnel.stdout.on('data', read); tunnel.stderr.on('data', read);
      tunnel.once('error', error => { clearTimeout(timeout); reject(error); });
      tunnel.once('exit', () => { clearTimeout(timeout); reject(Error('Cloudflare Tunnel stopped before it was ready.')); });
    });
    if (ended || tunnel.exitCode !== null) throw Error('Tunnel has stopped');
    console.log('Online controllers: ' + origin);
    console.log('Keep this window open. Scan the ONLINE QR codes shown on the local game screen.');
    const args = ['server.cjs', ...(process.argv.includes('--open') ? ['--open'] : [])];
    game = spawn(process.execPath, args, {
      cwd: __dirname, windowsHide: true, stdio: 'inherit',
      env: { ...process.env, PORT: port, PUBLIC_URL: origin }
    });
    tunnel.once('exit', () => { console.error('Online connection closed. Restart online mode for new QR codes.'); stop(); });
    game.once('error', error => { console.error(error.message); stop(); process.exitCode = 1; });
    game.once('exit', code => { stop(); if (code) process.exitCode = code; });
  } catch (error) { stop(); throw error; }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
