'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

test('broken public links hide QR codes and rotate without restarting the match server', async () => {
  const launches=[], states=[], probes=[];
  const runtime=new EventEmitter();
  Object.assign(runtime,{env:{},execPath:'node'});
  let tunnels=0;
  const fakeSpawn=(executable,args)=>{
    const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
    child.exitCode=null;child.kill=()=>{child.exitCode=0;child.emit('exit',0);};
    launches.push(args[0]);
    if(args[0]==='tunnel'){
      tunnels++;
      queueMicrotask(()=>child.stdout.emit('data',Buffer.from('https://link-'+tunnels+'.trycloudflare.com')));
    }
    return child;
  };
  const checks=[true,false,false,true];
  const context=vm.createContext({module:{exports:{}},__dirname:__dirname,console:{log(){},error(){}},
    AbortController,AbortSignal,Date,Buffer,queueMicrotask,setTimeout,clearTimeout,process:runtime,
    require:name=>{
      if(name==='node:child_process')return {spawn:fakeSpawn};
      if(name==='node:fs')return {appendFileSync(){}};
      if(name==='node:timers/promises')return {setTimeout:async()=>{}};
      if(name==='./online-health.cjs')return {checkPublicLink:async origin=>{
        const result=checks.shift();probes.push({origin,result});return result;
      }};
      if(name==='node:crypto')return {randomBytes:size=>Buffer.alloc(size,1)};
      return require(name);
    },
    fetch:async(url,options)=>{
      if(url.endsWith('/api/online-health'))return {json:async()=>({probe:'01'.repeat(24)})};
      const state=JSON.parse(options.body);states.push(state);
      if(state.ready && state.origin.includes('link-2.'))runtime.emit('SIGINT');
      return {ok:true};
    }
  });
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../online-supervisor.cjs'),'utf8'),context);
  await context.module.exports.supervise({executable:'cloudflared',port:8788,open:false});
  assert.equal(launches.filter(name=>name==='server.cjs').length,1,'the match process survives link rotation');
  assert.equal(tunnels,2);
  assert.deepEqual(probes.map(item=>item.result),[true,false,false,true]);
  assert.equal(states[0].ready,false,'QR starts hidden until public route is verified');
  assert.equal(states.at(-1).ready,true);
  assert.ok(states.some(item=>item.origin.includes('link-1.')&&!item.ready),'failed link becomes unavailable');
  assert.ok(states.some(item=>item.origin.includes('link-2.')&&!item.ready),'new link is checked before showing its QR');
});

test('QR availability and URLs update securely while preserving the game session', {timeout:10000}, async t=>{
  const port=49000+Math.floor(Math.random()*3000),root='http://127.0.0.1:'+port;
  const child=spawn(process.execPath,['server.cjs'],{
    cwd:require('node:path').join(__dirname,'..'),
    env:{...process.env,PORT:String(port),PUBLIC_URL:'https://first.trycloudflare.com',ONLINE_CONTROL_KEY:'test-control',ONLINE_PROBE_TOKEN:'test-probe'},
    stdio:['ignore','pipe','pipe']
  });
  t.after(async()=>{child.kill();await once(child,'exit');});
  await once(child.stdout,'data');
  const setup=async()=>await(await fetch(root+'/api/setup')).json();
  const control=(data,key='test-control',headers={})=>fetch(root+'/api/online-control',{
    method:'POST',headers:{'Content-Type':'application/json','X-Online-Control':key,...headers},body:JSON.stringify(data)
  });
  const initial=await setup();
  assert.equal(initial.links[0].available,false);
  const qrUrl=root+'/api/qr?ip=internet&k='+new URL(initial.links[0].urls[0]).searchParams.get('k');
  assert.equal((await fetch(qrUrl)).status,503);
  assert.equal((await control({ready:true},'wrong')).status,403);
  assert.equal((await control({ready:true},'test-control',{'X-Forwarded-For':'203.0.113.1'})).status,403);
  assert.equal((await control({ready:true})).status,200);
  assert.equal((await fetch(qrUrl)).status,200);
  const ready=await setup();assert.equal(ready.links[0].available,true);
  assert.equal((await control({ready:false,origin:'https://second.trycloudflare.com'})).status,200);
  const changed=await setup();
  assert.equal(changed.session,initial.session);
  assert.equal(changed.links[0].available,false);
  assert.ok(changed.links[0].urls[0].startsWith('https://second.trycloudflare.com/'));
  assert.ok(changed.linkVersion>ready.linkVersion);
  assert.equal((await fetch(qrUrl)).status,503);
  assert.equal((await control({ready:true})).status,200);
  assert.equal((await fetch(qrUrl)).status,200);
});
