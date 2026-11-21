# NEXUS 反作弊与账号安全专项审计（2026-11-20）

范围：1.1.0 源码（electron/ + renderer/ + 构建配置）。方法：代码级逐文件取证 + 本机实测回归。
**红线声明：本审计是代码级自查。NEXUS 未通过、也无法自行验证腾讯 ACE 安全检测；未经腾讯正式确认，不宣称绝对安全、不保证不会封号。**

## 1. 游戏进程交互清单

NEXUS 不与游戏对局进程（League of Legends.exe）发生任何交互。仅与**客户端**（LeagueClientUx.exe）的本地暴露接口及本机公开信息交互，全部只读：

| 交互 | 位置 | 性质 |
|---|---|---|
| CIM 枚举 LeagueClientUx 进程（PID/命令行/路径） | electron/lcu/connector.js:45 | 只读查询 |
| Get-Process 路径补读 | connector.js:57 | 只读查询 |
| `process.kill(pid, 0)` 存活探测 | connector.js:138-140 | 仅存在性检查，不发送信号、不终止进程 |
| 注册表 HKCU\Software\Tencent\LOL 读取 | connector.js:91 | 只读（当前用户键，无需提权） |
| 客户端本地日志 *_LeagueClientUx.log 读取 | connector.js:113-137 | 只读；凭据仅内存使用，不写盘不上传 |
| lockfile 读取（标准路径+常见腾讯布局） | connector.js:28-39,143-163 | 只读 |
| LCU 本地 HTTPS（127.0.0.1） | connector.js:190-223 | **全部 GET**；无 POST/PUT/DELETE |
| Riot Client 端口 /entitlements/v1/token | connector.js:381 | GET；令牌仅内存 |

客户端写操作（符文应用）已被产品策略禁用：`applyRunes()` 直接抛错（connector.js:393-395），functional 套件实测「未确认被拒」。

## 2. 所有数据接口及授权情况

| 接口 | 授权状态 | 说明 |
|---|---|---|
| OP.GG 公开页面（op.gg） | 公开数据、无鉴权 | 非官方集成，合规注释见 electron/providers/opgg.js:8；仅采集公开统计 |
| Riot Data Dragon（ddragon.leagueoflegends.com） | 官方公开静态库 | 英雄/图标/本地化 |
| 腾讯 101（101.qq.com / mlol.qt.qq.com） | 公开 web 数据、无鉴权 | 国服公开榜单/出装 |
| LCU 本地接口 | **Riot 明示非正式支持；腾讯使用政策未确认** | 实验性；正式包首装默认不自动连接（见 §7） |
| 腾讯 SGP（*.lol.qq.com / *.sgp.pvp.net） | 用户自身客户端会话令牌 | 令牌来自本机客户端、仅内存；随客户端通道默认关闭 |
| WeGame（wegame.com.cn） | 用户主动提供自有 Cookie | 独立通道、显式连接；DPAPI 加密存储 |
| GitHub API（api.github.com） | 公开 | 仅更新检查 |
| 夸克镜像/本地目录 | 用户自行配置 | 更新兜底 |
| AI 模型服务 | 用户自行配置密钥 | 可选；密钥 DPAPI 加密；未配置走规则引擎 |

**技术上可调用 ≠ 符合腾讯使用政策。** LCU/SGP 国服适用性已本机实测（30/30），但合规性未经腾讯确认，按实验性功能管理。

## 3. 本地数据读取范围

- 自身 userData 目录：nexus.db、config.json、logs、backups、access-lock.json、device-trust.json。
- HKCU\Software\Tencent\LOL（安装路径）。
- 客户端安装目录下的 lockfile 与 LeagueClientUx 日志（只读）。
- 系统进程列表（仅 LeagueClientUx 过滤查询）。
- **不读**游戏内存、不读其他应用数据、不读浏览器历史/密码库、不扫无关目录。

## 4. 是否存在注入 / Hook / 内存读写

**不存在。** 全仓 grep 无 DLL/进程注入、无 Read/WriteProcessMemory、无 CreateRemoteThread、无 Hook、无 ffi/native 模块、无驱动、无 SendInput/键鼠自动化。依赖仅 sql.js（WASM）与 @fontsource 字体，无 native addon。更新链的 powershell 仅用于 Get-CimInstance/Get-ItemProperty/Get-AuthenticodeSignature 等只读 cmdlet（签名工具另含 Set-AuthenticodeSignature，仅开发期自签用，不随用户运行触发）。

## 5. 管理员权限需求

**无。** 构建配置未设 requestedExecutionLevel（默认 asInvoker）；NSIS 允许改安装目录、非 oneClick。文案中「以管理员身份运行 NEXUS」仅为客户端提权时的诊断建议，非运行要求；注册表回退路径在非提权下实测可用。

## 6. 发现的安全隐患（如实列出）

