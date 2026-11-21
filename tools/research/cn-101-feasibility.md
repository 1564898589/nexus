# 英雄联盟国服 101 攻略中心（101.qq.com）公开数据接口可行性调研

- 调研日期：2026-11-19（所有 curl 实测均于当日完成，本机中国大陆网络直连）
- 调研方式：只读。curl GET（常规浏览器 UA + `Referer: https://101.qq.com/`）+ WebFetch 抓取页面原文 + 前端 JS bundle 逆向阅读（仅读取公开静态 JS，未登录、未绕过任何访问控制）。
- 实测样本目录：`tools/research/samples/`（大文件已截断至前 200KB）。
- 当前游戏版本：**16.23**（2026-11-19 发布），榜单数据最新版本为 **16.22**（16.23 当日榜单尚未生成，前端自身也有"最新版本无数据自动回退上一版本"的逻辑）。

---

## 一、结论总表

| # | 数据 / 接口 | 结论 | 证据 |
|---|---|---|---|
| 1 | 英雄列表静态库 `hero_list.js` | **可行** | HTTP 200，144KB，样本 `hero_list.js` |
| 2 | 单英雄资料 `{id}.js` | **可行** | HTTP 200，60KB（id=1 安妮），样本 `hero_1.js` |
| 3 | 装备 / 符文 / 皮肤 / 召唤师技能 / 海克斯强化 / 分路字典静态库 | **可行** | 全部 HTTP 200，见 §2 |
| 4 | 版本列表 `versionlist` | **可行** | HTTP 200，27KB，样本 `versionlist.json` |
| 5 | 英雄强度榜（胜率/登场/禁用/T级/克制）`lol_101strategy` | **可行** | HTTP 200，22KB，样本 `resp_lol_101strategy_rank.json`；**lane 必须大写** |
| 6 | 出装 `lol_101strategy_build` | **可行** | HTTP 200，样本 `resp_101_build.json` |
| 7 | 符文 `lol_101strategy_runeinfo` | **可行** | HTTP 200，79KB，样本 `resp_101_runeinfo.json` |
| 8 | 技能胜率 `lol_101strategy_skill` | **可行** | HTTP 200，样本 `resp_101_skill.json` |
| 9 | 技能加点 `lol_101strategy_skill_point` | **可行** | HTTP 200，样本 `resp_101_skill_point.json` |
| 10 | 克制关系 `lol_101strategy_confront` | **可行** | HTTP 200，样本 `resp_101_confront.json` |
| 11 | 最佳搭档 `lol_101strategy_partner` | **可行** | HTTP 200，样本 `resp_101_partner.json` |
| 12 | 分段表现 `lol_101strategy_segment` | **可行** | HTTP 200，含黑铁→王者+峡谷之巅全段位，样本 `resp_101_segment.json` |
| 13 | 分路数据 `lol_101strategy_newlane` | **可行** | HTTP 200，样本 `resp_101_newlane.json` |
| 14 | 强度历史趋势 `lol_101strategy_trend` | **可行** | HTTP 200，近 8 个版本胜率，样本 `resp_101_trend.json` |
| 15 | 打野路线 `lol_101strategy_jungle` | **可行** | HTTP 200（需打野英雄+lane=JUNGLE），样本 `resp_101_jungle.json` |
| 16 | 对位 AI 数据 `lol_101strategy_ai_opponent` | **待验证** | 接口存在、参数被接受（code 0），但多组合实测均返回空串，见 §3.4 |
| 17 | 大乱斗(ARAM)英雄榜 `aram_hero_overview` | **可行** | HTTP 200，451KB 全英雄数据，样本 `resp_aram_hero_overview.json` |
| 18 | **海克斯大乱斗(ARAM Mayhem)英雄榜** `fuwen_aram_hero_rank_v2` | **可行** | HTTP 200，458KB，样本 `resp_fuwen_aram_hero_rank_v2.json` |
| 19 | **海克斯大乱斗强化(海克斯)榜** `fuwen_aram_rune_rank_v2` | **可行** | HTTP 200，24KB，样本 `resp_fuwen_aram_rune_rank_v2.json` |
| 20 | **海克斯大乱斗最佳拍档** `fuwen_aram_hero_parttner` | **可行** | HTTP 200，203KB，样本 `resp_fuwen_aram_hero_parttner.json` |
| 21 | **海克斯大乱斗单英雄详情** `fuwen_hero_rank` | **可行** | HTTP 200，35KB（出装/鞋子/强化等），样本 `resp_fuwen_hero_rank.json` |
| 22 | 经典模式英雄榜 `jade_hero_rank` | **可行** | HTTP 200，20KB（lane 小写 all），样本 `resp_jade_hero_rank.json` |
| 23 | 经典模式分路 `jade_hero_lane` | **可行** | HTTP 200，样本 `resp_jade_hero_lane.json` |
| 24 | 版本资讯 `versioninfo` | **可行** | HTTP 200（需 key 参数），样本 `resp_database_versioninfo.json` |
| 25 | 英雄改动历史 `hero_version_update` | **可行** | HTTP 200（hero=中文英雄名），样本 `resp_database_hero_version_update.json` |
| 26 | 版本详情 `versiondetail` | **待验证** | 实测 code 1005 参数错误，正确参数组合未确定，样本 `resp_database_versiondetail.json` |
| 27 | `zone/build_block` | **不可行（当前）** | HTTP 400，要求未知密钥参数 BK/RK，样本 `resp_zone_build_block.json` |
| 28 | 登录 / 签名 / 验证码 | **均不需要** | 上述全部可行接口仅凭普通 GET + UA + Referer 即返回完整数据 |

