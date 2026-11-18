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
  const port = process.env.PORT || '8788';
  const localUrl = 'http://127.0.0.1:' + port;
  console.log('Starting Robot Sumo Online...');
  // Reserve a separate port so online mode cannot accidentally expose an older local game.
  const probe = require('node:net').createServer();
  try {
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(Number(port), '0.0.0.0', resolve); });
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    let existing;
    try {
      const response = await fetch(localUrl + '/api/setup', { signal: AbortSignal.timeout(2000) });
      if (response.ok) existing = await response.json();
    } catch {}
    const isGame = existing?.robots?.length === 6 && Array.isArray(existing?.arenas) &&
      typeof existing?.session === 'string';
    if (!isGame || !existing.links?.some(link => link.ip === 'internet')) {
      throw Error('Port ' + port + ' is used by another program. Close that program or choose another PORT.');
    }
    console.log('Robot Sumo Online is already running. Opening ' + localUrl);
    if (process.argv.includes('--open')) {
      const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', localUrl],
        { windowsHide: true, stdio: 'ignore' });
      browser.on('error', () => console.log('Open ' + localUrl + ' in your browser.'));
      browser.unref();
    }
    return;
  }
  await new Promise(resolve => probe.close(resolve));
  const executable = await cloudflared();
  await require('./online-supervisor.cjs').supervise({ executable, port, open: process.argv.includes('--open') });
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
