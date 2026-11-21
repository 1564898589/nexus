# NEXUS 升级计划：多服务器数据中心 + 海克斯大乱斗 AI 教练

> **2026-11-19 变更：海克斯大乱斗功能已应用户要求整体取消并移除**（「海克斯删了吧，不做海克斯这块了」）。
> 已删除：六个海克斯视图、aramhex 适配器、海克斯采集器/分析/查询、全部 mayhem IPC 与 preload 接口、
> 九张海克斯数据表（启动时 DROP 旧库残留）、四个海克斯数据源注册行。多服务器排位数据中心（KR OP.GG + CN 101 + 韩服国服对比）保留。
> 下文为历史计划与调研记录，海克斯相关条目不再执行；tools/research/ 下的样本仅作历史证据存档。

> 状态：架构审查、三路数据源调研、许可证审查已完成；P0/P2 数据基础已开发并实测通过（aramhex 23/23、CN101 37/37、双口径集成 20/20）；P1/P3/P4/P5 进行中。
> 原则：不推倒重做、不破坏现有功能、本地优先、真实数据。版本号规则（2026-11-20 用户更新）：每轮功能完成并测试通过后自行递增源码版本号（package.json + CHANGELOG + 应用内版本公告 seed），不等用户提出；打包/发布/覆盖正式版仍须用户明确「确认打包/允许交付」。
> 证据存档：`tools/research/cn-101-feasibility.md`、`tools/research/aramhex-and-mayhem-stats.md`、`tools/research/howl-sylqon-official-assets.md`、`tools/research/samples/`（原样字节保存）。

## 一、架构审查结果（已逐文件核实）

### 1. 技术栈与分层
- Electron 主进程（CommonJS）+ 渲染进程 ES Modules，无框架、无构建步骤；渲染改动导航即生效，主进程/preload 改动需整重启。
- 数据库：sql.js（纯 JS SQLite），单文件 `%APPDATA%/nexus-lol-tactical/nexus.db`，事务提交 + 完整性校验 + 原子落盘（tmp→rename）。**无需引入新数据库**，海克斯数据直接扩展现有 SCHEMA。
- 数据管线：`providers/collector.js`（OP.GG 强度榜→DD 静态→逐英雄出装→素材下载→单事务提交）由 `core/update-engine.js` 编排（fresh/cached/stale/updating/failed/empty 状态机、定时+手动、失败保留旧数据）。
- 网络层：`core/net.js` 礼貌 HTTP（超时/退避重试/浏览器 UA）。素材经 `providers/assets.js` 下载缓存，渲染走 `nexus-asset://` 特权协议（带路径越界防护）。
- AI：`core/ai.js` 多服务商 OpenAI 兼容路由，任务制（query/bp/replay/live/tactic），DPAPI 加密密钥，失败自动降级并**明确标记规则分析**。新增海克斯任务只需扩 TASKS。
- LCU：`lcu/connector.js` 严格只读引擎，进程命令行/lockfile 双发现，腾讯服独立判定，端点健康如实上报；已暴露 `request/getMatchHistory/getMatchDetail/getEntitlementsToken`。SGP 通道（`providers/sgp.js`）支持深分页。
- 导航：`renderer/js/app.js` NAV 分组 + VIEWS 动态 import；`store.js` 全局 filter（region/tierFilter/position）；顶栏已有服务器/段位下拉。

### 2. 对升级的关键结论
| 现状 | 对升级的意义 |
|---|---|
| `champion_stats`/`builds` 主键已含 `region` 列 | **双服数据天然可共存**，CN 行直接入库，查询已按 region 过滤，不会混淆 |
| `meta` 表的 patch/region/fetchedAt/sampleSize 是全局单值 | 多服后会被互相覆盖 → 需按「源」记录版本/时间（新增 data_sources 表），查询按 region 解析各自 patch |
| `config.mode='ranked'` 已存在但未消费 | 游戏模式维度有现成挂点，补 mayhem 值与消费逻辑 |
| `util.js REGIONS` 只有 kr | 加 CN 选项即可，切换链路（config→rerender）已存在 |
| `collection_logs` 已记录任务/来源/耗时/成败 | 直接复用为数据更新日志，不另建重复表 |
| AI 降级标记、来源标签、样本量字段已是全链路惯例 | 海克斯模块沿用同一套诚实性规范 |
| LCU 只读 + 端点健康探测 | 海克斯采集作为**独立可选模块**挂在 LCU 引擎上，默认关闭 |

