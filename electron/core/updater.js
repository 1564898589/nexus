'use strict';
/**
 * NEXUS intelligent update engine (dual-channel edition).
 * GitHub Releases = authoritative metadata; Quark = manual domestic mirror;
 * local folder = offline fallback. Download -> SHA-256 -> Authenticode publisher
 * signature -> rollback snapshot -> isolated updater process -> silent install
 * -> version probe -> relaunch (rollback on any failure). userData never touched.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { createChannels } = require('./update-channels');
const { verifySignature, pinnedThumbprint } = require('./signature');

const PRODUCT = 'NEXUS';

function cmpSemver(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}
function sha256File(file, onProgress) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const total = fs.statSync(file).size;
    let done = 0;
    const s = fs.createReadStream(file);
    s.on('data', (c) => { h.update(c); done += c.length; if (onProgress) onProgress(done, total); });
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });
}
function httpsStream(url, redirects = 0, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('重定向次数过多'));
    if (!/^https:\/\//i.test(url)) return reject(new Error('仅允许 HTTPS 更新源'));
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(hard); fn(v); } };
    const req = https.get(url, { timeout: 25000, headers: { 'User-Agent': 'NEXUS-Updater', ...extraHeaders } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return done(resolve, httpsStream(new URL(res.headers.location, url).toString(), redirects + 1, extraHeaders)); }
      if (res.statusCode !== 200 && res.statusCode !== 206) { res.resume(); return done(reject, new Error('HTTP ' + res.statusCode)); }
      done(resolve, res);
    });
    // hard deadline covers hanging DNS as well as slow sockets; the response
    // stream itself may legitimately run long, so only guard the connect phase
    const hard = setTimeout(() => { try { req.destroy(); } catch {} done(reject, new Error('网络超时')); }, 35000);
    req.on('timeout', () => req.destroy(new Error('网络超时')));
    req.on('error', e => done(reject, e));
  });
}

function createUpdater({ app, config, logger, paths, events, backup, db }) {
  const log = logger.child('updater');
  const updatesDir = path.join(paths.userData, 'updates');
  fs.mkdirSync(updatesDir, { recursive: true });
  const historyFile = path.join(updatesDir, 'update-history.json');
  const channels = createChannels({ config, logger, paths });

  let state = {
    current: app.getVersion(), packaged: app.isPackaged,
    checking: false, available: false, upToDate: false, latest: null, level: null,
    stage: 'idle', percent: 0, bytes: 0, total: 0, speedKBs: 0, error: null,
    lastCheckAt: null, channel: null, channels: channels.status(), downloaded: false, installing: false,
    mirror: null, prereleases: [], cached: false, resumed: false,
  };
  let activeReq = null; // current download response, for user cancel
  const emit = () => events.emit('update-state', { ...state });
  const set = (patch) => { state = { ...state, ...patch }; emit(); };

  async function check() {
    set({ checking: true, error: null });
    try {
      const r = await channels.resolve();
      const manifest = r.manifest;
      if (!manifest) {
        const unconf = r.status && r.status.github && r.status.github.state === 'unconfigured';
        throw new Error(r.ghError ? ('GitHub 不可达且无缓存/本地清单：' + r.ghError)
          : unconf ? '更新源尚未配置：填写 GitHub 仓库或本地发布目录后即可接通（当前不影响正常使用）'
          : '所有更新渠道均无版本清单');
      }
      if (manifest.product !== PRODUCT) throw new Error('版本清单产品标识不符，拒绝使用');
      if (!manifest.version || !manifest.sha256 || !manifest.file) throw new Error('版本清单缺少必要字段');
      const newer = cmpSemver(manifest.version, state.current) > 0;
      const snooze = config.get('updateSnoozeUntil');
      const snoozed = snooze && newer && cmpSemver(manifest.version, snooze.version || '0.0.0') <= 0 && Date.now() < (snooze.until || 0);
      let prereleases = [];
      if (channels.sources().showPrerelease) {
        const hist = await channels.githubHistory();
        prereleases = hist.filter(h => h.prerelease && cmpSemver(h.version, state.current) > 0);
      }
      set({
        checking: false, latest: manifest, channel: r.active, channels: r.status, cached: r.source === 'cache',
        lastCheckAt: new Date().toISOString(), available: newer && !snoozed, upToDate: !newer,
        level: manifest.level || 'patch', stage: newer ? 'available' : 'up-to-date', error: null,
        downloaded: false, percent: 0, prereleases, resumed: false,
        mirror: r.active === 'quark' ? mirrorInfo(manifest) : null,
      });
      log.info('check', { current: state.current, latest: manifest.version, newer, source: r.source, active: r.active });
      return { ...state };
    } catch (e) {
      const cs = channels.status();
      const unconf = cs.github && cs.github.state === 'unconfigured' && !cs.local.ok && !state.cached;
      set({ checking: false, available: false, error: (unconf ? '' : '更新检查暂不可用：') + (e.message || e), lastCheckAt: new Date().toISOString(), stage: unconf ? 'unconfigured' : 'check-failed', channels: cs });
      log.warn('check failed', e.message);
      return { ...state };
    }
  }

  const target = (m) => path.join(updatesDir, m.file);
  // Quark mirror metadata: version / installer name / SHA-256 / share info,
  // so the manual-download guidance always names the EXACT official file.
  const mirrorInfo = (m) => {
    const q = channels.sources().quark;
    const mm = (m && m.mirror && m.mirror.quark) || {};
    return {
      shareUrl: mm.shareUrl || q.shareUrl, shareCode: mm.shareCode || q.shareCode,
      version: m && m.version, file: m && m.file, sha256: m && m.sha256, size: m && m.size,
      downloadStatus: 'manual-required', fallback: 'local-file',
    };
  };

  async function verifyFile(file, m) {
    set({ stage: 'verifying', percent: 92 });
    const sha = await sha256File(file, (d, t) => set({ bytes: d, total: t, percent: 92 + Math.round(d / t * 4) }));
    if (sha !== m.sha256) { try { fs.unlinkSync(file); } catch {} throw new Error('SHA-256 校验失败，文件已删除'); }
    if (m.size && fs.statSync(file).size !== m.size) { try { fs.unlinkSync(file); } catch {} throw new Error('文件大小与清单不符，已删除'); }
    set({ stage: 'signing', percent: 97 });
    const sig = await verifySignature(file, m.publisherThumbprint);
    if (!sig.ok) { try { fs.unlinkSync(file); } catch {} throw new Error('数字签名验证失败：' + sig.reason); }
    set({ stage: 'verified', downloaded: true, percent: 100, speedKBs: 0 });
    log.info('verified', { version: m.version, sha: sha.slice(0, 12), signer: (sig.thumbprint || '').slice(0, 12) });
    return sig;
  }

  /** Download with resume (断点续传) when the server honors Range requests.
   *  A leftover .part from an interrupted attempt is continued via
   *  `Range: bytes=<have>-`; a 200 reply (no Range support) restarts cleanly. */
  async function streamDownload(url, m, tmp) {
    let have = 0;
    try { have = fs.statSync(tmp).size; } catch {}
    if (m.size && have >= m.size) have = 0; // stale/oversized partial -> restart
    const headers = have > 0 ? { Range: 'bytes=' + have + '-' } : {};
    const res = await httpsStream(url, 0, headers);
    activeReq = res;
    const resumed = have > 0 && res.statusCode === 206;
    if (!resumed) have = 0;
    const total = m.size || (have + parseInt(res.headers['content-length'] || '0', 10));
    const t0 = Date.now();
    set({ resumed });
    try {
      await new Promise((resolve, reject) => {
        const ws = fs.createWriteStream(tmp, { flags: resumed ? 'a' : 'w' });
        let done = have, newBytes = 0;
        res.on('data', c => {
          done += c.length; newBytes += c.length;
          const sec = Math.max(0.3, (Date.now() - t0) / 1000);
          set({ bytes: done, total, percent: total ? Math.round(done / total * 90) : 0, speedKBs: Math.round(newBytes / 1024 / sec) });
        });
        res.on('error', reject); ws.on('error', reject); ws.on('finish', resolve);
        res.pipe(ws);
      });
    } finally { activeReq = null; }
  }

  /** User cancel: abort the in-flight download; the .part is kept for resume. */
  function cancelDownload() {
    if (activeReq) { try { activeReq.destroy(new Error('用户取消下载')); } catch {} return true; }
    return false;
  }

  async function download() {
    const m = state.latest;
    if (!m) throw new Error('请先检查更新');
    const file = target(m);
    const s = channels.sources();
    // dedupe: already downloaded & fully verified
    if (fs.existsSync(file)) {
      try {
        const sha = await sha256File(file);
        const sig = await verifySignature(file, m.publisherThumbprint);
        if (sha === m.sha256 && sig.ok) { set({ stage: 'verified', downloaded: true, percent: 100 }); return { ok: true, reused: true, file }; }
      } catch {}
      try { fs.unlinkSync(file); } catch {}
    }
    const tmp = file + '.part';
    const active = state.channel || 'github';
    set({ stage: 'downloading', percent: 0, error: null, speedKBs: 0, resumed: false });
    try {
      if (active === 'quark') {
        // Quark cannot be auto-downloaded legally/stably -> manual mirror flow.
        const mi = mirrorInfo(m);
        set({ stage: 'mirror-manual', mirror: mi, downloaded: false });
        return { ok: false, manual: true, mirror: mi };
      }
      if (active === 'local') {
        const src = path.join(s.local.path, m.file);
        if (!fs.existsSync(src)) throw new Error('本地发布目录缺少安装包：' + m.file);
        const total = fs.statSync(src).size;
        await new Promise((resolve, reject) => {
          const rs = fs.createReadStream(src), ws = fs.createWriteStream(tmp);
          let done = 0;
          rs.on('data', c => { done += c.length; set({ bytes: done, total, percent: Math.round(done / total * 90) }); });
          rs.on('error', reject); ws.on('error', reject); ws.on('finish', resolve);
          rs.pipe(ws);
        });
      } else {
        const url = (m._github && m._github.assetUrl) || m.url;
        if (!url) throw new Error('清单未提供 GitHub 下载地址');
        let lastErr = null;
        for (let attempt = 0; attempt <= (s.retries || 0); attempt++) {
          try { await streamDownload(url, m, tmp); lastErr = null; break; }
          catch (e) {
            lastErr = e; log.warn('download attempt ' + (attempt + 1) + ' failed', e.message);
            if (/用户取消/.test(e.message)) break; // keep .part for later resume
            // keep .part so the next attempt resumes via Range when supported
          }
        }
        if (lastErr) {
          // transparent fallback: local copy of the SAME version+hash, else manual mirror
          const localSrc = path.join(s.local.path, m.file);
          if (s.local.enabled && fs.existsSync(localSrc)) {
            const lsha = await sha256File(localSrc);
            if (lsha === m.sha256) { fs.copyFileSync(localSrc, tmp); set({ channel: 'local', channels: { ...channels.status(), active: 'local' } }); }
            else throw lastErr;
          } else if (s.autoSwitch && s.quark.enabled && s.quark.shareUrl) {
            const mi = mirrorInfo(m);
            set({ stage: 'mirror-manual', channel: 'quark', mirror: mi, downloaded: false });
            return { ok: false, manual: true, mirror: mi, reason: String(lastErr.message || lastErr) };
          } else throw lastErr;
        }
      }
      fs.renameSync(tmp, file);
      await verifyFile(file, m);
      return { ok: true, file };
    } catch (e) {
      // keep .part for resume (断点续传); it is version-named and re-verified
      // byte-for-byte after completion, so a stale partial can never install.
      set({ stage: 'download-failed', error: String(e.message || e), downloaded: false, speedKBs: 0 });
      throw e;
    }
  }

  /** User picked a manually-downloaded file (Quark mirror / any source). Full verification applies. */
  async function useLocalFile(filePath) {
    const m = state.latest;
    if (!m) throw new Error('请先检查更新获取权威清单');
    if (!filePath || !fs.existsSync(filePath)) throw new Error('文件不存在');
    if (!/\.exe$/i.test(filePath)) throw new Error('仅接受 .exe 安装包');
    const file = target(m);
    fs.copyFileSync(filePath, file);
    set({ channel: 'local-file', stage: 'verifying' });
    try { await verifyFile(file, m); return { ok: true, file }; }
    catch (e) { set({ stage: 'download-failed', error: String(e.message || e), downloaded: false }); throw e; }
  }

  function readAttemptHistory() { try { return JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch { return []; } }

  async function install({ confirmed = false, backupFirst = true } = {}) {
    if (!app.isPackaged) throw new Error('开发模式不参与自动安装；请使用正式安装版测试升级。');
    const m = state.latest;
    if (!m || !state.downloaded) throw new Error('请先完成下载与校验');
    if (!confirmed) throw new Error('升级需用户确认');
    const installDir = path.dirname(process.execPath);
    const rollbackDir = path.join(updatesDir, 'rollback-' + state.current);
    set({ stage: 'preparing', installing: true, percent: 0 });
    if (backupFirst) { try { await backup.create('pre-update', db); } catch (e) { log.warn('pre-update backup failed', e.message); } }
    try {
      for (const d of fs.readdirSync(updatesDir)) {
        if (d.startsWith('rollback-') && d !== path.basename(rollbackDir)) fs.rmSync(path.join(updatesDir, d), { recursive: true, force: true });
      }
      if (fs.existsSync(rollbackDir)) fs.rmSync(rollbackDir, { recursive: true, force: true });
      fs.cpSync(installDir, rollbackDir, { recursive: true });
    } catch (e) { set({ installing: false, stage: 'prepare-failed', error: '无法创建回滚快照：' + e.message }); throw e; }
    const payload = {
      product: PRODUCT, installer: target(m), sha256: m.sha256, publisherThumbprint: m.publisherThumbprint || null,
      installDir, rollbackDir, oldVersion: state.current, newVersion: m.version,
      oldPid: process.pid, exe: process.execPath, updatesDir, at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(updatesDir, 'pending-update.json'), JSON.stringify(payload, null, 2));
    set({ stage: 'handoff', percent: 100 });
    log.info('handoff', { newVersion: m.version });
    const child = spawn(process.execPath, ['--nexus-updater', path.join(updatesDir, 'pending-update.json')], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    setTimeout(() => app.quit(), 600);
    return { ok: true, handedOff: true };
  }

  function snooze(hours = 24) {
    if (state.latest) config.set('updateSnoozeUntil', { version: state.latest.version, until: Date.now() + hours * 3600 * 1000 });
    set({ available: false, stage: 'snoozed' });
    return true;
  }

  async function history() {
    let releases = [];
    try { releases = await channels.githubHistory(); } catch {}
    if (!releases.length) { try { releases = JSON.parse(fs.readFileSync(path.join(channels.sources().local.path, 'history.json'), 'utf8')); } catch {} }
    return { releases, attempts: readAttemptHistory() };
  }

  return {
    check, download, cancelDownload, install, snooze, useLocalFile, history,
    state: () => ({ ...state }),
    sources: () => channels.sources(),
    setSources: (p) => channels.setSources(p),
    channelStatus: () => channels.status(),
    pickLocalFile: async () => {
      const { dialog } = require('electron');
      const r = await dialog.showOpenDialog({ title: '选择已下载的安装包', properties: ['openFile'], filters: [{ name: 'NEXUS 安装包', extensions: ['exe'] }] });
      if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
      return useLocalFile(r.filePaths[0]);
    },
  };
}

module.exports = { createUpdater, cmpSemver, sha256File, PRODUCT };