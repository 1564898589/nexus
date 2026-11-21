# NEXUS 调研报告：HOWL / sylqon 开源项目 + 海克斯大乱斗（ARAM Mayhem）强化官方资料源

- 调研日期：2026-11-19（所有 HTTP 实测均于当日完成）
- 调研方式：纯只读。GitHub 网页/raw/API 经 WebFetch 获取；ddragon.leagueoflegends.com 与 raw.communitydragon.org 经 curl 实测。未向项目复制任何代码。
- 样本目录：`tools/research/samples/cdragon/`（清单见文末）
- 安全红线：NEXUS 禁止屏幕截图 / OCR / 游戏画面识别 / 读游戏内存 / 注入。凡涉及这些的内容在本报告中一律标注「存在但禁止采用」。

---

## 一、许可证结论表

| 仓库 | LICENSE | 证据 | 结论 |
|---|---|---|---|
| AH228589/howl | **无许可证**（GitHub API `"license": null`；文件树中无 LICENSE 文件） | api.github.com/repos/AH228589/howl；git/trees/main?recursive=1 | 默认版权保留（All rights reserved）。**只能借鉴思想，禁止复制任何代码/数据文件进 NEXUS**。其 `data/community/mayhem-reference.json` 为作者汇编的第三方 tier 数据（来源见该文件 sources 字段），同样无授权，仅可参考其「多来源汇编+标注出处」的做法 |
| imperasus/sylqon | **MIT**（GitHub API `"license":{"spdx_id":"MIT"}`；根目录 LICENSE 文件 1087 字节） | api.github.com/repos/imperasus/sylqon；文件树含 LICENSE | MIT 允许复用（需保留版权声明），但本次任务约定只借鉴思想不复制代码，故按「思想借鉴」处理 |
| CommunityDragon/Docs | 文档仓库（README/assets.md/binfile.md/wad.md 四个文件） | api.github.com/repos/CommunityDragon/Docs/git/trees/master | 文档可自由引用。raw.communitydragon.org 数据是 Riot 游戏文件的社区镜像，**非 Riot 官方授权发布**，用于个人工具属社区惯例（HOWL、sylqon、metasrc 均如此使用），商用需自行评估 Riot 政策 |
| Data Dragon (ddragon.leagueoflegends.com) | Riot 官方静态数据 CDN | developer.riotgames.com/docs/lol（HOWL/sylqon 均引用） | 官方公开数据，可合法使用 |

维护状态：

| 仓库 | 创建 | 最近 push | stars/forks | 语言 | 判断 |
|---|---|---|---|---|---|
| howl | 2026-10-23 | 2026-10-24 | 0 / 0 | JavaScript (Electron) | 极新的单人项目，一次性密集提交，README 完整、带测试与 fake-client，但社区验证少 |
| sylqon | 2026-06-16 | 2026-07-21 | 2 / 2 | Python (+React/TS) | 持续开发约 1 个月后停更近 4 个月；有 CI、auto-release、543 个离线测试（README 自述），工程化程度高 |

---

## 二、方向 1A：HOWL（海克斯助手）

### 2.1 README 要点（原文证据：raw.githubusercontent.com/AH228589/howl/main/README.md）

- 定位：「A desktop companion for League of Legends **ARAM: Mayhem**」，三个场景：
  1. **选人阶段**：给自己的英雄、板凳席、队友英雄（供交换）打 tier 分并给理由；把出装写成客户端 item set，可设置召唤师技能。
  2. **局内**：overlay 显示下一个技能加点、下一件装备（按敌方阵容调整，如反治疗/穿甲）、出装进度、双方装备经济差。
  3. **强化卡**：「HOWL reads their names off the screen and puts a tier badge over each card」——**屏幕 OCR 读强化卡名（NEXUS 禁止采用）**。
- 另有：全英雄出装浏览器、完整 Mayhem 强化池浏览器、来自对局历史的个人战绩、每局赛后简评。
- 数据来源表（README 原文）：
  | 数据 | 来源 |
  |---|---|
  | 英雄/装备/召唤师技能 | Riot Data Dragon，每版本刷新 |
  | Mayhem 强化池、名称、文本 | 「Riot game data via CommunityDragon (mode `KIWI`)」 |
  | 社区 tier | `data/community/mayhem-reference.json`（公开 tier 榜汇编，来源在文件内） |
  | 自己的对局+其他九人出装 | 客户端 match history，本地保存以突破客户端约 20 局上限 |
  | 自己的加点/购买顺序 | 局内从 Riot Live Client Data API 实时记录 |
  | 全局 ARAM 出装/首件/加点 | Riot match-v5 API（queue 450，本人 key） |
- 关键限制（README 原文）：「Riot keeps Mayhem match data private on its public API」——**Riot 公开 API 不开放 Mayhem 对局数据**，全局统计只能借普通 ARAM（queue 450，同地图）近似。
- 合规自述（README「Rules HOWL follows」）：只用 LCU、官方 Live Client Data API 和**一张屏幕截图读强化名**；不碰游戏文件/内存、不自动化输入；「It never shows augment win rates: Riot's developer policy forbids apps from displaying them」——**Riot 开发者政策禁止展示强化胜率**，只展示 tier 与理由；多选项并列展示，不替玩家做决定。
- 运行要求：游戏须无边框/窗口化（overlay 置顶）；热键 Ctrl+Shift+H 显隐 overlay，Ctrl+Shift+J 手动重扫强化卡并把截图+OCR 文本存 `%APPDATA%\howl\scans`（**禁止采用**）。

### 2.2 技术栈与结构

Electron（主进程 Node.js，无框架 renderer：app.js/overlay.js 原生 JS + CSS），`ws` 库连 LCU WebSocket，测试用 fake-league client（test/fake-league.js）。目录：`src/main/{engine,ocr,stats}`、`src/renderer`、`data/`、`shared/aram-stats.json`（共享全局统计，309KB）、`scripts/{snapshot.js,publish-stats.js}`。

### 2.3 英雄攻略/推荐结构（engine/）