### 3. 兼容方案（不破坏现有功能）
- 现有 OP.GG 韩服管线**原样保留**，成为数据源注册表中的 `kr-opgg` 源；update-engine 从「单管线」升级为「多源编排」，每个源独立状态/独立失败回退。
- 新增表全部 `CREATE TABLE IF NOT EXISTS`，旧库无损迁移；现有 20 视图与全部 IPC 不改语义，只增量扩展。
- 服务器（KR/CN）× 模式（峡谷/海克斯）是两个独立维度：模式决定视图组与数据表，服务器决定统计行过滤。KR 无海克斯统计时显示「数据不可用」，绝不用排位数据顶替。

## 二、数据源可行性报告（全部实测，2026-11-19）

### 1. 国服官方 101 攻略中心 —— 可行，已接入
- 网关 `mlol.qt.qq.com/go/battle_info/odp_proxy/{数据集}`：公开 GET + 浏览器 UA + `Referer: https://101.qq.com/`，**无登录/签名/验证码**。28 项接口结论见 `cn-101-feasibility.md`。
- 已接入并实测：排位强度榜（翡翠+/全段位/峡谷之巅三口径，652 行/版本）、单英雄详情（出装/克制/分段/分路/加点/符文/趋势，懒加载+缓存）、海克斯官方英雄日榜（173 英雄）、官方强化日榜（222 条）、单英雄海克斯详情（出装/鞋子/强化 S/A/B 评级）、kiwi 强化字典（239 条中文名/稀有度/tooltip/图标全部落盘）。
- 关键坑（已固化进解析器）：lane 必须大写（MIDDLE/BOTTOM）；version_id 用版本名；新版本首日榜单空→自动回退上一版本（实测 16.23→16.22）；segment 接口必须 itier=255；海克斯英雄榜 `#` 分记录、登场率合计=10 需 ÷10 归一（与 aramhex 同口径，亚索 0.01146≈0.01142 互证）；强化评级首条带 `255:` 前缀需剥离；万分比胜率需 ÷10000。
- **诚实性**：官方榜无样本量字段 → `sampleSize=null`（未知），独立口径 `tierFilter='official'`、`patch='daily-YYYYMMDD'`，与 aramhex 版本窗口统计物理分离，绝不混合。
- 不可行/待验证：`zone/build_block`（需未知密钥，400）、`versiondetail`（参数未定，1005）、`ai_opponent`（空串）——均不依赖，界面不展示虚假内容。
- 限速：并发 1、间隔 ≥1s；不用 bot 类 UA（gtimg robots 封 AI 爬虫）。

### 2. czgreat/aramhex-data —— 可行，已接入（主统计源）
- 分发架构：`latest.json`(seq+SHA-256 清单) → `patches/<版本>/normal/` + `bands/{casual,mid,high}`；作者手工提交约 2–4 天一期，活跃（最近 2026-11-18，seq19=16.22，57,823,093 有效局）。
- 本机网络：raw.githubusercontent 被墙、api.github 限流 60/h → **主通道 cdn.jsdelivr.net/gh@data-v<seq>（不可变 tag，实测 25s 完成全量导入）**，GitHub API 兜底，SHA-256 逐文件校验；另有本地文件夹导入兜底（`mayhem:importLocal`）。
- 字段齐全：games/wins/win_rate/pick_rate/rank/low_sample(阈值3000)/分段/版本/builds/口径元数据；装备独立分母（≥300s）不与英雄榜混用。
- 已实现：Wilson 置信下限排序、小样本分离+评级封顶、全局强化榜派生、旧版本修剪、同 seq 跳过重下、失败保留旧数据。

### 3. kyle-ewing/aram-mayhem-stats —— 只借鉴思想，代码零复制
- 无 LICENSE = 保留所有权利。借鉴：match-history 轮询优于结算屏监听、playerAugment1..N 泛读、gameId 幂等去重、queueId 可配置、重开拒收、版本归一。采集器已按这些思想**自行实现**（`lcu/mayhem-collector.js`）。
- 待用户实机验证：国服现行 queueId（默认 2400 可配置）、强化槽位数（按 1..N 泛读兼容 4/6 槽差异）。

### 4. AH228589/howl —— 仅研究安全部分
- 无许可证；其截图/OCR/画面识别设计**一律不采用**（NEXUS 红线）。教练候选强化改为玩家手选 + LCU 合法数据。

### 5. imperasus/sylqon —— MIT，可借鉴架构
- LCU/OP.GG/DD/本地 AI 的分层思路与现有架构一致，未复制代码。

