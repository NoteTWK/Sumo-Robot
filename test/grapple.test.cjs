'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game } = require('../game.cjs');
const TAU=Math.PI*2;

function match(gripperIndex=0) {
  const game=new Game(),victimIndex=1-gripperIndex;
  game.configure({robots:gripperIndex===0?[4,0]:[0,4]});
  game.setConnected(0,true);game.setConnected(1,true);game.start(0);game.tick(1/120);
  const gripper=game.fighters[gripperIndex],victim=game.fighters[victimIndex];
  const forward=gripperIndex===0?1:-1;
  Object.assign(gripper,{x:0,y:0,angle:forward===1?0:Math.PI,hp:80});
  Object.assign(victim,{x:1.65*forward,y:0,angle:forward===1?Math.PI:0,hp:80});
  return {game,gripper,victim,gripperIndex,victimIndex,forward};
}
function advance(game,seconds){
  while(seconds>1e-8){const step=Math.min(seconds,1/120);game.tick(step);seconds-=step;}
}
function capture(f,type='ult'){
  f.game.input(f.gripperIndex,{[type]:true});
  advance(f.game,type==='ult'?.4:1/120);
  assert.equal(f.victim.carried,true,'front-facing ability captures the opponent');
}
function turn(f,{direction=1,start=0,steps=24,magnitude=1,abilities=false,dt=0}={}){
  for(let i=0;i<=steps;i++){
    const angle=start+direction*i*TAU/24;
    f.game.input(f.victimIndex,{x:Math.cos(angle)*magnitude,y:Math.sin(angle)*magnitude,
      ...(abilities?{skill:true,ult:true}:{})});
    if(dt)advance(f.game,dt);
  }
}

test('Grapple normal skill now throws behind the gripper and uses its eight-second cooldown',()=>{
  for(const index of [0,1]){
    const f=match(index);f.gripper.hp=100;
    assert.equal(f.game.snapshot().fighters[index].skillReady,true);
    f.game.input(index,{skill:true});
    assert.equal(f.gripper.cooldown,8);
    assert.equal(f.gripper.ultUsed,false);
    assert.equal(f.gripper.action.ability.effect,'grapple-toss');
    advance(f.game,.7);
    assert.equal(f.victim.carried,false);
    assert.ok(Math.abs(f.victim.x-(f.gripper.x-2*f.forward))<.02,'throw travels two units behind');
    assert.equal(f.gripper.ultUsed,false);
    assert.ok(f.gripper.cooldown>7);
    assert.equal(f.game.canUse(f.gripper,'skill'),false);
  }
});

test('Grapple ultimate carries while moving and the victim can escape by rotating either way on either side',()=>{
  for(const index of [0,1])for(const direction of [-1,1]){
    const f=match(index);capture(f);
    assert.equal(f.gripper.ultUsed,true);
    assert.equal(f.gripper.cooldown,0,'ultimate does not spend the normal skill cooldown');
    assert.equal(f.gripper.grip.toss,false);
    const actorX=f.gripper.x,victimX=f.victim.x;
    f.game.input(index,{x:f.forward,y:0});advance(f.game,.25);
    assert.ok((f.gripper.x-actorX)*f.forward>.1);
    assert.ok((f.victim.x-victimX)*f.forward>.1,'held opponent follows the gripper');
    f.game.input(index,{});
    turn(f,{direction,dt:1/30});
    assert.equal(f.victim.carried,false,'rotation frees the victim');
    assert.equal(f.gripper.grip,null);
    assert.equal(f.victim.recovery,0,'escaping does not start overturned recovery');
    assert.equal(f.game.phase,'live');
  }
});

test('neutral, small joystick circles, stationary direction, jitter and discontinuous jumps do not escape',()=>{
  const f=match();capture(f);
  turn(f,{magnitude:.3});assert.equal(f.victim.carried,true);
  for(let i=0;i<30;i++)f.game.input(f.victimIndex,{x:1,y:0});
  assert.equal(f.victim.carried,true);
  for(let i=0;i<80;i++){
    const angle=i%2?.2:0;f.game.input(f.victimIndex,{x:Math.cos(angle),y:Math.sin(angle)});
  }
  assert.equal(f.victim.carried,true);
  for(let i=0;i<20;i++)f.game.input(f.victimIndex,{x:i%2?-1:1,y:0});
  assert.equal(f.victim.carried,true);
  turn(f,{steps:16});f.game.input(f.victimIndex,{});turn(f,{steps:10});
  assert.equal(f.victim.carried,true,'releasing the joystick resets partial escape progress');
});

