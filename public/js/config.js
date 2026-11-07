(() => {
  'use strict';
  const TS = window.TS = window.TS || {};
  const VERSION = '0.9.1';

  // ---------------------------------------------------------------------------
  // Tunables. Keep gameplay numbers here so balance changes don't touch logic.
  // ---------------------------------------------------------------------------
  const CONFIG = {
    width: 480,
    height: 720,
    player: {
      speed: 330,
      focusScale: 0.45,
      radius: 19,
      hitR: 6,
      startLives: 3,
      startBombs: 3,
      maxBombs: 6,
      invuln: 2.2,
      respawnInvuln: 2.6,
      deathLevelLoss: 2,
      grazeRadius: 28
    },
    playfield: { left: 18, right: 18, top: 112, bottom: 78 },
    bomb: {
      cooldown: 0.8,
      invuln: 0.8,
      enemyBase: 180,
      enemyPerSector: 55,
      bossPct: 0.10,
      clearScore: 5
    },
    missile: {
      interval: [0.56, 0.48, 0.42],
      speed: 445,
      turn: 4.8,
      levels: [{ dmg: 9 }, { dmg: 13 }, { dmg: 17 }]
    },
    graze: { score: 10, sparkChance: 0.7 },
    input: {
      // Floating stick: movement starts wherever the finger lands.
      stickRadius: 56,
      stickDead: 0.12
    },
    sector: {
      waves: 5,
      grace: 3.0,
      intermission: 1.2,
      warnDur: 2.3,
      bannerDur: 2.6,
      waveBannerDur: 2.2
    },
    difficulty: {
      hpPerSector: 0.34,
      hpMax: 3.8,
      firePerSector: 0.13,
      fireMax: 2.2,
      bulletSpeedBase: 165,
      bulletSpeedPerSector: 6,
      bulletSpeedMax: 255,
      eliteBase: 0.08,
      elitePerSector: 0.025,
      eliteMax: 0.28
    },
    limits: {
      maxEnemies: 52,
      maxEBullets: 380,
      maxPBullets: 300,
      maxParticles: 700,
      maxDrops: 24
    },
    boss: {
      coreDamageMul: 0.45,
      partScore: 600,
      coreExposedScore: 2000,
      rewardBase: 5000,
      rewardPerSector: 1500,
      partPowerupChance: 0.18,
      partCoreChance: 0.30
    },
    drops: {
      // Powerups are intentionally sparse: randomChance and pityKills set the
      // pace, while coreChance only adds score-chain pickups.
      randomChance: 0.02,
      pityKills: 36,
      coreChance: 0.03,
      coreBaseScore: 100,
      coreChainMax: 10,
      coreChainTime: 7,
      weights: { red: 36, blue: 36, bomb: 12, shield: 9, missile: 7 },
      eliteCoreChance: 0.50,
      carrierCoreChance: 0.60
    },
    carrier: {
      // Supply ships are the main guaranteed powerup source.
      first: 12,
      interval: [30, 38]
    },
    audio: { master: 1, music: 0.52, sfx: 0.78, bpm: 146 },
    saveKey: 'thunder_strike_settings_v3',
    hiScoreKey: 'thunder_strike_hiscore_v3',
    profile: {
      key: 'thunder_strike_profile_v1',
      version: 1,
      nameMax: 12,
      maxLocalScores: 50,
      maxPending: 20
    },
    leaderboard: {
      // Leave empty to use the local (offline) board. Set this to the deployed
      // Cloudflare Worker origin, e.g. 'https://thunder-strike.example.workers.dev'.
      endpoint: '',
      limit: 50,
      timeout: 6000,
      refreshMs: 60000
    }
  };

  const WEAPONS = {
    spread: {
      id: 'spread',
      name: '扩散机炮',
      code: 'VULCAN',
      color: '#ff8a5c',
      fireInterval: 0.112,
      maxLevel: 8,
      levels: [
        { shots: 1, fan: 0, dmg: 3 },
        { shots: 2, fan: 10, dmg: 3 },
        { shots: 3, fan: 18, dmg: 4 },
        { shots: 4, fan: 28, dmg: 4 },
        { shots: 5, fan: 38, dmg: 5 },
        { shots: 6, fan: 48, dmg: 5 },
        { shots: 7, fan: 60, dmg: 6 },
        { shots: 9, fan: 74, dmg: 7 }
      ]
    },
    laser: {
      id: 'laser',
      name: '聚变激光',
      code: 'PLASMA',
      color: '#41c8ff',
      beamTick: 0.08,
      maxLevel: 8,
      levels: [
        { beams: 1, width: 8, dmg: 3 },
        { beams: 1, width: 10, dmg: 4 },
        { beams: 2, width: 12, dmg: 5 },
        { beams: 2, width: 14, dmg: 6 },
        { beams: 3, width: 16, dmg: 7 },
        { beams: 3, width: 18, dmg: 8 },
        { beams: 4, width: 20, dmg: 9 },
        { beams: 4, width: 22, dmg: 10 }
      ]
    }
  };

  const BULLET_STYLES = {
    aim: { col: '#ff5fa8', outline: '#4a0a24', shape: 'diamond', r: 4.2 },
    ring: { col: '#59d5ff', outline: '#06304a', shape: 'orb', r: 5.0 },
    spread: { col: '#b6ff5a', outline: '#1f3a06', shape: 'small', r: 3.4 },
    heavy: { col: '#ffb03a', outline: '#4a2400', shape: 'orb', r: 5.5 }
  };

  const ENEMY_TYPES = {
    fighter: {
      name: '战机', hp: 4, r: 13, score: 100,
      vy: [95, 125], amp: [40, 70], freq: [1.6, 2.4],
      fire: [1.2, 2.4], kind: 'aim', shots: 1, spread: 0,
      drop: true
    },
    gunship: {
      name: '炮艇', hp: 12, r: 20, score: 250,
      vy: [48, 60], amp: [14, 26], freq: [0.8, 1.2],
      fire: [1.4, 2.4], kind: 'aim', shots: 3, spread: 0.30,
      drop: true
    },
    diver: {
      name: '突袭机', hp: 3, r: 12, score: 150,
      speed: [235, 285], drop: true
    },
    carrier: {
      name: '补给舰', hp: 34, r: 26, score: 500,
      vy: 34, amp: 24, freq: 0.5,
      fire: [2.5, 3.5], kind: 'ring', ringN: 10,
      drop: true, guaranteed: true
    },
    sentinel: {
      name: '哨戒炮', hp: 18, r: 17, score: 300,
      vy: 60, hold: [6, 9],
      fire: [1.5, 2.0], kind: 'aim', shots: 3, spread: 0.26,
      drop: true
    },
    drone: {
      name: '无人机', hp: 2, r: 9, score: 40,
      speed: [180, 220], drop: false
    }
  };

  const BOSS_TYPES = [
    {
      id: 'destroyer',
      name: '毁灭者',
      code: 'DESTROYER',
      palette: {
        hull: ['#4a5674', '#151b30'],
        inner: 'rgba(107,120,154,.5)',
        glow: '#ffd23e',
        bullet: '#ff8844'
      },
      core: { rx: 64, ry: 38, dy: 6 },
      parts: [
        { id: 'L', type: 'cannon', dx: -66, dy: 8, r: 19, hpPct: 0.18 },
        { id: 'R', type: 'cannon', dx: 66, dy: 8, r: 19, hpPct: 0.18 },
        { id: 'B', type: 'cannon', dx: 0, dy: 40, r: 15, hpPct: 0.12 }
      ],
      hpBase: 1200, hpPerSector: 480, hpCap: 7200
    },
    {
      id: 'hive',
      name: '轨道蜂巢',
      code: 'ORBITAL HIVE',
      palette: {
        hull: ['#3d4a6b', '#121a2e'],
        inner: 'rgba(120,100,180,.35)',
        glow: '#b46bff',
        bullet: '#c07aff'
      },
      core: { rx: 46, ry: 46, dy: 0 },
      parts: [
        { id: 'N', type: 'orb', r: 15, hpPct: 0.12, orbit: { r: 78, a: -Math.PI / 2, spd: 0.55 } },
        { id: 'E', type: 'orb', r: 15, hpPct: 0.12, orbit: { r: 78, a: 0, spd: 0.55 } },
        { id: 'S', type: 'orb', r: 15, hpPct: 0.12, orbit: { r: 78, a: Math.PI / 2, spd: 0.55 } },
        { id: 'W', type: 'orb', r: 15, hpPct: 0.12, orbit: { r: 78, a: Math.PI, spd: 0.55 } }
      ],
      hpBase: 1400, hpPerSector: 520, hpCap: 7800
    },
    {
      id: 'leviathan',
      name: '航母利维坦',
      code: 'CARRIER LEVIATHAN',
      palette: {
        hull: ['#5a4b3a', '#1d1610'],
        inner: 'rgba(160,130,90,.4)',
        glow: '#ff9a3c',
        bullet: '#ffb03a'
      },
      core: { rx: 88, ry: 32, dy: 8 },
      parts: [
        { id: 'HL', type: 'hangar', dx: -76, dy: 16, r: 22, hpPct: 0.15 },
        { id: 'HR', type: 'hangar', dx: 76, dy: 16, r: 22, hpPct: 0.15 },
        { id: 'ML', type: 'pod', dx: -104, dy: -6, r: 14, hpPct: 0.10 },
        { id: 'MR', type: 'pod', dx: 104, dy: -6, r: 14, hpPct: 0.10 }
      ],
      hpBase: 1600, hpPerSector: 560, hpCap: 8400
    }
  ];

  const SECTORS = [
    {
      name: '小行星带', code: 'ASTEROID BELT',
      bg: ['#070b1a', '#0a1024', '#131a33'],
      nebula: [200, 265, 320],
      stars: ['#cfe6ff', '#ffd9a8', '#ffffff'],
      accent: '#6fb0ff', planet: 210, debris: '#7d879f'
    },
    {
      name: '电离星云', code: 'ION NEBULA',
      bg: ['#0b0718', '#160a28', '#241139'],
      nebula: [275, 310, 335],
      stars: ['#e6d4ff', '#ffb8e8', '#ffffff'],
      accent: '#c07aff', planet: 300, debris: '#8f7aa8'
    },
    {
      name: '轨道废墟', code: 'ORBITAL RUINS',
      bg: ['#04120f', '#071e1b', '#0d2d2a'],
      nebula: [150, 175, 200],
      stars: ['#c8fff0', '#a8e0ff', '#ffffff'],
      accent: '#4fe0b8', planet: 165, debris: '#6f9e91'
    },
    {
      name: '深空边界', code: 'DEEP SPACE',
      bg: ['#140608', '#240a10', '#351318'],
      nebula: [10, 25, 345],
      stars: ['#ffd0c0', '#ffb0a0', '#ffffff'],
      accent: '#ff7a5c', planet: 20, debris: '#a07a72'
    },
    {
      name: '引力井', code: 'GRAVITY WELL',
      bg: ['#0a0a14', '#141426', '#1e1e3a'],
      nebula: [230, 255, 285],
      stars: ['#d0d8ff', '#b0c0ff', '#ffffff'],
      accent: '#8a9bff', planet: 250, debris: '#8a90b8'
    }
  ];

  const DEFAULT_SETTINGS = {
    muted: false,
    music: CONFIG.audio.music,
    sfx: CONFIG.audio.sfx,
    shake: true,
    hitbox: true,
    autoFire: true,
    controlMode: 'drag'
  };

  Object.assign(TS, {
    VERSION,
    CONFIG,
    WEAPONS,
    BULLET_STYLES,
    ENEMY_TYPES,
    BOSS_TYPES,
    SECTORS,
    DEFAULT_SETTINGS
  });
})();