1. **LCU `rejectUnauthorized: false`**（connector.js:195）：LCU 自签证书的行业惯例，连接限定 127.0.0.1，风险限于本机回环；保留但如实记录。
2. **DPAPI 不可用时明文回退**：auth.js save() 与 wegame.js encrypt() 在系统加密不可用时落明文（带 insecure 标记）。Windows 正常环境 DPAPI 可用，实测 secure:true；建议后续移除回退或强警告。
3. **客户端令牌经命令行/日志可读**：lockfile/日志含 remoting-auth-token，属客户端自身暴露面；NEXUS 仅内存使用、日志不记录令牌（log 只记 port/source，实测无令牌落盘）。
4. **更新安装链**：SHA-256 + Authenticode 发布者指纹 pinned 校验 + `install({confirmed})` 用户确认 + 隔离 updater 进程执行前复核（updater.js:125-131,261-265；updater-mode.js:72-78）。当前发布门禁未配置更新源，诚实态不影响使用。
5. **powershell 命令拼接**：PID 经 parseInt 净化（connector.js:57），其余为固定字符串，无注入面。
6. 密码门/信任记录均 DPAPI 加密、源码无明文（test-auth 30/30 实测）。

## 7. 暂时关闭的高风险功能

1. **客户端符文写入**：禁用（connector.js:393）。
2. **正式包客户端通道首装默认关闭**：本轮新增 `app.isPackaged && firstRun → lcuAutoConnect=false`（main.js bootstrap）；既有用户与开发 bench 的既有选择不变；设置页开关标注「实验性」+ 知情同意文案。
3. **SGP 深链路**：依赖客户端通道，随其默认关闭；WeGame 独立通道需用户自有 Cookie 显式连接（无自动登录）。
4. **对局内实时遥测/教练**：合规不可用，诚实标注（不读游戏内存）。
5. LCU 视图与设置页新增「实验性 · 知情启用」「腾讯未确认第三方调用合规性」标注。

## 8. 后续整改建议

1. 发展独立公开战绩通道（查他人公开战绩不应要求启动客户端），降低对 LCU 的依赖。
2. 移除或强警告 DPAPI 明文回退（§6.2）。
3. 每次发布前跑安全检查清单：新增进程交互/内存访问/注入 Hook/自动化操作/未授权网络请求/敏感凭证存储/提权需求；发现不符立即停发该功能。
4. 腾讯政策一旦明确，再评估客户端通道转正；在此之前保持实验性标注与默认关闭。
5. 更新源配置后，发布链继续执行「下载→SHA-256→签名→确认→隔离安装→复核」。
6. 持续不宣称 ACE 通过/不封号（红线）。

## 本轮验证

- test-auth 30/30（含「验一次信任本机」新语义：首验锁定/信任落盘加密/重启免密/设置清除回锁/改密全设备失效）。
- test-fixes 22/22（环境感知：无客户端分支实测；有客户端分支待客户端运行时自动验证）。
- functional 18/18、views 22 clean、identity 13/13（审计整改后复跑见回归记录）。
- 未打包、未发布；交付门禁不变。

## 9. 2.0 复核（2026-11-21）

范围：阶段 4–7 新增模块（十人侦察 scout / 主动分析师 analyst / AI 上下文 aicontext / 本地知识库 kb / 性能改造）后的红线复核。方法：代码逐行取证 + 本机实测。

1. **只读性质不变**：LCU 全部请求仍为 GET（connector.js:226–388 逐行复核，无 POST/PUT/DELETE）；`applyRunes()` 仍直接抛错（connector.js:393），functional 18/18 实测「符文应用需确认（未确认被拒）」。新增的 scoutParticipants / matchParticipants / profile 刷新均复用上述只读 GET 接口，未新增任何写端点。
2. **无注入/内存/Hook**：新增模块仅读本地 db 缓存与调用既有只读接口；全仓仍无 DLL 注入 / Read·WriteProcessMemory / CreateRemoteThread / Hook / ffi native addon。analyst 仅消费本地 matches 缓存阈值触发，不触碰游戏进程。
3. **正式包默认关闭客户端通道保持**：`app.isPackaged && firstRun → lcuAutoConnect=false`（main.js:100）；`lcu.start()` 仅在开关开启时执行（main.js:189）。contextIsolation:true / nodeIntegration:false（main.js:171）；nexus-asset 协议路径越界 403（main.js:140）。
4. **隐私整改（本轮修复）**：发现「允许发送个人战绩」(sendPersonal) 开关此前仅持久化、后端未生效。本轮在 `ai:report` / `ai:tactic` / `aicontext:build` 真实门禁：个人战绩 payload（player/growth 视图标记 personal:true）在开关关闭时降级本地规则分析；AI 上下文在关闭时剔除本人档案块。`sendReplay` 复盘门禁保持。probe-privacy8 实测 7/7（关闭降级 / 非个人不受影响 / 上下文剔除与恢复 / 开启解除 / 复盘门禁 / 无异常）。
5. **性能改造不扩大读取面**：map 缓存（changeCount 版本键）/ 防抖落盘 / 并行 boot 仅优化既有读路径，不新增数据源、不改变只读性质；probe-perf7 5/5、views 22 clean、functional 18/18。
6. **红线不变**：未宣称 ACE 通过 / 不封号；LCU/SGP 国服合规未经腾讯确认，按实验性管理、正式包默认关闭；AI 密钥仍 DPAPI 加密、未配置走规则引擎。