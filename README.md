# NEXUS · 英雄联盟智能战术终端

Windows 桌面端（Electron）。多服务器数据中心（韩服 OP.GG / 国服 101）+ AI 情报套件 + 严格只读合规。

开发者：竖 <1564898589@qq.com>

## 快速启动（本地）

- **双击 `启动NEXUS.bat`**（或桌面快捷方式 `NEXUS`）：
  1. 若已安装正式版 → 直接启动安装版；
  2. 否则用项目内 Electron 启动源码（开发模式）；
  3. 首次运行自动 `npm install` 后再启动。
- 命令行等价：`npm start`
- 安装正式版：运行 `release/NEXUS Setup <版本>.exe`（或从 GitHub Releases / 夸克镜像下载）。

## 构建安装包

```
npm install
npm run dist        # electron-builder --win -> release/NEXUS Setup <版本>.exe
```

发布流水线（确认门禁）见 `docs/RELEASE_WORKFLOW.md`：
`node tools/release.cjs prepare` → 用户确认 → `node tools/release.cjs publish --confirmed` → `node tools/release-prep.cjs` → GitHub / 夸克渠道。

## 目录

- `electron/` 主进程（核心引擎 / LCU 只读 / 数据源 / AI / 更新链）
- `renderer/` 渲染进程（ES Modules，无构建步骤）
- `data/seed/` 首启种子数据与公告
- `tools/` 采集 / 校验 / 发布 / 探针脚本
- `docs/` 设计、审计、发布与接入指南

## 合规红线

不读游戏内存 / 不注入 / 不改游戏文件 / 不自动操作游戏 / 不截屏 OCR；仅 LCU/SGP 本地只读接口与公开数据源。
正式包首装默认不自动连接客户端通道（实验性，需知情手动开启）。不宣称 ACE 通过 / 不封号。

## 许可

MIT（源码）。第三方数据署名与许可证见 `docs/RESEARCH.md` / `docs/UPGRADE_PLAN.md`。
