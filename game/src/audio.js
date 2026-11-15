// All sound is synthesised with WebAudio: there are no audio files in the game.
// A gunshot is a noise burst through a band-pass plus a sine thump; an explosion
// is the same noise slowed down and pushed through a low-pass; the bomb's beeps,
// the hit ticks and the round stingers are plain oscillators. One noise buffer
// is made once and shared by every voice.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  const listener = { x: 0, y: 0, z: 0 };

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return true;
  }

  function setListener(x, y, z) {
    listener.x = x; listener.y = y; listener.z = z;
  }

  // Loudness of a sound at a world position: full in the same room, gone by 46 m.
  function gainFor(pos, base) {
    if (!pos) return base;
    const dx = pos.x - listener.x, dy = pos.y - listener.y, dz = pos.z - listener.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return base * Math.max(0, 1 - dist / 46) ** 1.5;
  }

  function noise(pos, { dur = 0.1, freq = 1800, q = 0.8, gain = 0.5, type = 'bandpass', slide = 0 } = {}) {
    if (!ensure()) return;
    const g = gainFor(pos, gain);
    if (g <= 0.003) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (slide) filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    filter.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(g, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(amp).connect(master);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.02);
  }

  function tone(pos, { freq = 440, dur = 0.08, gain = 0.2, type = 'sine', slide = 0, delay = 0 } = {}) {
    if (!ensure()) return;
    const g = gainFor(pos, gain);
    if (g <= 0.003) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(g, t);
    amp.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // A gunshot, voiced per weapon class: heavier classes get a lower crack and a
  // longer tail. The shooter's own gun passes pos = null and stays full volume.
  function shot(kind, pos) {
    const voice = {
      kestrel: { freq: 2100, dur: 0.09, gain: 0.4, thump: 150 },
      hornet: { freq: 1900, dur: 0.08, gain: 0.38, thump: 140 },
      lance: { freq: 1500, dur: 0.13, gain: 0.5, thump: 120 },
      boar: { freq: 900, dur: 0.24, gain: 0.65, thump: 95 },
      longbow: { freq: 1100, dur: 0.34, gain: 0.7, thump: 80 },
    }[kind] ?? { freq: 1600, dur: 0.1, gain: 0.45, thump: 130 };
    noise(pos, { dur: voice.dur, freq: voice.freq, gain: voice.gain });
    tone(pos, { freq: voice.thump, dur: voice.dur * 0.9, gain: voice.gain * 0.7, type: 'triangle', slide: -voice.thump * 0.5 });
  }

  return {
    ensure,
    setListener,
    shot,
    dryFire(pos) { tone(pos, { freq: 2400, dur: 0.03, gain: 0.12, type: 'square' }); },
    reloadStart(pos) { noise(pos, { dur: 0.05, freq: 900, gain: 0.16 }); tone(pos, { freq: 320, dur: 0.04, gain: 0.1, delay: 0.05 }); },
    reloadEnd(pos) { noise(pos, { dur: 0.05, freq: 1300, gain: 0.2 }); },
    draw(pos) { noise(pos, { dur: 0.06, freq: 700, gain: 0.12 }); },
    hit(head) {
      tone(null, { freq: head ? 1560 : 1180, dur: 0.05, gain: 0.22, type: 'square' });
    },
    kill() {
      tone(null, { freq: 880, dur: 0.07, gain: 0.2, type: 'square' });
      tone(null, { freq: 1320, dur: 0.1, gain: 0.2, type: 'square', delay: 0.06 });
    },
    hurt() { noise(null, { dur: 0.09, freq: 300, gain: 0.3, type: 'lowpass' }); },
    step(pos, run) { noise(pos, { dur: 0.045, freq: run ? 500 : 380, gain: run ? 0.1 : 0.055, type: 'lowpass' }); },
    jump() { noise(null, { dur: 0.05, freq: 500, gain: 0.07, type: 'lowpass' }); },
    land() { noise(null, { dur: 0.07, freq: 260, gain: 0.14, type: 'lowpass' }); },
    bounce(pos) { tone(pos, { freq: 620, dur: 0.04, gain: 0.14, type: 'triangle' }); },
    explosion(pos) {
      noise(pos, { dur: 0.9, freq: 3000, slide: -2800, gain: 1.0, type: 'lowpass' });
      tone(pos, { freq: 110, dur: 0.8, gain: 0.8, type: 'sine', slide: -70 });
    },
    flashCrack(pos) { noise(pos, { dur: 0.18, freq: 3200, gain: 0.8 }); },
    ring() { tone(null, { freq: 4200, dur: 1.6, gain: 0.05 }); },
    smokeHiss(pos) { noise(pos, { dur: 0.7, freq: 5000, gain: 0.12, type: 'highpass' }); },
    beep(pos, freq = 880, dur = 0.07, gain = 0.2) { tone(pos, { freq, dur, gain, type: 'square' }); },
    plantDone(pos) {
      tone(pos, { freq: 660, dur: 0.08, gain: 0.25, type: 'square' });
      tone(pos, { freq: 990, dur: 0.12, gain: 0.25, type: 'square', delay: 0.09 });
    },
    defuseWire(pos) { noise(pos, { dur: 0.06, freq: 2400, gain: 0.14 }); },
    buyOk() { tone(null, { freq: 1040, dur: 0.05, gain: 0.15, type: 'square' }); },
    buyNo() { tone(null, { freq: 180, dur: 0.12, gain: 0.16, type: 'square' }); },
    stinger(win) {
      const notes = win ? [523, 659, 784] : [392, 330, 262];
      notes.forEach((freq, i) => tone(null, { freq, dur: 0.22, gain: 0.14, type: 'triangle', delay: i * 0.11 }));
    },
    throwWhoosh() { noise(null, { dur: 0.16, freq: 900, slide: 700, gain: 0.1 }); },
  };
}
