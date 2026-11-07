(() => {
  'use strict';

  const TS = window.TS;
  const {
    CONFIG, WEAPONS, BULLET_STYLES, ENEMY_TYPES,
    BOSS_TYPES, SECTORS, DEFAULT_SETTINGS
  } = TS;
  const Audio = TS.Audio;

  const cvs = document.getElementById('game');
  const ctx = cvs.getContext('2d');
  const W = CONFIG.width;
  const H = CONFIG.height;
  const TAU = Math.PI * 2;
  const FONT = '"Microsoft YaHei","PingFang SC",sans-serif';
  const MONO = 'Consolas,monospace';

  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };
  const hypot = (x, y) => Math.sqrt(x * x + y * y);
  const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
  const romanOf = n => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n - 1] || String(n);
  const fmtTime = s => {
    const m = s / 60 | 0, ss = s % 60 | 0;
    return m + ':' + String(ss).padStart(2, '0');
  };
  const blinkOn = p => Math.floor(animT * p) % 2 === 0;

  // -------------------------------------------------------------------------
  // Persistence and settings
  // -------------------------------------------------------------------------
  function loadSettings() {
    const base = Object.assign({}, DEFAULT_SETTINGS);
    try {
      const raw = localStorage.getItem(CONFIG.saveKey);
      if (raw) {
        const s = JSON.parse(raw);
        base.muted = !!s.muted;
        base.music = s.music !== undefined ? clamp(Number(s.music) || 0, 0, 1) : base.music;
        base.sfx = s.sfx !== undefined ? clamp(Number(s.sfx) || 0, 0, 1) : base.sfx;
        base.shake = s.shake !== false;
        base.hitbox = s.hitbox !== false;
        base.autoFire = s.autoFire !== false;
        base.controlMode = s.controlMode === 'stick' ? 'stick' : 'drag';
      }
    } catch (e) { /* private mode */ }
    return base;
  }

  const settings = loadSettings();
  Audio.muted = settings.muted;
  Audio.musicVol = settings.music;
  Audio.sfxVol = settings.sfx;

  function saveSettings() {
    try { localStorage.setItem(CONFIG.saveKey, JSON.stringify(settings)); } catch (e) { /* ignore */ }
  }

  let hiScore = 0;
  try { hiScore = +localStorage.getItem(CONFIG.hiScoreKey) || 0; } catch (e) { /* ignore */ }

  // -------------------------------------------------------------------------
  // Top-level state
  // -------------------------------------------------------------------------
  let state = 'title';       // title | play | over
  let paused = false;
  let pausePage = 'main';    // main | settings
  let animT = 0;
  let gameTime = 0;
  let score = 0;
  let displayScore = 0;
  let sector = 1;
  let sectorT = 0;
  let bossKills = 0;
  let shake = 0;
  let flashW = 0;
  let flashR = 0;
  let hitStop = 0;
  let slowMo = 0;
  let warnT = 0;
  let bossBannerT = 0;
  let banner = null;          // { text, sub, t, dur }
  let boss = null;
  let graceT = CONFIG.sector.grace;
  let spawnT = 0.65;
  let carrierT = CONFIG.carrier.first;
  let coreChain = 0;
  let coreChainT = 0;
  let finalTime = 0;
  let finalBossKills = 0;
  let finalSector = 1;
  let finalGraze = 0;
  let newRecord = false;
  let lastSector = -1;

  const player = {
    x: W / 2, y: H - 96,
    r: CONFIG.player.radius,
    hitR: CONFIG.player.hitR,
    speed: CONFIG.player.speed,
    lives: CONFIG.player.startLives,
    bombs: CONFIG.player.startBombs,
    maxBombs: CONFIG.player.maxBombs,
    weapon: 'spread',
    lv: { spread: 1, laser: 1 },
    fireT: 0,
    invuln: CONFIG.player.invuln,
    dead: false,
    deadT: 0,
    bombCd: 0,
    tilt: 0,
    shield: false,
    mslLvl: 0,
    mslCd: 0,
    mslSide: 1,
    graze: 0,
    beamTick: 0,
    muzzle: 0
  };

  const pBullets = [];
  const eBullets = [];
  const enemies = [];
  const drops = [];
  const parts = [];
  const rings = [];
  const pops = [];
  const pendings = [];
  const hazards = [];

  const playerLvl = () => player.lv[player.weapon];
  const playerWeapon = () => WEAPONS[player.weapon];
  const playerLevelData = () => {
    const w = playerWeapon();
    return w.levels[clamp(playerLvl() - 1, 0, w.levels.length - 1)];
  };
  const difficulty = () => {
    const d = CONFIG.difficulty;
    return {
      hp: Math.min(d.hpMax, 1 + d.hpPerSector * (sector - 1)),
      fire: Math.min(d.fireMax, 1 + d.firePerSector * (sector - 1)),
      bulletSpeed: Math.min(d.bulletSpeedMax, d.bulletSpeedBase + d.bulletSpeedPerSector * (sector - 1)),
      spawn: Math.max(d.spawnMin, d.spawnBase - d.spawnPerSector * (sector - 1)),
      elite: Math.min(d.eliteMax, d.eliteBase + d.elitePerSector * (sector - 1))
    };
  };

  // -------------------------------------------------------------------------
  // Background and cached drawing resources
  // -------------------------------------------------------------------------
  let bgGrad = null;
  let vignette = null;
  let theme = SECTORS[0];
  let stars = [];
  let nebs = [];
  let debris = [];
  let planet = null;

  const glowCache = new Map();
  const gradCache = new Map();

  function glowSprite(hue, radius, alpha) {
    const r = Math.max(16, Math.round(radius / 16) * 16);
    const a = Math.round((alpha || 0.1) * 100) / 100;
    const key = hue + ':' + r + ':' + a;
    let c = glowCache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = r * 2;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, 'hsla(' + hue + ',85%,62%,' + a + ')');
    grad.addColorStop(0.45, 'hsla(' + hue + ',85%,58%,' + (a * 0.45) + ')');
    grad.addColorStop(1, 'hsla(' + hue + ',85%,55%,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, r * 2, r * 2);
    glowCache.set(key, c);
    return c;
  }

  function linGrad(key, x0, y0, x1, y1, stops) {
    let g = gradCache.get(key);
    if (g) return g;
    g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const s of stops) g.addColorStop(s[0], s[1]);
    gradCache.set(key, g);
    return g;
  }

  function buildVignette() {
    vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.72);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(0.72, 'rgba(0,0,0,.16)');
    vignette.addColorStop(1, 'rgba(0,0,0,.52)');
  }

  function buildSector(n) {
    theme = SECTORS[(n - 1) % SECTORS.length];
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, theme.bg[0]);
    g.addColorStop(0.55, theme.bg[1]);
    g.addColorStop(1, theme.bg[2]);
    bgGrad = g;

    stars = [];
    for (let i = 0; i < 96; i++) {
      const l = Math.random();
      stars.push({
        x: rand(0, W), y: rand(0, H),
        s: l > 0.8 ? 2 : l > 0.5 ? 1.4 : 1,
        v: l > 0.8 ? 190 : l > 0.5 ? 110 : 55,
        a: l > 0.8 ? 0.9 : l > 0.5 ? 0.65 : 0.4,
        c: theme.stars[Math.random() * theme.stars.length | 0]
      });
    }

    nebs = [];
    for (let i = 0; i < 4; i++) {
      const hue = theme.nebula[i % theme.nebula.length];
      const r = Math.round(rand(140, 290) / 32) * 32;
      nebs.push({
        x: rand(0, W), y: rand(0, H), r, hue,
        v: rand(10, 22), sprite: glowSprite(hue, r, 0.11)
      });
    }

    debris = [];
    for (let i = 0; i < 12; i++) {
      debris.push({
        x: rand(0, W), y: rand(0, H), r: rand(3, 11),
        rot: rand(0, TAU), vr: rand(-1.4, 1.4), v: rand(90, 210),
        sides: randInt(5, 8), c: theme.debris
      });
    }

    planet = {
      x: rand(W * 0.15, W * 0.85),
      y: rand(-80, H * 0.35),
      r: rand(90, 210),
      hue: theme.planet,
      v: rand(4, 9)
    };
    lastSector = n;
  }

  function ensureBackdrop() {
    if (!bgGrad) buildVignette();
    if (lastSector !== sector) buildSector(sector);
  }

  // -------------------------------------------------------------------------
  // Input: keyboard + pointer (mouse and touch)
  // -------------------------------------------------------------------------
  const keys = new Set();
  const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

  const Input = {
    touchMode: window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false,
    drag: null,        // { id, startX, startY, playerX, playerY }
    stick: null,       // { id, ox, oy, vx, vy, dist }
    focusTouch: false,
    focusId: null,
    bombId: null,
    fireTouch: false,
    fireId: null,
    firePointerId: null
  };

  const TOUCH = {
    bomb: { x: W - 46, y: H - 48, r: 27 },
    focus: { x: W - 112, y: H - 48, r: 21 },
    fire: { x: W - 184, y: H - 48, r: 27 },
    pause: { x: W - 20, y: 76, r: 15 }
  };

  const fireHeld = () => settings.autoFire ||
    Input.fireTouch || Input.firePointerId !== null ||
    keys.has('KeyJ') || keys.has('KeyZ');

  const hitCircle = (x, y, c) => dist2(x, y, c.x, c.y) <= c.r * c.r;

  function pointerPos(e) {
    const r = cvs.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / Math.max(1, r.width) * W,
      y: (e.clientY - r.top) / Math.max(1, r.height) * H
    };
  }

  function toggleMute() {
    settings.muted = !settings.muted;
    Audio.setMuted(settings.muted);
    saveSettings();
  }

  function onKeyDown(e) {
    if (PREVENT.has(e.code)) e.preventDefault();
    Audio.init();
    Audio.resume();
    if (e.repeat) { keys.add(e.code); return; }

    if (e.code === 'Enter') {
      if (state === 'title' || state === 'over') startGame();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'play') {
        if (paused && (e.code === 'Escape' || e.code === 'KeyP') && pausePage === 'settings') {
          if (e.code === 'Escape') { pausePage = 'main'; return; }
        }
        togglePause();
      }
    } else if (e.code === 'KeyR') {
      if (state === 'over' || paused) startGame();
    } else if (e.code === 'Space') {
      if (state === 'play' && !paused) tryBomb();
    } else if (e.code === 'KeyM') {
      toggleMute();
    }
    keys.add(e.code);
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function onPointerDown(e) {
    Audio.init();
    Audio.resume();
    if (e.pointerType === 'touch') Input.touchMode = true;
    const p = pointerPos(e);

    if (state === 'title') {
      startGame();
      return;
    }
    if (state === 'over') {
      startGame();
      return;
    }
    if (paused) {
      handlePausePointer(p.x, p.y);
      return;
    }
    if (state !== 'play') return;

    if (Input.touchMode) {
      if (hitCircle(p.x, p.y, TOUCH.pause)) { togglePause(); return; }
      if (hitCircle(p.x, p.y, TOUCH.bomb)) { tryBomb(); return; }
      if (hitCircle(p.x, p.y, TOUCH.focus)) {
        Input.focusTouch = true;
        Input.focusId = e.pointerId;
        return;
      }
      if (!settings.autoFire && hitCircle(p.x, p.y, TOUCH.fire)) {
        Input.fireTouch = true;
        Input.fireId = e.pointerId;
        return;
      }
    }

    if (settings.controlMode === 'stick' && Input.touchMode) {
      if (Input.stick) return;
      Input.stick = { id: e.pointerId, ox: p.x, oy: p.y, vx: 0, vy: 0, dist: 0 };
      try { cvs.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      return;
    }

    if (!settings.autoFire && e.pointerType !== 'touch') Input.firePointerId = e.pointerId;

    if (!Input.drag) {
      Input.drag = {
        id: e.pointerId,
        startX: p.x, startY: p.y,
        playerX: player.x, playerY: player.y
      };
      try { cvs.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
  }

  function onPointerMove(e) {
    if (player.dead) return;
    const p = pointerPos(e);

    if (Input.stick && Input.stick.id === e.pointerId) {
      const s = Input.stick;
      let dx = p.x - s.ox, dy = p.y - s.oy;
      const d = hypot(dx, dy);
      const R = CONFIG.input.stickRadius;
      s.dist = d;
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      const dead = CONFIG.input.stickDead * R;
      s.vx = Math.abs(dx) < dead ? 0 : dx / R;
      s.vy = Math.abs(dy) < dead ? 0 : dy / R;
      return;
    }

    if (!Input.drag || Input.drag.id !== e.pointerId) return;
    const d = Input.drag;
    const focus = Input.focusTouch || keys.has('ShiftLeft') || keys.has('ShiftRight');
    const scale = focus ? CONFIG.player.focusScale : 1;
    player.x = clamp(d.playerX + (p.x - d.startX) * scale, CONFIG.playfield.left, W - CONFIG.playfield.right);
    player.y = clamp(d.playerY + (p.y - d.startY) * scale, CONFIG.playfield.top, H - CONFIG.playfield.bottom);
    player.tilt += (clamp((p.x - d.startX) * 0.02, -0.35, 0.35) - player.tilt) * 0.25;
  }

  function onPointerUp(e) {
    if (Input.drag && Input.drag.id === e.pointerId) Input.drag = null;
    if (Input.stick && Input.stick.id === e.pointerId) Input.stick = null;
    if (Input.focusId === e.pointerId) {
      Input.focusTouch = false;
      Input.focusId = null;
    }
    if (Input.bombId === e.pointerId) Input.bombId = null;
    if (Input.fireId === e.pointerId) {
      Input.fireTouch = false;
      Input.fireId = null;
    }
    if (Input.firePointerId === e.pointerId) Input.firePointerId = null;
  }

  function clearInputState() {
    keys.clear();
    Input.drag = null;
    Input.stick = null;
    Input.focusTouch = false;
    Input.focusId = null;
    Input.fireTouch = false;
    Input.fireId = null;
    Input.firePointerId = null;
  }

  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', () => {
    clearInputState();
    if (state === 'play' && !paused) togglePause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'play' && !paused) togglePause();
  });
  cvs.addEventListener('pointerdown', onPointerDown);
  cvs.addEventListener('pointermove', onPointerMove);
  cvs.addEventListener('pointerup', onPointerUp);
  cvs.addEventListener('pointercancel', onPointerUp);
  cvs.addEventListener('contextmenu', e => e.preventDefault());

  // Canvas crispness: logical 480x720, physical size follows DPR (capped at 2).
  function fitCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cvs.width = Math.round(W * dpr);
    cvs.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    gradCache.clear();
    buildVignette();
  }
  addEventListener('resize', fitCanvas);
  addEventListener('orientationchange', () => setTimeout(fitCanvas, 80));

  // -------------------------------------------------------------------------
  // Small feedback helpers
  // -------------------------------------------------------------------------
  function pop(x, y, txt, col, dur) {
    pops.push({ x, y, txt, col: col || '#ffe98a', t: 0, dur: dur || 0.9 });
  }

  function shakeAdd(n) {
    if (settings.shake) shake = Math.min(22, shake + n);
  }

  function spark(x, y, col, n, speed) {
    if (parts.length >= CONFIG.limits.maxParticles) return;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(30, speed || 180);
      parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        t: 0, dur: rand(0.2, 0.5), size: rand(1, 2.6), col
      });
    }
  }

  function boom(x, y, size) {
    rings.push({ x, y, max: size * 3.2, t: 0, dur: 0.5, col: 'rgba(255,170,90,' });
    const n = size > 30 ? 26 : size > 18 ? 18 : 12;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(40, 240) * (size / 24 + 0.4);
      parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        t: 0, dur: rand(0.35, 0.85),
        size: rand(1.5, 4) + (size > 30 ? 0.8 : 0),
        col: ['#fff', '#ffe08a', '#ff9a3c', '#ff5a3c'][Math.random() * 4 | 0]
      });
    }
    parts.push({ x, y, vx: 0, vy: -20, t: 0, dur: 0.25, size: size * 0.9, col: 'rgba(255,230,170,.95)' });
    Audio.expl(size > 26);
    shakeAdd(size > 26 ? 6 : size > 16 ? 3 : 1);
  }

  function cancelBullets(award) {
    for (const b of eBullets) {
      spark(b.x, b.y, BULLET_STYLES[b.kind] ? BULLET_STYLES[b.kind].col : '#ffd9a8', 1, 100);
      if (award) score += CONFIG.bomb.clearScore;
    }
    eBullets.length = 0;
    hazards.length = 0;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  function startGame() {
    pBullets.length = 0;
    eBullets.length = 0;
    enemies.length = 0;
    drops.length = 0;
    parts.length = 0;
    rings.length = 0;
    pops.length = 0;
    pendings.length = 0;
    hazards.length = 0;

    state = 'play';
    paused = false;
    score = 0;
    displayScore = 0;
    gameTime = 0;
    sector = 1;
    sectorT = 0;
    bossKills = 0;
    killsNoDrop = 0;
    coreChain = 0;
    coreChainT = 0;
    shake = 0;
    flashW = 0;
    flashR = 0;
    hitStop = 0;
    slowMo = 0;
    warnT = 0;
    bossBannerT = 0;
    boss = null;
    graceT = CONFIG.sector.grace;
    spawnT = 0.65;
    carrierT = CONFIG.carrier.first;
    newRecord = false;
    lastSector = -1;

    Object.assign(player, {
      x: W / 2, y: H - 96, lives: CONFIG.player.startLives,
      bombs: CONFIG.player.startBombs, weapon: 'spread',
      lv: { spread: 1, laser: 1 }, fireT: 0,
      invuln: CONFIG.player.invuln, dead: false, deadT: 0,
      bombCd: 0, tilt: 0, shield: false, mslLvl: 0,
      mslCd: 0, mslSide: 1, graze: 0, beamTick: 0,
      muzzle: 0
    });

    keys.clear();
    clearInputState();
    pausePage = 'main';
    buildSector(1);
    banner = { text: 'SECTOR I', sub: theme.name, t: 0, dur: CONFIG.sector.bannerDur };
    Audio.beamOff();
    Audio.startGame();
  }

  function togglePause() {
    if (state !== 'play') return;
    paused = !paused;
    clearInputState();
    if (paused) {
      pausePage = 'main';
      Audio.pauseMusic();
      Audio.beamOff();
    } else {
      Audio.resumeMusic();
    }
  }

  function quitToTitle() {
    state = 'title';
    paused = false;
    pausePage = 'main';
    clearInputState();
    warnT = 0;
    boss = null;
    bossBannerT = 0;
    eBullets.length = 0;
    hazards.length = 0;
    enemies.length = 0;
    drops.length = 0;
    pBullets.length = 0;
    pendings.length = 0;
    Audio.beamOff();
    Audio.stopMusic(0.3);
  }

  function gameOver() {
    finalTime = gameTime;
    finalBossKills = bossKills;
    finalSector = sector;
    finalGraze = player.graze;
    if (score > hiScore) {
      hiScore = score;
      newRecord = true;
      try { localStorage.setItem(CONFIG.hiScoreKey, String(hiScore)); } catch (e) { /* ignore */ }
    }
    state = 'over';
    paused = false;
    Audio.beamOff();
    Audio.gameOver();
  }

  function tryBomb() {
    if (state !== 'play' || paused || player.dead || player.bombs <= 0 || player.bombCd > 0) return;
    player.bombs--;
    player.bombCd = CONFIG.bomb.cooldown;
    player.invuln = Math.max(player.invuln, CONFIG.bomb.invuln);
    flashW = 0.75;
    shakeAdd(14);
    Audio.bomb();
    rings.push({ x: player.x, y: player.y, max: 540, t: 0, dur: 0.7, col: 'rgba(150,195,255,' });
    rings.push({ x: player.x, y: player.y, max: 300, t: -0.15, dur: 0.55, col: 'rgba(255,220,150,' });

    cancelBullets(true);
    const enemyDmg = CONFIG.bomb.enemyBase + CONFIG.bomb.enemyPerSector * (sector - 1);
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.hp -= enemyDmg;
      e.flash = 0.06;
      if (e.hp <= 0) killEnemy(i, true);
    }
    if (boss && boss.state === 'fight') {
      for (const p of boss.parts) {
        if (p.alive) damageBossPart(p, enemyDmg * 0.9, boss.x + p.dx, boss.y + p.dy);
      }
      damageBoss(boss.maxHp * CONFIG.bomb.bossPct, boss.x, boss.y);
    }
    sweepDeaths();
  }

  function hitPlayer() {
    if (player.dead || player.invuln > 0) return;
    if (player.shield) {
      player.shield = false;
      player.invuln = Math.max(player.invuln, 1.0);
      rings.push({ x: player.x, y: player.y, max: 64, t: 0, dur: 0.4, col: 'rgba(110,235,170,' });
      Audio.shieldPop();
      shakeAdd(4);
      pop(player.x, player.y - 34, '护盾破碎！', '#7fe8a8');
      return;
    }

    player.lives--;
    boom(player.x, player.y, 34);
    Audio.hurt();
    shakeAdd(12);
    flashR = 0.55;
    hitStop = 0.1;
    slowMo = 0.38;
    coreChain = 0;
    coreChainT = 0;

    const w = player.weapon;
    player.lv[w] = Math.max(1, player.lv[w] - CONFIG.player.deathLevelLoss);
    cancelBullets(false);

    if (player.lives <= 0) {
      gameOver();
    } else {
      player.dead = true;
      player.deadT = 1.1;
    }
  }

  function respawn() {
    player.dead = false;
    player.x = W / 2;
    player.y = H - 96;
    player.invuln = CONFIG.player.respawnInvuln;
    player.tilt = 0;
    rings.push({ x: player.x, y: player.y, max: 70, t: 0, dur: 0.45, col: 'rgba(120,200,255,' });
  }

  // -------------------------------------------------------------------------
  // Enemy spawning and wave director
  // -------------------------------------------------------------------------
  let killsNoDrop = 0;

  function spawnEnemy(type, x, y, opts) {
    opts = opts || {};
    if (enemies.length >= CONFIG.limits.maxEnemies) return null;
    const def = ENEMY_TYPES[type];
    if (!def) return null;

    const d = difficulty();
    const canElite = !opts.minion && type !== 'carrier' && type !== 'drone';
    const elite = canElite && (opts.elite !== undefined ? !!opts.elite : Math.random() < d.elite);
    const hpMul = d.hp * (elite ? 2.1 : 1);
    const e = {
      type, def, x, bx: x, y,
      t: rand(0, 6), hp: def.hp * hpMul, maxHp: def.hp * hpMul,
      r: def.r + (elite ? 3 : 0),
      score: def.score * (elite ? 3 : 1),
      elite, flash: 0, vx: 0, vy: 0,
      amp: 0, freq: 0, fireT: 99, minion: !!opts.minion,
      drop: def.drop && !opts.minion, mode: 'move', holdT: 0,
      targetY: 0, alt: false
    };

    if (type === 'fighter') {
      e.vy = rand(def.vy[0], def.vy[1]);
      e.amp = rand(def.amp[0], def.amp[1]);
      e.freq = rand(def.freq[0], def.freq[1]);
      e.fireT = rand(def.fire[0], def.fire[1]);
    } else if (type === 'gunship') {
      e.vy = rand(def.vy[0], def.vy[1]);
      e.amp = rand(def.amp[0], def.amp[1]);
      e.freq = rand(def.freq[0], def.freq[1]);
      e.fireT = rand(def.fire[0], def.fire[1]);
    } else if (type === 'carrier') {
      e.vy = def.vy;
      e.amp = def.amp;
      e.freq = def.freq;
      e.fireT = rand(def.fire[0], def.fire[1]);
    } else if (type === 'sentinel') {
      e.vy = def.vy;
      e.targetY = rand(140, 270);
      e.holdT = rand(def.hold[0], def.hold[1]);
      e.fireT = rand(def.fire[0], def.fire[1]);
      e.mode = 'enter';
    } else {
      const tx = player.x, ty = H - 96;
      const dx = tx - x, dy = ty - y, L = hypot(dx, dy) || 1;
      const sp = rand(def.speed[0], def.speed[1]) * (elite ? 1.3 : 1);
      e.vx = dx / L * sp;
      e.vy = dy / L * sp;
    }

    enemies.push(e);
    return e;
  }

  function pend(t, fn) {
    pendings.push({ t, fn });
  }

  function doWave() {
    const r = Math.random();
    const s = sector;

    if (r < 0.30) {
      const n = 5, cx = rand(90, W - 90);
      for (let i = 0; i < n; i++) {
        const ox = cx + (i - (n - 1) / 2) * 48;
        pend(i * 0.11, () => spawnEnemy('fighter', clamp(ox, 30, W - 30), -30));
      }
    } else if (r < 0.50) {
      const n = s > 3 ? 7 : 6;
      for (let i = 0; i < n; i++) {
        pend(i * 0.10, () => spawnEnemy('fighter', 45 + i * (W - 90) / (n - 1), -30));
      }
    } else if (r < 0.65 && s >= 1) {
      const n = s > 3 ? 4 : 3;
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? -1 : 1;
        pend(i * 0.20, () => spawnEnemy('diver', side < 0 ? rand(W - 120, W - 30) : rand(30, 120), -30));
      }
    } else if (r < 0.79 && s >= 1) {
      const n = s > 4 ? 3 : 2;
      for (let i = 0; i < n; i++) pend(i * 0.30, () => spawnEnemy('gunship', rand(60, W - 60), -42));
      if (s > 2) pend(0.35, () => spawnEnemy('fighter', rand(40, W - 40), -30));
    } else if (r < 0.89 && s >= 2) {
      pend(0, () => spawnEnemy('sentinel', rand(90, W - 90), -40));
      pend(0.3, () => spawnEnemy('fighter', rand(40, W - 40), -30));
      pend(0.55, () => spawnEnemy('fighter', rand(40, W - 40), -30));
    } else if (s >= 3) {
      pend(0, () => spawnEnemy('fighter', rand(40, W - 40), -30, { elite: true }));
      pend(0.35, () => spawnEnemy('fighter', rand(40, W - 40), -30));
      pend(0.6, () => spawnEnemy('gunship', rand(60, W - 60), -40));
    } else {
      spawnEnemy('fighter', rand(40, W - 40), -30);
      pend(0.3, () => spawnEnemy('gunship', rand(60, W - 60), -40));
    }
  }

  function spawnCarrier() {
    spawnEnemy('carrier', rand(80, W - 80), -48);
    carrierT = rand(CONFIG.carrier.interval[0], CONFIG.carrier.interval[1]);
  }

  // -------------------------------------------------------------------------
  // Enemies: damage, drops
  // -------------------------------------------------------------------------
  function killEnemy(i, reward) {
    const e = enemies[i];
    if (!e) return;
    enemies.splice(i, 1);
    if (reward !== false) {
      score += e.score;
      pops.push({ x: e.x, y: e.y, txt: '+' + e.score, col: e.elite ? '#ffd23e' : '#ffe98a', t: 0, dur: 0.9 });
      rollDrop(e);
    }
    boom(e.x, e.y, e.r >= 22 ? 30 : e.r >= 16 ? 20 : 12);
    if (e.elite) hitStop = Math.max(hitStop, 0.035);
  }

  function damageEnemy(i, dmg, x, y) {
    const e = enemies[i];
    if (!e) return;
    e.hp -= dmg;
    e.flash = 0.06;
    if (x !== undefined && Math.random() < 0.5) spark(x, y, '#ffd8a0', 2, 90);
    if (e.hp <= 0) killEnemy(i, true);
  }

  function sweepDeaths() {
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].hp <= 0) killEnemy(i, true);
    }
  }

  function pickDropType() {
    const weights = CONFIG.drops.weights;
    const keys = Object.keys(weights);
    let total = 0;
    for (const k of keys) total += weights[k];
    let r = Math.random() * total;
    for (const k of keys) {
      r -= weights[k];
      if (r < 0) return k;
    }
    return 'red';
  }

  function spawnDrop(x, y, type) {
    if (drops.length >= CONFIG.limits.maxDrops) return;
    drops.push({ x, y, type, t: rand(0, 6), vx: rand(-12, 12) });
  }

  function rollDrop(e) {
    if (!e.drop) return;
    const d = CONFIG.drops;

    if (e.type === 'carrier' || e.elite) {
      spawnDrop(e.x, e.y, pickDropType());
      const coreChance = e.type === 'carrier' ? d.carrierCoreChance : d.eliteCoreChance;
      if (Math.random() < coreChance) {
        spawnDrop(e.x + rand(-18, 18), e.y + rand(-8, 8), 'core');
      }
      killsNoDrop = 0;
      return;
    }

    if (killsNoDrop >= d.pityKills || Math.random() < d.randomChance) {
      spawnDrop(e.x, e.y, pickDropType());
      killsNoDrop = 0;
    } else {
      killsNoDrop++;
    }

    if (Math.random() < d.coreChance) {
      spawnDrop(e.x + rand(-14, 14), e.y + rand(-8, 8), 'core');
    }
  }

  function applyDrop(t) {
    if (t === 'bomb') {
      if (player.bombs < player.maxBombs) {
        player.bombs++;
        pop(player.x, player.y - 30, '炸弹 +1', '#ffb347');
      } else {
        score += 500;
        pop(player.x, player.y - 30, '+500');
      }
      Audio.pickup();
      return;
    }
    if (t === 'shield') {
      if (!player.shield) {
        player.shield = true;
        Audio.shieldGet();
        pop(player.x, player.y - 30, '护盾就绪！', '#7fe8a8');
      } else {
        score += 500;
        Audio.pickup();
        pop(player.x, player.y - 30, '+500');
      }
      return;
    }
    if (t === 'missile') {
      if (player.mslLvl < CONFIG.missile.levels.length) {
        player.mslLvl++;
        Audio.missileGet();
        pop(player.x, player.y - 30, '导弹 Lv.' + player.mslLvl, '#c9a0ff');
      } else {
        score += 1000;
        Audio.pickup();
        pop(player.x, player.y - 30, 'MAX +1000');
      }
      return;
    }
    if (t === 'core') {
      coreChain = Math.min(CONFIG.drops.coreChainMax, coreChain + 1);
      coreChainT = CONFIG.drops.coreChainTime;
      const val = CONFIG.drops.coreBaseScore * coreChain;
      score += val;
      Audio.pickup();
      pop(player.x, player.y - 30, 'CORE ×' + coreChain + ' +' + val, '#ffd23e');
      spark(player.x, player.y, '#ffd23e', 8, 160);
      return;
    }

    const w = t === 'red' ? 'spread' : 'laser';
    const def = WEAPONS[w];
    if (player.weapon !== w) {
      // Off-colour pickups upgrade the reserve weapon. Only swap when it has
      // caught up, so a rare drop can never force a sudden damage downgrade.
      if (player.lv[w] < def.maxLevel) player.lv[w]++;
      if (player.lv[w] >= player.lv[player.weapon]) {
        player.weapon = w;
        Audio.powerup();
        pop(player.x, player.y - 30, '切换：' + def.name, def.color);
      } else {
        Audio.pickup();
        pop(player.x, player.y - 30, '备用 ' + def.name + ' Lv.' + player.lv[w], def.color);
      }
    } else if (player.lv[w] < def.maxLevel) {
      player.lv[w]++;
      Audio.powerup();
      pop(player.x, player.y - 30, player.lv[w] === def.maxLevel ? '火力最大！' : '火力提升！', def.color);
    } else {
      score += 1000;
      Audio.pickup();
      pop(player.x, player.y - 30, 'MAX +1000');
    }
  }

  // -------------------------------------------------------------------------
  // Bullets and boss hazards
  // -------------------------------------------------------------------------
  function ebullet(x, y, a, spd, kind) {
    if (eBullets.length >= CONFIG.limits.maxEBullets) return;
    const st = BULLET_STYLES[kind] || BULLET_STYLES.aim;
    eBullets.push({
      x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
      kind: kind || 'aim', col: st.col, r: st.r, grazed: false
    });
  }

  function spawnSweep(b, opts) {
    opts = opts || {};
    hazards.push({
      kind: 'sweep',
      x: b.x, y: b.y + 20,
      angle: opts.angle !== undefined ? opts.angle : Math.PI / 2,
      rot: opts.rot || 0,
      width: opts.width || 11,
      len: 920,
      warn: opts.warn || 0.85,
      active: opts.active || 1.35,
      t: 0,
      color: opts.color || '#ff5a3c'
    });
    Audio.alarm();
  }

  // -------------------------------------------------------------------------
  // Boss
  // -------------------------------------------------------------------------
  function makeBoss() {
    const type = BOSS_TYPES[(sector - 1) % BOSS_TYPES.length];
    const maxHp = Math.min(type.hpCap, type.hpBase + type.hpPerSector * (sector - 1));
    const partsList = type.parts.map(p => ({
      id: p.id, type: p.type,
      dx: p.dx || 0, dy: p.dy || 0,
      r: p.r, hp: Math.round(maxHp * p.hpPct), maxHp: Math.round(maxHp * p.hpPct),
      alive: true, flash: 0, fireT: rand(0.8, 1.8),
      orbit: p.orbit ? Object.assign({}, p.orbit) : null
    }));

    boss = {
      type, x: W / 2, y: -150, t: 0,
      state: 'enter', hp: maxHp, maxHp, parts: partsList,
      phase: 1, invulnT: 0, hitFlash: 0,
      atkT: 1.2, ringT: 1.0, spT: 0.5, beamT: 5.5, droneT: 3.2,
      dieT: 0, coreExposed: false
    };
    bossBannerT = 2.2;
    Audio.setMusicMode('boss');
  }

  function bossPhase() {
    if (!boss) return 1;
    const r = boss.hp / boss.maxHp;
    return r > 0.66 ? 1 : r > 0.33 ? 2 : 3;
  }

  function bossPartPos(p) {
    return { x: boss.x + p.dx, y: boss.y + p.dy };
  }

  function updateBossParts(dt) {
    for (const p of boss.parts) {
      p.flash = Math.max(0, p.flash - dt);
      if (p.orbit) {
        p.orbit.a += p.orbit.spd * dt;
        p.dx = Math.cos(p.orbit.a) * p.orbit.r;
        p.dy = Math.sin(p.orbit.a) * p.orbit.r;
      }
    }
  }

  function enterBossPhase(phase) {
    boss.phase = phase;
    boss.invulnT = 0.85;
    boss.hitFlash = 0.16;
    flashW = Math.max(flashW, 0.32);
    shakeAdd(8);
    hitStop = 0.06;
    slowMo = 0.25;
    cancelBullets(false);
    Audio.phase();
    pop(boss.x, boss.y - 60, '阶段 ' + phase, boss.type.palette.glow, 1.2);
  }

  function damageBoss(dmg, x, y) {
    if (!boss || boss.state !== 'fight' || boss.invulnT > 0) return;
    const guarded = boss.parts.some(p => p.alive);
    boss.hp -= dmg * (guarded ? CONFIG.boss.coreDamageMul : 1);
    boss.hitFlash = 0.06;
    if (x !== undefined && Math.random() < 0.35) spark(x, y, boss.type.palette.glow, 2, 120);
    checkBossDeath();
  }

  function damageBossPart(p, dmg, x, y) {
    if (!boss || boss.state !== 'fight' || !p.alive || boss.invulnT > 0) return;
    p.hp -= dmg;
    p.flash = 0.06;
    if (x !== undefined && Math.random() < 0.45) spark(x, y, boss.type.palette.glow, 2, 100);
    if (p.hp <= 0) destroyBossPart(p);
  }

  function destroyBossPart(p) {
    p.alive = false;
    p.hp = 0;
    const pos = bossPartPos(p);
    boom(pos.x, pos.y, 24);
    score += CONFIG.boss.partScore;
    pop(pos.x, pos.y - 24, '+' + CONFIG.boss.partScore, '#ffd23e');
    hitStop = Math.max(hitStop, 0.07);
    Audio.partBreak();
    if (Math.random() < CONFIG.boss.partPowerupChance) spawnDrop(pos.x, pos.y, pickDropType());
    if (Math.random() < CONFIG.boss.partCoreChance) spawnDrop(pos.x + rand(-10, 10), pos.y, 'core');

    if (!boss.parts.some(q => q.alive) && !boss.coreExposed) {
      boss.coreExposed = true;
      score += CONFIG.boss.coreExposedScore;
      pop(boss.x, boss.y - 52, '核心暴露 +' + CONFIG.boss.coreExposedScore, '#ffd23e', 1.2);
      flashW = Math.max(flashW, 0.22);
      Audio.phase();
    }
  }

  function checkBossDeath() {
    if (!boss || boss.state !== 'fight' || boss.hp > 0) return;
    boss.hp = 0;
    boss.state = 'dying';
    boss.dieT = 2.4;
    cancelBullets(false);
    hitStop = 0.12;
    slowMo = 0.6;
    shakeAdd(16);
    Audio.expl(true);
  }

  function finalizeBoss() {
    const b = boss;
    if (!b) return;
    const reward = CONFIG.boss.rewardBase + CONFIG.boss.rewardPerSector * bossKills;
    boom(b.x, b.y, 48);
    boom(b.x - 60, b.y + 12, 28);
    boom(b.x + 60, b.y - 8, 28);
    score += reward;
    pops.push({ x: b.x, y: b.y - 50, txt: 'BOSS 击破 +' + reward, col: '#ffd23e', t: 0, dur: 1.4 });
    ['red', 'blue', 'bomb', 'core'].forEach((t, i) => spawnDrop(b.x + (i - 1.5) * 46, b.y + rand(-8, 8), t));

    bossKills++;
    sector++;
    sectorT = 0;
    boss = null;
    bossBannerT = 0;
    graceT = CONFIG.sector.grace;
    spawnT = 0.9;
    carrierT = CONFIG.carrier.first;
    buildSector(sector);
    banner = { text: 'SECTOR ' + romanOf(sector), sub: theme.name, t: 0, dur: CONFIG.sector.bannerDur };
    Audio.bossDown();
    Audio.setMusicMode('sector');
    hitStop = Math.max(hitStop, 0.08);
    slowMo = Math.max(slowMo, 0.35);
  }

  function bossTouchPlayer() {
    if (!boss || boss.state !== 'fight' || player.dead || player.invuln > 0) return;
    const coreY = boss.y + boss.type.core.dy;
    const dx = (player.x - boss.x) / boss.type.core.rx;
    const dy = (player.y - coreY) / boss.type.core.ry;
    if (dx * dx + dy * dy <= 1) { hitPlayer(); return; }
    for (const p of boss.parts) {
      if (!p.alive) continue;
      const pos = bossPartPos(p);
      if (dist2(player.x, player.y, pos.x, pos.y) < (p.r + player.r) * (p.r + player.r)) {
        hitPlayer();
        return;
      }
    }
  }

  function updateBossBehavior(dt) {
    const b = boss;
    const d = difficulty();
    const cd = 1 / Math.max(0.6, d.fire);
    const spd = d.bulletSpeed;
    const canFire = () => eBullets.length < CONFIG.limits.maxEBullets;

    if (b.type.id === 'destroyer') {
      b.atkT -= dt;
      if (b.atkT <= 0 && canFire()) {
        b.atkT = 1.55 * cd;
        const a = angleTo(b.x, b.y + 44, player.x, player.y);
        for (let k = -1; k <= 1; k++) ebullet(b.x, b.y + 44, a + k * 0.22, spd * 1.05, 'aim');
      }
      for (const p of b.parts) {
        if (!p.alive || p.type !== 'cannon') continue;
        p.fireT -= dt;
        if (p.fireT <= 0 && canFire()) {
          p.fireT = 2.0 * cd;
          const pos = bossPartPos(p);
          const a = angleTo(pos.x, pos.y, player.x, player.y);
          ebullet(pos.x, pos.y, a - 0.08, spd * 0.95, 'heavy');
          ebullet(pos.x, pos.y, a + 0.08, spd * 0.95, 'heavy');
        }
      }
      if (b.phase >= 2) {
        b.ringT -= dt;
        if (b.ringT <= 0 && canFire()) {
          b.ringT = 1.45 * cd;
          const n = b.phase === 3 ? 16 : 12, off = rand(0, TAU);
          for (let k = 0; k < n; k++) ebullet(b.x, b.y + 20, off + k * TAU / n, spd * 0.75, 'ring');
        }
      }
      if (b.phase >= 3) {
        b.spT -= dt;
        if (b.spT <= 0 && canFire()) {
          b.spT = 0.18;
          const a = b.t * 2.1;
          ebullet(b.x, b.y + 24, a, spd * 0.9, 'spread');
          ebullet(b.x, b.y + 24, a + Math.PI, spd * 0.9, 'spread');
        }
        b.beamT -= dt;
        if (b.beamT <= 0) {
          b.beamT = 8.5;
          spawnSweep(b, { angle: Math.PI / 2, rot: (Math.random() < 0.5 ? -1 : 1) * 0.55, width: 12, warn: 0.9, active: 1.2 });
        }
      }
    } else if (b.type.id === 'hive') {
      for (const p of b.parts) {
        if (!p.alive) continue;
        p.fireT -= dt;
        if (p.fireT <= 0 && canFire()) {
          p.fireT = 2.2 * cd;
          const pos = bossPartPos(p);
          const off = rand(0, TAU);
          for (let k = 0; k < 6; k++) ebullet(pos.x, pos.y, off + k * TAU / 6, spd * 0.7, 'ring');
        }
      }
      b.spT -= dt;
      if (b.spT <= 0 && canFire()) {
        b.spT = 0.2;
        const n = b.phase >= 3 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const a = b.t * (1.6 + k * 0.35) + k * Math.PI;
          ebullet(b.x, b.y, a, spd * 0.85, 'spread');
        }
      }
      b.ringT -= dt;
      if (b.ringT <= 0 && canFire()) {
        b.ringT = (b.phase >= 2 ? 1.15 : 1.7) * cd;
        const n = b.phase >= 3 ? 18 : 14, off = rand(0, TAU);
        for (let k = 0; k < n; k++) ebullet(b.x, b.y, off + k * TAU / n, spd * 0.8, 'ring');
      }
      if (b.phase >= 2) {
        b.beamT -= dt;
        if (b.beamT <= 0) {
          b.beamT = 6.5;
          spawnSweep(b, { angle: rand(0, TAU), rot: 0.85, width: 10, warn: 0.9, active: 1.1 });
        }
      }
    } else {
      // Leviathan
      for (const p of b.parts) {
        if (!p.alive) continue;
        p.fireT -= dt;
        if (p.type === 'hangar') {
          if (p.fireT <= 0) {
            p.fireT = 5.2;
            const pos = bossPartPos(p);
            if (enemies.length < 22) {
              spawnEnemy('drone', pos.x, pos.y, { minion: true });
              if (b.phase >= 3) spawnEnemy('drone', pos.x + rand(-18, 18), pos.y, { minion: true });
            }
          }
        } else if (p.type === 'pod' && p.fireT <= 0 && canFire()) {
          p.fireT = 2.4 * cd;
          const pos = bossPartPos(p);
          const a = angleTo(pos.x, pos.y, player.x, player.y);
          for (let k = -1; k <= 1; k++) ebullet(pos.x, pos.y, a + k * 0.24, spd * 1.0, 'heavy');
        }
      }
      b.ringT -= dt;
      if (b.ringT <= 0 && canFire()) {
        b.ringT = (b.phase >= 2 ? 1.25 : 1.8) * cd;
        const n = b.phase >= 3 ? 16 : 12, off = rand(0, TAU);
        for (let k = 0; k < n; k++) ebullet(b.x, b.y + 16, off + k * TAU / n, spd * 0.72, 'ring');
      }
      b.beamT -= dt;
      if (b.beamT <= 0 && b.phase >= 2) {
        b.beamT = 7.0;
        spawnSweep(b, { angle: Math.PI / 2, rot: 0.42, width: 13, warn: 0.95, active: 1.35 });
      }
    }
  }

  function updateBoss(dt) {
    const b = boss;
    b.t += dt;
    b.hitFlash = Math.max(0, b.hitFlash - dt);
    b.invulnT = Math.max(0, b.invulnT - dt);
    updateBossParts(dt);

    if (b.state === 'enter') {
      const targetY = b.type.id === 'leviathan' ? 140 : b.type.id === 'hive' ? 150 : 130;
      b.y = lerp(b.y, targetY, Math.min(1, dt * 1.8));
      if (b.y > targetY - 5) b.state = 'fight';
      return;
    }

    if (b.state === 'dying') {
      b.dieT -= dt;
      b.y += 20 * dt;
      if (Math.random() < dt * 16) boom(b.x + rand(-80, 80), b.y + rand(-35, 35), rand(10, 24));
      if (b.dieT <= 0) finalizeBoss();
      return;
    }

    const phase = bossPhase();
    if (phase !== b.phase) enterBossPhase(phase);

    const mv = Math.min(1.25, 1 + (sector - 1) * 0.025 + (b.phase - 1) * 0.12);
    if (b.type.id === 'hive') {
      b.x = W / 2 + Math.sin(b.t * 0.55) * 92;
      b.y = 150 + Math.sin(b.t * 0.9) * 22;
    } else if (b.type.id === 'leviathan') {
      b.x = W / 2 + Math.sin(b.t * 0.42) * 82;
      b.y = 140 + Math.sin(b.t * 0.8) * 6;
    } else {
      b.x = W / 2 + Math.sin(b.t * 0.7 * mv) * 104;
      b.y = 130 + Math.sin(b.t * 1.3) * 8;
    }

    updateBossBehavior(dt);
    bossTouchPlayer();
  }

  // -------------------------------------------------------------------------
  // Player weapons and movement
  // -------------------------------------------------------------------------
  function fireSpread() {
    const lvl = playerLvl();
    const data = WEAPONS.spread.levels[lvl - 1];
    const n = data.shots;
    const fan = data.fan * Math.PI / 180;
    if (pBullets.length + n > CONFIG.limits.maxPBullets) return;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (n === 1 ? 0 : (i / (n - 1) - 0.5) * fan);
      pBullets.push({
        kind: 'sp', x: player.x, y: player.y - 14,
        vx: Math.cos(a) * 560, vy: Math.sin(a) * 560,
        r: 4, dmg: data.dmg
      });
    }
    player.muzzle = 0.06;
    Audio.shoot('spread');
  }

  function fireMissile() {
    if (player.mslLvl <= 0) return;
    if (pBullets.length >= CONFIG.limits.maxPBullets) return;
    const dmg = CONFIG.missile.levels[player.mslLvl - 1].dmg;
    const a = -Math.PI / 2 + player.mslSide * 0.45;
    pBullets.push({
      kind: 'ms', x: player.x + player.mslSide * 14, y: player.y + 6,
      vx: Math.cos(a) * CONFIG.missile.speed,
      vy: Math.sin(a) * CONFIG.missile.speed,
      r: 5, dmg
    });
    player.mslSide *= -1;
    Audio.missileShot();
  }

  function beamOffsets() {
    const data = playerLevelData();
    const offsets = [];
    for (let i = 0; i < data.beams; i++) {
      offsets.push((i - (data.beams - 1) / 2) * (data.width + 6));
    }
    return { data, offsets };
  }

  function fireBeamTick() {
    const { data, offsets } = beamOffsets();
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.y > player.y) continue;
      for (const off of offsets) {
        if (Math.abs(e.x - (player.x + off)) < e.r + data.width * 0.5) {
          damageEnemy(i, data.dmg, e.x, e.y);
          break;
        }
      }
    }
    if (boss && boss.state === 'fight') {
      for (const p of boss.parts) {
        if (!p.alive) continue;
        const pos = bossPartPos(p);
        if (pos.y > player.y) continue;
        for (const off of offsets) {
          if (Math.abs(pos.x - (player.x + off)) < p.r + data.width * 0.5) {
            damageBossPart(p, data.dmg, pos.x, pos.y);
            break;
          }
        }
      }
      const coreY = boss.y + boss.type.core.dy;
      if (coreY < player.y) {
        for (const off of offsets) {
          if (Math.abs(boss.x - (player.x + off)) < boss.type.core.rx + data.width * 0.5) {
            damageBoss(data.dmg, boss.x, coreY);
            break;
          }
        }
      }
    }
  }

  function updatePlayer(dt) {
    const p = player;
    if (p.dead) {
      p.deadT -= dt;
      if (p.deadT <= 0) respawn();
      return;
    }

    p.invuln = Math.max(0, p.invuln - dt);
    p.bombCd = Math.max(0, p.bombCd - dt);
    p.muzzle = Math.max(0, p.muzzle - dt);

    const focus = keys.has('ShiftLeft') || keys.has('ShiftRight') || Input.focusTouch;
    const speed = p.speed * (focus ? CONFIG.player.focusScale : 1);
    let targetTilt = 0;

    if (Input.stick) {
      const s = Input.stick;
      p.x = clamp(p.x + s.vx * speed * dt, CONFIG.playfield.left, W - CONFIG.playfield.right);
      p.y = clamp(p.y + s.vy * speed * dt, CONFIG.playfield.top, H - CONFIG.playfield.bottom);
      targetTilt = clamp(s.vx, -1, 1) * 0.3;
    } else if (!Input.drag) {
      const hx = (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0) - (keys.has('ArrowLeft') || keys.has('KeyA') ? 1 : 0);
      const hy = (keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0) - (keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0);
      let mx = hx, my = hy;
      if (mx && my) { mx *= Math.SQRT1_2; my *= Math.SQRT1_2; }
      p.x = clamp(p.x + mx * speed * dt, CONFIG.playfield.left, W - CONFIG.playfield.right);
      p.y = clamp(p.y + my * speed * dt, CONFIG.playfield.top, H - CONFIG.playfield.bottom);
      targetTilt = hx * 0.28;
    } else {
      p.x = clamp(p.x, CONFIG.playfield.left, W - CONFIG.playfield.right);
      p.y = clamp(p.y, CONFIG.playfield.top, H - CONFIG.playfield.bottom);
    }
    p.tilt += (targetTilt - p.tilt) * Math.min(1, dt * 10);

    if (p.mslLvl > 0) {
      p.mslCd -= dt;
      if (p.mslCd <= 0) {
        p.mslCd = CONFIG.missile.interval[p.mslLvl - 1];
        fireMissile();
      }
    }

    const wantsFire = fireHeld();
    if (p.weapon === 'spread') {
      if (wantsFire) {
        p.fireT -= dt;
        if (p.fireT <= 0) {
          p.fireT = WEAPONS.spread.fireInterval;
          fireSpread();
        }
      } else {
        p.fireT = 0;
      }
      Audio.beamOff();
    } else {
      if (wantsFire) {
        p.beamTick -= dt;
        if (p.beamTick <= 0) {
          p.beamTick += WEAPONS.laser.beamTick;
          fireBeamTick();
        }
        Audio.beamOn();
      } else {
        Audio.beamOff();
      }
    }

    if (Math.random() < dt * 34 && parts.length < CONFIG.limits.maxParticles) {
      parts.push({
        x: p.x + rand(-3, 3), y: p.y + 16,
        vx: rand(-12, 12), vy: rand(70, 120),
        t: 0, dur: 0.3, size: rand(1, 2.2), col: '#6fb0ff'
      });
    }
  }

  // -------------------------------------------------------------------------
  // Bullet movement and collision
  // -------------------------------------------------------------------------
  function movePBullets(dt) {
    for (let i = pBullets.length - 1; i >= 0; i--) {
      const b = pBullets[i];
      if (b.kind === 'ms') {
        let target = null, best = 1e12;
        for (const e of enemies) {
          const d2 = dist2(b.x, b.y, e.x, e.y);
          if (d2 < best) { best = d2; target = e; }
        }
        if (boss && boss.state === 'fight') {
          const d2 = dist2(b.x, b.y, boss.x, boss.y);
          if (d2 < best) { best = d2; target = { x: boss.x, y: boss.y }; }
        }
        const sp = hypot(b.vx, b.vy);
        const ca = Math.atan2(b.vy, b.vx);
        let na = ca;
        if (target) {
          const ta = angleTo(b.x, b.y, target.x, target.y);
          let d = ta - ca;
          while (d > Math.PI) d -= TAU;
          while (d < -Math.PI) d += TAU;
          na = ca + clamp(d, -CONFIG.missile.turn * dt, CONFIG.missile.turn * dt);
        }
        b.vx = Math.cos(na) * sp;
        b.vy = Math.sin(na) * sp;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (Math.random() < dt * 36 && parts.length < CONFIG.limits.maxParticles) {
          parts.push({
            x: b.x, y: b.y + 3, vx: rand(-15, 15), vy: rand(30, 70),
            t: 0, dur: 0.22, size: rand(1, 2), col: '#ffb36a'
          });
        }
      } else {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
      if (b.y < -60 || b.y > H + 80 || b.x < -30 || b.x > W + 30) pBullets.splice(i, 1);
    }
  }

  function collidePB() {
    for (let i = pBullets.length - 1; i >= 0; i--) {
      const b = pBullets[i];
      let consumed = false;

      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (dist2(b.x, b.y, e.x, e.y) < (e.r + b.r) * (e.r + b.r)) {
          damageEnemy(j, b.dmg, b.x, b.y);
          consumed = true;
          break;
        }
      }

      if (!consumed && boss && boss.state === 'fight') {
        for (const p of boss.parts) {
          if (!p.alive) continue;
          const pos = bossPartPos(p);
          if (dist2(b.x, b.y, pos.x, pos.y) < (p.r + b.r) * (p.r + b.r)) {
            damageBossPart(p, b.dmg, b.x, b.y);
            consumed = true;
            break;
          }
        }
        if (!consumed) {
          const coreY = boss.y + boss.type.core.dy;
          const dx = (b.x - boss.x) / boss.type.core.rx;
          const dy = (b.y - coreY) / boss.type.core.ry;
          if (dx * dx + dy * dy <= 1) {
            damageBoss(b.dmg, b.x, b.y);
            consumed = true;
          }
        }
      }

      if (consumed) pBullets.splice(i, 1);
    }
  }

  function collideEB() {
    if (player.dead || player.invuln > 0) return;
    const grazeR2 = CONFIG.player.grazeRadius * CONFIG.player.grazeRadius;
    for (let i = eBullets.length - 1; i >= 0; i--) {
      const b = eBullets[i];
      const d2 = dist2(b.x, b.y, player.x, player.y);
      const hitR = b.r + player.hitR;
      if (d2 < hitR * hitR) {
        eBullets.splice(i, 1);
        hitPlayer();
        break;
      }
      if (!b.grazed && d2 < grazeR2) {
        b.grazed = true;
        player.graze++;
        score += CONFIG.graze.score;
        if (Math.random() < CONFIG.graze.sparkChance) {
          spark(player.x, player.y, '#9fe8ff', 2, 70);
        }
        Audio.graze();
      }
    }
  }

  // -------------------------------------------------------------------------
  // Enemy behavior
  // -------------------------------------------------------------------------
  function fireEnemy(e) {
    const d = difficulty();
    const a = angleTo(e.x, e.y, player.x, player.y);
    const spd = d.bulletSpeed;
    if (e.type === 'fighter') {
      if (e.elite) {
        for (let k = -1; k <= 1; k++) ebullet(e.x, e.y + 10, a + k * 0.22, spd, 'aim');
      } else {
        ebullet(e.x, e.y + 10, a, spd, 'aim');
      }
    } else if (e.type === 'gunship') {
      if (e.elite) {
        e.alt = !e.alt;
        if (e.alt) {
          for (let k = -2; k <= 2; k++) ebullet(e.x, e.y + 12, a + k * 0.28, spd * 0.9, 'aim');
        } else {
          const off = rand(0, TAU);
          for (let k = 0; k < 10; k++) ebullet(e.x, e.y, off + k * TAU / 10, spd * 0.62, 'ring');
        }
      } else {
        for (let k = -1; k <= 1; k++) ebullet(e.x, e.y + 12, a + k * 0.30, spd * 0.9, 'aim');
      }
    } else if (e.type === 'carrier') {
      const n = e.elite ? 12 : 10, off = rand(0, TAU);
      for (let k = 0; k < n; k++) ebullet(e.x, e.y, off + k * TAU / n, spd * 0.58, 'ring');
    } else if (e.type === 'sentinel') {
      if (e.elite) {
        const off = rand(0, TAU);
        for (let k = 0; k < 10; k++) ebullet(e.x, e.y, off + k * TAU / 10, spd * 0.65, 'ring');
      } else {
        for (let k = -1; k <= 1; k++) ebullet(e.x, e.y + 8, a + k * 0.26, spd * 0.95, 'heavy');
      }
    }
  }

  function updateEnemies(dt) {
    const d = difficulty();
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.t += dt;
      e.flash = Math.max(0, e.flash - dt);

      if (e.type === 'sentinel') {
        if (e.mode === 'enter') {
          e.y += e.vy * dt;
          e.x = e.bx + Math.sin(e.t * 1.2) * 8;
          if (e.y >= e.targetY) { e.y = e.targetY; e.mode = 'hold'; }
        } else if (e.mode === 'hold') {
          e.holdT -= dt;
          e.x = e.bx + Math.sin(e.t * 0.9) * 26;
          if (e.holdT <= 0) e.mode = 'leave';
        } else {
          e.y += 95 * dt;
          e.x += Math.sin(e.t * 1.4) * 22 * dt;
        }
      } else if (e.type === 'diver' || e.type === 'drone') {
        if (e.elite && !player.dead) {
          const sp = hypot(e.vx, e.vy);
          const ca = Math.atan2(e.vy, e.vx);
          const ta = angleTo(e.x, e.y, player.x, player.y);
          let delta = ta - ca;
          while (delta > Math.PI) delta -= TAU;
          while (delta < -Math.PI) delta += TAU;
          const na = ca + clamp(delta, -1.7 * dt, 1.7 * dt);
          e.vx = Math.cos(na) * sp;
          e.vy = Math.sin(na) * sp;
        }
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      } else {
        e.y += e.vy * dt;
        e.x = e.bx + Math.sin(e.t * e.freq) * e.amp;
      }

      if (e.hp <= 0) { killEnemy(i, true); continue; }

      if (!player.dead && player.invuln <= 0 &&
          dist2(e.x, e.y, player.x, player.y) < (e.r + player.r) * (e.r + player.r)) {
        hitPlayer();
        killEnemy(i, false);
        continue;
      }

      const off = e.type === 'diver' || e.type === 'drone'
        ? (e.x < -60 || e.x > W + 60 || e.y > H + 60)
        : (e.y > H + 70);
      if (off) { enemies.splice(i, 1); continue; }

      const canFire = e.type !== 'diver' && e.type !== 'drone' &&
        (e.type !== 'sentinel' || e.mode === 'hold') &&
        e.y > 30 && e.y < H - 100 && !player.dead;
      if (canFire) {
        e.fireT -= dt * d.fire;
        if (e.fireT <= 0) {
          e.fireT = rand(e.def.fire[0], e.def.fire[1]) * (e.elite ? 0.72 : 1);
          fireEnemy(e);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Drops
  // -------------------------------------------------------------------------
  function updateDrops(dt) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.t += dt;
      d.y += 68 * dt;
      d.x += Math.sin(d.t * 2.2) * 26 * dt + d.vx * dt;
      d.vx *= Math.exp(-1.8 * dt);
      if (d.x < 16) d.x = 16;
      else if (d.x > W - 16) d.x = W - 16;

      if (!player.dead) {
        const dd = dist2(d.x, d.y, player.x, player.y);
        if (dd < 90 * 90) {
          const k = Math.min(1, dt * 6);
          d.x += (player.x - d.x) * k;
          d.y += (player.y - d.y) * k;
        }
        if (dd < 28 * 28) {
          applyDrop(d.type);
          drops.splice(i, 1);
          continue;
        }
      }
      if (d.y > H + 30) drops.splice(i, 1);
    }
  }

  // -------------------------------------------------------------------------
  // Boss hazards
  // -------------------------------------------------------------------------
  function hazardDist(h, px, py) {
    const dx = Math.cos(h.angle), dy = Math.sin(h.angle);
    const t = clamp((px - h.x) * dx + (py - h.y) * dy, 0, h.len);
    return hypot(px - (h.x + dx * t), py - (h.y + dy * t));
  }

  function updateHazards(dt) {
    for (let i = hazards.length - 1; i >= 0; i--) {
      const h = hazards[i];
      h.t += dt;
      if (h.warn > 0) {
        h.warn -= dt;
      } else {
        h.active -= dt;
        h.angle += h.rot * dt;
        if (!player.dead && player.invuln <= 0 &&
            hazardDist(h, player.x, player.y) < h.width * 0.5 + player.hitR) {
          hitPlayer();
        }
        if (h.active <= 0) hazards.splice(i, 1);
      }
    }
  }

  // -------------------------------------------------------------------------
  // FX and background
  // -------------------------------------------------------------------------
  function updateFx(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const q = parts[i];
      q.t += dt;
      if (q.t >= q.dur) { parts.splice(i, 1); continue; }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      const dr = Math.exp(-2.2 * dt);
      q.vx *= dr;
      q.vy *= dr;
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].t += dt;
      if (rings[i].t >= rings[i].dur) rings.splice(i, 1);
    }
    for (let i = pops.length - 1; i >= 0; i--) {
      const o = pops[i];
      o.t += dt;
      o.y -= 46 * dt;
      if (o.t >= o.dur) pops.splice(i, 1);
    }
  }

  function updateBG(dt) {
    const boost = state === 'play' && boss ? 1.25 : 1;
    for (const s of stars) {
      s.y += s.v * dt * boost;
      if (s.y > H + 2) { s.y = -2; s.x = rand(0, W); }
    }
    for (const n of nebs) {
      n.y += n.v * dt * boost;
      if (n.y - n.r > H) { n.y = -n.r; n.x = rand(0, W); }
    }
    for (const d of debris) {
      d.y += d.v * dt * boost;
      d.rot += d.vr * dt;
      if (d.y - d.r > H) {
        d.y = -d.r;
        d.x = rand(0, W);
        d.r = rand(3, 11);
        d.rot = rand(0, TAU);
      }
    }
    if (planet) {
      planet.y += planet.v * dt;
      if (planet.y - planet.r > H + 200) planet.y = -planet.r - 100;
    }
  }

  // -------------------------------------------------------------------------
  // Game update
  // -------------------------------------------------------------------------
  function updateWaves(dt) {
    sectorT += dt;
    const d = difficulty();
    const bossAt = Math.min(CONFIG.sector.bossMax, CONFIG.sector.firstBoss + CONFIG.sector.bossStep * (sector - 1));

    for (let i = pendings.length - 1; i >= 0; i--) {
      const q = pendings[i];
      q.t -= dt;
      if (q.t <= 0) {
        if (typeof q.fn === 'function') q.fn();
        pendings.splice(i, 1);
      }
    }

    if (warnT > 0) {
      warnT = Math.max(0, warnT - dt);
      if (warnT <= 0) makeBoss();
      return;
    }

    if (!boss && sectorT >= bossAt) {
      warnT = 2.3;
      Audio.alarm();
      Audio.setMusicMode('boss');
      return;
    }

    if (!boss) {
      graceT = Math.max(0, graceT - dt);
      if (graceT <= 0) {
        spawnT -= dt;
        if (spawnT <= 0) {
          spawnT = d.spawn;
          doWave();
        }
        carrierT -= dt;
        if (carrierT <= 0) spawnCarrier();
      }
    }
  }

  function updGame(dt) {
    gameTime += dt;
    coreChainT = Math.max(0, coreChainT - dt);
    if (coreChainT <= 0) coreChain = 0;

    updateWaves(dt);
    updatePlayer(dt);
    movePBullets(dt);
    updateEnemies(dt);
    if (boss) updateBoss(dt);
    moveEBullets(dt);
    collidePB();
    collideEB();
    updateHazards(dt);
    updateDrops(dt);
    updateFx(dt);
  }

  function moveEBullets(dt) {
    for (let i = eBullets.length - 1; i >= 0; i--) {
      const b = eBullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) eBullets.splice(i, 1);
    }
  }

  function update(dt) {
    animT += dt;
    shake *= Math.exp(-5 * dt);
    if (shake < 0.05) shake = 0;
    flashW = Math.max(0, flashW - dt * 1.8);
    flashR = Math.max(0, flashR - dt * 1.4);
    displayScore += (score - displayScore) * Math.min(1, dt * 10);
    if (banner) {
      banner.t += dt;
      if (banner.t >= banner.dur) banner = null;
    }
    if (bossBannerT > 0) bossBannerT = Math.max(0, bossBannerT - dt);

    updateBG(dt);
    if (state === 'play' && !paused) updGame(dt);
    else if (state === 'over') updateFx(dt);
  }

  // -------------------------------------------------------------------------
  // World rendering
  // -------------------------------------------------------------------------
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function hexHue(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) return 0;
    let h;
    if (max === r) h = (g - b) / (max - min);
    else if (max === g) h = 2 + (b - r) / (max - min);
    else h = 4 + (r - g) / (max - min);
    h *= 60;
    return h < 0 ? h + 360 : h;
  }

  function drawBG() {
    ctx.fillStyle = bgGrad || '#04060f';
    ctx.fillRect(0, 0, W, H);

    if (planet) {
      const spr = glowSprite(planet.hue, planet.r, 0.20);
      ctx.drawImage(spr, planet.x - planet.r, planet.y - planet.r, planet.r * 2, planet.r * 2);
      ctx.fillStyle = 'rgba(8,12,26,.42)';
      ctx.beginPath();
      ctx.arc(planet.x, planet.y, planet.r * 0.54, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'hsla(' + planet.hue + ',75%,62%,.16)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for (const n of nebs) {
      ctx.globalAlpha = 0.9;
      ctx.drawImage(n.sprite, n.x - n.r, n.y - n.r, n.r * 2, n.r * 2);
    }
    ctx.globalAlpha = 1;

    for (const s of stars) {
      ctx.globalAlpha = s.a * (0.7 + 0.3 * Math.sin(animT * 3 + s.x));
      ctx.fillStyle = s.c;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    for (const d of debris) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.rot);
      ctx.beginPath();
      for (let i = 0; i < d.sides; i++) {
        const a = i / d.sides * TAU;
        const rr2 = d.r * (0.72 + 0.28 * Math.sin(i * 7.3));
        const px = Math.cos(a) * rr2, py = Math.sin(a) * rr2;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = d.c;
      ctx.globalAlpha = 0.26;
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = 'rgba(210,230,255,.25)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer() {
    const p = player;
    if (p.dead) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.invuln > 0) ctx.globalAlpha = Math.floor(p.invuln * 14) % 2 === 0 ? 0.35 : 1;
    ctx.rotate(p.tilt);

    const fl = 7 + Math.sin(animT * 40) * 2 + Math.random() * 2;
    ctx.fillStyle = 'rgba(255,150,60,.85)';
    ctx.beginPath(); ctx.moveTo(-6, 12); ctx.lineTo(-3.5, 12 + fl); ctx.lineTo(-1, 12); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(1, 12); ctx.lineTo(3.5, 12 + fl); ctx.lineTo(6, 12); ctx.closePath(); ctx.fill();

    const g = linGrad('player-body', 0, -22, 0, 17, [[0, '#eaf6ff'], [1, '#3d78c8']]);
    ctx.fillStyle = g;
    ctx.strokeStyle = 'rgba(210,235,255,.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -21); ctx.lineTo(5, -9); ctx.lineTo(20, 7); ctx.lineTo(15, 15); ctx.lineTo(5, 11);
    ctx.lineTo(0, 16); ctx.lineTo(-5, 11); ctx.lineTo(-15, 15); ctx.lineTo(-20, 7); ctx.lineTo(-5, -9);
    ctx.closePath(); ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#0d2244';
    ctx.fillRect(-2, -2, 4, 10);
    ctx.fillStyle = '#8fe3ff';
    ctx.beginPath(); ctx.ellipse(0, -7, 2.8, 6, 0, 0, TAU); ctx.fill();

    const focus = keys.has('ShiftLeft') || keys.has('ShiftRight') || Input.focusTouch;
    if (settings.hitbox && focus) {
      const pu = 0.5 + 0.5 * Math.sin(animT * 8);
      ctx.strokeStyle = 'rgba(160,240,255,' + (0.65 + pu * 0.25) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 10 + pu * 2, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(90,210,255,.55)';
      ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, TAU); ctx.fill();
    }

    if (p.shield) {
      const pu = 0.5 + 0.5 * Math.sin(animT * 6);
      ctx.strokeStyle = 'rgba(110,235,170,' + (0.5 + 0.35 * pu) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 26 + pu * 2, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(110,235,170,' + (0.13 + 0.09 * pu) + ')';
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(0, 0, 26 + pu * 2, 0, TAU); ctx.stroke();
    }

    if (p.muzzle > 0) {
      const a = p.muzzle / 0.06;
      ctx.globalAlpha *= a;
      ctx.fillStyle = WEAPONS[p.weapon].color;
      ctx.beginPath();
      ctx.moveTo(0, -28); ctx.lineTo(4, -20); ctx.lineTo(0, -22); ctx.lineTo(-4, -20);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.elite) {
      ctx.scale(1.1, 1.1);
      const pu = 0.5 + 0.5 * Math.sin(animT * 7);
      ctx.strokeStyle = 'rgba(255,210,90,' + (0.4 + 0.45 * pu) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, e.r + 5 + pu * 1.5, 0, TAU); ctx.stroke();
    }

    if (e.type === 'fighter') {
      const g = linGrad('enemy-fighter', 0, -12, 0, 14, [[0, '#ff77b1'], [1, '#7a1f4d']]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(0, 14); ctx.lineTo(9, -8); ctx.lineTo(4, -12); ctx.lineTo(0, -8);
      ctx.lineTo(-4, -12); ctx.lineTo(-9, -8); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,170,80,' + (0.4 + 0.4 * Math.sin(animT * 20 + e.t * 7)) + ')';
      ctx.beginPath(); ctx.arc(0, -11, 2.5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffe08a';
      ctx.fillRect(-1.5, -2, 3, 7);
    } else if (e.type === 'gunship') {
      const g = linGrad('enemy-gunship', 0, -12, 0, 16, [[0, '#4e7a52'], [1, '#20342a']]);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(20, 10); ctx.lineTo(10, 16); ctx.lineTo(-10, 16); ctx.lineTo(-20, 10);
      ctx.lineTo(-16, -12); ctx.lineTo(16, -12); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(159,216,176,.35)';
      ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#9fd8ff';
      ctx.beginPath(); ctx.arc(0, -2, 6, 0, TAU); ctx.fill();
      ctx.fillStyle = '#16241a';
      ctx.fillRect(-10, 12, 4, 7); ctx.fillRect(6, 12, 4, 7);
    } else if (e.type === 'diver' || e.type === 'drone') {
      ctx.rotate(Math.atan2(e.vy, e.vx) - Math.PI / 2);
      if (e.type === 'drone') {
        ctx.fillStyle = '#d9a0ff';
        ctx.beginPath();
        ctx.moveTo(0, 11); ctx.lineTo(7, 0); ctx.lineTo(0, -8); ctx.lineTo(-7, 0);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.8)';
        ctx.beginPath(); ctx.arc(0, 2, 2, 0, TAU); ctx.fill();
      } else {
        const g = linGrad('enemy-diver', 0, -12, 0, 13, [[0, '#ffb066'], [1, '#8a3c12']]);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 13); ctx.lineTo(7, -6); ctx.lineTo(3, -12); ctx.lineTo(0, -9);
        ctx.lineTo(-3, -12); ctx.lineTo(-6, -5); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,190,110,' + (0.5 + 0.4 * Math.sin(animT * 30 + e.t * 9)) + ')';
        ctx.beginPath(); ctx.arc(0, -14, 3, 0, TAU); ctx.fill();
      }
    } else if (e.type === 'sentinel') {
      const g = linGrad('enemy-sentinel', 0, -18, 0, 18, [[0, '#64c9bd'], [1, '#173d3b']]);
      ctx.fillStyle = g;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU + Math.PI / 6;
        const px = Math.cos(a) * 17, py = Math.sin(a) * 17;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(160,255,235,.4)';
      ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#0d2a2b';
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = e.elite ? '#ffd23e' : '#8affea';
      ctx.beginPath(); ctx.arc(0, 0, 4.5 + Math.sin(animT * 8) * 1.2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#9ff';
      ctx.fillRect(-2, 14, 4, 8);
    } else {
      const g = linGrad('enemy-carrier', 0, -32, 0, 32, [[0, '#8a6d3b'], [1, '#4a3a1e']]);
      rr(-26, -32, 52, 64, 8);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = '#c9a86a'; ctx.lineWidth = 1; ctx.stroke();
      const cols = ['#cdd3da', '#b8863b', '#7a8a99'];
      for (let r2 = 0; r2 < 3; r2++) {
        ctx.fillStyle = cols[r2];
        ctx.fillRect(-19, -26 + r2 * 17, 17, 13);
        ctx.fillRect(2, -26 + r2 * 17, 17, 13);
      }
      ctx.fillStyle = 'rgba(255,90,90,' + (blinkOn(3) ? 0.9 : 0.2) + ')';
      ctx.beginPath(); ctx.arc(0, 27, 2.5, 0, TAU); ctx.fill();
    }

    if (e.flash > 0) {
      ctx.globalAlpha = Math.min(0.65, e.flash * 10);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawBoss() {
    const b = boss;
    const type = b.type;
    const col = type.palette.glow;
    const hue = hexHue(col);
    ctx.save();
    ctx.translate(b.x, b.y);

    const glow = glowSprite(hue, 160, 0.16);
    ctx.drawImage(glow, -160, -160, 320, 320);

    if (type.id === 'destroyer') {
      const hull = [[0, 50], [34, 40], [74, 18], [86, -6], [60, -34], [0, -44], [-60, -34], [-86, -6], [-74, 18], [-34, 40]];
      const hg = linGrad('boss-destroyer-hull', 0, -44, 0, 50, [[0, type.palette.hull[0]], [1, type.palette.hull[1]]]);
      ctx.beginPath();
      ctx.moveTo(hull[0][0], hull[0][1]);
      for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i][0], hull[i][1]);
      ctx.closePath();
      ctx.fillStyle = hg; ctx.fill();
      ctx.strokeStyle = '#0a0e1a'; ctx.lineWidth = 2; ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, 34); ctx.lineTo(24, 26); ctx.lineTo(50, 8); ctx.lineTo(58, -8); ctx.lineTo(38, -26);
      ctx.lineTo(0, -32); ctx.lineTo(-38, -26); ctx.lineTo(-58, -8); ctx.lineTo(-50, 8); ctx.lineTo(-24, 26);
      ctx.closePath();
      ctx.fillStyle = type.palette.inner; ctx.fill();

      ctx.fillStyle = '#11161f';
      ctx.fillRect(-34, 26, 12, 9); ctx.fillRect(22, 26, 12, 9); ctx.fillRect(-5, 38, 10, 7);
      for (const px of [-58, 58]) {
        ctx.fillStyle = '#232c47';
        ctx.beginPath(); ctx.arc(px, 6, 14, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#0a0e1a'; ctx.lineWidth = 2; ctx.stroke();
      }
    } else if (type.id === 'hive') {
      const hg = linGrad('boss-hive-hull', 0, -58, 0, 58, [[0, type.palette.hull[0]], [1, type.palette.hull[1]]]);
      ctx.fillStyle = hg;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU + Math.PI / 8;
        const px = Math.cos(a) * 56, py = Math.sin(a) * 56;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(180,140,255,.35)';
      ctx.lineWidth = 2; ctx.stroke();
      ctx.strokeStyle = 'rgba(180,140,255,.18)';
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(0, 0, 62 + Math.sin(animT * 2) * 4, 0, TAU); ctx.stroke();
      ctx.fillStyle = type.palette.inner;
      ctx.beginPath(); ctx.arc(0, 0, 34, 0, TAU); ctx.fill();
    } else {
      const hg = linGrad('boss-leviathan-hull', 0, -38, 0, 44, [[0, type.palette.hull[0]], [1, type.palette.hull[1]]]);
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.moveTo(-116, -8); ctx.lineTo(-96, -30); ctx.lineTo(-40, -36); ctx.lineTo(40, -36);
      ctx.lineTo(96, -30); ctx.lineTo(116, -8); ctx.lineTo(105, 22); ctx.lineTo(60, 38);
      ctx.lineTo(20, 34); ctx.lineTo(-20, 34); ctx.lineTo(-60, 38); ctx.lineTo(-105, 22);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#0d0a07'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = type.palette.inner;
      ctx.fillRect(-70, -10, 140, 22);
      ctx.strokeStyle = 'rgba(255,190,110,.22)';
      ctx.lineWidth = 1;
      for (let i = -56; i <= 56; i += 14) {
        ctx.beginPath(); ctx.moveTo(i, -8); ctx.lineTo(i, 10); ctx.stroke();
      }
    }

    for (const p of b.parts) {
      const px = p.dx, py = p.dy;
      ctx.save();
      ctx.translate(px, py);
      if (!p.alive) {
        ctx.fillStyle = 'rgba(20,18,20,.8)';
        ctx.beginPath(); ctx.arc(0, 0, p.r * 0.8, 0, TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,120,80,.25)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        continue;
      }
      if (p.type === 'cannon') {
        ctx.fillStyle = '#232c47';
        ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#0a0e1a'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#11161f';
        ctx.fillRect(-4, 0, 8, p.r + 9);
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, TAU); ctx.fill();
      } else if (p.type === 'orb') {
        const og = glowSprite(hue, 32, 0.4);
        ctx.drawImage(og, -32, -32, 64, 64);
        ctx.fillStyle = '#1a1430';
        ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
      } else if (p.type === 'hangar') {
        rr(-p.r, -p.r * 0.72, p.r * 2, p.r * 1.44, 5);
        ctx.fillStyle = '#2a2017'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,190,110,.5)'; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = 'rgba(255,170,80,.35)';
        ctx.fillRect(-p.r + 4, -4, p.r * 2 - 8, 8);
      } else {
        ctx.fillStyle = '#2a2017';
        ctx.fillRect(-p.r * 0.7, -p.r, p.r * 1.4, p.r * 2);
        ctx.strokeStyle = 'rgba(255,190,110,.45)';
        ctx.lineWidth = 1; ctx.strokeRect(-p.r * 0.7, -p.r, p.r * 1.4, p.r * 2);
        ctx.fillStyle = col;
        ctx.fillRect(-3, -p.r + 3, 6, 5);
      }
      if (p.flash > 0) {
        ctx.globalAlpha = Math.min(0.7, p.flash * 10);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(0, 0, p.r, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    const cr = 10 + Math.sin(animT * 6) * 2 + (b.coreExposed ? 3 : 0);
    ctx.save();
    ctx.shadowColor = col;
    ctx.shadowBlur = 18;
    ctx.fillStyle = b.invulnT > 0 && blinkOn(14) ? '#fff' : col;
    ctx.beginPath(); ctx.arc(0, type.core.dy, cr, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, type.core.dy, cr + 4, 0, TAU); ctx.stroke();

    if (b.hitFlash > 0) {
      ctx.globalAlpha = Math.min(0.5, b.hitFlash * 8);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(0, type.core.dy, Math.max(type.core.rx, type.core.ry), 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawPBullets() {
    for (const b of pBullets) {
      if (b.kind === 'sp') {
        ctx.fillStyle = 'rgba(255,160,60,.35)';
        ctx.beginPath(); ctx.arc(b.x, b.y, 7, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffd23e';
        ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(b.x, b.y, 1.5, 0, TAU); ctx.fill();
      } else {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.vy, b.vx) + Math.PI / 2);
        ctx.fillStyle = '#d8cfff';
        ctx.beginPath(); ctx.ellipse(0, -1, 2.6, 6, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(0, -4, 1.2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ff8a3c';
        ctx.beginPath();
        ctx.moveTo(-1.8, 4); ctx.lineTo(0, 9 + Math.random() * 4); ctx.lineTo(1.8, 4);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    if (player.weapon === 'laser' && !player.dead && state === 'play' && fireHeld()) {
      const { data, offsets } = beamOffsets();
      const y1 = player.y - 16;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const off of offsets) {
        const x = player.x + off;
        const w = data.width;
        const g = ctx.createLinearGradient(0, y1, 0, 0);
        g.addColorStop(0, 'rgba(150,240,255,.85)');
        g.addColorStop(0.45, 'rgba(70,200,255,.55)');
        g.addColorStop(1, 'rgba(120,220,255,.08)');
        ctx.fillStyle = g;
        ctx.fillRect(x - w * 0.85, 0, w * 1.7, y1);
        ctx.fillStyle = 'rgba(225,252,255,.9)';
        ctx.fillRect(x - w * 0.22, 0, w * 0.44, y1);
        ctx.fillStyle = 'rgba(255,255,255,.5)';
        const seg = 26;
        for (let y = (animT * 900) % seg; y < y1; y += seg) {
          ctx.fillRect(x - w * 0.32, y, w * 0.64, 8);
        }
      }
      ctx.restore();
      const gg = glowSprite(hexHue(WEAPONS.laser.color), 40, 0.5);
      ctx.drawImage(gg, player.x - 40, player.y - 56, 80, 80);
    }
  }

  function drawEBullets() {
    for (const b of eBullets) {
      const st = BULLET_STYLES[b.kind] || BULLET_STYLES.aim;
      if (st.shape === 'diamond') {
        const r = b.r;
        ctx.fillStyle = st.outline;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y - r - 1.5); ctx.lineTo(b.x + r + 1.5, b.y);
        ctx.lineTo(b.x, b.y + r + 1.5); ctx.lineTo(b.x - r - 1.5, b.y);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = st.col;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y - r); ctx.lineTo(b.x + r * 0.68, b.y);
        ctx.lineTo(b.x, b.y + r); ctx.lineTo(b.x - r * 0.68, b.y);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(b.x, b.y, r * 0.30, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = st.outline;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 1.5, 0, TAU); ctx.fill();
        ctx.fillStyle = st.col;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.92)';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.42, 0, TAU); ctx.fill();
      }
    }
  }

  function drawHazards() {
    for (const h of hazards) {
      const dx = Math.cos(h.angle), dy = Math.sin(h.angle);
      const ex = h.x + dx * h.len, ey = h.y + dy * h.len;
      if (h.warn > 0) {
        const on = Math.floor(animT * 12) % 2 === 0;
        if (h.rot) {
          const sweep = h.rot * h.active;
          const grd = ctx.createRadialGradient(h.x, h.y, 8, h.x, h.y, h.len * 0.92);
          grd.addColorStop(0, 'rgba(255,90,60,.16)');
          grd.addColorStop(1, 'rgba(255,90,60,0)');
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.moveTo(h.x, h.y);
          for (let i = 0; i <= 10; i++) {
            const a = h.angle + sweep * i / 10;
            ctx.lineTo(h.x + Math.cos(a) * h.len, h.y + Math.sin(a) * h.len);
          }
          ctx.closePath();
          ctx.fill();
        }
        ctx.save();
        ctx.setLineDash([12, 10]);
        ctx.strokeStyle = on ? 'rgba(255,80,60,.75)' : 'rgba(255,80,60,.25)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = on ? 'rgba(255,90,70,.85)' : 'rgba(255,90,70,.3)';
        ctx.beginPath();
        ctx.moveTo(h.x + dx * 24 - dy * 5, h.y + dy * 24 + dx * 5);
        ctx.lineTo(h.x + dx * 34, h.y + dy * 34);
        ctx.lineTo(h.x + dx * 24 + dy * 5, h.y + dy * 24 - dx * 5);
        ctx.closePath(); ctx.fill();
      } else {
        const a = clamp(h.active, 0, 1);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = 'rgba(255,80,50,' + (0.18 * a) + ')';
        ctx.lineWidth = h.width + 14;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,120,70,' + (0.85 * a) + ')';
        ctx.lineWidth = h.width;
        ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,245,220,' + (0.9 * a) + ')';
        ctx.lineWidth = h.width * 0.28;
        ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawDrops() {
    for (const d of drops) {
      ctx.save();
      ctx.translate(d.x, d.y);
      const s = 1 + 0.08 * Math.sin(d.t * 5);
      ctx.scale(s, s);
      if (d.type === 'core') {
        ctx.rotate(d.t * 2.2);
        ctx.shadowColor = '#ffd23e';
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#c98a1a';
        ctx.beginPath();
        ctx.moveTo(0, -13); ctx.lineTo(11, 0); ctx.lineTo(0, 13); ctx.lineTo(-11, 0);
        ctx.closePath(); ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#ffe6a0';
        ctx.lineWidth = 1.5; ctx.stroke();
        ctx.rotate(-d.t * 2.2);
        ctx.fillStyle = '#fff6cf';
        ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, TAU); ctx.fill();
      } else {
        ctx.rotate(Math.sin(d.t * 2) * 0.15);
        const cfg = d.type === 'red' ? ['#ff4d57', '#ffd0d3', 'P']
          : d.type === 'blue' ? ['#2fa7ef', '#d2ecff', 'P']
          : d.type === 'bomb' ? ['#39414f', '#ffb347', 'B']
          : d.type === 'shield' ? ['#1fae64', '#b8ffd9', 'S']
          : ['#7a4dd6', '#e2ccff', 'M'];
        ctx.shadowColor = cfg[0]; ctx.shadowBlur = 14;
        rr(-12, -12, 24, 24, 5);
        ctx.fillStyle = cfg[0]; ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = cfg[1]; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px ' + MONO;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(cfg[2], 0, 1);
        ctx.textBaseline = 'alphabetic';
      }
      ctx.restore();
    }
  }

  function drawRings() {
    for (const r of rings) {
      if (r.t < 0) continue;
      const k = r.t / r.dur, e = 1 - Math.pow(1 - k, 3);
      ctx.strokeStyle = r.col + (0.8 * (1 - k)) + ')';
      ctx.lineWidth = 1 + 3 * (1 - k);
      ctx.beginPath(); ctx.arc(r.x, r.y, Math.max(1, r.max * e), 0, TAU); ctx.stroke();
    }
  }

  function drawParts() {
    for (const q of parts) {
      const k = q.t / q.dur;
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = q.col;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (1 - k * 0.5), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPops() {
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px ' + FONT;
    for (const o of pops) {
      const k = o.t / o.dur;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = 'rgba(0,0,0,.7)';
      ctx.lineWidth = 3;
      ctx.strokeText(o.txt, o.x, o.y);
      ctx.fillStyle = o.col;
      ctx.fillText(o.txt, o.x, o.y);
    }
    ctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------------------
  // HUD and overlays
  // -------------------------------------------------------------------------
  function drawShipIcon(x, y) {
    ctx.fillStyle = '#9fd8ff';
    ctx.beginPath();
    ctx.moveTo(x, y - 8); ctx.lineTo(x + 5, y + 6); ctx.lineTo(x, y + 3); ctx.lineTo(x - 5, y + 6);
    ctx.closePath(); ctx.fill();
  }

  function drawBombIcon(x, y) {
    ctx.fillStyle = '#232c47';
    ctx.beginPath(); ctx.arc(x, y, 7, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#ffb347';
    ctx.fillRect(x - 1, y - 10, 2, 3);
  }

  function drawBossBar() {
    const b = boss;
    if (!b) return;
    const name = b.state === 'dying' ? '核心崩解' : b.type.name;
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px ' + FONT;
    ctx.fillStyle = b.type.palette.glow;
    ctx.fillText(name, W / 2, 60);

    const bx = 92, by = 68, bw = 296, bh = 8;
    ctx.fillStyle = 'rgba(0,0,0,.5)';
    ctx.fillRect(bx, by, bw, bh);
    const frac = clamp(b.hp / b.maxHp, 0, 1);
    ctx.fillStyle = b.type.palette.glow;
    ctx.fillRect(bx + 1, by + 1, (bw - 2) * frac, bh - 2);
    ctx.strokeStyle = 'rgba(255,120,80,.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    const n = b.parts.length;
    for (let i = 0; i < n; i++) {
      const p = b.parts[i];
      const px = W / 2 + (i - (n - 1) / 2) * 14;
      ctx.fillStyle = p.alive ? b.type.palette.glow : 'rgba(255,255,255,.13)';
      ctx.fillRect(px - 4, 83, 8, 4);
    }
  }

  function drawHUD() {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '10px ' + FONT;
    ctx.fillStyle = '#7f93b5';
    ctx.fillText('得分', 14, 18);
    ctx.font = 'bold 21px ' + MONO;
    ctx.fillStyle = '#fff';
    ctx.fillText(String(Math.floor(displayScore)), 14, 40);
    ctx.font = '10px ' + FONT;
    ctx.fillStyle = '#d8b04a';
    ctx.fillText('最高 ' + hiScore, 14, 55);

    if (coreChain > 0) {
      ctx.font = 'bold 11px ' + MONO;
      ctx.fillStyle = '#ffd23e';
      ctx.fillText('CHAIN ×' + coreChain, 14, 70);
    }

    ctx.textAlign = 'center';
    ctx.font = '10px ' + FONT;
    ctx.fillStyle = theme.accent;
    ctx.fillText('SECTOR ' + romanOf(sector), W / 2, 20);

    for (let i = 0; i < player.lives; i++) drawShipIcon(W - 24 - i * 18, 20);
    for (let i = 0; i < player.bombs; i++) drawBombIcon(W - 22 - i * 17, 40);

    if (boss) drawBossBar();

    const px = 12, py = H - 46, pw = 228, ph = 34;
    rr(px, py, pw, ph, 8);
    ctx.fillStyle = 'rgba(8,16,30,.58)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(110,170,255,.28)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const w = playerWeapon();
    ctx.textAlign = 'left';
    ctx.font = 'bold 13px ' + FONT;
    ctx.fillStyle = w.color;
    ctx.fillText(w.name, px + 10, py + 16);
    ctx.textAlign = 'right';
    ctx.font = 'bold 12px ' + MONO;
    ctx.fillStyle = '#fff';
    ctx.fillText('Lv.' + playerLvl(), px + pw - 10, py + 16);
    for (let i = 0; i < w.maxLevel; i++) {
      ctx.fillStyle = i < playerLvl()
        ? (i === w.maxLevel - 1 && playerLvl() === w.maxLevel ? '#fff' : w.color)
        : 'rgba(255,255,255,.13)';
      rr(px + 10 + i * 26, py + 23, 23, 6, 2);
      ctx.fill();
    }

    ctx.textAlign = 'right';
    ctx.font = '10px ' + FONT;
    let sy = Input.touchMode ? H - 122 : H - 92;
    if (!settings.autoFire) {
      ctx.fillStyle = '#ffb347';
      ctx.fillText('手动开火', W - 14, sy);
      sy += 15;
    }
    ctx.fillStyle = 'rgba(160,190,225,.75)';
    ctx.fillText('擦弹 ' + player.graze, W - 14, sy);
    sy += 15;
    if (player.mslLvl > 0) {
      ctx.fillStyle = '#c9a0ff';
      ctx.fillText('导弹 Lv.' + player.mslLvl, W - 14, sy);
      sy += 15;
    }
    if (player.shield) {
      ctx.fillStyle = '#7fe8a8';
      ctx.fillText('护盾', W - 14, sy);
    }
  }

  function drawTouchControls() {
    if (!Input.touchMode || state !== 'play' || paused) return;
    const focus = Input.focusTouch;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = 'rgba(10,20,38,.5)';
    ctx.strokeStyle = 'rgba(140,190,255,.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(TOUCH.pause.x, TOUCH.pause.y, TOUCH.pause.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#dceaff';
    ctx.fillRect(TOUCH.pause.x - 5, TOUCH.pause.y - 6, 3, 12);
    ctx.fillRect(TOUCH.pause.x + 2, TOUCH.pause.y - 6, 3, 12);

    ctx.fillStyle = focus ? 'rgba(70,200,255,.3)' : 'rgba(10,20,38,.5)';
    ctx.strokeStyle = focus ? 'rgba(150,240,255,.9)' : 'rgba(140,190,255,.35)';
    ctx.beginPath(); ctx.arc(TOUCH.focus.x, TOUCH.focus.y, TOUCH.focus.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = focus ? '#fff' : '#cfe3ff';
    ctx.font = 'bold 12px ' + FONT;
    ctx.fillText('焦点', TOUCH.focus.x, TOUCH.focus.y);

    if (!settings.autoFire) {
      const on = Input.fireTouch;
      ctx.fillStyle = on ? 'rgba(255,150,70,.42)' : 'rgba(10,20,38,.55)';
      ctx.strokeStyle = on ? 'rgba(255,210,130,.95)' : 'rgba(255,180,90,.55)';
      ctx.beginPath(); ctx.arc(TOUCH.fire.x, TOUCH.fire.y, TOUCH.fire.r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = on ? '#fff' : '#ffd0a0';
      ctx.font = 'bold 13px ' + FONT;
      ctx.fillText('开火', TOUCH.fire.x, TOUCH.fire.y - 2);
      ctx.font = '9px ' + FONT;
      ctx.fillStyle = 'rgba(255,210,170,.65)';
      ctx.fillText('按住', TOUCH.fire.x, TOUCH.fire.y + 13);
    }

    ctx.fillStyle = 'rgba(10,20,38,.55)';
    ctx.strokeStyle = 'rgba(255,180,90,.55)';
    ctx.beginPath(); ctx.arc(TOUCH.bomb.x, TOUCH.bomb.y, TOUCH.bomb.r, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffd0a0';
    ctx.font = 'bold 13px ' + FONT;
    ctx.fillText('炸弹', TOUCH.bomb.x, TOUCH.bomb.y - 2);
    ctx.font = 'bold 11px ' + MONO;
    ctx.fillText(String(player.bombs), TOUCH.bomb.x, TOUCH.bomb.y + 13);

    if (Input.stick) {
      const s = Input.stick;
      const R = CONFIG.input.stickRadius;
      ctx.strokeStyle = 'rgba(130,190,255,.3)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.ox, s.oy, R, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(10,20,38,.28)';
      ctx.beginPath(); ctx.arc(s.ox, s.oy, R, 0, TAU); ctx.fill();
      const kx = s.ox + s.vx * R, ky = s.oy + s.vy * R;
      ctx.fillStyle = 'rgba(140,210,255,.55)';
      ctx.beginPath(); ctx.arc(kx, ky, 19, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(210,240,255,.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(kx, ky, 19, 0, TAU); ctx.stroke();
    }

    ctx.restore();
    ctx.textBaseline = 'alphabetic';
  }

  function drawWarn() {
    if (warnT <= 0) return;
    const on = blinkOn(6);
    const next = BOSS_TYPES[(sector - 1) % BOSS_TYPES.length];
    ctx.textAlign = 'center';
    if (on) {
      ctx.fillStyle = 'rgba(255,40,40,.13)';
      ctx.fillRect(0, H / 2 - 74, W, 148);
    }
    ctx.fillStyle = on ? '#ff4040' : 'rgba(255,64,64,.3)';
    ctx.font = '900 42px "Arial Black",' + FONT;
    ctx.fillText('警 告', W / 2, H / 2 - 14);
    ctx.font = 'bold 17px ' + FONT;
    ctx.fillStyle = on ? '#ffb0a0' : 'rgba(255,140,120,.4)';
    ctx.fillText('大型敌舰接近 · ' + next.name, W / 2, H / 2 + 22);
    ctx.font = '11px ' + MONO;
    ctx.fillStyle = 'rgba(255,180,150,.6)';
    ctx.fillText(next.code, W / 2, H / 2 + 44);
  }

  function drawBossBanner() {
    if (bossBannerT <= 0 || !boss) return;
    const k = 1 - bossBannerT / 2.2;
    const alpha = Math.min(1, bossBannerT * 2, k * 4);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.font = '900 30px ' + FONT;
    ctx.fillStyle = boss.type.palette.glow;
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 5;
    ctx.strokeText(boss.type.name, W / 2, H * 0.28);
    ctx.fillText(boss.type.name, W / 2, H * 0.28);
    ctx.font = '11px ' + MONO;
    ctx.fillStyle = 'rgba(220,235,255,.75)';
    ctx.fillText(boss.type.code, W / 2, H * 0.28 + 20);
    ctx.restore();
  }

  function drawSectorBanner() {
    if (!banner) return;
    const k = banner.t / banner.dur;
    const alpha = Math.min(1, banner.t * 4, (banner.dur - banner.t) * 3);
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2, H * 0.33);
    const s = 0.96 + Math.min(0.04, banner.t * 0.05);
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.font = '900 26px ' + FONT;
    ctx.fillStyle = theme.accent;
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.lineWidth = 5;
    ctx.strokeText(banner.text, 0, 0);
    ctx.fillText(banner.text, 0, 0);
    ctx.font = '13px ' + FONT;
    ctx.fillStyle = '#d5e3f8';
    ctx.fillText(banner.sub, 0, 24);
    ctx.font = '9px ' + MONO;
    ctx.fillStyle = 'rgba(200,220,245,.5)';
    ctx.fillText(theme.code, 0, 39);
    ctx.restore();
  }

  function chip(x, y, bg, br, label) {
    rr(x - 13, y - 13, 26, 26, 6);
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = br; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px ' + MONO;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + 1);
    ctx.textBaseline = 'alphabetic';
  }

  function drawTitleScreen() {
    ctx.fillStyle = 'rgba(2,5,14,.58)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';

    const lg = ctx.createLinearGradient(0, 120, 0, 232);
    lg.addColorStop(0, '#ffe27a');
    lg.addColorStop(0.5, '#ff9a3c');
    lg.addColorStop(1, '#ff4b3a');
    ctx.font = '900 52px "Arial Black","Arial",sans-serif';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.strokeText('THUNDER', W / 2, 170);
    ctx.fillStyle = lg;
    ctx.fillText('THUNDER', W / 2, 170);
    ctx.strokeText('STRIKE', W / 2, 222);
    ctx.fillText('STRIKE', W / 2, 222);

    ctx.font = 'bold 23px ' + FONT;
    ctx.fillStyle = '#cfe3ff';
    ctx.fillText('雷 霆 打 击', W / 2, 260);
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(80, 286); ctx.lineTo(W - 80, 286); ctx.stroke();

    ctx.font = '14px ' + FONT;
    ctx.fillStyle = '#bcd0ea';
    ctx.fillText('移动 方向键 / WASD · 焦点 Shift', W / 2, 316);
    ctx.fillText(settings.autoFire
      ? '自动开火 · 炸弹 空格 · 暂停 P'
      : '开火 J / Z（按住）· 炸弹 空格 · 暂停 P', W / 2, 342);
    ctx.fillText('触屏：' + (settings.controlMode === 'stick' ? '任意位置拖动虚拟摇杆' : '拖拽画面移动') +
      (settings.autoFire ? ' · 右下炸弹 / 焦点' : ' · 右下开火 / 炸弹 / 焦点'), W / 2, 368);

    ctx.textAlign = 'left';
    const items = [
      ['#ff4d57', '#ffd0d3', 'P', '扩散机炮'],
      ['#2fa7ef', '#d2ecff', 'P', '聚变激光'],
      ['#39414f', '#ffb347', 'B', '炸弹 +1'],
      ['#1fae64', '#b8ffd9', 'S', '护盾'],
      ['#7a4dd6', '#e2ccff', 'M', '导弹升级'],
      ['#c98a1a', '#ffe6a0', '◆', '数据核心连锁']
    ];
    for (let i = 0; i < items.length; i++) {
      const col = i % 2, row = i / 2 | 0;
      const ix = col === 0 ? 80 : 258;
      const iy = 410 + row * 38;
      chip(ix, iy, items[i][0], items[i][1], items[i][2]);
      ctx.font = '13px ' + FONT;
      ctx.fillStyle = '#bcd0ea';
      ctx.textAlign = 'left';
      ctx.fillText(items[i][3], ix + 22, iy + 5);
    }

    ctx.textAlign = 'center';
    if (blinkOn(1.6)) {
      ctx.font = 'bold 20px ' + FONT;
      ctx.fillStyle = '#fff';
      ctx.fillText(Input.touchMode ? '点击屏幕开始出击' : '按 ENTER 开始游戏', W / 2, 560);
    }
    ctx.font = '13px ' + FONT;
    ctx.fillStyle = '#d8b04a';
    ctx.fillText('最高纪录 ' + hiScore, W / 2, 600);
    ctx.font = '11px ' + MONO;
    ctx.fillStyle = 'rgba(140,170,210,.55)';
    ctx.fillText('ENDLESS SECTOR MODE', W / 2, 630);
  }

  // -------------------------------------------------------------------------
  // Pause menu
  // -------------------------------------------------------------------------
  function canFullscreen() {
    const el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function toggleFullscreen() {
    const el = document.documentElement;
    try {
      if (!isFullscreen()) {
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) {
          const p = req.call(el);
          if (p && p.catch) p.catch(() => {});
        }
      } else {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) {
          const p = exit.call(document);
          if (p && p.catch) p.catch(() => {});
        }
      }
    } catch (e) { /* fullscreen unsupported */ }
  }

  function getPauseRows() {
    let rows, y0, h, gap;
    if (pausePage === 'settings') {
      rows = [
        { id: 'music', label: '音乐音量', type: 'slider', value: settings.music },
        { id: 'sfx', label: '音效音量', type: 'slider', value: settings.sfx },
        { id: 'shake', label: '屏幕震动', type: 'toggle', value: settings.shake },
        { id: 'hitbox', label: '判定点', type: 'toggle', value: settings.hitbox },
        { id: 'mute', label: '静音', type: 'toggle', value: settings.muted },
        { id: 'control', label: '触屏操作', type: 'choice', value: settings.controlMode },
        { id: 'autoFire', label: '自动开火', type: 'toggle', value: settings.autoFire }
      ];
      if (canFullscreen()) {
        rows.push({ id: 'fullscreen', label: '全屏模式', type: 'toggle', value: isFullscreen() });
      }
      rows.push({ id: 'back', label: '返回', type: 'button' });
      y0 = 128;
      h = 42;
      gap = 10;
    } else {
      rows = [
        { id: 'resume', label: '继续', type: 'button' },
        { id: 'restart', label: '重新开始', type: 'button' },
        { id: 'settings', label: '设置', type: 'button' },
        { id: 'quit', label: '返回标题', type: 'button' }
      ];
      y0 = 224;
      h = 46;
      gap = 12;
    }
    const x = W / 2 - 170;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      r.x = x; r.y = y0 + i * (h + gap); r.w = 340; r.h = h;
      if (r.type === 'slider') {
        r.minus = { x: r.x + r.w - 96, y: r.y + 9, w: 28, h: 24 };
        r.plus = { x: r.x + r.w - 28, y: r.y + 9, w: 28, h: 24 };
      }
    }
    return rows;
  }

  function adjustVolume(key, delta) {
    settings[key] = clamp(Math.round((settings[key] + delta) * 10) / 10, 0, 1);
    Audio.setVolumes(settings.music, settings.sfx);
    saveSettings();
  }

  function cycleControlMode() {
    settings.controlMode = settings.controlMode === 'stick' ? 'drag' : 'stick';
    clearInputState();
    saveSettings();
  }

  function handlePausePointer(x, y) {
    const rows = getPauseRows();
    for (const r of rows) {
      if (y < r.y || y > r.y + r.h) continue;
      if (r.type === 'slider') {
        if (x >= r.minus.x && x <= r.minus.x + r.minus.w) {
          adjustVolume(r.id, -0.1);
        } else if (x >= r.plus.x && x <= r.plus.x + r.plus.w) {
          adjustVolume(r.id, 0.1);
        }
        return;
      }
      if (r.id === 'resume') { togglePause(); return; }
      if (r.id === 'restart') { startGame(); return; }
      if (r.id === 'settings') { pausePage = 'settings'; return; }
      if (r.id === 'back') { pausePage = 'main'; return; }
      if (r.id === 'quit') { quitToTitle(); return; }
      if (r.id === 'fullscreen') { toggleFullscreen(); return; }
      if (r.id === 'shake') { settings.shake = !settings.shake; saveSettings(); return; }
      if (r.id === 'hitbox') { settings.hitbox = !settings.hitbox; saveSettings(); return; }
      if (r.id === 'control') { cycleControlMode(); return; }
      if (r.id === 'autoFire') {
        settings.autoFire = !settings.autoFire;
        clearInputState();
        saveSettings();
        return;
      }
      if (r.id === 'mute') {
        settings.muted = !settings.muted;
        Audio.setMuted(settings.muted);
        saveSettings();
        return;
      }
    }
  }

  function drawPauseScreen() {
    ctx.fillStyle = 'rgba(3,6,16,.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    const settingsPage = pausePage === 'settings';
    ctx.font = 'bold ' + (settingsPage ? '32px ' : '38px ') + FONT;
    ctx.fillStyle = '#fff';
    ctx.fillText(settingsPage ? '设置' : '已暂停', W / 2, settingsPage ? 88 : 116);
    ctx.font = '12px ' + FONT;
    ctx.fillStyle = '#9fb3d4';
    ctx.fillText(settingsPage ? '调整会立即生效并自动保存' : 'P / Esc 继续 · R 重新开始', W / 2, settingsPage ? 112 : 142);

    const rows = getPauseRows();
    for (const r of rows) {
      rr(r.x, r.y, r.w, r.h, 8);
      ctx.fillStyle = 'rgba(10,20,38,.82)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(110,170,255,.28)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = 'bold 14px ' + FONT;
      ctx.fillStyle = '#dbe8fb';
      ctx.fillText(r.label, r.x + 16, r.y + r.h / 2);

      ctx.textAlign = 'right';
      if (r.type === 'slider') {
        ctx.font = 'bold 13px ' + MONO;
        ctx.fillStyle = '#8fe3ff';
        ctx.fillText(Math.round(r.value * 100) + '%', r.x + r.w - 52, r.y + r.h / 2);
        for (const item of [[r.minus, '−'], [r.plus, '+']]) {
          const bx = item[0];
          rr(bx.x, bx.y, bx.w, bx.h, 5);
          ctx.fillStyle = 'rgba(60,120,200,.35)';
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 16px ' + MONO;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(item[1], bx.x + bx.w / 2, bx.y + bx.h / 2);
        }
      } else if (r.type === 'toggle') {
        ctx.font = 'bold 13px ' + FONT;
        ctx.fillStyle = r.value ? '#7fe8a8' : 'rgba(160,180,210,.55)';
        ctx.fillText(r.value ? '开' : '关', r.x + r.w - 22, r.y + r.h / 2);
      } else if (r.type === 'choice') {
        ctx.font = 'bold 13px ' + FONT;
        ctx.fillStyle = '#8fe3ff';
        ctx.fillText(r.value === 'stick' ? '虚拟摇杆' : '拖拽移动', r.x + r.w - 22, r.y + r.h / 2);
      }
      ctx.textBaseline = 'alphabetic';
    }

    ctx.textAlign = 'center';
    ctx.font = '11px ' + FONT;
    ctx.fillStyle = 'rgba(140,170,210,.55)';
    ctx.fillText('设置会自动保存 · v' + TS.VERSION, W / 2, rows[rows.length - 1].y + 62);
  }

  // -------------------------------------------------------------------------
  // Game over
  // -------------------------------------------------------------------------
  function drawOverScreen() {
    ctx.fillStyle = 'rgba(2,5,14,.68)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    const lg = ctx.createLinearGradient(0, 168, 0, 220);
    lg.addColorStop(0, '#ff7a5a');
    lg.addColorStop(1, '#c81e2e');
    ctx.font = '900 44px "Arial Black",' + FONT;
    ctx.fillStyle = lg;
    ctx.fillText('游戏结束', W / 2, 212);
    ctx.font = '15px "Arial",sans-serif';
    ctx.fillStyle = '#ff9a8a';
    ctx.fillText('G A M E   O V E R', W / 2, 242);

    ctx.font = '12px ' + FONT;
    ctx.fillStyle = '#7f93b5';
    ctx.fillText('最终得分', W / 2, 286);
    ctx.font = 'bold 32px ' + MONO;
    ctx.fillStyle = '#fff';
    ctx.fillText(String(score), W / 2, 320);

    ctx.font = '14px ' + FONT;
    ctx.fillStyle = '#9fb3d4';
    ctx.fillText('SECTOR ' + romanOf(finalSector) + ' · 击破 BOSS ' + finalBossKills + ' · 擦弹 ' + finalGraze, W / 2, 356);
    ctx.fillText('存活 ' + fmtTime(finalTime), W / 2, 380);

    if (newRecord && blinkOn(2)) {
      ctx.font = 'bold 21px ' + FONT;
      ctx.fillStyle = '#ffd23e';
      ctx.fillText('新纪录！', W / 2, 424);
    }

    if (blinkOn(1.6)) {
      ctx.font = 'bold 19px ' + FONT;
      ctx.fillStyle = '#fff';
      ctx.fillText(Input.touchMode ? '点击屏幕再次出击' : '按 ENTER 再次出击', W / 2, 492);
    }
    ctx.font = '12px ' + FONT;
    ctx.fillStyle = 'rgba(160,190,225,.6)';
    ctx.fillText('R 重新开始', W / 2, 522);
  }

  // -------------------------------------------------------------------------
  // Render and main loop
  // -------------------------------------------------------------------------
  function render() {
    ensureBackdrop();
    ctx.fillStyle = '#04060f';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (shake > 0) ctx.translate((Math.random() * 2 - 1) * shake, (Math.random() * 2 - 1) * shake);
    drawBG();
    drawRings();
    drawDrops();
    for (const e of enemies) drawEnemy(e);
    if (boss) drawBoss();
    drawHazards();
    drawPBullets();
    drawPlayer();
    drawParts();
    drawEBullets();
    drawPops();
    ctx.restore();

    if (vignette) {
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);
    }
    if (flashW > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + Math.min(1, flashW) + ')';
      ctx.fillRect(0, 0, W, H);
    }
    if (flashR > 0) {
      ctx.fillStyle = 'rgba(255,60,60,' + (flashR * 0.6) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (state === 'play' || paused) drawHUD();
    if (state === 'play') drawTouchControls();
    if (state === 'play' && !paused) {
      if (warnT > 0) drawWarn();
      if (bossBannerT > 0) drawBossBanner();
      drawSectorBanner();
    }

    if (paused && state === 'play') drawPauseScreen();
    if (state === 'title') drawTitleScreen();
    if (state === 'over') drawOverScreen();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 1;
  }

  let last = performance.now();
  let acc = 0;
  const STEP = 1 / 60;

  function frame(now) {
    const real = Math.min(0.05, (now - last) / 1000) || 0;
    last = now;

    if (state === 'play' && !paused) {
      if (hitStop > 0) {
        hitStop = Math.max(0, hitStop - real);
      } else {
        let sim = real;
        if (slowMo > 0) {
          sim *= 0.35;
          slowMo = Math.max(0, slowMo - real);
        }
        acc = Math.min(acc + sim, 0.12);
        let steps = 0;
        while (acc >= STEP && steps < 6) {
          update(STEP);
          acc -= STEP;
          steps++;
        }
      }
    } else if (!paused) {
      acc = Math.min(acc + real, 0.12);
      let steps = 0;
      while (acc >= STEP && steps < 6) {
        update(STEP);
        acc -= STEP;
        steps++;
      }
    }

    render();
    requestAnimationFrame(frame);
  }

  // -------------------------------------------------------------------------
  // Debug hooks. Used by the headless smoke test; safe to leave in place.
  // -------------------------------------------------------------------------
  TS.debug = {
    snapshot() {
      return {
        version: TS.VERSION,
        state, paused, pausePage, score, sector, gameTime, bossKills, warnT,
        touchMode: Input.touchMode,
        controlMode: settings.controlMode,
        autoFire: settings.autoFire,
        enemies: enemies.length,
        eBullets: eBullets.length,
        pBullets: pBullets.length,
        drops: drops.length,
        player: {
          x: player.x, y: player.y, lives: player.lives, bombs: player.bombs,
          weapon: player.weapon, spreadLv: player.lv.spread, laserLv: player.lv.laser,
          dead: player.dead, invuln: player.invuln
        },
        boss: boss ? {
          id: boss.type.id, state: boss.state, hp: boss.hp, maxHp: boss.maxHp,
          parts: boss.parts.map(p => ({ id: p.id, alive: p.alive }))
        } : null,
        audio: {
          ready: !!Audio.ac,
          musicMode: Audio._music.mode,
          musicPlaying: Audio._music.playing,
          muted: settings.muted,
          musicVol: settings.music,
          sfxVol: settings.sfx
        }
      };
    },
    startGame,
    togglePause,
    tryBomb,
    pauseRows() {
      return getPauseRows().map(r => ({
        id: r.id, label: r.label, type: r.type,
        value: r.value, x: r.x, y: r.y, w: r.w, h: r.h
      }));
    },
    setPausePage(page) {
      pausePage = page === 'settings' ? 'settings' : 'main';
    },
    setAutoFire(v) {
      settings.autoFire = !!v;
      clearInputState();
      saveSettings();
    },
    setControlMode(mode) {
      settings.controlMode = mode === 'stick' ? 'stick' : 'drag';
      clearInputState();
      saveSettings();
    },
    touchButtons() {
      return JSON.parse(JSON.stringify(TOUCH));
    },
    forceSector(n) {
      sector = n;
      buildSector(n);
    },
    spawnBoss() {
      warnT = 0;
      makeBoss();
      boss.state = 'fight';
      boss.y = 140;
    },
    triggerBossWarning() {
      sectorT = 9999;
    },
    hurtBoss(n) {
      if (!boss) return;
      boss.state = 'fight';
      boss.invulnT = 0;
      boss.hp -= n;
      checkBossDeath();
    },
    killBossParts() {
      if (!boss) return;
      for (const p of boss.parts) {
        if (p.alive) destroyBossPart(p);
      }
    },
    setWeapon(name, lv) {
      if (!WEAPONS[name]) return;
      player.weapon = name;
      player.lv[name] = clamp(lv || 1, 1, WEAPONS[name].maxLevel);
    },
    giveDrop(type) {
      applyDrop(type);
    },
    killPlayer() {
      player.invuln = 0;
      player.shield = false;
      hitPlayer();
    },
    setTouchMode(v) {
      Input.touchMode = !!v;
    },
    makeInvincible() {
      player.invuln = 9999;
    },
    grantMissile() {
      player.mslLvl = CONFIG.missile.levels.length;
    },
    // Runs the real drop roll N times and returns how many items it produced.
    // Used by the balance smoke test; clears the drops array afterwards.
    auditDrops(n, kind) {
      const saved = killsNoDrop;
      killsNoDrop = 0;
      drops.length = 0;
      const fake = {
        drop: true,
        x: W / 2, y: 300,
        type: kind === 'carrier' ? 'carrier' : 'fighter',
        elite: kind === 'elite'
      };
      let spawned = 0;
      for (let i = 0; i < n; i++) {
        const before = drops.length;
        rollDrop(fake);
        spawned += drops.length - before;
        drops.length = 0;
      }
      killsNoDrop = saved;
      return spawned;
    }
  };

  fitCanvas();
  buildSector(1);
  requestAnimationFrame(frame);
})();
