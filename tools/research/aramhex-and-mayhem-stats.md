# 调研报告：czgreat/aramhex-data 与 kyle-ewing/aram-mayhem-stats

- 调研日期：2026-11-19（北京时间）
- 调研方式：WebFetch 抓取 GitHub API（api.github.com）与 raw.githubusercontent.com 原文；github.com 网页端在本机不可达，全部结论以 raw 原文与 API JSON 为证据。
- 证据保存：`tools/research/samples/aramhex/`、`tools/research/samples/mayhem-stats/`（原样字节保存，多个文件字节数与 GitHub git-tree API 记录的 size 逐一相符，如 heroes.json=32310、LICENSE=19347、lcu.js=2483，可确认未被截断/转码）。
- 本报告为纯调研产物，未向 NEXUS 项目复制任何代码。

---

## 一、许可证结论

### 仓库 A：czgreat/aramhex-data —— 确为 CC BY-NC 4.0（已核实 LICENSE 全文）

- `LICENSE`（19,347 字节，已存 `samples/aramhex/LICENSE.txt`）为 **Creative Commons Attribution-NonCommercial 4.0 International Public License 完整官方文本**，开头即 "Attribution-NonCommercial 4.0 International"。
- GitHub API `license` 字段显示 `{"key":"other","spdx_id":"NOASSERTION"}`——这是因为 LICENSE 是纯文本排版（无 Markdown），GitHub 自动识别失败，**不代表许可证不明**；README、AGENTS.md、每份 meta.json 的 `"license": "CC BY-NC 4.0"` 三处交叉印证。
- 关键条款（LICENSE 原文）：
  - Section 2(a)(1)：仅授权 **NonCommercial** 目的的复制、分享与改编（"reproduce and Share the Licensed Material, in whole or in part, for NonCommercial purposes only"）。
  - Section 1(i)：NonCommercial = "not primarily intended for or directed towards commercial advantage or monetary compensation"。
  - Section 3(a) 署名要求：保留创作者标识、版权声明、许可证声明与免责声明、指向原材料的 URI/链接；修改需注明；附上本许可证文本或链接。
  - Section 4：明确覆盖 **Sui Generis Database Rights（数据库权）**——对统计数据集尤其相关，非商业提取/复用整库或实质部分均被授权，但分享时须遵守署名条款。
- README 给出的署名格式（原文）：`海克斯大乱斗统计数据（github.com/czgreat/aramhex-data），CC BY-NC 4.0`。
- **对 NEXUS 的含义**：只要 NEXUS 保持非商业（不收费、不以商业获利为主要目的），可以内置/改编该数据集，但必须在应用内显著位置署名并附链接与许可证声明。若未来商业化，需另行取得作者授权。英雄/海克斯名称本身版权归腾讯/Riot（README 明示"本项目和腾讯、Riot Games 没有关系"），许可证只覆盖统计数据。

### 仓库 B：kyle-ewing/aram-mayhem-stats —— 无许可证（默认版权保留，禁止照搬代码）

- GitHub API：`"license": null`。
- git tree（recursive，truncated=false）全列表中**不存在任何 LICENSE / COPYING 文件**。
- 结论：**未声明许可证 = 作者保留所有权利**。可以阅读、学习其设计思想（端点选择、表结构思路、去重策略等事实性/思想性内容不受版权保护），但**不能把它的任何源码文件、代码片段复制进 NEXUS**。本报告保存的源码文件仅作调研证据，不得进入项目构建。
- 附注：其 `collector/INGEST_CONTRACT.md` 自述参考了 `Yhprum/mayhem-tracker`（Electron + league-connect + better-sqlite3）——该上游仓库本次未调研，若需借鉴代码应另行核实其许可证（待验证）。

---

## 二、仓库 A：aramhex-data 详情

### 2.1 基本信息与维护状态（证据：api.github.com/repos/czgreat/aramhex-data 及 /commits）

