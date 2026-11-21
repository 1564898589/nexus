# NEXUS 双渠道智能更新系统（GitHub + 夸克网盘）

状态：**系统开发完成，全部本地实测通过。GitHub 仓库与夸克分享尚未创建/配置——这是预期状态，系统已为未来接入做好全部准备，不依赖任何尚不存在的配置。**

本文档对应交付物：① 现有问题报告 ② 新架构说明 ③ 修改文件清单 ⑥ 测试结果 ⑦ 待用户配置事项。
GitHub 配置方法见 `GITHUB_SETUP.md`，夸克配置方法见 `QUARK_SETUP.md`，发布工作流见 `RELEASE_WORKFLOW.md`。

---

## 一、原有更新系统问题报告（审计结论）

| # | 问题 | 原因 | 现状 |
|---|------|------|------|
| 1 | 「更新检查暂不可用」 | 旧引擎只认单一 HTTPS 清单地址，无缓存、无兜底；网络一断即报错 | 已修复：GitHub→缓存→本地三级兜底；全部失败时保留当前版本并诚实提示 |
| 2 | 本地发布目录缺少版本清单 | 无统一发布流水线，清单靠手工 | 已修复：`release.cjs publish` 自动生成并双渠道投放 `latest.json` |
| 3 | 最新版本无法显示 / 更新说明为空 | 清单字段不全、无公告合并机制 | 已修复：清单含版本/级别/日期/标题/正文/五类说明；`release-ann.json` 随包合并进公告中心 |
| 4 | 历史版本没有记录 | 无历史档案 | 已修复：GitHub Releases 历史（权威）+ 本地 `history.json` 兜底 + `release/history/<版本>.json` 永久档案 + 本机升级记录 |
| 5 | 更新渠道没有真正接通 | 只有 UI，没有下载/校验/安装链路 | 已修复：下载（断点续传）→SHA-256→数字签名→隔离更新器→静默安装→版本探针→重启/回滚，全链路实测 |
| 6 | 仅 SHA-256 不足以信任安装包 | 无签名验证 | 已修复：Authenticode 签名 + 内置发布证书指纹锁定，下载后与安装前两次复核；无签名/指纹不符一律拒装 |
| 7 | GitHub 暂时不可达被误判为「没有新版本」 | 无缓存策略 | 已修复：上次成功清单缓存继续提供版本信息，并明确标注「缓存，非实时」 |
| 8 | 未配置渠道显示含糊 | 无「未配置」独立状态 | 已修复：`尚未配置 · 等待接入` 独立状态，绝不显示虚假连接成功 |
| 9 | 安装 spawn 在带空格路径下失败（本次实测新发现） | Node 无法 spawn 手工加引号的可执行文件路径（ENOENT）；NSIS `/D` 在空格处截断 | 已修复：普通 spawn + `/D=<8.3 短路径>`，含空格目录实测安装成功 |
| 10 | 网络请求可能永久挂起（本次实测新发现） | socket 超时不覆盖 DNS 挂起 | 已修复：所有更新网络请求加硬截止（httpJson/probeAsset/httpsStream） |

## 二、新架构说明