### 6. 官方静态资料
- Data Dragon（英雄/装备/符文/召唤师技能，已在用）；**海克斯强化正确 ID 空间是腾讯 kiwi 字典**（CommunityDragon 竞技场 cherry ID 与 Mayhem 不符，已实测排除）；kiwi 图标 239/239 下载成功、无空文件。

## 三、许可证风险清单

| 来源 | 许可证 | 义务 | NEXUS 处置 | 商业化风险 |
|---|---|---|---|---|
| aramhex-data 统计数据 | **CC BY-NC 4.0**（LICENSE 全文核实） | 署名+链接+许可证声明；修改注明；仅非商业 | 应用内署名「海克斯大乱斗统计数据（github.com/czgreat/aramhex-data），CC BY-NC 4.0」，data_sources 表记录 license/attribution | **高**：商用前必须替换为授权数据或自主采集 |
| aram-mayhem-stats 代码 | 无许可证（All Rights Reserved） | 禁止复制 | 零代码复制，仅思想借鉴，samples 仅作证据不入构建 | 无（未使用代码） |
| HOWL | 无许可证 + OCR 设计 | 禁止复制 | 不采用任何代码与 OCR 方案 | 无 |
| sylqon | MIT | 保留版权/许可声明 | 仅架构参考，未复制 | 低 |
| Seraphine（历史调研） | GPLv3 | 传染性 | 不引入 | 无 |
| 腾讯 101/kiwi 公开资料 | 官方公开页面数据，无专门 API 条款 | 个人非商业、本地缓存、注明来源、不绕过访问控制、礼貌限速 | 已按此实现；用户协议一般性禁止自动化抓取与商业再分发 | **中**：商用需腾讯许可 |
| OP.GG（现有） | 非官方解析 | 个人学习研究、来源标注、失效保留旧数据 | 维持现状 | 中 |
| Riot Data Dragon | 官方公开静态 | 常规引用 | 维持现状 | 低 |

**结论**：当前个人非商业定位下全部可用且义务已落实；任何商业化动作前必须先替换 CC BY-NC 数据与取得腾讯/OP.GG 许可。界面与数据行均带来源/许可证标记，用户可见。

## 四、实施计划（按优先级）

1. **P0 数据基础** ✅：SCHEMA 扩展（data_sources / augments / mayhem_champion_stats / champion_augment_stats / augment_stats / champion_item_stats / mayhem_builds / mayhem_matches / mayhem_players / player_augments）+ 数据源注册表（6 源独立状态/健康检查/定时/失败保留旧数据）+ 按源版本/时间/回退。实测：应用内自动首跑 cn-101 652 行、cn-mayhem-official 173+222 成功。
2. **P1 多服务器** 🔶：CN 101 provider 已完成并实测（37/37）；KR/CN 切换贯穿现有视图 + 跨服对比视图待做。
3. **P2 海克斯数据** ✅：kiwi 官方强化字典（239 条+图标+tooltip+机制标签派生）+ aramhex 统计导入（23/23，署名+许可证+样本量门槛+Wilson+分段）+ 海克斯专属装备统计 + 官方日榜独立口径（集成 20/20）。
4. **P3 海克斯界面** ⏳：独立导航组「海克斯大乱斗」：英雄排行榜 / 强化资料库 / 英雄×强化组合 / 装备推荐；模式×服务器双维切换；沿用现有视觉系统。
5. **P4 LCU 采集** 🔶：采集器已写完接线（默认关闭/去重/拒收/本地/日志），待模拟数据测试 + 设置页开关 UI。
6. **P5 AI 教练** 🔶：评分引擎已完成（真实统计≤55 分+契合+协同+情境，real/heuristic/info 三标记，小样本封顶，重复选减分，动态装备建议）；教练视图/AI 任务扩展/复盘视图待做。
7. **P6 验收** ⏳：用户 18 项逐项实测 + 原有功能全量回归（views/functional/bp 套件）+ 断网缓存测试。

## 五、安全红线（本次升级继续强制）

不读游戏内存/不注入/不改游戏文件/不自动操作游戏/不截图/不 OCR/不视觉识别；只走 LCU、Live Client Data（若合法可用）、公开数据源、官方资料；不绕过登录/验证码/访问控制/反爬；不伪造缺失数据；密钥 DPAPI、凭据仅内存；本地存储、无付费云；采集默认关闭、随时可关；CC BY-NC 数据署名且仅限非商业。