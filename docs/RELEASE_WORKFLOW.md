# NEXUS 发布工作流（确认门禁制）

**铁律：严禁 AI 未经用户确认自行打包、发布、上传或覆盖正式版本。** 每一步都有脚本门禁，缺 `--confirmed` 直接拒绝执行。WIP/临时/内部测试改动永不进入正式发布。

## 一、日常开发 → 发布全流程

```
1. 开发完成真实功能，登记 release/pending-changes.json
   （每条含 kind：breaking/architecture/migration/module/expand/fix/perf/ui/data/stability）
2. node tools/release.cjs prepare
   → 自动分级（semver，不虚高）+ 生成中文更新说明预览
   → 测试门禁：test-analytics + CDP 视图/功能/实时套件全过
   → 写 release/plan-<版本>.json（此时不打包）
3. 向用户展示测试结果与更新说明，等待明确确认
4. node tools/release.cjs publish --confirmed
   → 版本号 / CHANGELOG / 应用内公告
   → npm run dist 构建 NSIS 安装包
   → Authenticode 签名 + 签名自检
   → SHA-256 / 体积检查
   → 投放 release/channel/ 与 userData/update-channel/（副本重新哈希校验）
   → release/history/<版本>.json 永久档案，清空 pending
5. node tools/release-prep.cjs
   → 发布前检查报告（preflight-report.md/json）
   → 生成 .sha256 校验文件 + 夸克上传清单（quark-upload-manifest.json）
6. 用户确认后：node tools/github-publish.cjs --confirmed（GITHUB_TOKEN）
7. 用户按 QUARK_SETUP.md 人工上传夸克并回填分享信息
8. 双渠道一致性复核：两平台同版本文件 SHA-256 必须一致
```

## 二、命名与目录规范

- 安装包：`NEXUS Setup <版本>.exe`（唯一命名，两平台同名同内容）
- 权威清单：`nexus-update.json`（product/version/level/date/title/body/notes/file/sha256/size/requireSignature/publisherThumbprint/mirror）
- 校验文件：`<安装包名>.sha256`（内容 `<sha256>  <文件名>`）
- 发布目录：`release/channel/`（最新）、`release/history/`（每版本档案）、`release/upd-test/`（测试用，自动清理）
- 夸克目录：`NEXUS/Releases/v<版本>/` + `NEXUS/Latest/`（见 QUARK_SETUP.md）

## 三、更新级别判定（真实变更驱动）

| kind | 级别 | 示例 |
|------|------|------|
| breaking / architecture / migration | major | 数据结构迁移、架构重构 |
| module / expand | minor | 新增完整模块、重要扩展 |
| fix / perf / ui / data / stability | patch | 修复、性能、界面、适配 |

更新说明五类固定字段：新增功能 / 功能优化 / 问题修复 / 性能与稳定性 / 兼容性说明。全部来自 pending-changes 真实条目，禁止编造。

## 四、签名证书管理

- 当前：自签证书 `CN=NEXUS Publisher (Sail)`，指纹 `FC58AB0C69D800A639424B63FDE1DC4A469070ED`，存于 Cert:\CurrentUser\My（不可导出私钥标记，5 年有效）。
- 公钥 CER 内置于 `electron/core/nexus-publisher.cer` 随包分发；客户端只认这个指纹。
- **备份**：`release/publisher.json` + 证书库中的发布证书。证书丢失 = 旧客户端无法验证新包。
- 轮换（未来换商业证书时）：新证书签名新包 → 先发布一个「过渡版」同时内置新旧两个公钥并信任两者 → 待存量升级后再移除旧指纹。直接换指纹会让旧客户端拒装新包。
- 自签证书在 Windows 上显示「未知发布者」属预期（验签用 AllowUnknownCA + 指纹锁定）；对外正式发布建议购买商业代码签名证书消除 SmartScreen 警告。

## 五、发布前检查报告（release-prep.cjs）

检查项：清单存在 / 命名规范 / SHA-256 一致 / 大小一致 / requireSignature / 指纹 / 内置公钥 / 签名复核 / 版本与 package.json 一致 / 说明完整 / 历史档案 / 无滞留 WIP / 渠道配置状态。
任一失败 → 报告标「禁止发布」。实测：对签名机制之前的旧 1.1.0 包正确拦截（证明门禁有效）。

## 六、未来正式接通时的联调清单（第七阶段第三步）

1. 真实 GitHub 仓库写入配置 → 真实网络检测新版本；
2. 真实夸克分享写入配置 → 国内下载流程验证；
3. 下载 → SHA-256 → 签名 → 安装 → 重启全链路（正式安装版）；
4. 失败回滚演练（可用篡改夹具在隔离目录复现）；
5. 形成完整发布报告。