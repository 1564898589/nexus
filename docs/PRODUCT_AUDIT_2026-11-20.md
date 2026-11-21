# NEXUS 2.0 产品级审查报告（2026-11-20）

方法：三组只读代码审查（知识库/主动分析/AI上下文、工程质量/泄漏、逐视图成熟度）+ 主审运行时取证（22 视图响应巡测、重复请求计数、控制台/异常监听、资源采样、全新 userdata 首启、坏库启动、idle 泄漏观测）。所有 P0/P1 均附运行或行号证据。
基线版本：1.2.0（AI 报告引擎已具备：结构化 JSON+Markdown 消毒降级+历史/对比/导出/训练勾选）。

## 一、运行时取证摘要

- 22 视图巡测：响应 208–264ms（含渲染 settle），无 >2.5s 视图；巡测期间重复请求 0、控制台错误 0、未捕获异常 0。
- 资源：主进程 WorkingSet 巡测前 102.7MB → 后 130.3MB（+27.6MB，含 22 视图 DOM/图表缓存；idle 序列另附）。
- 首启（全新 userdata）：seed 数据就位（173 英雄/244 统计/863 装备）、密码门默认关闭、v1.2.0 公告自动合并、无异常。
- **坏库启动（真实破坏 nexus.db 中部字节）：sql.js 构造不校验页 → "打开成功" → 首个查询即 `database disk image is malformed` → 全视图瘫痪；无警告、无留档、无恢复。P0 实锤。**
- 断网/离线：无全局离线探测，断网时每次操作等满 25s×3 重试（net.js:7-28）。

## 二、问题清单（P0→P3）

### P0
| # | 模块 | 问题 | 原因 | 影响 | 方案 | 证据 |
|---|---|---|---|---|---|---|
| P0-1 | electron/core/db.js | 坏库致全软件瘫痪且无恢复/留档 | 构造不校验；integrity() 存在但启动未调用；catch 仅覆盖构造抛错 | 用户库一旦损坏（断电/写坏）全部功能不可用，备份恢复入口也进不去 | 启动 quick_check；坏则原文件改名留档→尝试最新备份恢复→否则空库；config 标记+vault/首屏警告 | 坏库探针 STATE `{__error:"database disk image is malformed"}`；db.js:86-96,120-123 |

### P1
| # | 模块 | 问题 | 原因 | 影响 | 方案 | 证据 |
|---|---|---|---|---|---|---|
| P1-1 | app.js + coach/lcu/update/builds | 视图离开不销毁 window 级订阅 | rerender 只清 DOM 不调 destroy；unsub 仅重进同视图时解绑 | LCU 2.5s tick 持续驱动已脱离 DOM 的旧闭包：内存滞留+无效 IPC/计算 | rerender 前调 currentView.destroy?.()；四视图返回 destroy | app.js:220-239；coach.js:21-22；lcu.js:48-49；update.js:27-28；builds.js:92-96 |
| P1-2 | detail.js | CN 区来源标全部硬编码 opgg；加点提示写死 Q>W>E | 国服适配时漏改 detail 视图 | 数据来源标注失真（产品核心价值"来源可追踪"受损） | 按 build.provider 动态 sourceTag；加点提示用真实 skillOrder | detail.js:95,117,122,129,141,242 |
| P1-3 | compare.js | 段位硬编码 emerald_plus 无视顶栏筛选；load 无骨架无 catch | 初版写死 | 用户切段位后对比口径错误且无感知；失败白屏 | tier 取 config；骨架+catch+重试 | compare.js:35,40-48 |
| P1-4 | warroom.js | 手动侦察解析 search 返回形状错误 | search 返回 {state,player}，手动模式取 p.puuid | 候选态/未确认态手动侦察静默失败 | 解包 player + 候选态提示 | warroom.js:193-199 对照 player.js:83-89 |
| P1-5 | logger.js | 日志无轮转无上限且同步 append | 仅内存 ring 2000 约束 | 长稳运行磁盘无限增长；同步写阻塞主进程 | 5MB×3 轮转 + 异步 append | logger.js:10-16 |
| P1-6 | db.js/players.js | matches/collection_logs/ai_reports 无上限；persist 全量写盘放大 | 只 INSERT 不修剪；每次 COMMIT 全库 export | 库越大启动越慢、写盘越贵（长稳退化） | 修剪上限（matches 每账号 200/日志 500/报告 100）+ persist debounce 合并 | db.js:103-122；players.js:264；collector.js 多处 persist |
| P1-7 | 规划缺口 | 本地知识库/联网检索不存在；英雄池管理无独立能力（熟练度/定位修正）；coach 无记忆/主动；replay 无对线/团战维度；growth 无长期目标实体 | 规划未落地 | 规格阶段4/6 要求不满足 | 本地知识库（_seed  curated+来源+版本标签+检索+AI 消费）落地；联网检索标记方案待确认（合规/网络风险不擅开发）；池覆盖配置+UI；coach 记忆层；replay 用已存十人 participants 补 KP/伤害占比/对位差（如实标代理口径）；growth 目标实体+训练反馈 | 审查组A/C 报告；matches.data 含 participants（players.js:171-189） |
| P1-8 | AI 上下文 | 历史报告结论/训练完成度/版本/位置/档案不回灌 prompt；ai_reports 只供人看 | ai:report 仅转发 payload | AI 无记忆、重复建议、不结合成长 | 主进程上下文组装器 aicontext.js + 记忆提示词 | ipc.js:395-414；aireport.js:44-49；审查组A §3 |
| P1-9 | 主动分析 | 仅选人 3 提醒；胜率异常/英雄下滑/位置短板/训练停滞/池结构 5 类触发缺失 | alerts 只挂 LCU onChange | "主动分析师"名不副实 | analyst.js 真实阈值触发+ingest/启动评估+去重节流+开关 | alerts.js:17-67；main.js:116 |