- `engine/profile.js`：从英雄技能描述推断角色（Marksman/Mage/Assassin/Fighter/Tank/Enchanter）、伤害类型（ap/ad/mixed）、是否 onHit/healer/tanky 等画像。
- `engine/champions.js`（原文已核）：选人评级 = `社区tier值*0.8 + 队伍补缺(comp) + 个人战绩修正(you) + 0.1`。
  - 社区 tier 来自 mayhem-reference.json 的 `champions`（英雄名→S/A/B/C/D）；TIER_VALUE = {S:1, A:0.8, B:0.6, C:0.4, D:0.2}。
  - 队伍补缺：无前排 +0.1（坦克/半肉）、缺魔法伤害 +0.08、缺物理伤害 +0.08、无治疗/护盾 +0.05，每项附理由文本。
  - 个人战绩：贝叶斯收缩 `((wins+2)/(games+4)-0.5)*0.4`，至少 2 场才计入。
- `engine/items.js` / `engine/skills.js`：出装与加点推荐，输入 = 英雄画像 + 敌方画像 + 已购装备 + 本地记录池 + 全局 ARAM 统计（shared/aram-stats.json）。
- `engine/augments.js`（强化评级，原文已核）：
  - 用正则 TAGS 从强化**描述文本**提取标签（ap/ad/as/crit/onhit/haste/ult/ally/heal/shield/hp/resist/ms/mana/vamp/tenacity/melee/ranged/summoner）；特判「cannot use your Ultimate」是代价不是 synergy。
  - `wants(profile)` 按角色生成权重表；近战-only 强化给远程英雄 fit=0.1，反之 0.15。
  - 总分 `score = 0.45*社区tier值 + 0.45*契合度fit + 套装进度set + 个人记录修正personal`；personal 用贝叶斯收缩 `((wins+3)/(picks+6)-0.5)*0.4`（≥3 次选取才计入），**只做微调，绝不显示胜率**。
  - 每个评级输出 reasons 数组（「Fits your …」「Community tier S」「Starts X set」等），best 标记最高分。

### 2.4 海克斯（Mayhem）数据库结构 —— 核心可借鉴点

`src/main/gamedata.js`（原文已核）定义常量：

```
DDRAGON = 'https://ddragon.leagueoflegends.com'
CDRAGON = 'https://raw.communitydragon.org/latest'
CDRAGON_DATA = `${CDRAGON}/plugins/rcp-be-lol-game-data/global/default`
MAYHEM_MODE = 'KIWI'   // ARAM: Mayhem 的内部模式名
```

下载流程（download()）：
1. `GET {DDRAGON}/api/versions.json` 取最新版本号；
2. 并行下载：`championFull.json`、`item.json`、`summoner.json`（均 en_US）+ **`{CDRAGON_DATA}/v1/cherry-augments.json`**（全部强化，含 Arena 与退役 Mayhem 强化）+ **`{CDRAGON_DATA}/v1/augment-lists.json`**（按模式分池）；
3. 再下载 **`{CDRAGON}/game/en_us/data/menu/en_us/lol.stringtable.json`**（游戏字符串表，强化描述文本在此）。

强化归一化（normalizeAugments）：
- 在 augment-lists.json 中找 `modeName === 'KIWI'` 的池；池内条目形如 `Maps/ModeSpecificData/Augments/ARAM_BigBrain`，取最后一段为 `augmentNameId`；
- 用 augmentNameId 关联 cherry-augments.json 条目，输出字段：`{id, nameId, name: a.nameTRA, rarity: {kSilver:'silver',kGold:'gold',kPrismatic:'prismatic'}[a.rarity], desc, icon}`；
- **描述文本解析**：stringtable 键格式 `<mode>_<augment>_<kind>`（mode=kiwi/cherry，kind=name/summary/tooltip/description/desc）。因键中的 augment 部分不一定等于 nameId，HOWL 用「squash」（小写、去 kiwi_/cherry_/aram_ 前缀、去非字母数字）建索引，并按显示名反查；模板值 `@Damage@` 替换为 X，`{{key}}` 递归展开（深度≤2），HTML 标签剥离；
- 图标 URL 映射：`cdragonAsset(p)` = 把 `/lol-game-data/assets/` 前缀去掉、**整路径转小写**，拼到 `{CDRAGON_DATA}/` 后（与 CommunityDragon Docs/assets.md 官方映射规则一致）；
- 另存 `augmentArchive`（cherry-augments 全量 600 条的 id/name/icon/rarity），保证旧对局里退役强化仍能显示名字图标。

### 2.5 对局记录（stats/store.js，原文已核）

- **Mayhem 队列 ID：`MAYHEM_QUEUES = new Set([2400, 2401])`**（2400=Mayhem 常规，2401=Mayhem 相关变体；来自源码常量）。
- 同步端点：`GET /lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=50`，过滤 queueId∈{2400,2401}，再逐局 `GET /lol-match-history/v1/games/{gameId}` 取全量十人数据（每局间隔 250ms）。
- 本地 JSON 库 `{version:1, games:{}, live:{}}`；每局记录：gameId/created/duration/version/platform/queue/myChamp/myWin + 十人 participants（puuid、name#tag、champ、team、win、items[6]、**augments = stats.playerAugment1..6**、spells、k/d/a、dmg/taken/healed）。
- `live` 记录局内实时笔记：skillSeq（加点序列）、itemOrder（购买顺序）、offers（每次强化候选）、picks（实际选取）——来自 Live Client Data API 轮询 + OCR 选卡推断（后者禁止采用）。
- 聚合：按英雄的物品/召唤师技能 picks-wins、按角色的强化 picks-wins、个人加点优先级；全部本地懒加载重建。
- 客户端只保留约 20 局，本地库持续增长（README 明示）。

### 2.6 赛后复盘（session.js postGame，原文已核）

- 触发：gameflow 进入 EndOfGame/PreEndOfGame/WaitingForStats；因对局入库有延迟，按 5s/15s/30s/60s 重试同步。
- 复盘内容：本局 KDA/伤害/团队伤害占比、逐件装备标注「是否 HOWL 建议」（matched/total 计数）、所选强化（名字/图标/稀有度）、建议出装对照、加点序列。纯数据对比，无 LLM。

### 2.7 数据更新机制

