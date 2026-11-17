'use strict';

window.SumoAudio = (() => {
  const buttons = [...document.querySelectorAll('[data-audio]')];
  const storageKey = 'robot-sumo-sound-muted';
  let muted = false;
  try { muted = localStorage.getItem(storageKey) === 'true'; } catch {}

  let context, master, effects, tracks;
  let enabled = false;
  let starting = false;
  let previous = null;
  let lastMix = '';
  const contactStages = {
    'wedge-dash': 'lift', 'wedge-surge': 'lift', 'flip-scoop': 'lift', 'flip-overturn': 'lift',
    'lightning-slam': 'lightning-slam', 'spin-ult': 'spin-eject', 'grapple-toss': 'throw'
  };
  const windupStages = {
    'lightning-hover': 'lightning-hover', 'spin-blade': 'spin-blade', 'grapple-carry': 'grapple-carry'
  };
  const ultStarts = new Set(['wedge-surge', 'iron-drill', 'lightning-rise', 'spin-ult', 'grapple-toss', 'flip-overturn']);

  function updateButtons() {
    buttons.forEach(button => {
      button.textContent = enabled ? 'ปิดเสียง' : 'เปิดเสียง';
      button.setAttribute('aria-pressed', String(enabled));
    });
  }

  function changePreference(value) {
    muted = value;
    try { localStorage.setItem(storageKey, String(value)); } catch {}
  }

  function buildAudio() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext || !window.SumoEffects) return false;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0;
    const compressor = context.createDynamicsCompressor();
    master.connect(compressor).connect(context.destination);
    effects = window.SumoEffects(context, master);
    tracks = [...document.querySelectorAll('[data-music]')].map(media => {
      const gain = context.createGain();
      gain.gain.value = 0;
      context.createMediaElementSource(media).connect(gain).connect(master);
      return { media, gain };
    });
    return true;
  }

  function mix(phase) {
    if (!tracks || phase === lastMix) return;
    lastMix = phase;
    const volumes = {
      lobby: [.29, 0],
      countdown: [0, .11],
      live: [0, .32],
      between: [0, .10],
      paused: [0, .045],
      final: [0, 0],
      offline: [0, 0]
    };
    const target = volumes[phase] || volumes.offline;
    tracks.forEach(({ gain }, index) => {
      gain.gain.setTargetAtTime(target[index], context.currentTime, .14);
    });
  }

  async function enable() {
    if (enabled || starting) return;
    starting = true;
    try {
      if (!context && !buildAudio()) return;
      // Start both media elements during the gesture so later phase changes can crossfade.
      const resume = context.resume();
      tracks.forEach(({ media }) => { media.play().catch(() => {}); });
      await resume;
      if (muted || context.state !== 'running') return;
      mix(previous?.phase ?? 'offline');
      enabled = true;
      master.gain.setTargetAtTime(.92, context.currentTime, .035);
      updateButtons();
      effects.play('select');
    } catch {
      updateButtons();
    } finally {
      starting = false;
    }
  }

  function disable() {
    enabled = false;
    if (master) {
      master.gain.cancelScheduledValues(context.currentTime);
      master.gain.setValueAtTime(0, context.currentTime);
      effects.stop();
      tracks.forEach(({ media }) => media.pause());
    }
    updateButtons();
  }

  function cue(name, options) {
    if (enabled) effects.play(name, options);
  }

  function snapshot(state, robots) {
    const prior = previous;
    previous = state;
    mix(state.phase);
    if (!enabled || !prior) return;
    if (!state.practice && !prior.practice) {
      let connected = 0;
      state.connected.forEach((ready, i) => {
        if (ready && !prior.connected[i]) cue('connect', { delay: connected++ * .12 });
      });
    }

    if ((prior.phase === 'lobby' || prior.phase === 'final') && state.phase === 'countdown') {
      if (tracks[1].media.readyState > 0) tracks[1].media.currentTime = 0;
    }

    if (state.phase === 'countdown') {
      const count = Math.max(1, Math.ceil(state.remaining));
      if (prior.phase !== 'countdown' || Math.ceil(prior.remaining) !== count) {
        cue('countdown', { count });
      }
    }
    if (state.phase === 'live' && state.go && !prior.go) cue('go');
    if (state.phase === 'paused' && prior.phase !== 'paused') cue('disconnect');

    if (state.impact && state.impact.id !== prior.impact?.id) {
      const stage = contactStages[state.impact.kind];
      if (stage) cue('ability-stage', { stage });
      if (stage !== 'lightning-slam') cue('impact', { power: Math.min(1, state.impact.power / 8) });
    }
    const resultPhase = state.phase === 'between' || state.phase === 'final';
    const resultStarted = prior.phase === 'live' && resultPhase;
    if (resultStarted) {
      if (state.falling) cue('ring-out');
      if (state.reason === 'HP DEPLETED') cue('hp-depleted');
    }
    if (resultPhase && state.fighters.some((fighter, i) => fighter.landed && !prior.fighters[i].landed)) {
      cue('ring-land');
    }
    if (prior.phase === 'live' && state.fighters.some((fighter, i) => fighter.landings > prior.fighters[i].landings)) {
      cue('ring-land');
    }
    if (resultPhase && !state.falling && (resultStarted || prior.falling)) {
      cue(state.phase === 'final' ? 'match-win' : state.winner === null ? 'draw' : 'round-win',
        { delay: resultStarted ? .40 : .06 });
    }

    const motors = [];
    if (state.phase === 'live') {
      state.fighters.forEach((fighter, i) => {
        const before = prior.fighters[i];
        const robot = robots[state.config.robots[i]].id;
        motors.push({ level: fighter.motor, robot });
        if (prior.phase !== 'live') return;
        if (fighter.hp > 0 && fighter.ultCharge === 1 && before.ultCharge < 1 && !fighter.ultUsed) {
          cue('ult-ready', { delay: .13 });
        }
        if (fighter.overturned && !before.overturned) cue('ability-stage', { stage: 'overturn' });
        if (fighter.effect && fighter.effect !== before.effect) {
          const stage = windupStages[fighter.effect];
          if (stage) cue('ability-stage', { stage });
          else if (fighter.effect !== 'lightning-slam') {
            const event = fighter.effect === 'ult-prep' ? 'ult-warn' :
              before.effect === 'ult-prep' || ultStarts.has(fighter.effect) ? 'ult' : 'skill';
            cue(event, { robot });
          }
        }
      });
    }
    effects.engine(motors);
  }

  function offline() {
    mix('offline');
    if (!previous) return;
    if (previous.phase === 'live' || previous.phase === 'countdown') cue('disconnect');
    if (enabled) effects.engine([]);
    previous = null;
  }

  if (location.protocol !== 'file:') {
    buttons.forEach(button => button.addEventListener('click', () => {
      if (enabled) {
        changePreference(true);
        disable();
      } else {
        changePreference(false);
        enable();
      }
    }));
    document.addEventListener('click', event => {
      if (!muted && !enabled && event.target.closest?.('button:not([data-audio]), select')) enable();
    }, { capture: true });
  }
  return { snapshot, offline };
})();