---

## 二、国服英雄基础资料静态资源（game.gtimg.cn CDN）

全部实测 HTTP 200，无需任何请求头即可访问（带浏览器 UA 更稳妥）。JSON 内容直接内嵌在 JS 文件中（纯 JSON，无 JSONP 包裹）。

| 资源 | URL | 实测大小 | 内容 | 样本 |
|---|---|---|---|---|
| 英雄列表 | `https://game.gtimg.cn/images/lol/act/img/js/heroList/hero_list.js` | 144,358 B | 全英雄 heroId/中文名/称号/英文别名/定位 roles/攻防法难度/周免标记/金币点券价格/关键词/头像与语音 URL | `hero_list.js` |
| 单英雄详情 | `https://game.gtimg.cn/images/lol/act/img/js/hero/{heroId}.js` | 60,065 B (id=1) | 基础属性（hp/mp/护甲/攻速等及成长值）、技能完整描述与数值、皮肤列表、使用技巧 | `hero_1.js` |
| 装备 | `https://game.gtimg.cn/images/lol/act/img/js/items/items.js` | 926,679 B | 全装备属性/价格/合成树 | `static_items.js`（截断） |
| 符文 | `https://game.gtimg.cn/images/lol/act/img/js/runeList/rune_list2.js` | 99,927 B | 符文树与全部符文 | `static_rune_list2.js` |
| 皮肤 | `https://game.gtimg.cn/images/lol/act/img/js/skins/skins.js` | 7,343,235 B | 全皮肤 | `static_skins.js`（截断） |
| 召唤师技能 | `https://game.gtimg.cn/images/lol/act/img/js/summonerskillList/summonerskill_list.js` | 17,799 B | 召唤师技能 | `static_summonerskill_list.js` |
| **海克斯强化字典** | `https://game.gtimg.cn/images/lol/act/img/js/kiwi/kiwi_augments.json` | 170,154 B | ARAM Mayhem 全部强化：id/中文名/品质(kPrismatic/kGold/kSilver)/tooltip/图标（内部代号 kiwi） | `static_kiwi_augments.json` |
| 英雄分路字典 | `https://lol.qq.com/act/lbp/common/guides/guideschampion_position.js` | 4,890 B | 英雄→官方推荐分路 | `static_guideschampion_position.js` |

注意：`heroId` 为国服官方数字 ID（与 Riot Data Dragon 的 key 基本一致，如 1=安妮、103=阿狸），`alias` 为英文别名（Annie），可直接用于与 Data Dragon 映射。

---

## 三、101.qq.com 统计 XHR 接口（核心发现）

### 3.1 网关与调用形态

101.qq.com 是 Vue3 SPA（hash 路由），页面壳 HTML 中写明：

```
window.ZMProjectConfig = {"project_name":"lolstrategy","release_url":"https://lol.qq.com/lolstrategy/","ZMSERVICE":"https://mlol.qt.qq.com",...}
```

- **API 网关：`https://mlol.qt.qq.com`**（掌盟后端），全部为 **GET + URL 查询参数**，前端用原生 `fetch(url)` 裸调用（逆向主 bundle `strategy-BKub8if5.js` 确认：无自定义签名头、无 token、无 cookie 依赖）。
- 统计类接口统一走 ODP 代理：`/go/battle_info/odp_proxy/{数据集名}`。
- 响应外壳固定：`{"code":0,"data":{"_fieldValues":{"R#####":"<内层JSON字符串>"}},"result":"<同内容>","errMsg":"","msg":"","result":0}`。**真实数据在 `_fieldValues` 唯一键（如 R17960）的内层 JSON 字符串里**，需二次 `JSON.parse`；内层多为 `#`/`_`/`|`/`,` 分隔的紧凑字符串，需按前端解析器拆分。
- 主 bundle 与路由 chunk 均为公开静态文件（`https://lol.qq.com/lolstrategy/assets/20261118/*.js`），已存样本。

