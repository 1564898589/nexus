'use strict';
/**
 * NEXUS release pipeline — confirmation-gated, dual-channel edition.
 *
 *   node tools/release.cjs prepare              # classify + notes + TEST GATE -> release/plan-<ver>.json
 *   node tools/release.cjs publish --confirmed  # ONLY after explicit user confirmation:
 *                                               # bump version, changelog, announcement, build,
 *                                               # Authenticode sign, SHA-256, publish local channel.
 *
 * GitHub / Quark uploads are separate, also confirmation-gated:
 *   node tools/github-publish.cjs --confirmed   (needs GITHUB_TOKEN or gh auth)
 *   Quark: manual upload per docs/QUARK_SETUP.md (no legal automation API).
 *
 * Rules: only REAL completed changes in pending-changes.json; WIP never published;
 * tests must pass before a plan is written; no official package without --confirmed.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PENDING = path.join(ROOT, 'release', 'pending-changes.json');
const MODE = process.argv[2] || 'prepare';
const CONFIRMED = process.argv.includes('--confirmed');

function die(msg) { console.error('\n✗ 中止：' + msg); process.exit(1); }
function readJson(f, fb) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } }
function writeJson(f, o) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2)); }
function run(cmd, args) { const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: cmd === 'npm' }); return r.status === 0; }

(async () => {
  if (!['prepare', 'publish'].includes(MODE)) die('用法：release.cjs prepare | publish --confirmed');
  const pending = readJson(PENDING, null);
  if (!pending || !Array.isArray(pending.changes) || !pending.changes.length) die('release/pending-changes.json 无真实变更条目。');

  // ---- classification (semver, evidence-based, never inflated) ----
  const MAJOR = ['breaking', 'architecture', 'migration'], MINOR = ['module', 'expand'];
  const maj = pending.changes.filter(c => MAJOR.includes(c.kind));
  const min = pending.changes.filter(c => MINOR.includes(c.kind));
  const level = maj.length ? 'major' : min.length ? 'minor' : 'patch';
  const rationale = maj.length ? '架构/破坏性/迁移变更：' + maj.map(c => c.text).join('；')
    : min.length ? '新增完整模块/重要扩展：' + min.map(c => c.text).join('；') : '仅修复/性能/界面/适配类变更。';
  const pkg = readJson(path.join(ROOT, 'package.json'), {});
  const cur = pkg.version.split('.').map(Number);
  const version = (level === 'major' ? [cur[0] + 1, 0, 0] : level === 'minor' ? [cur[0], cur[1] + 1, 0] : [cur[0], cur[1], cur[2] + 1]).join('.');
  const date = new Date().toISOString().slice(0, 10);
  const pick = (k) => pending.changes.filter(c => k.includes(c.kind)).map(c => c.text);
  const notes = { added: pick(['module', 'expand']), improved: pick(['ui', 'data']), fixed: pick(['fix']), stability: pick(['perf', 'stability']), compatibility: pending.compatibility || pick(['breaking', 'migration']) };
  const title = pending.theme || `NEXUS v${version} 正式发布`;
  const body = pending.intro || `本次更新${notes.added.length ? '带来 ' + notes.added.length + ' 项新能力' : ''}${notes.fixed.length ? '，修复 ' + notes.fixed.length + ' 项问题' : ''}${notes.stability.length ? '，完成 ' + notes.stability.length + ' 项稳定性优化' : ''}。全部基于真实完成并通过测试的功能。`;
  console.log(`\n=== 发布判定 ===\n${pkg.version} → ${version}（${level}）\n依据：${rationale}\n`);
  console.log(title + '\n' + body);
  for (const [k, label] of [['added', '新增功能'], ['improved', '功能优化'], ['fixed', '问题修复'], ['stability', '性能与稳定性'], ['compatibility', '兼容性说明']]) if (notes[k].length) console.log(`【${label}】\n` + notes[k].map(t => '· ' + t).join('\n'));

  if (MODE === 'prepare') {
    // ---- TEST GATE ----
    console.log('\n=== 测试门禁 ===');
    if (!run(process.execPath, ['tools/test-analytics.cjs'])) die('单元测试未通过。');
    const alive = await new Promise(res => http.get('http://127.0.0.1:9222/json', r => { r.resume(); res(true); }).on('error', () => res(false)));
    if (!alive) die('CDP 9222 不可达：先启动 NEXUS dev 实例再 prepare。');
    for (const t of ['tools/.probe/test-views.cjs', 'tools/.probe/test-functional.cjs', 'tools/.probe/test-live.cjs']) if (!run(process.execPath, [t])) die(t + ' 未通过。');
    const planFile = path.join(ROOT, 'release', `plan-${version}.json`);
    writeJson(planFile, { version, level, date, title, body, notes, rationale, pending, preparedAt: new Date().toISOString(), testsPassed: true });
    console.log(`\n✓ 测试全部通过。发布计划已写入 release/plan-${version}.json`);
    console.log('⚠ 尚未打包。向用户展示测试结果与更新说明，获得明确确认后运行：node tools/release.cjs publish --confirmed');
    return;
  }

  // ---- publish: requires plan + explicit confirmation ----
  if (!CONFIRMED) die('publish 必须携带 --confirmed（用户已明确确认）。严禁未经确认打包发布。');
  const plan = readJson(path.join(ROOT, 'release', `plan-${version}.json`), null);
  if (!plan || !plan.testsPassed) die(`缺少 release/plan-${version}.json（先运行 prepare 并通过测试门禁）。`);
  const publisher = readJson(path.join(ROOT, 'release', 'publisher.json'), null);
  if (!publisher || !publisher.thumbprint) die('缺少 release/publisher.json 签名证书指纹。');

  pkg.version = version;
  writeJson(path.join(ROOT, 'package.json'), pkg);
  const entry = `## ${version}（${date}）— ${title.replace(/^NEXUS\s*v?[\d.]+\s*/, '') || '版本更新'}\n\n更新级别：${level}\n\n` +
    [['added', '新增'], ['improved', '优化'], ['fixed', '修复'], ['stability', '稳定性'], ['compatibility', '兼容性提醒']].filter(([k]) => notes[k].length)
      .map(([k, l]) => `### ${l}\n` + notes[k].map(t => '- ' + t).join('\n')).join('\n\n') + '\n\n';
  const clFile = path.join(ROOT, 'CHANGELOG.md');
  const cl = fs.existsSync(clFile) ? fs.readFileSync(clFile, 'utf8') : '# NEXUS 更新日志\n\n';
  fs.writeFileSync(clFile, cl.replace(/^(# NEXUS 更新日志\n\n)/, '$1' + entry));
  writeJson(path.join(ROOT, 'data', 'seed', 'release-ann.json'), {
    id: 'v' + version, type: '版本更新', version, important: level !== 'patch', requireAck: level === 'major',
    createdAt: new Date().toISOString(), title, body, added: notes.added, improved: [...notes.improved, ...notes.stability], fixed: notes.fixed, known: notes.compatibility, producer: '竖', team: null,
  });
  console.log('版本号 / CHANGELOG / 应用内公告已写入 ✓');

  console.log('\n=== 构建 ===');
  if (!run('npm', ['run', 'dist'])) die('构建失败。');
  const installerName = `NEXUS Setup ${version}.exe`;
  const installer = path.join(ROOT, 'release', installerName);
  if (!fs.existsSync(installer)) die('缺少产物 ' + installerName);

  console.log('\n=== Authenticode 签名 ===');
  const { signFile, verifySignature } = require('../electron/core/signature');
  const signStatus = await signFile(installer, publisher.thumbprint);
  if (!signStatus || signStatus === 'NOCERT') die('签名失败（证书库中无发布证书）：' + signStatus);
  const sig = await verifySignature(installer, publisher.thumbprint);
  if (!sig.ok) die('签名后自检失败：' + sig.reason);
  console.log('签名完成并自检通过 ✓ signer=' + sig.thumbprint);

  const buf = fs.readFileSync(installer);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const size = buf.length;
  if (size < 50 * 1048576) die('安装包体积异常。');
  console.log(`SHA-256: ${sha256}\n大小: ${(size / 1048576).toFixed(1)} MB`);

  const manifest = {
    product: 'NEXUS', version, level, date, title, body, notes,
    file: installerName, sha256, size, requireSignature: true, publisherThumbprint: publisher.thumbprint,
    url: null, minSupported: '1.0.0', publishedAt: new Date().toISOString(),
    mirror: { quark: { shareUrl: '', shareCode: '', note: '发布后按 docs/QUARK_SETUP.md 上传并回填' } },
  };
  for (const ch of [path.join(ROOT, 'release', 'channel'), path.join(process.env.APPDATA, 'nexus-lol-tactical', 'update-channel')]) {
    fs.mkdirSync(ch, { recursive: true });
    fs.copyFileSync(installer, path.join(ch, installerName));
    const pubSha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ch, installerName))).digest('hex');
    if (pubSha !== sha256) die('渠道副本校验失败：' + ch);
    const hf = path.join(ch, 'history.json');
    const hist = readJson(hf, []);
    hist.unshift({ version, level, date, title, notes });
    writeJson(hf, hist.slice(0, 50));
    writeJson(path.join(ch, 'latest.json'), manifest);
    console.log('已发布并校验 ✓ ' + ch);
  }
  writeJson(path.join(ROOT, 'release', 'history', version + '.json'), { version, level, date, rationale, sha256, signature: sig.thumbprint, ...pending });
  fs.writeFileSync(PENDING, JSON.stringify({ theme: '', changes: [], compatibility: [] }, null, 2));
  console.log(`\n=== 本地发布完成：v${version}（${level}）===\n下一步（均需用户确认）：github-publish.cjs --confirmed 上传 GitHub Releases；按 QUARK_SETUP.md 上传夸克镜像。`);
})().catch(e => { console.error('\n✗ 异常：', e.message); process.exit(1); });