- `gamedata.load()`：先读磁盘缓存/内置快照 → 请求 versions.json，**版本号一致直接用缓存**；不一致才全量重下并写缓存；下载失败回退缓存（离线可用）。
- `scripts/snapshot.js`：开发者手动 `npm run snapshot` 刷新随包内置的 data/gamedata.json（733KB），并报告「无描述文本的强化」清单。
- `scripts/publish-stats.js` + `stats/publish.js`：把本人收集的全局 ARAM 统计（仅计数，不含 key/玩家 id）发布回仓库 shared/aram-stats.json，其他用户免 key 下载——「一人采集、众人共享」模式。
- Riot API key 可选：仅采集者需要；后台最多每 6 小时采集一次；开发 key 24h 过期有提示。

### 2.8 HOWL 的 LCU 端点清单（源码原文）

| 端点 | 方法 | 出处 |
|---|---|---|
| `/lol-summoner/v1/current-summoner` | GET | lcu.js（连接握手）、session.js |
| `/lol-gameflow/v1/gameflow-phase` | GET | session.js |
| `/lol-gameflow/v1/session` | GET | session.js（取 queueId/gameId） |
| `/lol-champ-select/v1/session` | GET | session.js |
| `/lol-champ-select/v1/session/my-selection` | PATCH | session.js（设置召唤师技能） |
| `/lol-lobby/v2/lobby` | GET | session.js |
| `/lol-matchmaking/v1/ready-check/accept` | POST | session.js（自动接受，设置项） |
| `/lol-item-sets/v1/item-sets/{summonerId}/sets` | GET/PUT | session.js（item set 导入，标题前缀 `HOWL `，按前缀清理旧集合） |
| `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=50` | GET | stats/store.js |
| `/lol-match-history/v1/games/{gameId}` | GET | stats/store.js |
| `/riotclient/region-locale` | GET | session.js（区域路由推断） |
| WebSocket `wss://127.0.0.1:{port}/`，订阅 `[5,'OnJsonApiEvent']`（全量事件） | WS | lcu.js；session.js 按 uri 分发：gameflow-phase / champ-select session / ready-check / lobby |

认证：lockfile（`LeagueClient:PID:port:password:https`）或 PowerShell 读 LeagueClientUx.exe 命令行 `--app-port` / `--remoting-auth-token`；Basic `riot:{token}`；自签证书 rejectUnauthorized:false。

### 2.9 HOWL 中「存在但禁止采用」的部分（NEXUS 红线）

| 模块 | 行为（原文证据） | 处置 |
|---|---|---|
| `src/main/ocr/reader.js` | 文件头注释：「captures the middle of the screen every so often, reads the text with Windows' built-in OCR」；用 Electron `desktopCapturer.getSources({types:['screen']})` 截屏，裁剪中央区域 REGION={x:0.08,y:0.12,w:0.84,h:0.62}，缩到 ≤1600px，交 PowerShell worker OCR；1.5s 轮询（有卡时 500ms）；卡片消失时按**鼠标光标位置**推断玩家选了哪张（screen.getCursorScreenPoint，120ms 采样） | **禁止采用**（屏幕截图+OCR+画面识别） |
| `src/main/ocr/ocr-worker.ps1` | Windows 内置 OCR（WinRT）PowerShell worker，stdin/stdout JSON 行协议，12s 超时重启 | **禁止采用** |
| `src/main/ocr/match.js` | OCR 文本行→强化名模糊匹配索引 | **禁止采用**（依赖 OCR 输入） |
| 热键 Ctrl+Shift+J 扫描存档（%APPDATA%\howl\scans 截图+文本） | README | **禁止采用** |
| `test/shots.js`、e2e 截图 | 测试截图 | 禁止采用 |
| overlay 悬浮窗本身 | 透明置顶窗口显示建议 | 不违反红线（不读画面），但 HOWL 的强化卡定位叠加依赖 OCR 坐标，NEXUS 若做 overlay 只能显示静态建议列表，不能做「卡上贴徽章」 |

注意：HOWL 的**强化评级引擎本身不依赖 OCR**——输入只是强化 id 列表。NEXUS 可借鉴评级思想，候选 id 改由玩家手动点选/键盘选择提供（合法替代路径）。

---

## 三、方向 1B：sylqon（本地 LoL 助手）

### 3.1 README 要点（原文证据：raw.githubusercontent.com/imperasus/sylqon/master/README.md）

- 定位：「Local League of Legends draft assistant — counter-pick, build generation, in-game overlay」。监视选人阶段，从个人英雄池推荐counter-pick，针对敌方五人阵容生成装备/符文/召唤师技能，全员锁定后自动导入客户端。
- 架构自述：「LCU WebSocket + op.gg 当前版本 meta 出装 + **本地 Ollama LLM** 做 counter 分析。Everything runs on your machine; no account credentials ever leave it.」
- 三屏仪表盘（http://127.0.0.1:8077）：Dashboard（英雄池+个人胜率+Meta Scout+op.gg tier 榜）、Live Draft（三列实时选人板+AI 推荐）、Runes & Items（锁定后出装顺序/符文电路/AI 解释）。
- 安全护栏（README「Safety & guardrails」）：幂等注入（永远只有一个名为 "Sylqon Meta" 的 item set/符文页，PUT 覆盖）；**AI 只做过滤**——所有 AI 输出字段对照静态合法表校验，非法即回退确定性出装；召唤师技能保守（只允许 op.gg 观察到的技能）；全员锁定才注入；优雅降级（无 Ollama→启发式，无 op.gg→种子出装，无 WS→轮询）。
- 局内 overlay coach：**严格只读**，只 GET Riot Live Client Data API（`https://127.0.0.1:2999/liveclientdata/allgamedata`），显示 1–2 个「任务」（如 2 分钟不死、4 分钟拿龙）；任务由本地 LLM 在**局末**根据赛后数据生成（结构化+校验，非自由文本），绝不阻塞局内路径；TLS 用 Riot 自带 CA（sylqon/data/riotgames.pem）校验。
- 测试：543 个离线测试（README 自述），tests/ 目录覆盖注入护栏、AI 输出校验、状态差分等。

### 3.2 技术栈

Python 3.11+（FastAPI + requests + websocket-client）；前端 React + Vite + Tailwind v4 + @tanstack/react-query；桌面壳 Electron + TypeScript（sylqon-desktop/，PyInstaller 打包 Python 后端为 sylqon-server）；另有 sylqon-overlay-shell（独立 overlay 壳）、services/ingestion-svc（Docker 化采集服务，Caddy/Redis）。

