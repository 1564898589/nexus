# NEXUS 技术调研记录（RESEARCH）

> 本文件记录开发前的开源项目调研、许可证核对、数据源可行性验证，以及本机环境限制。
> 所有结论区分「已验证」与「未验证/受限」。NEXUS 全部代码为原创实现，**未复制任何第三方项目源码**。

## 0. 本机环境限制（重要）

- 命令行访问 GitHub（`github.com` / `raw.githubusercontent.com`）被网络环境阻断：`git clone`、`curl raw`、`gh` 均失败。
- 因此**无法直接拉取并逐行审阅** Seraphine / LeagueAkari 的源码与 LICENSE 文件原文。
- 调研改用 WebSearch 获取项目 README、许可证声明与架构描述（含 Gitee 镜像、第三方技术文档）。
- npmmirror（`registry.npmmirror.com`）与 Electron 二进制镜像可用，依赖安装成功。
- Riot Data Dragon（`ddragon.leagueoflegends.com`）与 OP.GG 公开页面（`op.gg`）可正常访问，已实测取数。

> 诚实声明：由于 GitHub 直连受限，许可证信息来自项目公开 README / 镜像 / 权威聚合页，而非本地逐字核对 LICENSE 原文。
> 这不影响「不复制代码」的合规结论——NEXUS 仅借鉴通用技术思路（LCU 本地接口、进程发现、双引擎分离），全部独立实现。

## 1. Seraphine（github.com/Zzaphkiel/Seraphine）

- 定位：基于 LCU API 的英雄联盟战绩查询 / 智能 BP 工具，Python 桌面应用。
- 技术栈：Python3 + PyQt5 + Fluent Widgets（qfluentwidgets）。
- 许可证：**GPLv3**，且明确**禁止商用**（源代码与二进制均不可商用）。
  - 来源：项目 README「许可证」段（Gitee 镜像与 GitHub 页面一致）。
- 目录结构（据公开资料）：
  - `app/lol/`：LCU 对接核心（连接、战绩、BP、符文）。
  - `app/view/`：界面；`app/components/`：通用组件；`app/common/`：配置与工具。
- 关键做法（借鉴思路，非复制）：
  - 客户端自动发现 + LCU 本地 HTTPS（自签名证书）+ Basic 认证 `riot:<token>`。
  - 战绩查询、BP 阶段读取、OP.GG 数据展示、出装符文、符文自动配置（需用户触发）。
  - 国服兼容处理与异常重连。
  - 游戏资源走 CommunityDragon / Data Dragon。
- 对 NEXUS 的启示：LCU 连接/发现/重连模式、OP.GG 与 LCU 数据组合方式、符文配置需确认。
- 合规处理：因 GPLv3 + 禁商用，**不引入其任何代码**；NEXUS 以 MIT 原创实现同类通用技术。

## 2. LeagueAkari（github.com/LeagueAkari/LeagueAkari）

- 定位：功能全面的英雄联盟 LCU 工具集（战绩、自动秒选等）。
- 技术栈：**Electron + Vue 3 + TypeScript**，electron-vite 构建，electron-builder 打包；SQLite 持久化；可选 Node 原生模块（需 MSVC / node-gyp）。
- 许可证：**MIT**（据 Hysen Labs 聚合页与项目手册；个别 Gitee 镜像 README 徽标显示 GPL-3.0，存在不一致，以官方仓库为准）。
- 国服立场：**官方 README 明确不支持腾讯运营服务器**（Hysen Labs：「Tencent-operated servers are explicitly not supported」）。
  - 注：个别 fork 的英文 README 声称战绩「支持腾讯与非腾讯客户端」，属分支差异，**未经独立验证，不作为国服适配依据**。
- 架构要点（借鉴思路）：主进程/渲染进程分离、LCU 连接管理、客户端事件订阅、自动重连、SQLite 数据模型、桌面工程化与构建流程。
- 对 NEXUS 的启示：Electron 双进程架构、本地 SQLite、事件驱动重连。
- 合规处理：**不直接复制代码**；**不假设其接口实现可用于国服**；国服兼容性由 NEXUS 独立验证。

## 3. 其他参考

- LCU 通用文档：Riot Developer Docs（LCU）、hextechdocs.dev、mingweisamuel/lcu-schema、CommunityDragon。
- Riot 官方立场：LCU **并非正式支持的第三方 API**，不保证文档/稳定性/变更通知。NEXUS 据此做优雅降级与端点可用性如实展示。

## 4. 数据源可行性（已实测）

### OP.GG 韩服统计 —— 已验证可用
- 旧版 JSON API 多已 404；真实数据嵌于公开页面的 Next.js RSC flight 载荷（`self.__next_f.push`）。
- NEXUS 自研解析器提取：强度榜（173 英雄 / 244 条位置统计）、胜率/登场率/禁用率/梯队/排名/Counter、出装/符文/召唤师技能/加点。
- 实测样本：版本 **16.23.1**，样本量 **156,852**；阿狸 MID T1 胜率 53.4%，Counter 佐伊/卡特/劫；核心出装  malignance→shadowflame→zhonya（登场 22.06% / 胜率 55.02% / 229 场）。
- 每条记录保存：来源(opgg)、服务器(kr)、段位(emerald_plus)、版本、采集时间、样本量。
- **ToS  caveat**：OP.GG 服务条款页面未能取得（terms URL 404）。本软件以解析公开页面方式取数，属非官方用途，**可能与其 ToS 冲突**；仅供个人学习研究，不绕过验证码/登录/反爬。来源失效时保留旧数据并提供官方跳转，绝不伪造。

### Riot Data Dragon —— 已验证可用
- 官方公开静态库，zh_CN 中文：英雄/技能/装备/符文/召唤师技能/原画/图标。
- 注意 zh_CN 字段quirk：`title` 才是英雄名（阿狸），`name` 是称号（九尾妖狐）；`id` 是字符串键，`key` 是数字 ID。NEXUS 已正确映射。

### LCU 本地接口 —— 部分验证
- 无客户端路径已验证：NEXUS 正常运行、LCU 优雅降级、其他功能不受影响。
- 进程发现（PowerShell `Get-CimInstance Win32_Process` 解析 `--app-port`/`--remoting-auth-token`/`--install-directory`）+ lockfile 回退（含腾讯常见安装路径）已实现。
- **国服实机验证需用户运行中的腾讯客户端**，开发机无法代为完成；NEXUS 如实展示每个端点探测结果，不把非腾讯服成功当作国服成功。

## 5. 验收对照（详见测试报告）

- 18/18 功能验收通过（启动取数、强度榜、BP 交互+分析、保存/载入、收藏、Counter 分离、备份/恢复 round-trip、质量检查、完整性、采集日志、LCU 降级、搜索、符文确认门禁）。
- 11 个视图全部零控制台错误渲染。