| 项 | 值 |
|---|---|
| 创建时间 | 2026-10-16T15:29:55Z |
| 最近 push | **2026-11-18T05:25:06Z**（调研前一天，活跃维护） |
| 最新提交 | 2026-11-18 "data seq19: 16.22 合并热修前后 57,823,093 局（截至 11-17 18:00）…" |
| 默认分支 | main；仓库约 45.8 MB；29 stars |
| 配套产品 | 桌面助手 czgreat/aramhex，官网 aramhex.com |
| 更新方式 | **作者 czgreat 手工/脚本化提交，非 GitHub Actions**（git tree 中无 `.github/workflows`；提交作者均为 czgreat 本人）。提交序号 seq1→seq19，每次数据更新 seq+1 并打 tag `data-v<seq>`，可用 `@data-v<seq>` 固定取某一期 |
| 更新频率 | 约 2–4 天一期：10-28 seq10 → 10-31 seq11 → 11-04 seq12 → 11-06 seq13 → 11-08 seq14/15 → 11-09 seq16 → 11-13 seq17 → 11-16 seq18 → 11-18 seq19 |

### 2.2 目录组织（证据：git/trees/main?recursive=1，truncated=false，全量）

```
根目录: .gitattributes  AGENTS.md  DATA-SOURCES-16.21-prehotfix.md
        DATA-SOURCES-16.21.md  DATA-SOURCES-16.22.md  LICENSE  README.md
        index.json（全部历史数据集索引）  latest.json（最新常规数据指针）
patches/
  16.19/normal/            16.19/first-prismatic/   ← 活动规则单独目录
  16.20/normal/  + bands/{casual,mid,high,top}/
  16.21-pbe/normal/ + bands/…   ← 测试服过渡数据
  16.21-prehotfix/normal/       ← 热修前快照
  16.21/normal/  + bands/…
  16.22/normal/  + bands/…      ← 当前最新（seq19）
```

每份数据目录（以 16.22/normal 为例）：
`meta.json, heroes.json/.csv, hero_augments.json/.csv, augments.json, hero_spells.json, hero_item_holdings.json, hero_items.json, hero_items_raw.json, hero_item_recommendations.json, hero_augment_items.json, core_builds.json, equipment_heroes.json, equipment_recommendation_heroes.json, item_metadata.json`；
`bands/<casual|mid|high|top>/` 内是同构的分段表；**bands/top 与 bands/high 逐字节相同**（tree 中两者 SHA 完全一致，为兼容旧客户端的别名）。

程序化读取入口（AGENTS.md 原文流程）：读 `latest.json` 的 `path`/`files`(SHA-256)/`seq` → 读 `<path>/heroes.json`、`hero_augments.json` → 历史版本查 `index.json.datasets[]`（按 patch+mode 挑）。所有文件可用 files 里的 SHA-256 校验。

### 2.3 数据字段表（证据：raw 原文样本，均已保存）

**heroes.json** — `{英雄ID(字符串): {...}}`，173 个英雄：

| 字段 | 类型 | 示例（英雄 157 亚索） | 说明 |
|---|---|---|---|
| name | string | "亚索" | 国服中文名 |
| title | string | "疾风剑豪" | 称号 |
| games | int | 6603257 | **样本量（出场人次）** |
| wins | int | 3919954 | 胜场 |
| win_rate | float | 0.593639 | **胜率**（6 位小数） |
| pick_rate | float | 0.01142 | 出场占比（占全部英雄人次） |
| rank | int | 1 | 胜率名次 |
| low_sample | bool | false | 小样本标记（README 未列，实测 JSON 中存在） |

**hero_augments.json** — `{英雄ID: {海克斯ID: {...}}}`（约 2.27 MB）：

| 字段 | 类型 | 示例（1→1002） |
|---|---|---|
| games | int | 13178 |
| wins | int | 6120 |
| win_rate | float | 0.46441 |
| low_sample | bool | false（meta.json：少于 3000 人次标 true，`low_sample_threshold: 3000`） |

**augments.json** — `{海克斯ID: {name, rarity}}`，rarity ∈ `silver / gold / prismatic`，如 `"1001": {"name":"泰坦的坚决","rarity":"prismatic"}`。ID 与腾讯/Riot 官方 ID 一致。

**hero_item_holdings.json**（16.22 起，约 3.29 MB）— `{英雄ID: {装备ID: {games, wins, win_rate, low_sample}}}`，字段结构与 hero_augments 完全同构；装备保留**原始 ID**（含升级形态如 228002、994403 等）。分母是 `equipment_heroes.json`（仅时长≥300 秒对局），**不能与 heroes.json 的分母混用**（AGENTS.md 明确警告）。