### 3.2 公共参数

| 参数 | 取值 | 说明 |
|---|---|---|
| `version_id` | 版本名，如 `16.22` | **不是**数字 id、vkey 或 key（实测 232/20261119/lol_20261105_231 均返回空）。取自 versionlist 的 `name` 字段 |
| `itier` | 段位码 | `255`=所有段位，`88`=峡谷之巅，`10`=王者，`29`=宗师，`28`=大师+，`8`=大师，`27`=钻石+，`7`=钻石，`26`=翡翠+（站点默认），`6`=翡翠，`25`=铂金+，`5`=铂金，`24`=黄金+，`4`=黄金，`3`=白银，`2`=黄铜，`1`=黑铁 |
| `lane` | **召唤师峡谷数据集必须大写**：`ALL/TOP/JUNGLE/MIDDLE/BOTTOM/SUPPORT` | 小写 `all/mid` 实测返回空串（失败样本 `fail_rank_lowercase_lane.json`）。注意 `mid` 对应 `MIDDLE`。经典模式 jade 数据集反而用小写 `all` |
| `championid` | 英雄数字 ID | 详情类接口必填 |
| `sort_metric` / `sort_order` | 榜单固定 `1` / `2` | 前端写死 |
| `dtstatdate` | `YYYYMMDD` | ARAM/海克斯/经典类接口必填，取**昨天**的日期（前端逻辑 `new Date()-1`）；峡谷详情类不需要 |

### 3.3 召唤师峡谷（排位）接口清单 —— 全部实测可行

基址 `https://mlol.qt.qq.com/go/battle_info/odp_proxy/`，测试参数 `itier=26&version_id=16.22&lane=MIDDLE&championid=103`（阿狸中单，翡翠+）：

| 数据集 | 用途 | 内层结构（实测样本） |
|---|---|---|
| `lol_101strategy` | **英雄强度总榜**（无需 championid） | `dtstatdate` + `datadetails`：`排名_英雄ID_T级_分路_胜率_登场率_禁用率_克制英雄ID列表_排名变化_日均热度 surge_是否热门`，`#` 分隔。含全部英雄×分路 |
| `lol_101strategy_build` | 出装 | `starting_details`(出门装)/`shoes_details`(鞋)/`core_details`(优先成装)/`forth/fifth/sixth_details`(后续件)：`装备ID[,组合]_序号_选取率_胜率` |
| `lol_101strategy_runeinfo` | 符文 | `rune_top_details`：`主系_基石_胜负标记_完整符文ID序列_选取率_胜率_样本场次`（79KB，含大量组合） |
| `lol_101strategy_skill` | 技能胜率 | `data_details`：`技能位_?_胜率_使用占比` |
| `lol_101strategy_skill_point` | 技能加点 | `detaildetails`：`加点顺序序列:选取率:胜率@...`（前 3 级与 1-15 级序列） |
| `lol_101strategy_confront` | **克制关系** | `low_op_details`/`high_op_details`：`序号_对手ID_对线胜率_胜率差值` |
| `lol_101strategy_partner` | 最佳搭档 | `data_details`：`序号_队友ID_组合胜率_场次_胜场` |
| `lol_101strategy_segment` | **分段表现**（需 lane） | `datadetails`：`段位码_胜率_登场率_禁用率`，覆盖 1-10、24-28、88(峡谷之巅)、255(全段位) |
| `lol_101strategy_newlane` | 分路分布 | `lane_details`：`MIDDLE：登场率_胜率_占比_T级_排名_分路占比` |
| `lol_101strategy_trend` | 强度趋势（参数 itier/lane/championid，无需 version_id） | `history_strength_trend`：`16.22_51.46#16.21_51.26#...` 近 8 版本胜率 |
| `lol_101strategy_jungle` | 打野路线（打野英雄，lane=JUNGLE，实测 id=64） | `data_details`：`255*100:[序号_野怪营地顺序_场次_占比_胜率#...]` |

辅助接口（同网关）：