### P2
| # | 模块 | 问题 | 方案 | 证据 |
|---|---|---|---|---|
| P2-1 | queries.js | championMap 每 IPC 全表重建、无缓存层 | 内存缓存+db 版本失效 | queries.js:7-19,74,148,160,169,199,213 |
| P2-2 | tier.js/compare.js | 搜索无防抖/每键全量 IPC；compare 可本地过滤 | debounce+复用 data | tier.js:65；compare.js:34-36,86 |
| P2-3 | app.js boot | 首屏串行 6 IPC | 互不依赖者 Promise.all | app.js:279-290 |
| P2-4 | 全局 | 无离线探测/横幅 | online/offline 监听+网络调用短路+横幅 | net.js:7-28；全库无 navigator.onLine |
| P2-5 | home.js | 口径文案硬编码韩服翡翠+ | 随 region/tier 动态 | home.js:31,35 |
| P2-6 | 状态缺失 | home/champions/favorites/prep/vault 首屏无骨架；bp 撤销空历史 toast 而非禁用 | 补骨架/禁用态 | 审查组C ② |
| P2-7 | 视觉 token | 字号 20 种字面量/圆角 9+ 种/间距非 4 网格内联泛滥 | 阶段2 统一收敛 | nexus.css:497,57-58；审查组C ⑤ |
| P2-8 | 重复设计 | stat-card 四视图同套路；AI 卡 8 视图同构 | 阶段2/3 差异化布局 | home:34-38、vault:16-20、favorites:42、bp:215 |
| P2-9 | ai.js | 每次 logCall 全量同步写 ai-providers.json | debounce 合并写 | ai.js:22,83 |
| P2-10 | 筛选缺口 | player 战绩无英雄/胜负筛选；announcements/vault 日志无关键字 | 补筛选 | player.js:321；审查组C ③ |
| P2-11 | 返回链路 | counter→detail、detail→builds 反向入口缺 | 补返回/入口按钮 | 审查组C ④ |

### P3
| # | 模块 | 问题 | 方案 | 证据 |
|---|---|---|---|---|
| P3-1 | alerts.js | persist 非原子写 | tmp+rename | alerts.js:24 |
| P3-2 | 小字 | 9/10px badge 13 处、fs-12 滥用 | 阶段2 字号收敛≥11px | bp.js:216、champions.js:57 等 |
| P3-3 | prep.js | 笔记只读不可编辑 | 编辑入口 | prep.js:36 |
| P3-4 | update-engine | snapshot 每次 emit 4 COUNT | 缓存计数/节流 | update-engine.js:44-50 |
| P3-5 | player.js | drawChannels 立即+800ms 双查 | 合并 | player.js:134 |

## 三、模块成熟度结论（成熟不动清单）

tier / champions(补骨架) / counter / builds / bp / player / favorites / meta / lcu / vault / settings / announcements / aihub / update：数据真实、状态完备、口径标注齐全 → **保留，仅修上表点状缺口**。
需深度补：coach（记忆/主动）、replay（十人数据深度）、growth（目标闭环）、warroom（手动形状+维度入 AI）、detail/home/compare（事实性标注）。
整块规划缺口：本地知识库（落地）、联网检索（标记待确认）、英雄池管理（覆盖配置+UI 落地）。

## 四、合规复核（阶段8 预结论）

2026-11-20 安全审计整改仍有效：LCU 全 GET、符文写入禁用、无注入/内存/OCR/自动化（grep 复核见阶段8）；正式包客户端通道首装默认关；不宣称 ACE 通过。新增知识库内容须带来源与版本标签；联网检索涉第三方 ToS 与本机网络限制 → 只提方案不擅开发。

