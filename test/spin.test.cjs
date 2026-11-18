'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Game, ROBOTS } = require('../game.cjs');
const STEP=1/120;

function match() {
  const game=new Game();game.configure({robots:[3,3]});
  game.setConnected(0,true);game.setConnected(1,true);game.start(0);game.tick(STEP);
  Object.assign(game.fighters[0],{x:0,y:0,angle:0,hp:80});
  Object.assign(game.fighters[1],{x:4,y:0,angle:Math.PI});
  return game;
}
function advance(game,seconds){
  while(seconds>1e-8){const step=Math.min(seconds,STEP);game.tick(step);seconds-=step;}
}
function near(actual,expected,message){assert.ok(Math.abs(actual-expected)<1e-6,message+': '+actual+' vs '+expected);}

test('Spin Ring blades and damage grow continuously from 0 to 4 seconds',()=>{
  for(const seconds of [0,.5,1,2,3,4,4.5]){
    const game=match();game.input(0,{skill:true});advance(game,seconds);
    const state=game.snapshot().fighters[0],charge=Math.min(1,seconds/4);
    near(state.bladeCharge,charge,'blade charge');
    near(state.bladeReach,.2*charge,'blade reach');
    near(state.bladeDamage,1+19*charge,'blade damage');
    assert.equal(state.effect,seconds<4?'spin-charge':'spin-blade');
  }
});

test('partial and fully charged blade collisions deal current damage once rather than cancelling harmlessly',()=>{
  for(const seconds of [0,1,2,3,4]){
    const game=match(),[fighter,victim]=game.fighters;
    game.input(0,{skill:true});advance(game,seconds);
    // A small overlap at zero charge, otherwise hit with extended blades before body contact.
    victim.x=seconds===0?1.39:1.4+.2*Math.min(1,seconds/4)*.5;
    const expected=1+19*Math.min(1,(seconds+STEP)/4);
    game.tick(STEP);
    near(victim.hp,100-expected,'damage at charge '+seconds);
    assert.equal(fighter.action,null,'the first blade hit consumes the skill');
    assert.equal(game.snapshot().fighters[0].bladeCharge,0);
    advance(game,.25);
    near(victim.hp,100-expected,'the same blade cannot hit repeatedly');
  }
});

test('a target beyond partially deployed blades is not hit until charge extends them far enough',()=>{
  const game=match(),[fighter,victim]=game.fighters;
  game.input(0,{skill:true});advance(game,1);
  victim.x=1.48; // 0.08 clearance, outside quarter-charge reach (0.05).
  game.tick(STEP);
  assert.equal(victim.hp,100);
  assert.ok(fighter.action,'a miss does not consume the skill');
  advance(game,1);
  assert.ok(victim.hp<100,'growing reach eventually contacts the target');
  assert.ok(victim.hp>89,'the early contact uses partial charge, not full 20 damage');
  assert.equal(fighter.action,null);
});

test('active skill raises speed to 1.5x and expiry restores base speed and blade state',()=>{
  const game=match(),fighter=game.fighters[0];fighter.x=-3;fighter.y=-2;
  game.input(0,{x:1,skill:true});advance(game,.5);
  near(Math.hypot(fighter.vx,fighter.vy),ROBOTS[3].speed*1.5,'skill speed');
  game.input(0,{});advance(game,8.4);
  assert.ok(fighter.action,'full blades keep the existing five-second window');
  Object.assign(fighter,{x:0,y:-2,vx:ROBOTS[3].speed*1.5,vy:0});
  game.input(0,{x:1});advance(game,.2);
  assert.equal(fighter.action,null);
  assert.ok(Math.hypot(fighter.vx,fighter.vy)<=ROBOTS[3].speed+1e-6);
  const state=game.snapshot().fighters[0];
  assert.equal(state.bladeCharge,0);assert.equal(state.bladeDamage,0);assert.equal(state.bladeReach,0);
  assert.equal(state.effect,null);
});

test('consuming the blade restores speed immediately and retains the five-second cooldown',()=>{
  const game=match(),[fighter,victim]=game.fighters;
  game.input(0,{skill:true});near(fighter.cooldown,5,'cooldown starts');advance(game,2);
  victim.x=1.45;fighter.vx=ROBOTS[3].speed*1.5;
  game.input(0,{x:1});game.tick(.001);
  assert.equal(fighter.action,null);
  assert.ok(Math.hypot(fighter.vx,fighter.vy)<=ROBOTS[3].speed+1e-6);
  assert.ok(fighter.cooldown>2.9);
  assert.equal(game.canUse(fighter,'skill'),false);
});

test('pausing freezes charge and cooldown, and resetting a round clears blades',()=>{
  const game=match(),fighter=game.fighters[0];
  game.input(0,{skill:true});advance(game,2);
  const before=game.snapshot().fighters[0],age=fighter.action.age,cooldown=fighter.cooldown;
  game.setConnected(1,false);advance(game,1);
  near(fighter.action.age,age,'paused charge');near(fighter.cooldown,cooldown,'paused cooldown');
  near(game.snapshot().fighters[0].bladeCharge,before.bladeCharge,'paused blade deployment');
  game.setConnected(1,true);advance(game,2.9);
  near(fighter.action.age,age,'countdown charge');
  game.home();const reset=game.snapshot().fighters[0];
  assert.equal(reset.bladeCharge,0);assert.equal(reset.bladeDamage,0);assert.equal(reset.bladeReach,0);
});

test('Spin Ring ultimate keeps its five-second unstoppable action and normal speed',()=>{
  const game=match(),fighter=game.fighters[0];fighter.x=-3;fighter.y=-2;
  game.input(0,{x:1,ult:true});
  assert.equal(fighter.ultUsed,true);assert.equal(fighter.cooldown,0);
  advance(game,.6);
  near(Math.hypot(fighter.vx,fighter.vy),ROBOTS[3].speed,'ultimate speed unchanged');
  assert.equal(fighter.action.ability.unstoppable,true);
  assert.equal(fighter.action.ability.duration,5);
  const state=game.snapshot().fighters[0];
  assert.equal(state.effect,'spin-ult');assert.equal(state.bladeCharge,0);assert.equal(state.bladeDamage,0);
});
