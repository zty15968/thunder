# 雷霆打击 · Thunder Strike

太空无尽弹幕小游戏，纯静态页面，无构建步骤。直接双击 `public/index.html` 即可游玩。

## 运行

- 直接打开：`public/index.html`
- 或启动本地静态服务器（推荐用于测试 Service Worker / 排行榜等联网功能）：

  ```powershell
  npm start
  # 或 node tools/serve.js 8080
  # 浏览器访问 http://127.0.0.1:8080/
  ```

## 操作

| 操作 | 键盘 | 触屏 |
| --- | --- | --- |
| 移动 | 方向键 / WASD | 拖拽画面 / 虚拟摇杆 |
| 聚焦低速 | Shift | 右下「焦点」按钮 |
| 开火 | 自动开火，或按住 J / Z | 自动开火，或按住右下「开火」按钮 |
| 炸弹 | 空格 | 右下「炸弹」按钮 |
| 暂停 | P / Esc | 右上角暂停按钮 |
| 静音 | M | 暂停 → 设置 |
| 开始 / 重开 | Enter / R | 点击画面 |

自动开火默认开启。暂停菜单 → 设置中可以关闭自动开火、切换「拖拽移动 / 虚拟摇杆」，设置会自动保存。

## 手机游玩

- 已适配触屏拖拽、浮动虚拟摇杆、多点按钮、DPR 高清渲染与动态视口高度。
- 触屏操作方式在暂停菜单 → 设置中切换；虚拟摇杆会在手指落点处生成，松手即停。
- 暂停菜单内含「全屏模式」，安卓/桌面浏览器可直接切换到全屏；iPhone Safari 不支持该 API 时会自动隐藏此项。
- 支持刘海屏安全区（`viewport-fit=cover` + `safe-area-inset-*`），可添加到主屏幕后以独立窗口运行。
- 已禁用页面缩放、滚动回弹与长按菜单，避免拖拽时误触。

## 文件结构

```
public/index.html           入口，按顺序加载脚本
public/thunder_strike.css   画布缩放、移动端与触屏样式
public/thunder_strike.js    游戏主循环、实体、碰撞、Boss、渲染、UI
public/js/config.js         全部数值配置（玩家/武器/敌人/Boss/星区/难度）
public/js/audio.js          WebAudio 音效与程序化 BGM
tools/                      本地静态服务器、语法检查与 headless 回归测试
```

加载顺序必须是 `config.js` → `audio.js` → `thunder_strike.js`，因为后两者依赖 `window.TS` 命名空间。新增脚本时同步更新入口与 `tools/check.js`。

## 调整数值

平衡性相关的内容都集中在 `public/js/config.js`：

- `CONFIG.player` / `CONFIG.bomb` / `CONFIG.missile`：玩家手感与资源
- `WEAPONS`：扩散机炮与激光的每级伤害、射速、弹道
- `ENEMY_TYPES`：普通敌人属性与弹幕节奏
- `BOSS_TYPES`：三种 Boss 的部件、血量与配色
- `SECTORS`：星区主题、背景配色与视觉元素
- `CONFIG.difficulty`：随 sector 增长的难度曲线
- `CONFIG.drops` / `CONFIG.carrier`：随机掉落概率、保底击杀数、掉落权重与补给舰间隔

修改配置不需要动逻辑代码。当前掉落设计刻意偏克制：普通小兵约每 100 次击杀产出 7 个道具（含数据核心），避免火力成长过快把杂兵战变成碾压。

武器细节：拾取异色火力会先升级备用武器，等备用武器等级追平当前武器后才会自动切换，因此稀有掉落不会造成突然的火力降级。

## 代码约定

- 经典脚本 + `window.TS` 命名空间，兼容 `file://`，不使用 ES module。
- 所有可调参数放入配置，逻辑代码只读配置。
- 渲染使用预生成的 glow sprite 与渐变缓存；实体数量有上限（见 `CONFIG.limits`）。
- 游戏时间步固定为 `1/60` 秒，带 hitstop / 慢动作。
- 版本号位于 `public/js/config.js` 的 `TS.VERSION`，需与 `package.json` 保持一致。

## 测试

```powershell
npm run check        # 语法 / 资源引用 / 版本一致性
npm run test:desktop # headless Edge 桌面回归（约 50 项）
npm run test:mobile  # headless Edge 390×844@3x 触屏回归
npm test             # 全部
```

测试使用本机 Edge/Chrome 的 CDP 接口，无 npm 依赖。可通过 `EDGE_PATH` 指定浏览器路径，`SMOKE_URL` 指向已运行的服务。

## 调试

`window.TS.debug` 暴露了只读快照与少量测试入口（`snapshot`、`spawnBoss`、`hurtBoss`、`killBossParts`、`pauseRows` 等），用于自动化冒烟测试，不影响正常游玩。