## 五、执行顺序

P0-1 → P1-1..P1-6（事实性/泄漏/日志/修剪）→ 阶段2 视觉 → 阶段3 报告补差（inferences/coach_summary/simulations+视觉权重）→ 阶段4（aicontext/analyst/池覆盖/replay 深度/KB）→ 阶段5 联动（ingest 事件/训练反馈/数据流图）→ 阶段6 点状打磨 → 阶段7 性能其余 → 阶段8 合规复核 → 阶段9 十六项实测+回归+验收报告+版本递增。不打包。
---

## 补充取证（2026-11-20 续）

### 闲置泄漏观测（10 分钟，10 采样）
渲染进程 idle 序列：heap 4.8→4.6MB 后恒定、DOM nodes 3629→3455 后恒定、listeners 恒 276、pending tasks 恒 0。
结论：**纯闲置无泄漏**。P1-1 的监听器累积发生在「视图切换」路径（旧视图 window 级订阅未销毁），而非闲置态；需在 rerender 增加 destroy 钩子（已列入 P1 修复批次）。

### 体验专项修复批次（v1.3.0，已实测）
- WeGame 接入人性化：normalizeCookie 宽容解析（raw/header/curl/json）+ preview 实时诊断 + 向导重做（方法A cURL 推荐 + 示例 + 白话报错）+ 验证失败下一步指引 + 更换凭证入口。
- 查询历史可删：players.deleteSearchHistory/clearSearchHistory + chips ×/清空。
- 克制互换：counter swap + params.enemy + detail 克制行跳转对位。
- 对比页：段位选择器 + 骨架 + catch/retry（修 P1-3）。
- 情报室手动侦察：修正 search {state,player} 解包（修 P1-4），同名候选不自动挑选。
- 首页/详情页来源标签随服务器自适应（修 P2-5 / P1-2 标签部分）。
实测：体验专项 27/27 断言全绿、22 视图回归 0 错误 0 重复请求、kr/cn 双分支标签核验通过。

### P0/P1 底层修复批次（已实测，源码 1.3.0）

| 项 | 修复 | 运行时取证 |
|---|---|---|
| P0-1 坏库恢复 | db.js 启动 quick_check；坏库改名留档 `.corrupt-*`→最新有效备份恢复→否则空库；config.dbRecovery 标记 + 首屏 toast | 坏库探针双分支实证：corrupt→fresh（留档+空库启动 0 异常）、corrupt→backup（recovery.kind=backup，173 英雄恢复，0 异常） |
| P1-1 视图订阅泄漏 | app.js rerender 前调 currentView.destroy?.()；coach/lcu/update/builds 返回 destroy | test-destroy 5/5：6 轮导航（24 视图渲染）JSEventListeners 恒 270 无上行漂移（HeapProfiler.collectGarbage 后取样） |
| P1-2 事实性标注 | detail/home sourceTag 随 region 自适应（srcKind/srcName）；加点提示 mainSkillHint 改由真实 skillOrder 统计主升，无顺序诚实 declines；修 order=[] 误判 truthy 渲染「前 0 级」 | probe-skill 5/5：ahri KR 真实徽章 WQEQQRQWQWRWWEE（实证旧「Q>W>E」臆造对该英雄错误）；无「通用原则」/「前 0 级」；views clean |
| P1-3 对比页 | compare 段位取 config + 骨架 + catch/retry | test-ux E1–E3 |
| P1-4 情报室手动形状 | warroom 解包 search {state,player|candidates}，同名不自动挑 | test-ux F1 |
| P1-5 日志轮转 | logger 5MB×3 轮转 + 异步 append（Promise 链） | 语法+启动核验 |
| P1-6 表修剪 | db.prune()：collection_logs 500 / ai_reports 200 / matches 每账号最近 200（ROW_NUMBER 窗口，SGP 可重拉，不动近期）；启动调用 | probe-prune 9/9：A 账号 250→保留最近 200（51..250）、B 账号 50 不动、logs 600→500、reports 250→200、integrity ok。persist debounce 移阶段7（需 flush-on-quit 防崩溃丢数据） |

**回归全绿（P0/P1 改动后）**：views 22 clean · functional 18/18 · bp-position 28/28 · buildplan 49/49 · ux 27/27 · destroy 5/5 · identity 13/13 · counter-ui 11/11。

**counter-ui  stale 测试修正（非回归）**：原 test-counter-ui 断言强度榜摘要 data.counters（syndra/zoe）+ 旧徽章文案「我方视角样本」，但视图实际渲染源是完整对位页 counter.matchup（有 rows 优先，detail.js:162 / counter.js:165 同源）——自 2026-11-19 全库采集（239 组 3144 条）后 browse/query/detail 均用对位页真实样本（kassadin 66%/53 场、fizz 37.9%/66 场，fromMatchup=true）。重写测试跟随真实渲染源（matchup 优先 + 摘要回退双路径），11/11 全绿。应用行为正确，UX 互换改动未触及数据源。