### 3.3 LCU 接口用法 —— 源码中出现的具体端点（已逐文件核对原文）

**连接与认证（lcu/client.py）**：lockfile 格式 `LeagueClient:PID:port:password:https`；失败则 PowerShell `Get-CimInstance Win32_Process -Filter "Name='LeagueClientUx.exe'"` 读命令行 `--app-port=(\d+)`、`--remoting-auth-token=([\w-]+)`；`https://127.0.0.1:{port}`，Basic riot:token，verify=False；**请求体用紧凑 JSON（separators=(",",":"), ensure_ascii=False）规避 LCU ~64KB  body 上限（413）**。

| 端点 | 方法 | 出处文件 | 用途 |
|---|---|---|---|
| `/lol-summoner/v1/current-summoner` | GET | client.py | 握手/当前召唤师 |
| `/lol-gameflow/v1/gameflow-phase` | GET | client.py | 阶段看门狗 |
| `/lol-item-sets/v1/item-sets/{summonerId}/sets` | GET + PUT | injector.py | 幂等覆盖标题为 config.PROFILE_TITLE 的 item set；413 时提示清理旧集合 |
| `/lol-perks/v1/pages` | GET + POST | injector.py | 符文页列表/新建 |
| `/lol-perks/v1/pages/{pageId}` | PUT | injector.py | 覆盖同名页；页数满时复用可编辑页 |
| `/lol-champ-select/v1/session/my-selection` | PATCH | injector.py | 设置 spell1Id/spell2Id |
| `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex={b}&endIndex={e}` | GET | history.py | 本人对局分页（每页 20；**按 gameId 去重**，某些客户端忽略分页参数时「本页无新增即停」） |
| `/lol-match-history/v1/products/lol/{puuid}/matches` | GET | history.py（puuid_matches_path）、scout.py | 他人战绩侦察 |
| `/lol-ranked/v1/current-ranked-stats` | GET | ranked.py | 本人段位（queueMap.RANKED_SOLO_5x5 / RANKED_FLEX_SR），只读 |
| `/lol-game-data/assets/v1/items.json` | GET | data/catalog.py（supplement_from_lcu） | **LCU 本地装备目录补充 Data Dragon 缺失的新装备**（~1MB+，30s 超时；字段 id/name/inStore/categories/to/priceTotal/description） |

**WebSocket 事件（lcu/events.py，WAMP 子集：发 [5,topic] 订阅、[6,topic] 退订、收 [8,topic,{data,eventType,uri}]）**：
- `OnJsonApiEvent_lol-champ-select_v1_session`（选人会话）
- `OnJsonApiEvent_lol-lobby_v1_lobby`（大厅）
- `OnJsonApiEvent_lol-end-of-game_v1_eog-stats-block`（赛后统计块）
- `OnJsonApiEvent_lol-gameflow_v1_gameflow-phase`（阶段，data 是裸字符串如 "ChampSelect"/"InProgress"/"EndOfGame"）

单连接多路复用（LcuEventBus），断线 1s 退避重连并全量重订阅；回调在 WS 线程执行，重活由 runtime 状态差分（display signature 滤掉计时器 tick；trigger signature 只在锁定/轮到自己时触发）+ 后台线程处理。进入选人时先 REST 拉全量 session 种子（WS 只推 delta）。

### 3.4 OP.GG 接入（cache/opgg_fetch.py，原文已核）

- URL 模板：`https://lol-api-champion.op.gg/api/{region}/champions/ranked/{cid}/{pos}`（region 默认 na；pos ∈ TOP/JUNGLE/MID/ADC/SUPPORT）。
- 请求头：`User-Agent: Mozilla/5.0`、`Accept: application/json`；requests.Session 连接池（pool_maxsize=16）；超时 12s、重试 2 次指数退避（仅超时/断连/5xx 重试；4xx/坏 JSON 不重试）；**任何失败返回 None → 回退种子出装**。
- 响应 `data` 字段：core_items（三件套排列，**按物品集合合并排列置换、累加 play/win**，取前 4 组）、boots、starter_items、summoner_spells（前 4 组合的并集作为 AI 唯一可选技能集）、runes（primary_page_id/primary_rune_ids/secondary_page_id/secondary_rune_ids/stat_mod_ids，前 4 页）、last_items（单件选取率榜→situational pool 前 6）。
- 另有 meta tier 榜接口（README：「per-role meta tier list」，同域名内部 API）；`POST /api/opgg-build` 可接收 MCP 工具抓来的 payload 入缓存。
- README 明示：「The op.gg internal API is undocumented and may change; the seed build is the safety net」——**非官方接口，有失效风险**。

### 3.5 Data Dragon / CommunityDragon 接入（data/catalog.py + ui/src/api.js，原文已核）

- `GET https://ddragon.leagueoflegends.com/api/versions.json` → versions[0] 为当前补丁；
- `GET {DDRAGON}/cdn/{patch}/data/en_US/champion.json`、`item.json`；磁盘缓存 TTL 12h，后台调度刷新，局内路径纯本地读；
- **DDragon ID 纠错表**（16.x 版本 bug）：667666→6676（Collector）、323075→3075（Thornmail）、323110→3110（Frozen Heart）、323222→3222（Mikael's）；每次加载缓存都自愈式修正；
- 装备过滤：maps["11"]（召唤师峡谷）、gold.purchasable、排除 Trinket/Consumable、成装判定（鞋≥300g 或 ≥900g 且无 into）；
- LCU 补充：`/lol-game-data/assets/v1/items.json`（见上表），只补 DDragon 没有的 id；README 提醒 LCU 目录返回**客户端本地化语言**的装备名（如匈牙利语），id 正确即可注入；
- 前端符文图标（ui/src/api.js）：`CDRAGON = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/"`，拉 `v1/perks.json`、`v1/perkstyles.json`，iconPath 映射 `CDRAGON + p.toLowerCase().replace("/lol-game-data/assets/","")`——与 HOWL/CDragon 文档同一规则。

### 3.6 本地 AI 分析架构（ai/engine.py 等，原文已核）