**heroes.csv** — UTF-8 带 BOM，表头：`hero_id,hero_name,hero_title,games,wins,win_rate,pick_rate,rank`，按 rank 排序（JSON 按 ID 字符串排序）。hero_augments.csv 另带海克斯中文名与稀有度。

**meta.json**（口径元数据，字段均已核对原文）：`patch, mode/mode_label/mode_rule, label, license, schema_version, snapshot_at, window{start,end_exclusive,periods,time_field}, builds[], regions[], regions_combined, matches{collected,valid,excluded,validity_rule}, hero_participations, heroes, low_sample_threshold, bands{method,score_as_of,minimum_30day_games,bands{casual/mid/high/top…}}, equipment{…excluded_augment_ids…}, components{destiny…}, excluded_augments{}, limitations[], notes[], rarity_check, files{每文件SHA-256}`。

**latest.json**：`{path:"patches/16.22/normal", seq:19, patch, mode, bands:true, matches, matches_detail, window, snapshot_at, schema_version, files:{文件名:{sha256,size}}}`。

### 2.4 统计口径（证据：README「统计口径」、meta.json、DATA-SOURCES-16.22.md 原文）

- **样本来源**：国服 7 个大区（艾欧尼亚、黑色玫瑰、联盟一至五区）的部分对局，直接合并不加权；"统计的是部分对局，不是全服数据"。采集端实现未公开（仓库只有统计结果，"不含玩家 ID、名字、对局编号、原始对局或个人分数"；11-08 提交还特意"去掉采集、入库、各区采集进度等说法"）。DATA-SOURCES-16.22.md 提到有效条件含 **"queue 2400"**——与仓库 B 的 Mayhem queueId 一致，可互为佐证。
- **有效对局**（16.22 meta.json 原文）："对局时长240至14400秒、截止前正常结束（GameComplete）、非私人对局；10名不同真人、无电脑、两队各5人且队内胜负一致，共5胜5负；数据不全的对局不计"。当前期：总 59,702,691 / 有效 57,823,093 / 排除 1,879,598。
- **海克斯口径**：按对局结束时六槽持有，同人同 ID 去重，任意槽位持有即计入；是相关不是因果。系统性偏差的海克斯显式剔除（`excluded_augments`，如 1337 任务替换、3176 五杀标记）。
- **分段**：非官方段位，按"同局关系显示分"（各区分别推算）。16.22：娱乐 <1600、中分 1600–2400、前 5% ≥2400，需近 30 天≥31 局有效对局；按快照时刻冻结评分**事后回溯划分**（`retrospective_buckets: true`）。16.21 用区内分位（娱乐 >36%、中分 5–36%、前 5% ≤5%）。无分玩家只进全体。
- **版本**：按游戏版本目录存放，`builds` 记录完整构建号（16.22.834.9083 / 16.22.836.1077 热修前后合并）；热修差异大时拆目录（16.21-prehotfix）；活动规则（first-prismatic 首次必棱彩）单独目录，胜率不可与常规直接比较。
- **小样本处理建议**（AGENTS.md 原文）：建议平滑 `(wins + 基准胜率 × k) / (games + k)`，k≈300。

**结论：数据同时含 样本量(games/wins) + 胜率(win_rate) + 分段(bands/) + 版本(patches/<版本>/ + meta.builds)，四项齐全。**

---

## 三、仓库 B：aram-mayhem-stats 详情

### 3.1 基本信息、技术栈与维护状态（证据：API + git tree + commits 原文）

| 项 | 值 |
|---|---|
| 创建 | 2026-06-18T20:31:05Z（"initial commit"） |
| 最近 push | **2026-06-23T05:43:46Z**，此后近 5 个月无提交 → **停滞/一次性项目**（仅 7 个提交，0 stars，0 fork） |
| 技术栈 | 后端 Flask (Python 3.11+) + stdlib sqlite3；采集器 Node 18+ (ESM) + **league-connect 5.x**；前端 React + Vite；.devcontainer/.claude 表明是 Claude Code 代理工作流产物 |
| 数据观 | 第一方数据：Riot match-v5 Web API 对 Mayhem 对局**故意返回 403**（RiotGames/developer-relations#1109，closed working-as-intended），因此靠玩家自愿运行本地 LCU 采集器上传 |
| 架构 | 采集器(读 LCU) → POST /api/ingest/match → Flask 校验入库(SQLite) → 统计服务 → React 前端 |