| URL | 用途 | 实测 |
|---|---|---|
| `/go/database/versionlist?zone=lol&from=h5` | 全部版本列表：`id/name(16.23)/vkey(20261119)/public_date/key` | 200，27KB |
| `/go/database/versioninfo?key=lol_20261105_231&zone=lol&from=h5` | 版本资讯 banner/feeds | 200 |
| `/go/database/hero_version_update?hero=安妮&mode=召唤师峡谷&zone=lol&from=h5` | 英雄历史改动说明（hero 用**中文常用名**即 hero_list 的 `title` 字段，用 championid 或称号均报错） | 200 |

### 3.4 待验证 / 不可行项

- **`lol_101strategy_ai_opponent`**（参数 itier/version_id/lane/championid）：接口存在且 code=0，但实测 `103/MIDDLE/26`、`103/ALL/255`、`103/ALL/88`、`86/TOP/26`、`238/MIDDLE/255`、`16.23` 等组合全部返回空串（样本 `resp_101_ai_opponent.json`）。推测为新上线数据集尚未灌数或仅覆盖特定英雄。**结论：待验证**，不要依赖。
- **`/go/database/versiondetail`**：`key`/`key+id` 组合均返回 code 1005 参数错误，正确参数未确定（前端调用点在未下载的 chunk 中）。版本内容可用 `versioninfo` 替代。**待验证**。
- **`/go/zone/build_block`**：HTTP 400，服务端校验要求 `BK`、`RK` 两个必填密钥参数（疑似内部业务 key），公开渠道无法获得。**不可行**。

---

## 四、大乱斗 / 海克斯大乱斗（ARAM Mayhem）—— 官方有完整统计入口

101.qq.com 路由实测存在（主 bundle 路由表）：`/#/rankings/rift`（峡谷）、`/#/rankings/hextech`（**海克斯大乱斗**，页面标题"海克斯大乱斗英雄榜｜海斗胜率与强势英雄"，含海克斯榜/英雄榜/最佳拍档榜三个 tab）、`/#/rankings/aram`（普通大乱斗）、`/#/rankings/classic`（经典模式）、`/#/hero-detail?heroId=103&mode=hextech`。

全部实测 HTTP 200 且有完整数据（`dtstatdate=20261118`，即 T-1 日更）：

| URL（基址同上 odp_proxy） | 参数 | 内容 |
|---|---|---|
| `aram_hero_overview` | `dtstatdate` | 普通 ARAM 全英雄：rank/win_rate/pick_rate(小数)/avg_damage_ratio/avg_tank_ratio/best_partner_top50 |
| `fuwen_aram_hero_rank_v2` | `dtstatdate` | **海克斯大乱斗英雄榜**：胜率/登场率/排名变化/最佳搭档（458KB 全量） |
| `fuwen_aram_rune_rank_v2` | `augmentid_level=255&dtstatdate` | **海克斯强化榜**：`强化ID_品质_选取率_排名_..._胜率_..._最佳英雄ID列表`（255=全品质，可按品质过滤） |
| `fuwen_aram_hero_parttner` | `role1=255&role2=255&championid=255&dtstatdate` | **双人组合榜**：`英雄A;英雄B;定位;定位;组合胜率;登场率;排名`（255=不限，可指定单英雄） |
| `fuwen_hero_rank` | `championid=103&dtstatdate` | **海克斯大乱斗单英雄详情**：鞋子/出装/强化选取率胜率等（35KB） |
| `jade_hero_rank` | `itier=255&lane=all&dtstatdate` | 经典模式英雄榜（英雄 ID 为 60000+原 ID） |
| `jade_hero_lane` | `itype=255&dtstatdate` | 经典模式英雄分路 |

强化名称/图标/tooltip 字典：`kiwi_augments.json`（§2）。**海克斯大乱斗资料+统计在腾讯官方公开页面完全可得，无需任何第三方。**

---

## 五、数据口径

- **服务器范围**：国服（CN）排位数据。段位过滤中"峡谷之巅"（itier=88）是**独立口径**，与常规段位（黑铁~王者）并列；`255`=所有段位汇总。segment 接口同时返回常规段位、"+"段位、88、255 各行，证明峡谷之巅单独统计。页面与 bundle 中未见更细的"仅艾欧尼亚"之类服务器限定说明。
- **段位范围**：默认展示翡翠+（前端 store `filterTier:"26"`），可切换黑铁~王者/峡谷之巅/全段位。
- **更新频率**（以实测 `dtstatdate` 字段为证）：
  - 详情类（符文/出装/技能/搭档/分段/趋势）：T-1 日更（今日 11-19，数据 20261118）；
  - 强度总榜/克制/分路：观测为 20261116（约 T-3，按版本窗口滚动）；打野路线 20261117；
  - ARAM/海克斯/经典：T-1 日更（前端显式请求昨日日期）；
  - 版本列表：每两周一个新版本（16.22→2026-11-05，16.23→2026-11-19）；新版本发布当日榜单可能为空，前端自动回退上一版本。
