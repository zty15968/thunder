(() => {
  'use strict';
  // Leaderboard overlay. Works fully offline with the local profile board, and
  // syncs to a Cloudflare Worker when CONFIG.leaderboard.endpoint is set.
  const TS = window.TS = window.TS || {};
  const C = TS.CONFIG;
  const LCFG = C.leaderboard || {};
  const LIMIT = Math.min(100, Math.max(1, LCFG.limit || 50));
  const TIMEOUT = LCFG.timeout || 6000;

  const root = document.getElementById('lb');
  const listEl = document.getElementById('lb-list');
  const statusEl = document.getElementById('lb-status');
  const nickEl = document.getElementById('lb-nick');
  const closeEl = document.getElementById('lb-close');
  const saveEl = document.getElementById('lb-save');
  const refreshEl = document.getElementById('lb-refresh');

  let endpoint = String(LCFG.endpoint || '').replace(/\/+$/, '');
  let source = 'local';
  let remote = [];
  let statusText = '';
  let inflight = null;
  let flushing = false;
  let lastRefresh = 0;

  const fmt = n => String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fmtTime = s => {
    s = Math.max(0, Math.floor(s));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };

  function localRows() {
    return TS.Profile.current().localScores.slice(0, LIMIT);
  }

  function normalizeRemote(data) {
    const arr = data && Array.isArray(data.scores) ? data.scores : Array.isArray(data) ? data : [];
    return arr.slice(0, LIMIT).map((e, i) => ({
      rank: i + 1,
      name: typeof e.name === 'string' && e.name.trim() ? e.name.trim().slice(0, C.profile.nameMax) : '飞行员',
      score: Math.max(0, Math.floor(Number(e.score) || 0)),
      sector: Math.max(1, Math.floor(Number(e.sector) || 1)),
      bossKills: Math.max(0, Math.floor(Number(e.bossKills) || 0)),
      time: Math.max(0, Math.floor(Number(e.time) || 0))
    }));
  }

  function render() {
    if (!root || !listEl) return;
    const rows = source === 'remote' ? remote : localRows();
    listEl.textContent = '';

    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'lb-empty';
      li.textContent = '还没有记录，先出击一次吧。';
      listEl.appendChild(li);
    } else {
      for (let i = 0; i < rows.length; i++) {
        const e = rows[i];
        const li = document.createElement('li');
        li.className = 'lb-row';

        const rank = document.createElement('span');
        rank.className = 'lb-rank';
        rank.textContent = String(e.rank || i + 1);
        if ((e.rank || i + 1) <= 3) rank.classList.add('lb-top');

        const name = document.createElement('span');
        name.className = 'lb-name';
        name.textContent = e.name;

        const score = document.createElement('span');
        score.className = 'lb-score';
        score.textContent = fmt(e.score);

        const meta = document.createElement('span');
        meta.className = 'lb-meta';
        meta.textContent = 'SECTOR ' + e.sector + ' · BOSS ' + e.bossKills +
          ' · ' + fmtTime(e.time);

        li.appendChild(rank);
        li.appendChild(name);
        li.appendChild(score);
        li.appendChild(meta);
        listEl.appendChild(li);
      }
    }

    statusEl.textContent = statusText || (endpoint ? '全球排行榜' : '本地排行榜');
    if (nickEl && document.activeElement !== nickEl) {
      nickEl.value = TS.Profile.getName();
    }
  }

  function setStatus(text) {
    statusText = text;
    if (statusEl) statusEl.textContent = text;
  }

  function withTimeout(promise, ms) {
    if (!ms) return promise;
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        reject(new Error('timeout'));
      }, ms);
      promise.then(
        value => { if (!done) { done = true; clearTimeout(timer); resolve(value); } },
        err => { if (!done) { done = true; clearTimeout(timer); reject(err); } }
      );
    });
  }

  async function fetchJson(url, options, timeout) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const opts = Object.assign({ cache: 'no-store' }, options || {});
    if (ctl) opts.signal = ctl.signal;
    const req = fetch(url, opts);
    try {
      const res = await withTimeout(req, timeout || TIMEOUT);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally {
      if (ctl) {
        try { ctl.abort(); } catch (e) { /* ignore */ }
      }
    }
  }

  function postScore(entry, timeout) {
    return fetchJson(endpoint + '/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: entry.id,
        name: entry.name,
        score: entry.score,
        sector: entry.sector,
        bossKills: entry.bossKills,
        graze: entry.graze,
        time: entry.time
      })
    }, timeout);
  }

  async function flushPending() {
    if (!endpoint || flushing) return;
    const pending = TS.Profile.pending();
    if (!pending.length) return;
    flushing = true;
    try {
      for (const entry of pending) {
        try {
          await postScore(entry, Math.min(TIMEOUT, 3000));
          TS.Profile.removePending([entry.id]);
        } catch (e) {
          break;
        }
      }
    } finally {
      flushing = false;
    }
  }

  const Board = {
    endpoint() {
      return endpoint;
    },

    setEndpoint(url) {
      endpoint = String(url || '').replace(/\/+$/, '');
      lastRefresh = 0;
      return endpoint;
    },

    isOpen() {
      return !!root && !root.hidden;
    },

    open(opts) {
      if (!root) return;
      root.hidden = false;
      document.body.classList.add('lb-open');
      render();
      if (opts && opts.focusName && nickEl) {
        setTimeout(() => { try { nickEl.focus(); } catch (e) { /* ignore */ } }, 40);
      }
      if (endpoint) {
        flushPending().then(() => Board.refresh());
      } else {
        setStatus('本地排行榜 · 配置 Worker 后可全球同步');
        render();
      }
    },

    close() {
      if (!root) return;
      root.hidden = true;
      document.body.classList.remove('lb-open');
    },

    source() {
      return source;
    },

    rows() {
      return source === 'remote' ? remote.slice() : localRows();
    },

    statusText() {
      return statusText;
    },

    getNick() {
      return TS.Profile.getName();
    },

    setNick(raw) {
      const name = TS.Profile.setName(raw);
      if (nickEl) nickEl.value = name;
      setStatus(name ? '昵称已保存：' + name : '昵称已清空');
      render();
      return name;
    },

    async refresh() {
      if (!endpoint) {
        source = 'local';
        setStatus('本地排行榜 · 配置 Worker 后可全球同步');
        render();
        return { source, rows: localRows() };
      }
      if (inflight) return inflight;
      setStatus('正在同步排行榜…');
      render();
      inflight = (async () => {
        try {
          const data = await fetchJson(endpoint + '/scores?limit=' + LIMIT, { method: 'GET' });
          remote = normalizeRemote(data);
          source = 'remote';
          lastRefresh = Date.now();
          setStatus('全球排行榜 · TOP ' + LIMIT);
        } catch (e) {
          source = 'local';
          setStatus('离线 · 显示本地记录');
        } finally {
          inflight = null;
          render();
        }
        return { source, rows: source === 'remote' ? remote : localRows() };
      })();
      return inflight;
    },

    async submit(entry) {
      if (!entry) return { ok: false, error: 'empty' };
      if (!endpoint) return { ok: true, local: true };
      try {
        const data = await postScore(entry);
        setStatus('成绩已上传');
        await this.refresh();
        return { ok: true, data };
      } catch (e) {
        TS.Profile.queue(entry);
        setStatus('上传失败 · 已保存，联网后自动补交');
        render();
        return { ok: false, queued: true, error: String(e && e.message || e) };
      }
    },

    async flushPending() {
      await flushPending();
    },

    refreshAge() {
      return Date.now() - lastRefresh;
    }
  };

  if (root) {
    if (closeEl) closeEl.addEventListener('click', () => Board.close());
    if (saveEl) {
      saveEl.addEventListener('click', () => {
        Board.setNick(nickEl ? nickEl.value : '');
      });
    }
    if (nickEl) {
      nickEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          Board.setNick(nickEl.value);
        }
      });
    }
    if (refreshEl) {
      refreshEl.addEventListener('click', () => {
        Board.refresh();
      });
    }
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && Board.isOpen()) Board.close();
    });
    window.addEventListener('online', () => { flushPending(); });
    setTimeout(() => { flushPending(); }, 1500);
  }

  TS.Leaderboard = Board;
})();