### 3.2 LCU 采集端点清单（证据：collector/src/lcu.js 与 INGEST_CONTRACT.md 原文，非 README 推测）

**源码中实际发起请求的端点（lcu.js，全部 GET、只读）：**

| 端点（原样） | 用途 | 合法性标注 |
|---|---|---|
| `/lol-summoner/v1/current-summoner` | 取本机登录玩家 puuid/gameName/tagLine | Riot LCU 本地接口，社区公认合法只读端点（第三方应用广泛使用，Riot 政策允许 LCU 只读） |
| `/lol-match-history/v1/products/lol/{puuid}/matches?begIndex={start}&endIndex={end}` | 分页拉取对局摘要列表（每页 100，begIndex 递增翻旧账，短页则回卷到 0） | 同上，合法只读 |
| `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=…&endIndex=…` | 无 puuid 时的回退写法 | 同上 |
| `/lol-match-history/v1/games/{gameId}` | **权威全量对局**：10 名 participants + stats（含 playerAugment1..N、item0..6、win）+ participantIdentities | 同上 |

**仅在文档中提及、源码未使用的端点（INGEST_CONTRACT.md §2 原文）：**

| 端点 | 说明 |
|---|---|
| `/lol-end-of-game/v1/eog-stats-block` | 结算屏数据块；文档明确 "The reference does NOT rely on these; it polls match-history instead"（轮询更稳健：跳过结算屏也能拿到、可回填历史） |
| `OnJsonApiEvent_lol-end-of-game_v1_eog-stats-block` | 对应 LCU WebSocket 事件，同样未使用，列为未来低延迟增强 |

**未出现**：liveclientdata（`https://127.0.0.1:2999/liveclientdata/...`，那是游戏内 API 而非 LCU）在本仓库源码中完全没有；也没有任何写操作端点。

**认证方式（lcu.js + INGEST_CONTRACT.md §1）**：league-connect `authenticate({awaitConnection:true, pollInterval:2500})` 自动发现 lockfile（`name:pid:port:password:protocol`，Windows 在 `%LOCALAPPDATA%\Riot Games\Riot Client\Config\lockfile` 或 League 安装目录）；`https://127.0.0.1:{port}` + Basic Auth（用户名常量 `riot`，密码来自 lockfile）；自签证书需信任 riotgames.pem 或仅对 127.0.0.1 关闭校验；客户端重启后端口/密码变化，断连即 `reset()` 重读 lockfile。

**对局过滤与字段提取（index.js / map.js / config.js 原文）**：
- `queueId === 2400` 判定 Mayhem（config.js `mayhemQueueId: 2400` 默认，可 env/CLI 覆盖；契约文档注明普通大乱斗是 450，且 2400 标 LIVE-VERIFY——**国服现行 queueId 需自行验证，待验证**）。
- 轮询周期 `pollIntervalMs: 150000`（2.5 分钟）一次一页 100 局；重连间隔 5 秒。
- 海克斯：`stats.playerAugment1..4`（`MAX_AUGMENT_SLOTS = 4`，注释说明数组变长可向前兼容），只保留正整数、丢 0。
- 装备：`item0..item6` 七槽按位保留（0=空槽，不丢）；召唤师技能 `spell1Id/spell2Id` 在 participant 层而非 stats。
- 胜负：`stats.win`（布尔）；伤害优先 `totalDamageDealtToChampions`，缺失回退 `totalDamageDealt`。
- 重开：任一 participant `stats.gameEndedInEarlySurrender === true` → 顶层标记，采集器不上传、后端也拒存（`status:"skipped"`）。
- 版本归一：`gameVersion "26.12.123.4567"` → `patch "26.12"`（取前两段，热修内聚合稳定）。
- 隐私：`participantIdentities` 的 puuid/名字**故意不进 payload**（契约 §6.5，避免存个人信息）。

### 3.3 SQLite 表结构（证据：backend/app/db.py `_SCHEMA` 原文，已存 samples/mayhem-stats/db.py）

