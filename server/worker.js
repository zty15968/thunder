// Cloudflare Worker + KV leaderboard for Thunder Strike.
//
// Bind a KV namespace named SCORES in wrangler.toml, then deploy. The whole
// board is stored under one key because a casual game has a small number of
// submissions; this keeps the Worker dependency-free and easy to audit.
//
// GET  /scores?limit=50  -> { ok, scores: [...], total, updatedAt }
// POST /scores           -> { ok, rank, total }
// GET  /health           -> { ok, updatedAt }

const KEY = 'board:v1';
const BOARD_MAX = 100;
const NAME_MAX = 12;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }, CORS)
  });
}

function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

function intIn(raw, min, max, fallback) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return n < min ? min : n > max ? max : n;
}

function validId(raw) {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 64 &&
    /^[A-Za-z0-9_-]+$/.test(raw);
}

async function readBoard(env) {
  const stored = await env.SCORES.get(KEY, 'json');
  if (!Array.isArray(stored)) return [];
  return stored.filter(e => e && typeof e === 'object');
}

function sortBoard(board) {
  board.sort((a, b) => b.score - a.score || a.at - b.at);
  return board.slice(0, BOARD_MAX);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'GET' && path === '/health') {
      return json({ ok: true, updatedAt: Date.now() });
    }

    if (request.method === 'GET' && path === '/scores') {
      if (!env.SCORES) return json({ ok: false, error: 'KV binding SCORES is missing' }, 500);
      const limit = intIn(url.searchParams.get('limit'), 1, 100, 50);
      const board = sortBoard(await readBoard(env));
      return json({
        ok: true,
        scores: board.slice(0, limit),
        total: board.length,
        updatedAt: Date.now()
      });
    }

    if (request.method === 'POST' && path === '/scores') {
      if (!env.SCORES) return json({ ok: false, error: 'KV binding SCORES is missing' }, 500);

      let raw;
      try {
        const text = await request.text();
        if (text.length > 4096) return json({ ok: false, error: 'payload too large' }, 413);
        raw = JSON.parse(text);
      } catch (e) {
        return json({ ok: false, error: 'invalid JSON' }, 400);
      }
      if (!raw || typeof raw !== 'object') return json({ ok: false, error: 'invalid body' }, 400);

      const name = cleanName(raw.name);
      if (!name) return json({ ok: false, error: 'nickname is required' }, 400);

      const score = intIn(raw.score, 0, 1e9, -1);
      if (score <= 0) return json({ ok: false, error: 'score must be positive' }, 400);

      const entry = {
        id: validId(raw.id) ? raw.id : 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
        name,
        score,
        sector: intIn(raw.sector, 1, 999, 1),
        bossKills: intIn(raw.bossKills, 0, 9999, 0),
        graze: intIn(raw.graze, 0, 1e7, 0),
        time: intIn(raw.time, 0, 86400, 0),
        at: Date.now()
      };

      const board = sortBoard(await readBoard(env));
      const existing = board.findIndex(e => e.id === entry.id);
      if (existing >= 0) {
        // Retries are idempotent; keep the better result if a client resubmits.
        if (entry.score > board[existing].score) board[existing] = entry;
      } else {
        board.push(entry);
      }
      sortBoard(board);
      await env.SCORES.put(KEY, JSON.stringify(board));

      const rank = board.findIndex(e => e.id === entry.id);
      return json({ ok: true, rank: rank < 0 ? null : rank + 1, total: board.length });
    }

    return json({ ok: false, error: 'not found' }, 404);
  }
};
