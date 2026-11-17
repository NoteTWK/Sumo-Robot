'use strict';

const TAU = Math.PI * 2;
const COUNTDOWN_SECONDS = 3;
const RESULT_SECONDS = 3;
const FLOOR_Z = -1.06;
const FALL_GRAVITY = 21;
const LAND_SETTLE_SECONDS = 0.24;
const RIM_CLEARANCE = 1.16;
const IMPACT_INTERVAL = 0.4;
const ULT_HP = 80;
const MAX_HP = 100;
const TURN_RATES = [16, 19, 15, 22, 14, 13];
const AIR_CONTACT_HEIGHT = .42;
const LIGHTNING_RISE = .36;
const LIGHTNING_HOVER = 3;
const LIGHTNING_DESCENT = .31;
const LIGHTNING_HEIGHT = 3;
const SPIN_CHARGE = 5;

const ROBOTS = [
  {id: 'wedge', name: 'Red Wedge', color: '#f13d3a', speed: 4.6, mass: 1, cooldown: 5,
    skill: 'Lifting Dash', ult: 'Wedge Surge', skillDamage: '0', ultDamage: '0'},
  {id: 'iron', name: 'Iron Wall', color: '#2886ee', speed: 3.6, mass: 1.3, cooldown: 7,
    skill: 'Front Spikes', ult: 'Iron Drill', skillDamage: '5', ultDamage: '0'},
  {id: 'lightning', name: 'Lightning', color: '#f6c641', speed: 5.4, mass: 0.8, cooldown: 7,
    skill: 'Double Speed', ult: 'Thunder Slam', skillDamage: '0', ultDamage: '20'},
  {id: 'spin', name: 'Spin Ring', color: '#b96ff5', speed: 4.3, mass: 0.95, cooldown: 5,
    skill: 'Neon Claws', ult: 'Unstoppable Spin', skillDamage: '15', ultDamage: '0'},
  {id: 'grapple', name: 'Grapple', color: '#4ddbb0', speed: 4, mass: 1.1, cooldown: 8,
    skill: 'Claw Carry', ult: 'Overhead Throw', skillDamage: '0', ultDamage: '0'},
  {id: 'flip', name: 'Flipper', color: '#ff9543', speed: 4.2, mass: 1.05, cooldown: 5,
    skill: 'Scoop', ult: 'Overturn', skillDamage: '0', ultDamage: '0'},
];

function oval(rx, ry) {
  return Array.from({length: 96}, (_, index) => {
    const angle = TAU * index / 96;
    return [rx * Math.cos(angle), ry * Math.sin(angle)];
  });
}

const arenaArea = Math.PI * 36;
const squareSide = Math.sqrt(arenaArea);
const triangleRadius = Math.sqrt(arenaArea / (3 * Math.sqrt(3) / 4));
const hexRadius = Math.sqrt(arenaArea / (3 * Math.sqrt(3) / 2));

function polygon(sides, radius, startAngle) {
  return Array.from({length: sides}, (_, index) => {
    const angle = startAngle + TAU * index / sides;
    return [radius * Math.cos(angle), radius * Math.sin(angle)];
  });
}

const ARENAS = [
  {id: 'circle', name: 'Circle', color: '#ff4547', icon: '○', points: oval(6, 6)},
  {id: 'square', name: 'Square', color: '#4a9aff', icon: '□', points: [[-squareSide / 2, -squareSide / 2], [squareSide / 2, -squareSide / 2], [squareSide / 2, squareSide / 2], [-squareSide / 2, squareSide / 2]]},
  {id: 'oval', name: 'Oval', color: '#ffd65d', icon: '⬭', points: oval(7.7, 36 / 7.7)},
  {id: 'triangle', name: 'Triangle', color: '#66e5bc', icon: '△', points: polygon(3, triangleRadius, -Math.PI / 2)},
  {id: 'hexagon', name: 'Hexagon', color: '#bb78f3', icon: '⬡', points: polygon(6, hexRadius, 0)},
];

function mirroredFootprint(half) {
  return [...half, ...half.slice().reverse().map(([x, y]) => [x, -y])];
}

// Ground-plane hulls of the rendered chassis, including their wheels and
// bumpers at the renderer's 1.08 scale. Positive x points toward the nose.
const FOOTPRINTS = {
  wedge: mirroredFootprint([
    [-.702, -.454], [-.696, -.618], [-.575, -.658], [-.518, -.673],
    [.215, -.673], [.929, -.594],
  ]),
  iron: mirroredFootprint([
    [-.691, -.659], [-.536, -.707], [.536, -.707], [.576, -.694],
    [.621, -.676], [.653, -.659], [.686, -.583],
  ]),
  lightning: mirroredFootprint([
    [-.814, -.360], [-.770, -.537], [-.639, -.577], [-.576, -.592],
    [.447, -.592], [.510, -.577], [.640, -.537], [.896, -.146],
  ]),
  spin: polygon(24, .7, 0),
  grapple: mirroredFootprint([
    [-.784, -.623], [-.657, -.663], [-.596, -.678], [-.084, -.678],
    [.891, -.557], [.905, -.529],
  ]),
  flip: mirroredFootprint([
    [-.699, -.623], [-.571, -.663], [-.510, -.678], [.316, -.678], [.983, -.556],
  ]),
};

