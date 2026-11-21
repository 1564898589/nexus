'use strict';
/**
 * Dual-channel update sources — centralized configuration + smart selection.
 * GitHub Releases = authoritative version metadata (manifest asset nexus-update.json).
 * Quark (夸克网盘) = domestic download MIRROR. Verified conclusion: Quark shares
 * offer no stable, legal, unattended direct-download API (login session +
 * time-limited signed URLs; automating it would require simulated login /
 * scraping, which is prohibited). Therefore Quark is a MANUAL mirror: share
 * page + extraction code + guidance + user-picked local file + full verification.
 * Local release folder = offline/dev fallback. Channel switching is transparent.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const DEFAULT_SOURCES = {
  github: { repo: '', apiBase: 'https://api.github.com', enabled: true },
  quark: { shareUrl: '', shareCode: '', enabled: true },
  local: { path: '', enabled: true },
  defaultChannel: 'auto',        // auto | github | quark | local
  autoSwitch: true,
  retries: 2,
  minSpeedKBs: 150,              // below this GitHub asset speed => try mirror
  showPrerelease: false,
};

function httpJson(url, headers = {}, timeout = 15000, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('重定向过多'));
    if (!/^https:\/\//i.test(url)) return reject(new Error('仅允许 HTTPS'));
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(hard); fn(v); } };
    const req = https.get(url, { timeout, headers: { 'User-Agent': 'NEXUS-Updater', Accept: 'application/vnd.github+json', ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return done(resolve, httpJson(new URL(res.headers.location, url).toString(), headers, timeout, redirects + 1)); }
      if (res.statusCode !== 200) { res.resume(); return done(reject, new Error('HTTP ' + res.statusCode)); }
      let buf = ''; res.on('data', c => buf += c); res.on('end', () => { try { done(resolve, JSON.parse(buf)); } catch { done(reject, new Error('JSON 解析失败')); } });
      res.on('error', e => done(reject, e));
    });
    // hard deadline: socket timeout does not cover a hanging DNS lookup
    const hard = setTimeout(() => { try { req.destroy(); } catch {} done(reject, new Error('网络超时')); }, timeout + 5000);
    req.on('timeout', () => req.destroy(new Error('网络超时')));
    req.on('error', e => done(reject, e));
  });
}

// Range-probe an asset: returns { ok, speedKBs, latencyMs, error }
function probeAsset(url, timeout = 10000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; clearTimeout(hard); resolve(v); } };
    const t0 = Date.now();
    const req = https.get(url, { timeout, headers: { 'User-Agent': 'NEXUS-Updater', Range: 'bytes=0-262143' } }, (res) => {
      if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); return done({ ok: false, error: 'HTTP ' + res.statusCode }); }
      let n = 0;
      res.on('data', c => { n += c.length; });
      res.on('end', () => {
        const ms = Date.now() - t0;
        done({ ok: true, speedKBs: Math.round(n / 1024 / Math.max(0.2, ms / 1000)), latencyMs: ms });
      });
      res.on('error', e => done({ ok: false, error: e.message }));
    });
    const hard = setTimeout(() => { try { req.destroy(); } catch {} done({ ok: false, error: '测速超时' }); }, timeout + 5000);
    req.on('timeout', () => { req.destroy(); done({ ok: false, error: '测速超时' }); });
    req.on('error', e => done({ ok: false, error: e.message }));
  });
}

function createChannels({ config, logger, paths }) {
  const log = logger.child('channels');
  const cacheFile = path.join(paths.userData, 'updates', 'manifest-cache.json');
  const sources = () => {
    const s = { ...DEFAULT_SOURCES, ...(config.get('updateSources') || {}) };
    s.github = { ...DEFAULT_SOURCES.github, ...(s.github || {}) };
    s.quark = { ...DEFAULT_SOURCES.quark, ...(s.quark || {}) };
    s.local = { ...DEFAULT_SOURCES.local, ...(s.local || {}) };
    if (!s.local.path) s.local.path = path.join(paths.userData, 'update-channel');
    return s;
  };
  const setSources = (patch) => {
    const cur = config.get('updateSources') || {};
    const next = { ...cur, ...patch };
    if (patch.github) next.github = { ...cur.github, ...patch.github };
    if (patch.quark) next.quark = { ...cur.quark, ...patch.quark };
    if (patch.local) next.local = { ...cur.local, ...patch.local };
    config.set('updateSources', next);
    return sources();
  };

  let status = {
    github: { state: 'unknown', error: null, latencyMs: null, speedKBs: null },
    quark: { configured: false, autoDownload: false, note: '夸克分享无稳定免人工直链；作为人工镜像渠道，下载后自动校验。' },
    local: { ok: false },
    active: null, manifestSource: null, cached: false,
  };
  // Honest states: unconfigured channels are "等待接入", never fake-connected,
  // and never reported as network failures.
  const setStatus = (patch) => { status = { ...status, ...patch }; return status; };

  function localManifest() {
    const s = sources();
    if (!s.local.enabled) return null;
    try { return JSON.parse(fs.readFileSync(path.join(s.local.path, 'latest.json'), 'utf8')); } catch { return null; }
  }
  function readCache() { try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch { return null; } }
  function writeCache(m, source) {
    try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify({ manifest: m, source, at: new Date().toISOString() })); } catch {}
  }

  async function githubManifest() {
    const s = sources();
    if (!s.github.enabled || !s.github.repo) throw new Error('未配置 GitHub 仓库');
    const api = s.github.apiBase.replace(/\/$/, '');
    const rel = await httpJson(`${api}/repos/${s.github.repo}/releases/latest`);
    const asset = (rel.assets || []).find(a => a.name === 'nexus-update.json');
    if (!asset) throw new Error('GitHub Release 缺少 nexus-update.json 清单资产');
    const m = await httpJson(asset.browser_download_url || asset.url, { Accept: 'application/octet-stream' });
    if (m.product !== 'NEXUS') throw new Error('清单产品标识不符');
    m._github = { tag: rel.tag_name, publishedAt: rel.published_at, prerelease: !!rel.prerelease, htmlUrl: rel.html_url, assetUrl: ((rel.assets || []).find(a => a.name === m.file) || {}).browser_download_url || null };
    return m;
  }

  async function githubHistory() {
    const s = sources();
    if (!s.github.enabled || !s.github.repo) return [];
    try {
      const rels = await httpJson(`${s.github.apiBase.replace(/\/$/, '')}/repos/${s.github.repo}/releases?per_page=10`);
      return rels.map(r => ({
        version: (r.tag_name || '').replace(/^v/, ''), date: (r.published_at || '').slice(0, 10),
        title: r.name || r.tag_name, prerelease: !!r.prerelease, htmlUrl: r.html_url,
        level: ((r.body || '').match(/更新级别[：:]\s*(major|minor|patch)/i) || [])[1] || null,
      }));
    } catch { return []; }
  }

  /** Smart check: GitHub authoritative -> probe -> mirror/local fallback -> cache. */
  async function resolve() {
    const s = sources();
    setStatus({ quark: { ...status.quark, configured: !!(s.quark.enabled && s.quark.shareUrl) }, local: { ok: !!localManifest() }, cached: false });
    let manifest = null, source = null, ghError = null;
    const ghUnconfigured = !s.github.enabled || !s.github.repo;
    if (ghUnconfigured) setStatus({ github: { state: 'unconfigured', error: null, latencyMs: null, speedKBs: null } });
    if (!ghUnconfigured && s.defaultChannel !== 'local' && s.defaultChannel !== 'quark') {
      try {
        manifest = await githubManifest();
        source = 'github';
        setStatus({ github: { state: 'ok', error: null, latencyMs: null, speedKBs: null } });
        if (manifest._github && manifest._github.assetUrl && s.defaultChannel === 'auto') {
          const probe = await probeAsset(manifest._github.assetUrl);
          if (!probe.ok) { setStatus({ github: { state: 'fail', error: probe.error, latencyMs: null, speedKBs: null } }); ghError = probe.error; }
          else if (probe.speedKBs < s.minSpeedKBs) { setStatus({ github: { state: 'slow', error: null, latencyMs: probe.latencyMs, speedKBs: probe.speedKBs } }); ghError = 'slow'; }
          else setStatus({ github: { state: 'ok', error: null, latencyMs: probe.latencyMs, speedKBs: probe.speedKBs } });
        }
        writeCache(manifest, 'github');
      } catch (e) {
        ghError = e.message;
        setStatus({ github: { state: 'fail', error: e.message, latencyMs: null, speedKBs: null } });
        log.warn('github check failed', e.message);
      }
    }
    // GitHub unreachable must NOT mean "no new version": use cache, then local.
    if (!manifest) {
      const cache = readCache();
      if (cache && cache.manifest) { manifest = cache.manifest; source = 'cache'; setStatus({ cached: true }); }
      else { const lm = localManifest(); if (lm) { manifest = lm; source = 'local'; } }
    }
    // choose active download channel
    let active = s.defaultChannel;
    if (active === 'auto') {
      if (source === 'github' && !ghError) active = 'github';
      else if (s.quark.enabled && s.quark.shareUrl && s.autoSwitch) active = 'quark';
      else if (localManifest()) active = 'local';
      else active = 'github';
    }
    if (active === 'quark' && !(s.quark.enabled && s.quark.shareUrl)) active = localManifest() ? 'local' : 'github';
    setStatus({ active, manifestSource: source });
    return { manifest, source, active, status: { ...status }, ghError };
  }

  return { sources, setSources, resolve, githubHistory, localManifest, status: () => ({ ...status }), probeAsset, httpJson };
}

module.exports = { createChannels, DEFAULT_SOURCES, probeAsset };