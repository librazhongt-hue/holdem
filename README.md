# 德州扑克 Web 小游戏（M1 引擎 + M2 单机）

```
npm i && npm run dev      # 开发
npm run build             # tsc 类型检查 + 构建到 dist/
npm test                  # Vitest 引擎单测 + AI 对战回归
npm run sim -- 1000 6 1   # 独立 AI 对战回归（手数 人数 seed）
npm run e2e               # 无头冒烟（需先 build；CHROME=浏览器路径）
```

## 模块划分（PRD 7.3）
- `src/engine/` 纯函数引擎：`reduce(state, action)`；`rng.ts` 种子 PRNG（mulberry32，状态在 `state.seed`）；`evaluator.ts` 牌力；`pots.ts` 边池/零头；`view.ts` **唯一视角过滤出口** `viewFor()`。
- `src/ai/` 规则型 AI（性格参数 + Chen 翻前表 + 翻后牌力/赔率），困难难度蒙特卡洛；输入只有 `PlayerView`。
- `src/net/protocol.ts` 联机层（M3 预留）：`HostAuthority` 按客户端逐个下发 `viewFor` 过滤快照 + 公开事件，**不下发 seed/牌堆**；按 (playerId, handNo, actionSeq) 去重。
- `src/app/` 应用层：会话统计、存档（localStorage）、AI 调度、场次。
- `src/ui/` React + CSS Modules；`src/styles/tokens.css` 为 Design Tokens，换皮只改此文件。

## AI 基准（`npm run bench -- [复式组数] [输出json]`）
每手重置 100BB；复式发牌（同一副牌 A/B 交换座位）+ 按钮轮转；以每组复式为独立样本给出 bb/100 的 95% CI。
多进程并行跑 6 个对局（单挑 / 6 人桌混合风格）+ 标准场 50BB 连续会话测重买率。风格统计只取 6 人桌。
基线与调优后结果见 `bench/baseline.md`、`bench/after.md`（原始数据 `.json`）。

## 联机（M3）
- 主菜单「联机对战」→ 创建房间（6 位房间码）或输入房间码加入；分享链接 `…/?room=123456` 会直接打开加入页。
- 房主浏览器为权威端（`src/net/protocol.ts` 的 `HostRoom`），客户端只收到 `viewFor` 过滤后的视角；不下发 seed / 牌堆 / 他人底牌。
- 信令：默认 PeerJS 公共服务器；可在「网络设置」或环境变量 `VITE_PEER_HOST/PORT/PATH/SECURE`、`VITE_TURN_URL/USER/PASS` 配置自建 peerjs-server（`npx peerjs --port 9000`）和 TURN。
- 调试参数：`?peer=host:port/path`、`?turn=…&turnUser=…&turnPass=…`、`?fast=1`、`?timeout=秒`、`?hostWait=毫秒`。
- 测试：`npm test`（含内存传输联机单测）、`npm run e2e:online`（3 个浏览器上下文打 50 手 + 断线重连 + 房主离线；`PEER=local` 使用本地信令；本机测试使用 `scripts/turn.cjs` 本地 TURN）。
