'use strict';
/**
 * NEXUS 发布准备与预检（第六阶段：未来发布自动化准备）。
 * 只做检查与清单生成，不打包、不上传、不发布：
 *   node tools/release-prep.cjs
 * 产出：
 *   release/channel/<安装包>.sha256            SHA-256 校验文件
 *   release/quark-upload-manifest.json         夸克网盘上传清单（目录结构/版本/哈希/分享信息占位）
 *   release/preflight-report.json / .md        发布前检查报告
 * 未来正式发布顺序（均需用户明确确认）：
 *   release.cjs prepare → 用户确认 → release.cjs publish --confirmed
 *   → release-prep.cjs 复核 → github-publish.cjs --confirmed
 *   → 按夸克上传清单人工上传 → 回填分享链接/提取码 → 双渠道一致性复核
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const CH = path.join(ROOT, 'release', 'channel');
const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail: detail || '' }); console.log((ok ? '✓ ' : '✗ ') + name + (detail ? ' — ' + detail : '')); };

(async () => {
  const pkg = readJson(path.join(ROOT, 'package.json'), {});
  const manifest = readJson(path.join(CH, 'latest.json'), null);
  check('本地渠道存在版本清单 latest.json', !!manifest);
  if (!manifest) return finish();

  const installer = path.join(CH, manifest.file);
  check('安装包命名规范（NEXUS Setup <版本>.exe）', manifest.file === `NEXUS Setup ${manifest.version}.exe`, manifest.file);
  check('安装包存在', fs.existsSync(installer));
  let realSha = null, size = 0;
  if (fs.existsSync(installer)) {
    realSha = sha256(installer); size = fs.statSync(installer).size;
    check('SHA-256 与清单一致', realSha === manifest.sha256, realSha.slice(0, 16) + '…');
    check('文件大小与清单一致', !manifest.size || size === manifest.size, (size / 1048576).toFixed(1) + ' MB');
    // SHA-256 校验文件（与 GitHub Release 资产同名同内容）
    fs.writeFileSync(installer + '.sha256', manifest.sha256 + '  ' + manifest.file + '\n');
    check('已生成 .sha256 校验文件', true, path.basename(installer) + '.sha256');
  }
  check('清单要求数字签名（不止 SHA-256）', manifest.requireSignature === true);
  check('清单携带发布者证书指纹', !!manifest.publisherThumbprint, (manifest.publisherThumbprint || '').slice(0, 16) + '…');
  const pinnedCer = fs.existsSync(path.join(ROOT, 'electron', 'core', 'nexus-publisher.cer'));
  check('内置发布证书（公钥）随包分发', pinnedCer);
  if (fs.existsSync(installer) && manifest.publisherThumbprint) {
    const { verifySignature } = require('../electron/core/signature');
    const sig = await verifySignature(installer, manifest.publisherThumbprint);
    check('Authenticode 签名复核', sig.ok, sig.ok ? 'signer=' + (sig.thumbprint || '').slice(0, 16) + '…' : sig.reason);
  }
  check('版本号与 package.json 一致', manifest.version === pkg.version, `${manifest.version} vs ${pkg.version}`);
  check('更新说明完整（标题/正文/分级）', !!manifest.title && !!manifest.body && ['major', 'minor', 'patch'].includes(manifest.level), manifest.level);
  const notesOk = manifest.notes && ['added', 'improved', 'fixed', 'stability', 'compatibility'].every(k => Array.isArray(manifest.notes[k]));
  check('更新说明五类字段齐全', notesOk);
  const hist = readJson(path.join(ROOT, 'release', 'history', manifest.version + '.json'), null);
  check('版本历史档案存在（不覆盖历史）', !!hist, 'release/history/' + manifest.version + '.json');
  const pending = readJson(path.join(ROOT, 'release', 'pending-changes.json'), { changes: [] });
  check('无未发布的滞留变更（WIP 不混入）', !pending.changes || pending.changes.length === 0, (pending.changes || []).length + ' 条待发布');

  // 夸克上传清单：目录结构 NEXUS/Releases/v<ver>/ + NEXUS/Latest/，历史版本永不覆盖
  const quarkManifest = {
    product: 'NEXUS', generatedAt: new Date().toISOString(), version: manifest.version,
    note: '夸克无稳定免人工自动下载接口：本清单供人工上传。上传后获取分享链接与提取码，回填到应用内「版本更新 → 渠道配置」，并写入下方 share 字段留档。',
    directoryLayout: {
      root: 'NEXUS',
      versionDir: `NEXUS/Releases/v${manifest.version}`,
      latestDir: 'NEXUS/Latest',
      archiveRule: '每个版本独立目录永久保留；Latest 仅放最新正式版；旧版本移入 Releases 历史目录，绝不覆盖删除',
    },
    files: [{
      name: manifest.file, sourcePath: path.relative(ROOT, installer).replace(/\\/g, '/'),
      sha256: manifest.sha256, size,
      alsoUpload: [manifest.file + '.sha256', 'nexus-update.json'],
      targets: [`NEXUS/Releases/v${manifest.version}/`, 'NEXUS/Latest/'],
    }],
    manifestAsset: { name: 'nexus-update.json', sourcePath: 'release/channel/latest.json', content: manifest },
    share: { shareUrl: '', shareCode: '', verifiedAt: null, note: '上传并验证分享可用后回填' },
    consistencyRule: '夸克文件必须与 GitHub Release 资产逐字节一致（同一 SHA-256）；禁止分别构建',
  };
  fs.writeFileSync(path.join(ROOT, 'release', 'quark-upload-manifest.json'), JSON.stringify(quarkManifest, null, 2));
  check('已生成夸克上传清单', true, 'release/quark-upload-manifest.json');

  // GitHub ↔ 夸克一致性：本地渠道清单即未来 GitHub 权威清单的镜像基准
  const ghConfigured = !!((readJson(path.join(process.env.APPDATA, 'nexus-lol-tactical', 'config.json'), {}).updateSources || {}).github || {}).repo;
  check('GitHub 仓库配置状态（未来接入）', true, ghConfigured ? '已配置' : '尚未配置 · 等待接入（不影响本地发布准备）');
  const quarkCfg = ((readJson(path.join(process.env.APPDATA, 'nexus-lol-tactical', 'config.json'), {}).updateSources || {}).quark) || {};
  check('夸克分享配置状态（未来接入）', true, quarkCfg.shareUrl ? '已配置' : '尚未配置 · 等待接入（上传后回填）');

  finish();

  function finish() {
    const okAll = checks.every(c => c.ok);
    const report = { product: 'NEXUS', at: new Date().toISOString(), version: manifest && manifest.version, allPassed: okAll, checks, nextSteps: [
      '1. 用户确认测试结果与更新说明',
      '2. node tools/release.cjs publish --confirmed（如需重新打包）',
      '3. node tools/github-publish.cjs --confirmed（需 GITHUB_TOKEN，用户确认后）',
      '4. 按 release/quark-upload-manifest.json 人工上传夸克并回填分享信息',
      '5. 应用内渠道配置填写 GitHub 仓库与夸克分享，真实网络联调',
    ] };
    fs.writeFileSync(path.join(ROOT, 'release', 'preflight-report.json'), JSON.stringify(report, null, 2));
    const md = `# NEXUS 发布前检查报告\n\n时间：${report.at}\n版本：${report.version || '—'}\n结论：${okAll ? '全部通过 ✓（等待用户确认后才可发布）' : '存在未通过项 ✗（禁止发布）'}\n\n` +
      checks.map(c => `- ${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`).join('\n') +
      '\n\n## 后续步骤（每一步都需用户明确确认）\n' + report.nextSteps.join('\n') + '\n';
    fs.writeFileSync(path.join(ROOT, 'release', 'preflight-report.md'), md);
    console.log('\n报告已写入 release/preflight-report.md / .json');
    console.log(okAll ? '✓ 预检全部通过。未执行任何打包/上传/发布。' : '✗ 预检存在未通过项，禁止发布。');
    process.exit(okAll ? 0 : 1);
  }
})().catch(e => { console.error('✗ 预检异常：' + e.message); process.exit(1); });