```
┌─ 版本权威源 ────────────────────────────────────────────────┐
│ GitHub Releases（未来接入）                                  │
│   releases/latest → 资产 nexus-update.json（权威清单）       │
│   releases?per_page=10 → 历史版本 / 预发布                   │
│   安装包资产 + .sha256 + 清单，三者同一 Release              │
└──────────────┬──────────────────────────────────────────────┘
               │ 失败 ≠ 没有新版本
               ▼
   manifest-cache.json（上次成功清单，标注「非实时」）
               │ 无缓存
               ▼
   本地发布目录 latest.json（离线/开发兜底，随发布流水线生成）

┌─ 下载渠道（智能选择，切换对用户透明）──────────────────────┐
│ auto：GitHub 测速（Range 探测，≥150KB/s）→ GitHub 直下       │
│       慢/失败 → 夸克镜像（人工下载指引 + 本地文件校验）      │
│       夸克未配置 → 本地同版本同哈希副本 → 保留当前版本       │
│ 夸克结论（已实测验证）：分享页无稳定、合法、免人工直链；     │
│ 因此夸克 = 人工镜像：打开分享页 → 用户下载 → 选择本地文件    │
│ → SHA-256 + 签名全量校验。不模拟登录、不破解、不绕验证码。   │
└──────────────────────────────────────────────────────────────┘

┌─ 安全链（每一环都实测过拒绝路径）──────────────────────────┐
│ 仅 HTTPS → 清单 product=NEXUS → 版本比较（semver）           │
│ → 下载（断点续传，.part 按版本命名）→ SHA-256 逐字节         │
│ → 文件大小 → Authenticode 签名 + 内置证书指纹锁定            │
│   （清单指纹 ≠ 内置指纹 = 伪造清单，拒绝）                   │
│ → 用户确认（大版本额外警示）→ 数据库备份 + 旧版回滚快照      │
│ → 主程序退出 → 独立更新器进程（--nexus-updater）二次复核     │
│   SHA + 签名 → NSIS 静默安装（/S /D=短路径，不覆盖运行中文件）│
│ → asar 版本探针 → 成功重启新版 / 任何失败恢复旧版并重启      │
│ 用户数据（收藏/配置/对局历史/数据库/知识库）在独立 userData  │
│ 目录，升级与回滚均不触碰。                                   │
└──────────────────────────────────────────────────────────────┘
```

### 版本分级（semver，依据真实变更，不虚高）
- `breaking / architecture / migration` → **major**（2.0.0 类，强制公告确认）
- `module / expand` → **minor**（1.1.0 类）
- `fix / perf / ui / data / stability` → **patch**（1.0.1 类）

### 更新页面（保留原页面并重设计，13 种状态全真实后端驱动）
当前版本 / 最新正式版 / 状态与进度速度 / 最近检查时间 / GitHub 渠道卡 / 夸克渠道卡 / 本地渠道卡 / 当前下载渠道与清单来源 / 更新公告（五类说明）/ 预发布 / 历史版本（可展开）/ 本机升级记录 / 渠道配置与自动检查开关 / 手动检查按钮。
状态：尚未检查、检查中、发现新版本、已最新、下载中（速度+断点续传标记）、校验中、签名验证中、校验通过、等待关闭、移交更新器、夸克人工指引、下载失败、源不可用、**尚未配置·等待接入**、已稍后提醒。

### 技术选型说明
调研过 electron-updater（GitHub/generic provider + NSIS）：它不支持回滚快照、人工镜像渠道、自签证书指纹锁定与夸克手动兜底，故沿用并扩展自研隔离更新器（同一 exe 以 `--nexus-updater` 参数启动独立进程），不引入不兼容依赖。全程无云服务器、无收费后端。

## 三、修改文件清单（本次双渠道升级）

**新增**
- `electron/core/update-channels.js` — 渠道配置/智能选择/测速/缓存/历史（含硬截止）
- `electron/core/signature.js` — Authenticode 签名/验签/内置证书指纹锁定
- `electron/core/nexus-publisher.cer` — 内置发布证书公钥（随包分发）
- `electron/updater-mode.js` — 隔离更新器（等待退出→复核→静默安装→探针→重启/回滚）
- `renderer/updater.html` + `renderer/js/updater-window.js` — 更新器进度窗
- `tools/github-publish.cjs` — GitHub 上传（--confirmed 门禁）
- `tools/release-prep.cjs` — 发布预检报告 + 夸克上传清单 + .sha256 生成
- `tools/.probe/test-update-channels.cjs` / `test-update-gaps.cjs` / `test-updater-mode.cjs` / `test-resume-local.cjs` — 实测脚本
- `docs/GITHUB_SETUP.md` / `docs/QUARK_SETUP.md` / `docs/RELEASE_WORKFLOW.md`
- `.gitignore`（未来开源准备）