test('ordinary throw cannot be escaped with the ultimate carry escape gesture',()=>{
  const f=match();capture(f,'skill');
  turn(f,{direction:1});turn(f,{direction:-1});
  assert.equal(f.victim.carried,true);
  assert.equal(f.gripper.grip.toss,true);
  f.game.input(f.victimIndex,{});
  advance(f.game,.7);
  assert.equal(f.victim.carried,false);
  assert.ok(Math.abs(f.victim.x-(f.gripper.x-2))<.02);
});

test('escape command does not activate a queued ability and fresh capture ignores previous recovery turns',()=>{
  const f=match();
  // A prior partial overturn gesture must not be credited to a new capture.
  f.victim.gestureAngle=0;f.victim.gestureTurn=TAU*.75;
  capture(f);turn(f,{steps:8});
  assert.equal(f.victim.carried,true);
  f.game.input(f.victimIndex,{});
  // Stop exactly after crossing the escape threshold, without a later free input.
  for(let i=0;i<24&&f.victim.carried;i++){
    const angle=i*TAU/24;
    f.game.input(f.victimIndex,{x:Math.cos(angle),y:Math.sin(angle),skill:true,ult:true});
  }
  assert.equal(f.victim.carried,false);
  assert.equal(f.victim.ultUsed,false);
  assert.equal(f.victim.cooldown,0);
  assert.equal(f.victim.action,null);
  assert.equal(f.victim.gestureTurn,0);
  assert.equal(f.victim.gestureAngle,null);
  f.game.home();
  assert.equal(f.game.fighters[f.victimIndex].carried,false);
  assert.equal(f.game.fighters[f.victimIndex].gestureTurn,0);
});

test('paused game rejects escape gestures and freezes hold duration until countdown completes',()=>{
  const f=match();capture(f);const age=f.gripper.grip.age;
  f.game.setConnected(f.gripperIndex,false);advance(f.game,1);turn(f);
  assert.equal(f.gripper.grip.age,age);assert.equal(f.victim.carried,true);
  f.game.setConnected(f.gripperIndex,true);advance(f.game,2.9);turn(f);
  assert.equal(f.gripper.grip.age,age);assert.equal(f.victim.carried,true);
  advance(f.game,.11);turn(f);
  assert.equal(f.victim.carried,false);
});

test('ultimate still releases naturally after three seconds and is limited to one use',()=>{
  const f=match();
  f.gripper.hp=81;assert.equal(f.game.canUse(f.gripper,'ult'),false);
  f.gripper.hp=80;capture(f);
  advance(f.game,3.1);
  assert.equal(f.victim.carried,false);assert.equal(f.gripper.grip,null);
  assert.equal(f.gripper.ultUsed,true);assert.equal(f.game.canUse(f.gripper,'ult'),false);
});

test('overturned recovery still works in both rotation directions after the shared gesture change',()=>{
  for(const direction of [-1,1]){
    const f=match();f.victim.overturned=true;f.victim.roll=Math.PI;
    turn(f,{direction});
    assert.ok(f.victim.recovery>0);
    advance(f.game,.5);
    assert.equal(f.victim.overturned,false);
    assert.equal(f.victim.recovery,0);
    assert.equal(f.victim.roll,0);
  }
});

test('static or jittery joystick input still cannot recover an overturned robot',()=>{
  const f=match();f.victim.overturned=true;f.victim.roll=Math.PI;
  for(let i=0;i<50;i++)f.game.input(f.victimIndex,{x:1,y:0});
  for(let i=0;i<80;i++){
    const angle=i%2?.2:0;f.game.input(f.victimIndex,{x:Math.cos(angle),y:Math.sin(angle)});
  }
  advance(f.game,.6);
  assert.equal(f.victim.recovery,0);assert.equal(f.victim.overturned,true);
});
