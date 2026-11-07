(() => {
  'use strict';
  // Service workers need a secure context. file:// keeps working without one.
  const isHttp = location.protocol === 'https:' || location.protocol === 'http:';
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    window.navigator.standalone === true;

  if ('serviceWorker' in navigator && isHttp) {
    // The manifest is injected only for http(s): browsers reject it on file://.
    if (!document.querySelector('link[rel="manifest"]')) {
      const link = document.createElement('link');
      link.rel = 'manifest';
      link.href = './manifest.webmanifest';
      document.head.appendChild(link);
    }
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
    });
  }

  const btn = document.getElementById('install');
  if (!btn) return;

  let deferred = null;
  let visible = false;

  function setVisible(on) {
    if (on === visible) return;
    visible = on;
    if (on) {
      btn.hidden = false;
      requestAnimationFrame(() => btn.classList.add('show'));
    } else {
      btn.classList.remove('show');
      setTimeout(() => { if (!visible) btn.hidden = true; }, 260);
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferred = event;
    setVisible(true);
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    setVisible(false);
  });

  btn.addEventListener('click', async () => {
    if (!deferred) return;
    const prompt = deferred;
    deferred = null;
    setVisible(false);
    try {
      prompt.prompt();
      await prompt.userChoice;
    } catch (e) { /* dismissed */ }
  });

  // Keep the button off the playfield: only the title / game-over screens show it.
  setInterval(() => {
    if (!deferred || standalone) return;
    const state = window.TS && typeof window.TS.getState === 'function'
      ? window.TS.getState()
      : 'title';
    setVisible(state !== 'play');
  }, 600);
})();