- Ollama：`POST {OLLAMA_URL}/api/generate`（默认 http://127.0.0.1:11434），body `{model, prompt, stream:false, format:"json", options}`；**确定性参数：temperature=0、top_k=1、固定 seed、紧 num_predict 预算**（config.OLLAMA_OPTIONS）；`GET /api/tags` 探活并把 `llama3.1` 解析到已安装的 `llama3.1:8b`；超时 45s；剥 ```json 围栏后解析；**任何失败返回 None → 确定性出装兜底，AI 永不阻塞注入**。
- 提示词分工：ai/prompts.py（counter 出装+战术/符文 doctrine）、ai/pick_prompt.py（英雄推荐打分+提示）、ai/mission_prompt.py（局末生成结构化任务）、ai/match_review.py（赛后复盘）、ai/macro_coach_prompt.py（宏观教练）、ai/build_variants.py（多变体出装）。
- 校验：loadout.py 把 AI 每个字段对照 data/static.py 的合法符文/技能/装备表校验，非法回退；「AI as a filter only」。
- 另有 rag/ 目录（embed.py、item/kit/rune 的 index+retrieve）——本地检索增强，把装备/技能/符文知识注入提示。
- 启发式先行：推荐先给即时启发式结果，Ollama 后台精炼（前端 useScout 见 source==="heuristic" 时每 4s 再poll 直到升级）。

### 3.7 本地服务与前端通信（server.py + ui/src/api.js，原文已核）

- FastAPI 桥接 :8077，serve 构建后的 ui/dist + JSON API；runtime 跑后台线程。
- **通信方式 = HTTP 轮询（react-query），无 SSE/WebSocket 到前端**。自适应间隔（api.js 原文）：`POLL_ACTIVE_MS=1500`（选人/局内）、`POLL_IDLE_MS=4000`（空闲首页）、`POLL_SLOW_MS=30000`（战绩/教练等慢数据）；retry:false、refetchOnWindowFocus:false（下一 tick 自然恢复）。
- 端点（README + api.js 合并）：`GET /api/state`（全量运行时快照，主轮询）、`/api/champions`、`/api/champions/role/{role}`、`/api/champions/{id}/details`、`/api/meta`、`/api/benchmarks`、`GET/PUT /api/pool`（乐观更新+失败回滚）、`/api/champion-stats`、`/api/scout?role=`、`/api/coach`、`POST /api/coach/refresh`、`/api/matches/recent?limit=`、`/api/matches/{id}/analysis`、`/api/pro-builds`、`GET/PUT /api/settings`、`POST /api/inject`、`/api/inject/variant`、`POST/DELETE /api/demo`（合成大厅模拟）、`/api/sync/full`、`POST /api/opgg-build`、`/api/live/state`、`/api/overlay/state`、`POST/DELETE /api/live/demo`、`POST /api/overlay/debug/reset`；overlay 页 `/overlay`（OBS browser source 可用）。
- 错误处理：apiFetch 对非 2xx 抛带上下文的错；logApiError 统一记日志；UI 显示离线横幅而非空白。
- Electron 壳（sylqon-desktop/src/main/backend.ts 等）：spawn PyInstaller 后端、健康检查、loading/backend-down 静态页、托盘、自动更新。

### 3.8 sylqon 中「存在但禁止采用」/需注意的部分

- 无截图/OCR/内存读取（README 与已核源码均未出现；overlay 明确「only ever performs HTTP GET」against Live Client Data API）。
- **自动注入（item set/符文页/技能 PATCH）与自动接受类写操作**：sylqon 的 injector 属 LCU 写操作。NEXUS 红线禁止「注入」——若该红线涵盖 LCU 写操作，则 injector 整套**禁止采用**；若仅指游戏进程注入，LCU 写操作仍属 Riot 不支持的灰色自动化（sylqon README 自认「Automating client interactions can carry risk」）。建议 NEXUS 默认只读，导入功能做成用户显式触发的可选项并自行评估政策。
- op.gg 内部 API 未公开文档，抓取属第三方 ToS 灰色地带，借鉴时以「缓存+种子兜底」思想为主，不依赖其长期可用。

---

## 四、可借鉴设计清单（只借鉴思想，不复制代码）

来自 HOWL：
1. **强化数据三段式拼装**：模式池（augment-lists 的 KIWI）× 强化全量表（cherry-augments）× 本地化字符串表（stringtable），用 squash 键模糊关联 + 显示名反查，容忍 Riot 键名不一致。
2. **版本号为缓存键**：versions.json[0] 与缓存 version 一致则零网络请求；失败回退缓存/内置快照，离线可用。
3. **augmentArchive 全量归档**：保留退役强化 id→名/图标，历史对局永不显示「Unknown augment」。
4. **强化评级 = 社区tier + 描述文本标签契合度 + 套装进度 + 个人记录贝叶斯微调**，全程不显示胜率（Riot 政策），每项附人类可读理由；多选项并列、不替玩家决定。
5. **描述文本→标签正则**（含「cannot use ultimate」代价特判、近战/远程硬约束）是无 AI 也能跑的契合度引擎。
6. **本地对局库突破客户端 20 局上限**：queueId 过滤（Mayhem=2400/2401）+ 逐局详情 + gameId 幂等 + 十人全量数据；局内 Live Client Data API 记录加点/购买/强化候选序列，局末合并。
7. **赛后复盘 = 实际出装 vs 建议出装逐件对照**（matched/total、伤害占比），纯数据、可解释。
8. **一人采集众人共享**：全局统计仅计数、不含 key/id，发布回仓库供免 key 用户下载。
9. **英雄评级考虑队伍补缺**（前排/双伤害类型/保护）+ 个人熟练度收缩。
10. fake-client 测试思想：LCU/Live API 全部可伪造，引擎纯 Node 可单测。

来自 sylqon：
11. **LCU 事件总线**：单 WS 多 topic 复用、自动重连重订阅、REST 种子 + WS delta、双签名状态差分（显示签名滤 tick、触发签名只在锁定/轮到自己时启动重活）。
12. **AI 只做过滤器**：确定性候选先行 → LLM 精炼（temperature=0/固定 seed/format=json）→ 逐字段对照合法表校验 → 非法回退；任何依赖缺失都优雅降级，永不阻塞主路径。
13. **自适应轮询**（1.5s 活跃 / 4s 空闲 / 30s 慢数据）+ 统一 fetch 错误层 + 乐观更新回滚；前端无需 WS 也能做到低延迟感。
14. **幂等注入护栏思想**（若 NEXUS 允许显式用户触发的 LCU 写）：单一固定标题、PUT 覆盖不累积、64KB 紧凑 JSON、页满复用可编辑页、技能槽位互斥校验。
15. **DDragon ID 纠错表 + 加载时自愈**；LCU items.json 补充新装备（注意本地化名称问题，以 id 为准）。
16. **op.gg 三件套排列合并**（按集合合并置换、累加样本）得到真实热度；技能候选限定为「op.gg 观察到的并集」。
17. **局末生成结构化任务/复盘**（封闭类型+参数词表，可被引擎校验 scoring），局内只读、慢 AI 不阻塞。
18. 英雄池/熟练度/侦察指纹（scout.py：按角色归一化的攻击性/发育/游走阈值、one-trick 占比、autofill 判定）——纯统计画像思想。

