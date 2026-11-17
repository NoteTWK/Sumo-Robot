'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const WebSocket = require('ws');
const jsQR = require('jsqr');
const { qrSvg } = require('../qr.cjs');

test('online QR preserves long HTTPS pairing links when scanned', () => {
  const target = 'https://a-very-long-generated-tunnel-hostname-for-robot-sumo.trycloudflare.com/pad?k=0123456789abcdef';
  const svg = qrSvg(target);
  const extent = Number(svg.match(/viewBox="0 0 (\d+)/)[1]), scale=6, size=extent*scale;
  const pixels = new Uint8ClampedArray(size*size*4).fill(255);
  for (const match of svg.matchAll(/M(\d+),(\d+)h1v1h-1z/g)) {
    for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){
      const offset=((Number(match[2])*scale+dy)*size+Number(match[1])*scale+dx)*4;
      pixels[offset]=pixels[offset+1]=pixels[offset+2]=0;
    }
  }
  assert.equal(jsQR(pixels,size,size)?.data,target);
});

test('tunneled controllers can pair and ready while loopback proxy visitors cannot control the host', {timeout:15000}, async t => {
  const port=45000+Math.floor(Math.random()*3000), origin='https://sumo-online.example.com';
  const child=spawn(process.execPath,['server.cjs'],{
    cwd:require('node:path').join(__dirname,'..'),env:{...process.env,PORT:String(port),PUBLIC_URL:origin},
    stdio:['ignore','pipe','pipe']
  });
  const sockets=[];
  t.after(async()=>{sockets.forEach(s=>s.terminate());child.kill();await once(child,'exit');});
  await once(child.stdout,'data');
  async function request(route,{host='sumo-online.example.com',method='GET',headers={},body}={}){
    return new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers:{Host:host,...headers}},res=>{
        let text='';res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,text}));
      });req.on('error',reject);req.end(body);
    });
  }
  const local=await request('/api/setup',{host:'127.0.0.1:'+port});
  const setup=JSON.parse(local.text), internet=setup.links[0];
  assert.equal(internet.ip,'internet');
  assert.ok(internet.urls.every(link=>link.startsWith(origin+'/pad?k=')));
  for(const route of ['/','/index.html','/api/setup','/api/events','/api/qr?ip=internet']){
    assert.ok((await request(route)).status>=400,'public host cannot open '+route);
  }
  assert.ok((await request('/api/host',{method:'POST',headers:{Origin:origin},body:'{"action":"home"}'})).status>=400);
  assert.equal((await request('/api/setup',{host:'127.0.0.1:'+port,headers:{'X-Forwarded-For':'203.0.113.9'}})).status,403);
  assert.equal((await request('/pad?k=wrong')).status,404);
  assert.equal((await request('/pad'+new URL(internet.urls[0]).search)).status,200);
  assert.equal((await request('/api/setup',{host:'attacker.example.com'})).status,403);
  const qr=await request('/api/qr?ip=internet&k='+new URL(internet.urls[0]).searchParams.get('k'),{host:'127.0.0.1:'+port});
  assert.equal(qr.status,200);assert.match(qr.text,/<svg/);
  for(let i=0;i<2;i++){
    const s=new WebSocket('ws://127.0.0.1:'+port+'/api/pad/ws'+new URL(internet.urls[i]).search,
      {origin,headers:{Host:'sumo-online.example.com'}});
    sockets.push(s);await once(s,'open');
    const reply=once(s,'message');
    s.send(JSON.stringify({id:String(i).repeat(24),packet:1,sentAt:performance.now(),x:0,y:0,action:{seq:1,kind:'ready',value:true,age:0}}));
    const state=JSON.parse((await reply)[0]);assert.equal(state.player,i);
    assert.equal(state.ready[i],true);
    if(i===1)assert.equal(state.phase,'countdown');
  }
  const bad=new WebSocket('ws://127.0.0.1:'+port+'/api/pad/ws'+new URL(internet.urls[0]).search,
    {origin:'https://foreign.example',headers:{Host:'sumo-online.example.com'}});
  bad.on('error',()=>{});const [,rejection]=await once(bad,'unexpected-response');
  assert.equal(rejection.statusCode,403);rejection.resume();bad.terminate();
});
