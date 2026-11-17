'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');
const WebSocket = require('ws');

test('WebSocket controllers preserve pairing, action receipts and reconnects', {timeout:45000}, async t => {
  const port = 26000 + Math.floor(Math.random() * 12000);
  const root = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server.cjs'], {
    cwd: require('node:path').join(__dirname,'..'),
    env: {...process.env, PORT:String(port)}, stdio:['ignore','pipe','pipe']
  });
  let logs='';
  child.stderr.on('data',chunk => {logs+=chunk;});
  const sockets = [];
  const timers = [];
  t.after(async () => {
    timers.forEach(clearInterval);
    sockets.forEach(s => s.terminate());
    child.kill();
    await once(child,'exit').catch(()=>{});
    assert.equal(logs,'');
  });
  await Promise.race([once(child.stdout,'data'), once(child,'exit').then(()=>{throw Error(logs);})]);
  const setup=await (await fetch(root+'/api/setup')).json();
  const keys=setup.links[0].urls.map(url=>new URL(url).search);
  const ids=['a'.repeat(24),'b'.repeat(24)];
  const packets=[0,0];
  async function connect(i, id=ids[i], hello=true) {
    const s=new WebSocket(root.replace('http:','ws:')+'/api/pad/ws'+keys[i],{origin:root});
    s.states=[];
    s.on('message',raw=>s.states.push(JSON.parse(raw)));
    sockets.push(s);
    await once(s,'open');
    s.sendInput=(extra={})=> {
      s.send(JSON.stringify({id,packet:++packets[i],sentAt:performance.now(),x:0,y:0,...extra}));
    };
    if (hello) s.sendInput();
    return s;
  }
  async function until(s,predicate,ms=2000){
    const start=Date.now();
    while(Date.now()-start<ms){
      const state=s.states.at(-1);
      if(state&&predicate(state))return state;
      await sleep(15);
    }
    throw Error('State did not arrive: '+JSON.stringify(s.states.at(-1)));
  }
  function beat(s){
    const timer=setInterval(()=>{if(s.readyState===WebSocket.OPEN)s.sendInput(s.input||{});},40);
    timers.push(timer);
    return timer;
  }
  const a=await connect(0),b=await connect(1);
  const beatA=beat(a),beatB=beat(b);
  await until(a,s=>s.connected?.every(Boolean));
  assert.equal((await until(b,s=>s.type==='state')).robot,1);
  const duplicate=await connect(0,'c'.repeat(24));
  assert.equal((await until(duplicate,s=>s.type==='error')).status,409);
  a.sendInput({action:{seq:1,kind:'robot',age:0,step:1}});
  await until(a,s=>s.ack===1&&s.robot===1);
  a.sendInput({action:{seq:1,kind:'robot',age:0,step:1}});
  await sleep(90);
  assert.equal(a.states.at(-1).robot,1);
  a.sendInput({action:{seq:2,kind:'robot',age:0,step:-1}});
  await until(a,s=>s.robot===0);
  a.sendInput({action:{seq:3,kind:'ready',age:0,value:true}});
  b.sendInput({action:{seq:1,kind:'ready',age:0,value:true}});
  await until(a,s=>s.phase==='countdown');
  await until(a,s=>s.phase==='live',6500);
  a.sendInput({action:{seq:4,kind:'skill',age:351}});
  await until(a,s=>s.ack===4);
  assert.equal(a.states.at(-1).fighter.cooldown,0);
  a.sendInput({action:{seq:5,kind:'skill',age:0}});
  await until(a,s=>s.ack===5&&s.fighter.cooldown>0);
  await until(a,s=>s.fighter.cooldown===0,6000);
  a.sendInput({action:{seq:5,kind:'skill',age:0}});
  await sleep(100);
  assert.equal(a.states.at(-1).fighter.cooldown,0,'acked skill never replays');
  clearInterval(beatA);
  a.sendInput({x:0,y:1});
  await sleep(400);
  const y=a.states.at(-1).fighter.y;
  await sleep(250);
  assert.ok(Math.abs(a.states.at(-1).fighter.y-y)<.07,'stale input stops before lease expires');
  await until(b,s=>s.phase==='paused');
  assert.equal(b.states.at(-1).connected[0],false);
  const reconnect=await connect(0);
  beat(reconnect);
  await until(reconnect,s=>s.phase==='countdown');
  await sleep(120);
  assert.equal(b.states.at(-1).connected[0],true,'old socket cannot disconnect replacement');
  await until(reconnect,s=>s.phase==='live',4500);
  assert.equal(reconnect.states.at(-1).session,setup.session);
  const beforeClose=performance.now();
  reconnect.terminate();
  await until(b,s=>s.phase==='paused',900);
  assert.ok(performance.now()-beforeClose<900,'closed socket pauses immediately');

  const revived=await connect(0);
  beat(revived);
  await until(revived,s=>s.phase==='countdown');
  const release=++packets[0];
  revived.sendInput({packet:release,release:true});
  await until(b,s=>s.phase==='paused');
  // An earlier packet cannot claim the slot after a higher ordered release.
  const old=await connect(0,ids[0],false);
  old.sendInput({packet:release-1});
  await sleep(80);
  assert.equal(b.states.at(-1).connected[0],false,'stale packet cannot reclaim a released slot');
  old.sendInput();
  await until(b,s=>s.connected[0]);
  const response = await fetch(root+'/api/host',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'home'})
  });
  assert.equal(response.status,200);
  clearInterval(beatB);
});

test('WebSocket rejects wrong pairing keys and foreign browser origins', async t=>{
  const port=40000+Math.floor(Math.random()*5000);
  const child=spawn(process.execPath,['server.cjs'],{
    cwd:require('node:path').join(__dirname,'..'),env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']
  });
  t.after(async()=>{child.kill();await once(child,'exit').catch(()=>{});});
  await once(child.stdout,'data');
  const root='http://127.0.0.1:'+port;
  const setup=await(await fetch(root+'/api/setup')).json();
  const key=new URL(setup.links[0].urls[0]).search;
  for(const [suffix,origin] of [['?k=invalid',root],[key,'http://other.example']]){
    const s=new WebSocket(root.replace('http:','ws:')+'/api/pad/ws'+suffix,{origin});
    s.on('error',()=>{});
    const [,response]=await once(s,'unexpected-response');
    assert.equal(response.statusCode,403);
    response.resume();
    s.terminate();
  }
});