const ABILITIES = {
  wedge: {
    skill: {effect: 'wedge-dash', duration: .25, drive: 8, contact: true, front: true, lift: 1.5, force: 2.4},
    ult: {effect: 'wedge-surge', duration: 1.5, lead: .28, drive: 4, steer: true, contact: true, front: true, lift: 3, force: 3.6},
  },
  iron: {
    skill: {effect: 'iron-spikes', duration: 4, reach: .13, front: true, damage: 5},
    ult: {effect: 'iron-drill', duration: .25, lead: .36, drive: 8, unstoppable: true},
  },
  lightning: {
    skill: {effect: 'lightning-boost', duration: 4, speed: 2},
    ult: {effect: 'lightning-slam', duration: LIGHTNING_RISE + LIGHTNING_HOVER + LIGHTNING_DESCENT, lead: .3, jump: true, damage: 20},
  },
  spin: {
    skill: {effect: 'spin-charge', duration: SPIN_CHARGE + 5, reach: .2, damage: 15},
    ult: {effect: 'spin-ult', duration: 5, lead: .3, reach: .25, force: 12, unstoppable: true},
  },
  grapple: {
    skill: {effect: 'grapple-grab', duration: .42, reach: .2, front: true, hold: 3},
    ult: {effect: 'grapple-toss', duration: .46, lead: .35, reach: .24, front: true, hold: .62, toss: true},
  },
  flip: {
    skill: {effect: 'flip-scoop', duration: .37, reach: .17, front: true, force: 2.2, lift: .36, flipChance: .25},
    ult: {effect: 'flip-overturn', duration: .44, lead: .36, reach: .22, front: true, force: 4.2, lift: 3, flipChance: 1},
  },
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function approach(value, target, maxDelta) {
  return value + clamp(target - value, -maxDelta, maxDelta);
}

function angleDifference(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function footprint(fighter) {
  const {robotId, angle, x, y} = fighter;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return FOOTPRINTS[ROBOTS[robotId].id].map(([front, side]) => [
    x + front * cos - side * sin, y + front * sin + side * cos,
  ]);
}

function projection(points, nx, ny) {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of points) {
    const point = x * nx + y * ny;
    min = Math.min(min, point);
    max = Math.max(max, point);
  }
  return {min, max};
}

function footprintReach(fighter, nx, ny) {
  const cos = Math.cos(fighter.angle);
  const sin = Math.sin(fighter.angle);
  return projection(FOOTPRINTS[ROBOTS[fighter.robotId].id], nx * cos + ny * sin, ny * cos - nx * sin).max;
}

function contactGeometry(a, b) {
  const first = footprint(a);
  const second = footprint(b);
  let nearest = {gap: -Infinity};
  // The largest signed gap is positive for separation. During a collision
  // the same axis defines the shortest distance needed to clear the overlap.
  for (const outline of [first, second]) {
    for (let index = 0; index < outline.length; index++) {
      const [x1, y1] = outline[index];
      const [x2, y2] = outline[(index + 1) % outline.length];
      const length = Math.hypot(x2 - x1, y2 - y1);
      const nx = (y2 - y1) / length;
      const ny = (x1 - x2) / length;
      const aSide = projection(first, nx, ny);
      const bSide = projection(second, nx, ny);
      const forwardGap = bSide.min - aSide.max;
      const backwardGap = aSide.min - bSide.max;
      if (forwardGap > nearest.gap) {
        nearest = {gap: forwardGap, nx, ny, plane: (aSide.max + bSide.min) / 2};
      }
      if (backwardGap > nearest.gap) {
        nearest = {gap: backwardGap, nx: -nx, ny: -ny, plane: -(aSide.min + bSide.max) / 2};
      }
    }
  }
  return nearest;
}

function ringContains(points, x, y) {
  return points.every(([ax, ay], i) => {
    const [bx, by] = points[(i + 1) % points.length];
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= -1e-9;
  });
}

function outwardDirection(points, x, y) {
  let nearest = Infinity;
  let outward;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const edgeX = bx - ax;
    const edgeY = by - ay;
    const length = Math.hypot(edgeX, edgeY);
    const offset = clamp(((x - ax) * edgeX + (y - ay) * edgeY) / length ** 2, 0, 1);
    const dx = x - ax - offset * edgeX;
    const dy = y - ay - offset * edgeY;
    const distance = Math.hypot(dx, dy);
    if (distance >= nearest) continue;
    nearest = distance;
    outward = distance > 1e-8 ? [dx / distance, dy / distance] : [edgeY / length, -edgeX / length];
  }
  return {outward, distance: nearest};
}

function liftPhase(fighter) {
  return fighter.liftDuration > 0 ? Math.PI * fighter.lift / fighter.liftDuration : 0;
}

function jumpState(action) {
  if (!action?.ability.jump || action.age < 0) return null;
  if (action.age < LIGHTNING_RISE) {
    const progress = action.age / LIGHTNING_RISE;
    return {effect: 'lightning-rise', progress, height: LIGHTNING_HEIGHT * (1 - (1 - progress) ** 2),
      vertical: 2 * LIGHTNING_HEIGHT * (1 - progress) / LIGHTNING_RISE};
  }
  const descentStart = LIGHTNING_RISE + LIGHTNING_HOVER;
  if (action.age < descentStart) {
    return {effect: 'lightning-hover', progress: (action.age - LIGHTNING_RISE) / LIGHTNING_HOVER,
      height: LIGHTNING_HEIGHT, vertical: 0};
  }
  const progress = clamp((action.age - descentStart) / LIGHTNING_DESCENT, 0, 1);
  return {effect: 'lightning-slam', progress, height: LIGHTNING_HEIGHT * (1 - progress ** 2),
    vertical: -2 * LIGHTNING_HEIGHT * progress / LIGHTNING_DESCENT};
}

