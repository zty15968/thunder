'use strict';
// Mobile (390x844 @3x, touch emulation) smoke test.
// Usage: node tools/smoke-mobile.js
// Env:   SMOKE_URL  use an already-running server instead of the built-in one

const fs = require('fs');
const path = require('path');
const {
  OUT, sleep, createServer, launchBrowser, attachErrorTracking, openPage
} = require('./harness');

const PORT = 8138;
const CDP_PORT = 9338;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let server = null;
  let browser = null;
  const results = [];
  const errors = [];
  const assert = (name, ok, detail) => {
    results.push(!!ok);
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
      profile: path.join(OUT, 'edge-mobile-profile')
    });
    const cdp = browser.cdp;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    attachErrorTracking(cdp, errors);

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 3, mobile: true
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await openPage(cdp, baseUrl);
    await sleep(1300);

    const evalJS = async expr => {
      const r = await cdp.send('Runtime.evaluate', {
        expression: expr, returnByValue: true, awaitPromise: true
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value;
    };
    const snap = () => evalJS('TS.debug.snapshot()');
    const shot = async name => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
    };
    const rect = () => evalJS('(() => { const b = document.getElementById("game").getBoundingClientRect(); return {x:b.left,y:b.top,w:b.width,h:b.height}; })()');
    const tap = async (lx, ly) => {
      const r = await rect();
      const x = r.x + r.w * (lx / 480), y = r.y + r.h * (ly / 720);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await sleep(90);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(250);
      return r;
    };
    const drag = async (x0, y0, x1, y1) => {
      const r = await rect();
      const p = (lx, ly) => ({ x: r.x + r.w * (lx / 480), y: r.y + r.h * (ly / 720) });
      const a = p(x0, y0), b = p(x1, y1);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
      await sleep(60);
      for (let i = 1; i <= 4; i++) {
        const q = { x: a.x + (b.x - a.x) * i / 4, y: a.y + (b.y - a.y) * i / 4 };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: q.x, y: q.y }] });
        await sleep(30);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(250);
    };

    const layout = await evalJS(`(() => {
      const c = document.getElementById('game');
      const r = c.getBoundingClientRect();
      return {
        backing: [c.width, c.height], css: [Math.round(r.width), Math.round(r.height)],
        viewport: [innerWidth, innerHeight], docW: document.documentElement.scrollWidth,
        coarse: matchMedia('(pointer: coarse)').matches,
        dp: devicePixelRatio
      };
    })()`);
    assert('high-DPR backing store capped at 2x',
      layout.backing[0] === 960 && layout.backing[1] === 1440, layout.backing);
    assert('canvas fits mobile viewport',
      layout.css[0] <= layout.viewport[0] && layout.css[1] <= layout.viewport[1] &&
      layout.docW <= layout.viewport[0], layout);
    assert('coarse pointer detected', layout.coarse === true, layout.coarse);
    const vp = await evalJS(`document.querySelector('meta[name="viewport"]').content`);
    assert('mobile viewport configured for full-bleed play',
      vp.includes('viewport-fit=cover') && vp.includes('user-scalable=no'), vp);
    await shot('09-mobile-title.png');

    let s = await snap();
    assert('title before tap', s.state === 'title', s.state);
    await tap(240, 400);
    s = await snap();
    assert('touch tap starts game', s.state === 'play', s.state);

    const before = s.player.x;
    await drag(140, 560, 220, 560);
    s = await snap();
    assert('touch drag moves ship', s.player.x > before + 30, { before, after: s.player.x });

    const bombs0 = s.player.bombs;
    await tap(434, 672);
    s = await snap();
    assert('touch bomb button fires', s.player.bombs === bombs0 - 1, { before: bombs0, after: s.player.bombs });

    await tap(460, 76);
    s = await snap();
    assert('touch pause button pauses', s.paused === true, s.paused);
    await shot('10-mobile-pause.png');

    const rowsFor = () => evalJS('TS.debug.pauseRows().map(r => ({id:r.id,y:r.y,h:r.h}))');
    const rowY = (rows, id) => {
      const row = rows.find(r => r.id === id);
      if (!row) throw new Error('missing pause row: ' + id);
      return row.y + row.h / 2;
    };

    let rows = await rowsFor();
    await tap(240, rowY(rows, 'settings'));
    s = await snap();
    assert('settings page opens from pause menu', s.pausePage === 'settings', s.pausePage);

    const settingsRows = await rowsFor();
    await tap(240, rowY(settingsRows, 'control'));
    s = await snap();
    assert('touch control row switches to joystick', s.controlMode === 'stick', s.controlMode);
    await tap(240, rowY(settingsRows, 'autoFire'));
    s = await snap();
    assert('auto fire can be disabled', s.autoFire === false, s.autoFire);
    await tap(240, rowY(settingsRows, 'back'));
    s = await snap();
    assert('settings back returns to pause main', s.pausePage === 'main', s.pausePage);
    await tap(240, rowY(rows, 'resume'));
    s = await snap();
    assert('touch resume row works', s.paused === false, s.paused);
    await shot('11-mobile-play.png');

    // Floating joystick: finger offset from origin drives movement while held.
    await evalJS('TS.debug.makeInvincible();');
    const stickRect = await rect();
    const sx = stickRect.x + stickRect.w * (130 / 480);
    const sy = stickRect.y + stickRect.h * (520 / 720);
    const beforeStick = (await snap()).player.x;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] });
    await sleep(100);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx + 90, y: sy }] });
    await sleep(600);
    s = await snap();
    const stickDelta = s.player.x - beforeStick;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    assert('floating joystick moves ship while held', stickDelta > 30, { from: beforeStick, to: s.player.x });
    const afterRelease = (await snap()).player.x;
    await sleep(400);
    s = await snap();
    assert('joystick stops on release', Math.abs(s.player.x - afterRelease) < 6, { afterRelease, now: s.player.x });

    // Manual fire button: must be held, and releasing stops new shots.
    const buttons = await evalJS('TS.debug.touchButtons()');
    const fire = buttons.fire;
    const fx = stickRect.x + stickRect.w * (fire.x / 480);
    const fy = stickRect.y + stickRect.h * (fire.y / 720);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fx, y: fy }] });
    await sleep(500);
    s = await snap();
    assert('touch fire button shoots while held', s.pBullets > 0, s.pBullets);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(1800);
    s = await snap();
    assert('releasing touch fire stops shooting', s.pBullets === 0, s.pBullets);
    await evalJS('TS.debug.setAutoFire(true);');

    // Fullscreen toggle row (only when the browser supports it).
    const fsSupported = await evalJS('!!document.fullscreenEnabled');
    await tap(460, 76);
    await sleep(200);
    rows = await rowsFor();
    await tap(240, rowY(rows, 'settings'));
    const fsRows = await rowsFor();
    const hasFsRow = fsRows.some(r => r.id === 'fullscreen');
    if (fsSupported && hasFsRow) {
      await tap(240, rowY(fsRows, 'fullscreen'));
      await sleep(600);
      const inFs = await evalJS('!!document.fullscreenElement');
      assert('fullscreen row enters fullscreen', inFs === true, { supported: fsSupported, inFs });
      if (inFs) {
        await evalJS('document.exitFullscreen().catch(() => {})');
        await sleep(600);
        const outFs = await evalJS('!!document.fullscreenElement');
        assert('fullscreen can be exited', outFs === false, outFs);
      }
    }
    await evalJS('TS.debug.setControlMode("drag");');
  } catch (e) {
    errors.push('SCRIPT ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
  }

  const failed = results.filter(x => !x).length;
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