---

## 五、方向 2：ARAM Mayhem 强化的官方资料源（全部实测）

### 5.1 结论速览

- **CommunityDragon 有完整 KIWI（ARAM Mayhem）强化数据，且有简体中文本地化**：中文名在 `global/zh_cn/v1/cherry-augments.json`（实测 200，600 条中 599 条 nameTRA 与英文不同，即全量翻译）；中文效果描述在 zh_cn 游戏字符串表（实测 200，33MB，1302 个 kiwi_ 键）。
- **Data Dragon 没有 augments 数据**（cherry-augments.json / arena-augments.json 均 403/不存在）；versions.json 可达，最新 16.23.1；英雄/装备/技能有官方 zh_CN 数据（实测 200）。
- **Riot 官方 LCU 强化资料端点：未找到直接证据，标「待验证」**（详见 5.5）。
- 图标与语言无关，`global/default` 路径即可（大小写不敏感规则：全小写）。

### 5.2 可直接下载的 URL（curl 实测结果，2026-11-19）

| # | URL | 实测 | 内容 |
|---|---|---|---|
| 1 | `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/augment-lists.json` | **200，24,069 B** | 三个模式池：`CHERRY`（Arena，57 条）、**`KIWI`（ARAM Mayhem，243 条）**、`KIWI_JADE`（188 条，Mayhem 变体池）。条目为路径串 `Maps/ModeSpecificData/Augments/ARAM_BigBrain` |
| 2 | `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json` | **200，224,173 B** | 全量强化 600 条（含 Arena/退役），字段见 5.3 |
| 3 | `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn/v1/cherry-augments.json` | **200，224,005 B** | **简体中文名**：id=1205 ADAPt→「物理转魔法」、id=1141 AllForYou→「全心为你」、id=1002 ApexInventor→「尖端发明家」。599/600 条 nameTRA 与英文版不同 |
| 4 | `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/zh_cn/v1/augment-lists.json` | **200，24,069 B** | 与 default 相同（池列表无语言差异） |
| 5 | `https://raw.communitydragon.org/latest/game/en_us/data/menu/en_us/lol.stringtable.json` | **200，5,117,507 B** | 英文字符串表，1302 个 `kiwi_` 键（name/summary/tooltip） |
| 6 | `https://raw.communitydragon.org/latest/game/zh_cn/data/menu/en_us/lol.stringtable.json` | **200，33,114,839 B** | **简体中文效果文本**。注意：zh_cn 语言目录下子路径仍叫 `menu/en_us/`（Riot 文件结构如此）；`menu/zh_cn/` 路径是 **404**（实测）。样例：`kiwi_aram_bigbrain_name`=「超强大脑」；`kiwi_bigbrain_tooltip`=「获得<shield>@TotalShield@护盾值</shield>。阵亡时或耗尽后70秒重置。」；`kiwi_bigbrain_summary`=「每拥有<scaleAP>%i:scaleAP%@AP@法术强度</scaleAP>就会获得<shield>@ShieldBase@护盾值</shield>。阵亡时或耗尽后70秒重置。」 |
| 7 | 图标（小）`https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/ux/cherry/augments/icons/adapt_small.png` | **200，945 B** | 由 cherry-augments 的 augmentSmallIconPath 映射（见 5.3） |
| 8 | 图标（大）`.../global/default/assets/ux/cherry/augments/icons/bigbrain_large.png` | **200，17,641 B** | augmentLargeIconPath 映射 |
| 9 | 图标（游戏内路径替代）`https://raw.communitydragon.org/latest/game/assets/ux/cherry/augments/icons/bigbrain_large.png` | **200，10,891 B** | game/assets 下同名图标（metasrc 等站点用此路径；与插件路径尺寸不同） |
| 10 | `https://raw.communitydragon.org/latest/cdragon/arena/zh_cn.json` | **200，523,747 B** | CDragon 团队自建的 Arena 便利 JSON（assets.md 明示「not created directly by Riot but built by CDragon team」），225 条，**含中文 name/desc/tooltip + dataValues 数值 + calculations**。实测仅覆盖 KIWI 池 243 条中的 **97 条**（共享强化，如 ADAPt/BigBrain）；Mayhem 专属（GetExcited/Nightstalking/upgrade_* 等 146 条）不在其中。**注意其 desc 是 Arena 版本文本，与 KIWI stringtable 文本可能不同**（BigBrain 两处描述不一致，已实测对比） |
| 11 | `https://ddragon.leagueoflegends.com/api/versions.json` | **200**（curl 直连成功） | 最新 `16.23.1` |
| 12 | `https://ddragon.leagueoflegends.com/cdn/16.23.1/data/en_US/cherry-augments.json` | **403（S3 AccessDenied，即文件不存在）** | DDragon 无强化数据 |
| 13 | `https://ddragon.leagueoflegends.com/cdn/16.23.1/data/en_US/arena-augments.json` | **403（同上）** | 同上 |
| 14 | `https://ddragon.leagueoflegends.com/cdn/16.23.1/data/zh_CN/champion.json` | **200，195,550 B** | DDragon 官方简体中文英雄数据（注意 DDragon 用 `zh_CN` 大写写法，CDragon 用 `zh_cn` 小写） |
| 15 | `https://raw.communitydragon.org/json/latest/cdragon/arena/` | 200 | 目录 JSON 列表：ar_ae/cs_cz/de_de/…/zh_cn 等每语言一个文件（每日更新，mtime 2026-11-19） |