function altitude(fighter) {
  if (fighter.carried) return fighter.carriedHeight;
  return jumpState(fighter.action)?.height ?? Math.max(0, fighter.liftHeight * Math.sin(liftPhase(fighter)));
}

function verticalSpeed(fighter) {
  if (fighter.carried) return fighter.carriedVertical;
  const jump = jumpState(fighter.action);
  if (jump) return jump.vertical;
  return fighter.lift > 0 ? -Math.cos(liftPhase(fighter)) * fighter.liftHeight * Math.PI / fighter.liftDuration : 0;
}

function beginFall(fighter, points) {
  const {outward: [nx, ny], distance} = outwardDirection(points, fighter.x, fighter.y);
  const vx = fighter.vx + fighter.kx;
  const vy = fighter.vy + fighter.ky;
  // Slow exits can be caused by contact separation instead of motor motion.
  // Carry those bots clear of the rim without replacing real launch momentum.
  const outwardSpeed = vx * nx + vy * ny;
  const assist = Math.max(0, 1.15 - outwardSpeed);
  const z = altitude(fighter);
  const vz = clamp(verticalSpeed(fighter), -12, 12);
  fighter.fallMotion = {
    axis: Math.atan2(ny, nx),
    startX: fighter.x, startY: fighter.y, nx, ny,
    clearance: Math.max(0, RIM_CLEARANCE - distance),
    flightSeconds: (vz + Math.sqrt(vz ** 2 + 2 * FALL_GRAVITY * (z - FLOOR_Z))) / FALL_GRAVITY,
    vx: vx + assist * nx, vy: vy + assist * ny,
    z, vz,
    startPitch: -.44 * Math.min(1, z),
    age: 0, tilt: 0, landingTilt: 0, landedFor: null,
  };
}

function fallInProgress(fall) {
  return Boolean(fall && (fall.landedFor === null || fall.landedFor < LAND_SETTLE_SECONDS));
}

function advanceFall(fighter, dt) {
  const fall = fighter.fallMotion;
  if (!fallInProgress(fall)) return;
  fall.age += dt;
  fighter.x += fall.vx * dt;
  fighter.y += fall.vy * dt;
  const decay = Math.exp(-(fall.landedFor === null ? 1.2 : 13) * dt);
  fall.vx *= decay;
  fall.vy *= decay;
  if (fall.landedFor === null) {
    // When a slow or grazing exit has little outward momentum, tip the chassis
    // clear of the wall over the course of the drop. Faster launches clear it naturally.
    const progress = Math.min(1, fall.age / fall.flightSeconds);
    const minimumTravel = fall.clearance * progress ** 2 * (3 - 2 * progress);
    const outwardTravel = (fighter.x - fall.startX) * fall.nx + (fighter.y - fall.startY) * fall.ny;
    const correction = Math.max(0, minimumTravel - outwardTravel);
    fighter.x += correction * fall.nx;
    fighter.y += correction * fall.ny;
    fall.tilt = Math.min(0.88, fall.age * (1.25 + 2.3 * fall.age));
    fall.z += (fall.vz - 0.5 * FALL_GRAVITY * dt) * dt;
    fall.vz -= FALL_GRAVITY * dt;
    if (fall.z <= FLOOR_Z) {
      fall.z = FLOOR_Z;
      fall.vz = 0;
      fall.landedFor = 0;
      fall.landingTilt = fall.tilt;
    }
    return;
  }
  fall.landedFor = Math.min(LAND_SETTLE_SECONDS, fall.landedFor + dt);
  const progress = fall.landedFor / LAND_SETTLE_SECONDS;
  const damp = (1 - progress) ** 2;
  fall.tilt = fall.landingTilt * Math.cos(progress * Math.PI * 1.55) * damp;
}

function collisionDamage(closing) {
  if (closing >= 7) return 16;
  if (closing >= 5) return 12;
  if (closing >= 3) return 8;
  if (closing >= 1.5) return 4;
  return 0;
}

function createFighter(index, robotId) {
  return {
    robotId,
    x: index === 0 ? -2.5 : 2.5, y: 0, angle: index === 0 ? 0 : Math.PI,
    vx: 0, vy: 0, kx: 0, ky: 0, dx: 0, dy: 0,
    hp: MAX_HP, cooldown: 0, ultUsed: false, action: null,
    grip: null, carried: false, carriedHeight: 0, carriedVertical: 0,
    lift: 0, liftDuration: 0, liftHeight: 0,
    peakHeight: 0, roll: 0, overturned: false, flipOnLanding: 0, landings: 0,
    gestureAngle: null, gestureTurn: 0, recovery: 0, recoveryDirection: 0,
    ringOut: false, fallMotion: null,
  };
}

function activeAction(fighter) {
  return fighter.action?.age >= 0 ? fighter.action : null;
}

function unstoppable(fighter) {
  return Boolean(activeAction(fighter)?.ability.unstoppable);
}

