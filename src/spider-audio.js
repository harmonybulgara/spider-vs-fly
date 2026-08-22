(function attachSpiderAudio(global) {
  "use strict";

  function clamp01(v) {
    if (typeof v !== "number" || !Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  function create() {
    let ctx = null;
    let master = null;
    let enabled = false;

    let musicGain = null;
    let fxGain = null;

    let tempoBpm = 96;
    let threat = 0;
    let survivalSeconds = 0;
    let musicTimer = null;
    let step = 0;
    let barStep = 0;

    function ensure() {
      if (ctx) return;
      const AudioContext = global.AudioContext || global.webkitAudioContext;
      if (!AudioContext) return;
      ctx = new AudioContext();

      master = ctx.createGain();
      master.gain.value = 0.0;
      master.connect(ctx.destination);

      musicGain = ctx.createGain();
      musicGain.gain.value = 0.42;
      musicGain.connect(master);

      fxGain = ctx.createGain();
      fxGain.gain.value = 0.75;
      fxGain.connect(master);
    }

    function arm() {
      ensure();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      if (enabled) master.gain.setTargetAtTime(1.0, ctx.currentTime, 0.02);
      if (enabled) startMusic();
    }

    function setEnabled(next) {
      enabled = !!next;
      ensure();
      if (!ctx) return;
      if (enabled) {
        master.gain.setTargetAtTime(1.0, ctx.currentTime, 0.02);
        startMusic();
      } else {
        master.gain.setTargetAtTime(0.0, ctx.currentTime, 0.02);
        stopMusic();
      }
    }

    function isEnabled() {
      return enabled;
    }

    function setThreatLevel(level) {
      threat = clamp01(level);
      // final tempo is computed in computeTempo()
      ensure();
      if (ctx && musicGain) {
        const target = Math.min(0.9, 0.44 + threat * 0.26); // louder when closer (cap to reduce clipping)
        musicGain.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
      }
    }

    function setSurvivalSeconds(seconds) {
      if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return;
      survivalSeconds = seconds;
    }

    function computeTempo() {
      // Threat ramps quickly; survival ramps slowly over time, capped.
      const survivalRamp = Math.min(1, survivalSeconds / 75); // reaches max around ~75s
      tempoBpm = 98 + threat * 72 + survivalRamp * 42; // ~98..212
      if (tempoBpm > 212) tempoBpm = 212;
      if (tempoBpm < 88) tempoBpm = 88;
      return tempoBpm;
    }

    function now() {
      return ctx ? ctx.currentTime : 0;
    }

    function playTone({ frequency, duration, type = "sine", gain = 0.25, when = 0, detune = 0 }) {
      if (!ctx || !enabled) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      osc.detune.value = detune;
      g.gain.value = 0.0001;
      osc.connect(g);
      g.connect(fxGain);

      const t0 = now() + when;
      const t1 = t0 + duration;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, duration / 4));
      g.gain.exponentialRampToValueAtTime(0.0001, t1);

      osc.start(t0);
      osc.stop(t1 + 0.02);
    }

    function playNoise({ duration, gain = 0.2, when = 0, highpassHz = 600 }) {
      if (!ctx || !enabled) return;
      const bufferSize = Math.floor(ctx.sampleRate * duration);
      const buffer = ctx.createBuffer(1, Math.max(1, bufferSize), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.55;

      const src = ctx.createBufferSource();
      src.buffer = buffer;

      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = highpassHz;

      const g = ctx.createGain();
      g.gain.value = 0.0001;

      src.connect(hp);
      hp.connect(g);
      g.connect(fxGain);

      const t0 = now() + when;
      const t1 = t0 + duration;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, duration / 4));
      g.gain.exponentialRampToValueAtTime(0.0001, t1);

      src.start(t0);
      src.stop(t1 + 0.02);
    }

    function playWebShot() {
      // Quick "thwip": noisy burst + pitchy click.
      playNoise({ duration: 0.1, gain: 0.26, highpassHz: 950 });
      playTone({ frequency: 980, duration: 0.06, type: "triangle", gain: 0.18, detune: -35 });
      playTone({ frequency: 620, duration: 0.08, type: "triangle", gain: 0.16, when: 0.01, detune: 25 });

      if (!ctx || !enabled) return;
      // Pitch slide for a more recognizable "web shoot" character.
      const t0 = now();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(1200, t0);
      osc.frequency.exponentialRampToValueAtTime(320, t0 + 0.09);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.connect(g);
      g.connect(fxGain);
      osc.start(t0);
      osc.stop(t0 + 0.14);
    }

    function playDeath() {
      // Sad downward interval + soft low boom.
      playTone({ frequency: 392, duration: 0.22, type: "sine", gain: 0.18 });
      playTone({ frequency: 311, duration: 0.28, type: "sine", gain: 0.16, when: 0.08 });
      playTone({ frequency: 196, duration: 0.34, type: "sine", gain: 0.13, when: 0.18 });
      playNoise({ duration: 0.18, gain: 0.12, when: 0.02, highpassHz: 180 });
    }

    function playKick(when = 0, intensity = 1) {
      if (!ctx || !enabled) return;
      const t0 = now() + when;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(90, t0);
      osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.09);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.38 * intensity, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      osc.connect(g);
      g.connect(musicGain);
      osc.start(t0);
      osc.stop(t0 + 0.18);
    }

    function playHit(when = 0, intensity = 1) {
      playNoise({ duration: 0.05, gain: 0.12 * intensity, when, highpassHz: 1200 });
      playTone({ frequency: 220, duration: 0.05, type: "triangle", gain: 0.06 * intensity, when });
    }

    function playChord(when = 0, rootHz = 196, intensity = 1) {
      if (!ctx || !enabled) return;
      const t0 = now() + when;
      const chord = [0, 3, 7]; // minor triad
      const chordGain = 0.06 + threat * 0.05 + intensity * 0.02;
      const cutoff = 520 + threat * 1400;

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(cutoff, t0);
      filter.frequency.exponentialRampToValueAtTime(cutoff * 1.25, t0 + 0.08);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(chordGain, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
      filter.connect(g);
      g.connect(musicGain);

      for (const semi of chord) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(rootHz * Math.pow(2, semi / 12), t0);
        o.detune.value = (Math.random() * 12 - 6) * (0.2 + threat);
        o.connect(filter);
        o.start(t0);
        o.stop(t0 + 0.38);
      }
    }

    function playOstinato(when = 0, baseHz = 392, intensity = 1) {
      if (!ctx || !enabled) return;
      const t0 = now() + when;
      const o = ctx.createOscillator();
      o.type = "square";
      o.frequency.setValueAtTime(baseHz, t0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.045 * intensity, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
      o.connect(g);
      g.connect(musicGain);
      o.start(t0);
      o.stop(t0 + 0.1);
    }

    function scheduleBeat() {
      if (!ctx || !enabled) return;
      const bpm = computeTempo();
      const beatSec = 60 / bpm;
      const t = ctx.currentTime + 0.01;

      // Dramatic boss-y loop: pulse + chord stabs + percussion.
      // Not based on any copyrighted score; purely procedural.
      const progRoots = [196, 174.61, 220, 164.81]; // G, F, A, E (approx)
      const barRoot = progRoots[barStep % progRoots.length] * (Math.random() < 0.15 ? 2 : 1);
      const intensity = 0.7 + threat * 0.5;

      // Percussion emphasis grows over survival and threat.
      playKick(0, 0.85 + threat * 0.35);
      if (step % 2 === 0) playHit(0.02, 0.5 + threat * 0.6);
      if ((threat > 0.5 || survivalSeconds > 20) && Math.random() < 0.35) {
        playHit(0.06, 0.6 + threat * 0.8);
      }

      // Chord stabs every 4 beats.
      if (step % 4 === 0) playChord(0, barRoot * (Math.random() < 0.25 ? 0.5 : 1), intensity);
      if (threat > 0.35 || survivalSeconds > 18) {
        const ost = barRoot * (2 + (step % 2)) * (Math.random() < 0.2 ? 1.5 : 1);
        playOstinato(0.01, ost, 0.7 + threat * 0.7);
      }

      step++;
      if (step % 16 === 0) barStep++;
      musicTimer = global.setTimeout(scheduleBeat, Math.max(40, beatSec * 1000));
    }

    function startMusic() {
      if (!ctx || !enabled) return;
      if (musicTimer !== null) return;
      scheduleBeat();
    }

    function stopMusic() {
      if (musicTimer === null) return;
      global.clearTimeout(musicTimer);
      musicTimer = null;
      step = 0;
    }

    return Object.freeze({
      arm,
      setEnabled,
      isEnabled,
      setThreatLevel,
      setSurvivalSeconds,
      playWebShot,
      playDeath,
    });
  }

  global.SpiderAudio = Object.freeze({ create });
})(typeof window !== "undefined" ? window : globalThis);
