# 排行榜 Worker（Cloudflare Workers + KV）

可选组件。游戏不依赖它也能离线游玩；配置后会把全时间总榜同步到云端。

## 部署

```powershell
cd server
npx wrangler login
npx wrangler kv namespace create SCORES
```

把命令返回的 `id` 填进 `wrangler.toml` 的 `[[kv_namespaces]]`，然后：

```powershell
npx wrangler deploy
```

记下输出里的地址，例如 `https://thunder-strike-leaderboard.example.workers.dev`，把它写入
`public/js/config.js` 的 `CONFIG.leaderboard.endpoint`，重新发布静态站点即可。

## API

- `GET /scores?limit=50` → `{ ok, scores, total, updatedAt }`
- `POST /scores` → `{ ok, rank, total }`
  - Body: `{ id, name, score, sector, bossKills, graze, time }`
  - `name` 1–12 个字符，`score` 必须为正整数；`id` 可选，用于幂等重试。
- `GET /health` → `{ ok, updatedAt }`

榜单保存在单个 KV key `board:v1` 中，最多保留 100 条，读取时取前 50。写入采用读-改-写，
对休闲游戏足够；如果需要严格并发或防刷，建议再加 Durable Object 与限流。

## 本地预览

```powershell
cd server
npx wrangler dev
```

然后在浏览器控制台执行：

```js
TS.Leaderboard.setEndpoint('http://127.0.0.1:8787');
TS.Leaderboard.open();
```
