'use strict';
/**
 * GitHub Releases publisher — confirmation-gated. Requires GITHUB_TOKEN env
 * (repo scope) or authenticated gh CLI. Uploads the SIGNED installer +
 * nexus-update.json manifest + .sha256 as release assets; GitHub becomes the
 * authoritative version source for all NEXUS clients.
 *   node tools/github-publish.cjs --confirmed [--prerelease]
 * NEVER run without explicit user confirmation.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
if (!process.argv.includes('--confirmed')) { console.error('✗ 必须携带 --confirmed（用户已明确确认上传）。'); process.exit(1); }
const PRERELEASE = process.argv.includes('--prerelease');

function die(m) { console.error('✗ ' + m); process.exit(1); }
const readJson = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fb; } };

function token() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim(); } catch { return null; }
}
function req(method, url, tok, body, contentType) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : null;
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers: {
      'User-Agent': 'NEXUS-Publisher', Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json',
      ...(data ? { 'Content-Type': contentType || 'application/json', 'Content-Length': data.length } : {}),
    } }, (res) => { let b = ''; res.on('data', c => b += c); res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) { try { resolve(b ? JSON.parse(b) : null); } catch { resolve(b); } }
      else reject(new Error('GitHub HTTP ' + res.statusCode + ': ' + b.slice(0, 300)));
    }); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

(async () => {
  const tok = token();
  if (!tok) die('无凭据：设置 GITHUB_TOKEN 环境变量或安装并登录 gh CLI。');
  const sources = readJson(path.join(process.env.APPDATA, 'nexus-lol-tactical', 'config.json'), {}).updateSources || {};
  const repo = (sources.github && sources.github.repo) || process.env.NEXUS_GH_REPO;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) die('未配置 GitHub 仓库（更新页渠道配置或 NEXUS_GH_REPO 环境变量）。');
  const channelDir = path.join(ROOT, 'release', 'channel');
  const manifest = readJson(path.join(channelDir, 'latest.json'), null);
  if (!manifest) die('本地渠道无 latest.json：先完成 release.cjs publish --confirmed。');
  const installer = path.join(channelDir, manifest.file);
  if (!fs.existsSync(installer)) die('渠道缺少安装包 ' + manifest.file);
  // re-verify signature before uploading anything
  const { verifySignature } = require('../electron/core/signature');
  const sig = await verifySignature(installer, manifest.publisherThumbprint);
  if (!sig.ok) die('上传前签名自检失败：' + sig.reason);

  const tag = 'v' + manifest.version;
  const notesMd = `## ${manifest.title}\n\n${manifest.body}\n\n更新级别：${manifest.level} · 发布日期：${manifest.date}\n\n` +
    [['added', '【新增功能】'], ['improved', '【功能优化】'], ['fixed', '【问题修复】'], ['stability', '【性能与稳定性】'], ['compatibility', '【兼容性说明】']]
      .filter(([k]) => manifest.notes[k] && manifest.notes[k].length)
      .map(([k, l]) => l + '\n' + manifest.notes[k].map(t => '- ' + t).join('\n')).join('\n\n') +
    `\n\n---\nSHA-256: \`${manifest.sha256}\`\n数字签名：Authenticode · 发布者指纹 \`${manifest.publisherThumbprint}\`\n国内镜像：夸克网盘（见应用内「版本更新」渠道配置）\n开发者：竖 · 邮箱：1564898589@qq.com`;

  const api = 'https://api.github.com/repos/' + repo;
  let rel;
  try { rel = await req('GET', api + '/releases/tags/' + tag, tok); console.log('已存在同 tag Release，将更新资产与说明。'); }
  catch { rel = await req('POST', api + '/releases', tok, { tag_name: tag, name: manifest.title, body: notesMd, prerelease: PRERELEASE, draft: false }); console.log('已创建 Release ' + tag); }
  await req('PATCH', api + '/releases/' + rel.id, tok, { name: manifest.title, body: notesMd, prerelease: PRERELEASE });

  const uploads = [
    [manifest.file, fs.readFileSync(installer), 'application/octet-stream'],
    ['nexus-update.json', Buffer.from(JSON.stringify(manifest, null, 2)), 'application/json'],
    [manifest.file + '.sha256', Buffer.from(manifest.sha256 + '  ' + manifest.file + '\n'), 'text/plain'],
  ];
  for (const [name, buf, ct] of uploads) {
    const existing = (rel.assets || []).find(a => a.name === name);
    if (existing) await req('DELETE', api + '/releases/assets/' + existing.id, tok);
    const up = await req('POST', `https://uploads.github.com/repos/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(name)}`, tok, buf, ct);
    console.log('已上传资产 ✓ ' + name + ' (' + (buf.length / 1048576).toFixed(1) + ' MB)');
    rel = await req('GET', api + '/releases/' + rel.id, tok);
  }
  console.log('\n=== GitHub 发布完成 ===\n' + rel.html_url + '\n客户端将以该 Release 的 nexus-update.json 为权威清单。');
})().catch(e => { console.error('✗ ' + e.message); process.exit(1); });