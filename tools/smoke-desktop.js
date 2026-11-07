'use strict';
// Desktop/regression smoke test.
// Usage: node tools/smoke-desktop.js
// Env:   SMOKE_URL  use an already-running server instead of the built-in one

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  OUT, ROOT, sleep, createServer, launchBrowser, attachErrorTracking, openPage
} = require('./harness');

const PORT = 8137;
const CDP_PORT = 9337;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let server = null;
  let browser = null;
  const results = [];
  const errors = [];
  const assert = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail });
    console.log((ok ? 'PASS ' : 'FAIL ') + name +
      (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
  };

  try {
    let baseUrl = process.env.SMOKE_URL;
    if (!baseUrl) {
      server = await createServer(PORT);
      baseUrl = 'http://127.0.0.1:' + PORT + '/';
    }

    browser = await launchBrowser({
      cdpPort: CDP_PORT,
      profile: path.join(OUT, 'edge-profile'),
      windowSize: '600,900'
    });
    const cdp = browser.cdp;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    attachErrorTracking(cdp, errors);

    await openPage(cdp, baseUrl);
    await sleep(1200);

    const evalJS = async expr => {
      const r = await cdp.send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: true
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.text + ' ' +
          (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
      }
      return r.result.value;
    };
    const snap = () => evalJS('TS.debug.snapshot()');
    const shot = async name => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
      return path.join(OUT, name);
    };
    const key = async (code, keyName, vk) => {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown', code, key: keyName,
        windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk
      });
      await sleep(40);
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp', code, key: keyName,
        windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk
      });
    };

    assert('page loads, TS namespace present',
      await evalJS('!!window.TS && !!TS.CONFIG && !!TS.Audio && !!TS.debug'));
    assert('version is exposed', await evalJS('typeof TS.VERSION === "string" && TS.VERSION.length > 0'), await evalJS('TS.VERSION'));

    let s = await snap();
    assert('starts on title', s.state === 'title', s.state);
    await shot('01-title.png');

    await key('Enter', 'Enter', 13);
    await sleep(900);
    s = await snap();
    assert('Enter starts play', s.state === 'play', s.state);
    assert('player is alive', s.player.lives === 3 && !s.player.dead, s.player);
    assert('spread auto-fire creates bullets', s.pBullets > 0, s.pBullets);
    assert('audio engine starts sector music',
      s.audio.ready && s.audio.musicPlaying && s.audio.musicMode === 'sector', s.audio);

    const x0 = s.player.x;
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown', code: 'ArrowLeft', key: 'ArrowLeft',
      windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37
    });
    await sleep(450);
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp', code: 'ArrowLeft', key: 'ArrowLeft',
      windowsVirtualKeyCode: 37, nativeVirtualKeyCode: 37
    });
    s = await snap();
    assert('keyboard movement works', s.player.x < x0 - 40, { from: x0, to: s.player.x });

    const bombs0 = s.player.bombs;
    await key('Space', ' ', 32);
    await sleep(200);
    s = await snap();
    assert('bomb consumes a bomb', s.player.bombs === bombs0 - 1, { before: bombs0, after: s.player.bombs });

    // Pointer drag moves the ship.
    const rect = await evalJS('(() => { const r = document.getElementById("game").getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}; })()');
    const sx = rect.x + rect.w * 0.5, sy = rect.y + rect.h * 0.7;
    const before = s.player.x;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx + 80, y: sy, button: 'left', buttons: 1 });
    await sleep(120);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx + 80, y: sy, button: 'left', buttons: 0, clickCount: 1 });
    s = await snap();
    assert('pointer drag moves ship', Math.abs(s.player.x - before) > 20, { before, after: s.player.x });

    await key('KeyP', 'p', 80);
    await sleep(200);
    s = await snap();
    assert('P pauses', s.paused === true, s.paused);
    assert('pause stops music', s.audio.musicPlaying === false, s.audio);
    await shot('02-pause.png');
    await key('KeyP', 'p', 80);
    await sleep(200);
    s = await snap();
    assert('P resumes', s.paused === false, s.paused);
    assert('resume restarts music', s.audio.musicPlaying === true, s.audio);

    // Manual fire mode: no bullets until the fire key is held.
    await evalJS('TS.debug.makeInvincible(); TS.debug.setAutoFire(false);');
    await sleep(1700);
    s = await snap();
    assert('manual mode stops auto fire', s.pBullets === 0, s.pBullets);
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown', code: 'KeyJ', key: 'j',
      windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74
    });
    await sleep(350);
    s = await snap();
    assert('holding J fires manually', s.pBullets > 0, s.pBullets);
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp', code: 'KeyJ', key: 'j',
      windowsVirtualKeyCode: 74, nativeVirtualKeyCode: 74
    });
    await sleep(1700);
    s = await snap();
    assert('releasing J stops firing', s.pBullets === 0, s.pBullets);
    await evalJS('TS.debug.setAutoFire(true);');
    await sleep(300);

    // Laser weapon + missiles.
    await evalJS('TS.debug.setWeapon("laser", 6); TS.debug.grantMissile();');
    await sleep(700);
    s = await snap();
    assert('laser weapon equipped', s.player.weapon === 'laser' && s.player.laserLv === 6, s.player);
    assert('missiles auto-fire', s.pBullets > 0, s.pBullets);

    // Boss lifecycle in sector 2.
    await evalJS('TS.debug.forceSector(2); TS.debug.spawnBoss();');
    await sleep(400);
    s = await snap();
    assert('boss spawns with parts',
      !!s.boss && s.boss.id === 'hive' && s.boss.parts.length === 4, s.boss);
    assert('warning overlay cleared on spawn', s.warnT === 0, s.warnT);
    await shot('03-boss.png');

    await evalJS('TS.debug.killBossParts();');
    await sleep(300);
    s = await snap();
    assert('all boss parts destroyed',
      s.boss && s.boss.parts.every(p => !p.alive), s.boss && s.boss.parts);

    await evalJS('TS.debug.hurtBoss(1e9);');
    await sleep(3400);
    s = await snap();
    assert('boss dies and sector advances',
      s.boss === null && s.sector === 3,
      { boss: s.boss, sector: s.sector, bossKills: s.bossKills });
    assert('boss kill is counted', s.bossKills === 1, s.bossKills);

    await sleep(600);
    await shot('04-next-sector.png');
    s = await snap();
    assert('game keeps running after boss', s.state === 'play', s.state);

    // Touch controls overlay + bomb button.
    await evalJS('TS.debug.makeInvincible(); TS.debug.setTouchMode(true);');
    await sleep(250);
    const sb = await snap();
    await shot('05-touch.png');
    const bombBefore = sb.player.bombs;
    const bombX = rect.x + rect.w * (434 / 480);
    const bombY = rect.y + rect.h * (672 / 720);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: bombX, y: bombY, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: bombX, y: bombY, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(200);
    s = await snap();
    assert('touch bomb button fires bomb',
      s.player.bombs === bombBefore - 1, { before: bombBefore, after: s.player.bombs });
    await evalJS('TS.debug.setTouchMode(false);');

    // All three boss archetypes: phases, bullet patterns, hazards, death.
    await evalJS('TS.debug.makeInvincible(); TS.debug.setWeapon("spread", 5);');
    const bossIds = ['destroyer', 'hive', 'leviathan'];
    for (let n = 1; n <= 3; n++) {
      await evalJS(`TS.debug.forceSector(${n}); TS.debug.spawnBoss();`);
      await sleep(2200);
      s = await snap();
      assert(`boss ${n} spawns as ${bossIds[n - 1]}`,
        !!s.boss && s.boss.id === bossIds[n - 1], s.boss && s.boss.id);
      assert(`boss ${n} fires bullets`, s.eBullets > 0, s.eBullets);

      await evalJS(`TS.debug.hurtBoss(${0.4} * TS.debug.snapshot().boss.maxHp);`);
      await sleep(1600);
      s = await snap();
      assert(`boss ${n} reaches phase 2+`, !!s.boss, s.boss && s.boss.hp / s.boss.maxHp);

      await evalJS(`TS.debug.hurtBoss(${0.32} * TS.debug.snapshot().boss.maxHp);`);
      await sleep(2200);
      s = await snap();
      assert(`boss ${n} phase 3 keeps firing`,
        !!s.boss && s.eBullets > 0, { boss: !!s.boss, bullets: s.eBullets });
      await shot(`07-boss-${bossIds[n - 1]}.png`);

      await evalJS('TS.debug.killBossParts();');
      await sleep(300);
      await evalJS('TS.debug.hurtBoss(1e9);');
      await sleep(3200);
      s = await snap();
      assert(`boss ${n} defeat advances sector`, s.boss === null,
        { boss: !!s.boss, sector: s.sector, kills: s.bossKills });
    }

    // Game over flow.
    for (let i = 0; i < 3; i++) {
      await evalJS('TS.debug.killPlayer();');
      for (let w = 0; w < 30; w++) {
        await sleep(200);
        s = await snap();
        if (s.state !== 'play' || !s.player.dead) break;
      }
    }
    s = await snap();
    assert('three deaths end the game', s.state === 'over', { state: s.state, lives: s.player.lives });
    await sleep(300);
    await shot('06-gameover.png');
    await key('KeyR', 'r', 82);
    await sleep(600);
    s = await snap();
    assert('R restarts from game over', s.state === 'play' && s.score === 0, { state: s.state, score: s.score });

    // Natural boss warning -> arrival -> defeat, using the real wave director.
    await evalJS('TS.debug.triggerBossWarning();');
    await sleep(350);
    s = await snap();
    assert('warning phase starts boss music',
      s.warnT > 0 && s.audio.musicMode === 'boss', { warnT: s.warnT, audio: s.audio });
    await shot('08-warning.png');
    for (let w = 0; w < 25; w++) {
      await sleep(200);
      s = await snap();
      if (s.boss && s.boss.state !== 'enter') break;
    }
    assert('boss arrives after warning', !!s.boss && s.boss.state !== 'enter', s.boss && s.boss.state);
    await evalJS('TS.debug.makeInvincible(); TS.debug.killBossParts(); TS.debug.hurtBoss(1e9);');
    await sleep(3400);
    s = await snap();
    assert('natural boss defeat resets sector timer',
      s.boss === null && s.sector === 2 && s.bossKills === 1, { sector: s.sector, kills: s.bossKills });

    // Pause menu interactions (pointer mapping, mute toggle, restart).
    await key('KeyP', 'p', 80);
    await sleep(200);
    const clickAt = async (lx, ly) => {
      const px = rect.x + rect.w * (lx / 480);
      const py = rect.y + rect.h * (ly / 720);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', buttons: 1, clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', buttons: 0, clickCount: 1 });
      await sleep(250);
    };
    const pauseRows = await evalJS('TS.debug.pauseRows().map(r => ({id:r.id,y:r.y,h:r.h}))');
    const rowY = id => {
      const row = pauseRows.find(r => r.id === id);
      if (!row) throw new Error('missing pause row: ' + id);
      return row.y + row.h / 2;
    };
    await clickAt(240, rowY('settings'));
    let settingsRows = await evalJS('TS.debug.pauseRows().map(r => ({id:r.id,y:r.y,h:r.h}))');
    assert('pause menu opens settings page',
      (await snap()).pausePage === 'settings' && settingsRows.some(r => r.id === 'autoFire'),
      settingsRows.map(r => r.id));
    const settingsRowY = id => {
      const row = settingsRows.find(r => r.id === id);
      if (!row) throw new Error('missing settings row: ' + id);
      return row.y + row.h / 2;
    };
    await clickAt(240, settingsRowY('mute'));
    s = await snap();
    assert('pause menu mute toggle works', s.audio.muted === true, s.audio);
    await clickAt(240, settingsRowY('mute'));
    s = await snap();
    assert('pause menu mute toggles back', s.audio.muted === false, s.audio);
    await clickAt(240, settingsRowY('control'));
    s = await snap();
    assert('touch control mode toggles to stick', s.controlMode === 'stick', s.controlMode);
    await clickAt(240, settingsRowY('control'));
    s = await snap();
    assert('touch control mode toggles back to drag', s.controlMode === 'drag', s.controlMode);
    await clickAt(240, settingsRowY('back'));
    s = await snap();
    assert('settings back returns to main pause page', s.pausePage === 'main', s.pausePage);
    await clickAt(240, rowY('restart'));
    s = await snap();
    assert('pause menu restart button works',
      s.state === 'play' && s.score === 0 && !s.paused,
      { state: s.state, score: s.score, paused: s.paused });

    // Drop balance: exercises the real rollDrop path via TS.debug.auditDrops.
    const normalDrops = await evalJS('TS.debug.auditDrops(20000, "normal")');
    const eliteDrops = await evalJS('TS.debug.auditDrops(20000, "elite")');
    const carrierDrops = await evalJS('TS.debug.auditDrops(20000, "carrier")');
    const normalPer100 = normalDrops / 200;
    assert('normal enemy drop rate is restrained',
      normalPer100 >= 4 && normalPer100 <= 11, { per100Kills: normalPer100 });
    assert('elite drops are one item plus occasional core',
      eliteDrops / 20000 >= 1.2 && eliteDrops / 20000 <= 1.8, { perKill: eliteDrops / 20000 });
    assert('carrier drops are one item plus likely core',
      carrierDrops / 20000 >= 1.3 && carrierDrops / 20000 <= 1.9, { perKill: carrierDrops / 20000 });

    // Off-colour pickups should upgrade the reserve weapon instead of forcing
    // an immediate downgrade.
    await evalJS('TS.debug.setWeapon("spread", 5); TS.debug.giveDrop("blue");');
    s = await snap();
    assert('off-colour drop upgrades reserve weapon',
      s.player.weapon === 'spread' && s.player.laserLv === 2,
      { weapon: s.player.weapon, laserLv: s.player.laserLv });
    await evalJS('TS.debug.giveDrop("blue"); TS.debug.giveDrop("blue");');
    await evalJS('TS.debug.giveDrop("blue");');
    s = await snap();
    assert('reserve weapon switches once it catches up',
      s.player.weapon === 'laser' && s.player.laserLv === 5,
      { weapon: s.player.weapon, laserLv: s.player.laserLv });

    // Let enemies spawn for a while to exercise waves, then check no errors.
    await sleep(2500);
    s = await snap();
    console.log('final snapshot', JSON.stringify(s));

    // The game must still run when opened directly from disk (no server).
    await openPage(cdp, pathToFileURL(path.join(ROOT, 'index.html')).href);
    await sleep(800);
    assert('file:// entry loads and starts', await evalJS('!!window.TS && !!TS.debug && TS.debug.snapshot().state === "title"'));
  } catch (e) {
    errors.push('SCRIPT: ' + (e && e.stack || e));
    console.log('SCRIPT ERROR', e);
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
  }

  const failed = results.filter(r => !r.ok).length;
  console.log('\nSUMMARY ' + (results.length - failed) + '/' + results.length + ' passed');
  if (errors.length) {
    console.log('ERRORS:');
    for (const e of errors) console.log(' - ' + e);
  } else {
    console.log('No console/runtime errors.');
  }
  process.exit(failed || errors.length ? 1 : 0);
}

main();
