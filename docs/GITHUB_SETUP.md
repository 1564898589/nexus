# GitHub 接入指南（未来发布时按此操作）

**现在不需要做任何事。** GitHub 模块已开发完成并实测，仓库信息留空时系统显示「尚未配置 · 等待接入」，不影响任何现有功能。等你决定正式发布时，按下面步骤接通。

## 一、你需要亲自完成的（AI 不索要、不保存你的账号密码）

1. 注册/登录 GitHub 账号（如已有则跳过）。
2. 创建公共仓库，建议名 `nexus`（最终 `owner/repo` 形式，例如 `sail/nexus`）。
3. 生成 Personal Access Token（classic，勾选 `repo` 权限；或 fine-grained 仅授权该仓库的 Contents 读写）。
   - Token 只通过环境变量 `GITHUB_TOKEN` 提供给发布脚本，**不写入任何配置文件、日志或代码**。
4. 仓库创建、登录、验证码等交互由你本人完成；AI 协助整理内容与执行脚本。

## 二、AI 协助流程（你明确说「开始正式发布」后）

1. 检查是否已有 GitHub 账号与仓库（`gh` CLI 或网页）。
2. 协助创建 NEXUS 公共仓库，配置名称/说明/README。
3. 开源前敏感信息清理检查：
   - API 密钥（AI 中心密钥存于 Windows Credential Manager，不在仓库内）；
   - 个人路径、令牌、隐私数据、用户数据（userData 不在仓库内）；
   - `release/` 大文件与测试夹具按 `.gitignore` 排除；
   - 第三方开源许可证保留（Electron/Chromium 许可证随包）。
4. `.gitignore` 已备好（见仓库根目录）。
5. 初始化 Git、提交源码、打标签 `v<版本>`。
6. 上传源码（push）。
7. 运行发布流水线（每一步都需你确认）：
   ```
   node tools/release.cjs prepare            # 测试门禁 + 发布计划（不打包）
   # 向你展示测试结果与更新说明，获得明确确认
   node tools/release.cjs publish --confirmed # 版本号/日志/公告/构建/签名/校验/本地渠道
   node tools/release-prep.cjs                # 预检报告 + 夸克上传清单 + .sha256
   node tools/github-publish.cjs --confirmed  # 上传 Release（需 GITHUB_TOKEN）
   ```
8. `github-publish.cjs` 上传三个资产：安装包 `NEXUS Setup <版本>.exe`、权威清单 `nexus-update.json`、校验文件 `<安装包>.sha256`；Release 正文含更新级别、五类说明、SHA-256、签名指纹、开发者：竖。
9. 在应用内「版本更新 → 渠道配置」填写 `owner/repo`，保存后自动检查接通。

## 三、客户端如何消费 GitHub（已实现）

- 最新版本：`GET /repos/<owner>/<repo>/releases/latest` → 资产 `nexus-update.json`。
- 历史版本：`GET /repos/<owner>/<repo>/releases?per_page=10`（预发布单独展示，不参与自动升级）。
- 更新公告：清单内 title/body/notes 五类字段。
- 下载：Release 安装包资产直链；先 Range 测速，慢/失败自动转夸克镜像或本地兜底。
- GitHub 暂时不可达 ≠ 没有新版本：使用上次缓存清单（标注非实时）。
- 仅 HTTPS；清单产品标识必须为 NEXUS；清单签名指纹必须等于内置发布证书指纹。

## 四、网络说明（本机实测）

- `api.github.com` 可达（约 3 秒级），但存在间歇性波动；下载域名波动更明显。
- 系统已按此设计：硬截止超时、缓存兜底、镜像切换、失败保留当前版本。
- 国内用户下载主要走夸克镜像；GitHub 作为版本权威源与海外下载通道。