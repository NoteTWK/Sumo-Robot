'use strict';
const https = require('node:https');

function readJson(url, timeout, lookup) {
  return new Promise(resolve => {
    const request = https.get(url, {
      family: 4, lookup, signal: AbortSignal.timeout(timeout),
      headers: { 'Cache-Control': 'no-cache', Accept: 'application/dns-json, application/json' }
    }, response => {
      let body = '';
      response.on('data', chunk => { body += chunk; if (body.length > 16384) request.destroy(); });
      response.on('end', () => {
        try { resolve(response.statusCode === 200 ? JSON.parse(body) : null); } catch { resolve(null); }
      });
      response.on('error', () => resolve(null));
    });
    request.on('error', () => resolve(null));
  });
}

// Verify DNS, TLS and the route back to this exact game. A cached negative answer
// on the host's network must not continuously replace an otherwise healthy URL.
async function checkPublicLink(origin, probe, timeout = 5000) {
  const target = new URL('/api/online-health', origin);
  const valid = data => data?.service === 'robot-sumo' && data.probe === probe;
  if (valid(await readJson(target, timeout))) return true;
  const name = encodeURIComponent(target.hostname);
  const answers = await Promise.all([
    readJson('https://dns.google/resolve?name=' + name + '&type=A', timeout),
    readJson('https://cloudflare-dns.com/dns-query?name=' + name + '&type=A', timeout)
  ]);
  // Wait for propagation if either public resolver still reports NXDOMAIN.
  if (answers.some(answer => answer?.Status === 3)) return false;
  const addresses = answers.flatMap(answer => answer?.Status === 0 ? answer.Answer || [] : [])
    .filter(answer => answer.type === 1 && require('node:net').isIPv4(answer.data)).map(answer => answer.data);
  if (!addresses.length) return false;
  const lookup = (host, options, callback) => {
    if (host !== target.hostname) return callback(Error('Unexpected public host'));
    if (options.all) callback(null, [{ address: addresses[0], family: 4 }]);
    else callback(null, addresses[0], 4);
  };
  // The URL and TLS server name remain the real hostname; certificate validation stays enabled.
  return valid(await readJson(target, timeout, lookup));
}
module.exports = { checkPublicLink };
