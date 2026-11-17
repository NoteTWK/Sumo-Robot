'use strict';

window.SumoEffects = function SumoEffects(context, destination) {
  const voices = new Set();
  const engines = [];
  const noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const samples = noiseBuffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

  function connectVoice(source, chain, start, duration, offset = 0) {
    const nodes = [source, ...chain];
    nodes.forEach((node, i) => node.connect(nodes[i + 1] || destination));
    voices.add(source);
    source.onended = () => {
      voices.delete(source);
      nodes.forEach(node => node.disconnect());
    };
    source.start(start, offset);
    source.stop(start + duration);
  }

  function envelope(start, duration, peak, attack = .006) {
    const envelope = context.createGain();
    const peakTime = start + Math.min(attack, duration * .3);
    envelope.gain.setValueAtTime(.0001, start);
    envelope.gain.exponentialRampToValueAtTime(peak, peakTime);
    envelope.gain.exponentialRampToValueAtTime(.0001, start + duration);
    return envelope;
  }

  function tone(start, from, to, duration, peak, type = 'sine', attack) {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    connectVoice(oscillator, [envelope(start, duration, peak, attack)], start, duration);
  }

  function noise(start, from, to, duration, peak, resonance = .75) {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = resonance;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + duration);
    connectVoice(source, [filter, envelope(start, duration, peak)], start, duration, Math.random() * (1 - duration));
  }

  function notes(start, sequence, { step = .09, duration = .15, peak = .07, type = 'triangle' } = {}) {
    sequence.forEach((frequency, i) => tone(start + step * i, frequency, frequency, duration, peak, type));
  }

  function clang(start, pitch, peak, duration = .18) {
    tone(start, pitch, pitch * .91, duration, peak, 'triangle');
    tone(start, pitch * 2.67, pitch * 2.57, duration * .68, peak * .31);
    noise(start, pitch * 3, pitch, duration * .42, peak * .7);
  }

  function thump(start, peak = .14) {
    tone(start, 150, 46, .19, peak);
    noise(start, 670, 190, .12, peak * .56);
  }

  function skill(start, robot) {
    switch (robot) {
      case 'iron':
        noise(start, 2000, 740, .19, .11);
        clang(start + .035, 320, .09, .14);
        clang(start + .12, 247, .10, .18);
        break;
      case 'lightning':
        tone(start, 160, 880, .30, .082, 'sawtooth', .022);
        noise(start + .025, 1600, 4900, .24, .092);
        tone(start + .13, 470, 1270, .22, .073, 'triangle');
        break;
      case 'spin':
        tone(start, 145, 590, .52, .070, 'triangle', .045);
        notes(start + .075, [185, 260, 390, 555], { step: .10, duration: .11, peak: .055 });
        noise(start, 450, 1850, .44, .09);
        break;
      case 'grapple':
        clang(start, 575, .055, .10);
        noise(start + .025, 1020, 1750, .12, .065);
        clang(start + .09, 402, .06, .10);
        break;
      case 'flip':
        noise(start, 710, 1850, .24, .10);
        tone(start + .018, 145, 375, .18, .08, 'triangle', .025);
        clang(start + .17, 298, .07, .12);
        break;
      default:
        tone(start, 111, 380, .18, .08, 'sawtooth', .012);
        tone(start + .08, 275, 105, .14, .075, 'triangle');
        noise(start + .045, 970, 350, .18, .08);
    }
  }

  function ultimate(start, robot) {
    switch (robot) {
      case 'iron':
        thump(start, .19);
        tone(start, 60, 190, .36, .085, 'sawtooth', .016);
        noise(start, 1180, 380, .29, .13);
        clang(start + .17, 176, .10, .20);
        break;
      case 'lightning':
        tone(start, 205, 1390, .52, .095, 'triangle', .025);
        tone(start + .035, 325, 1970, .49, .047, 'sine', .060);
        noise(start, 850, 4750, .38, .12);
        break;
      case 'spin':
        for (let i = 0; i < 5; i++) {
          tone(start + i * .069, 830 + i * 61, 320 + i * 78, .14, .067, 'triangle');
        }
        noise(start, 390, 2500, .39, .095, 1.15);
        thump(start, .14);
        break;
      case 'grapple':
        tone(start, 138, 490, .26, .071, 'triangle', .027);
        clang(start, 280, .085, .15);
        clang(start + .12, 360, .084, .17);
        break;
      case 'flip':
        thump(start, .14);
        noise(start + .04, 630, 3150, .31, .13, 1.05);
        tone(start + .065, 102, 640, .32, .104, 'triangle', .04);
        clang(start + .25, 249, .09, .20);
        break;
      default:
        thump(start, .14);
        tone(start, 98, 510, .46, .091, 'sawtooth', .02);
        tone(start + .13, 390, 160, .27, .076, 'triangle');
        noise(start + .04, 1580, 590, .37, .105);
    }
  }

  function abilityStage(start, stage) {
    switch (stage) {
      case 'lift':
        noise(start, 830, 2200, .20, .087);
        tone(start + .027, 190, 590, .19, .076, 'triangle', .025);
        break;
      case 'overturn':
        clang(start, 215, .105, .20);
        clang(start + .095, 340, .064, .17);
        thump(start + .16, .10);
        break;
      case 'lightning-hover':
        notes(start, [740, 988, 740], { step: .13, duration: .26, peak: .056, type: 'sine' });
        tone(start, 410, 375, .56, .045, 'triangle', .10);
        break;
      case 'lightning-slam':
        thump(start, .22);
        clang(start, 166, .12, .24);
        noise(start + .015, 3350, 780, .32, .16, .95);
        break;
      case 'spin-blade':
        noise(start, 2300, 5200, .12, .11, 1.32);
        clang(start + .036, 545, .064, .17);
        notes(start + .065, [692, 1046], { step: .07, duration: .18, peak: .063 });
        break;
      case 'spin-eject':
        clang(start, 385, .092, .18);
        noise(start + .027, 3150, 580, .24, .122);
        tone(start + .05, 570, 123, .24, .066, 'triangle');
        break;
      case 'grapple-carry':
        clang(start, 397, .095, .10);
        clang(start + .07, 228, .085, .15);
        tone(start + .08, 230, 148, .24, .052, 'square', .04);
        break;
      case 'throw':
        clang(start, 522, .07, .10);
        noise(start + .035, 2850, 800, .30, .12);
        tone(start + .045, 330, 780, .16, .074, 'triangle');
        tone(start + .12, 720, 185, .22, .057, 'triangle');
        break;
    }
  }

  function impact(start, power) {
    if (power < .30) {
      noise(start, 3100, 1100, .11, .15, 1.1);
      clang(start, 790, .032, .08);
      return;
    }
    const heavy = power >= .72;
    clang(start, heavy ? 290 : 445, .09 + power * .03, heavy ? .29 : .19);
    noise(start, 2480, 890, .13, .11);
    if (heavy) {
      thump(start, .17);
      clang(start + .045, 197, .053, .24);
    }
  }

  const motorPitch = { wedge: 68, iron: 46, lightning: 92, spin: 84, grapple: 54, flip: 60 };
  const ultimatePitch = { wedge: 230, iron: 145, lightning: 358, spin: 305, grapple: 200, flip: 178 };
  const clamp = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

  function createMotor(index) {
    const oscillator = context.createOscillator();
    oscillator.type = 'sawtooth';
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = .35;
    const volume = context.createGain();
    volume.gain.value = 0;
    oscillator.connect(filter);
    filter.connect(volume);
    if (context.createStereoPanner) {
      const pan = context.createStereoPanner();
      pan.pan.value = index === 0 ? -.22 : .22;
      volume.connect(pan);
      pan.connect(destination);
    } else {
      volume.connect(destination);
    }
    oscillator.start();
    return { oscillator, filter, volume, level: 0, robot: null };
  }

  function engine(levels = []) {
    const start = context.currentTime;
    for (let i = 0; i < 2; i++) {
      const { level, robot } = levels[i] || {};
      const normalized = clamp(level);
      const speed = normalized < .03 ? 0 : normalized;
      if (!engines[i] && speed > .03) engines[i] = createMotor(i);
      const motor = engines[i];
      if (!motor || (Math.abs(motor.level - speed) < .015 && motor.robot === robot &&
          Boolean(motor.level) === Boolean(speed))) continue;
      motor.level = speed;
      motor.robot = robot;
      motor.oscillator.frequency.setTargetAtTime((motorPitch[robot] ?? 68) + 115 * speed, start, .045);
      motor.filter.frequency.setTargetAtTime((robot === 'iron' ? 250 : 390) + 480 * speed, start, .045);
      motor.volume.gain.setTargetAtTime(speed ? .025 + .028 * speed : 0, start, .05);
    }
  }

  const effects = {
    select(start) {
      clang(start, 960, .04, .07);
    },
    connect(start) {
      notes(start, [523, 784], { step: .075, duration: .14, peak: .06 });
    },
    disconnect(start) {
      notes(start, [436, 311], { step: .11, duration: .18, peak: .09 });
    },
    countdown(start, { count }) {
      const frequency = ({ 5: 330, 4: 392, 3: 440, 2: 523, 1: 659 })[count] ?? 440;
      tone(start, frequency, frequency, .12, .115, 'triangle');
    },
    go(start) {
      thump(start, .18);
      notes(start, [523, 784, 1047], { step: .04, duration: .26, peak: .085 });
    },
    impact(start, { power }) {
      impact(start, clamp(power ?? .5));
    },
    skill(start, { robot }) {
      skill(start, robot);
    },
    'skill-ready'(start) {
      tone(start, 890, 1120, .08, .042, 'triangle');
    },
    'ult-warn'(start, { robot }) {
      const pitch = ultimatePitch[robot] ?? 280;
      tone(start, pitch, pitch * 2.4, .27, .086, 'sawtooth', .055);
      noise(start, 480, 1900, .26, .078, 1.25);
    },
    'ult-ready'(start) {
      notes(start, [659, 988], { step: .075, duration: .21, peak: .079 });
    },
    ult(start, { robot }) {
      ultimate(start, robot);
    },
    'ability-stage'(start, { stage }) {
      abilityStage(start, stage);
    },
    'ring-out'(start) {
      tone(start, 580, 75, .27, .095, 'triangle');
      noise(start, 2160, 680, .27, .12);
    },
    'ring-land'(start) {
      thump(start, .23);
      clang(start + .015, 184, .115, .28);
      noise(start + .035, 1600, 460, .19, .09);
    },
    'hp-depleted'(start) {
      noise(start, 4300, 740, .28, .23);
      tone(start, 790, 82, .23, .10, 'square');
      thump(start + .12, .083);
    },
    'round-win'(start) {
      notes(start, [392, 523, 659], { step: .08, duration: .23, peak: .09 });
    },
    draw(start) {
      notes(start, [349, 311], { step: .12, duration: .19, peak: .07 });
    },
    'match-win'(start) {
      notes(start, [392, 523, 587, 659, 784, 659, 880, 1047], { step: .23, duration: .37, peak: .085 });
      notes(start + 1.75, [523, 659, 784, 1047], { step: .035, duration: .95, peak: .064 });
      tone(start, 131, 131, .72, .09, 'triangle');
      tone(start + .92, 196, 196, .66, .08, 'triangle');
      tone(start + 1.75, 131, 131, 1.05, .1, 'triangle');
      thump(start, .12);
      thump(start + .92, .10);
      thump(start + 1.75, .15);
    }
  };

  function play(name, options = {}) {
    const delay = Number.isFinite(options.delay) ? Math.max(0, options.delay) : 0;
    if (Object.hasOwn(effects, name)) effects[name](context.currentTime + .005 + delay, options);
  }

  function stop() {
    const start = context.currentTime;
    voices.forEach(voice => voice.stop(start));
    for (const motor of engines) {
      motor.level = 0;
      motor.volume.gain.cancelScheduledValues(start);
      motor.volume.gain.setValueAtTime(0, start);
    }
  }

  return { play, engine, stop };
};