- **版本号字段**：`version_id`=版本名（16.22）；versionlist 提供 `id`/`vkey`(日期)/`key`(lol_日期_id)；各响应内层含 `dtstatdate` 统计日期。

---

## 六、合规与使用限制

| 项 | 实测结果 |
|---|---|
| `101.qq.com/robots.txt` | **不存在**（返回腾讯 404 公益页，HTTP 200 软 404） |
| `mlol.qt.qq.com/robots.txt` | **不存在**（nginx 404） |
| `lol.qq.com/robots.txt` | `User-agent: * / Disallow:`（**完全允许**） |
| `game.gtimg.cn/robots.txt` | 无 `*` 规则，但**明确 Disallow 一批 AI 爬虫**：openai/gptbot/chatgpt-user/claudebot/Bytespider/perplexitybot/360spider/YisouSpider/shenmaspider 等（样本 `gtimg_robots.txt`）。普通应用 UA 不在禁止列表 |
| 登录/签名/验证码 | 全部可行接口**均无**；无 CORS 限制问题（本地 Electron 主进程发起请求不受浏览器 CORS 约束） |
| 明文禁止抓取条款 | 页面与 bundle 中未发现专门 API 条款；但腾讯游戏用户协议一般性禁止未经许可的自动化抓取与商业性再分发 |

**风险与建议（NEXUS 本地优先场景）**：
1. 这些是**内部未公开文档接口**（odp_proxy），无 SLA：数据集键名（R#####）、参数大小写规则、内层分隔格式随时可能变。必须把解析器做成可配置/可热修，并保留原始响应缓存。
2. 建议频率：静态字典每版本拉一次；统计类每日 1 次（T-1 数据日内不变），全英雄详情按需懒加载+本地缓存；并发 ≤2、请求间隔 ≥1s，带正常 UA 与 Referer，不做高频轮询。
3. 定位个人/非商业工具、本地缓存、注明数据来源"腾讯 101 攻略中心"，不再分发原始数据，可显著降低合规风险；商业化前需取得腾讯许可。
4. gtimg robots 对 AI 爬虫的封禁表明腾讯对自动化访问敏感，避免使用任何 bot 类 UA。
5. 关键坑：**lane 大小写**（峡谷大写 MIDDLE、经典小写 all）、**version_id 用版本名**、**hero_version_update 用中文英雄名**、新版本首日榜单为空需回退。

---

## 七、证据索引（samples/ 目录）

- 页面与代码：`101_home.html`、`strategy_bundle.js`（截断）、`chunk_HeroDetailView-dJaiOfIL.js`（截断）、`chunk_AramRankView-C3KXmUWG.js`、`chunk_HextechRankView-Zf5B9jmS.js`、`chunk_AugmentPopover.js`、`chunk_ClassicRankView-rxtuCYBf.js`、`chunk_VersionView.js`、`chunk_index-*.js`
- 静态字典：`hero_list.js`、`hero_1.js`、`static_items.js`、`static_rune_list2.js`、`static_skins.js`、`static_summonerskill_list.js`、`static_kiwi_augments.json`、`static_guideschampion_position.js`
- 峡谷统计：`versionlist.json`、`resp_lol_101strategy_rank.json`、`resp_101_{build,runeinfo,skill,skill_point,confront,partner,segment,newlane,trend,jungle,ai_opponent}.json`
- 大乱斗/海克斯/经典：`resp_aram_hero_overview.json`、`resp_fuwen_aram_hero_rank_v2.json`、`resp_fuwen_aram_rune_rank_v2.json`、`resp_fuwen_aram_hero_parttner.json`、`resp_fuwen_hero_rank.json`、`resp_jade_hero_rank.json`、`resp_jade_hero_lane.json`
- 辅助/失败证据：`resp_database_versioninfo.json`、`resp_database_hero_version_update.json`、`resp_database_versiondetail.json`(1005)、`resp_zone_build_block.json`(400)、`fail_rank_lowercase_lane.json`(空结果对照)、`gtimg_robots.txt`

所有请求统一使用：`User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) ... Chrome/126.0.0.0 Safari/537.36`，`Referer: https://101.qq.com/`，curl GET，无 cookie、无登录。