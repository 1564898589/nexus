'use strict';
const { app, BrowserWindow, protocol, net, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { pathToFileURL } = require('url');
const initSqlJs = require('sql.js');

const { createLogger } = require('./core/logger');
const { createConfig } = require('./core/config');
const { createDb } = require('./core/db');
const { createAssets } = require('./providers/assets');
const { createBackupManager } = require('./core/backup');
const { createUpdateEngine } = require('./core/update-engine');
const { createLcuEngine } = require('./lcu/connector');
const { createPlayerEngine } = require('./core/players');
const { createWegameChannel } = require('./providers/wegame');
const { createAnnouncements } = require('./core/announcements');
const { createAiHub } = require('./core/ai');
const { createAlerts } = require('./core/alerts');
const { createKb } = require('./core/kb');
const { createAiContext } = require('./core/aicontext');
const { createAnalyst } = require('./core/analyst');
const { createUpdater } = require('./core/updater');
const { createSourceManager } = require('./core/sources');
const { createAuthGate } = require('./core/auth');
const collector = require('./providers/collector');
const cn101 = require('./providers/cn101');
const { runUpdaterMode } = require('./updater-mode');
const { registerIpc } = require('./core/ipc');

// Privileged custom scheme for local cached assets (must be registered before ready).
protocol.registerSchemesAsPrivileged([
  { scheme: 'nexus-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
]);

const events = new EventEmitter();
events.setMaxListeners(50);
let win = null;
let liveWin = null;
let ctx = null;
let backupTimer = null;

// NEXUS LIVE — lightweight always-on-top floating intel window (ordinary Windows window).
function toggleLiveWindow() {
  if (liveWin && !liveWin.isDestroyed()) { liveWin.close(); liveWin = null; return false; }
  const cfg = ctx ? ctx.config : null;
  const saved = (cfg && cfg.get('liveWindow')) || {};
  liveWin = new BrowserWindow({
    width: saved.width || 360, height: saved.height || 520,
    x: saved.x, y: saved.y,
    minWidth: 280, minHeight: 320, frame: false, alwaysOnTop: true,
    skipTaskbar: false, backgroundColor: '#010A13', title: 'NEXUS LIVE',
    opacity: saved.opacity != null ? saved.opacity : 0.96,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  liveWin.loadFile(path.join(__dirname, '..', 'renderer', 'live.html'));
  liveWin.setOpacity(saved.opacity != null ? Math.max(0.3, Math.min(1, saved.opacity)) : 0.96);
  liveWin.on('close', () => {
    if (liveWin && !liveWin.isDestroyed() && cfg) {
      const b = liveWin.getBounds(); const op = liveWin.getOpacity();
      cfg.set('liveWindow', { x: b.x, y: b.y, width: b.width, height: b.height, opacity: op });
    }
    liveWin = null;
  });
  return true;
}
function setLiveOpacity(v) { if (liveWin && !liveWin.isDestroyed()) liveWin.setOpacity(Math.max(0.3, Math.min(1, v))); }

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name), d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (!fs.existsSync(d)) fs.copyFileSync(s, d);
  }
}

function seedIfNeeded(userData, logger) {
  const dbFile = path.join(userData, 'nexus.db');
  if (fs.existsSync(dbFile)) return;
  const seedDir = path.join(__dirname, '..', 'data', 'seed');
  const seedDb = path.join(seedDir, 'nexus.db');
  if (fs.existsSync(seedDb)) {
    fs.copyFileSync(seedDb, dbFile);
    copyDir(path.join(seedDir, 'assets'), path.join(userData, 'assets'));
    logger.info('seed', 'bundled seed data installed', { seedDb });
  }
}

async function bootstrap() {
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  const logger = createLogger(path.join(userData, 'logs'));
  // 安全政策：正式包首装默认不自动连接客户端通道（LCU/SGP 合规未经腾讯确认），
  // 用户知情后手动开启；开发 bench 与既有用户的选择保持不变。
  const firstRun = !fs.existsSync(path.join(userData, 'config.json'));
  const config = createConfig(userData);
  if (app.isPackaged && firstRun) config.set('lcuAutoConnect', false);
  seedIfNeeded(userData, logger);
  const db = await createDb(initSqlJs, path.join(userData, 'nexus.db'), logger);
  if (db.recovery) { try { config.set('dbRecovery', db.recovery); } catch (e) { logger.child('db').warn('persist recovery flag', e.message); } }
  try { db.prune(); } catch (e) { logger.child('db').warn('boot prune', e.message); }
  const assets = createAssets(path.join(userData, 'assets'), logger);
  const backup = createBackupManager(db.file, path.join(userData, 'backups'), db.SQL, logger, config);
  const updateEngine = createUpdateEngine({ db, logger, config, assets, events });
  const lcu = createLcuEngine(logger);
  const alerts = createAlerts(userData, db, config, events, logger);
  const updater = createUpdater({ app, config, logger, paths: { userData }, events, backup, db });
  const sources = createSourceManager({ db, logger, config, events, assets });
  // KR OP.GG keeps its existing update-engine state machine; expose it through the registry too.
  sources.register('kr-opgg', {
    collect: async (_c, opts) => {
      const r = await updateEngine.refresh(opts || {});
      return { ok: !!r.ok, error: r.error || null, version: r.patch || null, sampleSize: r.stats || null, fetched: r.stats || 0, success: r.stats || 0, failed: 0 };
    },
  });
  sources.register('cn-101', { collect: cn101.collectRanked, check: cn101.check });
  sources.register('kr-opgg-matchups', { collect: collector.collectMatchups });
  lcu.onChange((s) => { events.emit('lcu-state', s); try { alerts.onLcuState(s); } catch (e) { logger.child('alerts').warn('scan', e.message); } });
  const wegame = createWegameChannel(userData, logger);
  const players = createPlayerEngine({ db, logger, lcu, config, wegame, events });
  const announcements = createAnnouncements(userData, logger, app.getVersion());
  const ai = createAiHub(userData, logger, config);
  const auth = createAuthGate(userData, logger);
  const kb = createKb({ db, logger, seedDir: path.join(__dirname, '..', 'data', 'seed') });
  const aicontext = createAiContext({ db, config, players, queries: require('./core/queries'), kb });
  const analyst = createAnalyst({ db, config, players, alerts, events, logger });
  events.on('matches-ingested', () => { try { analyst.evaluate('ingest'); } catch (e) { logger.child('analyst').warn('ingest eval', e.message); } });

  ctx = { db, logger, config, assets, backup, updateEngine, sources, lcu, players, wegame, announcements, ai, auth, alerts, updater, events, kb, aicontext, analyst, paths: { userData }, app, win: null };

  // local asset protocol
  protocol.handle('nexus-asset', async (req) => {
    try {
      const u = new URL(req.url);
      const rel = decodeURIComponent((u.host + u.pathname).replace(/^\/+/, ''));
      const abs = path.normalize(path.join(assets.dir, rel));
      if (!abs.startsWith(path.normalize(assets.dir))) return new Response('forbidden', { status: 403 });
      if (!fs.existsSync(abs)) {
        // 头像按需懒加载（Data Dragon 官方公开 CDN），失败仍 404 由渲染层占位
        const m = rel.match(/^profileicon\/(\d+)\.png$/);
        if (m) {
          const ver = db.getMeta('ddVersion') || '16.23.1';
          const got = await assets.download(`https://ddragon.leagueoflegends.com/cdn/${ver}/img/profileicon/${m[1]}.png`, rel);
          if (got) return net.fetch(pathToFileURL(abs).toString());
        }
        return new Response('not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(abs).toString());
    } catch (e) { return new Response('error', { status: 500 }); }
  });

  ipcMain.handle('live:toggle', () => toggleLiveWindow());
  ipcMain.handle('live:opacity', (e, v) => { setLiveOpacity(v); return true; });
  ipcMain.handle('live:state', () => !!(liveWin && !liveWin.isDestroyed()));
  ipcMain.handle('live:focusMain', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); } return true; });
  try { globalShortcut.register('F9', () => toggleLiveWindow()); } catch {}
  events.on('nexus-alert', (it) => {
    if (win && !win.isDestroyed()) win.webContents.send('nexus-alert', it);
    if (liveWin && !liveWin.isDestroyed()) liveWin.webContents.send('nexus-alert', it);
  });

  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 720,
    frame: false, show: false, backgroundColor: '#010A13',
    title: 'NEXUS · 英雄联盟智能战术终端',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      spellcheck: false,
    },
  });
  ctx.win = win;
  // 必须在 ctx.win 赋值之后注册：ipc.js 解构出的 win 用于窗口控制/对话框/事件转发，
  // 提前注册会永久捕获 null，导致最小化/最大化/关闭全部抛错（实测日志 window:min IPC error）。
  registerIpc(ctx);
  // 主动分析师：启动后评估一次（真实缓存阈值触发，去重节流），不阻塞首屏。
  setTimeout(() => { try { analyst.evaluate('boot'); } catch (e) { logger.child('analyst').warn('boot eval', e.message); } }, 4000);
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { require('electron').shell.openExternal(url); return { action: 'deny' }; });

  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  updateEngine.start();
  sources.start();
  if (config.get('lcuAutoConnect')) lcu.start();

  // boot update check (silent; network failure never blocks the app)
  if (config.get('autoCheckUpdate') !== false) {
    setTimeout(() => { updater.check().catch(() => {}); }, 2500);
  }

  // scheduled auto-backup
  const scheduleBackup = () => {
    if (backupTimer) clearTimeout(backupTimer);
    if (!config.get('autoBackup')) return;
    const hours = config.get('backupIntervalHours') || 24;
    backupTimer = setTimeout(() => {
      try { if (db.counts().champion_stats > 0) backup.create('auto', db); }
      catch (e) { logger.child('backup').error('auto backup failed', e); }
      scheduleBackup();
    }, hours * 36e5);
  };
  scheduleBackup();

  logger.info('main', 'NEXUS started', { version: app.getVersion(), userData });
}

// Isolated updater mode must branch BEFORE normal bootstrap.
const updaterArgIdx = process.argv.indexOf('--nexus-updater');
if (updaterArgIdx >= 0 && process.argv[updaterArgIdx + 1]) {
  runUpdaterMode(process.argv[updaterArgIdx + 1]);
} else {
  app.whenReady().then(bootstrap).catch((e) => {
    console.error('bootstrap failed', e);
    app.quit();
  });
}

app.on('window-all-closed', () => {
  if (ctx) { try { ctx.lcu.stop(); ctx.updateEngine.stop(); ctx.sources.stop(); ctx.db.persist(); } catch {} }
  if (backupTimer) clearTimeout(backupTimer);
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { try { globalShortcut.unregisterAll(); } catch {} if (ctx) { try { ctx.lcu.stop(); ctx.db.persist(); } catch {} } });