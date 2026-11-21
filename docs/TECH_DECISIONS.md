# NEXUS 技术选型与架构决策（TECH_DECISIONS）

## 1. 桌面框架：Electron（而非 Tauri）

| 维度 | Electron | Tauri |
|---|---|---|
| 本机工具链 | Node 24 已具备，npmmirror 可装 | 需 Rust 工具链（本机缺失） |
| 二进制下载 | npmmirror Electron 镜像可用 | 依赖 GitHub Release（被阻断） |
| LCU 本地 HTTPS | Node `https` 直接支持自签名 | 需额外 Rust crate |
| 参考生态 | LeagueAkari 即 Electron+Vue | — |

**决策：Electron 45**。理由：本机无 Rust、GitHub 被墙，Electron 经镜像可完整安装与打包；Node 原生支持 LCU 所需的自签名 HTTPS 与 Basic 认证。已实测 `electron.exe v45.3.4` 启动正常。

## 2. 本地数据库：sql.js（WASM SQLite，而非 better-sqlite3）

- better-sqlite3 的预编译二进制从 GitHub Release 下载（被阻断），源码编译需 MSVC/node-gyp（本机不一定具备）。
- **sql.js** 为纯 WASM SQLite，npm 即可安装，无需原生编译。
- 持久化：`db.export()` → 写 `.tmp` → `rename` 原子落盘；事务 `BEGIN/COMMIT/ROLLBACK`；`PRAGMA integrity_check` 完整性校验。
- 代价：全库驻留内存（当前 ~2.8MB，可接受）；写入需手动 persist（已在事务/备份/恢复处统一处理）。

## 3. 渲染层：原生 ES Modules + 自绘 CSS/SVG（无构建步骤）

- 不引入 React/Vue/打包器：减少依赖与构建失败面，file:// 直接加载 ESM。
- 自绘 SVG 图表（雷达/环形/仪表/条形），无图表库依赖。
- 字体本地化：@fontsource Chakra Petch（标题）+ Rajdhani（数字）woff2 拷入 renderer/fonts；中文走系统 Microsoft YaHei。
- 自定义 `nexus-asset://` 协议服务本地缓存素材（标准/secure/stream），CSP 严格限制 `script-src 'self'`，图片错误用全局捕获监听降级（不用内联 onerror）。

## 4. 双引擎数据架构（核心）

```
OP.GG ENGINE（统计）          LCU ENGINE（客户端状态）
  强度/胜率/登场/禁用            运行/登录/账号/服务器
  梯队/Counter/出装/符文         阶段/大厅/队列/BP/禁用选用
  加点                          队友对手/本地符文/游戏阶段
        \                          /
         统一数据模型（每条带来源标识）
                    |
            战术分析模块（启发式 + 真实统计分离）
```

- 两引擎彻底分离，**不互相伪装**：LCU 未提供的数据不冒充客户端数据；OP.GG 统计不冒充 LCU 数据。
- 每条记录保存来源/服务器/段位/版本/采集时间/样本量；缺失字段标「未知/—」，不猜测。
- 不同服务器/段位/位置数据绝不混合（DB 主键含 region+tierFilter+position+patch）。
- 缓存不包装成实时：UI 分别显示「统计采集时间」与「客户端更新时间」。

## 5. 数据更新引擎（NEXUS DATA ENGINE）

- 新鲜度状态：fresh / cached / stale / updating / failed / empty。
- 自动（按间隔）+ 手动 + 首次启动空库自动取数；失败重试退避；**失败保留旧数据**。
- 采集流程：强度榜 → DD 静态 → 各位置出装 → 素材增量下载 → 事务写入 → 完整性校验 → 落盘；任一步失败回滚。
- 全程写 collection_logs（任务/来源/起止/获取/成功/失败/状态/错误/耗时）。

## 6. LCU 引擎安全边界

- 仅本机客户端本地接口；进程发现（PowerShell CIM）+ lockfile 回退（含腾讯路径）。
- 自签名 HTTPS（rejectUnauthorized:false，仅 127.0.0.1）+ Basic `riot:<token>`。
- 默认只读；**应用符文等写操作必须用户弹窗确认**（IPC 与引擎双重门禁）。
- 不读内存/不注入/不改文件/不绕反作弊；退出断开、自动重连。
- 国服独立适配层：detectTencent + 逐端点探测如实展示；非腾讯服成功≠国服成功。

## 7. AI 战术分析

- 规则启发式（英雄机制标签分类 + 阵容维度评分），**非** OP.GG 统计，UI 全程标注「启发式分析」。
- 真实数据（OP.GG）与推理（启发式）在每一处输出中分开。
- 不依赖任何在线模型；可选模型接口预留但非必需。

## 8. 备份 / 恢复 / 质量

- 备份到用户数据目录，创建前完整性校验；保留 N 份自动清理。
- 恢复前自动 pre-restore 快照，可回滚；恢复后 db.reload()。
- 质量检查：孤儿统计/非法 ID/数值越界/未知装备/版本不一致/来源混合/陈旧/空表/重复。
- 卸载默认保留用户数据库与备份（NSIS 不删 userData）。

## 9. 打包

- electron-builder NSIS：可选安装目录、桌面快捷方式、非一键（允许用户选择）。
- 镜像：electron_builder_binaries_mirror 指向 npmmirror。
- 随包附带 data/seed（真实韩服数据 + 素材），首启自动导入用户目录，离线即用。
- 若二进制镜像受限导致 NSIS 失败，提供 portable 目录版 + 启动器作为兜底（如实说明）。

## 10. 合规

- 全部代码原创（MIT）；不复制 Seraphine（GPLv3 禁商用）/ LeagueAkari（MIT）源码。
- 不制作外挂/不读内存/不注入/不自动操作游戏；不伪造数据；不绕验证码/登录/反爬。
- 日志不记录密码/令牌；密钥不硬编码；不静默执行危险命令；不随意删用户文件；不未经确认覆盖重要数据。