# NEXUS 数据流与模块联动图（阶段5）

> 只读架构：所有写入仅发生在本地 db / config / 文件；对游戏客户端仅 LCU/SGP **GET** 读取，绝不注入/写符文/改设置。
> 真实数据优先：每个结论可追溯到缓存真实字段或明确标注 curated/推断；样本不足诚实降级。

## 1. 采集 → 缓存（ingest）

```
LCU connector(已登录客户端) ──getMatchHistory──┐
SGP provider(凭据复用,深分页/跨区) ────────────┤
WeGame channel(用户自有Cookie,验证门控) ───────┤
                                              ▼
                              players.fetchHistory → normalize(LCU/SGP)
                                              ▼
                              players.cacheMatch → db.matches(含 participants/me/queueId/mode)
                                              ▼
                              events.emit('matches-ingested')  ← 联动触发点
```

- `matches.data` 存完整 JSON（含十人 participants）；列冗余 queueId/mode/win/championId 供快速过滤。
- **模式口径**：queueId 优先 + gameMode 兜底（analytics/replay.modeCategory）。LCU history 的 participants 仅本人；SGP 才有全十人。
- db.prune 每账号保留最近 200 场（ROW_NUMBER 窗口），collection_logs 500 / ai_reports 200。

## 2. 缓存 → 分析（analytics）

```
db.matches ──players.cachedMatches──┬─→ computeStats(按模式过滤后) ─→ rate(评级 S-D)
                                    ├─→ replay.analyzeMatch(同模式基准 + 十人 KP/伤害占比/对位差)
                                    ├─→ replay.growthReport(近期vs此前, 单模式隔离)
                                    └─→ analyst.compute(5类阈值触发)
OP.GG/101 champion_stats ─→ queries.currentFilter(版本/段位口径) ─→ aicontext / 各视图
```

## 3. 主动分析师闭环（analyst）

```
events 'matches-ingested' ─┐
启动 setTimeout(4s) ───────┼─→ analyst.evaluate(reason)
手动「重新评估」 ──────────┘        │
                                   ▼
                    compute() 5类: winrate/champion/position/training/pool
                                   ▼
                    analyst_state 去重(fingerprint)+6h节流+dismissed
                                   ▼
                    alerts.push(kind='analyst:*', meta.action)  ← 带行动入口
                                   ▼
        ┌──────────────┬───────────────────┐
        ▼              ▼                   ▼
   home 个人态势条   warroom 分析师面板   nexus-alert toast/live
   (行动按钮→视图)  (行动/忽略/开关)
```

- 训练停滞触发读取 `config['rpTrain:<reportId>']`；用户勾选完成 → 下次 compute 不再触发 → **闭环**。
- 开关 `config.analystEnabled`；关闭则 evaluate 跳过。

## 4. AI 记忆回灌闭环（aicontext → report → training → analyst）

```
ai:report(task,payload)
   ▼
aicontext.build = 档案(selfPuuid) + 形态(computeStats) + 池标签(player_pool)
                + 训练进度(rpTrain:*) + 历史结论(ai_reports 同subject) + KB方法论(kb.search)
   ▼  (预算2400截断, sources 可追溯)
aireport.buildPrompt(task,payload,contextBlock) + 质量铁律12(连续性)
   ▼
ai.chat → parseResponse → db.ai_reports(meta.context={memoryCount,sources})
   ▼
report-ui 头部「记忆 N 条历史结论」徽章(透明) + 训练勾选 bindTraining → config rpTrain:*
   ▼
rpTrain 回流 → aicontext(下次) + analyst.training(停滞判定)  ← 闭环
```

## 5. 知识库消费（kb）

```
data/seed/kb.json(curated+来源+版本标签) ─boot sync→ db.kb
   ├─→ kb.search(q,task) → aihub 检索面板(人读)
   ├─→ aicontext.build → AI prompt 方法论参考(机读)
   └─→ replay.drawKbTip(按本场死亡/参团/伤害/视野问题) → 复盘详情上下文提示
```

## 6. 英雄池管理（pool）

```
growth 池表格(熟练度/定位下拉) ─pool:set→ db.player_pool
   ├─→ pool:coverage(byChampion join 标签 + ≥2主力建议) → growth 徽章 + home 态势条
   └─→ aicontext.build [池管理] → AI prompt
```

## 7. 视图联动入口（linkage）

- home 态势条洞察行动 → replay/growth；「全部洞察」→ warroom。
- warroom 洞察行动 → replay/growth；忽略 → analyst.dismiss。
- replay 列表模式 chips → 同模式基准；详情十人徽章 + KB 提示 + AI 报告。
- growth 模式 chips → 单模式趋势；池表格 → player_pool；AI 报告训练勾选 → rpTrain。
- 报告历史弹窗 → meta.context 记忆徽章复现。

## 8. 边界与诚实性

- 无 selfPuuid：aicontext 标「未设本人账号」，不做个人化长期结论；home 态势条隐藏。
- LCU-only 历史：十人团队指标置空（teamKills=null），不臆造；仅 SGP 全十人可算 KP/伤害占比。
- 样本不足：computeStats/rate/growth/analyst 均降级并声明；KB 标 curated 非实时。
- AI 关闭/失败：规则降级明确标注，不冒充 AI。