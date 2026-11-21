# 国服战绩数据源专项研究（GUOFU_DATA）

> 目标：真实、合法、只读地获取国服玩家战绩。区分 LCU 与 SGP 两条通道。
> 本机无运行中的腾讯客户端，**实机返回需用户客户端验证**；以下接口结构来自公开实测资料与开源实现思路（非复制代码）。

## 1. 客户端身份与服务器识别（已实现思路）

从 `LeagueClientUx.exe` 命令行解析（PowerShell CIM）：
- `--app-port` / `--remoting-auth-token`：LCU 本地 HTTPS + Basic `riot:<token>`。
- `--riotclient-app-port` / `--riotclient-auth-token`：Riot Client 接口。
- `--region=TENCENT`：判定腾讯服。
- `--rso_platform_id=HN1`：**大区代码**（HN1=艾欧尼亚，CQ100=班德尔城 等）。
- `--t.lcdshost=hn1-sz-feapp.lol.qq.com`、`--t.league_edge_url=https://ledge-hn1.lol.qq.com:22019`：腾讯边缘服务主机线索。

→ NEXUS 解析 rso_platform_id + region 作为大区路由依据，缓存按 `sgp_server_id + puuid` 隔离，避免跨区串数据。

## 2. LCU 通道（本地客户端接口）

- 当前召唤师：`GET /lol-summoner/v1/current-summoner` → puuid / displayName / summonerLevel / profileIconId。
- 按名查召唤师：`GET /lol-summoner/v1/summoners?name=<name>`（同大区）。
- 战绩列表：`GET /lol-match-history/v1/products/lol/{puuid}/matches?begIndex=&endIndex=`。
  - **实测特性（HN1）**：首页 20 场正常；**begIndex>0 时腾讯 LCU 忽略分页、重复返回第一页**。故 LCU 仅用于首页 + 单局详情。
- 单局详情：`GET /lol-match-history/v1/games/{gameId}` → 完整 10 人参与者数据。
- 阶段：`GET /lol-gameflow/v1/gameflow-phase`；选人：`GET /lol-champ-select/v1/session`。

## 3. SGP 通道（战绩平台，支持深分页）

- **Token**：从 LCU 获取 entitlements accessToken（`GET /lol-entitlements/v1/entitlements`，内存持有，不落盘/不上送）。
- **请求**：`GET {sgpBase}/match-history-query/v1/products/lol/player/{puuid}/SUMMARY?startIndex=&count=`，Header `Authorization: Bearer <accessToken>`。
  - 实测（HN1）：startIndex/count 分页有效，可读取 500+ 场；返回完整参与者数组。
- **服务器地址**：
  - Riot 直营模式：`https://{platform}-red.lol.sgp.pvp.net`（如 na-red.lol.sgp.pvp.net）。
  - 腾讯大区：内置候选主机映射（按 rso_platform_id），**精确主机名需实测确认**；NEXUS 提供可配置映射 + 连通性探测。
- **归一化**：SGP 返回参与者数组 → 按所查 PUUID 定位本人 → 转换为统一 LCU 风格结构（英雄/KDA/召唤师技能/装备/胜负/金币/补刀/时长/主副符文），避免错用第一名玩家数据。
- **回退与终止**：SGP 失败 → 尝试 LCU；LCU 仍只返回已加载记录 → 可重试错误；正常空页 → 视为查完。不设 20 场硬上限，也不承诺服务端无限保留。

## 4. 统一玩家数据模型

```
Player { puuid, summonerId, name, tagLine, region/serverId, profileIconId, level,
         rank{tier,division,lp,wins,losses}, privacy, source, fetchedAt, confidence }
Match { gameId, queueId, mode, gameCreation, duration, participants[10], source, fetchedAt }
Participant { puuid, name, championId, position, win, kills,deaths,assists, cs, gold,
              damage, vision, items[6], spells[2], perks{primary,sub}, level }
PlayerStats { total, wins, winRate, avgKDA, avgK/D/A, byChampion[], byPosition[],
              recent10, recent20, streak, poolDepth, signatureChampions[] }
PowerRating { grade S/A/B/C/D, longTerm, recent, confidence, sampleSize, reasons[] }
```

## 5. 合规与安全边界

- 只读：不自动选/禁/配符文/接受对局/改设置/改文件/读内存/注入/绕反作弊。
- 不上传 LCU Token / 客户端密码 / API Key / Windows 凭据。
- 凭据仅内存；SGP 目标限定内置 HTTPS 地址，验证证书、禁止重定向。
- 隐私：玩家设私密战绩时如实显示「该玩家战绩私密/不可用」。
- 身份不确定（同名/改名/跨区）→ 允许用户手动确认，不强行关联。
- 无客户端/未登录 → 战绩功能显示「需连接并登录国服客户端」，不伪造数据。

## 6. 参考来源（许可证已核对，仅借鉴思路，未复制代码）

- lol-copilot/docs/match-history.md（2026-11-01 HN1 实测，LCU/SGP 分页对照）。
- LeagueAkari（MIT）：SGP match-history-query（startIndex/count + entitlements）、builtin 腾讯大区配置；README 明确不支持腾讯运营区 → 不作为国服最终方案，独立验证。
- Frank（sgpMatch.ts / aboutMatch.ts）：按大区选地址、Bearer token、LCU 取 entitlements、SGP 失败回退 LCU。
- Seraphine（GPLv3 禁商用）：同大区战绩查询、BP 自动查队友、国服兼容思路；不引入代码。
- Ninohana/lcu、Ezhana/lcu（Go）：GetSgpToken / NewSgpClient(token, 大区代码) 结构参考。