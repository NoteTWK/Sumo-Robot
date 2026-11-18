'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function browser() {
  let now=0, timerId=0;
  const timers=new Map(), elements=new Map(), sockets=[];
  class Element {
    constructor(){this.handlers={};this.style={setProperty(){}};this.classList={add(){},remove(){},toggle(){}};}
    addEventListener(name,fn){(this.handlers[name] ||= []).push(fn);}
    emit(name,event={}){for(const fn of this.handlers[name]||[])fn(event);}
    setAttribute(){}
    getAttribute(){return '';}
    querySelector(){return new Element();}
    hasPointerCapture(){return false;}
    setPointerCapture(){}
    getBoundingClientRect(){return {left:0,top:0,width:100,height:100};}
  }
  const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const document=new Element();
  Object.assign(document,{hidden:false,getElementById:element,querySelector:element,body:new Element()});
  class Socket extends Element {
    static OPEN=1;
    constructor(url){super();this.url=String(url);this.readyState=0;this.bufferedAmount=0;this.sent=[];sockets.push(this);}
    send(data){assert.equal(this.readyState,1);this.sent.push(JSON.parse(data));}
    open(){this.readyState=1;this.emit('open');}
    message(data){this.emit('message',{data:JSON.stringify(data)});}
    close(){this.readyState=2;} // Model a stalled TCP close handshake.
  }
  const window=new Element();
  const context=vm.createContext({document,window,URL,Uint8Array,WebSocket:Socket,
    location:{search:'?k=pair',href:'http://127.0.0.1:8787/pad?k=pair',protocol:'http:'},
    crypto:{getRandomValues:a=>a.fill(7)},performance:{now:()=>now},
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,at:now+delay});return id;},
    clearTimeout:id=>timers.delete(id),
    setInterval:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,at:now+delay,interval:delay});return id;}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/pad.js'),'utf8'),context);
  function advance(ms){const target=now+ms;for(let count=0;count<10000;count++){
    const next=[...timers].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!next){now=target;return;}
    const [id,value]=next;now=value.at;timers.delete(id);
    if(value.interval)timers.set(id,{...value,at:now+value.interval});
    value.fn();
  }throw Error('Timer loop');}
  const state={type:'state',player:0,robot:0,name:'Red Wedge',phase:'live',ack:0,
    connected:[true,true],ready:[false,false],score:[0,0],
    fighter:{hp:100,ultCharge:0,skillReady:true,ultReady:false,cooldown:0}};
  return {document,window,element,sockets,advance,state};
}

test('mobile client sends without waiting for replies, retries unacknowledged actions and reconnects a stalled socket',()=>{
  const b=browser(),first=b.sockets[0];first.open();first.message(b.state);
  b.element('stick').emit('pointerdown',{pointerId:1,clientX:82,clientY:50,preventDefault(){}});
  b.element('skill').emit('pointerdown',{preventDefault(){}});
  b.advance(100);
  const sent=first.sent.filter(p=>p.action);
  assert.ok(sent.length>=3,'input transmission is independent of reply latency');
  assert.ok(sent.every(p=>p.action.seq===sent[0].action.seq),'retry uses the same action identity');
  assert.equal(sent[0].x,1);
  first.message({...b.state,ack:sent[0].action.seq});
  b.advance(40);
  assert.equal(first.sent.at(-1).action,undefined,'acknowledged action leaves retry queue');
  b.advance(1300);
  assert.equal(b.sockets.length,2,'reconnect does not wait for old close handshake');
  const next=b.sockets[1];next.open();
  assert.equal(next.sent[0].id,first.sent[0].id);
  assert.ok(next.sent[0].packet>first.sent.at(-1).packet);
  assert.equal(next.sent[0].x,0,'old touch input does not resume on reconnect');
  first.message(b.state);
  assert.equal(b.element('pad-connection').textContent,'RECONNECTING…','old socket cannot restore stale UI');
  next.message(b.state);
  assert.equal(b.element('pad-connection').textContent,'CONNECTED');
});

test('hiding the mobile page releases control and foregrounding reconnects only once',()=>{
  const b=browser(),first=b.sockets[0];first.open();first.message(b.state);
  b.document.hidden=true;b.document.emit('visibilitychange');
  assert.equal(first.sent.at(-1).release,true);
  const count=first.sent.length;
  b.advance(5000);
  assert.equal(first.sent.length,count);
  assert.equal(b.sockets.length,1);
  first.message(b.state);
  assert.equal(b.element('pad-connection').textContent,'RECONNECTING…');
  b.document.hidden=false;b.document.emit('visibilitychange');b.window.emit('pageshow');
  assert.equal(b.sockets.length,2);
  const next=b.sockets[1];next.open();
  assert.equal(next.sent[0].id,first.sent[0].id);
  assert.ok(next.sent[0].packet>first.sent.at(-1).packet);
  assert.equal(next.sent[0].x,0);
});

test('holding the joystick while pressing ultimate and skill keeps movement and both actions',()=>{
  const b=browser(),socket=b.sockets[0];socket.open();
  const ready={...b.state,fighter:{...b.state.fighter,ultReady:true}};
  socket.message(ready);
  b.element('stick').emit('pointerdown',{pointerId:1,clientX:82,clientY:50,preventDefault(){}});
  b.element('ult').emit('pointerdown',{pointerId:2,preventDefault(){}});
  b.element('skill').emit('pointerdown',{pointerId:3,preventDefault(){}});
  b.advance(1);
  const ult=socket.sent.at(-1);
  assert.equal(ult.action.kind,'ult');assert.equal(ult.x,1);
  socket.message({...ready,ack:ult.action.seq,fighter:{...ready.fighter,effect:'lightning-hover',ultReady:false}});
  b.advance(32);
  const skill=socket.sent.at(-1);
  assert.equal(skill.action.kind,'skill');assert.equal(skill.x,1);
  assert.ok(skill.action.seq>ult.action.seq);
});

test('the grabbed player sees escape progress and can still send joystick input',()=>{
  const b=browser(),socket=b.sockets[0];socket.open();
  socket.message({...b.state,fighter:{...b.state.fighter,carried:true,canEscape:true,escapeProgress:.6,skillReady:false,ultReady:false}});
  assert.match(b.element('pad-message').textContent,/หมุนจอย.*60%/);
  assert.equal(b.element('skill').disabled,true);
  b.element('stick').emit('pointerdown',{pointerId:1,clientX:82,clientY:50,preventDefault(){}});
  b.advance(100);
  assert.equal(socket.sent.at(-1).x,1,'being grabbed does not disable the escape joystick');
  socket.message({...b.state,fighter:{...b.state.fighter,carried:false,canEscape:false,escapeProgress:0}});
  assert.doesNotMatch(b.element('pad-message').textContent,/ถูกจับ/);
});