function inverseMass(fighter) {
  return unstoppable(fighter) ? 0 : 1 / ROBOTS[fighter.robotId].mass;
}

function push(fighter, x, y, force) {
  const impulse = force * inverseMass(fighter);
  fighter.kx += x * impulse;
  fighter.ky += y * impulse;
}

function setLiftArc(fighter, height, current, descending = false) {
  fighter.liftHeight = fighter.peakHeight = height;
  fighter.liftDuration = Math.sqrt(8 * height / FALL_GRAVITY);
  const age = Math.asin(clamp(current / height, 0, 1)) / Math.PI;
  fighter.lift = fighter.liftDuration * (descending ? age : 1 - age);
}

function launch(fighter, strength, x, y, flip = null) {
  const height = strength * inverseMass(fighter);
  if (height < .19 || fighter.overturned || fighter.recovery || fighter.carried || jumpState(fighter.action)) return;
  const flips = flip ?? (height >= .72);
  const side = y * Math.cos(fighter.angle) - x * Math.sin(fighter.angle);
  if (flips) fighter.flipOnLanding = side < 0 ? -1 : 1;
  if (fighter.lift === 0 || height > fighter.peakHeight) setLiftArc(fighter, height, altitude(fighter));
}

function land(fighter, height, direction = 0) {
  fighter.hp = Math.max(0, fighter.hp - height * 2.5);
  fighter.landings++;
  fighter.peakHeight = 0;
  fighter.overturned = Boolean(direction);
  fighter.roll = direction * Math.PI;
  fighter.flipOnLanding = direction;
  if (fighter.overturned) fighter.action = null;
}

function nextAbilityEffect(fighter) {
  const action = fighter.action;
  if (!action) return {effect: null, progress: 0};
  const {ability, age} = action;
  if (age < 0) return {effect: 'ult-prep', progress: clamp(1 + age / ability.lead, 0, 1)};
  if (fighter.grip) {
    const {age: gripAge, duration, toss} = fighter.grip;
    return {effect: toss ? 'grapple-toss' : 'grapple-carry', progress: clamp(gripAge / duration, 0, 1)};
  }
  const jump = jumpState(action);
  if (jump) return jump;
  if (ability.effect === 'spin-charge') {
    return age < SPIN_CHARGE ? {effect: 'spin-charge', progress: age / SPIN_CHARGE} :
      {effect: 'spin-blade', progress: clamp((age - SPIN_CHARGE) / 5, 0, 1)};
  }
  return {effect: ability.effect, progress: clamp(age / ability.duration, 0, 1)};
}

function nextAbilityEffectForHit(action) {
  return action.ability.effect === 'spin-charge' ? 'spin-blade' : action.ability.effect;
}

class Game {
  constructor() {
    this.config = {robots: [0, 1], arena: 0, bestOf: 3};
    this.connected = [false, false];
    this.impactId = 0;
    this.home();
  }

  home() {
    this.phase = 'lobby';
    this.round = 1;
    this.score = [0, 0];
    this.remaining = 0;
    this.savedPhase = null;
    this.go = 0;
    this.resetFighters();
    return true;
  }

  configure(settings) {
    if (this.phase !== 'lobby' || !settings || typeof settings !== 'object') return false;
    const {robots, arena, bestOf} = {...this.config, ...settings};
    if (!Array.isArray(robots) || robots.length !== 2 ||
        !robots.every(index => Number.isInteger(index) && ROBOTS[index]) ||
        !Number.isInteger(arena) || !ARENAS[arena] ||
        ![3, 5, 7].includes(bestOf)) return false;
    this.config = {robots: [...robots], arena, bestOf};
    this.resetFighters();
    return true;
  }

  start(countdown = COUNTDOWN_SECONDS) {
    if (!['lobby', 'final'].includes(this.phase) || !this.connected.every(Boolean)) return false;
    this.home();
    this.beginRound(countdown);
    return true;
  }

  setConnected(index, connected) {
    if (index !== 0 && index !== 1) return false;
    this.connected[index] = Boolean(connected);
    if (!connected && ['countdown', 'live', 'between'].includes(this.phase)) {
      this.savedPhase ??= {phase: this.phase, remaining: this.remaining, go: this.go};
      this.phase = 'paused';
      this.remaining = 0;
      this.go = 0;
      this.clearMovement();
    } else if (this.phase === 'paused' && this.connected.every(Boolean)) {
      this.phase = 'countdown';
      this.remaining = COUNTDOWN_SECONDS;
    }
    return true;
  }

  clearMovement() {
    for (const fighter of this.fighters) {
      fighter.dx = 0;
      fighter.dy = 0;
    }
  }

  input(index, command) {
    if ((index !== 0 && index !== 1) || this.phase !== 'live' || !this.connected[index]) return false;
    const fighter = this.fighters[index];
    const x = Number.isFinite(command?.x) ? clamp(command.x, -1, 1) : 0;
    const y = Number.isFinite(command?.y) ? clamp(command.y, -1, 1) : 0;
    const length = Math.max(1, Math.hypot(x, y));
    fighter.dx = x / length;
    fighter.dy = y / length;
    if (fighter.overturned && !fighter.recovery) {
      if (Math.hypot(x, y) < .55) {
        fighter.gestureAngle = null;
        fighter.gestureTurn = 0;
      } else {
        const angle = Math.atan2(y, x);
        if (fighter.gestureAngle !== null) {
          const step = angleDifference(fighter.gestureAngle, angle);
          fighter.gestureTurn = Math.abs(step) > 1.8 ? 0 : fighter.gestureTurn + step;
          if (Math.abs(fighter.gestureTurn) >= TAU * .85) {
            fighter.recovery = .45;
            fighter.recoveryDirection = Math.sign(fighter.gestureTurn);
          }
        }
        fighter.gestureAngle = angle;
      }
    }
    if (command?.ult === true && this.canUse(fighter, 'ult')) this.activate(fighter, 'ult');
    else if (command?.skill === true && this.canUse(fighter, 'skill')) this.activate(fighter, 'skill');
    return true;
  }

