(() => {
  'use strict';
  // Local player profile: nickname, best run, lifetime stats, local top scores
  // and the offline submission queue. Kept separate from settings so either can
  // evolve without invalidating the other.
  const TS = window.TS = window.TS || {};
  const C = TS.CONFIG;
  const PCFG = C.profile || {};
  const KEY = PCFG.key || 'thunder_strike_profile_v1';
  const VERSION = PCFG.version || 1;
  const NAME_MAX = PCFG.nameMax || 12;
  const MAX_LOCAL = PCFG.maxLocalScores || 50;
  const MAX_PENDING = PCFG.maxPending || 20;
  const DEFAULT_NAME = '无名飞行员';

  const clampInt = (v, a, b, d) => {
    const n = Math.floor(Number(v));
    if (!isFinite(n)) return d;
    return n < a ? a : n > b ? b : n;
  };

  function sanitizeName(raw) {
    if (typeof raw !== 'string') return '';
    return raw
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, NAME_MAX);
  }

  function makeId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return window.crypto.randomUUID();
      }
    } catch (e) { /* ignore */ }
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function sanitizeScore(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const score = clampInt(raw.score, 0, 1e9, 0);
    if (score <= 0) return null;
    return {
      id: typeof raw.id === 'string' && raw.id.length <= 64 ? raw.id : makeId(),
      name: sanitizeName(raw.name) || DEFAULT_NAME,
      score,
      sector: clampInt(raw.sector, 1, 999, 1),
      bossKills: clampInt(raw.bossKills, 0, 9999, 0),
      graze: clampInt(raw.graze, 0, 1e7, 0),
      time: clampInt(raw.time, 0, 86400, 0),
      at: clampInt(raw.at, 0, Date.now() + 86400000, Date.now())
    };
  }

  function sortScores(list) {
    list.sort((a, b) => b.score - a.score || a.at - b.at);
    return list.slice(0, MAX_LOCAL);
  }

  function emptyProfile() {
    return {
      v: VERSION,
      name: '',
      bestScore: 0,
      bestSector: 0,
      runs: 0,
      bossKills: 0,
      graze: 0,
      totalTime: 0,
      localScores: [],
      pending: [],
      createdAt: Date.now()
    };
  }

  function normalizeProfile(raw) {
    const p = emptyProfile();
    if (!raw || typeof raw !== 'object') return p;
    p.name = sanitizeName(raw.name);
    p.bestScore = clampInt(raw.bestScore, 0, 1e9, 0);
    p.bestSector = clampInt(raw.bestSector, 0, 999, 0);
    p.runs = clampInt(raw.runs, 0, 1e7, 0);
    p.bossKills = clampInt(raw.bossKills, 0, 1e7, 0);
    p.graze = clampInt(raw.graze, 0, 1e8, 0);
    p.totalTime = clampInt(raw.totalTime, 0, 1e9, 0);
    p.createdAt = clampInt(raw.createdAt, 0, Date.now(), Date.now());
    if (Array.isArray(raw.localScores)) {
      p.localScores = sortScores(raw.localScores.map(sanitizeScore).filter(Boolean));
    }
    if (Array.isArray(raw.pending)) {
      p.pending = raw.pending.map(sanitizeScore).filter(Boolean).slice(-MAX_PENDING);
    }
    return p;
  }

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function write(p) {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
      return true;
    } catch (e) {
      return false;
    }
  }

  function migrate(p) {
    // Old builds only stored the high score under a separate key.
    try {
      const old = Math.floor(Number(localStorage.getItem(C.hiScoreKey)) || 0);
      if (old > 0 && old > p.bestScore) p.bestScore = old;
    } catch (e) { /* ignore */ }
    try {
      localStorage.removeItem(C.hiScoreKey);
    } catch (e) { /* ignore */ }
  }

  function load() {
    const raw = read();
    if (raw) return normalizeProfile(raw);
    const p = emptyProfile();
    migrate(p);
    write(p);
    return p;
  }

  const Profile = {
    key: KEY,
    defaultName: DEFAULT_NAME,
    current: load,

    save(p) {
      return write(normalizeProfile(p));
    },

    setName(raw) {
      const p = load();
      p.name = sanitizeName(raw);
      // Rename anything still waiting to be uploaded so the board stays consistent.
      for (const e of p.pending) e.name = p.name || DEFAULT_NAME;
      write(p);
      return p.name;
    },

    getName() {
      return load().name;
    },

    displayName() {
      const p = load();
      return p.name || DEFAULT_NAME;
    },

    recordRun(run) {
      const p = load();
      const entry = sanitizeScore({
        id: makeId(),
        name: p.name || DEFAULT_NAME,
        score: run.score,
        sector: run.sector,
        bossKills: run.bossKills,
        graze: run.graze,
        time: run.time,
        at: Date.now()
      });
      if (!entry) {
        p.runs += 1;
        p.bossKills += clampInt(run.bossKills, 0, 9999, 0);
        p.graze += clampInt(run.graze, 0, 1e7, 0);
        p.totalTime += clampInt(run.time, 0, 86400, 0);
        write(p);
        return { entry: null, newBest: false, profile: p };
      }

      p.runs += 1;
      p.bossKills += entry.bossKills;
      p.graze += entry.graze;
      p.totalTime += entry.time;

      const newBest = entry.score > p.bestScore ||
        (entry.score === p.bestScore && entry.sector > p.bestSector);
      if (newBest) {
        p.bestScore = entry.score;
        p.bestSector = entry.sector;
      }

      p.localScores.push(entry);
      sortScores(p.localScores);
      write(p);
      return { entry, newBest, profile: p };
    },

    queue(entry) {
      const p = load();
      const clean = sanitizeScore(entry);
      if (!clean) return false;
      if (!p.pending.some(e => e.id === clean.id)) p.pending.push(clean);
      p.pending = p.pending.slice(-MAX_PENDING);
      write(p);
      return true;
    },

    pending() {
      return load().pending;
    },

    removePending(ids) {
      const p = load();
      p.pending = p.pending.filter(e => ids.indexOf(e.id) < 0);
      write(p);
      return p.pending.length;
    },

    reset() {
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      return load();
    }
  };

  TS.Profile = Profile;
})();