```sql
matches(gameId INTEGER PRIMARY KEY,            -- 去重键
        queueId INTEGER NOT NULL, patch TEXT NOT NULL,
        gameVersion TEXT, gameCreation INTEGER, gameDuration INTEGER,
        ingestedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))

participants(id INTEGER PRIMARY KEY AUTOINCREMENT,
        gameId INTEGER NOT NULL REFERENCES matches ON DELETE CASCADE,
        participantId, championId, championName, teamId,
        win INTEGER, kills, deaths, assists, totalDamageDealtToChampions)

participant_augments(participant_id INTEGER REFERENCES participants ON DELETE CASCADE,
        augmentId INTEGER NOT NULL)            -- 每人 0..N 行

participant_loadouts(participant_id INTEGER PRIMARY KEY REFERENCES participants,
        gameId, championId, item0..item6 INTEGER DEFAULT 0, summoner1, summoner2)

-- 索引: participants(gameId), participants(championId),
--       participant_augments(augmentId), participant_augments(participant_id),
--       participant_loadouts(championId), participant_loadouts(gameId)
-- 每连接 PRAGMA foreign_keys = ON
```

### 3.4 胜率计算与去重（证据：stats.py / ingest.py / seen.js 原文）

- **英雄胜率**：`SELECT championId, COUNT(*) AS games, SUM(win) AS wins FROM participants GROUP BY championId`；winRate = wins/games 四舍五入 4 位。**无平滑、无 low_sample 标记、无分段维度**（对比仓库 A 差距明显）。
- **英雄×海克斯**：`participant_augments pa JOIN participants p ON p.id=pa.participant_id WHERE p.championId=? GROUP BY pa.augmentId`。海克斯全服榜同理去掉 WHERE。
- **装备/出装**：只计 metadata 标 legendary 的成装、同局同 ID 去重（set）；AD/AP/mixed/other 分桶阈值 75%。
- **去重三层**：
  1. 采集器本地 `seen.json`（gameId 集合，原子写：临时文件+rename；刻意不用 better-sqlite3 以免 node-gyp 原生依赖）；
  2. 后端 `INSERT OR IGNORE INTO matches(gameId PK)`，`rowcount==0` 即返回 duplicate，**子表只在 match 新插入时写**——同一局最多 10 个采集器重复上传也只计一次（幂等）；
  3. 契约层面 201=created / 200=duplicate 或 skipped，采集器对 200/201 一律记 seen 停发。
- **入库校验**（ingest.py）：schemaVersion==1、queueId==配置值、恰好 10 人、participantId 1..10、teamId ∈{100,200}、win 必须布尔、KDA/伤害非负、augments 过滤 0、items/spells 定长补零截断。
- 海克斯名称/稀有度来自**手工维护池** `backend/app/data/mayhem_augments.json`（stats.py 注释：Mayhem 强化 ID 与 CommunityDragon 竞技场强化 ID 是不同 ID 空间，CD 解析不了）；英雄名/图标走 Data Dragon（免 key）。

---

## 四、可借鉴设计 vs 禁止照搬

### 可借鉴（思想/事实层面，自行实现）

来自 A（数据可直接用，注意 CC BY-NC 署名）：
1. **数据分发架构**：`latest.json`(指针+seq+SHA-256 清单) + `index.json`(历史索引) + `patches/<版本>/<规则>/` + `bands/` 分段 + tag `data-v<seq>` 固定版本——非常适合 NEXUS 做"离线内置 + 在线增量更新 + 完整性校验"的数据管线，且 raw.githubusercontent.com 本机可达。
2. **口径设计**：有效对局过滤规则（时长/GameComplete/10 真人/5胜5负/排除重开与电脑）、结算六槽持有去重、`low_sample` 阈值(3000)与建议平滑公式(k≈300)、显式 `excluded_augments` 偏差剔除清单、装备统计独立分母(≥300s)、meta.json 记录 window/builds/regions/limitations 的可审计口径。
3. **CSV+JSON 双格式、UTF-8 BOM、ID 与官方一致**的兼容做法。