  canUse(fighter, type) {
    if (this.phase !== 'live' || fighter.action || fighter.carried || fighter.overturned || fighter.recovery ||
        fighter.lift > 0) return false;
    return type === 'ult' ? fighter.hp <= ULT_HP && !fighter.ultUsed : fighter.cooldown <= 0;
  }

  activate(fighter, type) {
    const robot = ROBOTS[fighter.robotId];
    const ability = ABILITIES[robot.id][type];
    fighter.action = {
      ability, age: -(ability.lead ?? 0), previousAge: 0, heading: fighter.angle,
      hit: false, nextPush: 0, spikeContact: false,
    };
    if (ability.speed) {
      fighter.vx *= ability.speed;
      fighter.vy *= ability.speed;
    }
    if (ability.effect === 'iron-spikes') {
      const opponent = this.fighters[0] === fighter ? this.fighters[1] : this.fighters[0];
      fighter.action.spikeContact = contactGeometry(fighter, opponent).gap <= 0;
    }
    if (type === 'ult') fighter.ultUsed = true;
    else fighter.cooldown = robot.cooldown;
  }

  resetFighters() {
    this.fighters = this.config.robots.map((robotId, index) => createFighter(index, robotId));
    this.winner = null;
    this.reason = null;
    this.touching = false;
    this.impactDelay = 0;
    this.impact = null;
  }

  beginRound(countdown = COUNTDOWN_SECONDS) {
    this.resetFighters();
    this.phase = 'countdown';
    this.remaining = countdown;
    this.go = 0;
  }

  finishRound(losses) {
    const winner = losses[0] && losses[1] ? null : (losses[0] ? 1 : 0);
    this.winner = winner;
    this.reason = winner === null ? 'DRAW' : (this.fighters[1 - winner].ringOut ? 'RING OUT' : 'HP DEPLETED');
    if (winner !== null) this.score[winner] += 1;
    const winsNeeded = (this.config.bestOf + 1) / 2;
    this.phase = winner !== null && this.score[winner] >= winsNeeded ? 'final' : 'between';
    this.remaining = this.phase === 'between' ? RESULT_SECONDS : 0;
    this.go = 0;
    this.clearMovement();
  }

  tick(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    let elapsed = Math.min(dt, 0.25);
    while (elapsed > 1e-8) {
      const step = Math.min(elapsed, 1 / 120);
      this.step(step);
      elapsed -= step;
    }
  }

  get falling() {
    return this.fighters.some(({fallMotion}) => fallInProgress(fallMotion));
  }

  step(dt) {
    if (this.phase === 'countdown') {
      this.remaining = Math.max(0, this.remaining - dt);
      if (this.remaining <= 1e-6) {
        const resume = this.savedPhase;
        this.savedPhase = null;
        this.phase = resume?.phase === 'between' ? 'between' : 'live';
        this.remaining = this.phase === 'between' ? resume.remaining : 0;
        this.go = this.phase === 'live' ? 0.65 : 0;
      }
    } else if (this.phase === 'between' || this.phase === 'final') {
      for (const fighter of this.fighters) advanceFall(fighter, dt);
      if (this.phase === 'between' && !this.falling) {
        this.remaining = Math.max(0, this.remaining - dt);
        if (this.remaining <= 1e-6) {
          if (this.winner !== null) this.round += 1;
          this.beginRound();
        }
      }
    } else if (this.phase === 'live') {
      this.stepLive(dt);
    }
  }

  stepLive(dt) {
    this.go = Math.max(0, this.go - dt);
    this.impactDelay = Math.max(0, this.impactDelay - dt);
    const [a, b] = this.fighters;
    this.advanceFighter(a, dt);
    this.advanceFighter(b, dt);
    this.updateGrip(a, b, dt);
    this.updateGrip(b, a, dt);
    this.resolveCollision(a, b);
    for (const fighter of this.fighters) this.finishAction(fighter);

    const points = ARENAS[this.config.arena].points;
    for (const fighter of this.fighters) {
      fighter.ringOut = !ringContains(points, fighter.x, fighter.y);
      if (fighter.ringOut) beginFall(fighter, points);
    }
    const losses = this.fighters.map(fighter => fighter.hp <= 0 || fighter.ringOut);
    if (losses.some(Boolean)) this.finishRound(losses);
  }