**重写/修改**
- `electron/core/updater.js` — 双渠道引擎：断点续传、取消下载、夸克元数据、未配置诚实状态、硬截止
- `electron/core/ipc.js` — update:* 通道（动作类抛错约定）+ cancelDownload
- `electron/preload.js` — update API + cancelDownload
- `electron/main.js` — --nexus-updater 分支先于 bootstrap；启动自动检查
- `electron/core/config.js` — autoCheckUpdate 默认开
- `electron/core/announcements.js` — 随包版本公告合并
- `renderer/js/views/update.js` — 企业级更新页（保留原页面结构重设计）
- `tools/release.cjs` — prepare（测试门禁）/ publish --confirmed（签名+校验+双渠道投放）
- `package.json` — 版本 1.1.0（上次已确认发布的版本）

## 四、测试结果（全部本机实测）

| 套件 | 结果 | 覆盖 |
|------|------|------|
| test-update-channels.cjs | **16/16**（GitHub 可达时 17/17） | 本地清单检测、签名包下载校验、去重、**无签名拒装**、**篡改拒装（SHA）**、**伪造指纹清单拒绝**、开发模式拒装、夸克人工流程、手动文件校验、GitHub 失败缓存兜底、全源失败保留当前版本、核心功能不受影响、页面渲染、GitHub 真实历史映射（网络波动时诚实跳过） |
| test-update-gaps.cjs | **5/5** | 未配置诚实状态（含 UI 文案）、夸克镜像元数据（版本/文件名/SHA）、真实 HTTPS 断点续传+取消（GitHub 可达时；当前下载域名波动时诚实跳过，机制由下一项覆盖） |
| test-resume-local.cjs | **4/4** | 本地 HTTPS 真实 Range：中断保留 .part → 206 续传 → 逐字节一致（SHA-256）；无 Range 时干净重下 |
| test-updater-mode.cjs | **12/12** | 隔离更新器：无签名包安装前拒绝、**真实 NSIS 静默安装成功**、篡改包回滚、版本探针不符回滚、旧版恢复验证、测试目录静默卸载清理 |
| test-analytics.cjs | 6/6 | 分析引擎回归 |
| test-views.cjs | 全部干净 | 20 视图渲染回归 |
| test-functional.cjs | 18/18 | 功能回归 |
| test-live.cjs | 12/12 | 悬浮窗/实时链路回归 |
| release-prep.cjs | 如实拦截 | 对签名机制前的旧 1.1.0 包正确报「禁止发布」（门禁价值的直接证明） |

GitHub 真实 API 历史映射（electron/electron → v45.4.1 等）与 GitHub 真实资产断点续传（653KB→932KB 续传成功）在本会话早些时候网络可达时已实测通过；本机 GitHub 下载域名存在间歇性波动，系统按设计降级（缓存/本地/人工镜像），不影响结论。

## 五、待用户配置事项（未来接入时，均不紧急）

1. **GitHub**：创建账号与公共仓库 → 按 `GITHUB_SETUP.md` 填写 `owner/repo` → 提供 GITHUB_TOKEN（仅环境变量，不落盘）→ 确认后运行 `github-publish.cjs --confirmed`。
2. **夸克**：按 `QUARK_SETUP.md` 建目录上传同一安装包 → 获取分享链接/提取码 → 应用内渠道配置回填。
3. **发布证书**：当前为自签证书（指纹 FC58AB0C…70ED，5 年有效，本机证书库）。正式对外发布建议购买商业代码签名证书；轮换流程见 RELEASE_WORKFLOW.md。**请备份 `release/publisher.json` 与证书库中的发布证书**（证书丢失将导致旧客户端无法验证新包）。
4. 正式打包/发布/上传：**一律等待你的明确确认**，本次未执行任何正式打包。