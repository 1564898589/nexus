'use strict';
/**
 * Isolated updater mode: `NEXUS.exe --nexus-updater <payload.json>`.
 * Runs as a SEPARATE process from the main app (which is exiting), so the
 * installer can overwrite the install dir. Shows a small progress window.
 * On any failure it restores the rollback snapshot and relaunches the old
 * version — the user is never left without a working app.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, BrowserWindow } = require('electron');

function runUpdaterMode(payloadFile) {
  const payload = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
  const logFile = path.join(payload.updatesDir, 'updater.log');
  const historyFile = path.join(payload.updatesDir, 'update-history.json');
  const log = (msg) => { try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`); } catch {} };

  let win = null;
  const send = (stage, text, percent, result) => {
    log(stage + ': ' + text);
    if (win && !win.isDestroyed()) win.webContents.send('updater-stage', { stage, text, percent, result });
  };
  const record = (result, detail) => {
    let arr = [];
    try { arr = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch {}
    arr.unshift({ at: new Date().toISOString(), from: payload.oldVersion, to: payload.newVersion, result, detail: detail || null });
    try { fs.writeFileSync(historyFile, JSON.stringify(arr.slice(0, 100), null, 2)); } catch {}
  };
  const relaunch = () => {
    try { const c = spawn(payload.exe, [], { detached: true, stdio: 'ignore', windowsHide: false }); c.unref(); } catch (e) { log('relaunch failed: ' + e.message); }
    setTimeout(() => app.quit(), 800);
  };
  const readInstalledVersion = () => {
    try {
      const pj = path.join(payload.installDir, 'resources', 'app.asar', 'package.json');
      return JSON.parse(fs.readFileSync(pj, 'utf8')).version; // Electron fs reads asar transparently
    } catch (e) { return null; }
  };
  const rollback = (reason) => {
    send('rollback', '升级失败，正在恢复旧版本 ' + payload.oldVersion + '…', 60);
    try {
      fs.cpSync(payload.rollbackDir, payload.installDir, { recursive: true, force: true });
      const v = readInstalledVersion();
      if (v !== payload.oldVersion) throw new Error('恢复后版本校验不符：' + v);
      record('rollback', reason);
      send('done', '已恢复旧版本 ' + payload.oldVersion + '，软件可正常使用。失败原因：' + reason, 100, 'rollback');
    } catch (e) {
      record('rollback-failed', reason + ' / ' + e.message);
      send('done', '自动恢复失败：' + e.message + '。请手动重新安装旧版本（用户数据不受影响）。', 100, 'error');
    }
    setTimeout(relaunch, 2500);
  };

  app.whenReady().then(() => {
    win = new BrowserWindow({
      width: 460, height: 300, frame: false, alwaysOnTop: true, resizable: false,
      backgroundColor: '#010A13', title: 'NEXUS 更新',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    win.loadFile(path.join(__dirname, '..', 'renderer', 'updater.html'));
    win.webContents.on('did-finish-load', async () => {
      send('wait', '等待 NEXUS 主程序退出…', 5);
      // 1. wait for old process to exit
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        try { process.kill(payload.oldPid, 0); } catch { break; }
        await new Promise(r => setTimeout(r, 500));
      }
      try { process.kill(payload.oldPid, 0); return rollback('主程序未在 90 秒内退出'); } catch {}
      // 2. re-verify installer hash AND publisher signature before executing
      send('verify', '复核安装包 SHA-256 与数字签名…', 12);
      const crypto = require('crypto');
      const sha = crypto.createHash('sha256').update(fs.readFileSync(payload.installer)).digest('hex');
      if (sha !== payload.sha256) return rollback('安装包复核校验失败');
      const { verifySignature } = require('./core/signature');
      const sig = await verifySignature(payload.installer, payload.publisherThumbprint);
      if (!sig.ok) return rollback('数字签名复核失败：' + sig.reason);
      // 3. silent install into the SAME dir (NSIS /S; /D must be last, unquoted)
      send('install', '正在安装 ' + payload.newVersion + '（静默升级，保留用户数据）…', 25);
      const code = await new Promise((resolve) => {
        // NSIS truncates /D at the first space, and Node cannot spawn a
        // manually-quoted exe path (ENOENT). Verified robust form: plain spawn
        // (Node quotes the exe correctly) + /D=<8.3 short path> which never
        // contains spaces. Falls back to the raw dir if short paths are off.
        let dDir = payload.installDir;
        try {
          const r = require('child_process').spawnSync('powershell', ['-NoProfile', '-Command',
            `(New-Object -ComObject Scripting.FileSystemObject).GetFolder(${JSON.stringify(payload.installDir)}).ShortPath`], { encoding: 'utf8', timeout: 15000, windowsHide: true });
          const sp = (r.stdout || '').trim();
          if (sp && !sp.includes(' ') && fs.existsSync(sp)) dDir = sp;
        } catch {}
        const args = ['/S', '/D=' + dDir];
        const c = spawn(payload.installer, args, { windowsHide: true });
        const t = setTimeout(() => { try { c.kill(); } catch {} resolve(-1); }, 300000);
        c.on('error', (e) => { clearTimeout(t); log('installer spawn error: ' + e.message); resolve(-2); });
        c.on('close', (cd) => { clearTimeout(t); resolve(cd == null ? -1 : cd); });
      });
      if (code !== 0) return rollback('安装程序退出码 ' + code);
      // 4. probe installed version
      send('probe', '校验新版本文件…', 80);
      await new Promise(r => setTimeout(r, 1200));
      const v = readInstalledVersion();
      if (v !== payload.newVersion) return rollback('安装后版本不符（读到 ' + v + '，期望 ' + payload.newVersion + '）');
      record('success');
      send('done', '更新完成：' + payload.oldVersion + ' → ' + payload.newVersion + '，正在启动新版…', 100, 'success');
      setTimeout(relaunch, 1800);
    });
  });
}

module.exports = { runUpdaterMode };