  advanceFighter(fighter, dt) {
    fighter.cooldown = Math.max(0, fighter.cooldown - dt);
    if (fighter.lift > 0) {
      fighter.lift = Math.max(0, fighter.lift - dt);
      if (fighter.lift === 0) {
        land(fighter, fighter.peakHeight, fighter.flipOnLanding);
      }
    }
    if (fighter.recovery > 0) {
      fighter.recovery = Math.max(0, fighter.recovery - dt);
      if (fighter.recovery === 0) {
        fighter.overturned = false;
        fighter.flipOnLanding = fighter.roll = fighter.gestureTurn = 0;
        fighter.gestureAngle = null;
      }
    }
    const action = fighter.action;
    if (action) {
      action.previousAge = action.age;
      action.age += dt;
    }

    const active = activeAction(fighter);
    const normalSpeed = ROBOTS[fighter.robotId].speed * (active?.ability.speed ?? 1);
    const steering = fighter.lift > 0 ? 0.3 : 1;
    const decay = Math.exp(-6 * dt);
    fighter.kx *= unstoppable(fighter) ? 0 : decay;
    fighter.ky *= unstoppable(fighter) ? 0 : decay;

    if (fighter.overturned) {
      fighter.vx = fighter.vy = 0;
      fighter.x += fighter.kx * dt;
      fighter.y += fighter.ky * dt;
      return;
    }

    if (fighter.carried || active?.ability.jump || fighter.grip?.toss) {
      fighter.vx = 0;
      fighter.vy = 0;
      if (active?.ability.jump) {
        fighter.angle = active.heading;
        fighter.kx = fighter.ky = 0;
      }
      return;
    }

    const driving = active?.ability.drive;
    const stick = Math.hypot(fighter.dx, fighter.dy);
    const moving = stick > .035;
    if (driving && !active.ability.steer) fighter.angle = active.heading;
    else if (moving) {
      const target = Math.atan2(fighter.dy, fighter.dx);
      const turning = TURN_RATES[fighter.robotId] * steering * (fighter.robotId === 2 ?
        1 - .62 * clamp(Math.hypot(fighter.vx, fighter.vy) / normalSpeed, 0, 1) : 1) * dt;
      fighter.angle += clamp(angleDifference(fighter.angle, target), -turning, turning);
    }
    if (driving) {
      const driveSeconds = clamp(active.age, 0, active.ability.duration) -
        clamp(active.previousAge, 0, active.ability.duration);
      fighter.vx = Math.cos(fighter.angle) * driving;
      fighter.vy = Math.sin(fighter.angle) * driving;
      fighter.x += fighter.vx * driveSeconds + fighter.kx * dt;
      fighter.y += fighter.vy * driveSeconds + fighter.ky * dt;
    } else {
      const acceleration = (moving ? 16 : 24) * steering * dt;
      const drive = moving ? stick * normalSpeed : 0;
      const driveX = Math.cos(fighter.angle) * drive;
      const driveY = Math.sin(fighter.angle) * drive;
      fighter.vx = approach(fighter.vx, driveX, acceleration);
      fighter.vy = approach(fighter.vy, driveY, acceleration);
      if (fighter.action?.age < 0) fighter.action.heading = fighter.angle;
      fighter.x += (fighter.vx + fighter.kx) * dt;
      fighter.y += (fighter.vy + fighter.ky) * dt;
    }
  }

  finishAction(fighter) {
    const action = fighter.action;
    if (!action || fighter.grip || (action.age + 1e-8 < action.ability.duration && !action.ended)) return;
    if (action.ability.drive) fighter.vx = fighter.vy = 0;
    if (action.ability.speed) {
      const ratio = Math.max(1, Math.hypot(fighter.vx, fighter.vy) / ROBOTS[fighter.robotId].speed);
      fighter.vx /= ratio;
      fighter.vy /= ratio;
    }
    fighter.action = null;
  }

  updateGrip(fighter, opponent, dt) {
    const grip = fighter.grip;
    if (!grip) return;
    if (!fighter.action || fighter.lift > 0) {
      this.releaseGrip(fighter, opponent, false);
      return;
    }
    const x = opponent.x;
    const y = opponent.y;
    const height = opponent.carriedHeight;
    grip.age = Math.min(grip.duration, grip.age + dt);
    const progress = Math.min(1, grip.age / grip.duration);
    const nx = Math.cos(fighter.angle);
    const ny = Math.sin(fighter.angle);
    if (grip.toss) {
      const destinationX = fighter.x - nx * 2;
      const destinationY = fighter.y - ny * 2;
      opponent.x = grip.startX + (destinationX - grip.startX) * progress;
      opponent.y = grip.startY + (destinationY - grip.startY) * progress;
      opponent.carriedHeight = Math.max(0, Math.sin(Math.PI * progress) * grip.height);
    } else {
      opponent.angle = fighter.angle + grip.targetHeading;
      const distance = footprintReach(fighter, nx, ny) + footprintReach(opponent, -nx, -ny) + 1e-6;
      opponent.x = fighter.x + nx * distance;
      opponent.y = fighter.y + ny * distance;
      opponent.carriedHeight = grip.height * Math.min(1, grip.age / .17);
    }
    opponent.vx = (opponent.x - x) / dt;
    opponent.vy = (opponent.y - y) / dt;
    opponent.carriedVertical = (opponent.carriedHeight - height) / dt;
    if (progress >= 1 - 1e-8) this.releaseGrip(fighter, opponent, true);
  }

