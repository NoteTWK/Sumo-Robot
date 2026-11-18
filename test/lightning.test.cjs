'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game, ROBOTS } = require('../game.cjs');

function match(robot=2) {
  const game=new Game();game.configure({robots:[robot,1]});
  game.setConnected(0,true);game.setConnected(1,true);game.start(0);game.tick(1/120);
  game.fighters[0].hp=80;
  return game;
}
function advance(game,seconds){
  while(seconds>1e-8){const step=Math.min(seconds,1/120);game.tick(step);seconds-=step;}
}

test('Lightning can move and turn in every phase of Thunder Slam',()=>{
  for(const [seconds,effect] of [[.05,'ult-prep'],[.35,'lightning-rise'],[.8,'lightning-hover'],[3.72,'lightning-slam']]){
    const game=match(),fighter=game.fighters[0];
    game.input(0,{ult:true});advance(game,seconds);
    assert.equal(game.snapshot().fighters[0].effect,effect);
    const {x,angle}=fighter;
    game.input(0,{x:1,y:0});advance(game,.1);
    assert.ok(fighter.x>x+.04,effect+' accepts movement');
    game.input(0,{x:0,y:1});advance(game,.03);
    assert.ok(fighter.angle>angle,effect+' accepts steering');
    assert.equal(game.phase,'live');
  }
});

test('Lightning skill and ultimate work in either order and in the same input without replacing each other',()=>{
  for(const order of ['together','skill-first','ult-first']){
    const game=match(),fighter=game.fighters[0];fighter.vx=2;
    if(order==='together')game.input(0,{x:1,ult:true,skill:true});
    else{
      game.input(0,{[order==='skill-first'?'skill':'ult']:true});
      advance(game,order==='skill-first'?.1:.8);
      game.input(0,{x:1,[order==='skill-first'?'ult':'skill']:true});
    }
    assert.equal(fighter.action.ability.jump,true);
    assert.equal(fighter.ultUsed,true);
    assert.ok(fighter.boostRemaining>0);
    assert.ok(fighter.cooldown>0);
    const boost=fighter.boostRemaining,action=fighter.action,vx=fighter.vx;
    game.input(0,{x:1,ult:true,skill:true});
    assert.equal(fighter.boostRemaining,boost,'repeated input does not refresh boost');
    assert.equal(fighter.action,action,'ultimate is not restarted');
    assert.equal(fighter.vx,vx,'repeated input does not multiply speed');
  }
});

test('boost doubles flight speed and can expire independently during the hover',()=>{
  const game=match(),fighter=game.fighters[0];
  game.input(0,{skill:true});advance(game,1);
  game.input(0,{ult:true});advance(game,.8);
  game.input(0,{x:1});advance(game,.7);
  assert.ok(Math.abs(Math.hypot(fighter.vx,fighter.vy)-ROBOTS[2].speed*2)<.01);
  game.input(0,{});advance(game,.7);
  game.input(0,{x:-1});advance(game,.7);
  assert.ok(Math.hypot(fighter.vx,fighter.vy)>ROBOTS[2].speed);
  game.input(0,{});advance(game,.3);
  assert.equal(fighter.boostRemaining,0);
  assert.equal(game.snapshot().fighters[0].effect,'lightning-hover');
  assert.equal(fighter.action.ability.jump,true,'expiring boost does not cancel the ultimate');
  assert.ok(Math.hypot(fighter.vx,fighter.vy)<=ROBOTS[2].speed+1e-6);
});

test('Thunder Slam deals 20 damage once at the moved landing location',()=>{
  const game=match(),[fighter,opponent]=game.fighters;opponent.x=0;
  game.input(0,{ult:true});advance(game,.8);
  game.input(0,{x:1});advance(game,.6);
  game.input(0,{});advance(game,2.55);
  const landingX=fighter.x;
  assert.ok(landingX>-1,'ultimate moved away from its launch point');
  advance(game,.05);
  assert.equal(opponent.hp,80);
  assert.equal(game.impact.kind,'lightning-slam');
  assert.ok(Math.abs(game.impact.x-landingX)<1e-6);
  advance(game,.25);assert.equal(opponent.hp,80,'landing damage is not repeated');
});

test('pause freezes both Lightning abilities and resets clear boost state',()=>{
  const game=match(),fighter=game.fighters[0];
  game.input(0,{ult:true,skill:true});advance(game,.9);
  const age=fighter.action.age,boost=fighter.boostRemaining,cooldown=fighter.cooldown;
  game.setConnected(1,false);advance(game,1);
  assert.equal(fighter.action.age,age);assert.equal(fighter.boostRemaining,boost);assert.equal(fighter.cooldown,cooldown);
  game.setConnected(1,true);advance(game,2.9);
  assert.equal(fighter.action.age,age);assert.equal(fighter.boostRemaining,boost);
  game.home();assert.equal(game.fighters[0].boostRemaining,0);
  assert.equal(game.snapshot().fighters[0].boosting,false);
});

test('using boost mid-ultimate preserves the slam and the boost continues after landing',()=>{
  const game=match(),[fighter,opponent]=game.fighters;opponent.x=0;
  game.input(0,{ult:true});advance(game,.8);
  game.input(0,{x:1});advance(game,.6);
  game.input(0,{});advance(game,.4);
  game.input(0,{skill:true});advance(game,2.3);
  assert.equal(opponent.hp,80);
  assert.equal(fighter.action,null,'ultimate completes normally');
  assert.ok(fighter.boostRemaining>1,'later boost keeps its own duration');
  assert.equal(game.snapshot().fighters[0].effect,'lightning-boost');
  assert.equal(game.snapshot().fighters[0].boosting,true);
});

test('Lightning can leave the ring while flying and preserves its falling height and momentum',()=>{
  const game=match(),fighter=game.fighters[0];fighter.x=5;
  game.input(0,{ult:true});advance(game,.8);
  game.input(0,{x:1,skill:true});advance(game,.5);
  assert.equal(fighter.ringOut,true);assert.equal(game.phase,'between');
  assert.ok(fighter.fallMotion.z>0);assert.ok(fighter.fallMotion.vx>0);
  assert.equal(game.canUse(fighter,'skill'),false);
});

test('other robots retain their existing exclusive skill and ultimate actions',()=>{
  for(const robot of [0,1,3,4,5]){
    const game=match(robot),fighter=game.fighters[0];
    game.input(0,{ult:true,skill:true});
    assert.equal(fighter.ultUsed,true);assert.equal(fighter.cooldown,0);
    assert.equal(game.canUse(fighter,'skill'),false);
    assert.equal(fighter.boostRemaining,0);
  }
});