辅助技巧（CommunityDragon Docs/assets.md 原文）：目录列表可加 `json/` 前缀取 JSON（`https://raw.communitydragon.org/json/latest/game/`）；全量导出文件清单 `https://raw.communitydragon.org/latest/cdragon/files.exported.txt`（60MB）；站内搜索支持正则。`/latest/cdragon/` 下只有 arena 与 tft 两个自建目录，**无 kiwi/mayhem 目录（实测 404）**。

### 5.3 JSON 字段结构（实测样本原文）

**cherry-augments.json 条目**（default 与 zh_cn 结构完全一致，仅 nameTRA 语言不同）：

```json
{
  "id": 1141,
  "augmentNameId": "ARAM_AllForYou",
  "nameTRA": "全心为你",            // zh_cn 版；default 版为 "All For You"
  "simpleNameTRA": "",
  "summaryDescription": "",          // 恒空，描述须查 stringtable
  "augmentSmallIconPath": "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/AllForYou_small.png",
  "augmentLargeIconPath": "/lol-game-data/assets/ASSETS/UX/Cherry/Augments/Icons/AllForYou_large.png",
  "rarity": "kGold",                 // kSilver / kGold / kPrismatic
  "augmentDisplayTags": ["kResilience", "kAlly"]
}
```

- **名称**：nameTRA（zh_cn 版即官方简体中文名）。
- **稀有度**：rarity ∈ kSilver/kGold/kPrismatic（HOWL 映射 silver/gold/prismatic）。
- **图标**：把 `/lol-game-data/assets/` 前缀替换为 `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/`，**其余路径全部转小写**（Docs/assets.md 原文规则：「`/lol-game-data/assets/<path>` is mapped to `plugins/rcp-be-lol-game-data/global/default/<lowercased-path>`」）。图标无语言版本，用 default 即可。
- **描述/效果**：cherry-augments 本体不带描述；须查 stringtable 的 `kiwi_<squash(nameId)>_{tooltip|summary|description|desc}` 键（zh_cn 版即中文）。文本含富文本标签（<shield>/<scaleAP> 等）与 `@Var@` 模板变量，需清洗；`{{key}}` 需递归展开（HOWL 做法，深度≤2）。部分强化只有 name 键没有 tooltip（实测 AllForYou 在 stringtable 仅命中 name），此时可用 cdragon/arena/zh_cn.json 的 desc 兜底（若该强化在 97 条共享集内）或社区文本。
- **KIWI 池关联**：augment-lists.json 中 modeName=="KIWI" 的 augmentList，取路径最后一段 == augmentNameId。实测 243/243 全部能在 cherry-augments 中匹配。

**cdragon/arena/zh_cn.json 条目**（自建便利格式，仅共享强化）：

```json
{
  "apiName": "ADAPt", "id": 180,
  "name": "物理转魔法",
  "desc": "将<scaleAD>额外攻击力</scaleAD>转化为<scaleAP>法术强度</scaleAP>。获得<scaleAP>@APAmp*100@%法术强度</scaleAP>。",
  "tooltip": "...", "rarity": 0,
  "iconSmall": "assets/ux/cherry/augments/icons/adapt_small.png",
  "iconLarge": "...",
  "dataValues": { "APAmp": [0.15,0.10,0.20,...], "ConversionRate": [...] },
  "calculations": { ... }
}
```

注意：此文件 id 空间（1–405）与 cherry-augments 的 id（1001+）**不同**，关联须用 apiName ↔ augmentNameId 去 ARAM_ 前缀后小写比对；rarity 为数字 0/1/2。

### 5.4 简体中文本地化结论

| 要素 | 来源 | 覆盖 | 证据 |
|---|---|---|---|
| 强化中文名 | `global/zh_cn/v1/cherry-augments.json` 的 nameTRA | KIWI 243 条全覆盖（600 条中 599 条已翻译） | 实测样本：物理转魔法/全心为你/尖端发明家/超强大脑 |
| 强化中文效果文本 | `game/zh_cn/data/menu/en_us/lol.stringtable.json` 的 kiwi_*_tooltip/summary | 1302 个 kiwi 键；个别强化缺 tooltip（需兜底） | 实测 BigBrain tooltip/summary 中文原文（见 5.2 #6） |
| 强化图标 | global/default 插件路径（语言无关） | 全部 | 实测 200（小/大图标） |
| 稀有度 | rarity 字段（语言无关） | 全部 | kSilver/kGold/kPrismatic |
| 英雄/装备/技能中文名 | DDragon `cdn/{ver}/data/zh_CN/*.json`（官方） | 全部 | champion.json 实测 200 |
| 共享强化的结构化数值+中文 desc | `cdragon/arena/zh_cn.json` | 仅 97/243 | 实测对比 |

**NEXUS 推荐拼装方案（合法、免 key、免客户端）**：augment-lists(KIWI) + cherry-augments(zh_cn) + stringtable(zh_cn) 三文件下载 → 按 5.3 规则关联清洗 → 本地缓存（以 DDragon versions[0] 为版本键，借鉴 HOWL）。三文件合计约 33.5MB（stringtable 占 33MB，可只提取 kiwi_/cherry_ 键后落盘，实测 kiwi 键仅 1302 个）。

### 5.5 Riot 官方 LCU 是否暴露强化资料端点 —— 待验证

- **HOWL 源码证据**：强化数据全部走 CommunityDragon（gamedata.js），**未使用任何 LCU 强化端点**；其 LCU 端点清单见 2.8，无 cherry/augment/kiwi/hex 相关路径。
- **sylqon 源码证据**：LCU game-data 只用 `/lol-game-data/assets/v1/items.json`（catalog.py）；无强化端点。
- **社区文档证据**：XHXIAIEIN/LeagueCustomLobby README（LCU 端点大全，已全文检索）列出的 `/lol-game-data/assets/v1/...` 清单中**没有 cherry-augments / augment 相关条目**（检索命中 0）；其给出的 dragon→LCU 映射规则为「`plugins/rcp-be-lol-game-data` → `lol-game-data`，`global/default` → `assets`」。
- **推论（未验证）**：按上述映射规则，`/lol-game-data/assets/v1/cherry-augments.json` 与 `/lol-game-data/assets/v1/augment-lists.json` **很可能**在 LCU 存在且返回客户端语言（zh_CN 客户端即中文）版本——但本次调研未能在任何源码/社区文档中找到直接调用证据，**标「待验证」**（需本机运行客户端时实测）。用户提到的 `lol-aram-hex` 之类插件名在已查资料中**未出现**。
- 即使 LCU 端点存在，它也是 Riot「非官方支持」的本地接口（HOWL lcu.js 注释：「Riot does not officially support it」）；**免客户端的 CommunityDragon 路径已足够，建议作为 NEXUS 主路径**。
- 另：Riot 公开 Web API（match-v5）**不开放 Mayhem 对局数据**（HOWL README 原文），强化胜率类全局统计无官方来源；第三方 arammayhem.com/data 提供按补丁的 pickRate JSON/CSV（含 `name_<locale>` 中文名列，要求署名链接，实测搜索确认其 zh-cn 数据页存在），可作补充但非官方、且注意 Riot 政策禁止展示强化**胜率**（选取率是否受限需自行评估）。