  releaseGrip(fighter, opponent, completed) {
    const grip = fighter.grip;
    const height = opponent.carriedHeight;
    fighter.grip = null;
    if (fighter.action) fighter.action.ended = true;
    opponent.carried = false;
    opponent.carriedHeight = opponent.carriedVertical = 0;
    opponent.vx = opponent.vy = 0;
    if (grip.toss && completed) land(opponent, grip.height);
    else if (height > 0) setLiftArc(opponent, grip.toss ? grip.height : height, height, true);
  }

  resolveCollision(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const distance = Math.hypot(dx, dy);
    const aimX = distance > 1e-8 ? dx / distance : 1;
    const aimY = distance > 1e-8 ? dy / distance : 0;
    const {gap, nx, ny, plane} = contactGeometry(a, b);
    const aSlam = this.landingStrike(a);
    const bSlam = this.landingStrike(b);
    const engage = !a.carried && !b.carried &&
      (aSlam || !jumpState(a.action)) && (bSlam || !jumpState(b.action)) &&
      Math.abs(altitude(a) - altitude(b)) <= AIR_CONTACT_HEIGHT;
    const contact = engage && gap <= 0;
    const newContact = contact && !this.touching;
    if (contact) this.touching = true;
    else if (!engage || gap > 0.045) this.touching = false;
    const av = (a.vx + a.kx) * nx + (a.vy + a.ky) * ny;
    const bv = (b.vx + b.kx) * nx + (b.vy + b.ky) * ny;
    const closing = Math.max(0, av - bv);
    const aHit = this.findHit(a, engage ? gap : Infinity, aimX, aimY);
    const bHit = this.findHit(b, engage ? gap : Infinity, -aimX, -aimY);
    const damage = [0, 0];
    const stopNormalDamage = aHit?.ability.damage || bHit?.ability.damage || aSlam || bSlam;

    if (contact) {
      for (const fighter of [a, b]) this.interruptSpinCharge(fighter);
      const ai = inverseMass(a);
      const bi = inverseMass(b);
      if (ai + bi > 0) {
        const aShare = ai / (ai + bi);
        const bShare = 1 - aShare;
        const separation = -gap + 1e-6;
        a.x -= nx * separation * aShare;
        a.y -= ny * separation * aShare;
        b.x += nx * separation * bShare;
        b.y += ny * separation * bShare;
        a.vx -= nx * closing * aShare;
        a.vy -= ny * closing * aShare;
        b.vx += nx * closing * bShare;
        b.vy += ny * closing * bShare;
      }

      if (newContact && this.impactDelay <= 0 && !stopNormalDamage) {
        const total = collisionDamage(closing);
        if (total > 0) {
          const forwardA = Math.max(0, av);
          const forwardB = Math.max(0, -bv);
          // A takes 25% when only A drives into the collision, 75% when only B does.
          const ratioA = 0.75 - 0.5 * forwardA / Math.max(1e-8, forwardA + forwardB);
          damage[0] = Math.round(total * ratioA);
          damage[1] = total - damage[0];
          const force = Math.min(5, closing * 0.75);
          push(a, -nx, -ny, force * (ratioA + 0.25));
          push(b, nx, ny, force * (1.25 - ratioA));
          if (closing >= 6) {
            if (!bHit?.ability.lift && !bHit?.ability.hold) launch(a, (closing - 5) * .22 * (ratioA + .25), -nx, -ny);
            if (!aHit?.ability.lift && !aHit?.ability.hold) launch(b, (closing - 5) * .22 * (1.25 - ratioA), nx, ny);
          }
        }
      }
    }

    if (contact && aSlam) damage[1] += aSlam.ability.damage;
    if (contact && bSlam) damage[0] += bSlam.ability.damage;
    if (aHit) this.interruptSpinCharge(b);
    if (bHit) this.interruptSpinCharge(a);
    const mutualGrab = Boolean(aHit?.ability.hold && bHit?.ability.hold);
    if (aHit) {
      this.applyHit(a, b, aHit, aimX, aimY, mutualGrab);
      damage[1] += aHit.ability.damage ?? 0;
    }
    if (bHit) {
      this.applyHit(b, a, bHit, -aimX, -aimY, mutualGrab);
      damage[0] += bHit.ability.damage ?? 0;
    }
    const damagingImpact = Boolean(damage[0] || damage[1]);
    if (damagingImpact) {
      this.impactDelay = IMPACT_INTERVAL;
      a.hp = Math.max(0, a.hp - damage[0]);
      b.hp = Math.max(0, b.hp - damage[1]);
    }
    const slam = aSlam ?? bSlam;
    const actionHit = aHit ?? bHit;
    const drill = newContact && [a, b].some(fighter => activeAction(fighter)?.ability.effect === 'iron-drill');
    const kind = slam ? 'lightning-slam' : (actionHit ? nextAbilityEffectForHit(actionHit) : (drill ? 'iron-drill' : null));
    if (kind || damagingImpact || (newContact && closing >= 0.45 && closing < 1.5)) {
      const x = slam?.landingX ?? (a.x + b.x) / 2;
      const y = slam?.landingY ?? (a.y + b.y) / 2;
      const offset = !slam && contact ? plane - x * nx - y * ny : 0;
      this.impact = {id: ++this.impactId, x: x + offset * nx, y: y + offset * ny,
        power: Math.max(kind ? 3 : 0, closing, (damage[0] + damage[1]) / 2), damage, kind};
      if (slam) this.impact.angle = slam.heading;
    }
  }