来自 B（**只借鉴思路，代码必须自己写**）：
1. **match-history 轮询优于 end-of-game 监听**的结论及理由（跳过结算屏仍可采集、可回填历史）——与 NEXUS 严格只读 LCU 约束完全兼容：三个 GET 端点 + lockfile 发现 + Basic Auth 全是只读。
2. `playerAugment1..N` 变长槽读取、正 ID 过滤、item0..6 按位保留、gameEndedInEarlySurrender 拒收、gameVersion→major.minor 归一。
3. `gameId` 主键幂等去重 + 本地 seen 集合的双层去重；matches/participants/participant_augments 的规范化 schema 思路（NEXUS 用 sql.js 可自行建同构表）。
4. queueId 过滤可配置化（避免 Riot 换队列号硬编码失效）。

### 禁止/不可行

1. **B 的任何源码不得复制进 NEXUS**（无许可证=保留所有权利），包括 lcu.js/map.js/db.py 等；samples 里的 .js/.py 仅供阅读比对。
2. **A 的数据不得用于商业用途**；使用时必须注明来源+CC BY-NC 4.0+链接，修改需注明。
3. B 的"采集器上传到中心后端"模式 NEXUS 不需要也不应照搬（NEXUS 是本地单机 sql.js，无上传；B 契约 §6.6 也承认该模式无任何防伪造机制）。
4. 两者都不涉及截图/OCR/读内存，与 NEXUS 红线无冲突；但 NEXUS 若自行实现 LCU 采集，仍须只 GET、不 POST/PUT LCU。

### 待验证项

- 国服海克斯大乱斗当前 queueId 是否仍为 2400（B 文档标 LIVE-VERIFY；A 的 16.22 数据说明确认当期为 2400，但需以国服客户端实测为准）。
- 国服客户端 `playerAugment` 槽位数（B 参考实现读 1..4；A README 称"六个海克斯槽位"——**两者槽位数不一致**，B 契约本身也提示 26.12 后可能变化；NEXUS 实现应按 1..N 泛读）。
- A 数据的采集端实现方式（仓库刻意不公开，只能确认"部分对局样本、queue 2400、GameComplete 校验"这些口径事实）。
- 上游 Yhprum/mayhem-tracker 的许可证（本次未调研）。

---

## 五、数据样本文件清单（tools/research/samples/）

### aramhex/（源：raw.githubusercontent.com/czgreat/aramhex-data/main/…）

| 文件 | 大小 | 说明 |
|---|---|---|
| README.md | 9,311 B | 全文（与 git tree size 一致） |
| AGENTS.md | 3,795 B | 程序读取说明全文 |
| LICENSE.txt | 19,347 B | CC BY-NC 4.0 官方全文 |
| DATA-SOURCES-16.22.md | 2,271 B | 16.22 样本来源说明 |
| latest.json | 6,618 B | 最新数据指针（seq19，全文） |
| meta.json | 10,725 B | patches/16.22/normal/meta.json 全文 |
| heroes.json | 32,310 B | 16.22 全体英雄胜率，173 英雄全量 |
| heroes.csv | 10,971 B | 同上 CSV（UTF-8 BOM），全量 |
| augments.json | 14,147 B | 海克斯名/稀有度全量（225 条） |
| hero_augments.first200KB.json | 204,800 B | 英雄×海克斯，原文件 2,272,981 B 的前 200KB（截断，非完整 JSON） |
| hero_item_holdings.first200KB.json | 204,800 B | 英雄×装备持有，原文件 3,287,309 B 的前 200KB（截断） |

### mayhem-stats/（源：raw.githubusercontent.com/kyle-ewing/aram-mayhem-stats/main/…，仅作证据，禁止入项目）

| 文件 | 对应仓库路径 | 大小 |
|---|---|---|
| README.md | README.md | 5,049 B |
| INGEST_CONTRACT.md | collector/INGEST_CONTRACT.md | 16,424 B |
| lcu.js | collector/src/lcu.js | 2,483 B |
| collector-index.js | collector/src/index.js | 4,338 B |
| map.js | collector/src/map.js | 4,700 B |
| seen.js | collector/src/seen.js | 1,786 B |
| config.js | collector/src/config.js | 2,561 B |
| db.py | backend/app/db.py | 5,629 B |
| stats.py | backend/app/services/stats.py | 15,410 B |
| ingest.py | backend/app/services/ingest.py | 11,193 B |

（所有小文件字节数与 GitHub git-tree API 的 size 一致，可证完整。）
