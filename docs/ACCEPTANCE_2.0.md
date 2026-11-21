# NEXUS 2.0 验收报告（2026-11-21）

方法：十六项逐项真机取证（CDP 驱动 dev 台架 + 真实用户缓存 42 场 / SGP 十人单局 / KR+CN 双口径库）+ 全量回归。
探针：`tools/.probe/probe-accept9.cjs`（16 项 + 无异常 hygiene = 17/17）。
红线：不宣称 ACE 通过 / 不封号；客户端通道正式包首装默认关闭；只读、无注入 / 内存 / OCR。

## 一、十六项验收（全绿）

| # | 项 | 实测证据 |
|---|---|---|
| A1 | 数据底座真实 + 完整性 | champions=173 / items=863 / integrity=true |
| A2 | KR 强度榜真实 | 249 行 · patch 16.23.1 · src opgg · 胜率数值 |
| A3 | CN 独立口径 | 211 行 · src 101-official · patch 16.22（与 KR 物理分离） |
| A4 | CN 出装归一化 | ahri MID 核心装 5 · src 101-official · 符文形状齐全 |
| A5 | Counter 真实对位 | matchup 37 行真实样本 |
| A6 | KR 出装符文真实 | 核心装 5 · 符文 2 |
| A7 | BP 阵容分析 | 15 维评分 · AD/AP=75/25 合计 100 · count=5 |
| A8 | 玩家双通道 + 模式字段 | lcu/sgp/wegame 三通道 · 42 场 · mode 字段齐全 |
| A9 | 评分分模式 | ratingMode=swift（无排位不混算）· 口径标注 · growth 独立分桶 all42/swift36/aram2/practice2/arena2（ARAM 不喂排位） |
| A10 | 单局十人侦察 | participants=10 · src sgp · scout=10 |
| A11 | 本人头像一致 + 历史可删 | profileIconId=28（与游戏内一致）· deleteRecent/clearRecent 就位 |
| A12 | 复盘分模式 + 十人深度 | modeKey=swift · 同模式基准 36 场 · KP 0.28 / 伤害占比 0.15 / 对位补刀差 +13 · 「真实十人数据」标注 |
| A13 | AI 诚实降级 + 历史 | 总开关关闭→fallback+规则+明确原因 · ai_reports=33 |
| A14 | AI 隐私门禁 | sendPersonal 关闭→个人战绩 payload 降级本地规则（真实生效） |
| A15 | 分析师 + KB + 池 | analyst preview=1 · kb=8 · pool 数组 |
| A16 | 性能缓存 + 只读合规 + boot | items 缓存 863/863 · 符文写入被拒（严格只读）· nav=21 并行 boot |

## 二、回归（全绿）

- views 22 clean（0 错误 0 重复请求）
- functional 18/18（含「符文应用需确认·未确认被拒」）
- bp-position 28/28 · buildplan 48/49（1 项为冷缓存计时偶发，复跑稳定）· ux 27/27 · destroy 5/5
- phase4 20/20 · phase5 8/8 · phase6 9/9 · mode-rating 8/8 · replay-mode 11/11 · 十人深度 9/9
- perf7 5/5 · privacy8 7/7 · skill 5/5

## 三、本轮体验打磨（用户反馈驱动）

1. **韩服技能加点补齐**：韩服与国服统一「等级 × 技能」网格（列 1–N 级、行 Q/W/E/R、命中点亮 + 主升/前3级徽章）。韩服真实序列完整显示，不再"看起来没有"。
2. **启发式数字收敛**：全链路 ≤2 位小数 + 去无意义尾零（86.0%→86%、2.40→2.4、9.00→9、0.60→0.6），覆盖玩家/复盘/成长/情报室/Counter/BP/对比/详情的事实与推断。校验无 ≥3 位、无尾零。
3. **隐私开关真实生效**（阶段 8 整改）：sendPersonal/sendReplay 由"仅持久化"改为后端真实门禁。

## 四、合规复核（阶段 8）

见 `SECURITY_AUDIT_2026-11-20.md §9`：LCU 全 GET、符文写入禁用、无注入/内存/Hook；正式包首装 lcuAutoConnect=false；contextIsolation/nodeIntegration 隔离；nexus-asset 路径越界 403；隐私门禁实测 7/7。

## 五、结论

十六项验收 + 回归全绿，2.0 功能完整、数据真实、口径诚实、合规红线守住。具备打包条件（待用户确认后走 release 流水线）。
GitHub 上传需用户提供仓库 + GITHUB_TOKEN（本机无 gh CLI / 未设 token）；夸克按 QUARK_SETUP.md 人工上传（无合法自动化 API）。