  landingStrike(fighter) {
    const action = activeAction(fighter);
    if (!action?.ability.jump || action.hit || action.age + 1e-8 < action.ability.duration) return null;
    action.hit = true;
    action.landingX = fighter.x;
    action.landingY = fighter.y;
    return action;
  }

  interruptSpinCharge(fighter) {
    const action = activeAction(fighter);
    if (action?.ability.effect === 'spin-charge' && action.previousAge < SPIN_CHARGE) action.ended = true;
  }

  findHit(fighter, gap, nx, ny) {
    const action = activeAction(fighter);
    if (!action || action.hit || action.ended || fighter.carried) return null;
    const ability = action.ability;
    if (!ability.contact && ability.reach === undefined) return null;
    if (ability.effect === 'iron-spikes' && gap > ability.reach + .045) action.spikeContact = false;
    if (gap > (ability.reach ?? 0)) return null;
    if (ability.front && nx * Math.cos(fighter.angle) + ny * Math.sin(fighter.angle) < .58) return null;
    if (ability.effect === 'iron-spikes' && action.spikeContact) return null;
    if (ability.effect === 'spin-charge' && action.previousAge < SPIN_CHARGE) return null;
    if (ability.effect === 'spin-ult' && action.age < action.nextPush) return null;
    return action;
  }

  applyHit(fighter, opponent, action, nx, ny, mutualGrab) {
    const {ability} = action;
    if (ability.effect === 'iron-spikes') action.spikeContact = true;
    else if (ability.effect === 'spin-ult') action.nextPush = action.age + IMPACT_INTERVAL;
    else action.hit = true;
    if (ability.effect === 'spin-charge') action.ended = true;
    if (ability.hold && !mutualGrab && !opponent.overturned && !unstoppable(opponent)) {
      opponent.carried = true;
      opponent.carriedHeight = opponent.carriedVertical = 0;
      opponent.action = null;
      opponent.lift = opponent.liftHeight = opponent.peakHeight = opponent.flipOnLanding = 0;
      opponent.vx = opponent.vy = opponent.kx = opponent.ky = 0;
      fighter.grip = {age: 0, duration: ability.hold, toss: Boolean(ability.toss),
        startX: opponent.x, startY: opponent.y, targetHeading: opponent.angle - fighter.angle,
        height: (ability.toss ? 1.3 : .3) / ROBOTS[opponent.robotId].mass};
    }
    if (ability.force) {
      const side = ability.effect === 'spin-ult';
      push(opponent, side ? nx * .55 - ny * .835 : nx, side ? ny * .55 + nx * .835 : ny, ability.force);
    }
    if (ability.lift) {
      const chance = ability.flipChance ?? 0;
      const flips = chance === 1 || (chance > 0 && Math.random() < chance);
      launch(opponent, ability.lift, nx, ny, flips);
    }
  }

  snapshot() {
    const falling = this.falling;
    return {
      phase: this.phase,
      config: {robots: [...this.config.robots], arena: this.config.arena, bestOf: this.config.bestOf},
      connected: [...this.connected],
      round: this.round,
      score: [...this.score],
      remaining: this.remaining,
      winner: this.winner,
      reason: this.reason,
      falling,
      showcase: this.phase === 'final' && !falling,
      resume: Boolean(this.savedPhase),
      go: this.go > 0,
      impact: this.impact,
      fighters: this.fighters.map(fighter => {
        const action = fighter.action;
        const air = Math.max(0, Math.sin(liftPhase(fighter)));
        const fall = fighter.fallMotion;
        const {effect, progress: effectProgress} = nextAbilityEffect(fighter);
        const stillSpinning = effect === 'spin-charge' || effect === 'spin-blade' || effect === 'spin-ult';
        const spin = stillSpinning ? TAU * action.age * (effect === 'spin-ult' ? 2.4 : 1.7) : 0;
        return {
          x: fighter.x, y: fighter.y, angle: fighter.angle + spin, hp: fighter.hp,
          motor: fall ? 0 : clamp(Math.hypot(fighter.vx, fighter.vy) / ROBOTS[fighter.robotId].speed, 0, 1),
          cooldown: fighter.cooldown, ultCharge: clamp((MAX_HP - fighter.hp) / (MAX_HP - ULT_HP), 0, 1),
          skillReady: this.canUse(fighter, 'skill'), ultReady: this.canUse(fighter, 'ult'),
          ultUsed: fighter.ultUsed, effect, effectProgress, carried: fighter.carried,
          overturned: fighter.overturned,
          landings: fighter.landings,
          roll: fighter.recovery ? fighter.roll + fighter.recoveryDirection * Math.PI * (1 - fighter.recovery / .45) :
            fighter.lift > 0 && fighter.flipOnLanding ? fighter.flipOnLanding * Math.PI * (1 - fighter.lift / fighter.liftDuration) : fighter.roll,
          ringOut: fighter.ringOut,
          fall: fall ? Math.max(0, -fall.z) : 0,
          height: fall ? Math.max(0, fall.z) : Math.max(0, altitude(fighter)),
          tilt: fall ? fall.startPitch * Math.max(0, 1 - fall.age * 6) : -0.44 * air,
          fallAxis: fall?.axis ?? null,
          fallTilt: fall?.tilt ?? 0,
          landed: Boolean(fall && fall.landedFor !== null),
        };
      }),
    };
  }
}

module.exports = {Game, ROBOTS, ARENAS};
