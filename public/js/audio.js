(() => {
  'use strict';
  const TS = window.TS;
  const A = TS.CONFIG.audio;
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

  const Audio = {
    ac: null,
    master: null,
    comp: null,
    musicGain: null,
    sfxGain: null,
    noiseBuf: null,
    muted: false,
    musicVol: A.music,
    sfxVol: A.sfx,
    _beam: null,
    _lastShoot: 0,
    _lastGraze: 0,
    _music: { playing: false, mode: null, step: 0, next: 0, timer: null, bpm: A.bpm },

    init() {
      if (this.ac) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ac = new AC();
        this.master = this.ac.createGain();
        this.master.gain.value = this.muted ? 0 : A.master;
        this.comp = this.ac.createDynamicsCompressor();
        this.comp.threshold.value = -18;
        this.comp.knee.value = 24;
        this.comp.ratio.value = 6;
        this.comp.attack.value = 0.003;
        this.comp.release.value = 0.25;
        this.musicGain = this.ac.createGain();
        this.musicGain.gain.value = this.musicVol;
        this.sfxGain = this.ac.createGain();
        this.sfxGain.gain.value = this.sfxVol;
        this.musicGain.connect(this.master);
        this.sfxGain.connect(this.master);
        this.master.connect(this.comp);
        this.comp.connect(this.ac.destination);
        const n = this.ac.sampleRate * 0.5 | 0;
        const buf = this.ac.createBuffer(1, n, this.ac.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        this.noiseBuf = buf;
      } catch (e) {
        this.ac = null;
      }
    },

    resume() {
      if (this.ac && this.ac.state === 'suspended') this.ac.resume();
    },

    setMuted(m) {
      this.muted = !!m;
      if (this.master) {
        const t = this.ac.currentTime;
        this.master.gain.cancelScheduledValues(t);
        this.master.gain.setTargetAtTime(this.muted ? 0 : A.master, t, 0.02);
      }
    },

    setVolumes(music, sfx) {
      this.musicVol = clamp01(music);
      this.sfxVol = clamp01(sfx);
      if (!this.ac) return;
      const t = this.ac.currentTime;
      this.musicGain.gain.setTargetAtTime(this.musicVol, t, 0.03);
      this.sfxGain.gain.setTargetAtTime(this.sfxVol, t, 0.03);
    },

    _bus(name) {
      return name === 'music' ? this.musicGain : this.sfxGain;
    },

    toneAt(freq, time, o) {
      if (!this.ac) return;
      o = o || {};
      const dur = o.dur !== undefined ? o.dur : 0.15;
      const type = o.type || 'square';
      const vol = o.vol !== undefined ? o.vol : 0.08;
      const bus = this._bus(o.bus);
      if (!bus || vol <= 0) return;
      const t = Math.max(time, this.ac.currentTime + 0.001);
      const osc = this.ac.createOscillator();
      const g = this.ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(freq, 1), t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(o.to, 1), t + dur);
      g.gain.setValueAtTime(Math.max(vol, 0.0001), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(bus);
      osc.start(t);
      osc.stop(t + dur + 0.04);
    },

    noiseAt(time, o) {
      if (!this.ac || !this.noiseBuf) return;
      o = o || {};
      const dur = o.dur !== undefined ? o.dur : 0.2;
      const vol = o.vol !== undefined ? o.vol : 0.12;
      const bus = this._bus(o.bus);
      if (!bus || vol <= 0) return;
      const t = Math.max(time, this.ac.currentTime + 0.001);
      const src = this.ac.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const fl = this.ac.createBiquadFilter();
      fl.type = o.filter || 'lowpass';
      fl.Q.value = o.q !== undefined ? o.q : 0.7;
      fl.frequency.setValueAtTime(o.f || 1200, t);
      if (o.to) fl.frequency.exponentialRampToValueAtTime(Math.max(o.to, 20), t + dur);
      const g = this.ac.createGain();
      g.gain.setValueAtTime(Math.max(vol, 0.0001), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(fl).connect(g).connect(bus);
      src.start(t);
      src.stop(t + dur + 0.04);
    },

    tone(freq, o) {
      if (!this.ac) return;
      o = o || {};
      this.toneAt(freq, this.ac.currentTime + (o.delay || 0), o);
    },

    noise(dur, o) {
      if (!this.ac) return;
      o = o || {};
      this.noiseAt(this.ac.currentTime + (o.delay || 0), Object.assign({ dur }, o));
    },

    shoot(kind) {
      if (!this.ac || this.muted) return;
      const now = this.ac.currentTime;
      if (now - this._lastShoot < 0.06) return;
      this._lastShoot = now;
      if (kind === 'laser') this.tone(1450, { dur: 0.05, type: 'sawtooth', vol: 0.025, to: 420 });
      else this.tone(980, { dur: 0.055, vol: 0.028, to: 340 });
    },

    beamOn() {
      if (!this.ac || this._beam) return;
      const t = this.ac.currentTime;
      const osc = this.ac.createOscillator();
      const sub = this.ac.createOscillator();
      const fl = this.ac.createBiquadFilter();
      const g = this.ac.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 118;
      sub.type = 'square';
      sub.frequency.value = 59;
      fl.type = 'lowpass';
      fl.frequency.value = 900;
      fl.Q.value = 5;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.032, t + 0.07);
      osc.connect(fl);
      sub.connect(fl);
      fl.connect(g).connect(this.sfxGain);
      osc.start(t);
      sub.start(t);
      this._beam = { osc, sub, g };
    },

    beamOff() {
      if (!this._beam || !this.ac) return;
      const b = this._beam;
      const t = this.ac.currentTime;
      b.g.gain.cancelScheduledValues(t);
      b.g.gain.setValueAtTime(b.g.gain.value, t);
      b.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      b.osc.stop(t + 0.12);
      b.sub.stop(t + 0.12);
      this._beam = null;
    },

    expl(big) {
      if (!this.ac) return;
      if (big) {
        this.noise(0.75, { vol: 0.45, f: 800, to: 45 });
        this.tone(105, { dur: 0.55, type: 'triangle', vol: 0.26, to: 36 });
      } else {
        this.noise(0.30, { vol: 0.16, f: 1500, to: 140 });
        this.tone(210, { dur: 0.22, type: 'triangle', vol: 0.09, to: 58 });
      }
    },

    pickup() { this.tone(660, { dur: 0.08, vol: 0.07 }); this.tone(880, { dur: 0.09, vol: 0.07, delay: 0.06 }); },
    powerup() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, { dur: 0.1, vol: 0.075, delay: i * 0.055 })); },
    bomb() { this.tone(72, { dur: 0.9, type: 'sine', vol: 0.34, to: 26 }); this.noise(1.05, { vol: 0.42, f: 500, to: 35 }); },
    hurt() { this.tone(300, { dur: 0.38, type: 'sawtooth', vol: 0.18, to: 45 }); this.noise(0.24, { vol: 0.2, f: 2500, to: 300 }); },
    alarm() { for (let i = 0; i < 3; i++) this.tone(i % 2 ? 520 : 392, { dur: 0.16, vol: 0.1, delay: i * 0.18 }); },
    startGame() {
      [392, 523, 659, 784].forEach((f, i) => this.tone(f, { dur: 0.12, vol: 0.08, delay: i * 0.075 }));
      this.startMusic('sector');
    },
    bossDown() {
      [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, { dur: 0.15, vol: 0.08, delay: i * 0.085 }));
    },
    shieldGet() { this.tone(523, { dur: 0.11, vol: 0.08 }); this.tone(1046, { dur: 0.16, vol: 0.06, delay: 0.08 }); },
    shieldPop() { this.noise(0.28, { vol: 0.22, f: 1200, to: 180 }); this.tone(320, { dur: 0.2, type: 'triangle', vol: 0.11, to: 110 }); },
    missileGet() { [440, 554, 659].forEach((f, i) => this.tone(f, { dur: 0.09, vol: 0.065, delay: i * 0.045 })); },
    missileShot() { this.tone(760, { dur: 0.055, type: 'sawtooth', vol: 0.018, to: 280 }); },
    graze() {
      if (!this.ac || this.muted) return;
      const now = this.ac.currentTime;
      if (now - this._lastGraze < 0.035) return;
      this._lastGraze = now;
      this.tone(1760, { dur: 0.035, type: 'sine', vol: 0.018 });
    },
    partBreak() {
      this.noise(0.42, { vol: 0.3, f: 1200, to: 90 });
      this.tone(240, { dur: 0.3, type: 'sawtooth', vol: 0.16, to: 60 });
    },
    phase() { [330, 392, 494, 330].forEach((f, i) => this.tone(f, { dur: 0.14, type: 'sawtooth', vol: 0.07, delay: i * 0.09 })); },
    gameOver() {
      this.stopMusic(0.4);
      [392, 330, 262, 196].forEach((f, i) => this.tone(f, { dur: 0.22, type: 'triangle', vol: 0.1, delay: i * 0.16 }));
    },

    // -----------------------------------------------------------------------
    // Procedural music: a 16-step loop with separate sector/boss patterns.
    // -----------------------------------------------------------------------
    startMusic(mode) {
      this.init();
      if (!this.ac) return;
      const m = this._music;
      if (m.playing && m.mode === mode) return;
      m.mode = mode;
      if (!m.playing) {
        m.playing = true;
        m.step = 0;
        m.next = this.ac.currentTime + 0.08;
        m.timer = setInterval(() => this._scheduleMusic(), 25);
        const t = this.ac.currentTime;
        this.musicGain.gain.cancelScheduledValues(t);
        this.musicGain.gain.setValueAtTime(0.0001, t);
        this.musicGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.musicVol), t + 0.55);
      }
    },

    setMusicMode(mode) {
      if (!this.ac) return;
      const m = this._music;
      if (m.mode === mode) return;
      m.mode = mode;
      if (!m.playing) { this.startMusic(mode); return; }
      const t = this.ac.currentTime;
      const g = this.musicGain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(0.0001, g.value), t);
      g.linearRampToValueAtTime(Math.max(0.0001, this.musicVol * 0.3), t + 0.12);
      g.linearRampToValueAtTime(Math.max(0.0001, this.musicVol), t + 0.5);
    },

    pauseMusic() {
      const m = this._music;
      if (m.timer) clearInterval(m.timer);
      m.timer = null;
      m.playing = false;
      if (this.ac) {
        const t = this.ac.currentTime;
        this.musicGain.gain.cancelScheduledValues(t);
        this.musicGain.gain.setTargetAtTime(0.0001, t, 0.04);
      }
      this.beamOff();
    },

    resumeMusic() {
      const m = this._music;
      if (!this.ac || !m.mode || m.playing) return;
      m.playing = true;
      m.step = 0;
      m.next = this.ac.currentTime + 0.08;
      m.timer = setInterval(() => this._scheduleMusic(), 25);
      const t = this.ac.currentTime;
      this.musicGain.gain.cancelScheduledValues(t);
      this.musicGain.gain.setValueAtTime(0.0001, t);
      this.musicGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.musicVol), t + 0.45);
    },

    stopMusic(fade) {
      const m = this._music;
      if (m.timer) clearInterval(m.timer);
      m.timer = null;
      m.playing = false;
      m.mode = null;
      this.beamOff();
      if (!this.ac) return;
      const t = this.ac.currentTime;
      this.musicGain.gain.cancelScheduledValues(t);
      this.musicGain.gain.setValueAtTime(Math.max(0.0001, this.musicGain.gain.value), t);
      this.musicGain.gain.exponentialRampToValueAtTime(0.0001, t + (fade || 0.3));
    },

    _scheduleMusic() {
      const m = this._music;
      if (!m.playing || !this.ac) return;
      const spb = 60 / (m.bpm * 4);
      while (m.next < this.ac.currentTime + 0.12) {
        this._scheduleStep(m.step, m.next, m.mode || 'sector');
        m.next += spb;
        m.step = (m.step + 1) % 16;
      }
    },

    _scheduleStep(step, time, mode) {
      const boss = mode === 'boss';
      const bass = boss
        ? [73.42, 0, 0, 73.42, 0, 0, 87.31, 0, 0, 103.83, 0, 0, 98.0, 0, 87.31, 0]
        : [110.0, 0, 0, 110.0, 0, 0, 130.81, 0, 0, 98.0, 0, 0, 87.31, 0, 98.0, 0];
      const lead = boss
        ? [587.33, 698.46, 830.61, 698.46, 587.33, 830.61, 698.46, 587.33, 523.25, 622.25, 783.99, 622.25, 523.25, 783.99, 622.25, 587.33]
        : [440.0, 523.25, 659.25, 523.25, 440.0, 659.25, 523.25, 659.25, 392.0, 493.88, 587.33, 493.88, 392.0, 587.33, 493.88, 587.33];
      if (bass[step]) this.toneAt(bass[step], time, { dur: 0.20, type: 'triangle', vol: 0.050, bus: 'music' });
      if (step % 2 === 0) this.toneAt(lead[step], time, { dur: 0.085, type: 'square', vol: boss ? 0.020 : 0.016, bus: 'music' });
      if (step % 4 === 0) this.noiseAt(time, { dur: 0.024, vol: 0.011, f: 7000, filter: 'highpass', bus: 'music' });
      if (step === 0 || step === 8) this.toneAt(55, time, { dur: 0.12, type: 'sine', vol: 0.075, to: 38, bus: 'music' });
      if (step === 4 || step === 12) this.noiseAt(time, { dur: 0.075, vol: 0.026, f: 2400, filter: 'bandpass', bus: 'music' });
      if (boss && step % 4 === 2) this.toneAt(lead[step] * 2, time, { dur: 0.05, type: 'sawtooth', vol: 0.008, bus: 'music' });
    }
  };

  TS.Audio = Audio;
})();