### 5.6 合法性与政策注意

1. CommunityDragon 是社区镜像（非 Riot 官方发布），个人工具使用是社区普遍实践；NEXUS 若分发，建议附 Riot 免责声明（HOWL/sylqon/arammayhem 均附「not endorsed by Riot Games」）。
2. **Riot 开发者政策禁止应用展示强化胜率**（HOWL README 原文引用）——NEXUS 推荐系统只展示 tier/理由/选取率需谨慎，胜率一律不显示。
3. DDragon 为官方数据，可放心使用与缓存。
4. OP.GG 内部 API 无文档、非授权，随时可能失效（sylqon 自述），不作为 NEXUS 必需依赖。

---

## 六、禁止采用清单（NEXUS 安全红线汇总）

| 来源 | 内容 | 原因 |
|---|---|---|
| HOWL src/main/ocr/reader.js | Electron desktopCapturer 全屏截图 + 中央裁剪 + 1.5s/500ms 轮询识别强化卡 | 屏幕截图/游戏画面识别 |
| HOWL src/main/ocr/ocr-worker.ps1 | Windows 内置 OCR worker | OCR |
| HOWL src/main/ocr/match.js | OCR 文本→强化名匹配 | 依赖 OCR |
| HOWL 光标推断选卡（getCursorScreenPoint + 卡片坐标） | 画面识别推断玩家选择 | 游戏画面识别 |
| HOWL Ctrl+Shift+J 扫描存档、test/shots.js、e2e 截图 | 截图留存 | 屏幕截图 |
| HOWL「卡上贴 tier 徽章」overlay 定位 | 依赖 OCR 屏幕坐标 | 画面识别衍生 |
| sylqon lcu/injector.py 自动写入（item set PUT/符文页 POST/PUT/技能 PATCH） | 客户端自动化写操作 | 属「注入」类自动化，红线内禁止；如红线仅指游戏进程注入，也需用户显式触发+政策评估后再议 |
| sylqon 自动接受/自动导入类无人值守写操作 | 同上 | 同上 |
| 任何读游戏内存/进程注入方案 | 两仓库均未使用（HOWL README 明示 never touches memory），调研中也未采用 | 红线 |

合法替代：强化候选由玩家手动选择（点选/快捷键）→ 评级引擎（纯数据）→ 静态建议列表 overlay（不读画面）。对局数据走 LCU 只读 GET + Live Client Data API 只读 GET（两者均为本地 HTTP，不违反红线；LCU 写操作除外）。

---

## 七、样本文件清单（tools/research/samples/cdragon/）

| 文件 | 内容 |
|---|---|
| augment-lists.json | 完整模式池列表（CHERRY/KIWI/KIWI_JADE，24KB，实测下载原件） |
| kiwi-augments-sample.en_us.json | KIWI 池前 5 条英文强化（cherry-augments default 版节选） |
| kiwi-augments-sample.zh_cn.json | 同 5 条简体中文版（zh_cn 插件路径节选） |
| kiwi-joined-sample.zh_cn.json | 中文名+稀有度+图标路径+stringtable 键关联示例（5 条） |
| kiwi-from-arena-sample.zh_cn.json | cdragon/arena/zh_cn.json 中与 KIWI 共享的强化样本（含中文 desc/tooltip/dataValues，5 条） |
| stringtable-kiwi-sample.en_us.json | 英文 stringtable kiwi 键前 40 条 |
| stringtable-kiwi-sample.zh_cn.json | 中文 stringtable BigBrain/ADAPt/AllForYou/ApexInventor 相关键 |
| arena-augments-sample.zh_cn.json | cdragon/arena/zh_cn.json 前 3 条完整结构 |
| augment-icon-adapt-small.png | ADAPt 小图标（945B，实测下载原件） |
| ddragon-versions-sample.json | DDragon versions.json 前 5 个版本号（最新 16.23.1） |

（大文件原件 cherry-augments 224KB×2、stringtable 5MB/33MB、arena 524KB 已验证后删除，仅留小样本；下载 URL 与实测状态码全部记录于 5.2。）

## 八、证据索引（主要原文 URL）

- HOWL：github.com/AH228589/howl（README、src/main/gamedata.js、engine/augments.js、engine/champions.js、lcu.js、session.js、stats/store.js、scripts/snapshot.js、data/community/mayhem-reference.json、src/main/ocr/reader.js；api.github.com 元数据与文件树）
- sylqon：github.com/imperasus/sylqon（README、sylqon/lcu/{client,events,history,injector,ranked,scout}.py、sylqon/cache/opgg_fetch.py、sylqon/data/catalog.py、sylqon/ai/engine.py、ui/src/api.js；api.github.com 元数据与文件树）
- CommunityDragon：github.com/CommunityDragon/Docs/blob/master/assets.md（路径映射规则、arena 自建数据说明、json/ 目录列表技巧）；raw.communitydragon.org 各实测 URL（5.2 表）
- LCU 社区文档：github.com/XHXIAIEIN/LeagueCustomLobby/blob/main/README.md（dragon↔LCU 映射、端点清单、lockfile/进程认证）
- 第三方补充：arammayhem.com/data/ 与 arammayhem.com/zh-cn/data/（按补丁 pickRate 数据、name_<locale> 字段、署名要求）；mayhem-reference.json 内 sources（wiki.leagueoflegends.com、mayhemmeta.com、expcarry.com、arammayhem.com、Riot dev blog、invenglobal）
