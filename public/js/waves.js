(() => {
  'use strict';
  // Data-driven wave director.
  //
  // The director owns only timing and spawn layout; the game owns entities,
  // rendering and audio. Each update returns a small list of events:
  //   { type: 'spawn', enemy, x, y, opts }
  //   { type: 'waveStart', index, total, name, code }
  //   { type: 'waveClear', index, total }
  //   { type: 'bossWarning' }
  //   { type: 'bossSpawn' }
  //
  // Five waves are followed by a warning and a boss. Keep numbers in
  // js/config.js (CONFIG.sector) and the scripts below.

  const TS = window.TS = window.TS || {};
  const C = TS.CONFIG;
  const W = C.width;

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // Each group spawns `count` enemies over time. `layout` picks x positions,
  // `gap` is the delay between enemies, and `minSector` gates late enemies.
  // `growth` adds a few extra enemies per sector (capped by `maxCount`).
  const WAVE_DEFS = [
    {
      id: 'vanguard',
      name: '前哨突袭',
      code: 'VANGUARD',
      duration: 13,
      groups: [
        { at: 0.4, type: 'fighter', count: 9, layout: 'arc', gap: 0.09 },
        { at: 2.6, type: 'fighter', count: 7, layout: 'line', gap: 0.08 },
        { at: 4.4, type: 'diver', count: 4, layout: 'sides', gap: 0.18 },
        { at: 7.9, type: 'fighter', count: 10, layout: 'line', gap: 0.08 },
        { at: 11.2, type: 'fighter', count: 6, layout: 'arc', gap: 0.12, minSector: 2 }
      ]
    },
    {
      id: 'crossfire',
      name: '交叉火力',
      code: 'CROSSFIRE',
      duration: 14,
      groups: [
        { at: 0.4, type: 'gunship', count: 3, layout: 'line', gap: 0.28 },
        { at: 2.0, type: 'fighter', count: 6, layout: 'arc', gap: 0.10 },
        { at: 3.7, type: 'fighter', count: 10, layout: 'line', gap: 0.08 },
        { at: 7.1, type: 'diver', count: 5, layout: 'sides', gap: 0.16 },
        { at: 10.4, type: 'gunship', count: 2, layout: 'line', gap: 0.28, minSector: 2 },
        { at: 10.4, type: 'fighter', count: 6, layout: 'arc', gap: 0.12 },
        { at: 12.5, type: 'fighter', count: 8, layout: 'line', gap: 0.08 }
      ]
    },
    {
      id: 'pincer',
      name: '两翼包夹',
      code: 'PINCER',
      duration: 13,
      groups: [
        { at: 0.5, type: 'fighter', count: 8, layout: 'arc', gap: 0.08 },
        { at: 3.4, type: 'diver', count: 6, layout: 'sides', gap: 0.14 },
        { at: 6.8, type: 'sentinel', count: 2, layout: 'line', gap: 0.25, minSector: 2 },
        { at: 7.0, type: 'fighter', count: 12, layout: 'line', gap: 0.08 },
        { at: 9.9, type: 'fighter', count: 6, layout: 'arc', gap: 0.10 },
        { at: 11.4, type: 'diver', count: 4, layout: 'sides', gap: 0.16, minSector: 3 }
      ]
    },
    {
      id: 'sentinel-line',
      name: '哨戒防线',
      code: 'SENTINEL LINE',
      duration: 14,
      groups: [
        { at: 0.4, type: 'fighter', count: 9, layout: 'arc', gap: 0.09 },
        { at: 2.8, type: 'sentinel', count: 3, layout: 'line', gap: 0.22, minSector: 2 },
        { at: 4.0, type: 'fighter', count: 8, layout: 'line', gap: 0.08 },
        { at: 6.6, type: 'gunship', count: 3, layout: 'line', gap: 0.26 },
        { at: 9.6, type: 'fighter', count: 5, layout: 'arc', gap: 0.10, elite: true, minSector: 3 },
        { at: 12.0, type: 'fighter', count: 9, layout: 'line', gap: 0.08 }
      ]
    },
    {
      id: 'storm',
      name: '全面强袭',
      code: 'ALL-OUT STORM',
      duration: 15,
      groups: [
        { at: 0.4, type: 'fighter', count: 12, layout: 'line', gap: 0.08 },
        { at: 2.8, type: 'diver', count: 6, layout: 'sides', gap: 0.14 },
        { at: 5.5, type: 'gunship', count: 4, layout: 'line', gap: 0.24 },
        { at: 8.1, type: 'sentinel', count: 3, layout: 'line', gap: 0.22, minSector: 2 },
        { at: 10.5, type: 'fighter', count: 12, layout: 'arc', gap: 0.09 },
        { at: 12.7, type: 'diver', count: 5, layout: 'sides', gap: 0.14, minSector: 2 },
        { at: 13.6, type: 'gunship', count: 2, layout: 'random', gap: 0.20, elite: true, minSector: 4 }
      ]
    }
  ];

  function positionFor(layout, i, count, type) {
    const y = type === 'sentinel' ? -40 : -30;
    if (layout === 'line') {
      return { x: count === 1 ? W / 2 : 45 + i * (W - 90) / (count - 1), y };
    }
    if (layout === 'arc') {
      const cx = rand(115, W - 115);
      const step = 46;
      return {
        x: clamp(cx + (i - (count - 1) / 2) * step, 30, W - 30),
        y: y - (i % 2) * 16
      };
    }
    if (layout === 'sides') {
      return {
        x: i % 2 === 0 ? rand(30, 110) : rand(W - 110, W - 30),
        y
      };
    }
    return { x: rand(45, W - 45), y };
  }

  class WaveDirector {
    constructor() {
      this.reset(1);
    }

    reset(sector, grace) {
      this.sector = sector;
      this.clock = 0;
      this.phase = 'grace';
      this.phaseT = grace !== undefined ? grace : C.sector.grace;
      this.waveCount = C.sector.waves;
      this.waveIndex = 0;
      this.waveDef = WAVE_DEFS[0];
      this.waveStartAt = 0;
      this.waveT = 0;
      this.fired = new Set();
      this.queue = [];
    }

    update(dt) {
      const out = [];
      this.clock += dt;

      if (this.phase === 'grace') {
        this.phaseT -= dt;
        if (this.phaseT <= 0) this._startWave(0, out);
      } else if (this.phase === 'wave') {
        this.waveT = this.clock - this.waveStartAt;
        this._emitDueGroups(out);
        if (this.waveT >= this.waveDef.duration) {
          out.push({ type: 'waveClear', index: this.waveIndex, total: this.waveCount });
          this.phase = 'intermission';
          this.phaseT = C.sector.intermission;
          this.queue.length = 0;
        }
      } else if (this.phase === 'intermission') {
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          if (this.waveIndex + 1 < this.waveCount) {
            this._startWave(this.waveIndex + 1, out);
          } else {
            this.phase = 'bossWarning';
            this.phaseT = C.sector.warnDur;
            out.push({ type: 'bossWarning' });
          }
        }
      } else if (this.phase === 'bossWarning') {
        this.phaseT -= dt;
        if (this.phaseT <= 0) {
          this.phase = 'boss';
          out.push({ type: 'bossSpawn' });
        }
      }

      // Flush scheduled spawns (including ones scheduled by this update).
      if (this.queue.length) {
        const keep = [];
        for (const q of this.queue) {
          if (q.t <= this.clock) out.push(q.event);
          else keep.push(q);
        }
        this.queue = keep;
      }
      return out;
    }

    _startWave(index, out) {
      this.waveIndex = index;
      this.waveDef = WAVE_DEFS[index % WAVE_DEFS.length];
      this.waveStartAt = this.clock;
      this.waveT = 0;
      this.fired.clear();
      this.queue.length = 0;
      this.phase = 'wave';
      out.push({
        type: 'waveStart',
        index,
        total: this.waveCount,
        name: this.waveDef.name,
        code: this.waveDef.code
      });
    }

    _emitDueGroups(out) {
      const groups = this.waveDef.groups;
      for (let i = 0; i < groups.length; i++) {
        if (this.fired.has(i)) continue;
        const g = groups[i];
        if ((g.minSector || 1) > this.sector) {
          this.fired.add(i);
          continue;
        }
        if (this.waveT < g.at) continue;
        this.fired.add(i);
        this._scheduleGroup(g);
      }
    }

    _scheduleGroup(g) {
      const bonus = Math.max(0, Math.floor((this.sector - 1) * (g.growth !== undefined ? g.growth : 0.4)));
      const count = Math.min(g.maxCount || 9, g.count + bonus);
      for (let i = 0; i < count; i++) {
        const pos = positionFor(g.layout, i, count, g.type);
        this.queue.push({
          t: this.waveStartAt + g.at + i * (g.gap || 0),
          event: {
            type: 'spawn',
            enemy: g.type,
            x: pos.x,
            y: pos.y,
            opts: g.elite ? { elite: true } : undefined
          }
        });
      }
    }

    // True while normal waves (or their short breaks) are running.
    isSpawning() {
      return this.phase === 'grace' || this.phase === 'wave' || this.phase === 'intermission';
    }

    isBossPhase() {
      return this.phase === 'boss' || this.phase === 'bossWarning';
    }

    // Debug helper: jump straight to the boss warning.
    skipToBoss() {
      if (this.phase === 'boss' || this.phase === 'done') return false;
      this.queue.length = 0;
      this.phase = 'bossWarning';
      this.phaseT = C.sector.warnDur;
      return true;
    }

    setBossActive() {
      this.queue.length = 0;
      this.phase = 'boss';
      this.phaseT = 0;
    }

    nextBossIn() {
      if (this.phase === 'boss') return 0;
      if (this.phase === 'bossWarning') return Math.max(0, this.phaseT);
      let t = 0;
      if (this.phase === 'grace') {
        t += this.phaseT;
        for (let i = 0; i < this.waveCount; i++) {
          t += WAVE_DEFS[i % WAVE_DEFS.length].duration + C.sector.intermission;
        }
      } else if (this.phase === 'wave') {
        t += Math.max(0, this.waveDef.duration - this.waveT) + C.sector.intermission;
        for (let i = this.waveIndex + 1; i < this.waveCount; i++) {
          t += WAVE_DEFS[i % WAVE_DEFS.length].duration + C.sector.intermission;
        }
      } else if (this.phase === 'intermission') {
        t += Math.max(0, this.phaseT);
        for (let i = this.waveIndex + 1; i < this.waveCount; i++) {
          t += WAVE_DEFS[i % WAVE_DEFS.length].duration + C.sector.intermission;
        }
      }
      return t + C.sector.warnDur;
    }

    snapshot() {
      return {
        sector: this.sector,
        phase: this.phase,
        waveIndex: this.waveIndex,
        waveCount: this.waveCount,
        waveName: this.waveDef.name,
        waveT: this.phase === 'wave' ? this.waveT : 0,
        waveDuration: this.waveDef.duration,
        nextBossIn: this.nextBossIn()
      };
    }
  }

  TS.WAVE_DEFS = WAVE_DEFS;
  TS.WaveDirector = WaveDirector;
})();