**测试纪律补充**：test-counter-ui/test-identity/test-auth/test-fixes/test-matchup-ui/test-cn-live 末尾 window.close() → 非 darwin 触发 app.quit（main.js:214-217）会关掉台架；回归须把这些「自闭合」套件排在最后或单独台架跑。bp-position 冷缓存首跑偶发 27/28（rapid-switch 计时），复跑 28/28 稳定。

### 阶段2 视觉系统统一（已实测，源码 1.3.0）

token 层本已成熟（深空石墨+冰蓝、--r-sm/md/lg/xl、--sp-1..7 4px 网格、--font-display/num/body、--shadow-1/2、--ease）。本轮做**收敛**而非重设计（守「成熟不动」）：
- **可读下限（P3-2）**：内联 font-size:9px/10px → 11px，29 处（badge 基类本为 11px，内联 9px 把它压到不可读）。覆盖 bp/champions/coach/counter/growth/intel-common/lcu/player/update/warroom 等。
- **圆角 token 化（P2-7）**：内联 border-radius 字面量 → var(--r-sm/md/lg)，59 处（3/5/6/7→sm、8/10/12→md、14→lg；50%/20px pill 不动）。8 种字面量收敛到 3 token。
- **键盘可访问性**：新增 :focus-visible 冰蓝焦点环（btn/chip/nav-item/win-btn/select/[data-picker]/a），仅键盘触发，鼠标点击不显示；输入框保留自身 :focus box-shadow。
- **规范注释**：CSS 内写明 canonical type scale（11/12/13/14/16/18/20/22+）+ radius token + 4px 间距网格，供后续开发遵循。
- **禁用项复核**：backdrop-filter=0（无玻璃拟态）；26 处 gradient 全部克制有目的（环境光 0.04α/数据条/评级徽章/主 CTA/splash 遮罩/skeleton）；发光仅限小状态点+hover 反馈，无满屏蓝框。
- **重复卡片（P2-8）**：stat-card/AI 卡同构问题移阶段3（AI 报告视觉权重）与阶段6 处理；其余视图布局已差异化（home viz-strip/player profile/counter 双栏/builds 面板），不为改而改。

实测：converge-v2 脚本报告 fs+29/radius+59；before/after 截图（champions/counter/builds）确认徽章可读、无溢出、布局 intact；views 22 clean + functional 18/18。新增 probe-shot.cjs（导航截图）/converge-v2.cjs（收敛脚本）。

### 阶段3 AI 报告引擎补差（已实测，源码 1.3.0， additive 不重做引擎）

在 1.2.0 结构化契约上**新增四节 + 视觉权重**，providers/routing/fallback/消毒降级全部不动：
- **深度推断 inferences**：{title/content/basis(现象)/reasoning(推理链)/alternative(其他可能)/confidence}，与 facts 严格分离（质量铁律 8），按 confidence 排序；渲染琥珀左栏卡 + 可信度条 + 现象/推理/其他可能行。
- **优势分析 strengths**：{title/content/basis/leverage(如何扩大)}，须数据支撑（铁律 9）；绿左栏卡 + 扩大优势行。
- **教练总结 coach_summary**：教练口吻一段话（肯定努力+点瓶颈+下一步聚焦，白话不端着，铁律 11）；摘要区冰蓝独立卡。
- **风险预警 risk_warnings**：{title/severity/trigger/consequence/mitigation}，按 severity 排序（铁律 10），与 data_limitations 区分；复用 sev 分级卡。旧 risk_assessment(字符串)保留兼容，有 warnings 优先渲染。
- **视觉权重**：facts 按 importance、diagnoses 按 severity 高→低排序；高重要事实加金色左栏（imp-high），中重要灰栏。
- **序列化**：toMarkdown/toHtml 增四节；parseResponse hasBody 纳入新字段；normalizeReport 全容忍解析（中文 severity/别名/字符串降级）。
- **XSS**：新字段全走 esc()；探针注入 script/iframe/onerror 实证 fired=0、无活体脚本/iframe/onerror 属性。

实测：probe-report-v3 **18/18**（后端 9：解析/排序/序列化/兼容；渲染 9：四节 DOM+视觉权重栏+TOC+XSS+旧报告兼容+零异常）；test-report **24/24** 回归；v3-report.png 确认教练卡/优势/推断/金栏专业渲染。新增 probe-report-v3.cjs/probe-report-shot.cjs。真实模型 e2e（test-report-e2e）后台跑待回。
